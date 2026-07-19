サイト内チェック修正版

次の3ファイルを同じ場所へ上書きしてください。

1. scripts/check-site-links.py
2. article.html
3. assets/voting/apps/muniverse.png

上書き後、GitHub Actions の「Check Site Files」を再実行してください。

修正内容:
- data/*.json と js/*.js 内のサイトパスをリポジトリ直下基準で検査
- article.html の予備ニュース画像を news/fanbase-site.jpg に変更
- 不足していた Muniverse アイコンを追加
