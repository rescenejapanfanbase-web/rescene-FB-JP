#!/usr/bin/env python3
"""Render important pages at representative widths and enforce layout contracts."""
from __future__ import annotations

import argparse
import contextlib
import json
import mimetypes
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "artifacts" / "visual-smoke"

VIEWPORTS = [
    ("mobile-320", 320, 1000),
    ("mobile-390", 390, 1000),
    ("laptop-1024", 1024, 900),
    ("desktop-1440", 1440, 1000),
]
CORE_PAGES = ["index.html", "links.html", "streaming.html"]
REPRESENTATIVE_PAGES = ["schedule.html", "discography.html", "voting.html"]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--viewport", choices=[item[0] for item in VIEWPORTS], default="")
    parser.add_argument("--merge-reports", action="store_true")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    if args.merge_reports:
        combined_failures=[]
        combined_results=[]
        for viewport_name, _, _ in VIEWPORTS:
            report_path=args.output / f"report-{viewport_name}.json"
            if not report_path.exists():
                combined_failures.append(f"{viewport_name}: report is missing")
                continue
            payload=json.loads(report_path.read_text(encoding="utf-8"))
            combined_failures.extend(payload.get("failures", []))
            combined_results.extend(payload.get("results", []))
        (args.output / "report.json").write_text(json.dumps({"failures":combined_failures,"results":combined_results},ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
        if combined_failures:
            print("❌ Visual smoke test failed")
            for failure in combined_failures:
                print(f"- {failure}")
            return 1
        print(f"✅ Visual smoke test passed: {len(combined_results)} renders")
        return 0

    if not args.viewport:
        parser.error("--viewport または --merge-reports を指定してください")

    virtual_host = "rescene.test"
    base_url = args.base_url.rstrip("/") or f"https://{virtual_host}"
    use_virtual_site = not bool(args.base_url)

    failures: list[str] = []
    report: list[dict] = []
    from playwright.sync_api import sync_playwright

    with sync_playwright() as playwright:
        launch_options = {"headless": True}
        system_chromium = Path("/usr/bin/chromium")
        if system_chromium.exists():
            launch_options.update({"executable_path": str(system_chromium), "args": ["--no-sandbox", "--allow-file-access-from-files", "--disable-web-security"]})
        selected_viewports=[item for item in VIEWPORTS if item[0] == args.viewport]
        for viewport_name, width, height in selected_viewports:
            browser = playwright.chromium.launch(**launch_options)
            pages = list(CORE_PAGES)
            if viewport_name in {"mobile-390", "desktop-1440"}:
                pages.extend(REPRESENTATIVE_PAGES)
            if viewport_name == "mobile-390":
                pages.append("youtube.html")
            for filename in pages:
                print(f"Rendering {filename} {viewport_name}...", flush=True)
                page = browser.new_page(viewport={"width": width, "height": height})
                if use_virtual_site:
                    def serve_local(route):
                        parsed=urlsplit(route.request.url)
                        if parsed.hostname != virtual_host:
                            route.abort()
                            return
                        relative=unquote(parsed.path).lstrip('/') or 'index.html'
                        target=(ROOT / relative).resolve()
                        try:
                            target.relative_to(ROOT.resolve())
                        except ValueError:
                            route.fulfill(status=403, body='Forbidden')
                            return
                        if target.is_dir():
                            target=target / 'index.html'
                        if not target.is_file():
                            route.fulfill(status=404, body='Not Found')
                            return
                        mime=mimetypes.guess_type(target.name)[0] or 'application/octet-stream'
                        route.fulfill(status=200, path=str(target), content_type=mime)
                    page.route('**/*', serve_local)
                page_errors: list[str] = []
                page.on("pageerror", lambda error, bucket=page_errors: bucket.append(str(error)))
                if use_virtual_site:
                    source=(ROOT / filename).read_text(encoding="utf-8")
                    source=source.replace("<head>", f'<head><base href="{base_url}/">', 1)
                    page.set_content(source, wait_until="domcontentloaded", timeout=10_000)
                    response = None
                    status = 200
                else:
                    response = page.goto(f"{base_url}/{filename}", wait_until="domcontentloaded", timeout=20_000)
                    status = response.status if response else 0
                page.wait_for_function(
                    """() => [...document.styleSheets].some(sheet => {
                      if(!sheet.href || !sheet.href.includes('/css/common.css')) return false;
                      try { return sheet.cssRules.length > 0; } catch { return false; }
                    })""",
                    timeout=5_000,
                )
                if filename == "links.html":
                    page.evaluate("document.documentElement.classList.add('light-mode')")
                page.wait_for_timeout(120)
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
                      })(),
                      officialIconMax: Math.max(0, ...[...document.querySelectorAll('[data-home-official-links] img')].map(img => Math.max(img.getBoundingClientRect().width, img.getBoundingClientRect().height))),
                      overflowElements: [...document.querySelectorAll('body *')].filter(el => {
                        const style=getComputedStyle(el);
                        if(style.display==='none'||style.visibility==='hidden'||style.position==='fixed'||el.closest('.ambient')||el.closest('.mobile-menu:not(.active)')) return false;
                        const r=el.getBoundingClientRect();
                        return r.width>1 && (r.left < -1 || r.right > innerWidth + 1);
                      }).slice(0,8).map(el => {
                        const r=el.getBoundingClientRect();
                        return {tag:el.tagName, cls:String(el.className||'').slice(0,80), left:Math.round(r.left), right:Math.round(r.right)};
                      })
                    })"""
                )
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
                    if metrics["officialIconMax"] > 56:
                        failures.append(f"index.html {viewport_name}: official icon too large ({metrics['officialIconMax']:.1f}px)")
                    if width < 1180:
                        page.click("#hamburger")
                        menu_state = page.evaluate(
                            """() => ({
                              active: document.querySelector('#mobileMenu')?.classList.contains('active'),
                              expanded: document.querySelector('#hamburger')?.getAttribute('aria-expanded'),
                              locked: getComputedStyle(document.body).overflow === 'hidden'
                            })"""
                        )
                        if not (menu_state["active"] and menu_state["expanded"] == "true" and menu_state["locked"]):
                            failures.append(f"index.html {viewport_name}: mobile menu contract failed: {menu_state}")
                        page.click("#menuBackdrop")

                if filename == "streaming.html" and width < 720 and metrics["overflowElements"]:
                    failures.append(f"streaming.html {viewport_name}: overflowing elements: {metrics['overflowElements']}")

                if filename == "links.html":
                    filters = page.locator(".link-filter")
                    for filter_index in range(filters.count()):
                        filters.nth(filter_index).click()
                        contrast = page.evaluate(
                            """() => {
                              const el=document.querySelector('.link-filter.active');
                              if(!el)return {ok:false,reason:'no active filter'};
                              const st=getComputedStyle(el);
                              const parse=v=>(v.match(/[\\d.]+/g)||[]).slice(0,3).map(Number);
                              const lum=rgb=>{const x=rgb.map(v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)});return .2126*x[0]+.7152*x[1]+.0722*x[2]};
                              const fg=parse(st.color), bg=parse(st.backgroundColor);
                              const ratio=(Math.max(lum(fg),lum(bg))+.05)/(Math.min(lum(fg),lum(bg))+.05);
                              return {ok:st.visibility!=='hidden'&&Number(st.opacity)>0&&(st.backgroundImage!=='none'||ratio>=3),ratio,color:st.color,background:st.backgroundColor,image:st.backgroundImage};
                            }"""
                        )
                        if not contrast["ok"]:
                            failures.append(f"links.html {viewport_name}: selected filter text invisible: {contrast}")

                screenshot = args.output / f"{filename.removesuffix('.html')}-{viewport_name}.png"
                page.screenshot(path=str(screenshot), full_page=False, animations="disabled")
                report.append(
                    {
                        "page": filename,
                        "viewport": viewport_name,
                        "width": width,
                        "height": height,
                        "httpStatus": status,
                        "metrics": metrics,
                        "pageErrors": page_errors,
                    }
                )
                page.close()
                print(f"Done {filename} {viewport_name}", flush=True)
            browser.close()

    (args.output / f"report-{args.viewport}.json").write_text(
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
