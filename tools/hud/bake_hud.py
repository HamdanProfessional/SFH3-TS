#!/usr/bin/env python3
import glob
import html
import json
import os
import re
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import swfio as S
import svgraster as R
import swflabels as L
import swftext as T
from uibake import fix_glyph_text, svg_size

REPO = os.path.normpath(os.path.join(HERE, "..", ".."))
OUT_IMG = os.path.join(REPO, "public", "ui", "hud")
OUT_JSON = os.path.join(REPO, "src", "assets", "hudUi.json")

HUD_CID = 3715
STATES = [
    ("idle", 1), ("tutmove", 2), ("tutswitch", 3), ("tutstreak", 4),
    ("tutmember", 5), ("pause", 8), ("start", 9), ("end", 101),
]
PLATE_ALIAS = {"start": "hud_idle.png"}
HUD_BG = 3579
SCOREBAR = 3600
SB_ROW = 3596
SB_BAR = 3592
SB_CAP = 3594
SCOREBAR_LIST = 3731
ICONS = 2034
FLAGS = 3609
BLOODY = 3574
ARROW = 3570
SPEAK = 3622
AIMER = 3722
AIMER_LINE = 3717
AIMER_CIRCLE = 3721

HEAD = 2076
HEAD_PORTRAIT = 1923
HEAD_BT = 2064
HEAD_SEL = 2069
HEAD_NEW = 2071
SELECT_BT = 3616
SONG_BT = 3699

DYNAMIC = [BLOODY, 3576, SB_BAR, SB_CAP, ICONS, FLAGS, SPEAK, 2076, 3616, 3567,
           ARROW, SONG_BT]
SPONSOR = [43]

SUPERSAMPLE = 2

ICON_PX = 8
ICON_GLOW_FILTER = (
    '<filter color-interpolation-filters="sRGB" height="300%" '
    'id="hudIconGlow" width="300%" x="-100%" y="-100%">'
    '<feOffset dx="0.0" dy="0.0" in="SourceGraphic" result="glow1"/>'
    '<feColorMatrix in="glow1" result="glow2" type="matrix" '
    'values="0 0 0 0 0.0,0 0 0 0 0.0,0 0 0 0 0.0,0 0 0 1.0 0"/>'
    '<feGaussianBlur in="glow2" result="glow3" stdDeviation="0.162 0.162"/>'
    '<feColorMatrix in="glow3" result="glow4" type="matrix" '
    'values="1 0 0 0 0,0 1 0 0 0,0 0 1 0 0,0 0 0 3.0 0"/>'
    '<feComposite in="SourceGraphic" in2="glow4" operator="over" result="glow5"/>'
    '</filter>'
)


def glow_wrap(svg: str) -> str:
    m = R.ROOT_G.search(svg)
    if not m:
        return svg
    depth = 0
    i = m.end()
    end = -1
    while True:
        nxt_open = svg.find("<g", i)
        nxt_close = svg.find("</g>", i)
        if nxt_close == -1:
            break
        if nxt_open != -1 and nxt_open < nxt_close:
            tag_end = svg.find(">", nxt_open)
            if tag_end != -1 and svg[tag_end - 1] == "/":
                i = tag_end + 1
                continue
            depth += 1
            i = nxt_open + 2
        elif depth == 0:
            end = nxt_close
            break
        else:
            depth -= 1
            i = nxt_close + 4
    if end < 0:
        return svg
    return (svg[:m.start()] + ICON_GLOW_FILTER + '<g filter="url(#hudIconGlow)">'
            + svg[m.start():end] + "</g>" + svg[end:])


HALF_W, HALF_H = 200.0, 150.0

REMOVE1, REMOVE2 = 5, 28

FAMILIES = [
    "QTypeSquare-Book", "QTypeSquare-Bold", "QTypeSquare-BlackMajuscles",
    "QTypeSquare-Light", "QTypeSquare-Medium", "QTypeSquare-ExtraLight",
    "Xoireqe",
]


def matrix6_pixi(m):
    tx, ty, a, d, b, c = m
    return [round(x, 4) for x in (a, b, c, d, tx, ty)]


