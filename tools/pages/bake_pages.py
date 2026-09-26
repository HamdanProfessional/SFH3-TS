#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import svgraster as R
import swfio as S
import swftext as T
import swflabels as SL
import uibake as U

REPO = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT_IMG = os.path.join(REPO, "public", "ui", "pages")
OUT_JSON = os.path.join(REPO, "src", "assets", "pagesUi.json")

SCALE = U.SUPERSAMPLE
PLATE_W = U.PLATE_W
PLATE_X = U.PLATE_X

TILE_CID = 2855
ICON_CID = 2849
BAR_CID = 2057
LOGO_CID = 43
APP_BUTTON_CID = 2693

TILE_FIELDS = {"txt_name": 2850, "txt_desc": 2851, "txt_unlock": 2853}

MAT = re.compile(r"matrix\(([^)]*)\)")
NUM = r"[-0-9.eE]+"


def svg_size(svg: str):
    m = re.search(r'<svg[^>]*?height="([\d.]+)px"[^>]*?width="([\d.]+)px"', svg)
    return float(m.group(2)), float(m.group(1))


def frame_items():
    with open(os.path.join(REPO, "src", "assets", "menuFrames.json"),
              encoding="utf-8") as fh:
        return json.load(fh)


def child_sel(i: int) -> str:
    return f'#host > svg > g > *:nth-child({i + 1})'


def plate_hidden(items, edit_cids):
    out = []
    for it in items:
        name = it["name"] or ""
        if (it["cid"] in edit_cids or os.path.isdir(U.button_dir(it["cid"]))
                or name in U.EXCLUDE_ALWAYS):
            out.append(it["child"])
    return out


def sprite_dir(cid: int) -> str:
    import glob
    hits = glob.glob(os.path.join(S.SPRITES, f"DefineSprite_{cid}_*")) \
        + glob.glob(os.path.join(S.SPRITES, f"DefineSprite_{cid}"))
    if not hits:
        raise FileNotFoundError(f"no sprite dir for {cid}")
    return hits[0]


def bake_sprite_frame(pg, cid: int, frame: int, rel: str, hide_cids=()):
    path = os.path.join(sprite_dir(cid), f"{frame}.svg")
    svg = U.fix_glyph_text(open(path, encoding="utf-8").read())
    w, h = svg_size(svg)
    ox, oy = R.stage_origin(svg)
    R.render(pg, svg, os.path.join(OUT_IMG, rel), rect=(0, 0, w, h),
             hide_cids=list(hide_cids))
    return {"file": f"pages/{rel}", "w": round(w * SCALE, 2), "h": round(h * SCALE, 2),
            "ox": round(ox * SCALE, 2), "oy": round(oy * SCALE, 2)}


def sprite_dir(cid: int) -> str:
    import glob
    hits = glob.glob(os.path.join(S.SPRITES, f"DefineSprite_{cid}_*")) \
        + glob.glob(os.path.join(S.SPRITES, f"DefineSprite_{cid}"))
    if not hits:
        raise FileNotFoundError(f"no sprite dir for {cid}")
    return hits[0]


TEXT_ENTITY = {"&apos;": "'", "&quot;": '"', "&amp;": "&", "&lt;": "<", "&gt;": ">"}


def field_records(cid: int):
    path = os.path.join(S.DECOMP, "texts", f"{cid}.txt")
    if not os.path.isfile(path):
        return []
    raw = open(path, encoding="utf-8").read().replace("\r\n", "\n")
    out = []
    for rec in raw.split("--- RECORDSEPARATOR ---"):
        for k, v in TEXT_ENTITY.items():
            rec = rec.replace(k, v)
        if rec.startswith("\n"):
            rec = rec[1:]
        if rec.endswith("\n"):
            rec = rec[:-1]
        out.append(rec)
    return out

GLYPH_RE = re.compile(r"<use[^>]*/>")
GLYPH_FONT = re.compile(r"^(.+)_(.)(\d+)$")
LINE_G = re.compile(r'<g transform="matrix\(([^)]*)\)">(.*?)</g>', re.S)


