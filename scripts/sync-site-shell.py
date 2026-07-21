#!/usr/bin/env python3
"""Keep the shared header, mobile navigation, footer, and common script identical.

The public site remains fully static. This script renders shared templates into each
HTML file at build time, so there is no runtime layout flash or JavaScript dependency.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HEADER_TEMPLATE = ROOT / "templates" / "site-header.html"
FOOTER_TEMPLATE = ROOT / "templates" / "site-footer.html"
CONTACT_HEADER_TEMPLATE = ROOT / "templates" / "site-header-contact.html"
CONTACT_FOOTER_TEMPLATE = ROOT / "templates" / "site-footer-contact.html"
HEADER_START = "<!-- SITE-HEADER-START -->"
HEADER_END = "<!-- SITE-HEADER-END -->"
FOOTER_START = "<!-- SITE-FOOTER-START -->"
FOOTER_END = "<!-- SITE-FOOTER-END -->"

INLINE_COMMON_RE = re.compile(
    r'<script>\s*\(\(\)=>\{\s*const root=document\.documentElement,menu=document\.getElementById\(\'mobileMenu\'\).*?</script>\s*',
    re.S,
)
COMMON_SCRIPT_RE = re.compile(
    r'<script\s+src=["\'](?:/|(?:\.\./)*)?js/common\.js(?:\?[^"\']*)?["\']\s*></script>\s*',
    re.I,
)


def root_prefix(path: Path) -> str:
    return "" if path.parent == ROOT else "/"


def render(template: str, prefix: str, replacements: dict[str, str] | None = None) -> str:
    rendered = template.replace("{{ROOT}}", prefix)
    for key, value in (replacements or {}).items():
        rendered = rendered.replace("{{" + key + "}}", value)
    return rendered.rstrip()


def normalize_page(
    path: Path,
    header_template: str,
    footer_template: str,
    replacements: dict[str, str] | None = None,
) -> tuple[str, bool]:
    original = path.read_text(encoding="utf-8")
    text = original
    prefix = root_prefix(path)
    header = f"{HEADER_START}\n{render(header_template, prefix, replacements)}\n{HEADER_END}"
    footer = f"{FOOTER_START}\n{render(footer_template, prefix, replacements)}\n{FOOTER_END}"

    if HEADER_START in text and HEADER_END in text:
        text = re.sub(
            re.escape(HEADER_START) + r".*?" + re.escape(HEADER_END),
            lambda _: header,
            text,
            count=1,
            flags=re.S,
        )
    else:
        text, count = re.subn(r"<header\b.*?(?=<main\b)", lambda _: header + "\n", text, count=1, flags=re.S)
        if count != 1:
            raise ValueError(f"共通ヘッダー範囲を特定できません: {path.relative_to(ROOT)}")

    if FOOTER_START in text and FOOTER_END in text:
        text = re.sub(
            re.escape(FOOTER_START) + r".*?" + re.escape(FOOTER_END),
            lambda _: footer,
            text,
            count=1,
            flags=re.S,
        )
    else:
        text, count = re.subn(r'<footer\b[^>]*class=["\'][^"\']*site-footer[^"\']*["\'][^>]*>.*?</footer>', lambda _: footer, text, count=1, flags=re.S | re.I)
        if count != 1:
            raise ValueError(f"共通フッターを特定できません: {path.relative_to(ROOT)}")

    # Replace the old copied menu/theme script and guarantee one external common script.
    text = INLINE_COMMON_RE.sub("", text)
    text = COMMON_SCRIPT_RE.sub("", text)
    common_script = f'<script src="{prefix}js/common.js"></script>'
    text = text.replace(FOOTER_END, f"{FOOTER_END}\n{common_script}", 1)

    return text, text != original


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="変更せず共通部品の差分だけを検査")
    args = parser.parse_args()

    header_template = HEADER_TEMPLATE.read_text(encoding="utf-8")
    footer_template = FOOTER_TEMPLATE.read_text(encoding="utf-8")
    contact_header_template = CONTACT_HEADER_TEMPLATE.read_text(encoding="utf-8")
    contact_footer_template = CONTACT_FOOTER_TEMPLATE.read_text(encoding="utf-8")
    changed: list[str] = []
    failures: list[str] = []

    for path in sorted(p for p in ROOT.rglob("*.html") if ".git" not in p.parts and "templates" not in p.parts):
        try:
            relative_name = path.relative_to(ROOT).as_posix()
            is_contact = relative_name == "contact.html"
            selected_header = contact_header_template if is_contact else header_template
            selected_footer = contact_footer_template if is_contact else footer_template
            footer_notes = {
                "external-links.html": "外部サービスの公開状態を自動確認しています。",
                "search.html": "検索結果は公開中の固定ページと同期データをもとに表示しています。",
                "sync-status.html": "公開データ、バックアップ、GitHub Actionsの実行状況を表示しています。",
                "youtube.html": "掲載動画の権利は各権利者に帰属します。公式情報は各チャンネルの案内もあわせてご確認ください。",
            }
            replacements = {
                "MUSIC_OPEN": " open" if relative_name == "youtube.html" else "",
                "SEARCH_CURRENT": ' aria-current="page"' if relative_name == "search.html" else "",
                "FOOTER_NOTE": footer_notes.get(
                    relative_name,
                    "公式情報はRESCENEおよび所属事務所・各主催者の案内もあわせてご確認ください。",
                ),
                "YEAR_ATTR": 'data-year=""' if relative_name == "sync-status.html" else "data-year",
            }
            normalized, is_changed = normalize_page(
                path, selected_header, selected_footer, replacements
            )
        except ValueError as exc:
            failures.append(str(exc))
            continue
        if is_changed:
            changed.append(path.relative_to(ROOT).as_posix())
            if not args.check:
                path.write_text(normalized, encoding="utf-8")

    if failures:
        print("❌ 共通レイアウト同期エラー")
        for failure in failures:
            print(f"- {failure}")
        return 1
    if args.check and changed:
        print(f"❌ 共通レイアウト未同期: {len(changed)}ページ")
        for name in changed[:50]:
            print(f"- {name}")
        return 1
    if args.check:
        print(f"✅ 共通レイアウト一致: {len([p for p in ROOT.rglob('*.html') if 'templates' not in p.parts])}ページ")
    else:
        print(f"共通レイアウトを同期しました（変更 {len(changed)}ページ）。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
