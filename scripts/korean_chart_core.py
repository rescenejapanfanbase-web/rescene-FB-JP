#!/usr/bin/env python3
"""Shared configuration, matching, parsing, and state helpers for Korean charts."""
from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

KST = timezone(timedelta(hours=9))
SCHEMA_VERSION = 1

DEFAULT_CHARTS: list[dict[str, Any]] = [
    {"id": "melon", "name": "Melon TOP100", "shortName": "Melon", "cadence": "hourly", "maxRank": 100, "enabled": True, "published": True, "order": 10, "sourceMode": "mobile-api"},
    {"id": "genie", "name": "Genie Real-time", "shortName": "Genie", "cadence": "hourly", "maxRank": 200, "enabled": True, "published": True, "order": 20, "sourceMode": "mobile-api"},
    {"id": "bugs", "name": "Bugs Real-time", "shortName": "Bugs", "cadence": "hourly", "maxRank": 100, "enabled": True, "published": True, "order": 30, "sourceMode": "mobile-api"},
    {"id": "flo", "name": "FLO Chart", "shortName": "FLO", "cadence": "hourly", "maxRank": 100, "enabled": True, "published": True, "order": 40, "sourceMode": "mobile-api"},
    {"id": "vibe", "name": "VIBE Today TOP 100", "shortName": "VIBE", "cadence": "daily", "maxRank": 100, "enabled": True, "published": True, "order": 50, "sourceMode": "web-api"},
    {"id": "youtube-kr", "name": "YouTube Music Korea Top Songs", "shortName": "YouTube Music", "cadence": "weekly", "maxRank": 100, "enabled": True, "published": True, "order": 60, "sourceMode": "official-playlist"},
    {"id": "spotify-kr", "name": "Spotify Top 50 South Korea", "shortName": "Spotify", "cadence": "daily", "maxRank": 50, "enabled": True, "published": True, "order": 70, "sourceMode": "official-playlist"},
]

CHART_ALIASES = {
    "melon": "melon", "メロン": "melon", "멜론": "melon", "melontop100": "melon",
    "genie": "genie", "ジニー": "genie", "지니": "genie",
    "bugs": "bugs", "bugs!": "bugs", "バグス": "bugs", "벅스": "bugs",
    "flo": "flo", "フロー": "flo", "플로": "flo",
    "vibe": "vibe", "バイブ": "vibe", "바이브": "vibe",
    "youtube": "youtube-kr", "youtubemusic": "youtube-kr", "youtubemusickorea": "youtube-kr", "youtube-kr": "youtube-kr", "유튜브뮤직": "youtube-kr",
    "spotify": "spotify-kr", "spotifykorea": "spotify-kr", "spotify-kr": "spotify-kr", "스포티파이": "spotify-kr",
}


def now_kst() -> datetime:
    return datetime.now(KST).replace(microsecond=0)


def iso_kst(value: datetime | None = None) -> str:
    return (value or now_kst()).astimezone(KST).replace(microsecond=0).isoformat()


def compact(value: Any) -> str:
    return re.sub(r"[^0-9a-z가-힣ぁ-んァ-ヶ一-龠]+", "", unicodedata.normalize("NFKC", str(value or "")).lower())


def slugify(value: str, fallback: str = "song") -> str:
    base = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower()
    base = re.sub(r"[^a-z0-9]+", "-", base).strip("-")
    if base:
        return base[:72]
    digest = hashlib.sha1(value.encode("utf-8")).hexdigest()[:10]
    return f"{fallback}-{digest}"


