#!/usr/bin/env python3
"""Fetch Korean music charts, retain stale sources safely, and publish RESCENE-only data."""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup

from korean_chart_history import parse_spotify_embed_html

from korean_chart_core import (
    DEFAULT_CHARTS,
    KST,
    SourceResult,
    apply_successful_chart,
    atomic_write_json,
    default_config,
    empty_public_payload,
    finalize_public_payload,
    iso_kst,
    json_to_js,
    load_json,
    merge_chart_entries,
    normalize_chart_at,
    normalize_config,
    now_kst,
    safe_int,
    slugify,
    split_values,
)

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "data" / "korean-chart-config.json"
PUBLIC_PATH = ROOT / "data" / "korean-charts.json"
PUBLIC_JS_PATH = ROOT / "data" / "korean-charts-data.js"
STATUS_PATH = ROOT / "data" / "korean-chart-sync-status.json"
NOTION_VERSION = "2026-03-11"
DEFAULT_TIMEOUT = 28
DEFAULT_SPOTIFY_KOREA_PLAYLIST_ID = "37i9dQZEVXbNxXF4SkHj9F"
DEFAULT_YOUTUBE_MUSIC_KOREA_PLAYLIST_URL = "https://www.youtube.com/playlist?list=PL4fGSI1pDJn6jXS_Tv_N9B8Z0HTRVJE0m"


def environment_value(name: str, default: str) -> str:
    """Return a non-empty environment value; GitHub Actions exposes missing vars as empty strings."""
    value = os.getenv(name, "").strip()
    return value or default


def spotify_playlist_id_from_environment() -> str:
    raw = environment_value("SPOTIFY_KOREA_PLAYLIST_ID", DEFAULT_SPOTIFY_KOREA_PLAYLIST_ID)
    if raw.startswith("spotify:playlist:"):
        raw = raw.rsplit(":", 1)[-1]
    match = re.search(r"/playlist/([A-Za-z0-9]+)", raw)
    return match.group(1) if match else raw.strip().strip("/") or DEFAULT_SPOTIFY_KOREA_PLAYLIST_ID


def youtube_playlist_url_from_environment() -> str:
    raw = environment_value("YOUTUBE_MUSIC_KOREA_PLAYLIST_URL", DEFAULT_YOUTUBE_MUSIC_KOREA_PLAYLIST_URL)
    if re.fullmatch(r"[A-Za-z0-9_-]{10,}", raw):
        return f"https://www.youtube.com/playlist?list={raw}"
    return raw


