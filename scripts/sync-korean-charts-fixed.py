#!/usr/bin/env python3
"""Safe Daily-chart adapters for RESCENE Korean chart synchronization.

Daily charts are fetched from each service's public Daily page. A result is
published only when the page itself contains the expected chart date and a
complete-enough ranking. The adapter never relabels a real-time or stale result
as the previous day's Daily chart.
"""
from __future__ import annotations

import importlib.util
import re
import sys
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Any, Iterable

from bs4 import BeautifulSoup

BASE_PATH = Path(__file__).with_name("sync-korean-charts.py")
SPEC = importlib.util.spec_from_file_location("rescene_korean_chart_base", BASE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"同期本体を読み込めません: {BASE_PATH}")

BASE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BASE)
ROOT = Path(__file__).resolve().parents[1]

BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/150.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,ja;q=0.8,en;q=0.6",
    "Cache-Control": "no-cache",
}


def expected_daily_date(fetched_at: datetime) -> date:
    return fetched_at.astimezone(BASE.KST).date() - timedelta(days=1)


def daily_chart_at(target: date) -> str:
    return datetime.combine(target, time.min, tzinfo=BASE.KST).isoformat()


def request_html(url: str, *, referer: str) -> str:
    headers = {**BROWSER_HEADERS, "Referer": referer}
    raw = BASE.http_request(url, headers=headers)
    return raw.decode("utf-8", errors="replace")


def normalized_space(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def target_date_is_present(html: str, target: date) -> bool:
    """Require the public page itself to identify the expected chart date."""
    text = normalized_space(BeautifulSoup(html, "html.parser").get_text(" ", strip=True))
    variants = {
        target.strftime("%Y.%m.%d"),
        target.strftime("%Y-%m-%d"),
        target.strftime("%Y/%m/%d"),
        target.strftime("%Y%m%d"),
        f"{target.year}년 {target.month:02d}월 {target.day:02d}일",
        f"{target.year}년 {target.month}월 {target.day}일",
    }
    compact_text = re.sub(r"\s+", "", text)
    return any(value in text or re.sub(r"\s+", "", value) in compact_text for value in variants)


def node_text(row: Any, selectors: Iterable[str]) -> str:
    for selector in selectors:
        node = row.select_one(selector)
        if node:
            value = normalized_space(node.get_text(" ", strip=True))
            if value:
                return value
    return ""


def rank_from_row(row: Any, selectors: Iterable[str]) -> int | None:
    for selector in selectors:
        node = row.select_one(selector)
        if not node:
            continue
        text = normalized_space(node.get_text(" ", strip=True))
        match = re.search(r"(?<!\d)(\d{1,3})(?!\d)", text)
        if match:
            rank = int(match.group(1))
            if 1 <= rank <= 200:
                return rank
    return None


def id_from_row(row: Any) -> str:
    values: list[str] = []
    for element in [row, *row.find_all(True)]:
        for key, raw in (getattr(element, "attrs", {}) or {}).items():
            if isinstance(raw, (list, tuple)):
                values.extend(str(item) for item in raw)
            else:
                values.append(str(raw))
    joined = " ".join(values)
    patterns = (
        r"(?:songId|songid|trackId|trackid|song_no|songNo)[^0-9]{0,20}(\d{5,})",
        r"(?:playSong|playTrack|fnPlaySong)[^0-9]{0,30}(\d{5,})",
        r"\b(\d{6,})\b",
    )
    for pattern in patterns:
        match = re.search(pattern, joined, flags=re.I)
        if match:
            return match.group(1)
    return ""


def unique_sorted_items(items: list[dict[str, Any]], max_rank: int) -> list[dict[str, Any]]:
    by_rank: dict[int, dict[str, Any]] = {}
    identities: set[str] = set()
    for item in items:
        rank = BASE.safe_int(item.get("rank"))
        title = normalized_space(item.get("title"))
        artist = normalized_space(item.get("artist"))
        if rank is None or not (1 <= rank <= max_rank) or not title:
            continue
        identity = str(item.get("id") or "").strip()
        if not identity:
            identity = f"{BASE.compact(title)}::{BASE.compact(artist)}"
        if not identity or identity in identities or rank in by_rank:
            continue
        identities.add(identity)
        by_rank[rank] = {
            "id": str(item.get("id") or ""),
            "rank": rank,
            "title": title,
            "artist": artist,
        }
    return [by_rank[key] for key in sorted(by_rank)]


def parse_melon_daily_html(html: str) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html, "html.parser")
    rows = soup.select("tr.lst50, tr.lst100")
    if not rows:
        rows = soup.select("table tbody tr")
    items: list[dict[str, Any]] = []
    for row in rows:
        rank = rank_from_row(row, (".rank", "span.rank", "td:nth-of-type(2)"))
        title = node_text(row, (".ellipsis.rank01 a", ".rank01 a", "a[href*='song/detail']"))
        artist = node_text(row, (".ellipsis.rank02 a", ".rank02 a", ".ellipsis.rank02"))
        if rank is not None and title:
            items.append({
                "id": str(row.get("data-song-no") or id_from_row(row)),
                "rank": rank,
                "title": title,
                "artist": artist,
            })
    return unique_sorted_items(items, 100)


