#!/usr/bin/env python3
"""Generate SEO metadata, social images, static news pages, and sitemap."""
from __future__ import annotations

import html
import json
import os
import re
import subprocess
import textwrap
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import quote, urlparse

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[1]
BASE_URL = "https://rescene-fb.jp"
SITE_NAME = "RESCENE JAPAN FANBASE"
ALT_SITE_NAME = "リセンヌ日本ファンベース"
DEFAULT_DESCRIPTION = "RESCENEを日本から応援する非公式ファンベース。最新情報、スケジュール、作品、ストリーミング、投票ガイドをまとめています。"
DEFAULT_SOURCE_IMAGE = "assets/group/rescene-group.jpg"
OGP_DIR = ROOT / "assets" / "ogp"
ARTICLE_DIR = ROOT / "articles"
SEO_START = "<!-- SEO-AUTO-START -->"
SEO_END = "<!-- SEO-AUTO-END -->"
JST = timezone(timedelta(hours=9))
NEWS_EXTRAS: dict = {}

PAGE_META = {
    "index.html": {
        "title": f"{SITE_NAME} | {ALT_SITE_NAME}",
        "description": DEFAULT_DESCRIPTION,
        "image": "assets/group/rescene-group.jpg",
        "label": "OFFICIAL FANBASE GUIDE",
        "priority": "1.0",
        "changefreq": "daily",
    },
    "about.html": {
        "title": f"RESCENEについて | {SITE_NAME}",
        "description": "RESCENEのコンセプト、グループ名、デビュー情報、5人のメンバーを紹介します。",
        "image": "assets/group/debut-era.png",
        "label": "ABOUT RESCENE",
        "priority": "0.8",
        "changefreq": "monthly",
    },
    "members.html": {
        "title": f"メンバー | {SITE_NAME}",
        "description": "WONI、LIV、MINAMI、MAY、ZENAのプロフィールと活動情報を紹介します。",
        "image": "assets/group/rescene-group.jpg",
        "label": "MEMBER PROFILE",
        "priority": "0.8",
        "changefreq": "monthly",
    },
    "schedule.html": {
        "title": f"スケジュール | {SITE_NAME}",
        "description": "RESCENEのイベント、音楽番組、リリース、投票、記念日などの最新スケジュールを掲載しています。",
        "image": "assets/group/rescene-group.jpg",
        "label": "RESCENE SCHEDULE",
        "priority": "0.9",
        "changefreq": "hourly",
    },
    "news.html": {
        "title": f"ニュース | {SITE_NAME}",
        "description": "RESCENEのリリース、記録、イベント、広報大使などの最新ニュースを掲載しています。",
        "image": "news/fanbase-site.jpg",
        "label": "LATEST NEWS",
        "priority": "0.9",
        "changefreq": "hourly",
    },
    "discography.html": {
        "title": f"ディスコグラフィ | {SITE_NAME}",
        "description": "RESCENEのアルバム、シングル、OST、収録曲、Apple Music・Spotifyなどの配信リンクをまとめています。",
        "image": "assets/mv/pretty-girl.jpg",
        "label": "DISCOGRAPHY",
        "priority": "0.9",
        "changefreq": "weekly",
    },
    "mv.html": {
        "title": f"MV一覧 | {SITE_NAME}",
        "description": "RESCENEの公式ミュージックビデオ、パフォーマンス映像などを作品別にまとめています。",
        "image": "assets/mv/love-attack.jpg",
        "label": "MUSIC VIDEO",
        "priority": "0.8",
        "changefreq": "weekly",
    },
    "youtube.html": {
        "title": f"YouTube | {SITE_NAME}",
        "description": "RESCENE OfficialとウォニのYouTubeチャンネルで公開された動画、ショート、ライブをまとめています。",
        "image": "assets/mv/pretty-girl.jpg",
        "label": "YOUTUBE ARCHIVE",
        "priority": "0.8",
        "changefreq": "daily",
    },
    "streaming.html": {
        "title": f"ストリーミングガイド | {SITE_NAME}",
        "description": "YouTube、Spotify、Apple Music、Stationhead、TikTokなどでRESCENEを応援する方法を案内します。",
        "image": "assets/group/rescene-group.jpg",
        "label": "STREAMING GUIDE",
        "priority": "0.8",
        "changefreq": "monthly",
    },
    "voting.html": {
        "title": f"投票ガイド | {SITE_NAME}",
        "description": "RESCENEを応援するための音楽番組投票、投票アプリ、集計方法、投票券の貯め方を案内します。",
        "image": "assets/voting/vote-points-summary.png",
        "label": "VOTING GUIDE",
        "priority": "0.8",
        "changefreq": "weekly",
    },
    "chants.html": {
        "title": f"掛け声ガイド | {SITE_NAME}",
        "description": "RESCENEの楽曲別掛け声ガイドと公式・非公式の案内をまとめています。",
        "image": "assets/mv/pretty-girl.jpg",
        "label": "FANCHANT GUIDE",
        "priority": "0.8",
        "changefreq": "weekly",
    },
    "links.html": {
        "title": f"公式リンク | {SITE_NAME}",
        "description": "RESCENEの公式サイト、SNS、YouTube、音楽配信サービスへのリンクをまとめています。",
        "image": "assets/group/rescene-group.jpg",
        "label": "OFFICIAL LINKS",
        "priority": "0.7",
        "changefreq": "monthly",
    },
    "contact.html": {
        "title": f"お問い合わせ | {SITE_NAME}",
        "description": "RESCENE JAPAN FANBASEへのお問い合わせ方法と公式情報に関する注意事項をご案内します。",
        "image": "assets/group/rescene-group.jpg",
        "label": "CONTACT",
        "priority": "0.4",
        "changefreq": "yearly",
    },
    "search.html": {
        "title": f"サイト内検索 | {SITE_NAME}",
        "description": "ニュース、スケジュール、メンバー、作品、MV、YouTube、掛け声、投票ガイドを横断検索できます。",
        "image": "assets/group/rescene-group.jpg",
        "label": "SITE SEARCH",
        "noindex": True,
    },
    "sync-status.html": {
        "title": f"同期状況 | {SITE_NAME}",
        "description": "RESCENE JAPAN FANBASEの自動同期・バックアップ・チェック機能の実行状況を確認する管理ページです。",
        "image": "assets/group/rescene-group.jpg",
        "label": "SYSTEM STATUS",
        "noindex": True,
    },
    "external-links.html": {
        "title": f"外部リンクチェック | {SITE_NAME}",
        "description": "RESCENE JAPAN FANBASE内の外部リンク自動チェック結果を確認する管理ページです。",
        "image": "assets/group/rescene-group.jpg",
        "label": "LINK HEALTH",
        "noindex": True,
    },
    "favorites.html": {"title": f"お気に入り | {SITE_NAME}", "description": "端末内に保存したメンバー、掛け声、投票ガイドをまとめて確認できます。", "image": "assets/group/rescene-group.jpg", "label": "FAVORITES", "noindex": True},
    "updates.html": {"title": f"サイト更新履歴 | {SITE_NAME}", "description": "RESCENE JAPAN FANBASEの機能追加やページ更新履歴を掲載しています。", "image": "assets/group/rescene-group.jpg", "label": "SITE UPDATES", "priority": "0.4", "changefreq": "weekly"},
    "social-posts.html": {"title": f"SNS投稿文 | {SITE_NAME}", "description": "ニュース用SNS投稿文の管理ページです。", "image": "assets/group/rescene-group.jpg", "label": "SOCIAL COPY", "noindex": True},
    "mv-review.html": {"title": f"MV候補確認 | {SITE_NAME}", "description": "MV自動検出候補の確認用管理ページです。", "image": "assets/mv/love-attack.jpg", "label": "MV REVIEW", "noindex": True},
    "analytics.html": {"title": f"アクセス解析 | {SITE_NAME}", "description": "アクセス解析の設定状況を確認する管理ページです。", "image": "assets/group/rescene-group.jpg", "label": "ANALYTICS", "noindex": True},
    "offline.html": {"title": f"オフライン | {SITE_NAME}", "description": "オフライン案内ページです。", "image": "assets/group/rescene-group.jpg", "label": "OFFLINE", "noindex": True},
    "article.html": {
        "title": f"ニュース記事 | {SITE_NAME}",
        "description": "RESCENEのニュース記事ページです。",
        "image": "news/fanbase-site.jpg",
        "label": "NEWS ARTICLE",
        "noindex": True,
    },
    "404.html": {
        "title": f"404 | {SITE_NAME}",
        "description": "ページが見つかりません。",
        "image": "assets/group/rescene-group.jpg",
        "label": "PAGE NOT FOUND",
        "noindex": True,
    },
}


