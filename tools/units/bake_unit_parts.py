#!/usr/bin/env python3
from __future__ import annotations

import glob
import json
import os
import re
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import gunlayer
import sheetpack
import svgraster as R
import swflabels as L

from PIL import Image

SC = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(SC, "..", ".."))
SPR = os.path.normpath(os.path.join(REPO, "..", "sfh3_decompiled", "sprites"))
HI = "--hi" in sys.argv
OUT = os.path.join(REPO, "public", "assets", "units", *(["hi"] if HI else []))
RIG = os.path.join(REPO, "src", "assets", "unitAnim.json")
HI_LAYOUT = os.path.join(REPO, "src", "assets", "unitSheetsHi.json")
TMP = os.path.join(OUT, "_tmp")

UNITMC_CID = 1970
ARM1_CID = 1965
ARM2_CID = 928
ARM1HOLD_CID = 1924
HEAD_CID = 1923
GUN_CID = 844
STOW_CID = 1362
ROPE_CID = 1967
LANDFX_CID = 1969
GUN_FRAMES = 323

MUZZLE = {
    "pistol": 848, "sniper": 853, "shotgun": 910,
    "rifle": 916, "mg": 927, "cannon": 1941,
}

LIMB = {
    "body": 1545, "waist": 1714, "arm": 357, "forearm": 479, "hand": 588,
    "leg": 1361, "shin": 1080, "foot": 1189,
}
INSTANCE = {
    "body": "body", "waist": "waist",
    "legup1": "leg", "legup2": "leg", "leglow1": "shin", "leglow2": "shin",
    "foot1": "foot", "foot2": "foot",
    "armup1": "arm", "armup2": "arm", "armlow1": "forearm", "armlow2": "forearm",
    "hand1": "hand", "hand2": "hand",
}
BASE_FRAMES = (1, 11, 21, 31, 41, 51, 61, 71, 81, 91, 101, 111, 121, 131, 141, 151,
               161, 171, 181, 191, 201, 211, 221, 231, 241, 251)
COSTUME_FRAMES = sorted({b + c - 1 for b in BASE_FRAMES for c in range(1, 7)})

NUM = r"[-0-9.eE]+"
MAT = re.compile(r"matrix\(([^)]*)\)")
XLINK = "{http://www.w3.org/1999/xlink}href"

SUPERSAMPLE = 4 if HI else 2
DSF = R.BASE_DSF * SUPERSAMPLE


def sprite_dir(cid: int) -> str:
    hits = glob.glob(os.path.join(SPR, f"DefineSprite_{cid}*"))
    if not hits:
        raise FileNotFoundError(f"sprite {cid}")
    return hits[0]


def frame_count(cid: int) -> int:
    return len(glob.glob(os.path.join(sprite_dir(cid), "*.svg")))


def cid_of(el) -> int | None:
    for k, v in el.attrib.items():
        if k.lower().endswith("characterid"):
            return int(v)
    return None


def matrix_of(tag: str | None):
    m = MAT.search(tag or "")
    if not m:
        return [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]
    return [float(x) for x in re.findall(NUM, m.group(1))]


def round_m(m):
    return [round(x, 4) for x in m]


def svg_size(svg: str):
    m = re.search(r'<svg[^>]*?height="([\d.]+)px"[^>]*?width="([\d.]+)px"', svg)
    w, h = float(m.group(2)), float(m.group(1))
    tx, ty = R.stage_origin(svg)
    return w * DSF, h * DSF, tx * DSF, ty * DSF


def top_uses(path: str):
    root = ET.parse(path).getroot()
    top = next(c for c in root if c.tag.endswith("}g"))
    out = []
    for el in top:
        if el.tag.endswith("}use"):
            out.append(((el.get("id") or "?"), cid_of(el),
                        round_m(matrix_of(el.get("transform")))))
    return out