def _line_glyphs(body: str, dx: float):
    out = []
    for u in GLYPH_RE.findall(body):
        href = re.search(r'href="#font_([^"]+)"', u)
        if not href:
            continue
        m = GLYPH_FONT.match(href.group(1))
        if not m:
            continue
        fam, ch, _idx = m.groups()
        tm = re.search(r"matrix\(([^)]*)\)", u)
        if not tm:
            continue
        nums = [float(x) for x in re.findall(NUM, tm.group(1))]
        fill = re.search(r'fill="([^"]+)"', u)
        op = re.search(r'fill-opacity="([^"]+)"', u)
        out.append({
            "fam": fam, "ch": ch, "scale": round(nums[0], 6),
            "x": nums[4] + dx, "y": nums[5],
            "fill": fill.group(1) if fill else "#ffffff",
            "op": float(op.group(1)) if op else 1.0,
        })
    return out


def _field_lines(block: str):
    lines = []
    for m in LINE_G.finditer(block):
        nums = [float(v) for v in re.findall(NUM, m.group(1))]
        glyphs = _line_glyphs(m.group(2), nums[4])
        if glyphs:
            lines.append(glyphs)
    if lines:
        return lines
    glyphs = _line_glyphs(block, 0.0)
    return [glyphs] if glyphs else []


def _text_blocks(svg: str):
    return re.findall(
        r'<g id="text\d+">.*?</g>\s*(?=<g id="|</defs>)', svg, re.S)


def _block_for(svg: str, name: str) -> str:
    i = svg.find(f'<g id="{name}">')
    if i < 0:
        return ""
    end = len(svg)
    m = re.search(r'<g id="(?:text\d+|shape\d+|sprite\d+)">', svg[i + 1:])
    if m:
        end = i + 1 + m.start()
    else:
        j = svg.find("</defs>", i)
        end = j if j > 0 else end
    return svg[i:end]


FIELD_USE = re.compile(r'<use[^>]*characterId="(\d+)"[^>]*xlink:href="#(text\d+)"')


def field_blocks(svg: str):
    out = {}
    for m in FIELD_USE.finditer(svg):
        out[int(m.group(1))] = _block_for(svg, m.group(2))
    return out


def field_placements(frame):
    return {it["cid"]: (it["x"], it["y"]) for it in frame["items"]
            if it["text"]}


def _start(g, style):
    return {"style": style, "x": g["x"], "y": g["y"], "text": g["ch"],
            "pen": [], "last_x": g["x"]}


def _extend(cur, g, ch):
    cur["pen"].append((cur["text"][-1], round(g["x"] - cur["last_x"], 4)))
    cur["text"] += ch
    cur["last_x"] = g["x"]


def static_runs(block: str, cid: int, place):
    lines = _field_lines(block)
    records = field_records(cid)

    runs = []
    if len(records) == len(lines):
        for rec, line in zip(records, lines):
            chars = [c for c in rec if c != " "]
            if len(chars) != len(line):
                runs.append(("MISMATCH", rec, line))
                continue
            cur = None
            gi = 0
            for ch in rec:
                if ch == " ":
                    if cur:
                        runs.append(cur)
                        cur = None
                    continue
                g = line[gi]
                gi += 1
                style = (g["fam"], g["scale"], g["fill"], g["op"])
                if cur is not None and cur["style"] == style:
                    _extend(cur, g, ch)
                else:
                    if cur:
                        runs.append(cur)
                    cur = _start(g, style)
                    cur["text"] = ch
            if cur:
                runs.append(cur)
    if any(isinstance(r, tuple) for r in runs) or not runs:
        runs = []
        for line in lines:
            cur = None
            for g in line:
                style = (g["fam"], g["scale"], g["fill"], g["op"])
                if cur is not None and cur["style"] == style:
                    _extend(cur, g, g["ch"])
                else:
                    if cur:
                        runs.append(cur)
                    cur = _start(g, style)
            if cur:
                runs.append(cur)

    for r in runs:
        r["x"] = round(r["x"] + place[0], 2)
        r["y"] = round(r["y"] + place[1], 2)
    return [r for r in runs if isinstance(r, dict)]


MEASURE = """async (cases) => {
  const c = document.createElement('canvas').getContext('2d');
  const out = [];
  for (const [font, chars] of cases) {
    await document.fonts.load(`100px "${font}"`);
    const ok = document.fonts.check(`100px "${font}"`);
    c.font = `100px "${font}"`;
    out.push({ok, w: chars.map((ch) => c.measureText(ch).width)});
  }
  return out;
}"""

SIZE_TOL = 0.08