def run_git(*args: str) -> str:
    try:
        return subprocess.check_output(["git", *args], cwd=ROOT, text=True, stderr=subprocess.DEVNULL).strip()
    except Exception:
        return ""


def file_lastmod(path: Path) -> str:
    rel = path.relative_to(ROOT).as_posix()
    value = run_git("log", "-1", "--format=%cI", "--", rel)
    if value:
        return value[:10]
    return datetime.now(JST).date().isoformat()


def canonical_for(filename: str) -> str:
    return f"{BASE_URL}/" if filename == "index.html" else f"{BASE_URL}/{filename}"


def abs_url(path: str) -> str:
    value = str(path or "").strip()
    if value.startswith(("http://", "https://")):
        return value
    return f"{BASE_URL}/{value.lstrip('./').lstrip('/')}"


def local_image(path: str) -> Path:
    value = str(path or "").strip()
    if value.startswith(("http://", "https://")):
        return ROOT / DEFAULT_SOURCE_IMAGE
    candidate = ROOT / value.lstrip("/")
    return candidate if candidate.exists() else ROOT / DEFAULT_SOURCE_IMAGE


def font_path(bold: bool = False) -> str:
    env_key = "SEO_FONT_BOLD" if bold else "SEO_FONT_REGULAR"
    if os.environ.get(env_key):
        return os.environ[env_key]
    choices = [
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc" if bold else "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc" if bold else "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    return next((p for p in choices if Path(p).exists()), choices[-1])


def fit_crop(image: Image.Image, size=(1200, 630)) -> Image.Image:
    image = ImageOps.exif_transpose(image).convert("RGB")
    return ImageOps.fit(image, size, method=Image.Resampling.LANCZOS, centering=(0.5, 0.42))


def wrap_by_pixels(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, max_width: int, max_lines: int) -> list[str]:
    text = re.sub(r"\s+", " ", text).strip()
    lines: list[str] = []
    current = ""
    for char in text:
        candidate = current + char
        width = draw.textbbox((0, 0), candidate, font=font)[2]
        if current and width > max_width:
            lines.append(current)
            current = char
            if len(lines) >= max_lines:
                break
        else:
            current = candidate
    if current and len(lines) < max_lines:
        lines.append(current)
    consumed = "".join(lines)
    if len(consumed) < len(text) and lines:
        while lines[-1] and draw.textbbox((0, 0), lines[-1] + "…", font=font)[2] > max_width:
            lines[-1] = lines[-1][:-1]
        lines[-1] += "…"
    return lines or [text]


def create_ogp(source: Path, output: Path, title: str, label: str) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    try:
        base = fit_crop(Image.open(source))
    except Exception:
        base = Image.new("RGB", (1200, 630), "#241326")

    base = ImageEnhance.Contrast(base).enhance(0.88)
    base = ImageEnhance.Color(base).enhance(0.82)
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    for y in range(630):
        alpha = int(72 + 135 * (y / 630))
        od.line((0, y, 1200, y), fill=(21, 7, 20, alpha))
    od.rectangle((0, 0, 1200, 630), outline=(255, 125, 181, 90), width=3)
    od.rounded_rectangle((68, 62, 402, 112), radius=25, fill=(255, 104, 169, 205))
    image = Image.alpha_composite(base.convert("RGBA"), overlay)
    draw = ImageDraw.Draw(image)

    label_font = ImageFont.truetype(font_path(True), 24)
    site_font = ImageFont.truetype(font_path(True), 30)
    title_size = 68 if len(title) <= 30 else 58 if len(title) <= 48 else 50
    title_font = ImageFont.truetype(font_path(True), title_size)
    small_font = ImageFont.truetype(font_path(False), 24)

    draw.text((235, 86), label[:22], font=label_font, fill="white", anchor="mm")
    draw.text((70, 150), SITE_NAME, font=site_font, fill=(255, 226, 240, 255))
    lines = wrap_by_pixels(draw, title, title_font, 1000, 3)
    line_height = int(title_size * 1.28)
    y = 245
    for line in lines:
        draw.text((68, y), line, font=title_font, fill="white", stroke_width=1, stroke_fill=(30, 8, 25, 170))
        y += line_height
    draw.line((70, 558, 1130, 558), fill=(255, 182, 214, 150), width=2)
    draw.text((70, 582), "rescene-fb.jp", font=small_font, fill=(255, 220, 236, 255))
    draw.text((1130, 582), "RESCENE • 리센느 • リセンヌ", font=small_font, fill=(255, 220, 236, 255), anchor="ra")
    image.convert("RGB").save(output, "JPEG", quality=88, optimize=True, progressive=True)


def json_script(payload: object) -> str:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")


def static_structured_data(filename: str, meta: dict, canonical: str, image_url: str) -> list[dict]:
    webpage = {
        "@context": "https://schema.org",
        "@type": "WebPage",
        "@id": f"{canonical}#webpage",
        "url": canonical,
        "name": meta["title"],
        "description": meta["description"],
        "inLanguage": "ja-JP",
        "isPartOf": {"@id": f"{BASE_URL}/#website"},
        "primaryImageOfPage": {"@type": "ImageObject", "url": image_url, "width": 1200, "height": 630},
    }
    if filename != "index.html":
        webpage["breadcrumb"] = {"@id": f"{canonical}#breadcrumb"}
    items: list[dict] = []
    if filename == "index.html":
        items.extend([
            {
                "@context": "https://schema.org",
                "@type": "WebSite",
                "@id": f"{BASE_URL}/#website",
                "url": f"{BASE_URL}/",
                "name": SITE_NAME,
                "alternateName": ALT_SITE_NAME,
                "description": DEFAULT_DESCRIPTION,
                "inLanguage": "ja-JP",
                "publisher": {"@id": f"{BASE_URL}/#organization"},
            },
            {
                "@context": "https://schema.org",
                "@type": "Organization",
                "@id": f"{BASE_URL}/#organization",
                "name": SITE_NAME,
                "alternateName": ALT_SITE_NAME,
                "url": f"{BASE_URL}/",
                "description": "RESCENEを日本から応援する非公式ファンベースです。",
                "sameAs": ["https://x.com/Rescene_FB_JP"],
            },
        ])
    items.append(webpage)
    if filename != "index.html":
        items.append({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            "@id": f"{canonical}#breadcrumb",
            "itemListElement": [
                {"@type": "ListItem", "position": 1, "name": "ホーム", "item": f"{BASE_URL}/"},
                {"@type": "ListItem", "position": 2, "name": meta["title"].split(" | ")[0], "item": canonical},
            ],
        })
    return items


def seo_block(meta: dict, canonical: str, image_url: str, og_type: str = "website", structured: list[dict] | None = None, published: str = "", section: str = "") -> str:
    robots = "noindex, follow" if meta.get("noindex") else "index, follow, max-image-preview:large"
    parts = [
        SEO_START,
        f'<link rel="canonical" href="{html.escape(canonical, quote=True)}">',
        f'<meta name="robots" content="{robots}">',
        '<meta name="theme-color" content="#2a1727">',
        f'<meta property="og:site_name" content="{SITE_NAME}">',
        '<meta property="og:locale" content="ja_JP">',
        f'<meta property="og:type" content="{og_type}">',
        f'<meta property="og:title" content="{html.escape(meta["title"], quote=True)}">',
        f'<meta property="og:description" content="{html.escape(meta["description"], quote=True)}">',
        f'<meta property="og:url" content="{html.escape(canonical, quote=True)}">',
        f'<meta property="og:image" content="{html.escape(image_url, quote=True)}">',
        '<meta property="og:image:width" content="1200">',
        '<meta property="og:image:height" content="630">',
        f'<meta property="og:image:alt" content="{html.escape(meta["title"], quote=True)}">',
        '<meta name="twitter:card" content="summary_large_image">',
        f'<meta name="twitter:title" content="{html.escape(meta["title"], quote=True)}">',
        f'<meta name="twitter:description" content="{html.escape(meta["description"], quote=True)}">',
        f'<meta name="twitter:image" content="{html.escape(image_url, quote=True)}">',
        f'<meta name="twitter:image:alt" content="{html.escape(meta["title"], quote=True)}">',
    ]
    if published:
        parts.append(f'<meta property="article:published_time" content="{html.escape(published, quote=True)}">')
    if section:
        parts.append(f'<meta property="article:section" content="{html.escape(section, quote=True)}">')
    for item in structured or []:
        parts.append(f'<script type="application/ld+json" data-seo-structured>{json_script(item)}</script>')
    parts.append(SEO_END)
    return "\n".join(parts)


def inject_head(document: str, meta: dict, canonical: str, image_url: str, *, og_type="website", structured=None, published="", section="", base_tag=False) -> str:
    document = re.sub(rf"\s*{re.escape(SEO_START)}.*?{re.escape(SEO_END)}\s*", "\n", document, flags=re.S)
    document = re.sub(r"<title>.*?</title>", f"<title>{html.escape(meta['title'])}</title>", document, count=1, flags=re.S)
    desc_tag = f'<meta name="description" content="{html.escape(meta["description"], quote=True)}">'
    if re.search(r'<meta\s+name=["\']description["\'][^>]*>', document, flags=re.I):
        document = re.sub(r'<meta\s+name=["\']description["\'][^>]*>', desc_tag, document, count=1, flags=re.I)
    else:
        document = document.replace("</title>", f"</title>\n{desc_tag}", 1)
    block = seo_block(meta, canonical, image_url, og_type, structured, published, section)
    insertion = (f'<base href="/">\n' if base_tag and '<base href=' not in document else '') + block + "\n"
    match = re.search(r'<meta\s+name=["\']description["\'][^>]*>', document, flags=re.I)
    if match:
        document = document[:match.end()] + "\n" + insertion + document[match.end():]
    else:
        document = document.replace("<head>", "<head>\n" + insertion, 1)
    return document


def article_date(item: dict) -> str:
    value = str(item.get("date") or "")
    if re.fullmatch(r"\d{4}\.\d{2}\.\d{2}", value):
        return value.replace(".", "-") + "T00:00:00+09:00"
    value = str(item.get("sortDate") or "")
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return value + "T00:00:00+09:00"
    return ""


def safe_slug(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "-", str(value or "").strip()).strip("-").lower()
    return cleaned or "news"


def article_href(slug: str) -> str:
    return f"articles/{safe_slug(slug)}.html"


def render_paragraphs(value: str) -> str:
    paragraphs = []
    for para in re.split(r"\n{2,}", str(value or "").strip()):
        if para.strip():
            paragraphs.append(f"<p>{html.escape(para.strip()).replace(chr(10), '<br>')}</p>")
    return "".join(paragraphs)


def create_article_page(template: str, item: dict, output: Path) -> dict:
    slug = safe_slug(item.get("slug") or item.get("title"))
    title = str(item.get("title") or "RESCENEニュース").strip()
    description = str(item.get("text") or item.get("body") or "RESCENEのニュース記事です。").strip().replace("\n", " ")
    if len(description) > 155:
        description = description[:154].rstrip() + "…"
    published = article_date(item)
    section = str(item.get("categoryName") or item.get("label") or "NEWS")
    source_image = local_image(str(item.get("image") or DEFAULT_SOURCE_IMAGE))
    ogp_rel = f"assets/ogp/news/{slug}.jpg"
    create_ogp(source_image, ROOT / ogp_rel, title, str(item.get("label") or "NEWS"))
    canonical = f"{BASE_URL}/{article_href(slug)}"
    image_url = abs_url(ogp_rel)
    meta = {"title": f"{title} | {SITE_NAME}", "description": description}
    article_schema = {
        "@context": "https://schema.org",
        "@type": "NewsArticle" if published else "Article",
        "@id": f"{canonical}#article",
        "mainEntityOfPage": {"@type": "WebPage", "@id": canonical},
        "headline": title,
        "description": description,
        "image": [image_url],
        "inLanguage": "ja-JP",
        "author": {"@type": "Organization", "name": SITE_NAME, "url": f"{BASE_URL}/"},
        "publisher": {"@type": "Organization", "name": SITE_NAME, "url": f"{BASE_URL}/"},
        "articleSection": section,
    }
    if published:
        article_schema["datePublished"] = published
        article_schema["dateModified"] = published
    breadcrumb = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "@id": f"{canonical}#breadcrumb",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "ホーム", "item": f"{BASE_URL}/"},
            {"@type": "ListItem", "position": 2, "name": "ニュース", "item": f"{BASE_URL}/news.html"},
            {"@type": "ListItem", "position": 3, "name": title, "item": canonical},
        ],
    }
    page = inject_head(template, meta, canonical, image_url, og_type="article", structured=[article_schema, breadcrumb], published=published, section=section, base_tag=True)
    page = page.replace('<body class="">', '<body class="" data-static-news-article>')
    breadcrumb_html = f'<nav class="article-breadcrumb" aria-label="パンくず"><a href="index.html">ホーム</a><span>›</span><a href="news.html">ニュース</a><span>›</span><span>{html.escape(title)}</span></nav>'
    source_link = str(item.get("sourceLink") or "").strip()
    source_button = ""
    if source_link:
        external = source_link.startswith(("http://", "https://"))
        attrs = ' target="_blank" rel="noopener noreferrer"' if external else ""
        label = str(item.get("sourceLabel") or "関連リンクを見る")
        source_button = f'<a class="btn btn-primary" href="{html.escape(source_link, quote=True)}"{attrs}>{html.escape(label)} ↗</a>'
    body = render_paragraphs(item.get("body") or item.get("text") or "")
    hero_image = str(item.get("image") or "news/fanbase-site.jpg")
    share_title = html.escape(title, quote=True)
    share_text = html.escape(f"{item.get('date') or ''} {title}".strip(), quote=True)
    share_url = html.escape(canonical, quote=True)
    share_html = (
        f'<div class="share-actions"><span class="share-actions-label">この記事を共有</span>'
        f'<button class="share-button" type="button" data-share-action="native" data-share-title="{share_title}" data-share-text="{share_text}" data-share-url="{share_url}">共有</button>'
        f'<button class="share-button" type="button" data-share-action="x" data-share-title="{share_title}" data-share-text="{share_text}" data-share-url="{share_url}">X</button>'
        f'<button class="share-button" type="button" data-share-action="line" data-share-title="{share_title}" data-share-text="{share_text}" data-share-url="{share_url}">LINE</button>'
        f'<button class="share-button" type="button" data-share-action="copy" data-share-title="{share_title}" data-share-url="{share_url}">URLコピー</button></div>'
    )
    related_rows = (NEWS_EXTRAS.get("related") or {}).get(slug, [])
    related_html = ""
    if related_rows:
        cards = "".join(
            f'<a class="card related-news-card" href="articles/{safe_slug(row.get("slug"))}.html">'
            f'<img src="{html.escape(str(row.get("image") or DEFAULT_SOURCE_IMAGE), quote=True)}" alt="" loading="lazy">'
            f'<div><span class="news-date">{html.escape(str(row.get("date") or ""))}</span>'
            f'<h3>{html.escape(str(row.get("title") or "関連記事"))}</h3></div></a>'
            for row in related_rows
        )
        related_html = f'<section class="related-news"><h2>関連記事</h2><div class="related-news-grid">{cards}</div></section>'
    article_html = (
        f'<article class="article-shell card" id="newsArticle">'
        f'<div class="article-hero"><img src="{html.escape(hero_image, quote=True)}" alt="{html.escape(title, quote=True)}" loading="eager"></div>'
        f'<div class="article-body"><div class="article-meta"><time class="news-date" datetime="{html.escape(published[:10] if published else "", quote=True)}">{html.escape(str(item.get("date") or "UPDATE"))}</time><span class="badge">{html.escape(str(item.get("label") or "NEWS"))}</span></div>'
        f'<h1>{html.escape(title)}</h1><div class="article-lead">{body}</div>'
        f'<div class="article-actions">{source_button}<a class="btn btn-secondary" href="news.html">ニュース一覧へ戻る</a></div>{share_html}{related_html}</div></article>'
    )
    page = re.sub(r'<main class="container">.*?</main>', f'<main class="container">{breadcrumb_html}{article_html}</main>', page, count=1, flags=re.S)
    page = re.sub(r'<script src="data/news-data\.js"></script><script id="article-render-script">.*?</script>\s*', '', page, count=1, flags=re.S)
    page = re.sub(r'<script id="seo-legacy-article-redirect">.*?</script>\s*', '', page, count=1, flags=re.S)
    def rootify(match: re.Match[str]) -> str:
        attr, quote_char, value = match.group(1), match.group(2), match.group(3)
        if value.startswith(("/", "#", "http://", "https://", "mailto:", "tel:", "javascript:", "data:", "blob:")):
            return match.group(0)
        return f"{attr}={quote_char}/{value}{quote_char}"
    page = re.sub(r'(?i)\b(href|src)=(\"|\')([^\"\']+)(?:\2)', rootify, page)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(page, encoding="utf-8")
    return {"slug": slug, "url": canonical, "published": published, "image": image_url, "title": title}


