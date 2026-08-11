#!/usr/bin/env python3
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
SCRIPT='<script src="/js/news-engagement.js"></script>'

def patch(path: Path) -> bool:
    text=path.read_text(encoding="utf-8")
    if SCRIPT in text:
        return False
    if 'class="article-shell' not in text or '</body>' not in text:
        return False
    text=text.replace('</body>',f'{SCRIPT}\n</body>',1)
    path.write_text(text,encoding="utf-8")
    return True

def main():
    changed=0
    articles=ROOT/"articles"
    if articles.exists():
        for path in sorted(articles.glob("*.html")):
            changed+=int(patch(path))
    article=ROOT/"article.html"
    if article.exists():
        changed+=int(patch(article))
    print(f"news engagement injected: {changed}")
    return 0

if __name__=="__main__":
    raise SystemExit(main())
