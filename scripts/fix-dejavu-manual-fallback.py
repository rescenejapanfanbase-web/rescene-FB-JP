#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_PATH = ROOT / "data" / "records.json"
MANUAL_PATH = ROOT / "data" / "records-manual.json"

COPY_FIELDS = (
    "releaseDate",
    "top100Peak",
    "top100PeakDate",
    "dailyPeak",
    "dailyPeakDate",
    "description",
    "mvUrl",
    "translations",
)

def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))

def find_dejavu(records):
    for item in records.get("melonRecords", []):
        if str(item.get("song") or "").strip().lower() == "deja vu":
            return item
    return None

def main() -> int:
    public = load(PUBLIC_PATH)
    manual = load(MANUAL_PATH)

    source = find_dejavu(public)
    target = find_dejavu(manual)
    if source is None:
        raise RuntimeError("data/records.json に Deja Vu が見つかりません。")
    if target is None:
        raise RuntimeError("data/records-manual.json に Deja Vu が見つかりません。")

    # The public record has just been refreshed from Notion by
    # sync-dejavu-melon-record.py. Keep the fallback aligned with it so the
    # standard merge can never restore an obsolete peak.
    for field in COPY_FIELDS:
        if field in source:
            target[field] = source[field]

    # Remove the old hard-coded protection that forced TOP100 #13.
    target.pop("notionGuard", None)

    # Keep this as a fallback record; authoritative values still come from Notion.
    target["source"] = "manual-fallback"

    MANUAL_PATH.write_text(
        json.dumps(manual, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(
        "Deja Vu manual fallback refreshed: "
        f"TOP100 #{source.get('top100Peak')} / Daily #{source.get('dailyPeak')}"
    )
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
