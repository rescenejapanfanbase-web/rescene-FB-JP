#!/usr/bin/env python3
"""Apply the 2026-11-08 RESCENE JAPAN FANBASE image and record-page update.

Usage: python apply_rescene_site_update.py /path/to/rescene-FB-JP
Works from an extracted update bundle; no third-party Python packages required.
"""
from __future__ import annotations

import argparse
import re
import shutil
import sys
from pathlib import Path

IMAGE_OVERVIEW = "assets/voting/music-shows-overview-20261108.jpg"
IMAGE_POINTS = "assets/voting/vote-points-summary-20261108.jpg"
IMAGE_SCHEDULE = "schedule/music-show-schedule-20261108.jpg"
IMAGE_BIGC = "assets/voting/guides/bigc-vote-flow-20261108.jpg"
BUNDLE = Path(__file__).resolve().parent

ASSETS = {
    IMAGE_OVERVIEW: "assets/voting/music-shows-overview-20261108.jpg",
    IMAGE_POINTS: "assets/voting/vote-points-summary-20261108.jpg",
    IMAGE_SCHEDULE: "schedule/music-show-schedule-20261108.jpg",
    IMAGE_BIGC: "assets/voting/guides/bigc-vote-flow-20261108.jpg",
}


def replace_image_tag(html: str, original: str, replacement: str, alt: str, width: int, height: int) -> str:
    """Replace an optimized <img> by its source identifier, without stale srcset."""
    pattern = re.compile(r'<img\b[^>]*\bdata-image-original-src="' + re.escape(original) + r'"[^>]*>', re.S)
    new_tag = f'<img alt="{alt}" loading="lazy" src="{replacement}" width="{width}" height="{height}"/>'
    html, count = pattern.subn(new_tag, html)
    if count != 1 and new_tag not in html:
        raise ValueError(f"Could not find one image with original source {original!r} (found {count})")
    if count > 1:
        raise ValueError(f"Found several image targets for {original!r} ({count})")
    return html


def rewrite_voting_html(html: str) -> str:
    html = replace_image_tag(
        html, "schedule/music-show-list.png", IMAGE_OVERVIEW,
        "韓国音楽番組の曜日・スコア配分・投票アプリまとめ", 987, 1536,
    )
    html = replace_image_tag(
        html, "assets/voting/vote-points-summary.png", IMAGE_POINTS,
        "音楽番組別の投票券・ポイントの貯め方", 1536, 1229,
    )
    # The image is also added to the static HTML fallback. js/voting.js
    # renders this section from data/voting-guide-data.js at runtime.
    anchor = '<article class="guide-step"><div class="guide-caption"><b>3. 投票の流れ</b>'
    image = f'<div class="guide-image"><img alt="BIGC THE SHOW 事前投票の画面" height="1536" loading="lazy" src="{IMAGE_BIGC}" width="800"/></div>'
    if anchor in html:
        html = html.replace(anchor, '<article class="guide-step">' + image + '<div class="guide-caption"><b>3. 投票の流れ</b>', 1)
    elif IMAGE_BIGC not in html:
        raise ValueError("Could not locate BIGC step 3 in voting.html")
    return html


def rewrite_schedule_html(html: str) -> str:
    return replace_image_tag(
        html, "schedule/music-show-schedule.png", IMAGE_SCHEDULE,
        "韓国音楽番組の週間投票スケジュール", 1536, 1104,
    )


def rewrite_voting_data(data: str) -> str:
    # Minimal replacement retains JSON/generated JS format and unrelated Notion data.
    target = re.compile(r'("image"\s*:\s*)""(\s*,\s*"title"\s*:\s*"3\. 投票の流れ")')
    updated, count = target.subn(lambda m: f'{m.group(1)}"{IMAGE_BIGC}"{m.group(2)}', data)
    if count != 1 and IMAGE_BIGC not in data:
        raise ValueError("Could not locate BIGC step 3 image in synced voting data")
    if count > 1:
        raise ValueError("Found multiple BIGC step 3 data entries")
    return updated


