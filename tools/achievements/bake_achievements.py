#!/usr/bin/env python3
from __future__ import annotations

import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import svgraster as R
import swfio as S
import swftext as T
import uibake as U

REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT_IMG = os.path.join(REPO, "public", "ui", "achievements")
OUT_JSON = os.path.join(REPO, "src", "assets", "achievementUi.json")
SUPERSAMPLE = 2

TOAST = 3906
MEDALS = 2849
ACH_ORDER = [
    "campaign", "challenges", "levelmax", "hard", "insane", "upgrade",
    "buy", "sell", "enemies", "eng", "mer", "gun", "sni", "jug", "eli",
    "med", "nin", "classes", "secret1", "secret2", "secret3",
]
HIDE_CIDS = [MEDALS, 3903, 3904, 3905]
HIDE_CIDS.append(45)
TEXT_CIDS = [3903, 3904, 3905]

SIZE_RE = re.compile(r'<svg[^>]*?height="([\d.]+)px"[^>]*?width="([\d.]+)px"')
Y_RE = re.compile(
    r'<use[^>]*ffdec:characterId="3900"[^>]*matrix\(1\.0, 0\.0, 0\.0, 1\.0, '
    r'([-\d.]+), (-?[\d.]+)\)')


def sprite_dir(cid):
    for d in glob.glob(os.path.join(S.SPRITES, f"DefineSprite_{cid}*")):
        base = os.path.basename(d)
        if base == f"DefineSprite_{cid}" or base.startswith(f"DefineSprite_{cid}_") \
                or base.startswith(f"DefineSprite_{cid}."):
            return d
    raise FileNotFoundError(f"no sprite dir for {cid}")


def render(pg, cid, frame, rel, hide_cids=()):
    path = os.path.join(sprite_dir(cid), f"{frame}.svg")
    if not os.path.isfile(path):
        return None
    svg = U.fix_glyph_text(open(path, encoding="utf-8").read())
    if not R.ROOT_G.search(svg):
        return None
    tx, ty = R.stage_origin(svg)
    m = SIZE_RE.search(svg)
    w, h = float(m.group(2)), float(m.group(1))
    out = os.path.join(OUT_IMG, rel)
    R.render(pg, svg, out, rect=(0, 0, w, h),
             hide_cids=[str(c) for c in hide_cids])
    return {"file": rel.replace("\\", "/"),
            "w": round(w * 2, 2), "h": round(h * 2, 2),
            "ox": round(tx * 2, 2), "oy": round(ty * 2, 2)}


def toast_y_table():
    out = []
    for f in range(1, 112):
        svg = open(os.path.join(sprite_dir(TOAST), f"{f}.svg"), encoding="utf-8").read()
        m = Y_RE.search(svg)
        if not m:
            raise SystemExit(f"toast frame {f}: no panel placement")
        out.append(round(float(m.group(2)), 3))
    return out


def placed_uses(cid, frame):
    import xml.etree.ElementTree as ET
    SVG_NS = "{http://www.w3.org/2000/svg}"
    FF_NS = "{https://www.free-decompiler.com/flash}"
    root = ET.parse(os.path.join(sprite_dir(cid), f"{frame}.svg")).getroot()
    roots = [c for c in root if c.tag == SVG_NS + "g"
             and "0.5" in (c.get("transform") or "")]
    out = {}
    for u in roots[0].iter(SVG_NS + "use"):
        nm = u.get("id")
        if nm and nm not in out:
            out[nm] = [float(x) for x in re.findall(r"[-0-9.eE]+", u.get("transform") or "")]
    return out


def text_record(edits, cid):
    rec = edits.get(cid)
    if not rec:
        return None
    spec = dict(rec)
    spec.pop("text", None)
    return spec


def main():
    os.makedirs(OUT_IMG, exist_ok=True)
    edits = T.parse()
    manifest = {"scale": SUPERSAMPLE, "toast": {}, "medals": {}, "place": {},
                "y": toast_y_table(), "text": {}}

    place = placed_uses(TOAST, 1)
    manifest["place"]["icon"] = [round(place["icon"][4], 2), round(place["icon"][5], 2)]
    for nm, key in (("txt_name", "name"), ("txt_desc", "desc"), ("txt_unlock", "unlock")):
        m = place[nm]
        manifest["place"][key] = [round(m[4], 2), round(m[5], 2)]
    for cid in TEXT_CIDS:
        rec = text_record(edits, cid)
        if rec:
            manifest["text"][str(cid)] = rec

    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        b, pg = R.open_page(pw, supersample=SUPERSAMPLE)
        manifest["toast"] = render(pg, TOAST, 1, "toast.png", hide_cids=HIDE_CIDS)
        labels = {}
        import swflabels as L
        for f, name in L.parse(L.SWF, MEDALS):
            labels.setdefault(name, f)
        for ach in ACH_ORDER:
            f = labels[ach]
            rec = render(pg, MEDALS, f, f"medal_{ach}.png")
            if rec:
                manifest["medals"][ach] = rec
            else:
                raise SystemExit(f"medal frame missing for {ach}")
        b.close()

    with open(OUT_JSON, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=1)
    print(f"wrote {OUT_JSON}: toast + {len(manifest['medals'])} medals, "
          f"{len(manifest['y'])} timeline frames")
    print("images in", OUT_IMG)


if __name__ == "__main__":
    main()
