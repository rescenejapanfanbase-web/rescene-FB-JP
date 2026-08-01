#!/usr/bin/env python3
"""Runtime fixes for Korean chart Daily sources, dates, and history indexing."""
from __future__ import annotations

import importlib.util
import sys
from datetime import datetime, time, timedelta
from pathlib import Path
from typing import Any

import korean_chart_core as CORE

BASE_PATH = Path(__file__).with_name("sync-korean-charts.py")
SPEC = importlib.util.spec_from_file_location("rescene_korean_chart_base", BASE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"同期本体を読み込めません: {BASE_PATH}")

BASE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BASE)
ROOT = Path(__file__).resolve().parents[1]


def previous_day_start(fetched_at: datetime) -> str:
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


def genie_rows(payload: Any) -> list[dict[str, Any]]:
    root = BASE.first_dict_with_key(payload, "DataSet") or (payload if isinstance(payload, dict) else {})
    dataset = root.get("DataSet") or {}
    rows = dataset.get("DATA") or dataset.get("data") or []
    return [row for row in rows if isinstance(row, dict)]


def fetch_genie_daily_page(endpoint: str, headers: dict[str, str], page: int) -> Any:
    forms = (
        {"ditc": "D", "pg": str(page), "pgSize": "25"},
        {"ditc": "D", "pg": str(page)},
        {"ditc": "D", "page": str(page), "pgSize": "25"},
    )
    errors: list[str] = []
    best_payload: Any = None
    best_count = -1
    for form in forms:
        try:
            payload = BASE.request_json(
                endpoint,
                method="POST",
                headers=headers,
                form=form,
            )
            count = len(genie_rows(payload))
            if count > best_count:
                best_payload = payload
                best_count = count
            if count:
                return payload
            errors.append(f"empty form={form}")
        except Exception as exc:
            errors.append(f"{type(exc).__name__}: {exc}")
    if best_payload is not None:
        return best_payload
    raise RuntimeError(" / ".join(errors[-3:]) or f"Genie Daily page {page} returned no items")


def normalize_genie_page_items(items: list[dict[str, Any]], page: int, page_size: int) -> list[dict[str, Any]]:
    normalized=[]
    for index,item in enumerate(items,1):
        row=dict(item)
        rank=BASE.safe_int(row.get("rank"))
        if page>1 and rank is not None and rank<=page_size:
            row["rank"]=(page-1)*page_size+rank
        elif rank is None:
            row["rank"]=(page-1)*page_size+index
        normalized.append(row)
    return normalized


