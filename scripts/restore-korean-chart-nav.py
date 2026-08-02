#!/usr/bin/env python3
"""Restore the Korean Charts link under Music in desktop and mobile headers."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
START = "<!-- SITE-HEADER-START -->"
END = "<!-- SITE-HEADER-END -->"

RECORDS_LINK = (
    '<a href="records.html" data-i18n-ko="기록" '
    'data-i18n-en="Records">記録</a>'
)
CHART_LINK = (
    '<a href="korean-charts.html" data-i18n-ko="한국 차트" '
    'data-i18n-en="Korean Charts">韓国チャート</a>'
)


def patch_header(header: str) -> tuple[str, int]:
    # Remove duplicate chart links first, then insert exactly after Records.
    cleaned = header.replace(CHART_LINK, "")
    occurrences = cleaned.count(RECORDS_LINK)
    if occurrences < 2:
        raise RuntimeError(
            f"音楽メニューのRecordsリンクが不足しています: {occurrences}件"
        )
    patched = cleaned.replace(RECORDS_LINK, RECORDS_LINK + CHART_LINK)
    return patched, occurrences


def main() -> int:
    updated = 0
    checked = 0
    for path in sorted(ROOT.glob("*.html")):
        text = path.read_text(encoding="utf-8")
        if START not in text or END not in text:
            continue
        checked += 1
        prefix, rest = text.split(START, 1)
        header, suffix = rest.split(END, 1)
        patched, _ = patch_header(header)
        output = prefix + START + patched + END + suffix
        if output != text:
            path.write_text(output, encoding="utf-8")
            updated += 1
            print(f"[NAV] {path.name}")

        current_header = output.split(START, 1)[1].split(END, 1)[0]
        count = current_header.count('href="korean-charts.html"')
        if count != 2:
            raise RuntimeError(
                f"{path.name}: 韓国チャートリンクがdesktop/mobile合計2件ではありません: {count}"
            )

    if checked == 0:
        raise RuntimeError("SITE-HEADERを含むHTMLが見つかりません。")
    print(f"ナビゲーション確認完了: {checked}ページ / 更新{updated}ページ")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
