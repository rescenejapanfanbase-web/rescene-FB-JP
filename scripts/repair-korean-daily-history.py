#!/usr/bin/env python3
"""Remove Daily observations that were stored before their source publication.

A Daily point for date D is valid only after D+1 at the service's publication
time. Guyso historical backfill points are retained. Public entries and
summaries are rebuilt from the remaining validated observations.
"""
from __future__ import annotations

from datetime import datetime, time, timedelta
from pathlib import Path
from typing import Any

from korean_chart_core import (
    KST,
    atomic_write_json,
    finalize_public_payload,
    iso_kst,
    json_to_js,
    load_json,
    safe_int,
    summarize_history,
)

ROOT = Path(__file__).resolve().parents[1]
HISTORY_DIR = ROOT / "data" / "korean-chart-history"
PUBLIC_PATH = ROOT / "data" / "korean-charts.json"
PUBLIC_JS_PATH = ROOT / "data" / "korean-charts-data.js"
CONFIG_PATH = ROOT / "data" / "korean-chart-config.json"

PUBLICATION_TIMES = {
    "melon-daily": time(12, 40),
    "genie-daily": time(12, 0),
    "bugs-daily": time(12, 0),
}


def parse_datetime(value: Any) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=KST)
        return parsed.astimezone(KST)
    except ValueError:
        return None


def valid_point(point: dict[str, Any], chart_id: str) -> bool:
    if str(point.get("origin") or "").startswith("guyso"):
        return True

    chart_at = parse_datetime(point.get("chartAt"))
    checked_at = parse_datetime(point.get("checkedAt"))
    if chart_at is None or checked_at is None:
        # Unknown automatic points cannot be source-validated.
        return False

    publication_day = chart_at.date() + timedelta(days=1)
    publication_at = datetime.combine(
        publication_day,
        PUBLICATION_TIMES[chart_id],
        tzinfo=KST,
    )
    return checked_at >= publication_at


def rebuild_outages(points: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ranges: list[dict[str, Any]] = []
    for point in sorted(points, key=lambda row: str(row.get("chartAt") or "")):
        rank = safe_int(point.get("rank"))
        chart_at = str(point.get("chartAt") or "")
        checked_at = str(point.get("checkedAt") or "")
        if rank is None:
            if ranges and not ranges[-1].get("endAt"):
                ranges[-1]["lastObservedAt"] = chart_at
                ranges[-1]["lastCheckedAt"] = checked_at
                ranges[-1]["observations"] = int(ranges[-1].get("observations") or 0) + 1
            else:
                ranges.append({
                    "startAt": chart_at,
                    "endAt": "",
                    "lastObservedAt": chart_at,
                    "lastCheckedAt": checked_at,
                    "observations": 1,
                })
        elif ranges and not ranges[-1].get("endAt"):
            ranges[-1]["endAt"] = chart_at
            ranges[-1]["lastCheckedAt"] = checked_at
    return ranges


def movement_from(previous: int | None, current: int | None, had_history: bool) -> tuple[int | None, str, str]:
    if current is None:
        return None, "stay-out" if previous is None else "out", "out"
    if previous is None:
        return None, "reentry" if had_history else "new", "in"
    movement = previous - current
    return movement, "up" if movement > 0 else "down" if movement < 0 else "same", "in"


def main() -> int:
    config = load_json(CONFIG_PATH, {})
    public = load_json(PUBLIC_PATH, {})
    if not isinstance(config, dict) or not isinstance(public, dict):
        raise RuntimeError("韓国チャート設定または公開データを読み込めません。")

    entries = {
        (entry.get("songId"), entry.get("chartId")): dict(entry)
        for entry in public.get("entries", [])
        if isinstance(entry, dict)
    }

    removed_total = 0
    repaired_files = 0

    for chart_id in PUBLICATION_TIMES:
        for path in sorted(HISTORY_DIR.glob(f"*--{chart_id}.json")):
            history = load_json(path, {})
            if not isinstance(history, dict):
                continue
            original = [
                point for point in history.get("points", [])
                if isinstance(point, dict)
            ]
            retained = [point for point in original if valid_point(point, chart_id)]
            removed = len(original) - len(retained)
            if not removed:
                continue

            retained.sort(key=lambda row: str(row.get("chartAt") or ""))
            history["points"] = retained
            history["outOfChartHistory"] = rebuild_outages(retained)
            stats = summarize_history(retained)
            ranked = [point for point in retained if safe_int(point.get("rank")) is not None]
            current = safe_int(retained[-1].get("rank")) if retained else None
            previous = safe_int(retained[-2].get("rank")) if len(retained) >= 2 else None
            movement, movement_type, status = movement_from(
                previous,
                current,
                bool(ranked[:-1]),
            )
            last = retained[-1] if retained else {}

            history["summary"] = {
                **stats,
                "currentRank": current,
                "status": status,
                "pointCount": len(retained),
            }
            history["generatedAt"] = iso_kst()
            atomic_write_json(path, history)

            key = (history.get("songId"), chart_id)
            entry = entries.get(key)
            if entry:
                entry.update({
                    **stats,
                    "currentRank": current,
                    "previousRank": previous,
                    "movement": movement,
                    "movementType": movement_type,
                    "status": status,
                    "outOfChartCount": len(history.get("outOfChartHistory", [])),
                    "outOfChartHistory": history.get("outOfChartHistory", [])[-20:],
                    "chartAt": str(last.get("chartAt") or ""),
                    "lastCheckedAt": str(last.get("checkedAt") or ""),
                })
                entries[key] = entry

            removed_total += removed
            repaired_files += 1
            print(f"[REPAIR] {path.name}: 不正観測{removed}点を削除")

    public["entries"] = list(entries.values())
    checked_at = iso_kst()
    finalize_public_payload(public, config, checked_at)
    atomic_write_json(PUBLIC_PATH, public)
    PUBLIC_JS_PATH.write_text(
        json_to_js("RESCENE_KOREAN_CHARTS", public),
        encoding="utf-8",
    )

    print(f"Daily履歴修復完了: {repaired_files}ファイル / {removed_total}点削除")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