def fetch_genie_daily_fixed(chart: dict[str, Any], fetched_at: datetime):
    endpoint = "https://app.genie.co.kr/chart/j_RankSongList.json"
    headers = {
        "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36",
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Origin": "https://www.genie.co.kr",
        "Referer": "https://www.genie.co.kr/chart/top200",
        "X-Requested-With": "XMLHttpRequest",
    }
    max_rank = int(chart.get("maxRank") or 200)
    page_size = 25
    max_pages = max(1, (max_rank + page_size - 1) // page_size)
    merged: list[dict[str, Any]] = []
    seen: set[str] = set()
    native_time = ""
    page_counts: list[int] = []

    for page in range(1, max_pages + 1):
        payload = fetch_genie_daily_page(endpoint, headers, page)
        result = BASE.parse_genie(payload, chart, fetched_at)
        native_time = native_time or str(result.metadata.get("nativeTime") or "")
        page_items = normalize_genie_page_items(result.items, page, page_size)
        new_count = 0
        for item in page_items:
            identity = str(item.get("id") or "").strip()
            if not identity:
                identity = f"{CORE.compact(item.get('title'))}:{CORE.compact(item.get('artist'))}"
            if not identity or identity in seen:
                continue
            seen.add(identity)
            if 1 <= int(item.get("rank") or 0) <= max_rank:
                merged.append(item)
                new_count += 1
        page_counts.append(new_count)
        if not page_items or new_count == 0 or len(merged) >= max_rank:
            break

    merged.sort(key=lambda item: int(item.get("rank") or 9999))
    merged = merged[:max_rank]
    minimum = min(100, max_rank)
    if len(merged) < minimum:
        raise RuntimeError(
            f"Genie Dailyの取得件数が不足しています: {len(merged)}件（最低{minimum}件）"
        )

    return BASE.SourceResult(
        chart["id"],
        previous_day_start(fetched_at),
        merged,
        {
            "nativeTime": native_time,
            "period": "daily",
            "periodCode": "D",
            "endpoint": endpoint,
            "publishedAt": "12:00 KST",
            "chartDateRule": "previous-day",
            "pageSize": page_size,
            "pageCount": len(page_counts),
            "pageItemCounts": page_counts,
            "total": len(merged),
        },
    )


def fetch_melon_daily_fixed(chart: dict[str, Any], fetched_at: datetime):
    result = BASE.fetch_melon_daily(chart, fetched_at)
    if not result.items:
        raise RuntimeError("Melon Daily returned no items")
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


def repair_public_history_index() -> None:
    public = BASE.load_json(BASE.PUBLIC_PATH, {})
    config = BASE.load_json(BASE.CONFIG_PATH, {})
    if not isinstance(public, dict) or not isinstance(config, dict):
        return

    old_entries = {
        (entry.get("songId"), entry.get("chartId")): dict(entry)
        for entry in public.get("entries", [])
        if isinstance(entry, dict)
    }
    rebuilt: list[dict[str, Any]] = []

    for chart in config.get("charts", []):
        if not chart.get("published", True):
            continue
        for song in config.get("songs", []):
            if not song.get("published", True) or chart.get("id") not in song.get("charts", []):
                continue
            key = (song["id"], chart["id"])
            entry = old_entries.get(key) or CORE.make_entry(song, chart)
            path = CORE.history_path(ROOT, song["id"], chart["id"])
            history = BASE.load_json(path, {})
            points = history.get("points", []) if isinstance(history, dict) else []
            stats = CORE.summarize_history(points)
            entry.update(
                {
                    "songId": song["id"],
                    "songTitle": song["title"],
                    "chartId": chart["id"],
                    "chartName": chart["name"],
                    **stats,
                    "historyPath": f"data/korean-chart-history/{song['id']}--{chart['id']}.json",
                }
            )
            if not old_entries.get(key):
                entry["status"] = "out" if stats.get("firstChartedAt") else "untracked"
            rebuilt.append(entry)

    public["entries"] = rebuilt
    checked_at = str(public.get("generatedAt") or CORE.iso_kst())
    public = CORE.finalize_public_payload(public, config, checked_at)
    CORE.atomic_write_json(BASE.PUBLIC_PATH, public)
    BASE.PUBLIC_JS_PATH.write_text(
        CORE.json_to_js("RESCENE_KOREAN_CHARTS", public),
        encoding="utf-8",
    )


def self_test() -> int:
    sample = datetime(2026, 8, 2, 12, 50, tzinfo=BASE.KST)
    assert previous_day_start(sample) == "2026-08-01T00:00:00+09:00"
    assert expected_previous_date(sample) == "2026-08-01"

    original_request = BASE.request_json
    try:
        def fake_request(url: str, **kwargs):
            form = kwargs.get("form") or {}
            page = int(form.get("pg") or form.get("page") or 1)
            start = (page - 1) * 25 + 1
            rows = [
                {
                    "SONG_ID": f"song-{rank}",
                    "RANK_NO": rank,
                    "PRE_RANK_NO": rank,
                    "SONG_NAME": f"Song {rank}",
                    "ARTIST_NAME": "Artist",
                }
                for rank in range(start, min(start + 25, 201))
            ]
            return {
                "PageInfo": {"ChartTime": "12:00"},
                "DataSet": {"DATA": rows},
            }

        BASE.request_json = fake_request
        result = fetch_genie_daily_fixed(
            {"id": "genie-daily", "maxRank": 200, "cadence": "daily"},
            sample,
        )
        assert len(result.items) == 200
        assert result.items[0]["rank"] == 1
        assert result.items[-1]["rank"] == 200
        assert result.chart_at == "2026-08-01T00:00:00+09:00"
    finally:
        BASE.request_json = original_request

    install_fixes()
    assert BASE.FETCHERS["genie-daily"] is fetch_genie_daily_fixed
    print("Korean chart fixed wrapper self-test passed.")
    return 0


def main() -> int:
    if "--self-test" in sys.argv:
        return self_test()

    install_fixes()
    result = int(BASE.main())
    if result == 0:
        repair_public_history_index()
    return result


if __name__ == "__main__":
    raise SystemExit(main())
