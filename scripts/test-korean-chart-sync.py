#!/usr/bin/env python3
"""Offline regression tests for Korean chart parsing and state retention."""
from __future__ import annotations

import json
import tempfile
from datetime import datetime
from pathlib import Path

from korean_chart_core import KST, apply_successful_chart, empty_public_payload, finalize_public_payload, match_song, normalize_config
import importlib.util

_sync_path = Path(__file__).with_name("sync-korean-charts.py")
_spec = importlib.util.spec_from_file_location("sync_korean_charts", _sync_path)
_sync = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(_sync)
parse_bugs = _sync.parse_bugs
parse_flo = _sync.parse_flo
parse_genie = _sync.parse_genie
parse_melon = _sync.parse_melon
parse_vibe = _sync.parse_vibe
parse_guyso_youtube_rescene_rows = _sync.parse_guyso_youtube_rescene_rows
youtube_title_artist = _sync.youtube_title_artist

NOW = datetime(2026, 8, 1, 11, 0, tzinfo=KST)


def assert_equal(actual, expected, label):
    if actual != expected:
        raise AssertionError(f"{label}: expected={expected!r} actual={actual!r}")


def chart(chart_id):
    return next(x for x in normalize_config({"charts": [], "songs": []})["charts"] if x["id"] == chart_id)


def parser_tests():
    melon = parse_melon({"RANKDAY": "2026.08.01", "RANKHOUR": "11:00", "SONGLIST": [
        {"SONGID": "m1", "CURRANK": 1, "PASTRANK": 2, "SONGNAME": "Pretty Girl", "ARTISTLIST": [{"ARTISTNAME": "RESCENE"}]},
        *[{"CURRANK": i, "SONGNAME": f"Other {i}", "ARTISTLIST": [{"ARTISTNAME": "Other"}]} for i in range(2, 26)],
    ]}, chart("melon"), NOW)
    assert_equal(melon.items[0]["title"], "Pretty Girl", "Melon title")
    assert_equal(melon.items[0]["rank"], 1, "Melon rank")
    assert melon.chart_at.startswith("2026-08-01T11")

    genie = parse_genie({"PageInfo": {"ChartTime": "11:00"}, "DataSet": {"DATA": [
        {"SONG_ID": "g1", "RANK_NO": 1, "PRE_RANK_NO": 3, "SONG_NAME": "Pretty Girl", "ARTIST_NAME": "RESCENE"},
        *[{"RANK_NO": i, "SONG_NAME": f"Other {i}", "ARTIST_NAME": "Other"} for i in range(2, 26)],
    ]}}, chart("genie"), NOW)
    assert_equal(genie.items[0]["artist"], "RESCENE", "Genie artist")
    assert genie.chart_at.startswith("2026-08-01T11")

    # Genie Daily uses the shared period endpoint with ditc=D. The former
    # invented j_DailyRankSongList endpoint returned HTTP 405.
    captured = {}
    original_request_json = _sync.request_json
    try:
        def fake_request_json(url, **kwargs):
            captured.update({"url": url, **kwargs})
            return {"PageInfo": {"ChartTime": None}, "DataSet": {"DATA": [
                {"SONG_ID": "gd1", "RANK_NO": 1, "PRE_RANK_NO": 2, "SONG_NAME": "Pretty Girl", "ARTIST_NAME": "RESCENE"},
                *[{"RANK_NO": i, "SONG_NAME": f"Other {i}", "ARTIST_NAME": "Other"} for i in range(2, 26)],
            ]}}
        _sync.request_json = fake_request_json
        daily = _sync.fetch_genie_daily(chart("genie-daily"), NOW)
    finally:
        _sync.request_json = original_request_json
    assert_equal(captured["url"], "https://app.genie.co.kr/chart/j_RankSongList.json", "Genie Daily endpoint")
    assert_equal(captured["method"], "POST", "Genie Daily method")
    assert_equal(captured["form"].get("ditc"), "D", "Genie Daily ditc")
    assert_equal(daily.items[0]["title"], "Pretty Girl", "Genie Daily title")
    assert_equal(daily.metadata.get("period"), "daily", "Genie Daily period metadata")

    bugs = parse_bugs({"info": {"end_dt": 1785549600000}, "list": [
        {"track_id": "b1", "track_title": "Pretty Girl", "artists": [{"artist_nm": "RESCENE"}], "list_attr": {"rank": 1, "rank_last": 2, "rank_peak": 1}},
        *[{"track_title": f"Other {i}", "artists": [{"artist_nm": "Other"}], "list_attr": {"rank": i}} for i in range(2, 26)],
    ]}, chart("bugs"), NOW)
    assert_equal(bugs.items[0]["peakRank"], 1, "Bugs peak")
    assert bugs.chart_at.startswith("2026-08-01T11")

    flo = parse_flo({"data": {"name": "FLO Chart", "trackList": [
        {"id": "f1", "name": "Pretty Girl", "representationArtist": {"name": "RESCENE"}, "rank": {"rank": 1}},
        *[{"id": f"f{i}", "name": f"Other {i}", "representationArtist": {"name": "Other"}, "rank": {"rank": i}} for i in range(2, 26)],
    ]}}, chart("flo"), NOW)
    assert_equal(flo.items[0]["title"], "Pretty Girl", "FLO title")

    vibe = parse_vibe({"response": {"result": {"chart": {"date": 1785549600000, "items": {"tracks": [
        {"trackId": "v1", "trackTitle": "Pretty Girl", "artists": [{"artistName": "RESCENE"}], "rank": {"currentRank": 1, "rankVariation": 2, "isNew": False}},
        *[{"trackId": f"v{i}", "trackTitle": f"Other {i}", "artists": [{"artistName": "Other"}], "rank": {"currentRank": i, "rankVariation": 0}} for i in range(2, 26)],
    ]}}}}}, chart("vibe"), NOW)
    assert_equal(vibe.items[0]["rank"], 1, "VIBE rank")
    assert_equal(vibe.items[0]["previousRank"], 3, "VIBE previous rank")
    assert vibe.chart_at.startswith("2026-08-01")

    title, artist = youtube_title_artist({"title": "RESCENE(리센느) 'Pretty Girl' Official M/V", "channel": "RESCENE"})
    assert_equal(title, "Pretty Girl", "YouTube decorated title")
    assert "RESCENE" in artist
    title, artist = youtube_title_artist({"title": "[MV] RESCENE(리센느) _ LOVE ATTACK", "channel": "Stone Music"})
    assert_equal(title, "LOVE ATTACK", "YouTube separator title")
    assert "RESCENE" in artist

    guyso_html = """<table><tbody>
      <tr><td>1 3</td><td>LOVE ATTACK RESCENE (리센느) • 3:02</td><td>3,748,717</td></tr>
      <tr><td>4 1</td><td>Pretty Girl RESCENE (리센느), RESCENE (리센느) • 3:30</td><td>3,036,333</td></tr>
      <tr><td>5</td><td>Pretty Girl KARA • 3:30</td><td>2,000,000</td></tr>
    </tbody></table>"""
    enriched = parse_guyso_youtube_rescene_rows(guyso_html)
    assert_equal([(item["rank"], item["title"]) for item in enriched], [(1, "LOVE ATTACK"), (4, "Pretty Girl")], "Guyso YouTube enrichment")
    youtube_song = {"id": "pretty-girl", "title": "Pretty Girl", "aliases": ["Pretty Girl"], "artistAliases": ["RESCENE", "리센느"], "charts": ["youtube-kr"], "externalIds": {}}
    assert match_song({"rank": 4, "title": "Pretty Girl Official M/V", "artist": "RESCENE"}, [youtube_song], "youtube-kr")
    assert not match_song({"rank": 85, "title": "Pretty Girl", "artist": "KARA"}, [youtube_song], "youtube-kr")


