#!/usr/bin/env python3
"""Historical chart parsing and merge helpers used by the one-time Guyso backfill."""
from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any

from bs4 import BeautifulSoup

from korean_chart_core import KST, compact, safe_int, summarize_history

GUYSO_BASE = "https://xn--o39an51b2re.com"
GUYSO_SOURCE = {
    "id": "guyso",
    "name": "가이섬",
    "url": GUYSO_BASE,
    "role": "historical-backfill",
}

# Stable Melon song IDs for the RESCENE songs currently managed by this site.
# These are only a fallback when Guyso's artist list is rendered client-side or
# returns a bot-reduced page. Every candidate is validated against the detail
# page title/release date before history is imported.
RESCENE_MELON_FALLBACK_IDS: dict[str, str] = {
    "uhuh": "37348529",
    "yoyo": "37348528",
    "love-attack": "37928381",
    "pinball": "37928383",
    "glow-up": "38522796",
    "deja-vu": "39231685",
    "heart-drop": "600442746",
    "bloom": "600568257",
    "busy-boy": "601395707",
    "runaway": "601719493",
    "pretty-girl": "602450078",
}

HISTORY_ROUTE_PATTERNS: dict[str, re.Pattern[str]] = {
    "melon": re.compile(r"/chart/melon/top100/trend/ranking/[^/?#]+"),
    "genie": re.compile(r"/chart/genie/realtime/trend/ranking/[^/?#]+"),
    "flo": re.compile(r"/chart/flo/24hour/trend/ranking/[^/?#]+"),
    "bugs": re.compile(r"/chart/bugs/realtime/trend/ranking/[^/?#]+"),
    "vibe": re.compile(r"/chart/vibe/daily/trend/ranking/[^/?#]+"),
    "youtube-kr": re.compile(r"/chart/youtube/track-weekly/trend/ranking/[^/?#]+"),
}


def absolute_url(href: str) -> str:
    href = str(href or "").strip()
    if href.startswith("http://") or href.startswith("https://"):
        return href
    return GUYSO_BASE + (href if href.startswith("/") else "/" + href)


def parse_release_date(html: str) -> str:
    text = BeautifulSoup(html, "html.parser").get_text(" ", strip=True)
    match = re.search(r"발매\s+(\d{4})[.\-/](\d{2})[.\-/](\d{2})", text)
    return "-".join(match.groups()) if match else ""


def _candidate_title(element: Any) -> str:
    """Best-effort title extraction from a song card/row."""
    image = element.find("img") if hasattr(element, "find") else None
    for value in (
        image.get("alt") if image else "",
        element.get("data-title") if hasattr(element, "get") else "",
        element.get("title") if hasattr(element, "get") else "",
    ):
        value = str(value or "").strip()
        if value:
            return value
    text = element.get_text(" ", strip=True) if hasattr(element, "get_text") else ""
    text = re.sub(r"\bRESCENE\s*\(리센느\).*", "", text, flags=re.I).strip()
    return text


def _walk_json_song_routes(node: Any, add: Any) -> None:
    """Find title + /song/melon/<id> pairs inside one JSON object."""
    if isinstance(node, dict):
        title = ""
        for key in ("songName", "title", "name", "trackName"):
            value = node.get(key)
            if isinstance(value, str) and value.strip():
                title = value.strip()
                break
        routes: list[str] = []
        for value in node.values():
            if isinstance(value, str):
                routes.extend(match.group(0) for match in re.finditer(r"/song/melon/\d+", value))
        if title:
            for route in routes:
                add(title, route)
        for value in node.values():
            _walk_json_song_routes(value, add)
    elif isinstance(node, list):
        for value in node:
            _walk_json_song_routes(value, add)


