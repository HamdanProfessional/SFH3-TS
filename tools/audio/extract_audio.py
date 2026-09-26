from __future__ import annotations

import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT.parent / "sfh3_decompiled" / "sounds"
DEST = ROOT / "public" / "assets" / "sounds"
MANIFEST = ROOT / "src" / "audio" / "manifest.ts"

SPECIAL = {
    "2948_1-189": "LOGO_NotDoppler",
    "2954_2-207": "LOGO_Armor",
}

NAME_RE = re.compile(r"^(\d+)_(.+)$")

SONG_LIST = ["M_Rush", "M_Rocket", "M_Rage", "M_Action", "M_Epic", "M_Speed"]
SONG_NAMES = [
    "Rush",
    "Rocket Race",
    "Relentless Rage",
    "CTP v1",
    "CTP v2",
    "CTP v3",
]


def key_for(stem: str) -> str:
    if stem in SPECIAL:
        return SPECIAL[stem]
    m = NAME_RE.match(stem)
    if not m:
        raise SystemExit(f"unrecognised sound filename: {stem!r}")
    return m.group(2)


def main() -> None:
    if not SRC.is_dir():
        raise SystemExit(f"source sounds dir not found: {SRC}")

    DEST.mkdir(parents=True, exist_ok=True)

    sfx: dict[str, str] = {}
    music: dict[str, str] = {}
    copied = 0
    for path in sorted(SRC.glob("*.mp3")):
        key = key_for(path.stem)
        shutil.copyfile(path, DEST / path.name)
        copied += 1
        (music if key.startswith("M_") else sfx)[key] = path.name

    lines: list[str] = []
    lines.append("export const SFX: Record<string, string> = {")
    for key in sorted(sfx):
        lines.append(f'  {key}: "{sfx[key]}",')
    lines.append("};")
    lines.append("")
    lines.append("export const MUSIC: Record<string, string> = {")
    for key in sorted(music):
        lines.append(f'  {key}: "{music[key]}",')
    lines.append("};")
    lines.append("")
    lines.append("export const SONG_LIST = [")
    lines.append("  " + ", ".join(f'"{k}"' for k in SONG_LIST) + ",")
    lines.append("];")
    lines.append("")
    lines.append("export const SONG_NAMES = [")
    lines.append("  " + ", ".join(f'"{n}"' for n in SONG_NAMES) + ",")
    lines.append("];")
    lines.append("")
    MANIFEST.write_text("\n".join(lines), encoding="utf-8")

    print(f"copied {copied} clips -> {DEST.relative_to(ROOT)}")
    print(f"wrote {len(sfx)} SFX + {len(music)} music -> {MANIFEST.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