def split_values(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        rows: list[str] = []
        for item in value:
            if isinstance(item, dict):
                rows.append(str(item.get("name") or item.get("plain_text") or ""))
            else:
                rows.append(str(item))
        return [x.strip() for x in rows if x.strip()]
    return [x.strip() for x in re.split(r"[|｜,，、;；\n]+", str(value)) if x.strip()]


def canonical_chart_id(value: Any) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    key = compact(raw)
    return CHART_ALIASES.get(key, raw.lower().replace("_", "-"))


def safe_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    try:
        if value in (None, ""):
            return None
        return int(float(str(value).replace("#", "").replace("位", "").strip()))
    except (TypeError, ValueError):
        return None


def parse_datetime(value: Any, fallback: datetime | None = None) -> datetime:
    if isinstance(value, datetime):
        return value.astimezone(KST)
    fallback_dt = (fallback or now_kst()).astimezone(KST)
    text = str(value or "").strip()
    if text:
        # Bugs and VIBE return Unix timestamps in milliseconds.
        if re.fullmatch(r"\d{10,16}(?:\.\d+)?", text):
            try:
                timestamp = float(text)
                if timestamp >= 10_000_000_000:
                    timestamp /= 1000
                return datetime.fromtimestamp(timestamp, timezone.utc).astimezone(KST)
            except (ValueError, OSError, OverflowError):
                pass
        # Genie sometimes exposes only HH:MM; retain the fetched KST date.
        if re.fullmatch(r"\d{1,2}:\d{2}", text):
            try:
                parsed_time = datetime.strptime(text, "%H:%M").time()
                return fallback_dt.replace(hour=parsed_time.hour, minute=parsed_time.minute, second=0, microsecond=0)
            except ValueError:
                pass
        normalized = text.replace("Z", "+00:00")
        patterns = [
            None,
            "%Y.%m.%d %H:%M", "%Y-%m-%d %H:%M", "%Y%m%d%H", "%Y%m%d%H%M",
            "%Y.%m.%d", "%Y-%m-%d", "%Y%m%d",
        ]
        for pattern in patterns:
            try:
                parsed = datetime.fromisoformat(normalized) if pattern is None else datetime.strptime(text, pattern)
                if parsed.tzinfo is None:
                    parsed = parsed.replace(tzinfo=KST)
                return parsed.astimezone(KST)
            except (ValueError, TypeError):
                continue
    return fallback_dt


def cadence_key(chart_id: str, cadence: str, value: datetime | None = None) -> str:
    dt = (value or now_kst()).astimezone(KST)
    if cadence == "weekly":
        year, week, _ = dt.isocalendar()
        return f"{year}-W{week:02d}"
    if cadence == "daily":
        return dt.strftime("%Y-%m-%d")
    return dt.strftime("%Y-%m-%dT%H:00:00+09:00")


def normalize_chart_at(value: Any, chart: dict[str, Any], fallback: datetime | None = None) -> str:
    dt = parse_datetime(value, fallback)
    cadence = str(chart.get("cadence") or "hourly")
    if cadence == "weekly":
        monday = (dt - timedelta(days=dt.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
        return monday.isoformat()
    if cadence == "daily":
        return dt.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    return dt.replace(minute=0, second=0, microsecond=0).isoformat()


def default_config() -> dict[str, Any]:
    return {"schemaVersion": SCHEMA_VERSION, "generatedAt": iso_kst(), "source": "local-default", "charts": [dict(x) for x in DEFAULT_CHARTS], "songs": []}


def normalize_config(payload: dict[str, Any]) -> dict[str, Any]:
    defaults = {item["id"]: dict(item) for item in DEFAULT_CHARTS}
    chart_rows = payload.get("charts") if isinstance(payload.get("charts"), list) else []
    charts: list[dict[str, Any]] = []
    used: set[str] = set()
    for index, raw in enumerate(chart_rows):
        if not isinstance(raw, dict):
            continue
        chart_id = canonical_chart_id(raw.get("id") or raw.get("chartId") or raw.get("name"))
        if not chart_id or chart_id in used:
            continue
        base = defaults.get(chart_id, {"id": chart_id, "name": raw.get("name") or chart_id, "shortName": raw.get("shortName") or raw.get("name") or chart_id, "cadence": "hourly", "maxRank": 100, "enabled": True, "published": True, "order": 100 + index * 10, "sourceMode": "custom"})
        merged = {**base, **raw, "id": chart_id}
        merged["name"] = str(merged.get("name") or base["name"])
        merged["shortName"] = str(merged.get("shortName") or merged["name"])
        merged["cadence"] = str(merged.get("cadence") or "hourly").lower()
        merged["maxRank"] = safe_int(merged.get("maxRank")) or safe_int(base.get("maxRank")) or 100
        merged["order"] = safe_int(merged.get("order")) or 9999
        merged["enabled"] = bool(merged.get("enabled", True))
        merged["published"] = bool(merged.get("published", True))
        charts.append(merged)
        used.add(chart_id)
    for chart_id, base in defaults.items():
        if chart_id not in used:
            charts.append(base)
    charts.sort(key=lambda item: (item.get("order", 9999), item["id"]))

    valid_chart_ids = {item["id"] for item in charts}
    songs: list[dict[str, Any]] = []
    song_ids: set[str] = set()
    raw_songs = payload.get("songs") if isinstance(payload.get("songs"), list) else []
    for index, raw in enumerate(raw_songs):
        if not isinstance(raw, dict):
            continue
        title = str(raw.get("title") or raw.get("name") or "").strip()
        if not title:
            continue
        song_id = slugify(str(raw.get("id") or title), "song")
        if song_id in song_ids:
            song_id = f"{song_id}-{index + 1}"
        aliases = split_values(raw.get("aliases"))
        if title not in aliases:
            aliases.insert(0, title)
        chart_values = split_values(raw.get("charts"))
        chart_ids = [canonical_chart_id(item) for item in chart_values] if chart_values else list(valid_chart_ids)
        chart_ids = [item for item in chart_ids if item in valid_chart_ids]
        songs.append({
            "id": song_id,
            "title": title,
            "aliases": aliases,
            "artistAliases": split_values(raw.get("artistAliases")) or ["RESCENE", "리센느"],
            "charts": chart_ids,
            "published": bool(raw.get("published", True)),
            "order": safe_int(raw.get("order")) or (index + 1) * 10,
            "releaseDate": str(raw.get("releaseDate") or "")[:10],
            "externalIds": raw.get("externalIds") if isinstance(raw.get("externalIds"), dict) else {},
            "notionPageId": str(raw.get("notionPageId") or ""),
        })
        song_ids.add(song_id)
    songs.sort(key=lambda item: (item.get("order", 9999), item["title"].lower()))
    return {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": str(payload.get("generatedAt") or iso_kst()),
        "source": str(payload.get("source") or "unknown"),
        "dataSourceId": str(payload.get("dataSourceId") or ""),
        "charts": charts,
        "songs": songs,
    }


def match_song(entry: dict[str, Any], songs: Iterable[dict[str, Any]], chart_id: str) -> dict[str, Any] | None:
    entry_title = compact(entry.get("title"))
    entry_artist = compact(entry.get("artist"))
    entry_combined = compact(f"{entry.get('title') or ''} {entry.get('artist') or ''}")
    if not entry_title:
        return None
    for song in songs:
        if chart_id not in song.get("charts", []):
            continue
        external_id = str((song.get("externalIds") or {}).get(chart_id) or "").strip()
        if external_id and str(entry.get("id") or "").strip() == external_id:
            return song
        artist_aliases = [compact(x) for x in song.get("artistAliases", []) if compact(x)]
        artist_matches = not artist_aliases or any(alias in entry_artist for alias in artist_aliases)
        # YouTube chart playlist entries sometimes omit the uploader/artist from
        # flat-playlist metadata while retaining it in the video title. Include the
        # combined title/artist text for that source only.
        if chart_id == "youtube-kr" and artist_aliases:
            artist_matches = artist_matches or any(alias in entry_combined for alias in artist_aliases)
        if not artist_matches:
            continue
        aliases = [compact(x) for x in song.get("aliases", []) if compact(x)]
        if entry_title in aliases:
            return song
        # Official video titles often include decorations such as "Official M/V".
        # Once the artist is positively identified, a contained alias is safe.
        if chart_id == "youtube-kr" and any(len(alias) >= 4 and alias in entry_title for alias in aliases):
            return song
    return None


def empty_public_payload(config: dict[str, Any]) -> dict[str, Any]:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": iso_kst(),
        "configSource": config.get("source", "unknown"),
        "charts": config.get("charts", []),
        "songs": config.get("songs", []),
        "entries": [],
        "sourceStatus": {},
        "summary": {"publishedSongs": len([x for x in config.get("songs", []) if x.get("published")]), "chartCount": len([x for x in config.get("charts", []) if x.get("published")]), "inChartCount": 0, "freshSourceCount": 0, "staleSourceCount": 0},
    }


def history_path(root: Path, song_id: str, chart_id: str) -> Path:
    return root / "data" / "korean-chart-history" / f"{song_id}--{chart_id}.json"


def load_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def atomic_write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp.replace(path)


def make_entry(song: dict[str, Any], chart: dict[str, Any]) -> dict[str, Any]:
    return {
        "songId": song["id"], "songTitle": song["title"], "chartId": chart["id"], "chartName": chart["name"],
        "currentRank": None, "previousRank": None, "movement": None, "movementType": "untracked", "status": "untracked",
        "peakRank": None, "firstChartedAt": "", "lastChartedAt": "", "chartDays": 0,
        "outOfChartCount": 0, "outOfChartHistory": [], "lastCheckedAt": "", "chartAt": "",
        "historyPath": f"data/korean-chart-history/{song['id']}--{chart['id']}.json",
    }


def summarize_history(points: list[dict[str, Any]]) -> dict[str, Any]:
    ranked = [p for p in points if safe_int(p.get("rank")) is not None]
    peak = min((safe_int(p.get("rank")) for p in ranked), default=None)
    dates = {str(p.get("chartAt") or "")[:10] for p in ranked if p.get("chartAt")}
    return {
        "peakRank": peak,
        "firstChartedAt": str(ranked[0].get("chartAt") or "") if ranked else "",
        "lastChartedAt": str(ranked[-1].get("chartAt") or "") if ranked else "",
        "chartDays": len(dates),
    }


def append_observation(
    history: dict[str, Any],
    *,
    rank: int | None,
    chart_at: str,
    checked_at: str,
    source_rank: int | None = None,
    source_metadata: dict[str, Any] | None = None,
) -> bool:
    points = history.setdefault("points", [])
    observation = {"chartAt": chart_at, "checkedAt": checked_at, "rank": rank}
    if source_rank is not None:
        observation["sourceRank"] = source_rank
    if source_metadata:
        observation.update({key: value for key, value in source_metadata.items() if value not in (None, "")})
    if points:
        last = points[-1]
        if last.get("chartAt") == chart_at:
            same_rank = safe_int(last.get("rank")) == rank
            # One canonical observation per native chart period. A corrected value
            # replaces the latest observation instead of creating a duplicate.
            last.clear()
            last.update(observation)
            return not same_rank
    points.append(observation)
    return True


def update_out_of_chart_ranges(history: dict[str, Any], *, rank: int | None, chart_at: str, checked_at: str) -> None:
    ranges = history.setdefault("outOfChartHistory", [])
    if rank is None:
        if ranges and not ranges[-1].get("endAt"):
            ranges[-1]["lastObservedAt"] = chart_at
            ranges[-1]["lastCheckedAt"] = checked_at
            ranges[-1]["observations"] = int(ranges[-1].get("observations") or 0) + 1
        else:
            ranges.append({"startAt": chart_at, "endAt": "", "lastObservedAt": chart_at, "lastCheckedAt": checked_at, "observations": 1})
    elif ranges and not ranges[-1].get("endAt"):
        ranges[-1]["endAt"] = chart_at
        ranges[-1]["lastCheckedAt"] = checked_at


def apply_successful_chart(
    root: Path,
    public_payload: dict[str, Any],
    config: dict[str, Any],
    chart: dict[str, Any],
    source_items: list[dict[str, Any]],
    chart_at: str,
    checked_at: str,
) -> tuple[list[dict[str, Any]], int]:
    old_entries = {(x.get("songId"), x.get("chartId")): x for x in public_payload.get("entries", []) if isinstance(x, dict)}
    updated: list[dict[str, Any]] = []
    matched_count = 0
    for song in config.get("songs", []):
        if chart["id"] not in song.get("charts", []):
            continue
        prior = dict(old_entries.get((song["id"], chart["id"])) or make_entry(song, chart))
        matched = None
        for item in source_items:
            if match_song(item, [song], chart["id"]):
                matched = item
                break
        rank = safe_int(matched.get("rank")) if matched else None
        if rank is not None and not (1 <= rank <= int(chart.get("maxRank") or 1000)):
            rank = None
        if rank is not None:
            matched_count += 1
        hpath = history_path(root, song["id"], chart["id"])
        history = load_json(hpath, {"schemaVersion": SCHEMA_VERSION, "songId": song["id"], "songTitle": song["title"], "chartId": chart["id"], "chartName": chart["name"], "points": [], "outOfChartHistory": []})
        previous_rank = safe_int(prior.get("currentRank")) if prior.get("status") in {"in", "out"} else None
        source_metadata = {}
        if matched:
            source_metadata = {
                key: matched.get(key)
                for key in ("origin", "sourceName", "sourceUrl", "views")
                if matched.get(key) not in (None, "")
            }
        changed = append_observation(
            history,
            rank=rank,
            chart_at=chart_at,
            checked_at=checked_at,
            source_rank=safe_int(matched.get("rank")) if matched else None,
            source_metadata=source_metadata,
        )
        if changed or not hpath.exists():
            update_out_of_chart_ranges(history, rank=rank, chart_at=chart_at, checked_at=checked_at)
        stats = summarize_history(history.get("points", []))
        if rank is None:
            movement = None
            movement_type = "out" if previous_rank is not None else "stay-out"
            status = "out"
        elif previous_rank is None:
            movement = None
            movement_type = "new" if not prior.get("firstChartedAt") else "reentry"
            status = "in"
        else:
            movement = previous_rank - rank
            movement_type = "up" if movement > 0 else "down" if movement < 0 else "same"
            status = "in"
        prior.update({
            "songId": song["id"], "songTitle": song["title"], "chartId": chart["id"], "chartName": chart["name"],
            "currentRank": rank, "previousRank": previous_rank, "movement": movement, "movementType": movement_type, "status": status,
            **stats,
            "outOfChartCount": len(history.get("outOfChartHistory", [])),
            "outOfChartHistory": history.get("outOfChartHistory", [])[-20:],
            "lastCheckedAt": checked_at, "chartAt": chart_at,
            "historyPath": f"data/korean-chart-history/{song['id']}--{chart['id']}.json",
        })
        history["generatedAt"] = checked_at
        history["songTitle"] = song["title"]
        history["chartName"] = chart["name"]
        history["summary"] = {**stats, "currentRank": rank, "status": status, "pointCount": len(history.get("points", []))}
        if changed or not hpath.exists():
            atomic_write_json(hpath, history)
        updated.append(prior)
    return updated, matched_count


def merge_chart_entries(public_payload: dict[str, Any], chart_id: str, replacements: list[dict[str, Any]]) -> None:
    kept = [item for item in public_payload.get("entries", []) if item.get("chartId") != chart_id]
    public_payload["entries"] = kept + replacements


def finalize_public_payload(public_payload: dict[str, Any], config: dict[str, Any], checked_at: str) -> dict[str, Any]:
    published_song_ids = {x["id"] for x in config.get("songs", []) if x.get("published")}
    published_chart_ids = {x["id"] for x in config.get("charts", []) if x.get("published")}
    public_payload["schemaVersion"] = SCHEMA_VERSION
    public_payload["generatedAt"] = checked_at
    public_payload["configSource"] = config.get("source", "unknown")
    public_payload["charts"] = config.get("charts", [])
    public_payload["songs"] = config.get("songs", [])
    public_payload["entries"] = sorted(
        [x for x in public_payload.get("entries", []) if x.get("songId") in published_song_ids and x.get("chartId") in published_chart_ids],
        key=lambda x: (
            next((c.get("order", 9999) for c in config.get("charts", []) if c["id"] == x.get("chartId")), 9999),
            next((s.get("order", 9999) for s in config.get("songs", []) if s["id"] == x.get("songId")), 9999),
        ),
    )
    status_values = list((public_payload.get("sourceStatus") or {}).values())
    public_payload["summary"] = {
        "publishedSongs": len(published_song_ids),
        "chartCount": len(published_chart_ids),
        "inChartCount": len([x for x in public_payload["entries"] if x.get("status") == "in"]),
        "freshSourceCount": len([x for x in status_values if x.get("ok")]),
        "staleSourceCount": len([x for x in status_values if not x.get("ok")]),
    }
    return public_payload


def json_to_js(variable: str, payload: Any) -> str:
    return f"window.{variable} = " + json.dumps(payload, ensure_ascii=False, indent=2) + ";\n"


@dataclass
class SourceResult:
    chart_id: str
    chart_at: str
    items: list[dict[str, Any]]
    metadata: dict[str, Any]