def discover_melon_song_candidates(html: str) -> dict[str, list[str]]:
    """Discover song detail URLs from normal links, JS attributes and JSON."""
    soup = BeautifulSoup(html, "html.parser")
    found: dict[str, list[str]] = {}

    def add(title: str, href: str) -> None:
        route_match = re.search(r"/song/melon/\d+", str(href or ""))
        if not route_match:
            return
        key = compact(title)
        if not key:
            return
        url = absolute_url(route_match.group(0))
        if url not in found.setdefault(key, []):
            found[key].append(url)

    # Traditional anchors.
    for anchor in soup.select('a[href*="/song/melon/"]'):
        add(_candidate_title(anchor), str(anchor.get("href") or ""))

    # Some Guyso layouts keep the route in onclick/data-* attributes rather
    # than href. Inspect all attributes and use the closest card/row text.
    for element in soup.find_all(True):
        attrs = getattr(element, "attrs", {}) or {}
        values: list[str] = []
        for raw in attrs.values():
            if isinstance(raw, (list, tuple)):
                values.extend(str(item) for item in raw)
            else:
                values.append(str(raw))
        joined = " ".join(values)
        if "/song/melon/" not in joined:
            continue
        container = element.find_parent(["tr", "li", "article"]) or element.find_parent("div") or element
        for match in re.finditer(r"/song/melon/\d+", joined):
            add(_candidate_title(container), match.group(0))

    # Parse framework state/scripts as real JSON where possible. Keeping the
    # pairing inside the same JSON object avoids associating one title with a
    # different song route elsewhere in a large hydration payload.
    for script in soup.find_all("script"):
        raw = script.string if script.string is not None else script.get_text("", strip=False)
        raw = str(raw or "").strip()
        if not raw or "/song/melon/" not in raw:
            continue
        candidates = [raw]
        # Common assignment wrappers: window.__DATA__ = {...};
        first_brace = raw.find("{")
        last_brace = raw.rfind("}")
        if 0 <= first_brace < last_brace:
            candidates.append(raw[first_brace:last_brace + 1])
        parsed = False
        for candidate in candidates:
            try:
                payload = json.loads(candidate)
            except (json.JSONDecodeError, TypeError):
                continue
            _walk_json_song_routes(payload, add)
            parsed = True
            break
        if parsed:
            continue

        # Conservative fallback for JavaScript object literals. Do not cross
        # object boundaries, which could mismatch titles and routes.
        object_chunks = re.findall(r"\{[^{}]{0,1200}/song/melon/\d+[^{}]{0,1200}\}", raw, flags=re.S)
        for chunk in object_chunks:
            route = re.search(r"/song/melon/\d+", chunk)
            title_match = re.search(
                r'["\'](?:songName|title|name|trackName)["\']\s*:\s*["\']([^"\']+)["\']',
                chunk,
                flags=re.I,
            )
            if route and title_match:
                add(title_match.group(1), route.group(0))

    return found


def fallback_song_candidates(song: dict[str, Any]) -> list[str]:
    """Return explicit/known Melon detail URLs, ordered by strongest signal."""
    identifiers: list[str] = []
    external = str((song.get("externalIds") or {}).get("melon") or "").strip()
    match = re.search(r"(\d{5,})", external)
    if match:
        identifiers.append(match.group(1))
    fallback = RESCENE_MELON_FALLBACK_IDS.get(str(song.get("id") or ""))
    if fallback and fallback not in identifiers:
        identifiers.append(fallback)
    return [f"{GUYSO_BASE}/song/melon/{identifier}" for identifier in identifiers]


