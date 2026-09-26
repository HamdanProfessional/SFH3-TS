#!/usr/bin/env python3
from __future__ import annotations

import glob
import json
import os
import re
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import svgraster as R
import swfio as S
import swftext as T
import uibake as U

REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT_IMG = os.path.join(REPO, "public", "ui", "items")
OUT_JSON = os.path.join(REPO, "src", "assets", "itemUi.json")
MENU = os.path.join(S.SPRITES, "DefineSprite_2913_Menu")
SUPERSAMPLE = 2
ICON_SUPERSAMPLE = 8

ITEMBOX = 2380
ITEMHOVER = 2346
ITEMCONTAINER = 2345
STATS = 2377
BG = 2189
STARS = 2195
BAR = 2080
ARROW = 2364
STARUP = 2368
ICON = 2034
PERK_ART = 2327
INV_TAB = 2580
GETITEM = 2408
SLOT_ICON = 2736
SLOT_SPIN = 2738
SLOT_MACHINE = 2742
UPGRADEBOX = 2759
UPGRADE_STARS = 2755
UPGRADE_DISPLAY = 2762

SVG_NS = "{http://www.w3.org/2000/svg}"
FF_NS = "{https://www.free-decompiler.com/flash}"
MAT = re.compile(r"matrix\(([^)]*)\)")
NUM = r"[-0-9.eE]+"
SIZE_RE = re.compile(r'<svg[^>]*?height="([\d.]+)px"[^>]*?width="([\d.]+)px"')

BOX_STATES = {"idle1": 1, "idle2": 13, "idle3": 25, "idle4": 37,
              "open1": 6, "open2": 18, "open3": 30, "open4": 42}

BOX_TWEEN = {"open1": [2, 3, 4, 5], "open2": [14, 15, 16, 17],
             "open3": [26, 27, 28, 29], "open4": [38, 39, 40, 41]}

CONT_STATES = ["gun", "gun2", "perk", "none", "gold", "features", "blueprint",
               "blueprint1", "blueprint2", "blueprint3", "default",
               "class", "class2", "class3", "random", "random2"]

CLASS_IDS = ["sni", "med", "eng", "mer", "jug", "gun", "eli", "nin", "spe", "akq"]

HIDE_BY_CONT = {
    "gun": {844}, "gun2": {844}, "perk": {PERK_ART},
    "blueprint": {844, 2337}, "blueprint1": {844, 2337, 2338},
    "blueprint2": {844, 2339}, "blueprint3": {2341},
    "class": {ICON}, "class2": {ICON}, "class3": {ICON},
}


def sprite_dir(cid):
    for d in glob.glob(os.path.join(S.SPRITES, f"DefineSprite_{cid}*")):
        base = os.path.basename(d)
        if base == f"DefineSprite_{cid}" or base.startswith(f"DefineSprite_{cid}_") \
                or base.startswith(f"DefineSprite_{cid}."):
            return d
    raise FileNotFoundError(f"no sprite dir for {cid}")


def frame_count(cid):
    return len(glob.glob(os.path.join(sprite_dir(cid), "*.svg")))


def _labels(cid):
    sys.path.insert(0, os.path.join(REPO, "tools"))
    import swflabels as L
    frame = {}
    for f, name in L.parse(L.SWF, cid):
        frame.setdefault(name, f)
    return frame


def parse_matrix(tag):
    m = MAT.search(tag or "")
    if not m:
        return [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]
    return [float(x) for x in re.findall(NUM, m.group(1))]


def placed_uses(path):
    root = ET.parse(path).getroot()
    roots = [c for c in root if c.tag == SVG_NS + "g"
             and "0.5" in (c.get("transform") or "")]
    if not roots:
        return None
    out = []
    for u in roots[0].iter(SVG_NS + "use"):
        cid = u.get(FF_NS + "characterId")
        out.append({
            "name": u.get("id") or "",
            "cid": int(cid) if cid else None,
            "m": parse_matrix(u.get("transform")),
        })
    return out


def find_use(path, name):
    for u in placed_uses(path) or []:
        if u["name"] == name:
            return u
    return None


def clips(path):
    svg = open(path, encoding="utf-8").read()
    out = {}
    for cid, d in re.findall(r'<clipPath id="(\w+)">\s*<path d="([^"]+)"', svg):
        n = [float(x) for x in re.findall(NUM, d)]
        xs, ys = n[0::2], n[1::2]
        out[cid] = [round(min(xs), 2), round(min(ys), 2),
                    round(max(xs) - min(xs), 2), round(max(ys) - min(ys), 2)]
    return out


