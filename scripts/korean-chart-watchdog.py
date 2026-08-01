#!/usr/bin/env python3
"""Recover missed or failed Korean chart sources without touching chart data directly."""
from __future__ import annotations

import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

TOKEN = os.getenv("GH_TOKEN", "").strip()
REPOSITORY = os.getenv("GITHUB_REPOSITORY", "").strip()
BRANCH = os.getenv("WATCHDOG_BRANCH", "main").strip() or "main"
DRY_RUN = os.getenv("WATCHDOG_DRY_RUN", "false").lower() in {"1", "true", "yes"}
WORKFLOW = "sync-korean-charts.yml"
TARGET_CHARTS = [item.strip() for item in os.getenv("WATCHDOG_CHARTS", "melon,genie,bugs,flo").split(",") if item.strip()]
FRESH_SUCCESS_MINUTES = int(os.getenv("WATCHDOG_FRESH_MINUTES", "100") or 100)
ACTIVE_RUN_MINUTES = 90
ROOT = Path(__file__).resolve().parents[1]
PUBLIC_PATH = ROOT / "data" / "korean-charts.json"


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
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return None


def age_minutes(value: str | None, now: datetime) -> float:
    parsed = parse_time(value)
    return (now - parsed).total_seconds() / 60 if parsed else 10**9


def stale_sources(now: datetime) -> list[str]:
    try:
        payload = json.loads(PUBLIC_PATH.read_text(encoding="utf-8"))
    except Exception:
        return list(TARGET_CHARTS)
    statuses = payload.get("sourceStatus") or {}
    stale = []
    for chart_id in TARGET_CHARTS:
        status = statuses.get(chart_id) or {}
        fresh = status.get("ok") is True and age_minutes(status.get("lastSuccessAt"), now) <= FRESH_SUCCESS_MINUTES
        if not fresh:
            stale.append(chart_id)
    return stale


def main() -> int:
    if not TOKEN or not REPOSITORY:
        print("GH_TOKEN または GITHUB_REPOSITORY が未設定です。", file=sys.stderr)
        return 2
    now = datetime.now(timezone.utc)
    stale = stale_sources(now)
    if not stale:
        print(f"正常: {','.join(TARGET_CHARTS)} は直近{FRESH_SUCCESS_MINUTES}分以内に正常取得済みです。")
        return 0

    query = urllib.parse.urlencode({"branch": BRANCH, "per_page": 20})
    payload = api(f"/actions/workflows/{WORKFLOW}/runs?{query}")
    runs = payload.get("workflow_runs") or []
    active = next((run for run in runs if run.get("status") in {"queued", "in_progress", "waiting", "requested", "pending"} and age_minutes(run.get("created_at"), now) <= ACTIVE_RUN_MINUTES), None)
    if active:
        print(f"待機: 同期が実行中または待機中です run={active.get('id')} status={active.get('status')}")
        return 0

    requested = ",".join(stale)
    reason = f"再取得対象={requested}"
    if DRY_RUN:
        print(f"DRY RUN: {reason}")
        return 0
    api(f"/actions/workflows/{WORKFLOW}/dispatches", method="POST", body={"ref": BRANCH, "inputs": {"charts": requested}})
    print(f"復旧実行をdispatchしました。{reason}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
