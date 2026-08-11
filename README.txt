RESCENE JAPAN FANBASE — Deja Vu 最終回帰テスト修正
2026-08-11

今回のログで判明した最後の原因:
scripts/check-requested-regressions.py に
- Deja Vu top100Peak == 13
- melon-records.html に #13 がある
という古い固定テストが残っていました。

このZIPは以下を修正します。
1. 古い13位固定回帰テストを、現在のrecords.jsonとHTMLが一致するかの検査へ変更
2. Deja VuをNotion値(現在6位 / Daily 8位)で再確定
3. records-manual.jsonの古いnotionGuardを削除
4. JSON更新後にmelon-records.htmlを再生成
5. pillow-heif / PyYAMLも維持

反映後:
GitHub → Actions → Sync Notion Music Records → Run workflow → main

最初のnode sync時に
「Notion=6, 確定=13」
という警告が1回出る場合があります。
これは、その時点では旧records-manual.jsonを読んでいるためです。
その直後にnotionGuardを削除し、成功時にGitHubへcommitされます。
次回以降はこの旧13位ガード自体が消えます。

成功時:
[10/10] 指定項目の回帰検査
✅ 指定項目の回帰検査...
✅ 公開前チェックがすべて完了しました。
その後 git commit / git push まで進みます。