def render(pg, cid, frame, rel, hide_cids=(), hide=(), ss=SUPERSAMPLE):
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
             hide=[f"#host > svg > g > *:nth-child({i + 1})" for i in hide],
             hide_cids=[str(c) for c in hide_cids])
    rec = {"file": rel.replace("\\", "/"),
           "w": round(w * 2, 2), "h": round(h * 2, 2),
           "ox": round(tx * 2, 2), "oy": round(ty * 2, 2)}
    if ss != SUPERSAMPLE:
        rec["s"] = ss
    return rec


def _put(img, key, rec):
    if rec:
        img[key] = rec


def text_record(edits, cid):
    rec = edits.get(cid)
    if not rec:
        return None
    spec = dict(rec)
    spec.pop("text", None)
    return spec


def bake_box(pg, pg_icon, edits, img, text):
    all_edit = sorted(edits)

    for f in list(range(1, 7)) + list(range(10, 21)) + [25]:
        rec = render(pg, BG, f, f"bg_{f}.png")
        if rec:
            img[f"bg_{f}"] = rec

    for f in range(1, 7):
        _put(img, f"stars_{f}", render(pg, STARS, f, f"stars_{f}.png"))
    for f in (1, 2, 3):
        _put(img, f"stats_{f}", render(
            pg, STATS, f, f"stats_{f}.png",
            hide_cids=all_edit + [BAR, ARROW, STARUP, ICON]))
    _put(img, "bar", render(pg, BAR, 1, "bar.png"))
    for f in (1, 2, 3, 4):
        _put(img, f"arrow_{f}", render(pg, ARROW, f, f"arrow_{f}.png"))
    _put(img, "starup", render(pg, STARUP, 1, "starup.png"))
    for t in range(0, 11):
        _put(img, f"icon_{t}", render(pg, ICON, 65 + t, f"icon_{t}.png"))

    for f in (1, 2):
        _put(img, f"tab_{f}", render(pg, INV_TAB, f, f"tab_{f}.png",
                                      hide_cids=[2578]))
    rec = text_record(edits, 2578)
    if rec:
        text["2578"] = rec

    cont_labels = _labels(ITEMCONTAINER)
    for label in CONT_STATES:
        f = cont_labels.get(label)
        if not f:
            continue
        rec = render(pg, ITEMCONTAINER, f, f"cont_{label}.png",
                     hide_cids=sorted(HIDE_BY_CONT.get(label, set())))
        if rec:
            img[f"cont_{label}"] = rec

    perk_labels = _labels(PERK_ART)
    for label, f in perk_labels.items():
        rec = render(pg, PERK_ART, f, f"perk_{label}.png")
        if rec:
            img[f"perk_{label}"] = rec
    for label in CLASS_IDS:
        f = _labels(ICON).get(label)
        if f:
            _put(img, f"classicon_{label}",
                 render(pg_icon, ICON, f, f"classicon_{label}.png",
                        ss=ICON_SUPERSAMPLE))

    hover = find_use(os.path.join(sprite_dir(ITEMBOX), "1.svg"), "cont")
    assert hover and hover["cid"] == ITEMHOVER, hover

    box_clip, box_stats_clip, box_place, box_tween = {}, {}, {}, {}
    for state, f in BOX_STATES.items():
        path = os.path.join(sprite_dir(ITEMBOX), f"{f}.svg")
        box_place[state] = [
            {"name": u["name"], "m": u["m"]}
            for u in placed_uses(path) or []]
        box_tween[state] = [
            {"place": [{"name": u["name"], "m": u["m"]}
                       for u in placed_uses(
                           os.path.join(sprite_dir(ITEMBOX), f"{tf}.svg")) or []],
             "clip": (tc := clips(os.path.join(sprite_dir(ITEMBOX), f"{tf}.svg")))
                     .get("clipPath0") or tc.get("clipPath1"),
             "statsClip": tc.get("clipPath1") or tc.get("clipPath0")}
            for tf in BOX_TWEEN.get(state, [])]
        cs = clips(path)
        box_clip[state] = cs.get("clipPath0") or cs.get("clipPath1")
        box_stats_clip[state] = cs.get("clipPath1") or cs.get("clipPath0")

    for cid in [2347]:
        text[str(cid)] = text_record(edits, cid)

    return {"clip": box_clip, "statsClip": box_stats_clip, "place": box_place,
            "tween": {k: v for k, v in box_tween.items() if v}}


def bake_stats(edits, text, box):
    out = {"frames": {str(f): f"stats_{f}" for f in (1, 2, 3)}, "place": {}}
    for f in (1, 2, 3):
        path = os.path.join(sprite_dir(STATS), f"{f}.svg")
        out["place"][str(f)] = [
            {"name": u["name"], "cid": u["cid"], "m": u["m"]}
            for u in placed_uses(path) or []]
    for cid in (2349, 2355, 2356, 2357, 2358, 2360, 2365, 2366, 2369,
                2371, 2372, 2373, 2374, 2337):
        rec = text_record(edits, cid)
        if rec:
            text[str(cid)] = rec
    return out


