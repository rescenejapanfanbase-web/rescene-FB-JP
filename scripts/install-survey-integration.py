#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def replace_once(path: Path, old: str, new: str, already: str) -> bool:
    source = path.read_text(encoding='utf-8')
    if already in source:
        return False
    if old not in source:
        raise RuntimeError(f'{path.relative_to(ROOT)}: 挿入位置を見つけられません。')
    path.write_text(source.replace(old, new, 1), encoding='utf-8')
    return True

def patch_seo() -> bool:
    path = ROOT / 'scripts' / 'generate-seo.py'
    marker = '    "streaming.html": {\n'
    block = '''    "survey.html": {
        "title": f"アンケート | {SITE_NAME}",
        "description": "RESCENE JAPAN FANBASEのアンケート結果をNotion回答から自動集計し、好きな曲ランキングや評価、掲載許可済みコメントを表示します。",
        "image": "assets/group/rescene-group.jpg",
        "label": "FAN SURVEY",
        "priority": "0.7",
        "changefreq": "hourly",
    },
'''
    return replace_once(path, marker, block + marker, '"survey.html": {')

def patch_navigation() -> bool:
    path = ROOT / 'scripts' / 'sync-site-shell.py'
    old = '    source=items if isinstance(items,list) and items else DEFAULT_NAVIGATION\n'
    new = '''    source=list(items) if isinstance(items,list) and items else list(DEFAULT_NAVIGATION)
    # アンケートはサイト機能として常設。Notion側に同じリンクが追加された場合は重複させません。
    if not any(str(item.get("linkUrl") or "").strip().split("#")[0]=="survey.html" for item in source if isinstance(item,dict)):
        source.append({
            "heading":"アンケート",
            "linkUrl":"survey.html",
            "note":"リンク",
            "order":71.5,
            "translations":{
                "ko":{"heading":"설문조사"},
                "en":{"heading":"Survey"},
            },
        })
'''
    changed = replace_once(path, old, new, '"linkUrl":"survey.html"')
    source = path.read_text(encoding='utf-8')
    if "'survey.html':" not in source:
        footer_marker = "            'korean-charts.html':'各チャートの仕様変更や一時的な取得失敗時は、前回の正常データを表示します。',\n"
        if footer_marker in source:
            source = source.replace(
                footer_marker,
                footer_marker + "            'survey.html':'アンケート結果はNotionの回答を自動集計して表示しています。',\n",
                1,
            )
            path.write_text(source, encoding='utf-8')
            changed = True
    return changed

def main() -> int:
    changes = []
    if patch_seo(): changes.append('generate-seo.py')
    if patch_navigation(): changes.append('sync-site-shell.py')
    print('アンケート統合設定を追加: ' + ', '.join(changes) if changes else 'アンケート統合設定はすでに適用済みです。')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
