#!/usr/bin/env python3
from __future__ import annotations

import glob
import json
import os
import re
import shutil
import sys
import tempfile
import xml.etree.ElementTree as ET


sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import gunlayer
import svgraster as R
import swfio as S
import swflabels as L

REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT_PNG = os.path.join(REPO, "public", "assets", "menu-parts")
OUT_JSON = os.path.join(REPO, "src", "assets", "menuRig.json")

SUPERSAMPLE = 2

UNIT_CID = 2090
SHADOW_CID = 2089
HEAD_CID = 1923
GUN_CID = 844
STOW_CID = 1362
GUN_FRAMES = 299

BASE_FRAMES = (1, 11, 21, 31, 41, 51, 61, 71, 81, 91, 101, 111, 121, 131, 141, 151,
               161, 171, 181, 191, 201, 211, 221, 231, 241, 251)
COSTUME_FRAMES = sorted({b + c - 1 for b in BASE_FRAMES for c in range(1, 7)})

LIMB = {
    "body": 1545, "waist": 1714, "arm": 357, "forearm": 479, "hand": 588,
    "leg": 1361, "shin": 1080, "foot": 1189,
}
PART_NAMES = {
    "backShin", "backLeg", "backFoot", "backArm", "backForearm", "body", "waist",
    "backHand", "head", "frontShin", "frontLeg", "frontFoot", "gun", "gun2",
    "frontArm", "frontForearm", "frontHand", "shadow",
}
NUM = r"[-0-9.eE]+"
MAT = re.compile(r"matrix\(([^)]*)\)")
XLINK = "{http://www.w3.org/1999/xlink}href"


def sprite_dir(cid: int) -> str:
    hits = glob.glob(os.path.join(S.SPRITES, f"DefineSprite_{cid}*"))
    if not hits:
        raise FileNotFoundError(f"sprite {cid}")
    return hits[0]


def frame_count(cid: int) -> int:
    return len(glob.glob(os.path.join(sprite_dir(cid), "*.svg")))


def matrix_of(tag: str | None):
    m = MAT.search(tag or "")
    if not m:
        return [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]
    return [float(x) for x in re.findall(NUM, m.group(1))]


def cid_of(el) -> int | None:
    for k, v in el.attrib.items():
        if k.lower().endswith("characterid"):
            return int(v)
    return None


def round_m(m):
    return [round(x, 4) for x in m]


def art_bbox(png: str, rec: dict):
    try:
        from PIL import Image
    except ImportError:
        return None
    with Image.open(png) as im:
        bb = im.convert("RGBA").getbbox()
        if not bb:
            return None
        px_w = im.size[0]
    k = rec["w"] / px_w if px_w else 1
    return [round(bb[0] * k, 2), round(bb[1] * k, 2),
            round((bb[2] - bb[0]) * k, 2), round((bb[3] - bb[1]) * k, 2)]


def bake(pg, cid: int, frame: int, rel: str, hide_cids=(), svg_text=None,
         trim=False):
    path = os.path.join(sprite_dir(cid), f"{frame}.svg")
    if not os.path.isfile(path):
        return None
    svg = svg_text if svg_text is not None else open(path, encoding="utf-8").read()
    tx, ty = R.stage_origin(svg)
    m = re.search(r'<svg[^>]*?height="([\d.]+)px"[^>]*?width="([\d.]+)px"', svg)
    w, h = float(m.group(2)), float(m.group(1))
    out = os.path.join(OUT_PNG, rel)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    R.render(pg, svg, out, rect=(0, 0, w, h), hide_cids=[str(c) for c in hide_cids])
    rec = {
        "file": rel.replace("\\", "/"),
        "w": round(w * 2, 2), "h": round(h * 2, 2),
        "ox": round(tx * 2, 2), "oy": round(ty * 2, 2),
    }
    if trim:
        bb = art_bbox(out, rec)
        if bb:
            rec["bb"] = bb
    return rec


def parse_timeline():
    d = sprite_dir(UNIT_CID)
    out = []
    for path in sorted(glob.glob(os.path.join(d, "*.svg")),
                       key=lambda p: int(os.path.splitext(os.path.basename(p))[0])):
        root = ET.parse(path).getroot()
        g = next(c for c in root if c.tag.endswith("}g"))
        frame = []
        for el in g:
            if not el.tag.endswith("}use"):
                continue
            name = el.get("id") or ""
            cid = cid_of(el)
            if cid == SHADOW_CID:
                name = "shadow"
            if name not in PART_NAMES:
                continue
            frame.append([name, *round_m(matrix_of(el.get("transform")))])
        out.append(frame)
    return out


