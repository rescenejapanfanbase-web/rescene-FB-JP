#!/usr/bin/env python3
"""Recover a missed/failed Korean chart workflow without touching chart data directly."""
from __future__ import annotations

import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone

TOKEN = os.getenv("GH_TOKEN", "").strip()
REPOSITORY = os.getenv("GITHUB_REPOSITORY", "").strip()
BRANCH = os.getenv("WATCHDOG_BRANCH", "main").strip() or "main"
DRY_RUN = os.getenv("WATCHDOG_DRY_RUN", "false").lower() in {"1", "true", "yes"}
WORKFLOW = "sync-korean-charts.yml"
FRESH_SUCCESS_MINUTES = 100
ACTIVE_RUN_MINUTES = 90


def api(path: str, *, method: str = "GET", body=None):
    url = f"https://api.github.com/repos/{REPOSITORY}{path}"
    data = json.dumps(body).encode() if body is not None else None
    headers = {
        "Authorization": f"Bearer {TOKEN}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "rescene-korean-chart-watchdog",
    }
    request = urllib.request.Request(url, method=method, headers=headers, data=data)
    with urllib.request.urlopen(request, timeout=25) as response:
        raw = response.read().decode("utf-8")
        return json.loads(raw) if raw else {}


def parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def age_minutes(value: str | None, now: datetime) -> float:
    parsed = parse_time(value)
    return (now - parsed).total_seconds() / 60 if parsed else 10**9


def main() -> int:
    if not TOKEN or not REPOSITORY:
        print("GH_TOKEN または GITHUB_REPOSITORY が未設定です。", file=sys.stderr)
        return 2
    query = urllib.parse.urlencode({"branch": BRANCH, "per_page": 20})
    payload = api(f"/actions/workflows/{WORKFLOW}/runs?{query}")
    runs = payload.get("workflow_runs") or []
    now = datetime.now(timezone.utc)
    recent_success = next((run for run in runs if run.get("status") == "completed" and run.get("conclusion") == "success" and age_minutes(run.get("updated_at"), now) <= FRESH_SUCCESS_MINUTES), None)
    if recent_success:
        print(f"正常: 直近{FRESH_SUCCESS_MINUTES}分以内に成功済み run={recent_success.get('id')}")
        return 0
    active = next((run for run in runs if run.get("status") in {"queued", "in_progress", "waiting", "requested", "pending"} and age_minutes(run.get("created_at"), now) <= ACTIVE_RUN_MINUTES), None)
    if active:
        print(f"待機: 同期が実行中または待機中です run={active.get('id')} status={active.get('status')}")
        return 0
    latest = runs[0] if runs else {}
    reason = "実行履歴なし" if not runs else f"最新run={latest.get('id')} status={latest.get('status')} conclusion={latest.get('conclusion')} age={age_minutes(latest.get('updated_at') or latest.get('created_at'), now):.1f}分"
    if DRY_RUN:
        print(f"DRY RUN: 再実行対象です。{reason}")
        return 0
    api(f"/actions/workflows/{WORKFLOW}/dispatches", method="POST", body={"ref": BRANCH})
    print(f"復旧実行をdispatchしました。{reason}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