def nested_uses(path: str, names=("face", "hair", "skin", "gun")):
    tree = ET.parse(path)
    defs = {el.get("id"): el for el in tree.getroot().iter() if el.get("id")}
    found = {}
    top = next(c for c in tree.getroot() if c.tag.endswith("}g"))
    for el in top.iter():
        if not el.tag.endswith("}use"):
            continue
        name = el.get("id") or ""
        if name not in names or name in found:
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


def parse_timeline():
    d = sprite_dir(UNITMC_CID)
    out = []
    for f in range(1, frame_count(UNITMC_CID) + 1):
        root = ET.parse(os.path.join(d, f"{f}.svg")).getroot()
        top = next(c for c in root if c.tag.endswith("}g"))
        frame = []
        for el in top:
            if not el.tag.endswith("}use"):
                continue
            name = el.get("id") or ""
            cid = cid_of(el)
            if cid == LANDFX_CID:
                name = "landfx"
            frame.append([name, *round_m(matrix_of(el.get("transform")))])
        out.append(frame)
    return out


def parse_arm_layouts():
    def by_label(cid: int, keep: set[str]):
        d = sprite_dir(cid)
        out = {}
        for frame, label in L.parse(L.SWF, cid):
            path = os.path.join(d, f"{frame}.svg")
            if not os.path.isfile(path):
                continue
            out[label] = [[n, *m] for n, _cid, m in top_uses(path) if n in keep]
        return out

    arm1 = by_label(ARM1_CID, {"gun", "armup1", "armlow1", "hand1"})
    arm2 = by_label(ARM2_CID, {"gun2", "armup2", "armlow2", "hand2"})
    hold = [[n, *m] for n, _cid, m in top_uses(os.path.join(sprite_dir(ARM1HOLD_CID), "1.svg"))
            if n in {"armup1", "armlow1", "hand1", "hand2"}]
    return arm1, arm2, hold