def http_request(url: str, *, method: str = "GET", headers: dict[str, str] | None = None, data: bytes | None = None, timeout: int = DEFAULT_TIMEOUT) -> bytes:
    request = urllib.request.Request(url, method=method, headers=headers or {}, data=data)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def request_json(url: str, *, method: str = "GET", headers: dict[str, str] | None = None, form: dict[str, Any] | None = None, json_body: Any = None, timeout: int = DEFAULT_TIMEOUT) -> Any:
    data = None
    merged_headers = dict(headers or {})
    if form is not None:
        data = urllib.parse.urlencode(form).encode("utf-8")
        merged_headers.setdefault("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
    elif json_body is not None:
        data = json.dumps(json_body).encode("utf-8")
        merged_headers.setdefault("Content-Type", "application/json")
    raw = http_request(url, method=method, headers=merged_headers, data=data, timeout=timeout)
    return json.loads(raw.decode("utf-8", errors="replace"))


def first_dict_with_key(value: Any, key: str) -> dict[str, Any] | None:
    if isinstance(value, dict):
        if key in value:
            return value
        for child in value.values():
            found = first_dict_with_key(child, key)
            if found:
                return found
    elif isinstance(value, list):
        for child in value:
            found = first_dict_with_key(child, key)
            if found:
                return found
    return None


def text_of(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        for key in ("name", "artistName", "ARTIST_NAME", "plain_text", "title"):
            if value.get(key):
                return str(value[key]).strip()
    return str(value).strip()


def parse_melon(payload: Any, chart: dict[str, Any], fetched_at: datetime) -> SourceResult:
    root = first_dict_with_key(payload, "SONGLIST") or (payload if isinstance(payload, dict) else {})
    songs = root.get("SONGLIST") or []
    items = []
    for index, song in enumerate(songs, 1):
        artists = song.get("ARTISTLIST") or song.get("artistList") or []
        artist = ", ".join(filter(None, [text_of(item.get("ARTISTNAME") if isinstance(item, dict) else item) for item in artists]))
        items.append({
            "id": str(song.get("SONGID") or song.get("songId") or ""),
            "rank": safe_int(song.get("CURRANK") or song.get("rank")) or index,
            "previousRank": safe_int(song.get("PASTRANK")),
            "rankType": str(song.get("RANKTYPE") or ""),
            "title": text_of(song.get("SONGNAME") or song.get("songName")),
            "artist": artist or text_of(song.get("ARTISTNAME")),
        })
    rank_day = str(root.get("RANKDAY") or "").strip()
    rank_hour = str(root.get("RANKHOUR") or "").strip()
    stamp = f"{rank_day} {rank_hour}" if rank_day and rank_hour else fetched_at.isoformat()
    return SourceResult(chart["id"], normalize_chart_at(stamp, chart, fetched_at), items, {"nativeDay": rank_day, "nativeHour": rank_hour})


def fetch_melon(chart: dict[str, Any], fetched_at: datetime) -> SourceResult:
    payload = request_json(
        "https://m2.melon.com/m6/chart/ent/songChartList.json?cpId=AS40&cpKey=14LNC3&appVer=6.5.8.1",
        headers={"User-Agent": "AS40; Android 13; 6.5.8.1; sdk_gphone64_arm64", "Accept": "application/json"},
    )
    return parse_melon(payload, chart, fetched_at)


def parse_genie(payload: Any, chart: dict[str, Any], fetched_at: datetime) -> SourceResult:
    root = first_dict_with_key(payload, "DataSet") or (payload if isinstance(payload, dict) else {})
    dataset = root.get("DataSet") or {}
    songs = dataset.get("DATA") or dataset.get("data") or []
    items = []
    for index, song in enumerate(songs, 1):
        items.append({
            "id": str(song.get("SONG_ID") or song.get("SONGID") or ""),
            "rank": safe_int(song.get("RANK_NO") or song.get("TOP_RANK_NO")) or index,
            "previousRank": safe_int(song.get("PRE_RANK_NO")),
            "title": urllib.parse.unquote(text_of(song.get("SONG_NAME"))),
            "artist": urllib.parse.unquote(text_of(song.get("ARTIST_NAME"))),
        })
    page_info = root.get("PageInfo") or payload.get("PageInfo", {}) if isinstance(payload, dict) else {}
    chart_time = str((page_info or {}).get("ChartTime") or fetched_at.isoformat())
    return SourceResult(chart["id"], normalize_chart_at(chart_time, chart, fetched_at), items, {"nativeTime": chart_time})


def fetch_genie(chart: dict[str, Any], fetched_at: datetime) -> SourceResult:
    payload = request_json(
        "https://app.genie.co.kr/chart/j_RealTimeRankSongList.json",
        method="POST",
        headers={"User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36", "Accept": "application/json"},
        form={"pg": 1, "pgSize": 200},
    )
    return parse_genie(payload, chart, fetched_at)


def parse_bugs(payload: Any, chart: dict[str, Any], fetched_at: datetime) -> SourceResult:
    root = first_dict_with_key(payload, "list") or (payload if isinstance(payload, dict) else {})
    songs = root.get("list") or []
    items = []
    for index, song in enumerate(songs, 1):
        attrs = song.get("list_attr") or {}
        artists = song.get("artists") or []
        artist = ", ".join(filter(None, [text_of(item.get("artist_nm") if isinstance(item, dict) else item) for item in artists]))
        items.append({
            "id": str(song.get("track_id") or song.get("trackId") or ""),
            "rank": safe_int(attrs.get("rank")) or index,
            "previousRank": safe_int(attrs.get("rank_last")),
            "peakRank": safe_int(attrs.get("rank_peak")),
            "title": text_of(song.get("track_title")),
            "artist": artist,
        })
    info = root.get("info") or (payload.get("info") if isinstance(payload, dict) else {}) or {}
    chart_time = str(info.get("end_dt") or fetched_at.isoformat())
    return SourceResult(chart["id"], normalize_chart_at(chart_time, chart, fetched_at), items, {"nativeTime": chart_time})


def fetch_bugs(chart: dict[str, Any], fetched_at: datetime) -> SourceResult:
    payload = request_json(
        "https://m.bugs.co.kr/api/getChartTrack",
        method="POST",
        headers={"User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36", "Accept": "application/json"},
        form={"period_tp": "realtime", "svc_type": "20151", "size": 100},
    )
    return parse_bugs(payload, chart, fetched_at)


def parse_flo(payload: Any, chart: dict[str, Any], fetched_at: datetime) -> SourceResult:
    root = first_dict_with_key(payload, "trackList") or (payload if isinstance(payload, dict) else {})
    songs = root.get("trackList") or []
    items = []
    for index, song in enumerate(songs, 1):
        rank_data = song.get("rank") or {}
        artist = text_of(song.get("representationArtist"))
        if not artist:
            artist = ", ".join(filter(None, [text_of(x) for x in song.get("artistList") or []]))
        rank = safe_int(rank_data.get("rank") or song.get("rankNo") or song.get("rank")) or index
        items.append({
            "id": str(song.get("id") or song.get("trackId") or ""),
            "rank": rank,
            "title": text_of(song.get("name") or song.get("trackName")),
            "artist": artist,
            "rankBadge": text_of(rank_data.get("rankBadge")),
            "new": bool(rank_data.get("newYn") == "Y" or rank_data.get("isNew")),
        })
    return SourceResult(chart["id"], normalize_chart_at(fetched_at, chart, fetched_at), items, {"nativeName": text_of(root.get("name"))})


def fetch_flo(chart: dict[str, Any], fetched_at: datetime) -> SourceResult:
    payload = request_json(
        "https://api.music-flo.com/display/v1/browser/chart/1/list?mixYn=N",
        headers={"User-Agent": "okhttp/4.9.2", "x-gm-app-name": "FLO", "x-gm-app-version": "", "Accept": "application/json"},
    )
    return parse_flo(payload, chart, fetched_at)


def parse_vibe(payload: Any, chart: dict[str, Any], fetched_at: datetime) -> SourceResult:
    root = payload.get("response", {}).get("result", {}).get("chart", {}) if isinstance(payload, dict) else {}
    if not root:
        found = first_dict_with_key(payload, "items")
        root = found or {}
    tracks = (root.get("items") or {}).get("tracks") if isinstance(root.get("items"), dict) else root.get("tracks")
    tracks = tracks or []
    items = []
    for index, song in enumerate(tracks, 1):
        rank_data = song.get("rank") or {}
        artists = song.get("artists") or []
        artist = ", ".join(filter(None, [text_of(x.get("artistName") if isinstance(x, dict) else x) for x in artists]))
        items.append({
            "id": str(song.get("trackId") or song.get("id") or ""),
            "rank": safe_int(rank_data.get("currentRank")) or index,
            "previousRank": safe_int(rank_data.get("currentRank")) + safe_int(rank_data.get("rankVariation")) if safe_int(rank_data.get("currentRank")) is not None and safe_int(rank_data.get("rankVariation")) is not None else None,
            "title": text_of(song.get("trackTitle")),
            "artist": artist,
            "new": bool(rank_data.get("isNew")),
        })
    chart_time = str(root.get("date") or fetched_at.isoformat())
    return SourceResult(chart["id"], normalize_chart_at(chart_time, chart, fetched_at), items, {"nativeTitle": text_of(root.get("title")), "nativeDate": chart_time})


def fetch_vibe(chart: dict[str, Any], fetched_at: datetime) -> SourceResult:
    payload = request_json(
        "https://apis.naver.com/vibeWeb/musicapiweb/vibe/v1/chart/track/total?start=1&display=100",
        headers={"User-Agent": "Mozilla/5.0", "Referer": "https://vibe.naver.com/", "Accept": "application/json"},
    )
    return parse_vibe(payload, chart, fetched_at)


def clean_youtube_chart_title(value: Any) -> str:
    title = text_of(value)
    if not title:
        return ""
    title = re.sub(r"^\s*\[(?:MV|M/V|VIDEO|AUDIO|LYRICS?)\]\s*", "", title, flags=re.I)
    # Quoted titles are the most reliable part of common K-pop video names.
    quoted = re.search(r"[\"'‘’“”「」『』]([^\"'‘’“”「」『』]{2,80})[\"'‘’“”「」『』]", title)
    if quoted and re.search(r"RESCENE|리센느", title, flags=re.I):
        title = quoted.group(1)
    else:
        title = re.sub(r"RESCENE\s*(?:\(\s*리센느\s*\))?|리센느\s*(?:\(\s*RESCENE\s*\))?", " ", title, flags=re.I)
        title = re.sub(r"^\s*[-–—_:|]+\s*|\s*[-–—_:|]+\s*$", "", title)
    title = re.sub(
        r"\s*[\[(](?:OFFICIAL\s*)?(?:M/?V|MUSIC\s*VIDEO|VIDEO|AUDIO|LYRIC(?:S)?|PERFORMANCE(?:\s*VIDEO)?|DANCE\s*PRACTICE)[^\])]*[\])]\s*$",
        "",
        title,
        flags=re.I,
    )
    title = re.sub(
        r"\s+(?:OFFICIAL\s+)?(?:M/?V|MUSIC\s+VIDEO|VIDEO|AUDIO|LYRIC(?:S)?|PERFORMANCE(?:\s+VIDEO)?)\s*$",
        "",
        title,
        flags=re.I,
    )
    return re.sub(r"\s+", " ", title).strip(" -–—_:|[]()")


def youtube_title_artist(entry: dict[str, Any]) -> tuple[str, str]:
    raw_title = text_of(entry.get("title"))
    artist = text_of(
        entry.get("artist")
        or entry.get("creator")
        or entry.get("uploader")
        or entry.get("channel")
        or entry.get("channel_title")
    )
    for separator in (" — ", " – ", " - ", " _ "):
        if separator not in raw_title:
            continue
        left, right = [x.strip() for x in raw_title.rsplit(separator, 1)]
        if "rescene" in right.lower() or "리센느" in right:
            return clean_youtube_chart_title(left), right
        if "rescene" in left.lower() or "리센느" in left:
            return clean_youtube_chart_title(right), left
    if re.search(r"RESCENE|리센느", raw_title, flags=re.I) and not re.search(r"RESCENE|리센느", artist, flags=re.I):
        artist = "RESCENE (리센느)"
    return clean_youtube_chart_title(raw_title), artist


def parse_guyso_youtube_rescene_rows(html: str) -> list[dict[str, Any]]:
    """Extract RESCENE rows from Guyso's latest weekly YouTube chart.

    The official YouTube playlist remains the primary 100-item source. Guyso is
    used only to enrich the RESCENE rows whose flat playlist metadata can omit
    the artist, preventing false matches for generic titles such as Pretty Girl.
    """
    soup = BeautifulSoup(html, "html.parser")
    items: list[dict[str, Any]] = []
    for row in soup.find_all("tr"):
        cells = row.find_all(["th", "td"], recursive=False) or row.find_all(["th", "td"])
        if len(cells) < 2:
            continue
        rank_match = re.match(r"\s*(\d{1,3})\b", cells[0].get_text(" ", strip=True))
        if not rank_match:
            continue
        rank = safe_int(rank_match.group(1))
        if rank is None or not 1 <= rank <= 100:
            continue
        info = re.sub(r"\s+", " ", cells[1].get_text(" ", strip=True)).strip()
        artist_match = re.search(r"\s+RESCENE\s*(?:\(\s*리센느\s*\))?", info, flags=re.I)
        if not artist_match:
            artist_match = re.search(r"\s+리센느\s*(?:\(\s*RESCENE\s*\))?", info, flags=re.I)
        if not artist_match:
            continue
        title = info[:artist_match.start()].strip(" -–—_:|")
        if not title:
            continue
        views = None
        if len(cells) >= 3:
            views = safe_int(re.sub(r"\D", "", cells[-1].get_text(" ", strip=True)))
        item: dict[str, Any] = {
            "id": "",
            "rank": rank,
            "title": title,
            "artist": "RESCENE (리센느)",
            "origin": "guyso-current-enrichment",
            "sourceName": "가이섬",
            "sourceUrl": "https://xn--o39an51b2re.com/chart/youtube/track-weekly",
        }
        if views is not None:
            item["views"] = views
        items.append(item)
    return sorted(items, key=lambda item: int(item["rank"]))


def fetch_youtube(chart: dict[str, Any], fetched_at: datetime) -> SourceResult:
    playlist_url = youtube_playlist_url_from_environment()
    command = [sys.executable, "-m", "yt_dlp", "--flat-playlist", "--dump-single-json", "--no-warnings", "--playlist-end", str(chart.get("maxRank") or 100), playlist_url]
    proc = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=120)
    if proc.returncode:
        raise RuntimeError(f"yt-dlp failed: {(proc.stderr or proc.stdout)[-600:]}")
    payload = json.loads(proc.stdout)
    items = []
    for index, entry in enumerate(payload.get("entries") or [], 1):
        title, artist = youtube_title_artist(entry or {})
        items.append({"id": str((entry or {}).get("id") or ""), "rank": index, "title": title, "artist": artist, "origin": "official-playlist"})

    enrichment_error = ""
    enriched: list[dict[str, Any]] = []
    try:
        raw = http_request(
            "https://xn--o39an51b2re.com/chart/youtube/track-weekly",
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; RESCENE-JAPAN-FANBASE/1.0)",
                "Accept": "text/html,application/xhtml+xml",
                "Accept-Language": "ko-KR,ko;q=0.9,ja;q=0.8",
            },
            timeout=40,
        )
        enriched = parse_guyso_youtube_rescene_rows(raw.decode("utf-8", errors="replace"))
        for enriched_item in enriched:
            position = int(enriched_item["rank"]) - 1
            if 0 <= position < len(items):
                original_id = items[position].get("id")
                items[position] = {**items[position], **enriched_item, "id": original_id or enriched_item.get("id", "")}
    except Exception as exc:
        enrichment_error = f"{type(exc).__name__}: {exc}"

    native = payload.get("modified_date") or payload.get("upload_date") or fetched_at.isoformat()
    return SourceResult(
        chart["id"],
        normalize_chart_at(native, chart, fetched_at),
        items,
        {
            "playlistId": payload.get("id"),
            "playlistTitle": payload.get("title"),
            "guysoEnrichedCount": len(enriched),
            "guysoEnrichmentError": enrichment_error,
        },
    )


