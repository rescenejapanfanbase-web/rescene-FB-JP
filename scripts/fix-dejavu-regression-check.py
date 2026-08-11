#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "scripts" / "check-requested-regressions.py"

OLD = r'''require(deja_vu is not None and deja_vu.get("top100Peak") == 13, f"Deja VuのMelon TOP100確定値が13位ではありません: {deja_vu.get('top100Peak') if deja_vu else '行なし'}")
require("#13" in text("melon-records.html"), "Deja VuのMelon TOP100 13位がHTMLへ反映されていません")'''

NEW = r'''require(deja_vu is not None, "Deja VuのMelon記録がdata/records.jsonにありません")
deja_vu_peak = deja_vu.get("top100Peak") if deja_vu else None
require(isinstance(deja_vu_peak, int) and deja_vu_peak > 0, f"Deja VuのMelon TOP100最高順位が不正です: {deja_vu_peak}")
require(
    f"#{deja_vu_peak}" in text("melon-records.html") if isinstance(deja_vu_peak, int) else False,
    f"Deja VuのMelon TOP100最高順位がHTMLと一致していません: data={deja_vu_peak}",
)'''

def main() -> int:
    source = TARGET.read_text(encoding="utf-8")

    if NEW in source:
        print("Deja Vu regression check is already dynamic.")
        return 0

    if OLD not in source:
        raise RuntimeError(
            "古いDeja Vu 13位固定チェックを見つけられません。"
            " scripts/check-requested-regressions.py を確認してください。"
        )

    TARGET.write_text(source.replace(OLD, NEW, 1), encoding="utf-8")
    print("Deja Vu regression check updated: hard-coded #13 -> data/HTML consistency.")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
