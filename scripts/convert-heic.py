#!/usr/bin/env python3
"""Convert HEIC/HEIF images to browser-friendly JPEG.

The primary decoder is pillow-heif because the ffmpeg build bundled with a
GitHub-hosted runner is not guaranteed to include a HEIC/HEIF decoder. External
converters are retained as fallbacks for custom runners.
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
from pathlib import Path


def prepare_rgb(image):
    from PIL import Image, ImageOps

    image = ImageOps.exif_transpose(image)
    if image.mode == "RGB":
        return image
    if image.mode == "L":
        return image.convert("RGB")

    background = Image.new("RGB", image.size, "white")
    if "A" in image.getbands():
        background.paste(image, mask=image.getchannel("A"))
    else:
        background.paste(image.convert("RGB"))
    return background


def convert_with_pillow(source: Path, target: Path, quality: int) -> tuple[bool, str]:
    try:
        from PIL import Image
        from pillow_heif import register_heif_opener
    except ImportError as error:
        return False, f"pillow-heifを読み込めません: {error}"

    try:
        register_heif_opener()
        with Image.open(source) as opened:
            # Force decoding while the source file is still open.
            opened.load()
            image = prepare_rgb(opened)
            image.save(
                target,
                format="JPEG",
                quality=max(70, min(quality, 98)),
                optimize=True,
                progressive=True,
            )
        if not target.is_file() or target.stat().st_size < 32:
            raise RuntimeError("出力されたJPEGが空、または小さすぎます")
        return True, ""
    except Exception as error:  # Continue to external fallbacks.
        return False, f"pillow-heif: {type(error).__name__}: {error}"


def run_checked(command: list[str]) -> tuple[bool, str]:
    try:
        completed = subprocess.run(
            command,
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        return True, (completed.stderr or completed.stdout or "").strip()
    except subprocess.CalledProcessError as error:
        detail = (error.stderr or error.stdout or str(error)).strip()
        return False, detail
    except OSError as error:
        return False, str(error)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    parser.add_argument("output")
    parser.add_argument("--quality", type=int, default=92)
    args = parser.parse_args()

    source = Path(args.input)
    target = Path(args.output)
    target.parent.mkdir(parents=True, exist_ok=True)

    if not source.is_file() or source.stat().st_size < 32:
        raise RuntimeError(f"入力画像が存在しないか、小さすぎます: {source}")

    errors: list[str] = []

    converted, detail = convert_with_pillow(source, target, args.quality)
    if converted:
        return 0
    errors.append(detail)

    # heif-convert is purpose-built for HEIF and is preferred over a generic
    # ffmpeg binary when both are present.
    heif_convert = shutil.which("heif-convert")
    if heif_convert:
        converted, detail = run_checked([
            heif_convert,
            "-q",
            str(max(70, min(args.quality, 98))),
            str(source),
            str(target),
        ])
        if converted and target.is_file() and target.stat().st_size >= 32:
            return 0
        errors.append(f"heif-convert: {detail or '変換に失敗しました'}")

    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        converted, detail = run_checked([
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(source),
            "-frames:v",
            "1",
            "-q:v",
            "2",
            str(target),
        ])
        if converted and target.is_file() and target.stat().st_size >= 32:
            return 0
        errors.append(f"ffmpeg: {detail or '変換に失敗しました'}")

    raise RuntimeError(
        "HEIC/HEIF画像をJPEGへ変換できませんでした。"
        " GitHub Actionsではpillow-heifをインストールしてください。\n- "
        + "\n- ".join(error for error in errors if error)
    )


if __name__ == "__main__":
    raise SystemExit(main())