def parse_genie_daily_html(html: str, *, page: int, page_size: int = 50) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html, "html.parser")
    rows = soup.select("tr.list")
    if not rows:
        rows = soup.select("table.list-wrap tbody tr, table tbody tr")
    items: list[dict[str, Any]] = []
    for index, row in enumerate(rows, 1):
        rank = rank_from_row(row, (".number", "td.number", ".rank"))
        title = node_text(row, ("a.title.ellipsis", ".info .title", ".title.ellipsis"))
        artist = node_text(row, ("a.artist.ellipsis", ".info .artist", ".artist.ellipsis"))
        if rank is not None and page > 1 and rank <= page_size:
            rank = (page - 1) * page_size + rank
        if rank is None:
            rank = (page - 1) * page_size + index
        if title:
            items.append({
                "id": str(row.get("songid") or row.get("song-id") or id_from_row(row)),
                "rank": rank,
                "title": title,
                "artist": artist,
            })
    return unique_sorted_items(items, 200)


def parse_bugs_daily_html(html: str) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html, "html.parser")
    rows = soup.select("table.list.trackList tbody tr")
    if not rows:
        rows = soup.select("table tbody tr")
    items: list[dict[str, Any]] = []
    for row in rows:
        rank = rank_from_row(row, (".ranking strong", "td.ranking strong", ".rank"))
        title = node_text(row, ("p.title a", ".title a", "a.trackInfo"))
        artist = node_text(row, ("p.artist a", ".artist a", "p.artist"))
        if rank is not None and title:
            items.append({
                "id": str(row.get("trackid") or row.get("track-id") or id_from_row(row)),
                "rank": rank,
                "title": title,
                "artist": artist,
            })
    return unique_sorted_items(items, 100)


def assert_complete(chart_name: str, items: list[dict[str, Any]], minimum: int) -> None:
    if len(items) < minimum:
        raise RuntimeError(
            f"{chart_name}の取得件数が不足しています: {len(items)}件（最低{minimum}件）"
        )


def fetch_melon_daily_fixed(chart: dict[str, Any], fetched_at: datetime):
    target = expected_daily_date(fetched_at)
    url = (
        "https://www.melon.com/chart/day/index.htm"
        f"?chartSearchData={target.strftime('%Y%m%d')}"
    )
    html = request_html(url, referer="https://www.melon.com/chart/day/index.htm")
    if not target_date_is_present(html, target):
        raise RuntimeError(
            f"Melon Dailyの日付が未更新または確認不能です: expected={target.isoformat()}"
        )
    items = parse_melon_daily_html(html)
    assert_complete("Melon Daily", items, 90)
    return BASE.SourceResult(
        chart["id"],
        daily_chart_at(target),
        items,
        {
            "period": "daily",
            "sourceMode": "official-html",
            "sourceUrl": url,
            "nativeDate": target.isoformat(),
            "publishedAt": "12:40 KST",
            "chartDateRule": "source-verified-previous-day",
            "total": len(items),
        },
    )


def fetch_genie_daily_fixed(chart: dict[str, Any], fetched_at: datetime):
    target = expected_daily_date(fetched_at)
    ymd = target.strftime("%Y%m%d")
    merged: list[dict[str, Any]] = []
    source_urls: list[str] = []

    for page in range(1, 5):
        url = (
            "https://www.genie.co.kr/chart/top200"
            f"?ditc=D&ymd={ymd}&hh=12&rtm=N&pg={page}"
        )
        html = request_html(url, referer="https://www.genie.co.kr/chart/top200")
        if not target_date_is_present(html, target):
            raise RuntimeError(
                f"Genie Dailyの日付が未更新または確認不能です: "
                f"expected={target.isoformat()}, page={page}"
            )
        page_items = parse_genie_daily_html(html, page=page, page_size=50)
        merged.extend(page_items)
        source_urls.append(url)

    items = unique_sorted_items(merged, 200)
    assert_complete("Genie Daily", items, 180)
    return BASE.SourceResult(
        chart["id"],
        daily_chart_at(target),
        items,
        {
            "period": "daily",
            "sourceMode": "official-html",
            "sourceUrl": source_urls[0],
            "nativeDate": target.isoformat(),
            "publishedAt": "12:00 KST",
            "chartDateRule": "source-verified-previous-day",
            "pageCount": 4,
            "total": len(items),
        },
    )


