#!/usr/bin/env python3
"""Render important pages at representative widths and enforce layout contracts."""
from __future__ import annotations

import argparse
import contextlib
import json
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "artifacts" / "visual-smoke"

VIEWPORTS = [
    ("mobile-320", 320, 1000),
    ("mobile-390", 390, 1000),
    ("laptop-1024", 1024, 900),
    ("desktop-1440", 1440, 1000),
]
PAGES = ["index.html", "schedule.html", "discography.html", "youtube.html"]


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def wait_ready(url: str, timeout: float = 15) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urlopen(url, timeout=1) as response:
                if response.status < 500:
                    return
        except Exception:
            time.sleep(0.2)
    raise RuntimeError(f"preview server did not start: {url}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    server = None
    base_url = args.base_url.rstrip("/")
    if not base_url:
        port = free_port()
        server = subprocess.Popen(
            [sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"],
            cwd=ROOT,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        base_url = f"http://127.0.0.1:{port}"
        wait_ready(f"{base_url}/index.html")

    failures: list[str] = []
    report: list[dict] = []
    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            for viewport_name, width, height in VIEWPORTS:
                for filename in PAGES:
                    page = browser.new_page(viewport={"width": width, "height": height})
                    page_errors: list[str] = []
                    page.on("pageerror", lambda error, bucket=page_errors: bucket.append(str(error)))
                    response = page.goto(f"{base_url}/{filename}", wait_until="networkidle", timeout=45_000)
                    page.wait_for_timeout(300)
                    metrics = page.evaluate(
                        """() => ({
                          status: document.readyState,
                          scrollWidth: document.documentElement.scrollWidth,
                          clientWidth: document.documentElement.clientWidth,
                          title: document.title,
                          heroHeight: document.querySelector('.hero-relaunch')?.getBoundingClientRect().height || 0,
                          navLinks: document.querySelector('.nav-links') ? getComputedStyle(document.querySelector('.nav-links')).display : '',
                          hamburger: document.querySelector('.hamburger') ? getComputedStyle(document.querySelector('.hamburger')).display : '',
                          quickCards: document.querySelectorAll('[data-home-quick] .quick-card').length,
                          routeCards: document.querySelectorAll('[data-home-routes] > a').length,
                          memberCards: document.querySelectorAll('[data-members-home] .member-showcase').length,
                          officialCards: document.querySelectorAll('[data-home-official-links] .link-card').length,
                          languageLast: (() => {
                            const menu=document.querySelector('.mobile-menu');
                            const language=menu?.querySelector('.language-mobile-block');
                            return !menu || !language || menu.lastElementChild===language;
                          })()
                        })"""
                    )
                    status = response.status if response else 0
                    if status >= 400 or status == 0:
                        failures.append(f"{filename} {viewport_name}: HTTP {status}")
                    if metrics["scrollWidth"] > metrics["clientWidth"] + 1:
                        failures.append(f"{filename} {viewport_name}: horizontal overflow {metrics['scrollWidth']} > {metrics['clientWidth']}")
                    if not metrics["title"]:
                        failures.append(f"{filename} {viewport_name}: missing title")
                    if page_errors:
                        failures.append(f"{filename} {viewport_name}: page errors: {' | '.join(page_errors)}")
                    if filename == "index.html":
                        limit = 920 if width < 720 else 720
                        if metrics["heroHeight"] > limit:
                            failures.append(f"index.html {viewport_name}: hero too tall ({metrics['heroHeight']:.1f}px)")
                        if metrics["quickCards"] != 4 or metrics["routeCards"] != 4 or metrics["memberCards"] != 5 or metrics["officialCards"] < 6:
                            failures.append(f"index.html {viewport_name}: expected cards are missing: {metrics}")
                        if width < 1180 and metrics["hamburger"] == "none":
                            failures.append(f"index.html {viewport_name}: hamburger should be visible")
                        if width >= 1180 and metrics["navLinks"] == "none":
                            failures.append(f"index.html {viewport_name}: desktop navigation should be visible")
                        if not metrics["languageLast"]:
                            failures.append(f"index.html {viewport_name}: Language is not last in mobile menu")
                    screenshot = args.output / f"{filename.removesuffix('.html')}-{viewport_name}.png"
                    page.screenshot(path=str(screenshot), full_page=True)
                    report.append({"page": filename, "viewport": viewport_name, "width": width, "height": height, "httpStatus": status, "metrics": metrics, "pageErrors": page_errors})
                    page.close()
            browser.close()
    finally:
        if server:
            server.terminate()
            with contextlib.suppress(subprocess.TimeoutExpired):
                server.wait(timeout=5)
            if server.poll() is None:
                server.kill()

    (args.output / "report.json").write_text(
        json.dumps({"failures": failures, "results": report}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    if failures:
        print("❌ Visual smoke test failed")
        for failure in failures:
            print(f"- {failure}")
        return 1
    print(f"✅ Visual smoke test passed: {len(report)} renders")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
