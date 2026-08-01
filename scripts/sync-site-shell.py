#!/usr/bin/env python3
"""Synchronize shared site shell and application head across static HTML pages."""
from __future__ import annotations
import argparse,re,sys,json,html
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
HEADER_TEMPLATE=ROOT/'templates'/'site-header.html'
FOOTER_TEMPLATE=ROOT/'templates'/'site-footer.html'
CONTACT_HEADER_TEMPLATE=ROOT/'templates'/'site-header-contact.html'
CONTACT_FOOTER_TEMPLATE=ROOT/'templates'/'site-footer-contact.html'
HEADER_START='<!-- SITE-HEADER-START -->';HEADER_END='<!-- SITE-HEADER-END -->'
FOOTER_START='<!-- SITE-FOOTER-START -->';FOOTER_END='<!-- SITE-FOOTER-END -->'
APP_HEAD_START='<!-- APP-HEAD-START -->';APP_HEAD_END='<!-- APP-HEAD-END -->'
INLINE_COMMON_RE=re.compile(r'<script>\s*\(\(\)=>\{\s*const root=document\.documentElement,menu=document\.getElementById\(\'mobileMenu\'\).*?</script>\s*',re.S)
COMMON_SCRIPT_RE=re.compile(r'<script\s+[^>]*src=["\'](?:/|(?:\.\./)*)?js/common\.js(?:\?[^"\']*)?["\'][^>]*></script>\s*',re.I)
HOMEPAGE_DATA_SCRIPT_RE=re.compile(r'<script\s+[^>]*src=["\'](?:/|(?:\.\./)*)?data/homepage-data\.js(?:\?[^"\']*)?["\'][^>]*></script>\s*',re.I)
SITE_CONTENT_SCRIPT_RE=re.compile(r'<script\s+[^>]*src=["\'](?:/|(?:\.\./)*)?js/site-content\.js(?:\?[^"\']*)?["\'][^>]*></script>\s*',re.I)
LEGACY_THEME_RE=re.compile(r'<script>\s*try\{if\(localStorage\.getItem\(["\']rescene-theme["\']\)===["\']light["\']\)document\.documentElement\.classList\.add\(["\']light-mode["\']\)\}catch\(e\)\{\}\s*</script>\s*',re.S)
SKIP_SHELL={'offline.html'}

DEFAULT_NAVIGATION = [
    {"heading":"ホーム","linkUrl":"index.html","note":"","order":10},
    {"heading":"RESCENEについて","linkUrl":"about.html","note":"RESCENE","order":20},
    {"heading":"メンバー","linkUrl":"members.html","note":"RESCENE","order":21},
    {"heading":"スケジュール","linkUrl":"schedule.html","note":"","order":30},
    {"heading":"ニュース","linkUrl":"news.html","note":"","order":40},
    {"heading":"ディスコグラフィ","linkUrl":"discography.html","note":"音楽","order":50},
    {"heading":"MV一覧","linkUrl":"mv.html","note":"音楽","order":51},
    {"heading":"YouTube","linkUrl":"youtube.html","note":"音楽","order":52},
    {"heading":"記録","linkUrl":"records.html","note":"音楽","order":53},
    {"heading":"韓国チャート","linkUrl":"korean-charts.html","note":"音楽","order":54},
    {"heading":"ストリーミング","linkUrl":"streaming.html","note":"応援ガイド","order":60},
    {"heading":"投票ガイド","linkUrl":"voting.html","note":"応援ガイド","order":61},
    {"heading":"掛け声ガイド","linkUrl":"chants.html","note":"応援ガイド","order":62},
    {"heading":"公式リンク","linkUrl":"links.html","note":"リンク","order":70},
    {"heading":"ファンサービスガイド","linkUrl":"fan-services.html","note":"リンク","order":71},
    {"heading":"お問い合わせ","linkUrl":"contact.html","note":"リンク","order":72},
]

def load_site_management():
    try:
        payload=json.loads((ROOT/'data'/'homepage.json').read_text(encoding='utf-8'))
        return payload.get('siteManagement') or {}
    except Exception:
        return {}

def translated_attrs(item):
    translations=item.get('translations') or {}
    ko=(translations.get('ko') or {}).get('heading') or (translations.get('ko') or {}).get('title') or ''
    en=(translations.get('en') or {}).get('heading') or (translations.get('en') or {}).get('title') or ''
    attrs=[]
    if ko: attrs.append(f'data-i18n-ko="{html.escape(str(ko),quote=True)}"')
    if en: attrs.append(f'data-i18n-en="{html.escape(str(en),quote=True)}"')
    return (' '+ ' '.join(attrs)) if attrs else ''

