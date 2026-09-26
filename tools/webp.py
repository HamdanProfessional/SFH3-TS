#!/usr/bin/env python3
import os
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent / "public"
DIRS = ["assets", "ui"]
LOSSY = {"bg"}


def convert(png: Path) -> tuple[int, int]:
    out = png.with_suffix(".webp")
    im = Image.open(png)
    im.load()
    rgba = im.convert("RGBA")
    lossy = png.relative_to(ROOT).parts[1] in LOSSY if len(png.relative_to(ROOT).parts) > 2 else False
    if lossy:
        opaque = rgba.getextrema()[3][0] == 255
        (rgba.convert("RGB") if opaque else rgba).save(out, "WEBP", quality=90, method=6)
    else:
        rgba.save(out, "WEBP", lossless=True, quality=100, method=5, exact=True)
    return png.stat().st_size, out.stat().st_size


def main() -> int:
    force = "--force" in sys.argv
    todo = []
    for d in DIRS:
        for png in sorted((ROOT / d).rglob("*.png")):
            out = png.with_suffix(".webp")
            if force or not out.exists() or out.stat().st_mtime < png.stat().st_mtime:
                todo.append(png)
    print(f"{len(todo)} to convert")
    a = b = 0
    with ProcessPoolExecutor() as pool:
        for i, (p, w) in enumerate(pool.map(convert, todo, chunksize=8)):
            a += p
            b += w
            if (i + 1) % 250 == 0:
                print(f"  {i + 1}/{len(todo)}")
    if todo:
        print(f"png {a / 1e6:.1f} MB -> webp {b / 1e6:.1f} MB ({100 - 100 * b / a:.0f}% smaller)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
