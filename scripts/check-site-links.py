#!/usr/bin/env python3
"""Check local links and asset references in a static GitHub Pages site."""

from __future__ import annotations

import html.parser
import re
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
TEXT_EXTENSIONS = {".html", ".css", ".js", ".json"}
ASSET_EXTENSIONS = {
    ".html", ".css", ".js", ".json", ".xml", ".txt",
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg", ".ico",
    ".mp3", ".m4a", ".wav", ".mp4", ".webm", ".pdf", ".ics",
}
IGNORED_FILES = {
    Path("js/data.js"),  # 現在のページから読み込まれていない旧ニュースデータ
}

IGNORE_PREFIXES = (
    "http://", "https://", "mailto:", "tel:", "javascript:", "data:", "blob:",
)


class ReferenceParser(html.parser.HTMLParser):
    ATTRS = {"href", "src", "poster", "data-src"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.references: list[tuple[str, int]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        line, _ = self.getpos()
        for name, value in attrs:
            if not value:
                continue
            if name in self.ATTRS:
                self.references.append((value.strip(), line))
            elif name == "srcset":
                for item in value.split(","):
                    candidate = item.strip().split(" ", 1)[0]
                    if candidate:
                        self.references.append((candidate, line))


CSS_URL_RE = re.compile(r"url\(\s*(['\"]?)(.*?)\1\s*\)", re.IGNORECASE)
QUOTED_LOCAL_RE = re.compile(
    r"(?P<quote>['\"])(?P<path>(?!https?://|data:|mailto:|tel:|javascript:|#)[^'\"\s<>]+?\.(?:html?|css|js|json|png|jpe?g|gif|webp|avif|svg|ico|mp3|m4a|wav|mp4|webm|pdf)(?:\?[^'\"\s<>]*)?(?:#[^'\"\s<>]*)?)(?P=quote)",
    re.IGNORECASE,
)


def should_ignore(reference: str) -> bool:
    value = reference.strip()
    if not value or value.startswith("#"):
        return True
    return value.lower().startswith(IGNORE_PREFIXES)


def resolve_reference(source: Path, reference: str) -> Path | None:
    """Resolve a site reference to a repository path.

    HTML/CSS references are relative to their containing file. Paths stored in
    site data files (.js/.json), such as ``news/example.jpg`` and
    ``discography.html#album``, are browser paths and therefore relative to the
    GitHub Pages site root unless explicitly prefixed with ./ or ../.
    """
    if should_ignore(reference):
        return None

    parsed = urlsplit(reference)
    raw_path = unquote(parsed.path).strip()
    if not raw_path:
        return None

    explicit_relative = raw_path.startswith("./") or raw_path.startswith("../")

    if raw_path.startswith("/"):
        candidate = ROOT / raw_path.lstrip("/")
    elif source.suffix.lower() in {".js", ".json"} and not explicit_relative:
        candidate = ROOT / raw_path
    else:
        candidate = source.parent / raw_path

    if raw_path.endswith("/"):
        candidate = candidate / "index.html"

    try:
        return candidate.resolve(strict=False)
    except OSError:
        return candidate


def collect_references(path: Path) -> list[tuple[str, int]]:
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        text = path.read_text(encoding="utf-8", errors="replace")

    refs: list[tuple[str, int]] = []

    if path.suffix.lower() == ".html":
        parser = ReferenceParser()
        parser.feed(text)
        refs.extend(parser.references)

    for match in CSS_URL_RE.finditer(text):
        line = text.count("\n", 0, match.start()) + 1
        refs.append((match.group(2).strip(), line))

    # Also catches paths stored inside JavaScript/JSON data.
    for match in QUOTED_LOCAL_RE.finditer(text):
        line = text.count("\n", 0, match.start()) + 1
        refs.append((match.group("path"), line))

    return refs


def main() -> int:
    missing: list[tuple[Path, int, str, Path]] = []
    checked: set[tuple[Path, str]] = set()

    files = sorted(
        p for p in ROOT.rglob("*")
        if p.is_file()
        and p.suffix.lower() in TEXT_EXTENSIONS
        and ".git" not in p.parts
        and "node_modules" not in p.parts
        and p.relative_to(ROOT) not in IGNORED_FILES
    )

    for source in files:
        for reference, line in collect_references(source):
            key = (source, reference)
            if key in checked:
                continue
            checked.add(key)

            target = resolve_reference(source, reference)
            if target is None:
                continue

            try:
                target.relative_to(ROOT.resolve())
            except ValueError:
                continue

            if target.exists():
                continue

            if target.suffix == "" and target.with_suffix(".html").exists():
                continue

            if target.suffix.lower() not in ASSET_EXTENSIONS and Path(urlsplit(reference).path).suffix:
                continue

            missing.append((source, line, reference, target))

    if missing:
        print("\n❌ サイト内で参照先が見つからないリンク・画像があります。\n")
        for source, line, reference, target in missing:
            rel_source = source.relative_to(ROOT)
            rel_target = target.relative_to(ROOT.resolve())
            print(f"- {rel_source}:{line}")
            print(f"  記載: {reference}")
            print(f"  不足: {rel_target}\n")
        print(f"合計: {len(missing)}件")
        return 1

    print(f"✅ サイト内チェック成功: {len(files)}ファイル / {len(checked)}参照を確認しました。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