def normalized_nav_items(management):
    items=management.get('navigation') if isinstance(management,dict) else None
    source=items if isinstance(items,list) and items else DEFAULT_NAVIGATION
    rows=[]
    for index,item in enumerate(source):
        if not isinstance(item,dict): continue
        label=str(item.get('heading') or item.get('title') or '').strip()
        url=str(item.get('linkUrl') or '').strip()
        if not label or not url: continue
        rows.append({**item,'heading':label,'linkUrl':url,'note':str(item.get('note') or '').strip(),'order':item.get('order',9999),'_index':index})
    return sorted(rows,key=lambda x:(x.get('order',9999),x['_index']))

def prefix_url(prefix,url):
    value=str(url or '').strip()
    if re.match(r'^(?:https?:|mailto:|tel:|#|/)',value,re.I): return value
    return prefix+value

def build_navigation(prefix,management,relative):
    items=normalized_nav_items(management)
    sequence=[]; groups={}
    for item in items:
        group=item.get('note','')
        if not group:
            sequence.append(('link',item))
        else:
            if group not in groups:
                groups[group]=[];sequence.append(('group',group))
            groups[group].append(item)
    desktop=['<nav class="nav-links" aria-label="メインナビゲーション">']
    search_current=' aria-current="page"' if relative=='search.html' else ''
    mobile=['<nav class="mobile-menu" id="mobileMenu" aria-label="モバイルナビゲーション">',f'<a class="mobile-search-link" href="{prefix}search.html"{search_current}>サイト内検索</a>']
    for kind,value in sequence:
        if kind=='link':
            item=value;label=html.escape(item['heading']);url=html.escape(prefix_url(prefix,item['linkUrl']),quote=True);attrs=translated_attrs(item)
            desktop.append(f'<a href="{url}"{attrs}>{label}</a>');mobile.append(f'<a href="{url}"{attrs}>{label}</a>')
        else:
            group=value;members=groups[group];group_label=html.escape(group);links=[];mobile_links=[]
            for item in members:
                label=html.escape(item['heading']);url=html.escape(prefix_url(prefix,item['linkUrl']),quote=True);attrs=translated_attrs(item)
                links.append(f'<a href="{url}"{attrs}>{label}</a>');mobile_links.append(f'<a href="{url}"{attrs}>{label}</a>')
            open_attr=''
            urls={str(x.get('linkUrl') or '').split('#')[0] for x in members}
            if relative in urls: open_attr=' open'
            desktop.append(f'<div class="dropdown"><span class="dropdown-toggle">{group_label}</span><div class="dropdown-menu">'+''.join(links)+'</div></div>')
            mobile.append(f'<details class="mobile-group"{open_attr}><summary>{group_label}</summary><div class="mobile-submenu">'+''.join(mobile_links)+'</div></details>')
    desktop.append('</nav>');mobile.append('</nav>')
    return ''.join(desktop),''.join(mobile)

MISPLACED_TEMPLATE_NAMES={
    'site-header.html',
    'site-footer.html',
    'site-header-contact.html',
    'site-footer-contact.html',
}

def root_prefix(path:Path)->str:return '' if path.parent==ROOT else '/'
def render(template:str,prefix:str,replacements:dict[str,str]|None=None)->str:
    value=template.replace('{{ROOT}}',prefix)
    for key,item in (replacements or {}).items():value=value.replace('{{'+key+'}}',item)
    return value.rstrip()

def app_head(prefix:str)->str:
    return f'''{APP_HEAD_START}
<link rel="manifest" href="{prefix}manifest.webmanifest">
<link rel="stylesheet" href="{prefix}css/notion-theme.css">
<link rel="icon" type="image/png" sizes="192x192" href="{prefix}assets/icons/app-icon-192.png">
<link rel="apple-touch-icon" href="{prefix}assets/icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="application-name" content="RESCENE FB">
<script>(()=>{{try{{const saved=localStorage.getItem('rescene-theme-mode')||localStorage.getItem('rescene-theme')||'system';const mode=['system','light','dark'].includes(saved)?saved:'system';const light=mode==='light'||(mode==='system'&&matchMedia('(prefers-color-scheme: light)').matches);document.documentElement.classList.toggle('light-mode',light);document.documentElement.dataset.theme=light?'light':'dark';document.documentElement.dataset.themePreference=mode;}}catch(e){{}}}})();</script>
{APP_HEAD_END}'''