def nested_uses(path: str):
    tree = ET.parse(path)
    defs = {el.get("id"): el for el in tree.getroot().iter() if el.get("id")}
    found = {}
    top = next(c for c in tree.getroot() if c.tag.endswith("}g"))
    for el in top.iter():
        if not el.tag.endswith("}use"):
            continue
        name = el.get("id") or ""
        if name not in ("face", "hair", "skin") or name in found:
            continue
        found[name] = {"cid": cid_of(el), "m": round_m(matrix_of(el.get("transform")))}
        if name == "face":
            d = defs.get((el.get(XLINK) or "").lstrip("#"))
            if d is not None:
                for sub in d.iter():
                    if (sub.tag.endswith("}use") and (sub.get("id") or "") == "skin"
                            and "skin" not in found):
                        found["skin"] = {
                            "cid": cid_of(sub),
                            "m": round_m(matrix_of(sub.get("transform"))),
                        }
    return found


def limb_stow(path: str):
    tree = ET.parse(path)
    top = next(c for c in tree.getroot() if c.tag.endswith("}g"))
    for el in top.iter():
        if el.tag.endswith("}use") and (el.get("id") or "") == "gun":
            return {"cid": cid_of(el), "m": round_m(matrix_of(el.get("transform")))}
    return None


def bake_shadow(pg):
    frame = os.path.join(sprite_dir(UNIT_CID), "1.svg")
    svg = open(frame, encoding="utf-8").read()
    tx, ty = R.stage_origin(svg)
    grad = re.search(r"<(linearGradient|radialGradient)[^>]*id=\"gradient0\".*?</\1>", svg, re.S)
    shape = re.search(r'<g id="shape0">(.*?)</g>', svg, re.S)
    path = re.search(r"<path[^>]*/>", shape.group(1), re.S).group(0)
    bbox = pg.evaluate("""(d) => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
      svg.setAttribute('style','position:absolute;left:-9999px');
      const p = document.createElementNS('http://www.w3.org/2000/svg','path');
      p.setAttribute('d', d);
      svg.appendChild(p); document.body.appendChild(svg);
      const b = p.getBBox();
      return [b.x, b.y, b.width, b.height];
    }""", re.search(r'd="([^"]*)"', path).group(1))
    minx, miny, bw, bh = bbox
    print(f"  shadow bbox {bbox}")
    import base64
    body = (f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
            f'width="{bw / 2}" height="{bh / 2}">'
            f'<defs>{grad.group(0)}</defs>'
            f'<g transform="matrix(0.5,0,0,0.5,{-minx * 0.5},{-miny * 0.5})">{path}</g></svg>')
    rel = "shadow.png"
    out = os.path.join(OUT_PNG, rel)
    os.makedirs(OUT_PNG, exist_ok=True)
    pg.set_viewport_size({"width": max(8, round(bw / 2) + 4), "height": max(8, round(bh / 2) + 4)})
    pg.set_content('<body style="margin:0;background:transparent">'
                   f'<img src="data:image/svg+xml;base64,{base64.b64encode(body.encode()).decode()}" '
                   f'width="{bw / 2}" height="{bh / 2}"></body>')
    pg.wait_for_selector("img")
    pg.query_selector("img").screenshot(path=out, omit_background=True)
    pg.set_content(R.PAGE)
    return {"file": rel, "w": round(bw, 2), "h": round(bh, 2),
            "ox": round(-minx, 2), "oy": round(-miny, 2)}