def spotify_token() -> str:
    client_id = os.getenv("SPOTIFY_CLIENT_ID", "").strip()
    client_secret = os.getenv("SPOTIFY_CLIENT_SECRET", "").strip()
    if not client_id or not client_secret:
        raise RuntimeError("SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET が未設定です。")
    basic = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    payload = request_json(
        "https://accounts.spotify.com/api/token",
        method="POST",
        headers={"Authorization": f"Basic {basic}"},
        form={"grant_type": "client_credentials"},
    )
    token = str(payload.get("access_token") or "")
    if not token:
        raise RuntimeError("Spotify access tokenを取得できませんでした。")
    return token


def fetch_spotify(chart: dict[str, Any], fetched_at: datetime) -> SourceResult:
    """Read Spotify's official public Top 50 embed; use Web API only as a fallback."""
    playlist_id = spotify_playlist_id_from_environment()
    max_rank = int(chart.get("maxRank") or 50)
    embed_urls = [
        f"https://open.spotify.com/embed/playlist/{playlist_id}?theme=0",
        f"https://open.spotify.com/embed/playlist/{playlist_id}?utm_source=generator&theme=0",
        f"https://open.spotify.com/embed/playlist/{playlist_id}",
    ]
    spotify_errors: list[str] = []
    items: list[dict[str, Any]] = []
    source_mode = "official-embed"
    embed_url = embed_urls[0]
    for candidate_url in embed_urls:
        try:
            raw = http_request(
                candidate_url,
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138 Safari/537.36",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.7,en;q=0.6",
                    "Referer": "https://open.spotify.com/",
                },
                timeout=45,
            )
            parsed = parse_spotify_embed_html(raw.decode("utf-8", errors="replace"), max_rank=max_rank)
            if len(parsed) >= min(20, max_rank):
                items = parsed
                embed_url = candidate_url
                break
            spotify_errors.append(f"{candidate_url}: parsed {len(parsed)} tracks")
            if len(parsed) > len(items):
                items = parsed
                embed_url = candidate_url
        except Exception as exc:
            spotify_errors.append(f"{candidate_url}: {type(exc).__name__}: {exc}")

    # Optional compatibility fallback. New Spotify developer applications may not
    # be able to read Spotify-owned playlist items, so credentials are not required.
    if len(items) < min(20, max_rank) and os.getenv("SPOTIFY_CLIENT_ID", "").strip() and os.getenv("SPOTIFY_CLIENT_SECRET", "").strip():
        token = spotify_token()
        payload = request_json(
            f"https://api.spotify.com/v1/playlists/{playlist_id}/tracks?limit={max_rank}&market=KR&fields=items(track(id,name,artists(name))),total",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        )
        fallback_items = []
        for index, row in enumerate(payload.get("items") or [], 1):
            track = (row or {}).get("track") or {}
            artist = ", ".join(filter(None, [text_of(x) for x in track.get("artists") or []]))
            fallback_items.append({"id": str(track.get("id") or ""), "rank": index, "title": text_of(track.get("name")), "artist": artist})
        if len(fallback_items) > len(items):
            items = fallback_items
            source_mode = "web-api-fallback"

    return SourceResult(
        chart["id"],
        normalize_chart_at(fetched_at, chart, fetched_at),
        items,
        {
            "playlistId": playlist_id,
            "playlistUrl": f"https://open.spotify.com/playlist/{playlist_id}",
            "embedUrl": embed_url,
            "sourceMode": source_mode,
            "total": len(items),
            "adapterWarnings": spotify_errors,
        },
    )


