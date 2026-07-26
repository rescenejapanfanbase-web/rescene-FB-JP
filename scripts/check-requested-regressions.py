#!/usr/bin/env python3
"""Regression checks for automation, language, records, images, and schedule UI."""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
errors: list[str] = []


def require(condition: bool, message: str) -> None:
    if not condition:
        errors.append(message)


def text(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def require_workflow_schedule(path: str, cron: str) -> None:
    source = text(path)
    require(f'- cron: "{cron}"' in source, f"{path}: cronが指定値と一致しません: {cron}")
    require('timezone: "Asia/Tokyo"' in source, f"{path}: Asia/Tokyo timezoneがありません")


require_workflow_schedule(
    ".github/workflows/sync-youtube-channels.yml",
    "5 0,2,4,6,8,10,12,14,16,18,20,22 * * *",
)
require_workflow_schedule(
    ".github/workflows/sync-schedule.yml",
    "0 0,6,12,18 * * *",
)
require_workflow_schedule(
    ".github/workflows/sync-all-content.yml",
    "5 1,3,5,7,9,11,13,15,17,19,21,23 * * *",
)
other_workflow = text(".github/workflows/sync-all-content.yml")
require("SKIP_YOUTUBE_SYNC:" in other_workflow, "その他同期: YouTube除外設定がありません")
require("SKIP_SCHEDULE_SYNC:" in other_workflow, "その他同期: スケジュール除外設定がありません")
all_script = text("scripts/sync-all-content.sh")
require('${SKIP_SCHEDULE_SYNC:-0}' in all_script, "統合同期スクリプトにスケジュール除外分岐がありません")
require('${SKIP_YOUTUBE_SYNC:-0}' in all_script, "統合同期スクリプトにYouTube除外分岐がありません")

# Language must be initialized from common.js on every public HTML page.
missing_common: list[str] = []
for path in ROOT.rglob("*.html"):
    if any(part in {".git", "node_modules", "templates"} for part in path.parts):
        continue
    source = path.read_text(encoding="utf-8", errors="ignore")
    if not re.search(r'<script[^>]+src=["\'][^"\']*js/common\.js(?:\?[^"\']*)?["\']', source, re.I):
        missing_common.append(str(path.relative_to(ROOT)))
require(not missing_common, f"Language未読込ページ: {', '.join(missing_common)}")
common_js = text("js/common.js")
i18n_js = text("js/i18n.js")
require("data-rescene-i18n" in common_js and "i18n.js" in common_js, "common.jsがLanguageを共通読込していません")
require(".news-card" not in re.search(r"const SKIP_SELECTOR=([^;]+);", i18n_js).group(1), "Languageがニュース本文を除外しています")
require(".record-win-card" not in re.search(r"const SKIP_SELECTOR=([^;]+);", i18n_js).group(1), "Languageが記録本文を除外しています")
require("rescene:content-rendered" in i18n_js, "動的コンテンツのLanguage再反映がありません")

# Uploaded Notion images must take precedence over image paths in the principal content synchronizers.
image_order_checks = {
    "scripts/sync-notion.mjs": ("const upload = await findImageUpload(page);", 'const imagePath = plainText(page.properties?.["画像パス"]?.rich_text);'),
    "scripts/sync-notion-news.mjs": ("const upload = await findImageUpload(page);", 'const configuredImagePath = plainText(properties["画像パス"]?.rich_text);'),
    "scripts/sync-notion-records.mjs": ("const upload = await findImage(page);", 'const configured = localPath(plainText(page.properties?.["画像パス"]?.rich_text));'),
    "scripts/sync-notion-discography.mjs": ('const uploaded = notionFile(properties["画像"]) || notionFile(properties["ジャケット"]);', 'if (!cover) cover = propertyText(properties["画像パス"]);'),
    "scripts/sync-notion-about.mjs": ('const upload = notionFile(properties["画像"]);', 'propertyText(properties["画像パス"])'),
    "scripts/sync-notion-homepage.mjs": ('const upload = notionFile(properties["画像"]);', 'propertyText(properties["画像パス"])'),
}
for path, (upload_marker, path_marker) in image_order_checks.items():
    source = text(path)
    upload_index = source.find(upload_marker)
    path_index = source.find(path_marker)
    require(upload_index >= 0, f"{path}: Notion画像処理が見つかりません")
    require(path_index >= 0, f"{path}: 画像パス処理が見つかりません")
    require(upload_index < path_index, f"{path}: 画像パスがNotion画像より先に選ばれています")

# Specialized image columns also must let uploads override configured paths.
specialized_image_markers = {
    "scripts/sync-notion-members.mjs": [
        'previewUpload?.url ? await saveImage(previewUpload, slug, "preview") : propertyText(properties["一覧画像パス"])',
        'detailUpload?.url ? await saveImage(detailUpload, slug, "detail") : propertyText(properties["詳細画像パス"])',
        'desktopUpload?.url ? await saveImage(desktopUpload, slug, "desktop") : propertyText(properties["PC画像パス"])',
    ],
    "scripts/sync-notion-chants.mjs": [
        "uploaded?.url ? await saveImage(uploaded, slug) : localImage",
    ],
    "scripts/sync-notion-voting.mjs": [
        "if (scoreUpload) {",
        "scoreImage = await saveImage(scoreUpload, scoreDirectory, slug);",
        "if (uploadedGuideFiles[index]) {",
    ],
    "scripts/sync-notion-streaming.mjs": [
        "if (uploadedImages[index]) {",
        "image = await saveImage(uploadedImages[index], guideDirectory",
    ],
}
for path, markers in specialized_image_markers.items():
    source = text(path)
    for marker in markers:
        require(marker in source, f"{path}: Notionアップロード優先処理がありません: {marker}")

# Records regressions.
record_renderer = text("scripts/render-record-pages.mjs")
require('item.videoLabel || "映像を見る"' in record_renderer, "映像リンク名がNotion値を使用していません")
require('const rank = (value)' in record_renderer and ': "-";' in record_renderer, "未入力順位がハイフンになっていません")
require("<small>SCORE</small>" not in record_renderer and "win-detail-score" not in record_renderer, "音楽番組1位記録にSCORE欄が残っています")
require('score: plainText(p["スコア"]' not in text("scripts/sync-notion-records.mjs"), "公開用記録データにスコアが残っています")
require("TOP100最高順位獲得日" in text("scripts/sync-notion-records.mjs"), "TOP100最高順位獲得日のNotion同期がありません")
require("日間最高順位獲得日" in text("scripts/sync-notion-records.mjs"), "日間最高順位獲得日のNotion同期がありません")
require("melon-rank-date" in record_renderer, "Melon最高順位の獲得日表示がありません")
require("番組、獲得日、スコア、獲得時の映像" not in text("records.html"), "記録トップの説明にスコアが残っています")
for path in ["music-show-wins.html", "melon-records.html"]:
    source = text(path)
    require("映像リンクはNotionから追加できます" not in source, f"{path}: 不要な映像リンク案内が残っています")
require("<dd>未入力</dd>" not in text("melon-records.html"), "Melon順位に未入力表示が残っています")
css = text("css/common.css")
require("win-detail-score" not in css, "削除済みのスコア欄CSSが残っています")
require(".melon-rank-date" in css, "Melon獲得日の小さな表示CSSがありません")
require("body.page-melon-records .melon-record-card" in css, "Melon記録のコンパクト化CSSがありません")

# Schedule UI and public data.
schedule_html = text("schedule.html")
for required_id in ["scheduleLastUpdated", "scheduleListTitle", "scheduleMonthView", "scheduleTodayView", "calendarGrid"]:
    require(f'id="{required_id}"' in schedule_html, f"schedule.html: {required_id}がありません")
schedule_js = text("js/schedule.js")
for marker in ["この日のスケジュールはありません。", "今月のスケジュール", "今日のスケジュール", "is-selected", "schedulePayload.generatedAt"]:
    require(marker in schedule_js, f"schedule.js: 必須処理がありません: {marker}")
require("background:var(--category-color" in css, "モバイルのカレンダードットが濃いカテゴリー色を使用していません")
require("button.calendar-day.is-selected" in css, "選択日の視覚表示がありません")
require("window.RESCENE_SCHEDULE_PAYLOAD" in text("data/schedule-data.js"), "schedule-data.jsに更新日時付きpayloadがありません")

schedule_payload = json.loads(text("data/schedule.json"))
for event in schedule_payload.get("events", []):
    if event.get("source") == "pluschat":
        description = str(event.get("description") or "")
        require("Plus Chat公式スケジュールから自動取得" not in description, f"Plus Chat予定に自動取得文言が残っています: {event.get('title')}")
        require(not re.search(r"(^|\n)原文\s*[:：]", description), f"Plus Chat予定に原文表示が残っています: {event.get('title')}")

if errors:
    print("❌ 指定項目の回帰検査で問題が見つかりました。")
    for item in errors:
        print(f"- {item}")
    raise SystemExit(1)

print("✅ 自動更新時刻・Language・Notion画像・記録・スケジュールの指定項目を確認しました。")
