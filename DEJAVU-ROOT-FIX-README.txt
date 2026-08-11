RESCENE JAPAN FANBASE — Deja Vu Melon 根本修正

原因:
data/records-manual.json の Deja Vu に古い notionGuard があり、
NotionがTOP100 6位を返しても13位へ戻す処理が残っていました。

このZIPの内容:
1. .github/workflows/sync-notion-records.yml
   - 通常のNotion記録同期後にDeja VuをNotionから再確定
   - 手動フォールバックも最新化
2. scripts/fix-dejavu-manual-fallback.py
   - 古い notionGuard を削除
   - Deja Vuのフォールバックを現在のNotion値へ同期

反映後:
GitHub > Actions > Sync Notion Music Records > Run workflow > main > Run workflow

成功後に期待する値:
TOP100最高順位: 6
TOP100最高順位獲得日: 2026-08-10
日間最高順位: 8
日間最高順位獲得日: 2026-08-10

サイト確認:
https://rescene-fb.jp/records.html
Ctrl + Shift + R で強制再読み込み