def rewrite_sync_script(script: str) -> str:
    # Ensures an automated Notion refresh preserves the local image replacement.
    marker = 'apps.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, "ja"));'
    injection = '''// The BIGC voting-flow screenshot is maintained by RESCENE JAPAN FANBASE.
// Preserve it when Notion data is refreshed.
const bigcApp = apps.find(app => String(app.title || "").toUpperCase() === "BIGC");
const bigcVoteStep = bigcApp?.guide?.steps?.find(step => /投票の流れ/.test(step.title || ""));
if (bigcVoteStep) bigcVoteStep.image = "''' + IMAGE_BIGC + '''";
'''
    if injection in script:
        return script
    if script.count(marker) != 1:
        raise ValueError("Could not uniquely locate apps.sort() in Notion sync")
    return script.replace(marker, marker + '\n' + injection, 1)


def rewrite_voting_js(script: str) -> str:
    # Also protects page output if JSON is refreshed by another path.
    old = 'const steps=Array.isArray(item?.guide?.steps)?item.guide.steps:[];'
    new = '''const steps=(Array.isArray(item?.guide?.steps)?item.guide.steps:[]).map(step=>
        item.title==='BIGC' && /投票の流れ/.test(step.title||'')
          ? {...step,image:'%s'} : step);''' % IMAGE_BIGC
    if new in script:
        return script
    if script.count(old) != 1:
        raise ValueError("Could not locate BIGC guide steps in js/voting.js")
    return script.replace(old, new, 1)


def rewrite_melon_html(html: str) -> str:
    pattern = re.compile(r'<span class="record-link-pending">\s*MVなし\s*[／/]\s*未登録\s*</span>')
    html, count = pattern.subn('', html)
    if count == 0 and 'record-link-pending' in html:
        raise ValueError("Unknown MV placeholder encountered in melon-records.html")
    return html


def rewrite_melon_generator(js: str) -> str:
    before = ": '<span class=\"record-link-pending\">MVなし／未登録</span>'"
    after = ": ''"
    if before in js:
        return js.replace(before, after, 1)
    if after in js and 'MVなし／未登録' not in js:
        return js
    raise ValueError("Could not locate MV placeholder template in scripts/render-record-pages.mjs")


PATCHES = {
    "voting.html": rewrite_voting_html,
    "schedule.html": rewrite_schedule_html,
    "data/voting-guide.json": rewrite_voting_data,
    "data/voting-guide-data.js": rewrite_voting_data,
    "scripts/sync-notion-voting.mjs": rewrite_sync_script,
    "js/voting.js": rewrite_voting_js,
    "melon-records.html": rewrite_melon_html,
    "scripts/render-record-pages.mjs": rewrite_melon_generator,
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("repo", type=Path, nargs="?", default=Path.cwd(), help="Path to the local rescene-FB-JP repository")
    parser.add_argument("--check", action="store_true", help="Check targets without modifying any files")
    args = parser.parse_args()
    repo = args.repo.expanduser().resolve()
    if not (repo / "voting.html").is_file() or not (repo / "melon-records.html").is_file():
        parser.error(f"Not a RESCENE site root: {repo}")

    prepared = {}
    try:
        for name, patcher in PATCHES.items():
            path = repo / name
            if not path.is_file():
                raise FileNotFoundError(f"Site source not found: {name}")
            old = path.read_text(encoding="utf-8")
            prepared[name] = patcher(old)
        for destination, source in ASSETS.items():
            if not (BUNDLE / "images" / source).is_file():
                raise FileNotFoundError(f"Bundled image not found: {source}")
    except (ValueError, FileNotFoundError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1

    changed = [name for name, content in prepared.items() if content != (repo / name).read_text(encoding="utf-8")]
    if args.check:
        print("Ready to apply:")
        for name in changed:
            print(f"  update {name}")
        for target in ASSETS:
            print(f"  install {target}")
        return 0

    for name in changed:
        (repo / name).write_text(prepared[name], encoding="utf-8")
        print(f"UPDATED {name}")
    for dest, src in ASSETS.items():
        target = repo / dest
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(BUNDLE / "images" / src, target)
        print(f"INSTALLED {dest}")
    print("Complete. Please review 'git diff', then commit/push to publish.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
