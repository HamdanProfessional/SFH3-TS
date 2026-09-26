#!/usr/bin/env python3
import json
import math
import os
import re
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import swfio as S
import svgraster as R
import swftext as T

OUT_IMG = os.path.normpath(os.path.join(S.SC, "..", "public", "ui"))
OUT_JSON = os.path.normpath(os.path.join(S.SC, "..", "src", "assets", "menuUi.json"))
EXTRAS_JSON = os.path.normpath(os.path.join(S.SC, "..", "src", "assets", "menuExtras.json"))
BUTTONS = os.path.join(S.DECOMP, "buttons")

LOGO_CID = 2485
TUTORIAL_CID = 2561

SUPERSAMPLE = 2

PLATE_W = R.DESIGN_W
PLATE_X = 0.0

BG_CID = 2430
BG_TILES = 6
BG_Y, BG_H = 0.0, R.DESIGN_H

ROOT_G = re.compile(
    r'<g transform="matrix\(0\.5, 0\.0, 0\.0, 0\.5, (-?[\d.]+), (-?[\d.]+)\)">')


OVERLAYS = {
    "getitem",
    "tutorial",
    "hover",
    "slotmachine",
    "confirm",
}

DEBUG_BUTTONS = {"bt_new", "bt_money", "bt_unlock", "bt_reset", "bt_day"}

SPONSOR = {"_logo1", "_logo2", "bt_app", "bt_akq", "bt_akqboth", "bt_akqhero"}

BACKDROP = {"bg"}

EXCLUDE_ALWAYS = OVERLAYS | DEBUG_BUTTONS | SPONSOR | BACKDROP

EXCLUDE_BY_FRAME = {
    "missions": {"scrollbox", "mc_daily"},
    "inventory": {"cont"},
    "heroesInv": {"cont"},
    "workshopInv": {"cont"},
    "workshop": {"weapon", "upgradebox", "upgradedisplay", "scrollpane"},
    "deploy": {"mc_squadcode"},
}

HIDE_CIDS_BY_FRAME = {
    "missions": {2163, 2167},
    "deploy": {2090, 2777, 2080, 2473},
    "heroes": {2090, 2470, 2447, 2435, 2473},
}


def is_button(item):
    return os.path.isdir(button_dir(item["cid"]))


def button_dir(cid):
    return os.path.join(BUTTONS, f"DefineButton2_{cid}")


CHROME_CIDS = (2474, 2476)