def calibrate_sizes(pg, runs):
    swf = {}
    for r in runs:
        fam, scale = r["style"][0], r["style"][1]
        for ch, adv in r["pen"]:
            swf.setdefault((fam, scale), {}).setdefault(ch, []).append(adv)

    keys = sorted(swf)
    chars = [sorted(swf[k]) for k in keys]
    got = pg.evaluate(MEASURE, [[k[0], cs] for k, cs in zip(keys, chars)])

    sizes = {}
    for key, cs, res in zip(keys, chars, got):
        if not res["ok"]:
            raise SystemExit(f"font {key[0]!r} is not loadable in the bake page "
                             f"-- public/fonts/{key[0]}.ttf missing?")
        widths = res["w"]
        num = den = 0.0
        for ch, w100 in zip(cs, widths):
            n = len(swf[key][ch])
            num += sum(swf[key][ch])
            den += w100 / 100 * n
        if den <= 0:
            continue
        size = num / den
        snapped = round(size)
        if abs(size - snapped) > SIZE_TOL or snapped <= 0:
            print(f"  !! {key[0]} @ scale {key[1]}: measured {size:.3f}, "
                  f"not a whole point size -- keeping it as measured")
            sizes[key] = round(size, 2)
        else:
            sizes[key] = float(snapped)
        print(f"  size {key[0]:<28} scale {key[1]:<8} "
              f"ffdec {key[1] * 1000:6.2f} -> {sizes[key]}")
    return sizes


def emit_runs(runs, sizes):
    out = []
    for r in runs:
        fam, scale, fill, op = r["style"]
        out.append([r["x"], r["y"], sizes.get((fam, scale), round(scale * 1000, 2)),
                    fam, fill, op, r["text"]])
    return out


def named_use_positions(path: str):
    import xml.etree.ElementTree as ET

    def parse_matrix(tag):
        m = MAT.search(tag or "")
        if not m:
            return [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]
        return [float(x) for x in re.findall(NUM, m.group(1))]

    def mul(inner, outer):
        a, b, c, d, e, f = inner
        A, B, C, D, E, F = outer
        return [A * a + C * b, B * a + D * b, A * c + C * d, B * c + D * d,
                A * e + C * f + E, B * e + D * f + F]

    tree = ET.parse(path)
    root = next(c for c in tree.getroot() if c.tag.endswith("}g"))
    found = {}

    def walk(el, m):
        for c in el:
            cm = mul(parse_matrix(c.get("transform")), m)
            name = c.get("id")
            if name and name not in found:
                found[name] = cm
            walk(c, cm)

    walk(root, [1.0, 0.0, 0.0, 1.0, 0.0, 0.0])
    return found


def bake_button(pg, cid: int, done):
    return U.bake_button(pg, cid, done)


