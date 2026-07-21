#!/usr/bin/env python3
"""Generate deduplicated responsive WebP assets for the static site.

Original images are preserved. A manifest maps every original local image to a
set of responsive WebP derivatives stored under assets/optimized/.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "assets" / "optimized"
MANIFEST_PATH = ROOT / "data" / "image-manifest.json"
REPORT_PATH = ROOT / "data" / "image-optimization.json"

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
EXCLUDED_PARTS = {".git", "node_modules", "backup-work", "backup-output"}
MISPLACED_ASSET_DIR_PATTERN = re.compile(r"^[0-9a-f]{16}$")
TARGET_WIDTHS = (480, 768, 1440)
SETTINGS_VERSION = 2
JPEG_QUALITY = 84
PNG_QUALITY = 91
WEBP_QUALITY = 86
MIN_SAVING_RATIO = 0.97


@dataclass(frozen=True)
class SourceInfo:
    path: Path
    relative: str
    digest: str
    size: int


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def relative_posix(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def safe_stem(name: str) -> str:
    value = re.sub(r"[^0-9A-Za-z_-]+", "-", name).strip("-").lower()
    return value[:48] or "image"


def iter_sources() -> Iterable[Path]:
    for path in sorted(ROOT.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in IMAGE_EXTENSIONS:
            continue
        rel = path.relative_to(ROOT)
        if any(part in EXCLUDED_PARTS for part in rel.parts):
            continue
        if rel.parts[:2] in {("assets", "optimized"), ("assets", "ogp")} :
            continue
        yield path


def file_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def cleanup_misplaced_generated_assets() -> tuple[int, int]:
    """Remove duplicate optimized folders accidentally placed at repository root.

    A folder is removed only when its 16-character hash name matches the normal
    optimized-asset layout and every contained WebP is byte-identical to the
    corresponding file under assets/optimized/. This keeps the cleanup safe and
    prevents generated derivatives from being treated as new source images.
    """

    removed_files = 0
    removed_directories = 0

    for directory in sorted(ROOT.iterdir()):
        if not directory.is_dir() or not MISPLACED_ASSET_DIR_PATTERN.fullmatch(directory.name):
            continue

        files = sorted(path for path in directory.rglob("*") if path.is_file())
        if not files or any(path.suffix.lower() != ".webp" for path in files):
            continue

        duplicate = True
        for path in files:
            counterpart = OUTPUT_DIR / directory.name / path.relative_to(directory)
            if not counterpart.is_file() or file_digest(path) != file_digest(counterpart):
                duplicate = False
                break

        if not duplicate:
            continue

        removed_files += len(files)
        shutil.rmtree(directory)
        removed_directories += 1

    return removed_files, removed_directories


def source_quality(path: Path, has_alpha: bool) -> int:
    suffix = path.suffix.lower()
    if suffix == ".png" or has_alpha:
        return PNG_QUALITY
    if suffix == ".webp":
        return WEBP_QUALITY
    return JPEG_QUALITY


def target_widths(width: int) -> list[int]:
    if width <= 0:
        return []
    widths = [value for value in TARGET_WIDTHS if value < width]
    # Keep the native size for smaller source files. For very large originals,
    # 1440px balances clarity with fast delivery for the site's 1120px content area.
    if width <= TARGET_WIDTHS[-1]:
        widths.append(width)
    elif not widths or widths[-1] != TARGET_WIDTHS[-1]:
        widths.append(TARGET_WIDTHS[-1])
    return sorted(set(widths))


def has_alpha_channel(image: Image.Image) -> bool:
    return image.mode in {"RGBA", "LA"} or (image.mode == "P" and "transparency" in image.info)


def prepare_image(image: Image.Image, alpha: bool) -> Image.Image:
    image = ImageOps.exif_transpose(image)
    if alpha:
        return image.convert("RGBA")
    return image.convert("RGB")


def render_variant(
    image: Image.Image,
    width: int,
    output: Path,
    quality: int,
    alpha: bool,
) -> tuple[int, int, int]:
    height = max(1, round(image.height * width / image.width))
    resized = image if width == image.width else image.resize((width, height), Image.Resampling.LANCZOS)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".tmp")
    save_args = {
        "format": "WEBP",
        "quality": quality,
        "method": 0,
        "optimize": False,
    }
    if alpha:
        save_args.update({"alpha_quality": 100, "exact": True})
    resized.save(temporary, **save_args)
    temporary.replace(output)
    return width, height, output.stat().st_size


def read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}


def comparable_manifest(value: dict) -> dict:
    copy = dict(value)
    copy.pop("generatedAt", None)
    return copy


def main() -> int:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    misplaced_files_removed, misplaced_directories_removed = cleanup_misplaced_generated_assets()

    sources: list[SourceInfo] = []
    for path in iter_sources():
        sources.append(SourceInfo(path, relative_posix(path), file_digest(path), path.stat().st_size))

    grouped: dict[str, list[SourceInfo]] = {}
    for source in sources:
        grouped.setdefault(source.digest, []).append(source)

    previous = read_json(MANIFEST_PATH)
    previous_report = read_json(REPORT_PATH)
    previous_assets = previous.get("assets", {}) if previous.get("settingsVersion") == SETTINGS_VERSION else {}

    assets: dict[str, dict] = {}
    images: dict[str, dict] = {}
    referenced_outputs: set[Path] = set()
    generated_now = 0
    reused_now = 0
    skipped: list[dict[str, str]] = []
    skipped_unique_images = 0
    failed: list[dict[str, str]] = []
    total_generated_bytes = 0
    estimated_delivery_bytes_unique = 0
    removed_orphans = 0

    for digest, group in sorted(grouped.items(), key=lambda item: item[0]):
        representative = sorted(group, key=lambda item: item.relative)[0]
        asset_key = digest[:16]
        previous_asset = previous_assets.get(asset_key, {})
        stem = safe_stem(representative.path.stem)
        variants: list[dict] = []
        skipped_widths: list[int] = []
        previous_skipped = set(previous_asset.get("skippedWidths", []))

        try:
            with Image.open(representative.path) as opened:
                if getattr(opened, "is_animated", False):
                    raise ValueError("animated image is not supported")
                alpha = has_alpha_channel(opened)
                image = prepare_image(opened, alpha)
                source_width, source_height = image.size
                quality = source_quality(representative.path, alpha)

                for width in target_widths(source_width):
                    height = max(1, round(source_height * width / source_width))
                    filename = f"{asset_key}/{stem}-w{width}.webp"
                    output = OUTPUT_DIR / filename
                    web_path = relative_posix(output)

                    if width in previous_skipped or (representative.path.suffix.lower() == ".webp" and width >= source_width):
                        skipped_widths.append(width)
                        output.unlink(missing_ok=True)
                        continue

                    reusable = False
                    for item in previous_asset.get("variants", []):
                        if item.get("width") == width and item.get("src") == web_path and output.exists():
                            reusable = True
                            break

                    if reusable:
                        size = output.stat().st_size
                    else:
                        _, height, size = render_variant(image, width, output, quality, alpha)

                    # A native-size WebP can occasionally exceed an already optimized
                    # source. Smaller responsive variants remain useful, but remember the
                    # skipped native width so unchanged runs do not encode it again.
                    if width >= source_width and size >= representative.size * MIN_SAVING_RATIO:
                        output.unlink(missing_ok=True)
                        skipped_widths.append(width)
                        continue

                    if reusable:
                        reused_now += 1
                    else:
                        generated_now += 1
                    referenced_outputs.add(output)
                    variants.append({
                        "src": web_path,
                        "width": width,
                        "height": height,
                        "bytes": size,
                    })

                if not variants:
                    skipped_unique_images += 1
                    reason = "元画像がすでに十分軽量なため、WebP派生画像の生成は不要です。"
                    for source in group:
                        skipped.append({"path": source.relative, "reason": reason})
                    continue

                variants.sort(key=lambda item: item["width"])
                largest = variants[-1]
                delivery_target = min(source_width, 1200)
                delivery = next((item for item in variants if item["width"] >= delivery_target), largest)
                estimated_delivery_bytes_unique += delivery["bytes"]
                total_generated_bytes += sum(item["bytes"] for item in variants)

                asset = {
                    "hash": digest,
                    "width": source_width,
                    "height": source_height,
                    "format": representative.path.suffix.lower().lstrip("."),
                    "alpha": alpha,
                    "quality": quality,
                    "variants": variants,
                    "skippedWidths": sorted(set(skipped_widths)),
                    "default": largest["src"],
                }
                assets[asset_key] = asset

                for source in group:
                    images[source.relative] = {
                        "asset": asset_key,
                        "originalBytes": source.size,
                        "width": source_width,
                        "height": source_height,
                        "variants": variants,
                        "default": largest["src"],
                    }
        except Exception as exc:  # continue so one corrupt file does not block all images
            for source in group:
                failed.append({"path": source.relative, "error": str(exc)})

    # Remove orphaned generated files and empty directories.
    for path in sorted(OUTPUT_DIR.rglob("*"), reverse=True):
        if path.is_file() and path not in referenced_outputs:
            path.unlink()
            removed_orphans += 1
        elif path.is_dir():
            try:
                path.rmdir()
            except OSError:
                pass

    generated_at = utc_now()
    original_bytes = sum(source.size for source in sources)
    # Estimate delivery per file while allowing duplicate originals to share the same
    # generated asset. This represents an upper-bound first-view transfer estimate.
    estimated_delivery_bytes = 0
    for source in sources:
        entry = images.get(source.relative)
        if not entry:
            estimated_delivery_bytes += source.size
            continue
        variants = entry["variants"]
        target = min(entry["width"], 1200)
        chosen = next((item for item in variants if item["width"] >= target), variants[-1])
        estimated_delivery_bytes += chosen["bytes"]

    saved_bytes = max(0, original_bytes - estimated_delivery_bytes)
    saving_percent = round(saved_bytes / original_bytes * 100, 1) if original_bytes else 0.0

    manifest = {
        "version": 1,
        "settingsVersion": SETTINGS_VERSION,
        "generatedAt": generated_at,
        "baseDirectory": "assets/optimized",
        "images": dict(sorted(images.items())),
        "assets": dict(sorted(assets.items())),
    }
    report = {
        "version": 1,
        "settingsVersion": SETTINGS_VERSION,
        "generatedAt": generated_at,
        "sourceFiles": len(sources),
        "uniqueImages": len(grouped),
        "optimizedImages": len(images),
        "uniqueOptimizedAssets": len(assets),
        "derivatives": sum(len(asset["variants"]) for asset in assets.values()),
        "generatedNow": generated_now,
        "reusedNow": reused_now,
        "skippedImages": len(skipped),
        "skippedUniqueImages": skipped_unique_images,
        "skipped": skipped,
        "failedImages": len(failed),
        "failures": failed,
        "originalBytes": original_bytes,
        "estimatedDeliveryBytes": estimated_delivery_bytes,
        "estimatedSavedBytes": saved_bytes,
        "estimatedSavingPercent": saving_percent,
        "generatedStorageBytes": total_generated_bytes,
        "removedOrphans": removed_orphans,
        "misplacedGeneratedFilesRemoved": misplaced_files_removed,
        "misplacedGeneratedDirectoriesRemoved": misplaced_directories_removed,
        "notes": [
            "元画像は削除せず、表示時に画面幅へ合うWebPを選択します。",
            "同一内容の画像はハッシュでまとめ、WebPの重複生成を防ぎます。",
            "推定削減率は各画像を最大1200px相当で配信した場合の概算です。",
            "元画像より軽くならないWebPは失敗ではなく最適化不要として記録します。",
        ],
    }

    report_schema_current = all(
        key in previous_report
        for key in (
            "skippedImages",
            "skippedUniqueImages",
            "misplacedGeneratedFilesRemoved",
            "misplacedGeneratedDirectoriesRemoved",
        )
    )
    unchanged = (
        comparable_manifest(previous) == comparable_manifest(manifest)
        and generated_now == 0
        and removed_orphans == 0
        and misplaced_files_removed == 0
        and misplaced_directories_removed == 0
        and bool(previous_report)
        and report_schema_current
    )
    if unchanged:
        print("ℹ️ 画像内容に変更はありません。既存の最適化データを維持します。")
    else:
        MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(
        "✅ 画像最適化完了: "
        f"{len(sources)}ファイル / {len(grouped)}種類 / "
        f"WebP {report['derivatives']}件 / 推定 {saving_percent}%削減"
    )
    print(
        f"   今回生成: {generated_now}件 / 再利用: {reused_now}件 / "
        f"最適化不要: {len(skipped)}件 / 失敗: {len(failed)}件"
    )
    if misplaced_files_removed:
        print(
            "   🧹 誤配置されたWebP複製を整理: "
            f"{misplaced_files_removed}ファイル / {misplaced_directories_removed}フォルダ"
        )
    if skipped:
        for item in skipped:
            print(f"   ℹ {item['path']}: 最適化不要")
    if failed:
        for item in failed:
            print(f"   ⚠ {item['path']}: {item['error']}")
    return 0 if not failed else 2


if __name__ == "__main__":
    sys.exit(main())
