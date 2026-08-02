#!/usr/bin/env python3
"""Record how the Korean-chart workflow was triggered.

This makes it possible to distinguish a scheduled run from a manual or push run
by reading data/korean-chart-sync-status.json.
"""
from __future__ import annotations

import argparse
import json
import os
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
STATUS_PATH = ROOT / "data" / "korean-chart-sync-status.json"
KST = ZoneInfo("Asia/Seoul")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--charts", default="")
    args = parser.parse_args()

    if not STATUS_PATH.exists():
        raise RuntimeError(f"同期ステータスがありません: {STATUS_PATH}")

    data = json.loads(STATUS_PATH.read_text(encoding="utf-8"))
    event_name = os.getenv("RUN_EVENT_NAME", "").strip()
    event_schedule = os.getenv("RUN_EVENT_SCHEDULE", "").strip()
    charts = [item.strip() for item in args.charts.split(",") if item.strip()]

    data["automation"] = {
        "eventName": event_name,
        "scheduled": event_name == "schedule",
        "schedule": event_schedule,
        "resolvedCharts": charts,
        "runId": os.getenv("RUN_ID", "").strip(),
        "runNumber": os.getenv("RUN_NUMBER", "").strip(),
        "runAttempt": os.getenv("RUN_ATTEMPT", "").strip(),
        "sha": os.getenv("RUN_SHA", "").strip(),
        "completedAt": datetime.now(KST).replace(microsecond=0).isoformat(),
    }

    temporary = STATUS_PATH.with_suffix(".json.tmp")
    temporary.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(STATUS_PATH)

    print(
        "実行情報記録: "
        f"event={event_name or '-'} "
        f"schedule={event_schedule or '-'} "
        f"charts={','.join(charts) or '-'}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