def bake_cont_states(edits, text, img):
    cont_labels = _labels(ITEMCONTAINER)
    out = {}
    for label in CONT_STATES:
        f = cont_labels.get(label)
        if not f:
            continue
        path = os.path.join(sprite_dir(ITEMCONTAINER), f"{f}.svg")
        out[label] = {
            "img": f"cont_{label}",
            "place": [{"name": u["name"], "cid": u["cid"], "m": u["m"]}
                      for u in placed_uses(path) or []],
        }
    for cid in (2337, 2339, 2341):
        rec = text_record(edits, cid)
        if rec:
            text[str(cid)] = rec
    return out


def bake_getitem(pg, edits, img, text):
    all_edit = sorted(edits)
    states = {
        "get": 2,
        "error1": 3, "error2": 4, "error3": 5,
        "unlock": 137,
        "build": 122,
        "hire": 148, "hireError": 149, "fire": 171,
    }
    out = {}
    with_hide = all_edit + [ITEMBOX, ITEMCONTAINER, 2087]
    for name, f in states.items():
        hide = with_hide
        if name == "get":
            hide = with_hide + [2384, 2385]
        elif name.startswith("error"):
            hide = with_hide + [2385]
        elif name in ("build", "hire", "hireError", "fire"):
            hide = all_edit + [ITEMBOX, ITEMCONTAINER]
        rec = render(pg, GETITEM, f, f"gi_{name}.png", hide_cids=hide)
        out[name] = {"plate": f"gi_{name}",
                     "place": [{"name": u["name"], "cid": u["cid"], "m": u["m"]}
                               for u in placed_uses(
                                   os.path.join(sprite_dir(GETITEM), f"{f}.svg")) or []]}
        img[f"gi_{name}"] = rec
    for cid in (2382, 2383, 2396, 2397, 2401, 2402, 2405, 2406):
        rec = text_record(edits, cid)
        if rec:
            text[str(cid)] = rec
    return out


def bake_slot(pg, edits, img, text):
    icon_labels = _labels(SLOT_ICON)
    faces = {}
    for label, f in icon_labels.items():
        rec = render(pg, SLOT_ICON, f, f"slotface_{label}.png")
        if rec:
            img[f"slotface_{label}"] = rec
            faces[label] = f"slotface_{label}"
    _put(img, "slot_chrome",
         render(pg, SLOT_MACHINE, 1, "slot_chrome.png",
                hide_cids=sorted(edits), hide=[0, 4, 5, 7, 8, 10]))
    spin1 = os.path.join(sprite_dir(SLOT_SPIN), "1.svg")
    icon_use = find_use(spin1, "icon")
    reels = []
    machine = os.path.join(sprite_dir(SLOT_MACHINE), "1.svg")
    for name in ("slot1", "slot2", "slot3"):
        u = find_use(machine, name)
        if u:
            reels.append([round(u["m"][4], 2), round(u["m"][5], 2)])
    for cid in (2740, 2741):
        rec = text_record(edits, cid)
        if rec:
            text[str(cid)] = rec
    fields = {}
    for u in placed_uses(machine) or []:
        if u["name"] in ("txt_result", "txt_extra"):
            fields[u["name"]] = [round(u["m"][4], 2), round(u["m"][5], 2)]
    face = img[faces.get("sfh", "slotface_sfh")]
    out = {"faces": faces, "reels": reels, "fields": fields,
           "facePlace": [round(icon_use["m"][4], 2), round(icon_use["m"][5], 2)],
           "faceW": face["w"], "faceH": face["h"]}
    if "slot_chrome" in img:
        out["chrome"] = "slot_chrome"
    return out


def bake_workshop(pg, edits, img, text):
    for f in (1, 2, 3, 4):
        rec = render(pg, UPGRADEBOX, f, f"upgradebox_{f}.png",
                     hide_cids=sorted(edits) + [2087, UPGRADE_STARS])
        if rec:
            img[f"upgradebox_{f}"] = rec
    for f in range(1, 7):
        _put(img, f"upstar_{f}", render(pg, UPGRADE_STARS, f, f"upstar_{f}.png"))
    _put(img, "updisplay_ok", render(pg, UPGRADE_DISPLAY, 43, "updisplay_ok.png"))
    _put(img, "updisplay_fail", render(pg, UPGRADE_DISPLAY, 87, "updisplay_fail.png"))
    for cid in (2746, 2747):
        rec = text_record(edits, cid)
        if rec:
            text[str(cid)] = rec


def menu_use(frame, name):
    return find_use(os.path.join(MENU, f"{frame}.svg"), name)