def update_article_links() -> int:
    files = [ROOT / "js/home.js", ROOT / "js/news.js", ROOT / "js/search.js", ROOT / "js/home-latest.js", ROOT / "news.html", ROOT / "members.html"]
    changed = 0
    for path in files:
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        before = text
        text = re.sub(r'article\.html\?id=\$\{encodeURIComponent\(([^)]+)\)\}', r'articles/${encodeURIComponent(\1)}.html', text)
        text = re.sub(r'article\.html\?id=([A-Za-z0-9_-]+)', lambda m: f'articles/{safe_slug(m.group(1))}.html', text)
        if text != before:
            path.write_text(text, encoding="utf-8")
            changed += 1
    schedule = ROOT / "schedule.html"
    if schedule.exists():
        text = schedule.read_text(encoding="utf-8")
        before = text
        needle = 'const safeUrl = (value = "") => {\n    const url = String(value).trim();'
        replacement = 'const safeUrl = (value = "") => {\n    let url = String(value).trim();\n    const oldArticle = url.match(/^article\\.html\\?id=([^&#]+)/i);\n    if (oldArticle) url = `articles/${encodeURIComponent(decodeURIComponent(oldArticle[1]))}.html`;'
        if needle in text:
            text = text.replace(needle, replacement, 1)
        if text != before:
            schedule.write_text(text, encoding="utf-8")
            changed += 1
    return changed


