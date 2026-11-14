# RESCENE JAPAN FANBASE 修正パッケージ（2026-11-08）

対象：`rescenejapanfanbase-web/rescene-FB-JP` の GitHub Pages サイト

## 内容

- 投票ガイド：韓国音楽番組の一覧画像を1枚目に置換
- 投票ガイド：投票券の貯め方を2枚目に置換
- スケジュール：音楽番組の週間投票スケジュールを3枚目に置換
- Melonチャート記録：MVのない楽曲カードから「MVなし／未登録」を削除（実ページと生成スクリプトの両方）
- 投票ガイド＞BIGC＞「3. 投票の流れ」：5枚目のスクリーンショットを追加
- Notion同期やJavaScriptの再描画でもBIGCの画像が消えないように修正

**4枚目のスクリーンショットは修正位置の参考用であり、サイトには掲載しません。**

## 実行方法

1. この ZIP を展開する。
2. 自分の GitHub リポジトリ `rescene-FB-JP` を PC にクローン／ダウンロードする。
3. 展開したフォルダにあるスクリプトを、リポジトリを指定して実行する。

```bash
python apply_rescene_site_update.py /path/to/rescene-FB-JP --check
python apply_rescene_site_update.py /path/to/rescene-FB-JP
```

4. リポジトリのフォルダで差分を確認し、GitHub に反映する。

```bash
cd /path/to/rescene-FB-JP
git diff --check
git diff
git add voting.html schedule.html melon-records.html js/voting.js data/voting-guide.json data/voting-guide-data.js scripts/sync-notion-voting.mjs scripts/render-record-pages.mjs assets/voting/music-shows-overview-20261108.jpg assets/voting/vote-points-summary-20261108.jpg schedule/music-show-schedule-20261108.jpg assets/voting/guides/bigc-vote-flow-20261108.jpg
git commit -m "Update voting guide images and hide missing MV labels"
git push origin main
```

**重要：** このZIPをアップロードするだけではサイトは更新されません。適用スクリプトを既存リポジトリに実行して変更をコミットする必要があります。既存のスケジュール・記録・投票データはできるだけ保持して対象箇所だけを置換します。