def cont_children(frame):
    path = os.path.join(MENU, f"{frame}.svg")
    cont = find_use(path, "cont")
    if not cont:
        return {}, None
    root = ET.parse(path).getroot()
    defs = next(c for c in root if c.tag == SVG_NS + "defs")
    href = None
    for u in root.iter(SVG_NS + "use"):
        if u.get("id") == "cont":
            href = (u.get("{http://www.w3.org/1999/xlink}href") or "").lstrip("#")
            break
    group = next(c for c in defs if c.get("id") == href)
    out = {}
    for u in group.iter(SVG_NS + "use"):
        nm = u.get("id")
        if nm and nm not in out:
            out[nm] = {"m": parse_matrix(u.get("transform"))}
    return out, cont


def bake_gun_reg():
    out = {}
    for f in range(1, frame_count(844) + 1):
        path = os.path.join(sprite_dir(844), f"{f}.svg")
        if not os.path.isfile(path):
            continue
        u = find_use(path, "reg_menu")
        if u:
            out[str(f)] = [round(u["m"][4], 2), round(u["m"][5], 2)]
    return out


def bake_layout():
    lay = {"stageTop": 64}

    inv, cont = cont_children(16)
    cx, cy = cont["m"][4], cont["m"][5]
    cards = []
    for i in range(24):
        hb = inv.get(f"hitbox{i}")
        if hb:
            cards.append([round(cx + hb["m"][4], 2), round(cy + hb["m"][5], 2)])
    tabs = []
    for i in range(13):
        u = menu_use(16, f"inv{i}")
        if u:
            tabs.append([round(u["m"][4], 2), round(u["m"][5], 2)])
    lay["inventory"] = {"cards": cards, "tabs": tabs}

    for label, frame in (("heroesInv", 6), ("workshopInv", 11)):
        fi, fcont = cont_children(frame)
        if not fcont:
            continue
        fx, fy = fcont["m"][4], fcont["m"][5]
        fcards = []
        for i in range(24):
            hb = fi.get(f"hitbox{i}")
            if hb:
                fcards.append([round(fx + hb["m"][4], 2), round(fy + hb["m"][5], 2)])
        ftabs = []
        for i in range(13):
            u = menu_use(frame, f"inv{i}")
            if u:
                ftabs.append([round(u["m"][4], 2), round(u["m"][5], 2)])
        fplace = {}
        for name in ("unequip", "bt_back"):
            u = menu_use(frame, name)
            if u:
                fplace[name] = [round(v, 4) for v in u["m"]]
        lay[label] = {"cards": fcards, "tabs": ftabs, "place": fplace}

    st, scont = cont_children(26)
    sx, sy = scont["m"][4], scont["m"][5]
    scards = []
    for i in range(12):
        hb = st.get(f"hitbox{i}")
        if hb:
            scards.append([round(sx + hb["m"][4], 2), round(sy + hb["m"][5], 2)])
    splace = {}
    for name in ("txt_slotPrice", "txt_slotDesc", "bt_slots"):
        u = menu_use(26, name)
        if u:
            splace[name] = [round(v, 4) for v in u["m"]]
    lay["store"] = {"cards": scards, "place": splace}

    ws = {}
    for name in ("weapon", "weaponbox", "upgradebox", "upgradedisplay",
                 "scrollpane"):
        u = menu_use(31, name)
        if u:
            ws[name] = [round(u["m"][4], 2), round(u["m"][5], 2)]
    lay["workshop"] = ws
    return lay


def main():
    os.makedirs(OUT_IMG, exist_ok=True)
    edits = T.parse()
    manifest = {"scale": SUPERSAMPLE, "img": {}, "text": {}, "slot": {},
                "layout": {}}

    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        b, pg = R.open_page(pw, supersample=SUPERSAMPLE)
        b_icon, pg_icon = R.open_page(pw, supersample=ICON_SUPERSAMPLE)

        manifest["box"] = bake_box(pg, pg_icon, edits, manifest["img"],
                                   manifest["text"])
        manifest["stats"] = bake_stats(edits, manifest["text"], manifest["box"])
        manifest["cont"] = bake_cont_states(edits, manifest["text"],
                                            manifest["img"])
        manifest["get"] = bake_getitem(pg, edits, manifest["img"],
                                       manifest["text"])
        manifest["slot"] = bake_slot(pg, edits, manifest["img"], manifest["text"])
        bake_workshop(pg, edits, manifest["img"], manifest["text"])

        b_icon.close()
        b.close()

    manifest["layout"] = bake_layout()
    manifest["gunReg"] = bake_gun_reg()
    print(f"gunReg: {len(manifest['gunReg'])} frames")

    with open(OUT_JSON, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=1)
    n = len(manifest["img"])
    print(f"wrote {OUT_JSON}: {n} images, {len(manifest['text'])} text specs")
    print("images in", OUT_IMG)


if __name__ == "__main__":
    main()
