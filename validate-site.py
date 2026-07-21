#!/usr/bin/env python3
"""Validate the generated static site and its synchronized data.

This is intentionally dependency-free so it can run locally and in GitHub Actions.
Errors block publication. Warnings are reported but do not fail the check.
"""
from __future__ import annotations

import html.parser
import json
import re
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / "data" / "quality-report.json"
SAFE_SCHEMES = {"http", "https", "mailto", "tel"}
MV_FORBIDDEN = re.compile(
    r"(?:behind(?:\s+the\s+scenes|\s+film)?|비하인드|making|메이킹|reaction|리액션|"
    r"watch(?:ing)?|감상|리뷰|commentary|코멘터리|teaser|티저|trailer|트레일러|"
    r"preview|프리뷰|dance\s+practice|안무\s+연습|challenge|챌린지)",
    re.IGNORECASE,
)

errors: list[dict[str, str]] = []
warnings: list[dict[str, str]] = []


def add(level: str, code: str, message: str, file: str = "") -> None:
    item = {"code": code, "message": message}
    if file:
        item["file"] = file
    (errors if level == "error" else warnings).append(item)


def read_json(relative: str):
    path = ROOT / relative
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        add("error", "json.missing", "JSONファイルがありません。", relative)
    except json.JSONDecodeError as exc:
        add("error", "json.invalid", f"JSONを解析できません: {exc}", relative)
    return None


def is_safe_url(value: str, *, allow_relative: bool = True) -> bool:
    text = str(value or "").strip()
    if not text:
        return True
    if text.startswith("#"):
        return allow_relative
    parsed = urlsplit(text)
    if parsed.scheme:
        return parsed.scheme.lower() in SAFE_SCHEMES
    if not allow_relative:
        return False
    return not text.lower().startswith(("javascript:", "data:", "vbscript:"))


def validate_unique(items: list[dict], file: str, fields=("slug", "anchor")) -> None:
    for field in fields:
        values = [str(item.get(field, "")).strip() for item in items if str(item.get(field, "")).strip()]
        duplicates = sorted(value for value, count in Counter(values).items() if count > 1)
        for value in duplicates:
            add("error", f"data.duplicate-{field}", f"{field}が重複しています: {value}", file)


