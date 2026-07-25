#!/usr/bin/env python3
"""Convert HEIC/HEIF images to browser-friendly JPEG.

Uses pillow-heif when available. GitHub-hosted runners also include ffmpeg, which
is used as the dependency-free fallback. heif-convert is supported as a final
fallback for custom runners.
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
from pathlib import Path


def convert_with_pillow(source: Path, target: Path, quality: int) -> bool:
    try:
        from PIL import Image, ImageOps
        from pillow_heif import register_heif_opener
    except ImportError:
        return False

    register_heif_opener()
    with Image.open(source) as image:
        image = ImageOps.exif_transpose(image)
        if image.mode not in {"RGB", "L"}:
            background = Image.new("RGB", image.size, "white")
            if "A" in image.getbands():
                background.paste(image, mask=image.getchannel("A"))
            else:
                background.paste(image.convert("RGB"))
            image = background
        elif image.mode != "RGB":
            image = image.convert("RGB")
        image.save(
            target,
            format="JPEG",
            quality=max(70, min(quality, 98)),
            optimize=True,
            progressive=True,
        )
    return True


def run_checked(command: list[str]) -> None:
    subprocess.run(command, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    parser.add_argument("output")
    parser.add_argument("--quality", type=int, default=92)
    args = parser.parse_args()

    source = Path(args.input)
    target = Path(args.output)
    target.parent.mkdir(parents=True, exist_ok=True)

    if convert_with_pillow(source, target, args.quality):
        return 0

    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        run_checked([
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
        return 0

    heif_convert = shutil.which("heif-convert")
    if heif_convert:
        run_checked([heif_convert, "-q", str(max(70, min(args.quality, 98))), str(source), str(target)])
        return 0

    raise RuntimeError(
        "HEIC変換ツールがありません。pillow-heif、ffmpeg、heif-convertのいずれかを利用可能にしてください。"
    )


if __name__ == "__main__":
    raise SystemExit(main())
