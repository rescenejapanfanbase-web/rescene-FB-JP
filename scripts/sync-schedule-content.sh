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
run_step "Plus Chat スケジュール" python3 scripts/sync-pluschat-schedule.py --production --months-ahead 1
run_step "スケジュール統合" node scripts/merge-schedules.mjs
run_step "日本語・韓国語・英語カタログ" node scripts/build-language-catalog.mjs
run_step "画像の表示領域確保" python3 scripts/add-image-dimensions.py
run_step "画像最適化" python3 scripts/optimize-images.py
run_step "PWA・オフラインキャッシュ" python3 scripts/generate-pwa.py
run_step "公開前品質検査" bash ./scripts/run-prepublish-checks.sh

echo
printf '✅ スケジュールの取得・統合・生成・検査が完了しました。\n'