def placements(cid):
    buf = S.body()
    s, e = S.sprites(buf)[cid]
    state = {}
    out = []
    for code, p, ln in S.tags(buf, s, e):
        if code == S.SHOW_FRAME:
            out.append({d: v for d, v in state.items()})
            continue
        if code in (S.PLACE2, S.PLACE3):
            q = p
            flags = buf[q]
            q += 1
            hasName = flags & 0x20
            hasCx = flags & 0x08
            hasM = flags & 0x04
            hasC = flags & 0x02
            if code == S.PLACE3:
                q += 1
            depth = struct.unpack_from("<H", buf, q)[0]
            q += 2
            ch = m = cx = name = None
            if hasC:
                ch = struct.unpack_from("<H", buf, q)[0]
                q += 2
            if hasM:
                m, q = S.matrix6(buf, q)
            if hasCx:
                r = S.cxform_read(buf, q)
                cx = (r[0], r[1])
                q = r[2]
            if flags & 0x10:
                q += 2
            if hasName:
                name, q = S.cstr(buf, q)
            if flags & 0x40:
                q += 2
            if flags & 0x80:
                q += 2
            if ch is None and name is None:
                old = state.get(depth)
                if old is not None:
                    state[depth] = (old[0], m or old[1], cx or old[2], old[3])
            else:
                state[depth] = (ch, m, cx, name)
        elif code == REMOVE2:
            flags = buf[p]
            depth = struct.unpack_from("<H", buf, p + 1)[0]
            state.pop(depth, None)
        elif code == REMOVE1:
            (depth,) = struct.unpack_from("<H", buf, p)
            state.pop(depth, None)
    return out


def named(placements_frame, name):
    for cid, m, cx, nm in placements_frame.values():
        if nm == name:
            return {"cid": cid, "m": matrix6_pixi(m), "cx": cx}
    return None


def plain_text(markup):
    if not markup:
        return ""
    txt = re.sub(r"<[^>]+>", "", markup)
    return html.unescape(txt).replace("\r\n", "\n").replace("\r", "\n").strip()


def font_family(name):
    for f in FAMILIES:
        if name and name.startswith(f):
            return f
    return name or "Verdana"


def text_specs(cids):
    parsed = T.parse()
    out = {}
    for cid in sorted(cids):
        r = parsed.get(cid)
        if not r:
            continue
        out[str(cid)] = {
            "cid": cid,
            "x": r.get("x", 0.0), "y": r.get("y", 0.0),
            "w": r.get("w", 0.0), "h": r.get("h", 0.0),
            "size": r.get("size"),
            "font": font_family(r.get("font")),
            "color": r.get("color"),
            "alpha": r.get("alpha"),
            "align": r.get("align", "left"),
            "leading": r.get("leading", 0.0),
            "wordWrap": r.get("wordWrap", False),
            "multiline": r.get("multiline", False),
            "default": plain_text(r.get("text")),
        }
    return out


def text_cids_in(svg):
    out = set()
    for m in re.finditer(r"<use\b[^>]*?>", svg):
        tag = m.group(0)
        if 'href="#text' not in tag:
            continue
        c = re.search(r'characterId="(\d+)"', tag)
        if c:
            out.add(int(c.group(1)))
    return out


