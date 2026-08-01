#!/usr/bin/env python3
"""Regression tests for empty GitHub Actions variables and source identifiers."""
from __future__ import annotations

import importlib.util
import os
from pathlib import Path

SCRIPT = Path(__file__).with_name("sync-korean-charts.py")
spec = importlib.util.spec_from_file_location("sync_korean_charts", SCRIPT)
if spec is None or spec.loader is None:
    raise RuntimeError("sync-korean-charts.py could not be loaded")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

for name in ("SPOTIFY_KOREA_PLAYLIST_ID", "YOUTUBE_MUSIC_KOREA_PLAYLIST_URL"):
    os.environ[name] = ""

assert module.spotify_playlist_id_from_environment() == module.DEFAULT_SPOTIFY_KOREA_PLAYLIST_ID
assert module.youtube_playlist_url_from_environment() == module.DEFAULT_YOUTUBE_MUSIC_KOREA_PLAYLIST_URL

os.environ["SPOTIFY_KOREA_PLAYLIST_ID"] = (
    "https://open.spotify.com/playlist/37i9dQZEVXbNxXF4SkHj9F?si=test"
)
assert module.spotify_playlist_id_from_environment() == "37i9dQZEVXbNxXF4SkHj9F"

os.environ["YOUTUBE_MUSIC_KOREA_PLAYLIST_URL"] = "PL4fGSI1pDJn6jXS_Tv_N9B8Z0HTRVJE0m"
assert module.youtube_playlist_url_from_environment() == (
    "https://www.youtube.com/playlist?list=PL4fGSI1pDJn6jXS_Tv_N9B8Z0HTRVJE0m"
)

print("Korean chart source default regression tests passed.")