def normalize_page(path:Path,header_template:str,footer_template:str,replacements:dict[str,str]|None=None)->tuple[str,bool]:
    original=path.read_text(encoding='utf-8');text=original;prefix=root_prefix(path)
    header=f'{HEADER_START}\n{render(header_template,prefix,replacements)}\n{HEADER_END}'
    footer=f'{FOOTER_START}\n{render(footer_template,prefix,replacements)}\n{FOOTER_END}'
    if HEADER_START in text and HEADER_END in text:
        text=re.sub(re.escape(HEADER_START)+r'.*?'+re.escape(HEADER_END),lambda _:header,text,count=1,flags=re.S)
    else: raise ValueError(f'共通ヘッダー範囲を特定できません: {path.relative_to(ROOT)}')
    if FOOTER_START in text and FOOTER_END in text:
        text=re.sub(re.escape(FOOTER_START)+r'.*?'+re.escape(FOOTER_END),lambda _:footer,text,count=1,flags=re.S)
    else: raise ValueError(f'共通フッター範囲を特定できません: {path.relative_to(ROOT)}')
    text=INLINE_COMMON_RE.sub('',text);text=LEGACY_THEME_RE.sub('',text);text=COMMON_SCRIPT_RE.sub('',text);text=HOMEPAGE_DATA_SCRIPT_RE.sub('',text);text=SITE_CONTENT_SCRIPT_RE.sub('',text)
    head=app_head(prefix)
    if APP_HEAD_START in text and APP_HEAD_END in text:
        text=re.sub(re.escape(APP_HEAD_START)+r'.*?'+re.escape(APP_HEAD_END),lambda _:head,text,count=1,flags=re.S)
    else:text=text.replace('</head>',head+'\n</head>',1)
    scripts='\n'.join([f'<script src="{prefix}data/homepage-data.js"></script>',f'<script src="{prefix}js/common.js"></script>',f'<script src="{prefix}js/site-content.js"></script>'])
    text=text.replace(FOOTER_END,f'{FOOTER_END}\n{scripts}',1)
    return text,text!=original

def main()->int:
    parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');args=parser.parse_args()
    templates=[p.read_text(encoding='utf-8') for p in (HEADER_TEMPLATE,FOOTER_TEMPLATE,CONTACT_HEADER_TEMPLATE,CONTACT_FOOTER_TEMPLATE)]
    header_template,footer_template,contact_header_template,contact_footer_template=templates
    site_management=load_site_management()
    changed=[];failures=[];processed=0
    removed=[]
    if not args.check:
        for name in sorted(MISPLACED_TEMPLATE_NAMES):
            misplaced=ROOT/name
            if misplaced.is_file():
                misplaced.unlink()
                removed.append(name)
        if removed:
            print('公開階層に誤配置された共通テンプレートを削除しました: '+', '.join(removed))
    for path in sorted(p for p in ROOT.rglob('*.html') if '.git' not in p.parts and 'templates' not in p.parts and 'artifacts' not in p.parts and p.name not in MISPLACED_TEMPLATE_NAMES):
        relative=path.relative_to(ROOT).as_posix()
        if relative in SKIP_SHELL:continue
        processed+=1
        is_contact=relative=='contact.html'
        footer_notes={
            'external-links.html':'外部サービスの公開状態を自動確認しています。',
            'search.html':'検索結果は公開中の固定ページと同期データをもとに表示しています。',
            'sync-status.html':'公開データ、バックアップ、GitHub Actionsの実行状況を表示しています。',
            'analytics.html':'アクセス解析の設定状況を表示しています。',
            'social-posts.html':'Notionニュースから生成したSNS投稿文を表示しています。',
            'mv-review.html':'MV候補の確認用管理ページです。',
            'favorites.html':'お気に入りはこの端末のブラウザ内だけに保存されます。',
            'youtube.html':'掲載動画の権利は各権利者に帰属します。公式情報は各チャンネルの案内もあわせてご確認ください。',
            'korean-charts.html':'各チャートの仕様変更や一時的な取得失敗時は、前回の正常データを表示します。',
        }
        desktop_nav,mobile_nav=build_navigation(root_prefix(path),site_management,relative)
        replacements={'MUSIC_OPEN':' open' if relative in {'discography.html','mv.html','youtube.html','records.html','music-show-wins.html','melon-records.html','korean-charts.html'} else '', 'LINKS_OPEN':' open' if relative in {'links.html','fan-services.html','contact.html'} else '', 'SEARCH_CURRENT':' aria-current="page"' if relative=='search.html' else '', 'FOOTER_NOTE':footer_notes.get(relative,'公式情報はRESCENEおよび所属事務所・各主催者の案内もあわせてご確認ください。'),'YEAR_ATTR':'data-year=""' if relative=='sync-status.html' else 'data-year','DESKTOP_NAV':desktop_nav,'MOBILE_NAV':mobile_nav}
        try: normalized,is_changed=normalize_page(path,contact_header_template if is_contact else header_template,contact_footer_template if is_contact else footer_template,replacements)
        except ValueError as exc: failures.append(str(exc));continue
        if is_changed:
            changed.append(relative)
            if not args.check:path.write_text(normalized,encoding='utf-8')
    if failures:
        print('❌ 共通レイアウト同期エラー');[print('-',x) for x in failures];return 1
    if args.check and changed:
        print(f'❌ 共通レイアウト未同期: {len(changed)}ページ');[print('-',x) for x in changed[:50]];return 1
    print(f"{'✅ 共通レイアウト一致' if args.check else '共通レイアウトを同期しました'}（変更 {0 if args.check else len(changed)}ページ / 対象 {processed}ページ）。")
    return 0
if __name__=='__main__':sys.exit(main())