def chrome_bands(pg, svg, items, ox, oy):
    from PIL import Image

    tmp = os.path.join(OUT_IMG, "_chrome.png")
    R.render(pg, svg, tmp, rect=(ox, oy, R.DESIGN_W / 2, R.DESIGN_H / 2),
             hide=[child_sel(i["child"]) for i in items
                   if i["cid"] not in CHROME_CIDS])
    im = Image.open(tmp).convert("RGBA")
    ppd = im.height / R.DESIGN_H
    px = im.load()
    bands, run = [], None
    for y in range(im.height):
        lit = any(px[x, y][3] > 16 for x in (1, im.width // 2, im.width - 2))
        if lit and run is None:
            run = y
        elif not lit and run is not None:
            bands.append([round(run / ppd, 2), round((y - run) / ppd, 2)])
            run = None
    if run is not None:
        bands.append([round(run / ppd, 2), round((im.height - run) / ppd, 2)])
    im.close()
    os.remove(tmp)
    return [b for b in bands if b[1] > 1]


def vignette_of(items):
    for it in items:
        if (it["order"] == 1 and not it["name"]
                and it["w"] >= 780 and it["h"] >= 580):
            return it
    return None


def plate_hidden(items, edit_cids, extra=()):
    out = []
    for it in items:
        name = it["name"] or ""
        if (it["cid"] in edit_cids or is_button(it)
                or name in EXCLUDE_ALWAYS or name in extra):
            out.append(it["child"])
    return out


def strip_rooms(full, ppd, left, min_w=400.0, dark=3):
    from PIL import Image

    line = full.convert("RGB").resize((full.width, 1), Image.BOX).load()
    runs, start = [], None
    for x in range(full.width):
        lit = max(line[x, 0]) > dark
        if lit and start is None:
            start = x
        elif not lit and start is not None:
            runs.append((start, x))
            start = None
    if start is not None:
        runs.append((start, full.width))
    return [{"x": round(left + a / ppd, 2), "w": round((b - a) / ppd, 2)}
            for a, b in runs if (b - a) / ppd >= min_w]


def bake_bg(pg, frames):
    from PIL import Image

    fr = frames["missions"]
    bg = next(i for i in fr["items"] if i["cid"] == BG_CID)
    svg = fix_glyph_text(
        open(R.menu_frame_path(fr["frame"]), encoding="utf-8").read())
    ox, oy = R.stage_origin(svg)
    hide = [child_sel(i["child"]) for i in fr["items"]
            if i["child"] != bg["child"]]

    n = BG_TILES * 2
    step = math.ceil(2 * bg["w"] / n)
    x0 = math.floor(bg["x"] - bg["w"])
    scratch = []
    for i in range(n):
        p = os.path.join(OUT_IMG, f"_bgtmp{i}.png")
        R.render(pg, svg, p,
                 rect=(ox + (x0 + i * step) / 2, oy + BG_Y / 2,
                       step / 2, BG_H / 2), hide=hide)
        scratch.append(p)

    parts = [Image.open(p).convert("RGBA") for p in scratch]
    tw, th = parts[0].size
    full = Image.new("RGBA", (tw * n, th))
    for i, part in enumerate(parts):
        full.paste(part, (i * tw, 0))
        part.close()
    for p in scratch:
        os.remove(p)

    box = full.getbbox()
    if not box:
        raise SystemExit("bg: the strip rendered empty")
    full = full.crop((box[0], 0, box[2], th))
    ppd = tw / step
    left = x0 + box[0] / ppd - bg["x"]

    out = {"x": round(left, 2), "y": BG_Y,
           "w": round(full.width / ppd, 2), "h": BG_H,
           "rooms": strip_rooms(full, ppd, left), "tiles": []}
    per = math.ceil(full.width / BG_TILES)
    for i in range(BG_TILES):
        a, b = i * per, min(full.width, (i + 1) * per)
        if a >= b:
            break
        rel = f"bg_{i}.png"
        full.crop((a, 0, b, th)).save(os.path.join(OUT_IMG, rel))
        out["tiles"].append({"file": rel, "x": round(left + a / ppd, 2),
                             "w": round((b - a) / ppd, 2)})
    full.close()
    print(f"bg           {len(out['tiles'])} tiles, "
          f"local x {out['x']} w {out['w']}, "
          f"{len(out['rooms'])} rooms "
          + " ".join(f"{r['x']:.0f}+{r['w']:.0f}" for r in out["rooms"]))
    return out


STATES = (("up", "1_up.svg"), ("over", "2_over.svg"), ("down", "3_down.svg"))


def bake_button(pg, cid, done):
    if cid in done:
        return done[cid]

    d = button_dir(cid)
    entry = {"states": {}}
    for state, fname in STATES:
        path = os.path.join(d, fname)
        if not os.path.isfile(path):
            continue
        with open(path, encoding="utf-8") as fh:
            svg = fix_glyph_text(fh.read())
        m = ROOT_G.search(svg)
        if not m:
            print(f"  !! button {cid}/{state}: no root group")
            continue
        ox, oy = float(m.group(1)), float(m.group(2))
        w, h = svg_size(svg)
        out = f"btn_{cid}_{state}.png"
        R.render(pg, svg, os.path.join(OUT_IMG, out), rect=(0, 0, w, h))
        entry["states"][state] = out
        entry.update({
            "offX": round(-ox * 2, 2), "offY": round(-oy * 2, 2),
            "w": round(w * 2, 2), "h": round(h * 2, 2),
        })
    done[cid] = entry
    return entry


SIZE_RE = re.compile(r'<svg[^>]*?height="([\d.]+)px"[^>]*?width="([\d.]+)px"')


def svg_size(svg):
    m = SIZE_RE.search(svg)
    if not m:
        raise ValueError("no svg size")
    return float(m.group(2)), float(m.group(1))


def child_sel(i):
    return f'#host > svg > g > *:nth-child({i + 1})'


FONT_USE = re.compile(r'<use\b([^>]*?)/>')
FONT_HREF = re.compile(r'href="#font_([^"]+)"')
FONT_ID = re.compile(r"^(.*)_(.)(\d+)$")


def _text_from_use(attrs):
    href = FONT_HREF.search(attrs)
    if not href:
        return None
    m = FONT_ID.match(href.group(1))
    if not m:
        return None
    family, ch, _idx = m.groups()
    tm = re.search(r'transform="matrix\(([^)]*)\)"', attrs)
    nums = [float(x) for x in re.findall(r"[-0-9.eE]+", tm.group(1))] if tm else [1, 0, 0, 1, 0, 0]
    scale, tx, ty = nums[0], nums[4], nums[5]
    size = round(scale * 1000, 3)
    out = [f'x="{tx}" y="{ty}" font-family="{family}" font-size="{size}"']
    fill = re.search(r'fill="([^"]+)"', attrs)
    if fill:
        out.append(f'fill="{fill.group(1)}"')
    opacity = re.search(r'fill-opacity="([^"]+)"', attrs)
    if opacity:
        out.append(f'fill-opacity="{opacity.group(1)}"')
    esc = ch.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return f'<text {" ".join(out)}>{esc}</text>'


def fix_glyph_text(svg):
    def repl(m):
        t = _text_from_use(m.group(1))
        return t if t is not None else m.group(0)
    return FONT_USE.sub(repl, svg)


def bake_extras(pg, text_cids=()):
    from playwright.sync_api import sync_playwright
    out = {"logos": {}, "tutorials": {}, "deploy": {}}

    def one(cid, frame, rel, hide_cids=()):
        import glob as _glob
        d = _glob.glob(os.path.join(S.SPRITES, f"DefineSprite_{cid}*"))[0]
        path = os.path.join(d, f"{frame}.svg")
        svg = fix_glyph_text(open(path, encoding="utf-8").read())
        ox, oy = R.stage_origin(svg)
        w, h = svg_size(svg)
        R.render(pg, svg, os.path.join(OUT_IMG, rel), rect=(0, 0, w, h),
                 hide_cids=[str(c) for c in hide_cids])
        return {"file": rel, "w": round(w * 2, 2), "h": round(h * 2, 2),
                "ox": round(ox * 2, 2), "oy": round(oy * 2, 2)}

    out["logos"]["armor"] = one(LOGO_CID, 1, "logo_armor.png")
    out["logos"]["notdoppler"] = one(LOGO_CID, 2, "logo_notdoppler.png")
    for frame in range(1, 7):
        out["tutorials"][str(frame)] = one(TUTORIAL_CID, frame, f"tut_{frame}.png")
    out["deploy"]["squadcode"] = one(2786, 1, "deploy_squadcode.png",
                                     hide_cids=text_cids)
    with open(EXTRAS_JSON, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1)
    print(f"extras: {len(out['logos'])} logos, {len(out['tutorials'])} tutorials")
    return out


def main():
    os.makedirs(OUT_IMG, exist_ok=True)
    with open(os.path.join(S.SC, "..", "src", "assets", "menuFrames.json"),
              encoding="utf-8") as fh:
        frames = json.load(fh)

    edits = T.parse()
    all_text_cids = sorted(edits)

    wanted = sys.argv[1:] or sorted(frames)
    manifest = {"design": [R.DESIGN_W, R.DESIGN_H],
                "scale": SUPERSAMPLE, "buttons": {}, "text": {}, "frames": {}}

    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        b, pg = R.open_page(pw, supersample=SUPERSAMPLE)
        done = {}
        vigs = set()
        bake_extras(pg, sorted(edits))
        manifest["bg"] = bake_bg(pg, frames)

        for label in wanted:
            fr = frames.get(label)
            if not fr:
                print(f"!! unknown frame {label!r}")
                continue
            with open(R.menu_frame_path(fr["frame"]), encoding="utf-8") as fh:
                svg = fix_glyph_text(fh.read())

            extra = EXCLUDE_BY_FRAME.get(label, ())
            hide = plate_hidden(fr["items"], edits, extra)
            hide_cids = all_text_cids + sorted(HIDE_CIDS_BY_FRAME.get(label, ()))
            ox, oy = R.stage_origin(svg)

            if "chrome" not in manifest:
                manifest["chrome"] = chrome_bands(pg, svg, fr["items"], ox, oy)
                print(f"chrome       bands {manifest['chrome']}")

            vig = vignette_of(fr["items"])
            vig_file = None
            if vig:
                hide.append(vig["child"])
                vig_file = f"vig_{vig['cid']}.png"
                if vig_file not in vigs:
                    vigs.add(vig_file)
                    R.render(pg, svg, os.path.join(OUT_IMG, vig_file),
                             rect=(ox, oy, R.DESIGN_W / 2, R.DESIGN_H / 2),
                             hide=[child_sel(i["child"]) for i in fr["items"]
                                   if i["child"] != vig["child"]])
            plate_path = os.path.join(OUT_IMG, f"plate_{label}.png")
            R.render(pg, svg, plate_path,
                     rect=(ox + PLATE_X / 2, oy, PLATE_W / 2, R.DESIGN_H / 2),
                     hide=[child_sel(i) for i in hide],
                     hide_cids=hide_cids)

            live = []
            for it in fr["items"]:
                name = it["name"] or ""
                if name in EXCLUDE_ALWAYS:
                    continue
                kind = ("button" if is_button(it)
                        else "text" if it["cid"] in edits else None)
                if kind is None:
                    continue
                rec = {"name": name or f"cid{it['cid']}", "cid": it["cid"],
                       "kind": kind, "x": it["x"], "y": it["y"],
                       "w": it["w"], "h": it["h"],
                       "sx": it.get("sx", 1.0), "sy": it.get("sy", 1.0),
                       "order": it["order"]}
                if kind == "button":
                    manifest["buttons"][str(it["cid"])] = bake_button(
                        pg, it["cid"], done)
                else:
                    manifest["text"][str(it["cid"])] = edits[it["cid"]]
                live.append(rec)

            manifest["frames"][label] = {
                "frame": fr["frame"],
                "plate": f"plate_{label}.png",
                "plateX": PLATE_X, "plateY": 0,
                "plateW": PLATE_W, "plateH": R.DESIGN_H,
                "bgSpot": fr.get("bgSpot"),
                "bgX": fr.get("bgRestX"),
                "vignette": vig_file,
                "items": live,
            }
            nb = sum(1 for i in live if i["kind"] == "button")
            print(f"{label:12} plate + {nb:2} buttons, {len(live) - nb:2} text")

        b.close()

    if len(wanted) < len(frames):
        print(f"!! partial bake: manifest holds {len(wanted)} of {len(frames)} "
              f"frames — re-run without frame arguments to restore the rest")
    with open(OUT_JSON, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=1)
    print("wrote", OUT_JSON)
    print("images in", OUT_IMG,
          f"({len(os.listdir(OUT_IMG))} files, "
          f"{sum(os.path.getsize(os.path.join(OUT_IMG, f)) for f in os.listdir(OUT_IMG)) // 1024} KB)")


if __name__ == "__main__":
    main()
