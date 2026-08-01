#!/usr/bin/env python3
"""Runtime fixes for Korean chart daily sources and chart dates.

This wrapper loads the existing sync-korean-charts.py module, replaces only the
Daily source adapters, and delegates all storage/retention logic to the original
implementation.
"""
from __future__ import annotations

import argparse
import importlib.util
import sys
from datetime import datetime, time, timedelta
from pathlib import Path
from typing import Any

BASE_PATH = Path(__file__).with_name("sync-korean-charts.py")
SPEC = importlib.util.spec_from_file_location("rescene_korean_chart_base", BASE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"同期本体を読み込めません: {BASE_PATH}")

BASE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BASE)


def previous_day_start(fetched_at: datetime) -> str:
    """Return 00:00 KST for the calendar day before the fetch."""
    local = fetched_at.astimezone(BASE.KST)
    target = local.date() - timedelta(days=1)
    return datetime.combine(target, time.min, tzinfo=BASE.KST).isoformat()


def result_date(result: Any) -> str:
    value = str(getattr(result, "chart_at", "") or "")
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(BASE.KST).date().isoformat()
    except ValueError:
        return ""


def expected_previous_date(fetched_at: datetime) -> str:
    return (fetched_at.astimezone(BASE.KST).date() - timedelta(days=1)).isoformat()


def fetch_genie_daily_fixed(chart: dict[str, Any], fetched_at: datetime):
    """Fetch Genie Daily through the common period endpoint with ditc=D."""
    endpoint = "https://app.genie.co.kr/chart/j_RankSongList.json"
    headers = {
        "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36",
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Origin": "https://www.genie.co.kr",
        "Referer": "https://www.genie.co.kr/chart/top200",
        "X-Requested-With": "XMLHttpRequest",
    }

    attempts = (
        {"ditc": "D"},
        {"ditc": "D", "pg": "1", "pgSize": "200"},
    )
    errors: list[str] = []

    for form in attempts:
        try:
            payload = BASE.request_json(
                endpoint,
                method="POST",
                headers=headers,
                form=form,
            )
            result = BASE.parse_genie(payload, chart, fetched_at)
            if not result.items:
                raise RuntimeError("Genie Daily returned no items")

            # Genie publishes the previous calendar day's Daily chart at noon.
            result.chart_at = previous_day_start(fetched_at)
            result.metadata.update(
                {
                    "period": "daily",
                    "periodCode": "D",
                    "endpoint": endpoint,
                    "publishedAt": "12:00 KST",
                    "chartDateRule": "previous-day",
                }
            )
            return result
        except Exception as exc:
            errors.append(f"{type(exc).__name__}: {exc}")

    raise RuntimeError(" / ".join(errors) or "Genie Daily returned no items")


def fetch_melon_daily_fixed(chart: dict[str, Any], fetched_at: datetime):
    result = BASE.fetch_melon_daily(chart, fetched_at)
    if not result.items:
        raise RuntimeError("Melon Daily returned no items")

    # Melon publishes the previous calendar day's Daily chart at 12:40.
    result.chart_at = previous_day_start(fetched_at)
    result.metadata.update(
        {
            "period": "daily",
            "publishedAt": "12:40 KST",
            "chartDateRule": "previous-day",
        }
    )
    return result


def fetch_bugs_daily_fixed(chart: dict[str, Any], fetched_at: datetime):
    result = BASE.fetch_bugs_daily(chart, fetched_at)
    if not result.items:
        raise RuntimeError("Bugs Daily returned no items")

    expected = expected_previous_date(fetched_at)
    actual = result_date(result)

    # Bugs normally provides its own chart date. Reject an older response rather
    # than relabeling stale rankings as the previous day's chart.
    if actual and actual != expected:
        raise RuntimeError(
            f"Bugs Dailyの公開日が未更新です: expected={expected}, actual={actual}"
        )

    if not actual:
        result.chart_at = previous_day_start(fetched_at)

    result.metadata.update(
        {
            "period": "daily",
            "publishedAt": "12:00 KST",
            "chartDateRule": "previous-day",
        }
    )
    return result


def install_fixes() -> None:
    BASE.FETCHERS["genie-daily"] = fetch_genie_daily_fixed
    BASE.FETCHERS["melon-daily"] = fetch_melon_daily_fixed
    BASE.FETCHERS["bugs-daily"] = fetch_bugs_daily_fixed


def self_test() -> int:
    sample = datetime(2026, 8, 2, 12, 50, tzinfo=BASE.KST)
    assert previous_day_start(sample) == "2026-08-01T00:00:00+09:00"
    assert expected_previous_date(sample) == "2026-08-01"
    install_fixes()
    assert BASE.FETCHERS["genie-daily"] is fetch_genie_daily_fixed
    assert BASE.FETCHERS["melon-daily"] is fetch_melon_daily_fixed
    assert BASE.FETCHERS["bugs-daily"] is fetch_bugs_daily_fixed
    print("Korean chart daily wrapper self-test passed.")
    return 0


def main() -> int:
    if "--self-test" in sys.argv:
        return self_test()

    install_fixes()
    return int(BASE.main())


if __name__ == "__main__":
    raise SystemExit(main())