def fetch_bugs_daily_fixed(chart: dict[str, Any], fetched_at: datetime):
    target = expected_daily_date(fetched_at)
    url = (
        "https://music.bugs.co.kr/chart/track/day/total"
        f"?chartdate={target.strftime('%Y%m%d')}"
    )
    html = request_html(url, referer="https://music.bugs.co.kr/chart/track/day/total")
    if not target_date_is_present(html, target):
        raise RuntimeError(
            f"Bugs Dailyの日付が未更新または確認不能です: expected={target.isoformat()}"
        )
    items = parse_bugs_daily_html(html)
    assert_complete("Bugs Daily", items, 90)
    return BASE.SourceResult(
        chart["id"],
        daily_chart_at(target),
        items,
        {
            "period": "daily",
            "sourceMode": "official-html",
            "sourceUrl": url,
            "nativeDate": target.isoformat(),
            "publishedAt": "12:00 KST",
            "chartDateRule": "source-verified-previous-day",
            "total": len(items),
        },
    )


def install_fixes() -> None:
    BASE.FETCHERS["melon-daily"] = fetch_melon_daily_fixed
    BASE.FETCHERS["genie-daily"] = fetch_genie_daily_fixed
    BASE.FETCHERS["bugs-daily"] = fetch_bugs_daily_fixed


def self_test() -> int:
    target = date(2026, 8, 1)
    sample = datetime(2026, 8, 2, 12, 50, tzinfo=BASE.KST)
    assert expected_daily_date(sample) == target
    assert daily_chart_at(target) == "2026-08-01T00:00:00+09:00"

    melon_html = """
    <html><body><div>2026.08.01</div><table><tbody>
      <tr class="lst50" data-song-no="1"><td><span class="rank">1</span></td>
        <td><div class="ellipsis rank01"><a>LOVE ATTACK</a></div>
        <div class="ellipsis rank02"><a>RESCENE</a></div></td></tr>
      <tr class="lst50" data-song-no="2"><td><span class="rank">6</span></td>
        <td><div class="ellipsis rank01"><a>Pretty Girl</a></div>
        <div class="ellipsis rank02"><a>RESCENE</a></div></td></tr>
    </tbody></table></body></html>
    """
    assert target_date_is_present(melon_html, target)
    melon = parse_melon_daily_html(melon_html)
    assert [item["rank"] for item in melon] == [1, 6]

    genie_html = """
    <html><body><div>2026-08-01</div><table><tbody>
      <tr class="list" songid="1"><td class="number">1</td>
        <td class="info"><a class="title ellipsis">LOVE ATTACK</a>
        <a class="artist ellipsis">RESCENE</a></td></tr>
      <tr class="list" songid="2"><td class="number">10</td>
        <td class="info"><a class="title ellipsis">Pretty Girl</a>
        <a class="artist ellipsis">RESCENE</a></td></tr>
    </tbody></table></body></html>
    """
    genie = parse_genie_daily_html(genie_html, page=1)
    assert [item["rank"] for item in genie] == [1, 10]

    bugs_html = """
    <html><body><div>2026/08/01</div><table class="list trackList"><tbody>
      <tr trackid="1"><td class="ranking"><strong>1</strong></td>
        <td><p class="title"><a>LOVE ATTACK</a></p>
        <p class="artist"><a>RESCENE</a></p></td></tr>
      <tr trackid="2"><td class="ranking"><strong>10</strong></td>
        <td><p class="title"><a>Pretty Girl</a></p>
        <p class="artist"><a>RESCENE</a></p></td></tr>
    </tbody></table></body></html>
    """
    bugs = parse_bugs_daily_html(bugs_html)
    assert [item["rank"] for item in bugs] == [1, 10]

    install_fixes()
    assert BASE.FETCHERS["melon-daily"] is fetch_melon_daily_fixed
    assert BASE.FETCHERS["genie-daily"] is fetch_genie_daily_fixed
    assert BASE.FETCHERS["bugs-daily"] is fetch_bugs_daily_fixed
    print("Daily chart official-source validation self-test passed.")
    return 0


def main() -> int:
    if "--self-test" in sys.argv:
        return self_test()
    install_fixes()
    return int(BASE.main())


if __name__ == "__main__":
    raise SystemExit(main())