class Pack:

    def __init__(self, name: str):
        self.name = name
        self.items: list[dict] = []

    def add(self, pg, svg: str, key: str, out_rel: str, hide_cids=(),
            extra=None, post_render=None):
        try:
            w, h, ox, oy = svg_size(svg)
        except ValueError:
            return False
        path = os.path.join(TMP, out_rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        R.render(pg, svg, path, rect=(0, 0, w / DSF, h / DSF), hide_cids=hide_cids)
        if post_render:
            post_render(path, ox, oy)
        im = Image.open(path).convert("RGBA")
        self.items.append({
            "key": key, "path": path, "W": im.width, "H": im.height,
            "ox": ox, "oy": oy, "extra": extra or {},
        })
        return True

    def flush(self) -> dict:
        items = []
        for it in self.items:
            im, ax, ay = sheetpack.trimmed(Image.open(it["path"]), it["ox"], it["oy"])
            items.append({"key": it["key"], "im": im, "ax": ax, "ay": ay})
            os.remove(it["path"])
        sheets, rects = sheetpack.pack(items, OUT, f"hero_{self.name}")
        for p, sh in enumerate(sheets):
            print(f"    {self.name} page {p}: {sh['w']}x{sh['h']}")
        return {"sheets": sheets,
                "frames": {it["key"]: {"r": rects[it["key"]], **it["extra"]} for it in self.items}}


def add_part_frames(pack: Pack, pg, name: str, cid: int):
    for f in COSTUME_FRAMES:
        path = os.path.join(sprite_dir(cid), f"{f}.svg")
        if not os.path.isfile(path):
            continue
        svg = open(path, encoding="utf-8").read()
        nested = nested_uses(path)
        hide = [v["cid"] for v in nested.values() if v.get("cid")]
        extra = {}
        if "skin" in nested:
            extra["skin"] = nested["skin"]
        if "gun" in nested:
            extra["gun"] = nested["gun"]
        pack.add(pg, svg, str(f), f"{name}/{f}.png", hide_cids=hide, extra=extra)


def main():
    os.makedirs(OUT, exist_ok=True)
    for old in glob.glob(os.path.join(OUT, "hero_*.png")):
        os.remove(old)
    os.makedirs(TMP, exist_ok=True)

    print("parsing timeline ...")
    timeline = parse_timeline()
    print(f"  {len(timeline)} frames")
    arm1, arm2, arm1hold = parse_arm_layouts()
    print(f"  arm layouts: arm1 {len(arm1)}, arm2 {len(arm2)}, hold {len(arm1hold)}")

    heads = {str(f): nested_uses(os.path.join(sprite_dir(HEAD_CID), f"{f}.svg"))
             for f in COSTUME_FRAMES}
    face_syms = sorted({h["face"]["cid"] for h in heads.values() if "face" in h})
    face_skin = []
    for c in face_syms:
        for f in range(1, frame_count(c) + 1):
            face_skin.append(nested_uses(os.path.join(sprite_dir(c), f"{f}.svg")).get("skin"))
    limb_skin = set()
    for name, cid in LIMB.items():
        for f in COSTUME_FRAMES:
            n = nested_uses(os.path.join(sprite_dir(cid), f"{f}.svg"))
            if "skin" in n:
                limb_skin.add(n["skin"]["cid"])
    skin_syms = sorted({h["skin"]["cid"] for h in heads.values() if "skin" in h}
                       | {s["cid"] for s in face_skin if s}
                       | limb_skin)
    hair_syms = sorted({h["hair"]["cid"] for h in heads.values() if "hair" in h})
    print(f"  heads {len(heads)}, face {face_syms}, skin {skin_syms}, hair {hair_syms}")

    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        b, pg = R.open_page(pw, supersample=SUPERSAMPLE)
        done = 0

        groups = {}
        for name, cid in LIMB.items():
            print(f"  limb {name} ({cid}) ...")
            pack = Pack(name)
            add_part_frames(pack, pg, name, cid)
            groups[name] = pack.flush()
            done += len(groups[name]["frames"])

        print(f"  head ({HEAD_CID}) ...")
        pack = Pack("head")
        for f in COSTUME_FRAMES:
            h = heads[str(f)]
            svg = open(os.path.join(sprite_dir(HEAD_CID), f"{f}.svg"), encoding="utf-8").read()
            hide = [v["cid"] for v in h.values() if v.get("cid")]
            extra = {k: h[k] for k in ("face", "hair", "skin") if k in h}
            pack.add(pg, svg, str(f), f"head/{f}.png", hide_cids=hide, extra=extra)
        groups["head"] = pack.flush()
        done += len(groups["head"]["frames"])

        for cid in face_syms:
            print(f"  face {cid} ...")
            pack = Pack(f"face_{cid}")
            for f in range(1, frame_count(cid) + 1):
                path = os.path.join(sprite_dir(cid), f"{f}.svg")
                svg = open(path, encoding="utf-8").read()
                skin = nested_uses(path).get("skin")
                extra = {"skin": skin} if skin else {}
                pack.add(pg, svg, str(f), f"face_{cid}/{f}.png",
                         hide_cids=[skin["cid"]] if skin else (), extra=extra)
            groups[f"face_{cid}"] = pack.flush()
            done += len(groups[f"face_{cid}"]["frames"])

        for cid in hair_syms:
            print(f"  hair {cid} ...")
            pack = Pack(f"hair_{cid}")
            for f in range(1, frame_count(cid) + 1):
                svg = open(os.path.join(sprite_dir(cid), f"{f}.svg"), encoding="utf-8").read()
                pack.add(pg, svg, str(f), f"hair_{cid}/{f}.png")
            groups[f"hair_{cid}"] = pack.flush()
            done += len(groups[f"hair_{cid}"]["frames"])

        for cid in skin_syms:
            print(f"  skin {cid} ...")
            pack = Pack(f"skin_{cid}")
            for f in range(1, frame_count(cid) + 1):
                svg = open(os.path.join(sprite_dir(cid), f"{f}.svg"), encoding="utf-8").read()
                pack.add(pg, svg, str(f), f"skin_{cid}/{f}.png")
            groups[f"skin_{cid}"] = pack.flush()
            done += len(groups[f"skin_{cid}"]["frames"])

        for name, cid in (("gun", GUN_CID), ("stow", STOW_CID)):
            print(f"  {name} ({cid}) ...")
            pack = Pack(name)
            for f in range(1, GUN_FRAMES + 1):
                path = os.path.join(sprite_dir(cid), f"{f}.svg")
                if os.path.isfile(path):
                    pack.add(pg, gunlayer.inline_frame(sprite_dir(cid), f),
                             str(f), f"{name}/{f}.png")
            groups[name] = pack.flush()
            done += len(groups[name]["frames"])

        for name, cid in sorted(MUZZLE.items()):
            print(f"  muzzle {name} ({cid}) ...")
            pack = Pack(f"muzzle_{name}")
            for f in range(1, frame_count(cid) + 1):
                svg = open(os.path.join(sprite_dir(cid), f"{f}.svg"),
                           encoding="utf-8").read()
                pack.add(pg, svg, str(f), f"muzzle_{name}/{f}.png")
            groups[f"muzzle_{name}"] = pack.flush()
            done += len(groups[f"muzzle_{name}"]["frames"])

        for name, cid in (("rope", ROPE_CID), ("landfx", LANDFX_CID)):
            print(f"  {name} ({cid}) ...")
            pack = Pack(name)
            svg = open(os.path.join(sprite_dir(cid), "1.svg"), encoding="utf-8").read()
            pack.add(pg, svg, "1", f"{name}/1.png")
            groups[name] = pack.flush()
            done += 1

        b.close()

    import shutil
    shutil.rmtree(TMP, ignore_errors=True)

    if HI:
        write_hi_layout(groups)
        return
    rig = {
        "note": ("In-game hero rig (`UnitMC`, symbol 1970). `timeline` holds the "
                 "top-level placements per SWF frame; `groups` holds packed part "
                 "atlases keyed by frame. Each frame's `r` is [page, x, y, w, h, "
                 "anchorX, anchorY] in sheet pixels, trimmed to the art. Limb/head "
                 "frames carry the nested `skin`/`gun`/`face`/`hair` placements "
                 "`Stats_Classes.setSkin` recolours. Sheet pixels are `scale` times "
                 "the clip-local unit; divide the rig matrix by `scale` to place them."),
        "scale": SUPERSAMPLE,
        "timeline": timeline,
        "groups": groups,
        "gunLabels": {name: frame for frame, name in L.parse(L.SWF, GUN_CID)},
        "stowLabels": {name: frame for frame, name in L.parse(L.SWF, STOW_CID)},
        "arm1": arm1,
        "arm2": arm2,
        "arm1hold": arm1hold,
    }
    with open(RIG, "w", encoding="utf-8") as fh:
        json.dump(rig, fh, separators=(",", ":"))
    size = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT)
               if f.endswith(".png"))
    print(f"\nwrote {done} frames in {len([g for g in groups])} groups -> {RIG}")
    print(f"pages {size // 1024} KB in {OUT}")


def write_hi_layout(groups: dict) -> None:
    with open(RIG, encoding="utf-8") as fh:
        lo = json.load(fh)["groups"]
    for name, g in lo.items():
        missing = set(g["frames"]) - set(groups.get(name, {}).get("frames", {}))
        if missing:
            raise SystemExit(f"hi bake is missing {name} frames {sorted(missing)[:8]}")
    layout = {
        "scale": SUPERSAMPLE,
        "groups": {name: {"sheets": g["sheets"],
                          "frames": {k: f["r"] for k, f in g["frames"].items()}}
                   for name, g in groups.items()},
    }
    with open(HI_LAYOUT, "w", encoding="utf-8") as fh:
        json.dump(layout, fh, separators=(",", ":"))
    texels = sum(sh["w"] * sh["h"] for g in groups.values() for sh in g["sheets"])
    print(f"wrote {HI_LAYOUT}: {texels / 1e6:.1f}M texels")


if __name__ == "__main__":
    main()