def redirect_legacy_article() -> None:
    path = ROOT / "article.html"
    text = path.read_text(encoding="utf-8")
    if 'id="seo-legacy-article-redirect"' not in text:
        redirect = '''<script id="seo-legacy-article-redirect">\n(()=>{const id=new URLSearchParams(location.search).get('id');if(id){location.replace(`articles/${encodeURIComponent(id)}.html`)}})();\n</script>\n'''
        text = text.replace('</head>', redirect + '</head>', 1)
        path.write_text(text, encoding="utf-8")


def generate_sitemap(indexed_pages: list[dict], articles: list[dict]) -> int:
    entries = []
    for page in indexed_pages:
        entries.append(
            f"  <url>\n    <loc>{html.escape(page['url'])}</loc>\n    <lastmod>{page['lastmod']}</lastmod>\n    <changefreq>{page['changefreq']}</changefreq>\n    <priority>{page['priority']}</priority>\n  </url>"
        )
    for item in articles:
        lastmod = item["published"][:10] if item["published"] else datetime.now(JST).date().isoformat()
        entries.append(
            f"  <url>\n    <loc>{html.escape(item['url'])}</loc>\n    <lastmod>{lastmod}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>"
        )
    sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + "\n".join(entries) + '\n</urlset>\n'
    (ROOT / "sitemap.xml").write_text(sitemap, encoding="utf-8")
    (ROOT / "robots.txt").write_text(f"User-agent: *\nAllow: /\n\nSitemap: {BASE_URL}/sitemap.xml\n", encoding="utf-8")
    return len(entries)


