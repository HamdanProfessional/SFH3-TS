#!/usr/bin/env python3
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import swfio as S
import svgraster as R
import swftext as T
from uibake import fix_glyph_text

REPO = os.path.normpath(os.path.join(HERE, "..", ".."))
OUT_IMG = os.path.join(REPO, "public", "ui")
OUT_JSON = os.path.join(REPO, "src", "assets", "loaderUi.json")

LOADER_CID = 44
SCALE = 2

RUNTIME = ["#txt_loading", "#txt_size", "#txt_version",
           "#txt_play", "#txt_play2", "#bar1"]
SPONSOR = ["#logo1", "#logo2"]

FAMILIES = ["QTypeSquare-BlackMajuscles", "QTypeSquare-ExtraLight",
            "QTypeSquare-Book", "QTypeSquare-Bold", "QTypeSquare-Light",
            "QTypeSquare-Medium", "Xoireqe"]


def font_family(name):
    for f in FAMILIES:
        if name and name.startswith(f):
            return f
    return name or "Verdana"


def ink_runs(hits, gap):
    runs = []
    start = None
    for i, n in enumerate(hits):
        if n and start is None:
            start = i
        elif not n and start is not None:
            runs.append([start, i - 1])
            start = None
    if start is not None:
        runs.append([start, len(hits) - 1])
    out = []
    for r in runs:
        if out and r[0] - out[-1][1] < gap:
            out[-1][1] = r[1]
        else:
            out.append(r)
    return out


def split_plate(im):
    px = im.load()
    w, h = im.size

    def lit(x, y):
        p = px[x, y]
        return p[0] + p[1] + p[2] > 24

    bands = ink_runs([any(lit(x, y) for x in range(w)) for y in range(h)], 8)
    if len(bands) != 2:
        raise SystemExit(f"expected 2 ink bands on the plate, found {bands}")
    top, bottom = bands
    cols = ink_runs(
        [any(lit(x, y) for y in range(bottom[0], bottom[1] + 1))
         for x in range(w)], 48)
    if len(cols) != 2:
        raise SystemExit(f"expected 2 groups in the credit strip, found {cols}")
    logo = ink_runs([any(lit(x, y) for y in range(top[0], top[1] + 1))
                     for x in range(w)], w)
    return {
        "logo": (logo[0][0], top[0], logo[0][1], top[1]),
        "sky9": (cols[0][0], bottom[0], cols[0][1], bottom[1]),
        "copy": (cols[1][0], bottom[0], cols[1][1], bottom[1]),
    }


def placement(svg, el_id):
    m = re.search(r'<use\b[^>]*\bid="%s"[^>]*transform="matrix\('
                  r'([^)]*)\)"' % re.escape(el_id), svg)
    if not m:
        return None
    nums = [float(v) for v in m.group(1).split(",")]
    return nums[4], nums[5]


def main():
    from PIL import Image
    from playwright.sync_api import sync_playwright

    os.makedirs(OUT_IMG, exist_ok=True)
    svg = fix_glyph_text(
        open(S.frame_svgs(LOADER_CID)[0], encoding="utf-8").read())
    tx, ty = R.stage_origin(svg)
    man = {"design": [800, 600], "scale": SCALE}

    with sync_playwright() as pw:
        b, pg = R.open_page(pw, supersample=SCALE)

        plate = os.path.join(OUT_IMG, "_loader_plate.png")
        R.render(pg, svg, plate, hide=RUNTIME + SPONSOR)
        im = Image.open(plate).convert("RGBA")
        man["parts"] = {}
        for name, (x0, y0, x1, y1) in split_plate(im).items():
            rel = f"loader_{name}.png"
            im.crop((x0, y0, x1 + 1, y1 + 1)).save(os.path.join(OUT_IMG, rel))
            man["parts"][name] = {
                "file": rel,
                "x": x0 / SCALE, "y": y0 / SCALE,
                "w": (x1 + 1 - x0) / SCALE, "h": (y1 + 1 - y0) / SCALE,
            }
        im.close()
        os.remove(plate)

        tmp = os.path.join(OUT_IMG, "_loader_tmp.png")
        R.render(pg, svg, tmp,
                 hide=["#host > svg > g > use:not(#bar1)", "#txt_play",
                       "#txt_play2"])
        im = Image.open(tmp)
        box = im.getchannel("A").getbbox()
        if box is None:
            raise SystemExit("bar2 rendered blank — check the hide selector")
        minx, miny, maxx, maxy = box
        im.crop(box).save(os.path.join(OUT_IMG, "loader_bar.png"))
        im.close()
        os.remove(tmp)
        man["bar"] = {
            "file": "loader_bar.png",
            "x": minx / SCALE, "y": miny / SCALE,
            "w": (maxx - minx) / SCALE, "h": (maxy - miny) / SCALE,
        }
        b.close()

    for name in ("bar1", "txt_loading", "txt_size", "txt_version", "txt_play"):
        p = placement(svg, name)
        if p:
            man.setdefault("children", {})[name] = {"x": p[0], "y": p[1]}

    parsed = T.parse()
    cids = {}
    for m in re.finditer(r'<use\b[^>]*\bid="(txt_\w+)"[^>]*>', svg):
        tag = m.group(0)
        c = re.search(r'characterId="(\d+)"', tag)
        if c:
            cids[m.group(1)] = int(c.group(1))
    man["fields"] = cids
    text = {}
    for cid in sorted(set(cids.values())):
        r = parsed.get(cid)
        if not r:
            continue
        text[str(cid)] = {
            "cid": cid,
            "x": r.get("x", 0.0), "y": r.get("y", 0.0),
            "w": r.get("w", 0.0), "h": r.get("h", 0.0),
            "size": r.get("size"),
            "font": font_family(r.get("font")),
            "color": r.get("color"),
            "alpha": r.get("alpha"),
            "align": r.get("align", "left"),
            "leading": r.get("leading", 0.0),
        }
    man["text"] = text

    with open(OUT_JSON, "w", encoding="utf-8") as fh:
        json.dump(man, fh, indent=1, sort_keys=True)
    print("wrote", OUT_JSON)
    print(json.dumps({k: v for k, v in man.items() if k != "text"}, indent=1))


if __name__ == "__main__":
    main()