def main():
    os.makedirs(OUT_PNG, exist_ok=True)
    print("parsing menu timeline ...")
    timeline = parse_timeline()
    print(f"  {len(timeline)} frames, first {[p[0] for p in timeline[0]]}")

    heads = {str(f): nested_uses(os.path.join(sprite_dir(HEAD_CID), f"{f}.svg"))
             for f in COSTUME_FRAMES}
    face_syms = sorted({h["face"]["cid"] for h in heads.values() if "face" in h})
    face_skin = [nested_uses(os.path.join(sprite_dir(c), f"{f}.svg")).get("skin")
                 for c in face_syms for f in range(1, frame_count(c) + 1)]
    skin_syms = sorted({h["skin"]["cid"] for h in heads.values() if "skin" in h}
                       | {s["cid"] for s in face_skin if s})
    hair_syms = sorted({h["hair"]["cid"] for h in heads.values() if "hair" in h})
    print(f"  {len(heads)} head frames; face {face_syms} skin {skin_syms} hair {hair_syms}")

    rig = {
        "note": ("Layered menu unit (`UNIT_new_305`, symbol 2090). Placements are "
                 "SWF matrices in clip-local units; a texture is `scale` pixels "
                 "per unit, with its clip origin at (ox, oy) from the top-left. "
                 "Divide the placement by `scale` (or fold `rec.w / width`) when "
                 "drawing a raw texture."),
        "scale": SUPERSAMPLE,
        "timeline": {"frames": timeline},
        "costumeFrames": COSTUME_FRAMES,
        "parts": {}, "heads": {}, "faces": {}, "skins": {}, "hairs": {},
        "guns": {}, "stows": {}, "gunLabels": {}, "animLabels": {}, "shadow": None,
    }

    tmp = tempfile.mkdtemp(prefix="gunlayer_")
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        b, pg = R.open_page(pw, supersample=SUPERSAMPLE)
        done = 0

        rig["shadow"] = bake_shadow(pg)

        for name, cid in LIMB.items():
            recs = {}
            for f in COSTUME_FRAMES:
                stow = limb_stow(os.path.join(sprite_dir(cid), f"{f}.svg"))
                rec = bake(pg, cid, f, f"limb/{name}/{f}.png",
                           hide_cids=[stow["cid"]] if stow else ())
                if rec:
                    if stow:
                        rec["stow"] = stow
                    recs[str(f)] = rec
            rig["parts"][name] = recs
            done += len(recs)
            print(f"  limb {name:8} {len(recs)} frames")

        for f in COSTUME_FRAMES:
            h = heads[str(f)]
            rec = bake(pg, HEAD_CID, f, f"head/{f}.png",
                       hide_cids=[v["cid"] for v in h.values() if v.get("cid")])
            if rec:
                rig["heads"][str(f)] = {"tex": rec, **h}
                done += 1
        for cid in face_syms:
            recs = {}
            for f in range(1, frame_count(cid) + 1):
                path = os.path.join(sprite_dir(cid), f"{f}.svg")
                skin = nested_uses(path).get("skin")
                rec = bake(pg, cid, f, f"face/{cid}/{f}.png",
                           hide_cids=[skin["cid"]] if skin else ())
                if rec:
                    if skin:
                        rec["skin"] = skin
                    recs[str(f)] = rec
            rig["faces"][str(cid)] = recs
            done += len(recs)
        for cid in skin_syms:
            recs = {str(f): bake(pg, cid, f, f"skin/{cid}/{f}.png")
                    for f in range(1, frame_count(cid) + 1)}
            rig["skins"][str(cid)] = recs
            done += len(recs)
        for cid in hair_syms:
            recs = {str(f): bake(pg, cid, f, f"hair/{cid}/{f}.png")
                    for f in range(1, frame_count(cid) + 1)}
            rig["hairs"][str(cid)] = recs
            done += len(recs)
        print(f"  heads {len(rig['heads'])}, faces {sum(len(v) for v in rig['faces'].values())}, "
              f"skins {sum(len(v) for v in rig['skins'].values())}, "
              f"hairs {sum(len(v) for v in rig['hairs'].values())}")

        for cid, name, store in ((GUN_CID, "gun", rig["guns"]),
                                 (STOW_CID, "stow", rig["stows"])):
            for f in range(1, GUN_FRAMES + 1):
                svg = gunlayer.inline_frame(sprite_dir(cid), f)
                rec = bake(pg, cid, f, f"{name}/{f}.png", svg_text=svg, trim=True)
                if not rec:
                    continue
                store[str(f)] = rec
        rig["gunLabels"] = {name: frame for frame, name in L.parse(L.SWF, GUN_CID)}
        rig["animLabels"] = {name: frame for frame, name in L.parse(L.SWF, UNIT_CID)}
        print(f"  guns {len(rig['guns'])}, stows {len(rig['stows'])}, "
              f"labels {len(rig['gunLabels'])}")
        done += len(rig["guns"]) + len(rig["stows"])

        b.close()
    shutil.rmtree(tmp, ignore_errors=True)

    with open(OUT_JSON, "w", encoding="utf-8") as fh:
        json.dump(rig, fh, separators=(",", ":"))
    size = sum(os.path.getsize(os.path.join(dp, f))
               for dp, _, fs in os.walk(OUT_PNG) for f in fs)
    print(f"wrote {OUT_JSON} and {done + 1} PNGs ({size // 1024} KB)")


if __name__ == "__main__":
    main()