def out_path(rel):
    p = os.path.join(OUT_IMG, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    return p


def bake_plate(pg, state, frame, hide_cids):
    svg = fix_glyph_text(open(S.frame_svgs(HUD_CID)[frame - 1], encoding="utf-8").read())
    rel = f"hud_{state}.png"
    R.render(pg, svg, out_path(rel), hide_cids=hide_cids)
    return rel


def bake_button(pg, cid, stem):
    d = os.path.join(S.DECOMP, "buttons", f"DefineButton2_{cid}")
    entry = {"states": {}}
    for state, fname in (("up", "1_up.svg"), ("over", "2_over.svg"),
                         ("down", "3_down.svg")):
        path = os.path.join(d, fname)
        if not os.path.isfile(path):
            continue
        svg = fix_glyph_text(open(path, encoding="utf-8").read())
        ox, oy = R.stage_origin(svg)
        w, h = svg_size(svg)
        rel = f"{stem}_{state}.png"
        R.render(pg, svg, out_path(rel), rect=(0, 0, w, h))
        entry["states"][state] = rel
        entry.update({"offX": round(-ox * SUPERSAMPLE, 2),
                      "offY": round(-oy * SUPERSAMPLE, 2),
                      "w": round(w * SUPERSAMPLE, 2),
                      "h": round(h * SUPERSAMPLE, 2)})
    if not entry["states"]:
        raise SystemExit(f"button {cid} exported no states")
    return entry


def bake_at_origin(pg, cid, frame, rel, hide_cids=(), hide=(), svg_text=None):
    path = S.frame_svgs(cid)[frame - 1]
    svg = svg_text if svg_text is not None else open(path, encoding="utf-8").read()
    tx, ty = R.stage_origin(svg)
    tmp = out_path("_tmp.png")
    R.render(pg, svg, tmp,
             rect=(tx - HALF_W, ty - HALF_H, HALF_W * 2, HALF_H * 2),
             hide=hide, hide_cids=[str(c) for c in hide_cids])

    from PIL import Image
    im = Image.open(tmp)
    bbox = im.getchannel("A").getbbox()
    ox0, oy0 = im.width // 2, im.height // 2
    if bbox is None:
        final = tmp
        rec = {"file": rel, "w": HALF_W * 4, "h": HALF_H * 4, "ox": ox0, "oy": oy0}
    else:
        minx, miny, maxx, maxy = bbox
        crop = im.crop(bbox)
        final = out_path(rel)
        crop.save(final)
        rec = {
            "file": rel,
            "w": maxx - minx, "h": maxy - miny,
            "ox": ox0 - minx, "oy": oy0 - miny,
        }
    im.close()
    if final != out_path(rel):
        os.replace(final, out_path(rel))
    elif os.path.exists(tmp):
        os.remove(tmp)
    return rec


def main():
    os.makedirs(OUT_IMG, exist_ok=True)
    text_cids = set(T.parse())
    plate_hides = [str(c) for c in sorted(text_cids | set(DYNAMIC) | set(SPONSOR))]

    manifest = {
        "note": ("HUD chrome (`Hud`, symbol 3715) baked from the SWF export. "
                 "Plates are stage pixels at `scale`; child art is 1 px per "
                 "clip-local unit with its registration point at (ox, oy). "
                 "Placement matrices are Pixi order [a, b, c, d, tx, ty]."),
        "design": [R.DESIGN_W, R.DESIGN_H],
        "scale": SUPERSAMPLE,
        "states": {},
        "children": {},
        "bars": {},
        "scorebar": {},
        "icons": {},
        "flags": {},
        "bloody": {},
        "arrow": {},
        "head": {},
        "speak": {},
        "aimer": {},
        "song": {},
        "text": {},
    }

    all_text_cids = set()

    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=["--force-color-profile=srgb"])
        pg2 = b.new_page(viewport={"width": 1280, "height": 900},
                         device_scale_factor=R.BASE_DSF * SUPERSAMPLE)
        pg2.set_content(R.PAGE)
        pg1 = b.new_page(viewport={"width": 1280, "height": 900},
                         device_scale_factor=R.BASE_DSF)
        pg1.set_content(R.PAGE)
        pg4 = b.new_page(viewport={"width": 1280, "height": 900},
                         device_scale_factor=R.BASE_DSF * ICON_PX)
        pg4.set_content(R.PAGE)

        for state, frame in STATES:
            rel = PLATE_ALIAS.get(state) or bake_plate(pg2, state, frame,
                                                       plate_hides)
            manifest["states"][state] = {"frame": frame, "plate": rel}
            svg = open(S.frame_svgs(HUD_CID)[frame - 1], encoding="utf-8").read()
            all_text_cids |= text_cids_in(svg)
            print(f"plate {state:10} frame {frame:3} -> {rel}")

        for frame in (1, 8, 9, 101):
            for cid, m, cx, nm in placements(HUD_CID)[frame - 1].values():
                if not nm:
                    continue
                rec = {"m": matrix6_pixi(m)}
                if cx:
                    rec["cx"] = [list(cx[0]), list(cx[1])]
                manifest["children"][nm] = rec
        for name in ("bloodyscreen", "hud_bg", "mc_class", "mc_streak",
                     "mc_mode", "mc_streakarrow", "scorebar", "flag1", "flag2",
                     "flag3", "mc_speak"):
            if name not in manifest["children"]:
                raise SystemExit(f"frame 1 has no {name!r}")
        print(f"children: {len(manifest['children'])} named placements")

        manifest["bars"]["fill"] = bake_at_origin(pg1, 3576, 1, "bar_fill.png")
        bg = placements(HUD_BG)[0]
        for key, name in (("hp", "bar_hp"), ("ar", "bar_ar"),
                          ("ammo", "bar_ammo"), ("streak", "bar_streak")):
            rec = named(bg, name)
            add = rec["cx"][1] if rec["cx"] else [255, 255, 255, 0]
            manifest["bars"][key] = {
                "m": rec["m"],
                "color": (int(add[0]) << 16) | (int(add[1]) << 8) | int(add[2]),
            }
        print("bars:", ", ".join(sorted(k for k in manifest["bars"] if k != "fill")))

        sb = placements(SCOREBAR)[0]
        manifest["scorebar"]["row"] = bake_at_origin(
            pg1, SB_ROW, 1, "sb_row.png", hide_cids=[SB_BAR, SB_CAP])
        manifest["scorebar"]["bars"] = {
            str(f): bake_at_origin(pg1, SB_BAR, f, f"sb_bar{f}.png")
            for f in range(1, 5)
        }
        manifest["scorebar"]["cap"] = bake_at_origin(pg1, SB_CAP, 1, "sb_cap.png")
        manifest["scorebar"]["rowPlace"] = {
            "1": {"m": named(sb, "scorebar1")["m"]},
            "2": {"m": named(sb, "scorebar2")["m"]},
        }
        row_children = placements(SB_ROW)[0]
        manifest["scorebar"]["barPlace"] = {"m": named(row_children, "bar")["m"]}
        manifest["scorebar"]["capPlace"] = {"m": named(row_children, "cap")["m"]}
        for name in ("modetxt", "scoretxt1", "scoretxt2"):
            manifest["scorebar"][name] = {"m": named(sb, name)["m"]}
        print("scorebar: row + 4 bar frames + cap")

        rows = {}
        row_fields = {}
        for frame, label in L.parse(L.SWF, SCOREBAR_LIST):
            rel = f"sbar_{label}.png"
            rows[label] = dict(bake_at_origin(pg1, SCOREBAR_LIST, frame, rel,
                                              hide_cids={ICONS} | text_cids),
                               frame=frame)
            svg = open(S.frame_svgs(SCOREBAR_LIST)[frame - 1],
                       encoding="utf-8").read()
            fields = {}
            for m in re.finditer(r'<use\b[^>]*?id="(txt_\w+)"[^>]*?'
                                 r'transform="matrix\(([^)]*)\)"', svg):
                nums = [float(x) for x in re.findall(r"[-0-9.eE]+", m.group(2))]
                fields[m.group(1)] = {"x": nums[4], "y": nums[5]}
            row_fields[label] = fields
            all_text_cids |= text_cids_in(svg)
        manifest["scorebar"]["rows"] = rows
        manifest["scorebar"]["fields"] = row_fields
        icon_place = {}
        svg21 = open(S.frame_svgs(SCOREBAR_LIST)[20], encoding="utf-8").read()
        for m in re.finditer(r'<use\b[^>]*?id="(icon_\w+)"[^>]*?'
                             r'transform="matrix\(([^)]*)\)"', svg21):
            nums = [float(x) for x in re.findall(r"[-0-9.eE]+", m.group(2))]
            icon_place[m.group(1)] = {"x": nums[4], "y": nums[5]}
        manifest["scorebar"]["iconPlace"] = icon_place
        print(f"scorebar rows: {', '.join(rows)}")

        for frame, label in L.parse(L.SWF, ICONS):
            rel = f"icon_{label}.png"
            svg = glow_wrap(open(S.frame_svgs(ICONS)[frame - 1],
                                 encoding="utf-8").read())
            manifest["icons"][label] = dict(
                bake_at_origin(pg4, ICONS, frame, rel, svg_text=svg),
                frame=frame, px=ICON_PX)
        print(f"icons: {len(manifest['icons'])}")

        letter_cids = text_cids_in(open(S.frame_svgs(FLAGS)[0],
                                        encoding="utf-8").read())
        for f in range(1, 16):
            manifest["flags"][str(f)] = bake_at_origin(
                pg1, FLAGS, f, f"flag_{f}.png", hide_cids=letter_cids)
        all_text_cids |= letter_cids
        print("flags: 15")

        head_parts = [HEAD_PORTRAIT, ICONS, HEAD_BT, HEAD_SEL, HEAD_NEW]
        head_text = text_cids_in(open(S.frame_svgs(HEAD)[0],
                                      encoding="utf-8").read())
        manifest["head"]["plates"] = [
            bake_at_origin(pg1, HEAD, f, f"head_{f}.png",
                           hide_cids=head_parts + sorted(head_text))
            for f in range(1, 5)
        ]
        manifest["head"]["selected"] = bake_at_origin(
            pg1, HEAD_SEL, 1, "head_selected.png")
        head_kids = placements(HEAD)[0]
        manifest["head"]["place"] = {
            nm: {"m": named(head_kids, nm)["m"]}
            for nm in ("head", "mc_class", "selected", "bt")
        }
        manifest["head"]["slots"] = [
            manifest["children"][f"head{i}"]["m"] for i in range(5)
        ]
        manifest["head"]["select"] = dict(
            bake_button(pg1, SELECT_BT, "head_select"),
            m=manifest["children"]["bt_select"]["m"])
        all_text_cids |= head_text
        print("heads: 4 band plates + ring + bt_select")

        manifest["bloody"]["frames"] = {
            "1": bake_at_origin(pg1, BLOODY, 1, "bloody_1.png"),
            "2": bake_at_origin(pg1, BLOODY, 2, "bloody_2.png"),
        }
        manifest["bloody"]["place"] = manifest["children"]["bloodyscreen"]["m"]

        arrow = manifest["children"]["mc_streakarrow"]
        manifest["arrow"] = dict(bake_at_origin(pg1, ARROW, 1, "arrow.png"),
                                 m=arrow["m"],
                                 color=((int(arrow["cx"][1][0]) << 16)
                                        | (int(arrow["cx"][1][1]) << 8)
                                        | int(arrow["cx"][1][2])),
                                 alpha=arrow["cx"][0][3])

        speak16 = placements(SPEAK)[15]
        manifest["speak"]["closed"] = bake_at_origin(
            pg1, SPEAK, 1, "speak_closed.png", hide_cids={1923} | text_cids)
        manifest["speak"]["open"] = bake_at_origin(
            pg1, SPEAK, 16, "speak_open.png",
            hide_cids={1923} | text_cids)
        manifest["speak"]["head"] = {"m": named(speak16, "head")["m"]}
        svg16 = open(S.frame_svgs(SPEAK)[15], encoding="utf-8").read()
        mask = re.search(r'<clipPath id="clipPath0">\s*<path d="([^"]+)"', svg16)
        pts = [float(x) for x in re.findall(r"[-0-9.eE]+", mask.group(1))]
        manifest["speak"]["mask"] = [[pts[i], pts[i + 1]]
                                     for i in range(0, len(pts) - 1, 2)]
        for name in ("txt_name", "txt_desc"):
            m = re.search(rf'<use\b[^>]*?id="{name}"[^>]*?'
                          r'transform="matrix\(([^)]*)\)"', svg16)
            nums = [float(x) for x in re.findall(r"[-0-9.eE]+", m.group(1))]
            manifest["speak"][name] = {"x": nums[4], "y": nums[5]}
        all_text_cids |= text_cids_in(svg16)

        aim = placements(AIMER)[0]
        manifest["aimer"]["line"] = bake_at_origin(pg1, AIMER_LINE, 1,
                                                   "aimer_line.png")
        manifest["aimer"]["circle"] = bake_at_origin(pg1, AIMER_CIRCLE, 1,
                                                     "aimer_circle.png")
        manifest["aimer"]["lines"] = {name: {"m": named(aim, name)["m"]}
                                      for name in ("line1", "line2", "line3", "line4")}
        manifest["aimer"]["circlePlace"] = {"m": named(aim, "circle")["m"]}

        manifest["song"] = dict(
            bake_button(pg1, SONG_BT, "song"),
            m=manifest["children"]["prevSong"]["m"],
            mNext=manifest["children"]["nextSong"]["m"])
        print("splatter, arrow, speak, aimer, song")

        b.close()

    manifest["text"] = text_specs(all_text_cids)
    print(f"text fields: {len(manifest['text'])}")

    with open(OUT_JSON, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=1)
    files = [f for f in os.listdir(OUT_IMG) if f.endswith(".png")]
    size = sum(os.path.getsize(os.path.join(OUT_IMG, f)) for f in files)
    print(f"wrote {OUT_JSON}")
    print(f"{len(files)} PNGs in {OUT_IMG} ({size // 1024} KB)")


if __name__ == "__main__":
    main()
