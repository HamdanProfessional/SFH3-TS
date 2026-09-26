#!/usr/bin/env python3
import json
import os
import re
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import swfio as S
import svgraster as R

MENU_CID = 2913
BG_CID = 2430
SYMBOLS = os.path.join(S.DECOMP, "symbolClass", "symbols.csv")
TEXTS = os.path.join(S.DECOMP, "texts")

BG_SPOT = {
    "missions": "missions",
    "heroes": "heroes",
    "deploy": "deploy",
    "heroesInv": "heroes",
    "workshopInv": "workshop",
    "inventory": "inventory",
    "store": "store",
    "workshop": "workshop",
}
BG_SPOT_DEFAULT = "missions"

MATRIX_RE = re.compile(
    r'matrix\(\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+),'
    r'\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)\s*\)')

SVG_NS = "{http://www.w3.org/2000/svg}"
FFDEC_NS = "{https://www.free-decompiler.com/flash}"
XLINK_NS = "{http://www.w3.org/1999/xlink}"


def load_symbols():
    ob = {}
    with open(SYMBOLS, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or ";" not in line:
                continue
            cid, name = line.split(";", 1)
            ob[int(cid)] = name.strip().strip('"')
    return ob


def is_text(cid):
    return os.path.isfile(os.path.join(TEXTS, f"{cid}.txt"))


def place(b, p, code):
    flags = b[p]; p += 1
    flags2 = b[p] if code == S.PLACE3 else 0
    if code == S.PLACE3:
        p += 1
    depth = struct.unpack_from("<H", b, p)[0]; p += 2
    if code == S.PLACE3 and flags2 & 0x08:
        _, p = S.cstr(b, p)
    o = {"depth": depth, "move": bool(flags & 0x01)}
    if flags & 0x02:
        o["cid"] = struct.unpack_from("<H", b, p)[0]; p += 2
    if flags & 0x04:
        o["m"], p = S.matrix6(b, p)
    if flags & 0x08:
        _, _, p = S.cxform_read(b, p)
    if flags & 0x10:
        p += 2
    if flags & 0x20:
        o["name"], p = S.cstr(b, p)
    if flags & 0x40:
        o["clipDepth"] = struct.unpack_from("<H", b, p)[0]; p += 2
    return o


def frame_labels(buf, sprites):
    a, b = sprites[MENU_CID]
    out, frame = {}, 1
    for code, p, _ln in S.tags(buf, a, b):
        if code == S.FRAME_LABEL:
            nm, _ = S.cstr(buf, p)
            out[nm] = frame
        elif code == S.SHOW_FRAME:
            frame += 1
    return out


def bg_markers(buf, sprites):
    a, b = sprites[BG_CID]
    out = {}
    for code, p, _ln in S.tags(buf, a, b):
        if code in (S.PLACE2, S.PLACE3):
            o = place(buf, p, code)
            if o.get("name") and "m" in o:
                out[o["name"]] = round(o["m"][0], 2)
    return out


def tag_display_list(buf, sprites, want_frame):
    a, b = sprites[MENU_CID]
    live, frame = {}, 1
    for code, p, _ln in S.tags(buf, a, b):
        if code in (S.PLACE2, S.PLACE3):
            o = place(buf, p, code)
            if o["move"] and o["depth"] in live:
                live[o["depth"]].update(
                    {k: v for k, v in o.items() if k != "move"})
            else:
                live[o["depth"]] = o
        elif code == 28:
            live.pop(struct.unpack_from("<H", buf, p)[0], None)
        elif code == S.SHOW_FRAME:
            if frame == want_frame:
                return live
            frame += 1
    return live


def _root_group(tree):
    for child in tree:
        if child.tag == SVG_NS + "g" and "0.5" in (child.get("transform") or ""):
            return child
    raise ValueError("no ffdec root group")


def _use_of(el):
    if el.tag == SVG_NS + "use":
        return el
    if el.tag == SVG_NS + "g":
        for d in el.iter(SVG_NS + "use"):
            return d
    return None


def svg_display_list(svg_text):
    import xml.etree.ElementTree as ET

    tx, ty = R.stage_origin(svg_text)
    root = _root_group(ET.fromstring(svg_text))
    out = []
    for i, child in enumerate(root):
        if child.tag in (SVG_NS + "clipPath", SVG_NS + "defs",
                         SVG_NS + "mask", SVG_NS + "filter"):
            continue
        use = _use_of(child)
        if use is None:
            continue
        mt = MATRIX_RE.search(use.get("transform") or "")
        out.append({
            "order": len(out),
            "child": i,
            "cid": int(use.get(FFDEC_NS + "characterId") or 0) or None,
            "name": use.get("id"),
            "href": (use.get(XLINK_NS + "href") or "").lstrip("#"),
            "clipped": child.get("clip-path") is not None,
            "x": round(float(mt.group(5)), 2) if mt else 0.0,
            "y": round(float(mt.group(6)), 2) if mt else 0.0,
            "w": round(float(use.get("width", 0)), 2),
            "h": round(float(use.get("height", 0)), 2),
            "sx": round(float(mt.group(1)), 4) if mt else 1.0,
            "sy": round(float(mt.group(4)), 4) if mt else 1.0,
        })
    return {"originX": tx, "originY": ty, "items": out}


def main():
    buf = S.body()
    sprites = S.sprites(buf)
    syms = load_symbols()
    labels = frame_labels(buf, sprites)
    markers = bg_markers(buf, sprites)

    wanted = sys.argv[1:] or sorted(labels)
    report = {}
    for label in wanted:
        if label not in labels:
            print(f"!! no frame labelled {label!r}")
            continue
        fnum = labels[label]
        path = R.menu_frame_path(fnum)
        if not os.path.isfile(path):
            print(f"!! {label}: no {path}")
            continue
        with open(path, encoding="utf-8") as fh:
            svg = svg_display_list(fh.read())

        tags = tag_display_list(buf, sprites, fnum)
        by_name = {o["name"]: o for o in tags.values() if o.get("name")}

        for it in svg["items"]:
            it["class"] = syms.get(it["cid"])
            it["text"] = is_text(it["cid"]) if it["cid"] else False
            t = by_name.get(it["name"])
            it["depth"] = t["depth"] if t else None

        svg["frame"] = fnum
        svg["label"] = label

        spot = BG_SPOT.get(label, BG_SPOT_DEFAULT)
        bg = next((i for i in svg["items"] if i["cid"] == BG_CID), None)
        if bg is not None and spot in markers:
            svg["bgSpot"] = spot
            svg["bgChild"] = bg["child"]
            svg["bgRestX"] = round(-markers[spot], 2)
            svg["bgDx"] = round(-markers[spot] - bg["x"], 2)

        report[label] = svg

        named = sum(1 for i in svg["items"] if i["name"])
        texts = sum(1 for i in svg["items"] if i["text"])
        print(f"{label:12} frame {fnum:2}  svg items {len(svg['items']):3}  "
              f"named {named:3}  textfields {texts:3}  "
              f"tag depths {len(tags)}  "
              f"bg {svg.get('bgSpot','-'):10} {svg.get('bgDx',0):+9.2f}")

    out = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                       "..", "src", "assets", "menuFrames.json")
    with open(os.path.normpath(out), "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=1)
    print("wrote", os.path.normpath(out))


if __name__ == "__main__":
    main()