FETCHERS = {
    "melon": fetch_melon,
    "genie": fetch_genie,
    "bugs": fetch_bugs,
    "flo": fetch_flo,
    "vibe": fetch_vibe,
    "youtube-kr": fetch_youtube,
    "spotify-kr": fetch_spotify,
}


def notion_plain_text(prop: Any) -> str:
    if not isinstance(prop, dict):
        return ""
    values = prop.get("title") or prop.get("rich_text") or []
    return "".join(str(x.get("plain_text") or x.get("text", {}).get("content") or "") for x in values if isinstance(x, dict)).strip()


def notion_value(properties: dict[str, Any], names: list[str], default: Any = None) -> Any:
    for name in names:
        prop = properties.get(name)
        if not isinstance(prop, dict):
            continue
        ptype = prop.get("type")
        if ptype in {"title", "rich_text"} or "title" in prop or "rich_text" in prop:
            value = notion_plain_text(prop)
        elif ptype == "number" or "number" in prop:
            value = prop.get("number")
        elif ptype == "checkbox" or "checkbox" in prop:
            value = prop.get("checkbox")
        elif ptype == "select" or "select" in prop:
            value = (prop.get("select") or {}).get("name")
        elif ptype == "multi_select" or "multi_select" in prop:
            value = [x.get("name") for x in prop.get("multi_select") or [] if isinstance(x, dict) and x.get("name")]
        elif ptype == "date" or "date" in prop:
            value = (prop.get("date") or {}).get("start")
        elif ptype == "url" or "url" in prop:
            value = prop.get("url")
        else:
            value = None
        if value not in (None, "", []):
            return value
    return default


