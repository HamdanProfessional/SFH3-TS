#!/usr/bin/env python3
"""Subset the Chinese fonts to the characters actually used in the Chinese translations; output goes to public/fonts/zh/.

Usage: python tools/i18n/subset_fonts.py <ZCOOLQingKeHuangYou-Regular.ttf> <NotoSansSC-VF.ttf>
Font sources (both SIL OFL 1.1):
- ZCOOL QingKe HuangYou: https://github.com/google/fonts/tree/main/ofl/zcoolqingkehuangyou
- Noto Sans SC variable font: https://github.com/google/fonts/tree/main/ofl/notosanssc
Re-run after changing src/i18n/zh.json; otherwise new characters fall back to a system font.
"""
import argparse
import json
import re
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parents[2]
CATALOG = ROOT / "src/i18n/zh.json"
DEST = ROOT / "public/fonts/zh"
# Only CJK characters and Chinese punctuation; ASCII is still shown by the original font
RANGES = [(0x2010, 0x2027), (0x2030, 0x203A), (0x3000, 0x3011), (0xFF01, 0xFF5E)]
CJK = re.compile(r"[⺀-鿿豈-﫿＀-￯　-〿‐-›]")


def catalog_text():
    data = json.loads(CATALOG.read_text(encoding="utf-8"))
    values = [v for v in data.values() if isinstance(v, str)]
    extra = ROOT / "tools/i18n/extra_chars.txt"  # optional: extra characters to always include
    if extra.exists():
        values.append(extra.read_text(encoding="utf-8"))
    chars = {c for v in values for c in v if CJK.match(c)}
    chars |= {chr(code) for start, end in RANGES for code in range(start, end + 1)}
    return "".join(sorted(chars))


def rename(font, family, style):
    """The subset is a modified version, so under OFL it uses a neutral family name; copyright and license records are kept."""
    table = font["name"]
    postscript = family.replace(" ", "") + "-" + style
    table.names = [r for r in table.names if r.nameID not in (1, 2, 3, 4, 6, 16, 17, 18, 19, 21, 22)]
    for name_id, value in ((1, family), (2, "Regular"), (3, f"{postscript}:subset"),
                           (4, f"{family} {style}"), (6, postscript)):
        table.setName(value, name_id, 3, 1, 0x409)


def write_subset(font, text, output, family, style):
    options = subset.Options()
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    options.notdef_outline = True
    options.hinting = False
    options.flavor = "woff2"
    subsetter = subset.Subsetter(options)
    subsetter.populate(text=text)
    subsetter.subset(font)
    rename(font, family, style)
    font.flavor = "woff2"
    font.save(output)
    return output.stat().st_size


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("title", type=Path)
    parser.add_argument("noto", type=Path)
    args = parser.parse_args()
    text = catalog_text()
    DEST.mkdir(parents=True, exist_ok=True)
    sizes = {"characters": len(text)}
    sizes["zh-title.woff2"] = write_subset(TTFont(args.title), text, DEST / "zh-title.woff2", "SFH3 ZH Title", "Regular")
    for weight, name, style in ((400, "zh-sans.woff2", "Regular"), (700, "zh-sans-bold.woff2", "Bold")):
        # Pin the weight of the variable font first
        static = instancer.instantiateVariableFont(TTFont(args.noto), {"wght": weight}, updateFontNames=True)
        sizes[name] = write_subset(static, text, DEST / name, "SFH3 ZH Sans", style)
    print(json.dumps(sizes))


if __name__ == "__main__":
    main()
