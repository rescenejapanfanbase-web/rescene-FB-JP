#!/usr/bin/env python3
"""Recover missed critical GitHub Actions schedules.

The target workflows already retry internally. This watchdog adds independent
checks at +30/+35 and +50 minutes and dispatches a critical workflow only when
no successful/active run exists for the expected JST slot.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

TOKEN = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
REPOSITORY = os.environ.get("GITHUB_REPOSITORY", "")
BRANCH = os.environ.get("GITHUB_REF_NAME") or os.environ.get("WATCHDOG_BRANCH") or "main"
DRY_RUN = os.environ.get("WATCHDOG_DRY_RUN", "").lower() in {"1", "true", "yes"}
JST = dt.timezone(dt.timedelta(hours=9))
NOW = dt.datetime.now(JST)

if not TOKEN or "/" not in REPOSITORY:
    raise SystemExit("GH_TOKEN/GITHUB_REPOSITORY が設定されていません。")

# Only slots explicitly requested as must-run are watched.
SLOTS = [
    ("sync-youtube-critical.yml", "YouTube", {0: 5, 18: 5, 20: 5, 22: 5}),
    ("sync-schedule-critical.yml", "Schedule", {6: 0, 18: 0}),
    ("sync-all-content-critical.yml", "Other content", {7: 5, 13: 5, 19: 5, 23: 5}),
]


def api(method: str, path: str, body: dict | None = None) -> dict:
    url = f"https://api.github.com/repos/{REPOSITORY}{path}"
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "rescene-critical-sync-watchdog",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")
        raise RuntimeError(f"GitHub API {error.code}: {detail}") from error


def parse_utc(value: str) -> dt.datetime:
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))


def due_targets() -> list[tuple[str, str, dt.datetime]]:
    targets = []
    for workflow, label, hours in SLOTS:
        for hour, minute in hours.items():
            expected = NOW.replace(hour=hour, minute=minute, second=0, microsecond=0)
            age = (NOW - expected).total_seconds() / 60
            # At +20 through +75 min, a watchdog invocation can recover the slot.
            if 20 <= age <= 75:
                targets.append((workflow, label, expected))
    return targets


def has_healthy_run(workflow: str, expected: dt.datetime) -> tuple[bool, str]:
    encoded = urllib.parse.quote(workflow, safe="")
    query = urllib.parse.urlencode({"branch": BRANCH, "per_page": 30})
    result = api("GET", f"/actions/workflows/{encoded}/runs?{query}")
    threshold = expected.astimezone(dt.timezone.utc) - dt.timedelta(minutes=7)
    candidates = []
    for run in result.get("workflow_runs", []):
        created = parse_utc(run.get("created_at", "1970-01-01T00:00:00Z"))
        if created < threshold:
            continue
        candidates.append(run)
    if not candidates:
        return False, "expected slot 이후の実行なし"
    candidates.sort(key=lambda run: run.get("created_at", ""), reverse=True)
    latest = candidates[0]
    status = latest.get("status")
    conclusion = latest.get("conclusion")
    healthy = status in {"queued", "in_progress", "waiting", "pending"} or conclusion == "success"
    return healthy, f"latest={latest.get('html_url', '')} status={status} conclusion={conclusion}"


def dispatch(workflow: str) -> None:
    encoded = urllib.parse.quote(workflow, safe="")
    if DRY_RUN:
        print(f"[DRY RUN] dispatch {workflow} ref={BRANCH}")
        return
    api("POST", f"/actions/workflows/{encoded}/dispatches", {"ref": BRANCH})
    print(f"dispatched {workflow} ref={BRANCH}")


def main() -> int:
    targets = due_targets()
    if not targets:
        print(f"監視対象の重要枠はありません: {NOW.isoformat()}")
        return 0
    failures = 0
    for workflow, label, expected in targets:
        try:
            healthy, detail = has_healthy_run(workflow, expected)
            print(f"{label} {expected:%Y-%m-%d %H:%M JST}: {detail}")
            if not healthy:
                dispatch(workflow)
        except Exception as error:  # Keep checking other independent targets.
            failures += 1
            print(f"ERROR {label}: {error}", file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
