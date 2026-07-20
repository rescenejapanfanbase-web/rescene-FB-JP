#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

run_step() {
  local label="$1"
  shift
  echo
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "▶ ${label}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  "$@"
}

run_step "Notion スケジュール" node scripts/sync-notion.mjs
run_step "Notion ニュース" node scripts/sync-notion-news.mjs
run_step "Notion ディスコグラフィ" node scripts/sync-notion-discography.mjs
run_step "Notion メンバー" node scripts/sync-notion-members.mjs
run_step "Notion About" node scripts/sync-notion-about.mjs
run_step "Notion 掛け声" node scripts/sync-notion-chants.mjs
run_step "Notion 投票ガイド" node scripts/sync-notion-voting.mjs
run_step "Notion ストリーミング" node scripts/sync-notion-streaming.mjs
run_step "Notion 公式リンク" node scripts/sync-notion-official-links.mjs
run_step "Notion お問い合わせ" node scripts/sync-notion-contact.mjs
run_step "Notion ホーム・共通表示" node scripts/sync-notion-homepage.mjs
run_step "YouTube 全動画" node scripts/sync-youtube-channels.mjs
run_step "MV一覧" node scripts/sync-mv.mjs
run_step "ホーム用ガイド更新情報" node scripts/generate-home-guides.mjs
run_step "カレンダーICS" node scripts/calendar-ics.mjs
run_step "SEO・記事・OGP・サイトマップ" python3 scripts/generate-seo.py
run_step "画像最適化" python3 scripts/optimize-images.py
run_step "公開前品質検査" ./scripts/run-prepublish-checks.sh

echo
printf '✅ 全コンテンツの同期・生成・検査が完了しました。\n'