class PageParser(html.parser.HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.ids: list[str] = []
        self.links: list[str] = []
        self.images: list[dict[str, str | None]] = []
        self.title = ""
        self._title = False
        self.description = ""
        self.description_count = 0
        self.robots_count = 0
        self.canonical = ""
        self.canonical_count = 0
        self.html_lang = ""

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == "html":
            self.html_lang = values.get("lang", "") or ""
        if values.get("id"):
            self.ids.append(values["id"])
        if tag == "a" and values.get("href"):
            self.links.append(values["href"])
        if tag == "img":
            self.images.append(values)
        if tag == "meta" and values.get("name", "").lower() == "description":
            self.description_count += 1
            self.description = values.get("content", "") or ""
        if tag == "meta" and values.get("name", "").lower() == "robots":
            self.robots_count += 1
        if tag == "link" and values.get("rel", "").lower() == "canonical":
            self.canonical_count += 1
            self.canonical = values.get("href", "") or ""
        if tag == "title":
            self._title = True

    def handle_endtag(self, tag):
        if tag == "title":
            self._title = False

    def handle_data(self, data):
        if self._title:
            self.title += data


def resolve_html(source: Path, href: str) -> tuple[Path | None, str]:
    parsed = urlsplit(href)
    if parsed.scheme or href.startswith(("mailto:", "tel:", "javascript:", "data:", "#")):
        return None, parsed.fragment
    raw = unquote(parsed.path)
    if not raw:
        return source, parsed.fragment
    target = ROOT / raw.lstrip("/") if raw.startswith("/") else source.parent / raw
    if raw.endswith("/"):
        target /= "index.html"
    elif not target.suffix:
        target = target.with_suffix(".html")
    try:
        target = target.resolve()
        target.relative_to(ROOT.resolve())
    except (OSError, ValueError):
        return None, parsed.fragment
    return target, parsed.fragment


def validate_html() -> dict[str, PageParser]:
    parsed_pages: dict[str, PageParser] = {}
    html_files = sorted(p for p in ROOT.rglob("*.html") if ".git" not in p.parts and "templates" not in p.parts)
    for path in html_files:
        relative = path.relative_to(ROOT).as_posix()
        parser = PageParser()
        source_text = path.read_text(encoding="utf-8", errors="replace")
        parser.feed(source_text)
        if re.search(r"</(?:meta|link)>", source_text, flags=re.I):
            add("error", "html.void-closing-tag", "meta/linkに不要な閉じタグがあります。", relative)
        parsed_pages[relative] = parser
        for duplicate in sorted(value for value, count in Counter(parser.ids).items() if count > 1):
            add("error", "html.duplicate-id", f"同じidが複数あります: {duplicate}", relative)
        if not parser.title.strip():
            add("error", "seo.title", "titleがありません。", relative)
        if relative not in {"404.html"} and not parser.description.strip():
            add("error", "seo.description", "meta descriptionがありません。", relative)
        if relative not in {"404.html"} and parser.description_count != 1:
            add("error", "seo.description-count", f"meta descriptionは1件必要です: {parser.description_count}件", relative)
        if parser.robots_count != 1:
            add("error", "seo.robots-count", f"robots metaは1件必要です: {parser.robots_count}件", relative)
        if relative not in {"404.html"} and not parser.canonical.strip():
            add("error", "seo.canonical", "canonicalがありません。", relative)
        if relative not in {"404.html"} and parser.canonical_count != 1:
            add("error", "seo.canonical-count", f"canonicalは1件必要です: {parser.canonical_count}件", relative)
        if not parser.html_lang:
            add("warning", "a11y.lang", "html要素にlangがありません。", relative)
        for index, image in enumerate(parser.images, 1):
            if image.get("alt") is None:
                add("warning", "a11y.image-alt", f"{index}番目の画像にalt属性がありません。", relative)
            if not (image.get("width") and image.get("height")):
                add("warning", "performance.image-size", f"{index}番目の画像にwidth/heightがありません。", relative)
    # Validate local fragments after every page has been parsed.
    id_cache = {name: set(parser.ids) for name, parser in parsed_pages.items()}
    # IDs rendered from synchronized JSON do not exist in the static fallback HTML.
    dynamic_sources = {
        "discography.html": ("data/discography.json", "releases"),
        "members.html": ("data/members.json", "members"),
        "mv.html": ("data/mv.json", "items"),
        "chants.html": ("data/chants.json", "chants"),
    }
    for page_name, (json_name, list_key) in dynamic_sources.items():
        try:
            payload = json.loads((ROOT / json_name).read_text(encoding="utf-8"))
            id_cache.setdefault(page_name, set()).update(
                str(item.get("anchor", "")).strip()
                for item in payload.get(list_key, [])
                if str(item.get("anchor", "")).strip()
            )
        except (OSError, json.JSONDecodeError, AttributeError):
            pass
    for relative, parser in parsed_pages.items():
        source = ROOT / relative
        for href in parser.links:
            target, fragment = resolve_html(source, href)
            if target is None or not fragment or "${" in fragment:
                continue
            try:
                target_relative = target.relative_to(ROOT).as_posix()
            except ValueError:
                continue
            if target.exists() and target.suffix.lower() == ".html" and fragment not in id_cache.get(target_relative, set()):
                add("error", "html.missing-anchor", f"リンク先のアンカーがありません: {href}", relative)
    return parsed_pages



def parse_data_js(relative: str):
    path = ROOT / relative
    try:
        text = path.read_text(encoding="utf-8").strip()
    except OSError as exc:
        add("error", "data-js.missing", f"JavaScriptデータを読めません: {exc}", relative)
        return None
    match = re.search(r"=\s*([\s\S]+?);?\s*$", text)
    if not match:
        add("error", "data-js.invalid", "window変数への代入形式を解析できません。", relative)
        return None
    try:
        return json.loads(match.group(1).rstrip("; \n\r\t"))
    except json.JSONDecodeError as exc:
        add("error", "data-js.invalid", f"埋め込みJSONを解析できません: {exc}", relative)
        return None


def validate_json_js_pairs() -> None:
    pairs = [
        ("data/about.json", "data/about-data.js", None),
        ("data/chants.json", "data/chants-data.js", None),
        ("data/contact.json", "data/contact-data.js", None),
        ("data/discography.json", "data/discography-data.js", None),
        ("data/homepage.json", "data/homepage-data.js", None),
        ("data/members.json", "data/members-data.js", None),
        ("data/mv.json", "data/mv-data.js", None),
        ("data/news.json", "data/news-data.js", "news"),
        ("data/official-links.json", "data/official-links-data.js", None),
        ("data/schedule.json", "data/schedule-data.js", "events"),
        ("data/streaming-guide.json", "data/streaming-guide-data.js", None),
        ("data/voting-guide.json", "data/voting-guide-data.js", None),
    ]
    for json_name, js_name, key in pairs:
        payload = read_json(json_name)
        embedded = parse_data_js(js_name)
        if payload is None or embedded is None:
            continue
        expected = payload.get(key) if key and isinstance(payload, dict) else payload
        if expected != embedded:
            add("error", "data-js.mismatch", f"JSONとJavaScriptフォールバックが一致しません: {json_name} / {js_name}", js_name)

def validate_data() -> None:
    discography = read_json("data/discography.json") or {}
    releases = discography.get("releases", []) if isinstance(discography, dict) else []
    validate_unique(releases, "data/discography.json")
    for item in releases:
        if not item.get("published", True):
            continue
        title = item.get("title", "タイトル未設定")
        for field, host in (("appleMusic", "music.apple.com"), ("spotify", "open.spotify.com")):
            value = str(item.get(field, "")).strip()
            if not value:
                add("error", f"discography.{field}-missing", f"{title}の{field}リンクがありません。", "data/discography.json")
            elif urlsplit(value).scheme != "https" or urlsplit(value).netloc.lower() != host:
                add("error", f"discography.{field}-invalid", f"{title}の{field}リンクが不正です: {value}", "data/discography.json")

    members = (read_json("data/members.json") or {}).get("members", [])
    validate_unique(members, "data/members.json")
    if len(members) != 5:
        add("error", "members.count", f"公開メンバーが5人ではありません: {len(members)}", "data/members.json")

    official = (read_json("data/official-links.json") or {}).get("links", [])
    validate_unique(official, "data/official-links.json", fields=("anchor",))
    for item in official:
        if not is_safe_url(item.get("url", ""), allow_relative=False):
            add("error", "official.url", f"不正な公式リンクです: {item.get('title')} / {item.get('url')}", "data/official-links.json")

    homepage = (read_json("data/homepage.json") or {}).get("items", [])
    validate_unique(homepage, "data/homepage.json", fields=("anchor",))
    required = {"hero", "latest", "quick-heading", "about-focus", "footer-main", "footer-note", "not-found"}
    existing = {item.get("anchor") for item in homepage}
    for anchor in sorted(required - existing):
        add("error", "homepage.required", f"必須項目がありません: {anchor}", "data/homepage.json")

    for filename, key in (
        ("data/about.json", "items"),
        ("data/contact.json", "items"),
        ("data/streaming-guide.json", "guides"),
    ):
        payload = read_json(filename) or {}
        items = payload.get(key, []) if isinstance(payload, dict) else []
        validate_unique(items, filename, fields=("slug", "anchor"))

    voting = read_json("data/voting-guide.json") or {}
    for key in ("programs", "apps"):
        validate_unique(voting.get(key, []), "data/voting-guide.json", fields=("slug", "anchor"))

    schedule = (read_json("data/schedule.json") or {}).get("events", [])
    validate_unique(schedule, "data/schedule.json", fields=("id",))
    for item in schedule:
        value = item.get("start") or item.get("date")
        if not value:
            add("error", "schedule.date", f"日時がありません: {item.get('title')}", "data/schedule.json")
            continue
        try:
            datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            add("error", "schedule.date", f"日時形式が不正です: {item.get('title')} / {value}", "data/schedule.json")
        if not is_safe_url(item.get("link", "")):
            add("error", "schedule.url", f"不正なリンクです: {item.get('title')}", "data/schedule.json")

    mv = (read_json("data/mv.json") or {}).get("items", [])
    validate_unique(mv, "data/mv.json", fields=("videoId", "anchor"))
    for item in mv:
        source = f"{item.get('sourceTitle', '')} {item.get('title', '')}"
        if item.get("autoDetected") and MV_FORBIDDEN.search(source):
            add("error", "mv.forbidden", f"MV一覧に除外対象が混入しています: {item.get('title')}", "data/mv.json")

    youtube = (read_json("data/youtube-channels.json") or {}).get("channels", [])
    validate_unique(youtube, "data/youtube-channels.json", fields=("key", "channelId"))
    for channel in youtube:
        seen: set[str] = set()
        for video in channel.get("videos", []):
            video_id = str(video.get("videoId", ""))
            if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
                add("error", "youtube.video-id", f"動画IDが不正です: {video_id}", "data/youtube-channels.json")
            if video_id in seen:
                add("error", "youtube.duplicate", f"同一チャンネル内で動画が重複しています: {video_id}", "data/youtube-channels.json")
            seen.add(video_id)
            if video.get("videoType") and video.get("videoType") not in {"video", "short", "live"}:
                add("error", "youtube.type", f"動画カテゴリーが不正です: {video_id} / {video.get('videoType')}", "data/youtube-channels.json")

    # Parse every JSON file so malformed generated files are never published.
    for path in sorted((ROOT / "data").glob("*.json")):
        try:
            json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:
            add("error", "json.invalid", f"JSONを解析できません: {exc}", path.relative_to(ROOT).as_posix())


def report_timestamp() -> str:
    values: list[str] = []
    for path in (ROOT / "data").glob("*.json"):
        if path.name == REPORT.name:
            continue
        try:
            value = json.loads(path.read_text(encoding="utf-8")).get("generatedAt")
            if isinstance(value, str) and value:
                values.append(value)
        except (OSError, json.JSONDecodeError, AttributeError):
            pass
    return max(values) if values else "initial"


def write_report(page_count: int) -> None:
    report = {
        "version": 1,
        "generatedAt": report_timestamp(),
        "summary": {"errors": len(errors), "warnings": len(warnings), "htmlPages": page_count},
        "errors": errors,
        "warnings": warnings,
    }
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    pages = validate_html()
    validate_data()
    validate_json_js_pairs()
    write_report(len(pages))
    if warnings:
        print(f"⚠️  警告: {len(warnings)}件（data/quality-report.jsonを確認）")
    if errors:
        print(f"❌ 品質検査エラー: {len(errors)}件")
        for item in errors[:50]:
            location = f" [{item.get('file')}]" if item.get("file") else ""
            print(f"- {item['code']}{location}: {item['message']}")
        return 1
    print(f"✅ 品質検査成功: HTML {len(pages)}ページ / 警告 {len(warnings)}件")
    return 0


if __name__ == "__main__":
    sys.exit(main())