def main() -> None:
    OGP_DIR.mkdir(parents=True, exist_ok=True)
    ARTICLE_DIR.mkdir(parents=True, exist_ok=True)
    generated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    indexed_pages: list[dict] = []
    static_ogp = 0

    for filename, meta in PAGE_META.items():
        path = ROOT / filename
        if not path.exists():
            continue
        ogp_name = "home" if filename == "index.html" else Path(filename).stem
        ogp_rel = f"assets/ogp/{ogp_name}.jpg"
        create_ogp(local_image(meta.get("image", DEFAULT_SOURCE_IMAGE)), ROOT / ogp_rel, meta["title"].split(" | ")[0], meta.get("label", "RESCENE"))
        static_ogp += 1
        canonical = canonical_for(filename)
        image_url = abs_url(ogp_rel)
        structured = [] if meta.get("noindex") else static_structured_data(filename, meta, canonical, image_url)
        document = inject_head(path.read_text(encoding="utf-8"), meta, canonical, image_url, structured=structured)
        path.write_text(document, encoding="utf-8")
        if not meta.get("noindex"):
            indexed_pages.append({
                "url": canonical,
                "lastmod": file_lastmod(path),
                "changefreq": meta.get("changefreq", "monthly"),
                "priority": meta.get("priority", "0.5"),
            })

    global NEWS_EXTRAS
    news_payload = json.loads((ROOT / "data/news.json").read_text(encoding="utf-8"))
    try:
        NEWS_EXTRAS = json.loads((ROOT / "data/news-extras.json").read_text(encoding="utf-8"))
    except Exception:
        NEWS_EXTRAS = {}
    news = news_payload.get("news", []) if isinstance(news_payload, dict) else news_payload
    template = (ROOT / "article.html").read_text(encoding="utf-8")
    articles = []
    expected = set()
    for item in news if isinstance(news, list) else []:
        slug = safe_slug(item.get("slug") or item.get("title"))
        expected.add(f"{slug}.html")
        articles.append(create_article_page(template, item, ARTICLE_DIR / f"{slug}.html"))
    for old in ARTICLE_DIR.glob("*.html"):
        if old.name not in expected:
            old.unlink()

    update_article_links()
    redirect_legacy_article()
    sitemap_count = generate_sitemap(indexed_pages, articles)

    status = {
        "generatedAt": generated_at,
        "baseUrl": BASE_URL,
        "staticPages": len(PAGE_META),
        "indexedStaticPages": len(indexed_pages),
        "newsArticles": len(articles),
        "ogpImages": static_ogp + len(articles),
        "sitemapUrls": sitemap_count,
        "canonicalPages": len(PAGE_META) + len(articles),
        "structuredDataPages": len(indexed_pages) + len(articles),
        "legacyArticleRedirect": True,
        "sitemap": "sitemap.xml",
        "robots": "robots.txt",
    }
    (ROOT / "data/seo-status.json").write_text(json.dumps(status, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"SEO生成完了: 静的 {len(indexed_pages)} / ニュース {len(articles)} / OGP {status['ogpImages']} / sitemap {sitemap_count}")


if __name__ == "__main__":
    main()