def parse_song_title(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    title_text = soup.title.get_text(" ", strip=True) if soup.title else ""
    match = re.search(r"곡 상세정보\s*>\s*(.+?)\s*-\s*RESCENE", title_text, flags=re.I)
    if match:
        return match.group(1).strip()
    text = soup.get_text(" ", strip=True)
    match = re.search(r"\bTITLE\s+(.+?)\s+RESCENE\s*\(리센느\)", text, flags=re.I)
    return match.group(1).strip() if match else ""


def select_song_candidates(song: dict[str, Any], discovered: dict[str, list[str]]) -> list[str]:
    keys = {compact(song.get("title"))}
    keys.update(compact(alias) for alias in song.get("aliases", []) if compact(alias))
    candidates: list[str] = []
    for key in keys:
        for url in discovered.get(key, []):
            if url not in candidates:
                candidates.append(url)
    return candidates


def discover_history_links(html: str) -> dict[str, str]:
    """Find historical trend routes in links, data attributes or hydration HTML."""
    soup = BeautifulSoup(html, "html.parser")
    links: dict[str, str] = {}

    def inspect(value: str) -> None:
        for chart_id, pattern in HISTORY_ROUTE_PATTERNS.items():
            match = pattern.search(str(value or ""))
            if match and chart_id not in links:
                links[chart_id] = absolute_url(match.group(0))

    for element in soup.find_all(True):
        attrs = getattr(element, "attrs", {}) or {}
        for raw in attrs.values():
            if isinstance(raw, (list, tuple)):
                for item in raw:
                    inspect(str(item))
            else:
                inspect(str(raw))

    # Client-rendered builds can leave routes only inside serialized script data.
    inspect(html)
    return links


def _table_rows(html: str) -> list[list[str]]:
    soup = BeautifulSoup(html, "html.parser")
    candidates: list[list[list[str]]] = []
    for table in soup.find_all("table"):
        rows: list[list[str]] = []
        for row in table.find_all("tr"):
            cells = row.find_all(["th", "td"], recursive=False)
            if not cells:
                cells = row.find_all(["th", "td"])
            values = [cell.get_text(" ", strip=True) for cell in cells]
            if values:
                rows.append(values)
        if rows:
            candidates.append(rows)
    if not candidates:
        return []
    # Historical tables contain far more data rows than navigation/summary tables.
    return max(candidates, key=lambda rows: sum(1 for row in rows if row and re.fullmatch(r"\d{4,8}", re.sub(r"\D", "", row[0]))))


def _rank(value: Any, max_rank: int) -> int | None:
    parsed = safe_int(str(value or "").replace(",", ""))
    return parsed if parsed is not None and 1 <= parsed <= max_rank else None


def parse_hourly_matrix(html: str, *, max_rank: int, source_url: str) -> list[dict[str, Any]]:
    rows = _table_rows(html)
    points: list[dict[str, Any]] = []
    for row in rows:
        if not row:
            continue
        date_digits = re.sub(r"\D", "", row[0])
        if not re.fullmatch(r"\d{8}", date_digits):
            continue
        try:
            date_value = datetime.strptime(date_digits, "%Y%m%d")
        except ValueError:
            continue
        # Guyso matrix uses one date column followed by 0–23 hour columns.
        values = row[1:25]
        if len(values) < 24:
            values += [""] * (24 - len(values))
        for hour, value in enumerate(values[:24]):
            rank = _rank(value, max_rank)
            if rank is None:
                continue
            chart_at = date_value.replace(hour=hour, tzinfo=KST).isoformat()
            points.append({
                "chartAt": chart_at,
                "rank": rank,
                "origin": "guyso",
                "sourceName": "가이섬",
                "sourceUrl": source_url,
            })
    return sorted(points, key=lambda point: point["chartAt"])


def parse_daily_history(html: str, *, max_rank: int, source_url: str) -> list[dict[str, Any]]:
    rows = _table_rows(html)
    points: list[dict[str, Any]] = []
    for row in rows:
        if len(row) < 2:
            continue
        date_digits = re.sub(r"\D", "", row[0])
        if not re.fullmatch(r"\d{8}", date_digits):
            continue
        rank = next((_rank(value, max_rank) for value in row[1:] if _rank(value, max_rank) is not None), None)
        if rank is None:
            continue
        try:
            date_value = datetime.strptime(date_digits, "%Y%m%d").replace(tzinfo=KST)
        except ValueError:
            continue
        points.append({
            "chartAt": date_value.isoformat(),
            "rank": rank,
            "origin": "guyso",
            "sourceName": "가이섬",
            "sourceUrl": source_url,
        })
    return sorted(points, key=lambda point: point["chartAt"])


def parse_weekly_youtube(html: str, *, max_rank: int, source_url: str) -> list[dict[str, Any]]:
    rows = _table_rows(html)
    points: list[dict[str, Any]] = []
    for row in rows:
        if len(row) < 3:
            continue
        year = safe_int(re.sub(r"\D", "", row[0]))
        week = safe_int(re.sub(r"\D", "", row[1]))
        rank = _rank(row[2], max_rank)
        if year is None or week is None or rank is None or not (2000 <= year <= 2100 and 1 <= week <= 53):
            continue
        try:
            week_start = datetime.fromisocalendar(year, week, 1).replace(tzinfo=KST)
        except ValueError:
            continue
        point: dict[str, Any] = {
            "chartAt": week_start.isoformat(),
            "rank": rank,
            "origin": "guyso",
            "sourceName": "가이섬",
            "sourceUrl": source_url,
            "isoYear": year,
            "isoWeek": week,
        }
        if len(row) >= 4:
            views = safe_int(str(row[3]).replace(",", ""))
            if views is not None:
                point["views"] = views
        points.append(point)
    return sorted(points, key=lambda point: point["chartAt"])


def parse_history_page(chart_id: str, html: str, *, max_rank: int, source_url: str) -> list[dict[str, Any]]:
    if chart_id in {"melon", "genie", "bugs", "flo"}:
        return parse_hourly_matrix(html, max_rank=max_rank, source_url=source_url)
    if chart_id == "vibe":
        return parse_daily_history(html, max_rank=max_rank, source_url=source_url)
    if chart_id == "youtube-kr":
        return parse_weekly_youtube(html, max_rank=max_rank, source_url=source_url)
    return []


def merge_historical_points(history: dict[str, Any], incoming: list[dict[str, Any]], *, checked_at: str) -> tuple[int, int]:
    """Merge backfill points without replacing live/official observations."""
    existing = [point for point in history.get("points", []) if isinstance(point, dict) and point.get("chartAt")]
    by_time = {str(point["chartAt"]): dict(point) for point in existing}
    added = 0
    updated = 0
    for raw in incoming:
        chart_at = str(raw.get("chartAt") or "")
        rank = safe_int(raw.get("rank"))
        if not chart_at or rank is None:
            continue
        candidate = dict(raw)
        candidate["checkedAt"] = checked_at
        previous = by_time.get(chart_at)
        if previous is None:
            by_time[chart_at] = candidate
            added += 1
        elif previous.get("origin") == "guyso" and safe_int(previous.get("rank")) != rank:
            by_time[chart_at] = candidate
            updated += 1
        # A live/official observation always wins on an identical chart period.
    points = sorted(by_time.values(), key=lambda point: str(point.get("chartAt") or ""))
    history["points"] = points
    history["summary"] = {
        **summarize_history(points),
        **{key: value for key, value in (history.get("summary") or {}).items() if key in {"currentRank", "status"}},
        "pointCount": len(points),
    }
    sources = [source for source in history.get("sources", []) if isinstance(source, dict) and source.get("id") != "guyso"]
    if incoming:
        sources.append(dict(GUYSO_SOURCE))
    history["sources"] = sources
    return added, updated


def extract_spotify_tracks_from_json(value: Any) -> list[dict[str, Any]]:
    """Find the longest ordered track sequence in Spotify embed JSON."""
    sequences: list[list[dict[str, Any]]] = []

    def artist_text(raw: Any) -> str:
        if isinstance(raw, str):
            return raw.strip()
        if isinstance(raw, dict):
            return str(raw.get("name") or raw.get("title") or "").strip()
        if isinstance(raw, list):
            return ", ".join(filter(None, (artist_text(item) for item in raw)))
        return ""

    def normalize(raw: Any) -> dict[str, Any] | None:
        if not isinstance(raw, dict):
            return None
        track = raw.get("track") if isinstance(raw.get("track"), dict) else raw
        name = str(track.get("name") or track.get("title") or "").strip()
        artists = artist_text(track.get("artists") or track.get("artist") or track.get("subtitle"))
        identifier = str(track.get("id") or track.get("uri") or track.get("trackUri") or "").strip()
        if not name or not artists:
            return None
        if identifier.startswith("spotify:track:"):
            identifier = identifier.rsplit(":", 1)[-1]
        return {"id": identifier, "title": name, "artist": artists}

    def walk(node: Any) -> None:
        if isinstance(node, list):
            normalized = [normalize(item) for item in node]
            valid = [item for item in normalized if item]
            if len(valid) >= 10:
                sequences.append(valid)
            for child in node:
                walk(child)
        elif isinstance(node, dict):
            for child in node.values():
                walk(child)

    walk(value)
    return max(sequences, key=len) if sequences else []


def parse_spotify_embed_html(html: str, *, max_rank: int = 50) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html, "html.parser")
    tracks: list[dict[str, Any]] = []
    seen: set[str] = set()

    selectors = '[data-testid="tracklist-row"], li, [role="row"]'
    for row in soup.select(selectors):
        track_link = row.select_one('a[href*="/track/"]')
        if not track_link:
            continue
        href = str(track_link.get("href") or "")
        match = re.search(r"/track/([A-Za-z0-9]+)", href)
        track_id = match.group(1) if match else ""
        title = track_link.get_text(" ", strip=True) or str(track_link.get("aria-label") or "").strip()
        artist_links = row.select('a[href*="/artist/"]')
        artist = ", ".join(dict.fromkeys(link.get_text(" ", strip=True) for link in artist_links if link.get_text(" ", strip=True)))
        if title and artist and (track_id or compact(title + artist)) not in seen:
            key = track_id or compact(title + artist)
            seen.add(key)
            tracks.append({"id": track_id, "title": title, "artist": artist})
            if len(tracks) >= max_rank:
                break

    if len(tracks) < min(10, max_rank):
        json_tracks: list[dict[str, Any]] = []
        for script in soup.find_all("script"):
            raw = script.string or script.get_text()
            if not raw or (not raw.lstrip().startswith("{") and not raw.lstrip().startswith("[")):
                continue
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                continue
            candidate = extract_spotify_tracks_from_json(payload)
            if len(candidate) > len(json_tracks):
                json_tracks = candidate
        if len(json_tracks) > len(tracks):
            tracks = json_tracks[:max_rank]

    return [{**track, "rank": index} for index, track in enumerate(tracks[:max_rank], 1)]
