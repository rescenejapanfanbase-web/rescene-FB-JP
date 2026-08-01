#!/usr/bin/env python3
"""Offline regression tests for historical backfill and Spotify embed parsing."""
from __future__ import annotations

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

from korean_chart_history import (
    discover_history_links,
    discover_melon_song_candidates,
    fallback_song_candidates,
    merge_historical_points,
    parse_daily_history,
    parse_hourly_matrix,
    parse_spotify_embed_html,
    parse_weekly_youtube,
)


def equal(actual, expected, label):
    if actual != expected:
        raise AssertionError(f"{label}: expected={expected!r} actual={actual!r}")


def parser_tests():
    artist = '''<a href="/song/melon/37928381"><img alt="LOVE ATTACK"></a>
    <a href="/song/melon/999"><img alt="LOVE ATTACK (Japanese Ver.)"></a>'''
    songs = discover_melon_song_candidates(artist)
    equal(songs["loveattack"], ["https://xn--o39an51b2re.com/song/melon/37928381"], "song discovery")

    client_rendered = '''<div class="song" data-route="/song/melon/39231685"><span>Deja Vu</span><span>RESCENE (리센느)</span></div>
    <script>{"songName":"Runaway","url":"/song/melon/601719493"}</script>'''
    songs = discover_melon_song_candidates(client_rendered)
    equal(songs["dejavu"], ["https://xn--o39an51b2re.com/song/melon/39231685"], "attribute discovery")
    equal(songs["runaway"], ["https://xn--o39an51b2re.com/song/melon/601719493"], "JSON discovery")

    equal(
        fallback_song_candidates({"id": "love-attack", "externalIds": {}}),
        ["https://xn--o39an51b2re.com/song/melon/37928381"],
        "known ID fallback",
    )
    equal(
        fallback_song_candidates({"id": "custom", "externalIds": {"melon": "melon:12345678"}}),
        ["https://xn--o39an51b2re.com/song/melon/12345678"],
        "Notion external ID fallback",
    )

    detail = '''
    <a href="/chart/melon/top100/trend/ranking/37928381">melon</a>
    <a href="https://xn--o39an51b2re.com/chart/genie/realtime/trend/ranking/107590768">genie</a>
    <a href="/chart/youtube/track-weekly/trend/ranking/abc">youtube</a>'''
    links = discover_history_links(detail)
    equal(sorted(links), ["genie", "melon", "youtube-kr"], "history link discovery")

    hourly = '''<table><thead><tr><th>날짜/시</th>''' + ''.join(f'<th>{i}</th>' for i in range(24)) + '''</tr></thead><tbody>
    <tr><td>20260701</td><td>5</td><td></td><td>7</td>''' + ''.join('<td></td>' for _ in range(21)) + '''</tr></tbody></table>'''
    points = parse_hourly_matrix(hourly, max_rank=100, source_url="https://example.com/hourly")
    equal(len(points), 2, "hourly count")
    equal(points[0]["chartAt"], "2026-07-01T00:00:00+09:00", "hourly date")
    equal(points[1]["rank"], 7, "hourly rank")

    daily = '''<table><tr><th>날짜</th><th>순위</th></tr><tr><td>20260701</td><td>42</td></tr></table>'''
    points = parse_daily_history(daily, max_rank=100, source_url="https://example.com/daily")
    equal(points[0]["rank"], 42, "daily rank")

    weekly = '''<table><tr><th>연도</th><th>주차</th><th>순위</th><th>조회수</th></tr>
    <tr><td>2026</td><td>26</td><td>5</td><td>3,228,784</td></tr></table>'''
    points = parse_weekly_youtube(weekly, max_rank=100, source_url="https://example.com/youtube")
    equal(points[0]["chartAt"], "2026-06-22T00:00:00+09:00", "weekly ISO start")
    equal(points[0]["views"], 3228784, "weekly views")

    spotify = '''<ul><li data-testid="tracklist-row"><a href="/track/a1">LOVE ATTACK</a><a href="/artist/r1">RESCENE</a></li>
    <li data-testid="tracklist-row"><a href="/track/a2">Pretty Girl</a><a href="/artist/r1">RESCENE</a></li></ul>'''
    tracks = parse_spotify_embed_html(spotify, max_rank=50)
    equal(tracks[0], {"id": "a1", "title": "LOVE ATTACK", "artist": "RESCENE", "rank": 1}, "spotify first")
    equal(tracks[1]["rank"], 2, "spotify rank")


def backfill_entrypoint_tests():
    script = Path(__file__).with_name("backfill-korean-chart-history.py")
    spec = spec_from_file_location("backfill_korean_chart_history_test", script)
    if not spec or not spec.loader:
        raise AssertionError("backfill module could not be loaded")
    module = module_from_spec(spec)
    spec.loader.exec_module(module)

    detail_html = """<html><head><title>곡 상세정보 > LOVE ATTACK - RESCENE</title></head>
    <body>발매 2024.08.27</body></html>"""

    class FakeClient:
        def get(self, url):
            return detail_html

    url, html = module.choose_song_detail(
        {"title": "LOVE ATTACK", "aliases": ["Love Attack"], "releaseDate": "2024-08-27"},
        ["https://xn--o39an51b2re.com/song/melon/37928381"],
        FakeClient(),
    )
    equal(url.endswith("37928381"), True, "choose_song_detail compact import")
    equal(html, detail_html, "choose_song_detail result")


def merge_tests():
    history = {
        "points": [
            {"chartAt": "2026-07-01T00:00:00+09:00", "rank": 8, "checkedAt": "2026-07-01T01:00:00+09:00"},
            {"chartAt": "2026-07-02T00:00:00+09:00", "rank": 6, "origin": "guyso"},
        ],
        "summary": {"currentRank": 8, "status": "in"},
    }
    added, updated = merge_historical_points(history, [
        {"chartAt": "2026-06-30T00:00:00+09:00", "rank": 10, "origin": "guyso"},
        {"chartAt": "2026-07-01T00:00:00+09:00", "rank": 99, "origin": "guyso"},
        {"chartAt": "2026-07-02T00:00:00+09:00", "rank": 5, "origin": "guyso"},
    ], checked_at="2026-08-01T20:00:00+09:00")
    equal((added, updated), (1, 1), "merge counters")
    equal([point["rank"] for point in history["points"]], [10, 8, 5], "live precedence")
    equal(history["summary"]["peakRank"], 5, "summary peak")
    equal(history["summary"]["currentRank"], 8, "summary current preserved")


if __name__ == "__main__":
    parser_tests()
    backfill_entrypoint_tests()
    merge_tests()
    print("Korean chart history regression tests passed.")
