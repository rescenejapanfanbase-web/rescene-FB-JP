RESCENE JAPAN FANBASE
Notionアンケート 自動集計機能
2026-08-11

■ 現在のNotionフォームに対応
現在の「RESCENE好きな曲アンケート」は、
「対象作品」の複数選択から好きな曲を3曲選ぶ構成です。
この機能はそのまま自動集計できます。

■ 自動表示
- 総回答数
- 総楽曲選択数
- 好きな曲ランキング
- 各曲の票数
- 回答者に対する選択率
- 全選択票に占める割合
- 最新回答日時
- サイト掲載許可ONのコメント

将来、Notionに以下を追加すると自動認識します。
- 企画名
- 好きな曲
- 推しメンバー
- 楽曲評価
- MV評価
- ステージ評価
- ニックネーム

■ プライバシー
公開用 data/survey-results.json には回答者ごとの生データを保存しません。
自由コメントは「サイト掲載許可」がONの回答だけ公開用JSONへ出力します。
OFFのコメントは公開ファイルへ出しません。

■ GitHubへ反映
1. ZIPを展開
2. 中身を rescene-FB-JP の一番上へアップロード
3. Commit directly to the main branch
4. Commit changes

■ 最初の実行
GitHub → Actions → Sync Notion Survey Results
→ Run workflow → main → Run workflow

成功時は
chore: sync Notion survey results
という自動コミットが作られます。

■ 自動更新
毎時20分（JST）に自動集計します。
手動Run workflowでも即時更新できます。

■ Notion APIで404 / object_not_foundの場合
GitHubで使っている既存のNOTION_TOKENのIntegrationに
「RESCENE カムバックアンケート」DBを接続してください。
Notion DB → 共有 / Connections → サイト用Integrationを追加。

■ 回答フォームへのボタン
初期状態では回答フォームURLを空欄にしています。
data/survey-config.json の
"formUrl": ""
へ、一般ユーザーが開けるNotionフォームのWeb公開URLを入れてください。
編集用Notion URLは使わないでください。
空欄なら回答ボタンは非表示で、結果だけ表示します。

■ 新曲追加
Notionフォームの「対象作品」へ新曲を追加するだけです。
コード変更は不要です。次回同期で自動的にランキング対象になります。

■ カムバックごとに結果を分ける
Notion DBへ「企画名」というSelectプロパティを追加し、
フォーム回答に企画名が入るようにすると、survey.htmlに
企画切り替えプルダウンが自動表示されます。

■ 評価の自動表示
Numberプロパティとして
楽曲評価 / MV評価 / ステージ評価
を追加すると、回答が入った項目だけ平均評価が自動表示されます。

■ 推しメンバー
「推しメンバー」をSelectまたはMulti-selectで追加すると、
分布が自動表示されます。

■ ナビ
初回Workflowで共通ナビの「リンク」メニューへ
「アンケート」を自動追加します。
Notionナビ側にsurvey.htmlが追加された場合は重複しません。

■ 公開URL
https://rescene-fb.jp/survey.html

■ 最初の確認
1. Workflowを成功させる
2. survey.html を開く
3. Ctrl + Shift + R
4. 現在は回答0件なら0表示で正常
5. Notionでテスト回答
6. 手動でSync Notion Survey Resultsを実行
7. 回答数・ランキングが増えることを確認