def notion_query_all(token: str, data_source_id: str) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    cursor = None
    headers = {"Authorization": f"Bearer {token}", "Notion-Version": NOTION_VERSION, "Content-Type": "application/json"}
    while True:
        body: dict[str, Any] = {"page_size": 100}
        if cursor:
            body["start_cursor"] = cursor
        data = request_json(f"https://api.notion.com/v1/data_sources/{data_source_id}/query", method="POST", headers=headers, json_body=body)
        results.extend(data.get("results") or [])
        if not data.get("has_more"):
            break
        cursor = data.get("next_cursor")
    return results


def config_from_notion(token: str, data_source_id: str) -> dict[str, Any]:
    pages = notion_query_all(token, data_source_id)
    charts: list[dict[str, Any]] = []
    songs: list[dict[str, Any]] = []
    for index, page in enumerate(pages):
        props = page.get("properties") or {}
        title = notion_value(props, ["タイトル", "名前", "Name"], "")
        row_type = str(notion_value(props, ["種別", "タイプ", "Type"], "楽曲"))
        published = bool(notion_value(props, ["公開", "Published"], True))
        order = safe_int(notion_value(props, ["表示順", "Order"], (index + 1) * 10)) or (index + 1) * 10
        if "チャート" in row_type or row_type.lower() == "chart":
            chart_id = notion_value(props, ["チャートID", "Chart ID"], "") or title
            charts.append({
                "id": chart_id,
                "name": notion_value(props, ["チャート名", "表示名", "Chart Name"], "") or re.sub(r"^チャート[：:]", "", str(title)),
                "shortName": notion_value(props, ["短縮名", "Short Name"], "") or re.sub(r"^チャート[：:]", "", str(title)),
                "cadence": str(notion_value(props, ["集計周期", "更新周期", "Cadence"], "hourly")).lower(),
                "maxRank": safe_int(notion_value(props, ["最大順位", "Max Rank"], 100)) or 100,
                "enabled": bool(notion_value(props, ["取得有効", "Enabled"], published)),
                "published": published,
                "order": order,
                "sourceMode": notion_value(props, ["取得方式", "Source Mode"], ""),
            })
            continue
        song_title = str(notion_value(props, ["曲名", "楽曲名", "Song"], "") or re.sub(r"^楽曲[：:]", "", str(title))).strip()
        if not song_title:
            continue
        external_raw = notion_value(props, ["外部ID", "External IDs"], "")
        try:
            external_ids = json.loads(external_raw) if external_raw else {}
        except json.JSONDecodeError:
            external_ids = {}
        songs.append({
            "id": notion_value(props, ["曲ID", "Song ID"], "") or slugify(song_title),
            "title": song_title,
            "aliases": split_values(notion_value(props, ["検索別名", "別名", "Aliases"], song_title)),
            "artistAliases": split_values(notion_value(props, ["アーティスト別名", "Artist Aliases"], "RESCENE|리센느")),
            "charts": split_values(notion_value(props, ["対象チャート", "Charts"], [])),
            "published": published,
            "order": order,
            "releaseDate": notion_value(props, ["発売日", "Release Date"], ""),
            "externalIds": external_ids,
            "notionPageId": page.get("id", ""),
        })
    return normalize_config({"schemaVersion": 1, "generatedAt": iso_kst(), "source": "notion", "dataSourceId": data_source_id, "charts": charts, "songs": songs})


