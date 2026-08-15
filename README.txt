RESCENE Survey Workflow Permission Fix

原因:
Apply Survey Display Update の実行中に、
scripts/apply-survey-public-ui.py が
.github/workflows/sync-notion-survey.yml
まで書き換えていました。

GitHub Actions標準トークンにはWorkflowファイル更新権限がないため、
git push が拒否されました。

修正:
Workflowファイルを変更する処理を削除しました。
公開ページの修正内容はそのまま維持します。

反映手順:
1. このZIPを展開
2. scripts/apply-survey-public-ui.py をGitHubへ上書きアップロード
3. Commit directly to the main branch
4. Actions → Apply Survey Display Update
5. Run workflow → main → Run workflow

既存の .github/workflows/apply-survey-public-ui.yml は変更不要です。
既存の .github/workflows/sync-notion-survey.yml も変更不要です。
