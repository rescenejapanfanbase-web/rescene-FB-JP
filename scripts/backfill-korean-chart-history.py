#!/usr/bin/env python3
"""One-time, rate-limited historical backfill from Guyso with explicit attribution."""
from __future__ import annotations

import argparse
import importlib.util
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from korean_chart_core import (
    SCHEMA_VERSION,
    atomic_write_json,
    empty_public_payload,
    finalize_public_payload,
    history_path,
    iso_kst,
    json_to_js,
    load_json,
    make_entry,
    summarize_history,
)
from korean_chart_history import (
    GUYSO_BASE,
    discover_history_links,
    discover_melon_song_candidates,
    fallback_song_candidates,
    merge_historical_points,
    parse_history_page,
    parse_release_date,
    parse_song_title,
    select_song_candidates,
)

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "data" / "korean-chart-config.json"
PUBLIC_PATH = ROOT / "data" / "korean-charts.json"
PUBLIC_JS_PATH = ROOT / "data" / "korean-charts-data.js"
CACHE_DIR = ROOT / ".cache" / "guyso-korean-chart-history"
ARTIST_SONGS_URL = os.getenv("GUYSO_RESCENE_MELON_SONGS_URL", f"{GUYSO_BASE}/artist/melon/3709231/songs")
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36"
)


class RateLimitedClient:
    def __init__(self, delay: float, attempts: int, max_requests: int, no_cache: bool = False):
        self.delay = max(1.0, delay)
        self.attempts = max(1, attempts)
        self.max_requests = max(1, max_requests)
        self.no_cache = no_cache
        self.requests = 0
        self.last_request = 0.0
        CACHE_DIR.mkdir(parents=True, exist_ok=True)

    def cache_path(self, url: str) -> Path:
        import hashlib
        return CACHE_DIR / (hashlib.sha256(url.encode()).hexdigest() + ".html")

    def get(self, url: str) -> str:
        cache = self.cache_path(url)
        if cache.exists() and not self.no_cache:
            return cache.read_text(encoding="utf-8", errors="replace")
        if self.requests >= self.max_requests:
            raise RuntimeError(f"安全上限 {self.max_requests} リクエストに達しました。")
        errors: list[str] = []
        for attempt in range(1, self.attempts + 1):
            wait = self.delay - (time.monotonic() - self.last_request)
            if wait > 0:
                time.sleep(wait)
            request = urllib.request.Request(url, headers={
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                "Accept-Language": "ko-KR,ko;q=0.9,ja;q=0.8,en;q=0.6",
                "Cache-Control": "no-cache",
                "Referer": GUYSO_BASE + "/",
            })
            self.requests += 1
            self.last_request = time.monotonic()
            try:
                with urllib.request.urlopen(request, timeout=35) as response:
                    raw = response.read()
                html = raw.decode("utf-8", errors="replace")
                cache.write_text(html, encoding="utf-8")
                return html
            except urllib.error.HTTPError as exc:
                errors.append(f"HTTP {exc.code}")
                retry_after = int(exc.headers.get("Retry-After", "0") or 0)
                if exc.code == 429 and retry_after:
                    time.sleep(min(retry_after, 120))
            except Exception as exc:
                errors.append(f"{type(exc).__name__}: {exc}")
            if attempt < self.attempts:
                time.sleep(attempt * 4)
        raise RuntimeError(" / ".join(errors[-3:]))


def load_site_config() -> dict[str, Any]:
    sync_path = ROOT / "scripts" / "sync-korean-charts.py"
    spec = importlib.util.spec_from_file_location("sync_korean_charts_for_backfill", sync_path)
    if not spec or not spec.loader:
        raise RuntimeError("同期スクリプトを読み込めません。")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    config, metadata = module.load_config()
    print(f"設定読込: {metadata.get('source')} / {len(config.get('songs', []))}曲")
    return config


def choose_song_detail(song: dict[str, Any], candidates: list[str], client: RateLimitedClient) -> tuple[str, str]:
    if not candidates:
        return "", ""
    expected_date = str(song.get("releaseDate") or "")[:10]
    expected_titles = {compact(song.get("title"))}
    expected_titles.update(compact(alias) for alias in song.get("aliases", []) if compact(alias))
    fallback: tuple[str, str] = ("", "")
    for candidate in candidates:
        html = client.get(candidate)
        actual_title = compact(parse_song_title(html))
        # Reject an explicit/fallback ID if it clearly points at another song.
        if actual_title and actual_title not in expected_titles:
            print(f"  [ID不一致] {song['title']}: {candidate} -> {parse_song_title(html)}")
            continue
        if not fallback[0]:
            fallback = (candidate, html)
        actual_date = parse_release_date(html)
        if not expected_date or not actual_date or actual_date == expected_date:
            return candidate, html
    return fallback