def load_config() -> tuple[dict[str, Any], dict[str, Any]]:
    token = os.getenv("NOTION_TOKEN", "").strip()
    data_source_id = os.getenv("NOTION_KOREAN_CHARTS_DATA_SOURCE_ID", "").strip()
    metadata: dict[str, Any] = {"source": "local", "notionAttempted": False, "notionOk": False, "error": ""}
    if token and data_source_id:
        metadata["notionAttempted"] = True
        try:
            config = config_from_notion(token, data_source_id)
            atomic_write_json(CONFIG_PATH, config)
            metadata.update({"source": "notion", "notionOk": True})
            return config, metadata
        except Exception as exc:
            metadata["error"] = f"{type(exc).__name__}: {exc}"
            print(f"[WARN] Notion設定取得失敗。前回設定を維持します: {metadata['error']}", file=sys.stderr)
    local = normalize_config(load_json(CONFIG_PATH, default_config()))
    metadata["source"] = local.get("source") or "local"
    return local, metadata


def validate_result(result: SourceResult, chart: dict[str, Any]) -> None:
    minimum = min(20, max(5, int(chart.get("maxRank") or 100) // 4))
    if len(result.items) < minimum:
        raise RuntimeError(f"取得件数が少なすぎます: {len(result.items)}件（最低{minimum}件）")
    ranks = [safe_int(item.get("rank")) for item in result.items]
    if not any(rank == 1 for rank in ranks):
        raise RuntimeError("1位のデータが含まれていないため不完全なレスポンスと判定しました。")


def fetch_with_retry(chart: dict[str, Any], attempts: int = 3) -> SourceResult:
    fetcher = FETCHERS.get(chart["id"])
    if not fetcher:
        raise RuntimeError(f"未対応チャートです: {chart['id']}")
    errors = []
    for attempt in range(1, attempts + 1):
        fetched_at = now_kst()
        try:
            result = fetcher(chart, fetched_at)
            validate_result(result, chart)
            return result
        except Exception as exc:
            errors.append(f"{type(exc).__name__}: {exc}")
            if attempt < attempts:
                time.sleep(attempt * 3)
    raise RuntimeError(" / ".join(errors[-3:]))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--charts", default="", help="カンマ区切りで取得対象を限定")
    parser.add_argument("--attempts", type=int, default=3)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    checked_at = iso_kst()
    config, config_meta = load_config()
    old_public = load_json(PUBLIC_PATH, empty_public_payload(config))
    public = dict(old_public) if isinstance(old_public, dict) else empty_public_payload(config)
    public["sourceStatus"] = dict(public.get("sourceStatus") or {})
    requested = {x.strip() for x in args.charts.split(",") if x.strip()}
    enabled_charts = [chart for chart in config.get("charts", []) if chart.get("enabled") and (not requested or chart["id"] in requested)]
    if not enabled_charts:
        print("取得対象チャートがありません。")
        return 0

    print(f"韓国チャート同期開始: {len(enabled_charts)}チャート / {len(config.get('songs', []))}曲 / config={config_meta['source']}")
    successes: dict[str, SourceResult] = {}
    failures: dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=max(1, min(args.workers, len(enabled_charts)))) as pool:
        future_map = {pool.submit(fetch_with_retry, chart, max(1, args.attempts)): chart for chart in enabled_charts}
        for future in as_completed(future_map):
            chart = future_map[future]
            try:
                result = future.result()
                successes[chart["id"]] = result
                print(f"[OK] {chart['name']}: {len(result.items)}件 / {result.chart_at}")
            except Exception as exc:
                failures[chart["id"]] = f"{type(exc).__name__}: {exc}"
                print(f"[FAIL] {chart['name']}: {failures[chart['id']]}", file=sys.stderr)

    if not successes:
        print("全チャート取得失敗。公開データは一切変更しません。", file=sys.stderr)
        return 2

    chart_map = {chart["id"]: chart for chart in config.get("charts", [])}
    for chart_id, result in successes.items():
        chart = chart_map[chart_id]
        replacements, matched_count = apply_successful_chart(ROOT, public, config, chart, result.items, result.chart_at, checked_at)
        merge_chart_entries(public, chart_id, replacements)
        previous_status = dict(public["sourceStatus"].get(chart_id) or {})
        public["sourceStatus"][chart_id] = {
            **previous_status,
            "chartId": chart_id, "chartName": chart["name"], "ok": True, "retainedPrevious": False,
            "lastAttemptAt": checked_at, "lastSuccessAt": checked_at, "chartAt": result.chart_at,
            "itemCount": len(result.items), "matchedCount": matched_count, "error": "", "metadata": result.metadata,
        }
    for chart_id, error in failures.items():
        chart = chart_map[chart_id]
        previous_status = dict(public["sourceStatus"].get(chart_id) or {})
        public["sourceStatus"][chart_id] = {
            **previous_status,
            "chartId": chart_id, "chartName": chart["name"], "ok": False, "retainedPrevious": True,
            "lastAttemptAt": checked_at, "error": error,
        }

    public["configuration"] = {"source": config_meta["source"], "notionOk": config_meta["notionOk"], "notionError": config_meta["error"]}
    public = finalize_public_payload(public, config, checked_at)
    status = {
        "schemaVersion": 1,
        "generatedAt": checked_at,
        "workflow": "Sync Korean Charts",
        "ok": not failures,
        "partial": bool(failures),
        "successfulCharts": sorted(successes),
        "failedCharts": failures,
        "configuration": public.get("configuration"),
        "sourceStatus": public.get("sourceStatus"),
    }
    if args.dry_run:
        print(json.dumps(status, ensure_ascii=False, indent=2))
        return 0
    atomic_write_json(PUBLIC_PATH, public)
    PUBLIC_JS_PATH.write_text(json_to_js("RESCENE_KOREAN_CHARTS", public), encoding="utf-8")
    atomic_write_json(STATUS_PATH, status)
    print(f"公開データ更新完了: chart-in={public['summary']['inChartCount']} / source success={len(successes)} / failure={len(failures)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
