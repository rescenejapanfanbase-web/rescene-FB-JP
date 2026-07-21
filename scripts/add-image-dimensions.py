#!/usr/bin/env python3
"""Add intrinsic width/height to local HTML images without changing their display CSS."""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
IMG_RE = re.compile(r"<img\b[^>]*>", re.I)
SRC_RE = re.compile(r"\bsrc\s*=\s*([\"'])(.*?)\1", re.I | re.S)
WIDTH_RE = re.compile(r"\bwidth\s*=", re.I)
HEIGHT_RE = re.compile(r"\bheight\s*=", re.I)


def local_image(page: Path, src: str) -> Path | None:
    value = unquote(urlsplit(src).path)
    if not value or value.startswith("//"):
        return None
    parsed = urlsplit(src)
    if parsed.scheme or src.startswith(("data:", "blob:")):
        return None
    candidate = ROOT / value.lstrip("/") if value.startswith("/") else page.parent / value
    try:
        candidate = candidate.resolve()
        candidate.relative_to(ROOT.resolve())
    except (OSError, ValueError):
        return None
    return candidate if candidate.is_file() else None


def dimensions(path: Path) -> tuple[int, int] | None:
    try:
        with Image.open(path) as image:
            width, height = image.size
        return (int(width), int(height)) if width > 0 and height > 0 else None
    except Exception:
        return None


def update_page(page: Path) -> tuple[str, int, list[str]]:
    original = page.read_text(encoding="utf-8")
    added = 0
    unresolved: list[str] = []

    def replace(match: re.Match[str]) -> str:
        nonlocal added
        tag = match.group(0)
        if WIDTH_RE.search(tag) and HEIGHT_RE.search(tag):
            return tag
        src_match = SRC_RE.search(tag)
        if not src_match:
            unresolved.append("srcなし")
            return tag
        source = src_match.group(2).strip()
        if "${" in source or "{{" in source:
            return tag
        image_path = local_image(page, source)
        if not image_path:
            # Remote/dynamic images are allowed to remain without intrinsic dimensions.
            if not urlsplit(source).scheme and not source.startswith(("data:", "blob:")):
                unresolved.append(source)
            return tag
        size = dimensions(image_path)
        if not size:
            unresolved.append(source)
            return tag
        attrs = []
        if not WIDTH_RE.search(tag):
            attrs.append(f'width="{size[0]}"')
        if not HEIGHT_RE.search(tag):
            attrs.append(f'height="{size[1]}"')
        if not attrs:
            return tag
        added += 1
        insertion = " " + " ".join(attrs)
        if tag.endswith("/>"):
            return tag[:-2].rstrip() + insertion + ">"
        return tag[:-1].rstrip() + insertion + ">"

    return IMG_RE.sub(replace, original), added, unresolved


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="変更せず不足だけを検査")
    args = parser.parse_args()

    changed: list[str] = []
    total = 0
    unresolved: list[tuple[str, str]] = []
    pages = sorted(p for p in ROOT.rglob("*.html") if ".git" not in p.parts and "templates" not in p.parts)
    for page in pages:
        updated, count, missing = update_page(page)
        relative = page.relative_to(ROOT).as_posix()
        if count:
            changed.append(relative)
            total += count
            if not args.check:
                page.write_text(updated, encoding="utf-8")
        unresolved.extend((relative, value) for value in missing)

    if unresolved:
        print(f"⚠️ 寸法を取得できないローカル画像: {len(unresolved)}件")
        for page, value in unresolved[:30]:
            print(f"- {page}: {value}")
    if args.check and changed:
        print(f"❌ width/height未反映: {total}画像 / {len(changed)}ページ")
        for name in changed[:50]:
            print(f"- {name}")
        return 1
    if args.check:
        print(f"✅ ローカル画像のwidth/height設定済み: {len(pages)}ページ")
    else:
        print(f"画像寸法を追加しました（{total}画像 / {len(changed)}ページ）。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
