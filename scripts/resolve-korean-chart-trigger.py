#!/usr/bin/env python3
"""Resolve which Korean charts are due during the working news-sync workflow.

The repository's dedicated chart cron is not firing reliably. This resolver is
called after each successful Sync Notion News run and only returns sources that
are stale or whose new publication should already be available.
"""
from __future__ import annotations

import json
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any

KST = timezone(timedelta(hours=9))
ROOT = Path(__file__).resolve().parents[1]
STATUS_PATH = ROOT / "data" / "korean-chart-sync-status.json"

REALTIME = ("melon", "genie", "bugs", "flo")


def parse_datetime(value: Any) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=KST)
    return parsed.astimezone(KST)


def age_minutes(value: Any, now: datetime) -> float:
    parsed = parse_datetime(value)
    if parsed is None:
        return 10**9
    return max(0.0, (now - parsed).total_seconds() / 60.0)


def chart_date(status: dict[str, Any]) -> date | None:
    parsed = parse_datetime(status.get("chartAt"))
    return parsed.date() if parsed else None


def after(now: datetime, hour: int, minute: int) -> bool:
    return now.timetz().replace(tzinfo=None) >= time(hour, minute)


def load_status() -> dict[str, Any]:
    try:
        payload = json.loads(STATUS_PATH.read_text(encoding="utf-8"))
        return payload if isinstance(payload, dict) else {}
    except Exception:
        return {}


def main() -> int:
    now = datetime.now(KST)
    payload = load_status()
    statuses = payload.get("sourceStatus") or {}
    due: list[str] = []

    # Realtime charts: synchronize together when any source has not succeeded
    # in the past 50 minutes. The working news workflow runs roughly every
    # 30 minutes, so this produces approximately hourly chart observations.
    realtime_stale = any(
        (statuses.get(chart_id) or {}).get("ok") is not True
        or age_minutes((statuses.get(chart_id) or {}).get("lastSuccessAt"), now) >= 50
        for chart_id in REALTIME
    )
    if realtime_stale:
        due.extend(REALTIME)

    expected_daily = now.date() - timedelta(days=1)

    # Genie and Bugs publish the previous day's Daily chart at noon.
    if after(now, 12, 10):
        for chart_id in ("genie-daily", "bugs-daily"):
            status = statuses.get(chart_id) or {}
            if status.get("ok") is not True or chart_date(status) != expected_daily:
                due.append(chart_id)

    # Melon publishes the previous day's Daily chart at 12:40.
    if after(now, 12, 50):
        status = statuses.get("melon-daily") or {}
        if status.get("ok") is not True or chart_date(status) != expected_daily:
            due.append("melon-daily")

    # Daily sources that represent the current calendar date.
    if after(now, 7, 10):
        status = statuses.get("vibe") or {}
        if status.get("ok") is not True or chart_date(status) != now.date():
            due.append("vibe")

    if after(now, 10, 20):
        status = statuses.get("spotify-kr") or {}
        if status.get("ok") is not True or chart_date(status) != now.date():
            due.append("spotify-kr")

    # YouTube is weekly. Check once per day after its expected update window;
    # repeated news runs do not refetch it when the last success is recent.
    if after(now, 11, 30):
        status = statuses.get("youtube-kr") or {}
        if status.get("ok") is not True or age_minutes(status.get("lastSuccessAt"), now) >= 20 * 60:
            due.append("youtube-kr")

    # Preserve order and remove duplicates.
    unique = list(dict.fromkeys(due))
    print(",".join(unique))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