def update_public_history_summaries(public: dict[str, Any], config: dict[str, Any], touched: set[tuple[str, str]], checked_at: str) -> None:
    charts = {chart["id"]: chart for chart in config.get("charts", [])}
    songs = {song["id"]: song for song in config.get("songs", [])}
    entries = {(entry.get("songId"), entry.get("chartId")): dict(entry) for entry in public.get("entries", []) if isinstance(entry, dict)}
    for song_id, chart_id in touched:
        song = songs.get(song_id)
        chart = charts.get(chart_id)
        if not song or not chart:
            continue
        path = history_path(ROOT, song_id, chart_id)
        history = load_json(path, {})
        stats = summarize_history(history.get("points", []))
        entry = entries.get((song_id, chart_id)) or make_entry(song, chart)
        entry.update({
            **stats,
            "songId": song_id,
            "songTitle": song["title"],
            "chartId": chart_id,
            "chartName": chart["name"],
            "historyPath": f"data/korean-chart-history/{song_id}--{chart_id}.json",
        })
        entries[(song_id, chart_id)] = entry
    public["entries"] = list(entries.values())
    finalize_public_payload(public, config, checked_at)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--songs", default="", help="song IDをカンマ区切り。空欄は全曲")
    parser.add_argument("--charts", default="", help="chart IDをカンマ区切り。空欄は対応チャート全部")
    parser.add_argument("--delay", type=float, default=1.8, help="各リクエスト間隔（最低1秒）")
    parser.add_argument("--attempts", type=int, default=3)
    parser.add_argument("--max-requests", type=int, default=100)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--no-cache", action="store_true")
    args = parser.parse_args()

    requested_songs = {value.strip() for value in args.songs.split(",") if value.strip()}
    requested_charts = {value.strip() for value in args.charts.split(",") if value.strip()}
    supported_charts = {"melon", "genie", "bugs", "flo", "vibe", "youtube-kr"}
    if requested_charts:
        supported_charts &= requested_charts

    config = load_site_config()
    charts = {chart["id"]: chart for chart in config.get("charts", []) if chart["id"] in supported_charts}
    songs = [song for song in config.get("songs", []) if not requested_songs or song["id"] in requested_songs]
    client = RateLimitedClient(args.delay, args.attempts, args.max_requests, args.no_cache)
    checked_at = iso_kst()

    try:
        artist_html = client.get(ARTIST_SONGS_URL)
        discovered = discover_melon_song_candidates(artist_html)
    except Exception as exc:
        discovered = {}
        print(f"[WARN] 가이섬曲一覧を取得できないため、直接IDへ切替: {type(exc).__name__}: {exc}")
    discovered_count = sum(len(value) for value in discovered.values())
    fallback_count = sum(1 for song in songs if fallback_song_candidates(song))
    print(f"가이섬 RESCENE曲一覧: {discovered_count}候補 / 直接IDフォールバック: {fallback_count}曲")

    pending: dict[Path, dict[str, Any]] = {}
    touched: set[tuple[str, str]] = set()
    imported = 0
    updated = 0
    errors: list[str] = []

    for song in songs:
        candidates = select_song_candidates(song, discovered)
        for candidate in fallback_song_candidates(song):
            if candidate not in candidates:
                candidates.append(candidate)
        try:
            detail_url, detail_html = choose_song_detail(song, candidates, client)
            if not detail_url:
                print(f"[SKIP] {song['title']}: 가이섬のMelon曲ページ未検出")
                continue
            links = discover_history_links(detail_html)
            print(f"[SONG] {song['title']}: {len(links)}チャート候補")
            for chart_id in sorted(set(links) & set(charts)):
                source_url = links[chart_id]
                try:
                    html = client.get(source_url)
                    points = parse_history_page(chart_id, html, max_rank=int(charts[chart_id].get("maxRank") or 100), source_url=source_url)
                    if not points:
                        print(f"  [EMPTY] {chart_id}: 履歴なし")
                        continue
                    path = history_path(ROOT, song["id"], chart_id)
                    history = pending.get(path) or load_json(path, {
                        "schemaVersion": SCHEMA_VERSION,
                        "songId": song["id"],
                        "songTitle": song["title"],
                        "chartId": chart_id,
                        "chartName": charts[chart_id]["name"],
                        "points": [],
                        "outOfChartHistory": [],
                    })
                    add_count, update_count = merge_historical_points(history, points, checked_at=checked_at)
                    history["generatedAt"] = checked_at
                    history["songTitle"] = song["title"]
                    history["chartName"] = charts[chart_id]["name"]
                    history["backfill"] = {
                        "source": "가이섬",
                        "sourceUrl": source_url,
                        "lastRunAt": checked_at,
                        "importedThisRun": add_count,
                        "updatedThisRun": update_count,
                    }
                    pending[path] = history
                    touched.add((song["id"], chart_id))
                    imported += add_count
                    updated += update_count
                    print(f"  [OK] {chart_id}: {len(points)}取得 / +{add_count} / 訂正{update_count}")
                except Exception as exc:
                    message = f"{song['title']} / {chart_id}: {type(exc).__name__}: {exc}"
                    errors.append(message)
                    print(f"  [FAIL] {message}", file=sys.stderr)
        except Exception as exc:
            message = f"{song['title']}: {type(exc).__name__}: {exc}"
            errors.append(message)
            print(f"[FAIL] {message}", file=sys.stderr)

    print(f"集計: 対象{len(touched)}組 / 新規{imported}点 / 訂正{updated}点 / リクエスト{client.requests}回 / エラー{len(errors)}件")
    if args.dry_run:
        print("DRY RUNのためファイルは変更しません。")
        return 0 if touched else 2
    if not touched:
        print("保存できる履歴がありません。既存公開データは変更しません。", file=sys.stderr)
        return 2

    for path, history in pending.items():
        atomic_write_json(path, history)
    public = load_json(PUBLIC_PATH, empty_public_payload(config))
    update_public_history_summaries(public, config, touched, checked_at)
    atomic_write_json(PUBLIC_PATH, public)
    PUBLIC_JS_PATH.write_text(json_to_js("RESCENE_KOREAN_CHARTS", public), encoding="utf-8")
    print("過去順位の初回補完を保存しました。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