def state_tests():
    config = normalize_config({
        "source": "test",
        "charts": [{"id": "melon", "enabled": True, "published": True, "order": 10}],
        "songs": [{"id": "pretty-girl", "title": "Pretty Girl", "aliases": ["Pretty Girl"], "artistAliases": ["RESCENE", "리센느"], "charts": ["melon"], "published": True, "order": 10}],
    })
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        payload = empty_public_payload(config)
        chart_row = next(x for x in config["charts"] if x["id"] == "melon")
        replacements, matched = apply_successful_chart(root, payload, config, chart_row, [{"rank": 12, "title": "Pretty Girl", "artist": "RESCENE"}], "2026-08-01T11:00:00+09:00", "2026-08-01T11:05:00+09:00")
        assert_equal(matched, 1, "matched count")
        assert_equal(replacements[0]["currentRank"], 12, "first rank")
        payload["entries"] = replacements
        replacements, _ = apply_successful_chart(root, payload, config, chart_row, [{"rank": 8, "title": "Pretty Girl", "artist": "RESCENE"}], "2026-08-01T12:00:00+09:00", "2026-08-01T12:05:00+09:00")
        assert_equal(replacements[0]["movement"], 4, "movement up")
        assert_equal(replacements[0]["peakRank"], 8, "peak")
        payload["entries"] = replacements
        replacements, _ = apply_successful_chart(root, payload, config, chart_row, [{"rank": 1, "title": "Different", "artist": "Other"}], "2026-08-01T13:00:00+09:00", "2026-08-01T13:05:00+09:00")
        assert_equal(replacements[0]["status"], "out", "out status")
        assert_equal(replacements[0]["outOfChartCount"], 1, "out history count")
        history = json.loads((root / replacements[0]["historyPath"]).read_text(encoding="utf-8"))
        assert_equal(len(history["points"]), 3, "history points")
        assert_equal(history["points"][-1]["rank"], None, "out history point")
        # Rechecking the same native period must not add a point or inflate the out observation count.
        payload["entries"] = replacements
        replacements, _ = apply_successful_chart(root, payload, config, chart_row, [], "2026-08-01T13:00:00+09:00", "2026-08-01T13:25:00+09:00")
        history = json.loads((root / replacements[0]["historyPath"]).read_text(encoding="utf-8"))
        assert_equal(len(history["points"]), 3, "deduplicated history points")
        assert_equal(history["outOfChartHistory"][-1]["observations"], 1, "deduplicated out observations")
        final = finalize_public_payload({**payload, "entries": replacements, "sourceStatus": {"melon": {"ok": True}}}, config, "2026-08-01T13:05:00+09:00")
        assert_equal(final["summary"]["inChartCount"], 0, "summary")


if __name__ == "__main__":
    parser_tests()
    state_tests()
    print("Korean chart offline regression tests passed.")