def main():
    os.makedirs(OUT_IMG, exist_ok=True)
    frames = frame_items()
    edits = T.parse()
    text_specs = {str(cid): edits[cid] for cid in TILE_FIELDS.values()}
    out = {"scale": SCALE, "credits": {}, "medals": {}, "app": {}}

    raw = {label: open(R.menu_frame_path(frames[label]["frame"]),
                       encoding="utf-8").read()
           for label in ("tips", "credits")}

    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        b, pg = R.open_page(pw, supersample=SCALE)
        done_buttons = {}

        fr = frames["credits"]
        svg = U.fix_glyph_text(raw["credits"])
        ox, oy = R.stage_origin(svg)
        place = field_placements(fr)
        content = [it["cid"] for it in fr["items"]
                   if it["text"] and it["name"] not in ("txt_funds", "txt_day")]
        hide = plate_hidden(fr["items"], edits)
        R.render(pg, svg, os.path.join(OUT_IMG, "plate_credits.png"),
                 rect=(ox + PLATE_X / 2, oy, PLATE_W / 2, R.DESIGN_H / 2),
                 hide=[child_sel(i) for i in hide],
                 hide_cids=sorted(edits) + [LOGO_CID] + content)
        blocks = field_blocks(raw["credits"])
        raw_runs = {"credits": {str(cid): static_runs(blocks[cid], cid, place[cid])
                                for cid in content
                                if cid in blocks and cid in place}}
        out["credits"] = {
            "plate": "pages/plate_credits.png",
            "plateX": PLATE_X, "plateY": 0, "plateW": PLATE_W, "plateH": R.DESIGN_H,
        }
        for name, item in [("logo1", 0), ("logo2", 1)]:
            rec = [i for i in fr["items"] if i["name"] == name]
            if rec:
                out["credits"][name] = {"x": rec[0]["x"], "y": rec[0]["y"]}
        out["credits"]["logo"] = {
            "armor": bake_sprite_frame(pg, LOGO_CID, 1, "logo_armor.png"),
            "notdoppler": bake_sprite_frame(pg, LOGO_CID, 2, "logo_notdoppler.png"),
        }

        fr = frames["tips"]
        svg = U.fix_glyph_text(raw["tips"])
        ox, oy = R.stage_origin(svg)
        place = field_placements(fr)
        content = [it["cid"] for it in fr["items"]
                   if it["text"] and it["name"] not in ("txt_funds", "txt_day")]
        hide = plate_hidden(fr["items"], edits)
        R.render(pg, svg, os.path.join(OUT_IMG, "plate_tips.png"),
                 rect=(ox + PLATE_X / 2, oy, PLATE_W / 2, R.DESIGN_H / 2),
                 hide=[child_sel(i) for i in hide],
                 hide_cids=sorted(edits) + content)
        blocks = field_blocks(raw["tips"])
        raw_runs["tips"] = {str(cid): static_runs(blocks[cid], cid, place[cid])
                            for cid in content if cid in blocks and cid in place}
        out["tips"] = {
            "plate": "pages/plate_tips.png",
            "plateX": PLATE_X, "plateY": 0, "plateW": PLATE_W, "plateH": R.DESIGN_H,
        }

        flat = [r for page in raw_runs.values() for rs in page.values() for r in rs]
        sizes = calibrate_sizes(pg, flat)
        for label, page in raw_runs.items():
            out[label]["runs"] = {cid: emit_runs(rs, sizes)
                                  for cid, rs in page.items()}

        fr = frames["medals"]
        svg = U.fix_glyph_text(open(R.menu_frame_path(fr["frame"]),
                                    encoding="utf-8").read())
        ox, oy = R.stage_origin(svg)
        hide = plate_hidden(fr["items"], edits)
        R.render(pg, svg, os.path.join(OUT_IMG, "plate_medals.png"),
                 rect=(ox + PLATE_X / 2, oy, PLATE_W / 2, R.DESIGN_H / 2),
                 hide=[child_sel(i) for i in hide], hide_cids=sorted(edits) + [TILE_CID])
        out["medals"] = {
            "plate": "pages/plate_medals.png",
            "plateX": PLATE_X, "plateY": 0, "plateW": PLATE_W, "plateH": R.DESIGN_H,
        }

        tile_hide = sorted(TILE_FIELDS.values()) + [ICON_CID, BAR_CID]
        out["medals"]["tile"] = {
            "earned": bake_sprite_frame(pg, TILE_CID, 1, "tile_earned.png",
                                        hide_cids=tile_hide),
            "locked": bake_sprite_frame(pg, TILE_CID, 2, "tile_locked.png",
                                        hide_cids=tile_hide),
        }
        out["medals"]["bar"] = bake_sprite_frame(pg, BAR_CID, 1, "tile_bar.png")

        tile_pos = named_use_positions(
            os.path.join(sprite_dir(TILE_CID), "1.svg"))
        fields = {}
        for name, cid in TILE_FIELDS.items():
            m = tile_pos[name]
            fields[name] = {"x": round(m[4], 2), "y": round(m[5], 2), "spec": text_specs[str(cid)]}
        for name in ("icon", "mc_backbar", "mc_bar"):
            m = tile_pos[name]
            fields[name] = {"x": round(m[4], 2), "y": round(m[5], 2),
                            "sx": round(m[0], 4), "sy": round(m[3], 4)}
        out["medals"]["fields"] = fields

        labels = SL.parse(SL.SWF, ICON_CID)
        labels.sort()
        icons = {}
        for frame, label in labels:
            icons[label] = bake_sprite_frame(pg, ICON_CID, frame, f"icon_{label}.png")
        if len(icons) != 21:
            print(f"  !! expected 21 icons, got {len(icons)}")
        out["medals"]["icon"] = icons

        tiles = {}
        for it in fr["items"]:
            if (it["name"] or "").startswith("ach"):
                tiles[it["name"]] = {"x": it["x"], "y": it["y"]}
        out["medals"]["tiles"] = tiles

        app = bake_button(pg, APP_BUTTON_CID, done_buttons)
        fr = frames["missions"]
        for it in fr["items"]:
            if it["name"] == "bt_app":
                out["app"] = {"cid": APP_BUTTON_CID, "x": it["x"], "y": it["y"],
                              "w": it["w"], "h": it["h"], **app}
        b.close()

    with open(OUT_JSON, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1)
    print("wrote", OUT_JSON)
    print("images in", OUT_IMG)


if __name__ == "__main__":
    main()
