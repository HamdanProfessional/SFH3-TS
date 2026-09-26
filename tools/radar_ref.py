#!/usr/bin/env python3

import base64
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "fx"))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "maps"))

import numpy as np
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

import arena_dump as AD
import bake_bh as B
import swfio as S
from devurl import goto_menu

REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
SHOTS = os.path.join(REPO, "shots")
RIG = os.path.join(REPO, "src", "assets", "fxRig.json")
FX = os.path.join(REPO, "public", "assets", "fx")

K = 2

VIEW_W, VIEW_H = 160, 120
SCALE = 0.1
PANEL = (0.05, -0.8, 153.9, 124.0)
CONT = (1.75, -0.05)
PANEL_ALPHA = 38 / 255
WHITEN_ALPHA = 179 / 256

BW = int(5.4 * 7.213104248046875)
BH = int(5.4 * 4.0833587646484375)
MC = (19.9, 12.15)
ICON_DX = MC[0] - BW / 2
ICON_DY = MC[1] - BH / 2

FRAME_MAP = {2: "street", 3: "factory", 4: "caves", 5: "canyon", 6: "forest",
             7: "cavesb", 8: "cqc", 9: "frigate", 10: "construction",
             11: "junkyard", 12: "temple", 13: "volcano", 14: "gorge"}


def svg_of(cid):
    d = S.sprite_dir(cid)
    return os.path.join(d, "1.svg") if d else os.path.join(S.SHAPES, f"{cid}.svg")


def bmp_of(player):
    return (player["x"] * -SCALE + VIEW_W / 2, player["y"] * -SCALE + VIEW_H / 2)


def render_wall(pg, svg_path, k):
    svg = open(svg_path, encoding="utf-8").read()
    w, h, ox, oy = S.header(svg)
    sw, sh = w * 2, h * 2
    bw, bh = int(sw * 0.1), int(sh * 0.1)
    disp_w, disp_h = sw * 0.1 * k, sh * 0.1 * k
    left, top = -ox * 2 * 0.1 * k, -oy * 2 * 0.1 * k
    b64 = base64.b64encode(svg.encode("utf-8")).decode("ascii")
    pg.set_viewport_size({"width": bw * k, "height": bh * k})
    pg.set_content(
        '<body style="margin:0;background:transparent">'
        f'<img id="i" src="data:image/svg+xml;base64,{b64}" '
        f'width="{disp_w}" height="{disp_h}" '
        f'style="position:absolute;left:{left}px;top:{top}px"></body>')
    pg.wait_for_selector("#i", state="attached")
    tmp = os.path.join(SHOTS, "_radar_agent_raw.png")
    pg.screenshot(path=tmp, omit_background=True)
    im = Image.open(tmp).convert("RGBA")
    os.remove(tmp)
    return im


def whiten(im):
    a = np.asarray(im).astype(np.float64)
    a[:, :, 3] = np.round(a[:, :, 3] * WHITEN_ALPHA)
    a[:, :, 0:3] = 255
    return Image.fromarray(a.astype(np.uint8), "RGBA")


def icon_from_swf(pg, cid, frame, k):
    svgs = S.frame_svgs(cid)
    svg_path = svgs[frame - 1]
    im, lx, ly = B.render(pg, svg_path, 1.0, 1.0, 0.0, "", 2 * k)
    return im, lx * 2 * k, ly * 2 * k


def mask_rect(size, rect):
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).rectangle(
        [rect[0], rect[1], rect[0] + rect[2] - 1, rect[1] + rect[3] - 1], fill=255)
    return m


def paste_clipped(canvas, im, pos, clip):
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    layer.alpha_composite(im, (round(pos[0]), round(pos[1])))
    if clip is not None:
        a = layer.getchannel("A")
        a = Image.fromarray(
            (np.asarray(a).astype(np.uint16) * np.asarray(clip) // 255).astype(np.uint8))
        layer.putalpha(a)
    return Image.alpha_composite(canvas, layer)


def compose(player, units, objectives, map_id, wall_im, icons, icon_scale):
    w, h = VIEW_W * K, 124 * K
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))

    panel = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(panel).rectangle(
        [PANEL[0] * K, PANEL[1] * K, (PANEL[0] + PANEL[2]) * K, (PANEL[1] + PANEL[3]) * K],
        fill=(0, 0, 0, round(PANEL_ALPHA * 255)))
    canvas = Image.alpha_composite(canvas, panel)

    bx, by = bmp_of(player)
    white = whiten(wall_im)
    clip = mask_rect((w, h), ((PANEL[0]) * K, PANEL[1] * K, PANEL[2] * K, PANEL[3] * K))
    canvas = paste_clipped(canvas, white,
                           ((CONT[0] + bx) * K, (CONT[1] + by) * K), clip)

    surf = mask_rect((w, h), (0, 0, VIEW_W * K, VIEW_H * K))
    dots = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    for kind, sub, x, y, dy in icons_for(player, units, objectives):
        icon = icons.get(sub)
        if icon is None:
            continue
        cell_im, lx, ly = icon
        px = (x * SCALE + bx + 2) * K
        py = (y * SCALE + by + dy) * K
        off = (ICON_DX * K + lx, ICON_DY * K + ly)
        scaled = cell_im
        if icon_scale != K:
            scaled = cell_im.resize(
                (max(1, round(cell_im.width * icon_scale / K)),
                 max(1, round(cell_im.height * icon_scale / K))), Image.NEAREST)
        dots.alpha_composite(scaled, (round(px + off[0]), round(py + off[1])))
    a = dots.getchannel("A")
    dots.putalpha(Image.fromarray(
        (np.asarray(a).astype(np.uint16) * np.asarray(surf) // 255).astype(np.uint8)))
    return Image.alpha_composite(canvas, dots)


def icons_for(player, units, objectives):
    out = []
    for u in units:
        if u.get("human") and not u.get("dead"):
            out.append(("unit", "player", u["x"], u["y"], -4))
        elif u.get("team") == 1:
            out.append(("unit", "allyskull" if u.get("dead") else "ally",
                        u["x"], u["y"], -4))
    for o in objectives:
        out.append(("objective", f"flag{o['team']}", o["x"], o["y"], -3))
    return out


def capture(url, flags, player_override, extra_units):
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=["--force-color-profile=srgb"])
        pg = b.new_page(viewport={"width": 1600, "height": 1200}, device_scale_factor=1)
        goto_menu(pg, url)
        time.sleep(1.5)
        pg.evaluate("() => window.__sfh3.screen.goto('deploy')")
        time.sleep(0.8)
        pg.mouse.click(800, 1097)
        pg.wait_for_function(
            "() => { const s = window.__sfh3.screen;"
            " return s && s.constructor.name === 'GameScreen' && s.gameStarted; }",
            timeout=60000)
        time.sleep(0.5)

        objectives = []
        units = []
        if flags:
            objectives = [{"x": 610, "y": 700, "team": 1},
                          {"x": 1420, "y": 520, "team": 2},
                          {"x": 910, "y": 940, "team": 0}]
        if extra_units:
            px = player_override["x"] if player_override else 92.75
            py = player_override["y"] if player_override else 706.65
            units = [{"x": px + 150, "y": py - 90, "human": False, "team": 1, "dead": False},
                     {"x": px + 420, "y": py + 60, "human": False, "team": 1, "dead": True},
                     {"x": px - 260, "y": py - 300, "human": False, "team": 1, "dead": False}]
        state = pg.evaluate(
            """(arg) => {
                const s = window.__sfh3.screen;
                if (s.constructor.name !== 'GameScreen') return {error: s.constructor.name};
                s.paused = true;
                const player = arg.player
                    ?? { x: s.player.x, y: s.player.y };
                const units = s.units.map(u => ({x: u.x, y: u.y, human: u.human,
                                                 team: u.team, dead: !!u.dead}))
                                     .concat(arg.units);
                const objectives = s.radarObjectives().concat(arg.objectives);
                s.hud.radar.update(player, units, objectives);
                return { map: s.arena.map.id, player, units, objectives };
            }""", {"objectives": objectives, "units": units, "player": player_override})
        if "error" in state:
            raise SystemExit(f"not a GameScreen: {state}")
        time.sleep(0.2)
        full = os.path.join(SHOTS, "_radar_match_full.png")
        pg.screenshot(path=full)
        actual = Image.open(full).convert("RGBA").crop((1280, 0, 1600, 248))

        pg.evaluate("() => { window.__sfh3.screen.hud.radar.visible = false; }")
        time.sleep(0.2)
        pg.screenshot(path=os.path.join(SHOTS, "_radar_agent_bg.png"))
        bg = Image.open(os.path.join(SHOTS, "_radar_agent_bg.png")).convert("RGBA").crop((1280, 0, 1600, 248))

        baked_path = compose_baked(pg, state)
        b.close()
    return state, actual, bg, baked_path


def compose_baked(pg, state):
    rig = json.load(open(RIG, encoding="utf-8"))["fx"]["radar"]
    atlas = Image.open(os.path.join(FX, rig["files"][0])).convert("RGBA")
    cells = {}
    for i, c in enumerate(rig["cells"]):
        if not c["w"]:
            cells[i] = None
            continue
        im = atlas.crop((c["x"], c["y"], c["x"] + c["w"], c["y"] + c["h"]))
        s = (2 / rig["bakeScale"]) * K
        if abs(s - 1) > 1e-9:
            im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))),
                           Image.BILINEAR)
        cells[i] = (im, c["lx"] * 2 * K, c["ly"] * 2 * K)
    return cells


def compose_swf(pg, state):
    buf = S.body()
    _labels, frames = AD.arena_frames(buf)
    frame_i = next(i for i, m in FRAME_MAP.items() if m == state["map"])
    wall_cid = None
    for d in sorted(frames[frame_i]):
        cid, name, _m = frames[frame_i][d]
        if name == "wallMC":
            wall_cid = cid
    wall_im = render_wall(pg, svg_of(wall_cid), K)

    order = ["player", "ally", "allyskull", "enemy", "helially", "helienemy",
             "flag0", "flag1", "flag2"]
    icons = {}
    for sub in order:
        if sub in ("helially", "helienemy"):
            icons[sub] = None
            continue
        icons[sub] = icon_from_swf(pg, 4036, order.index(sub) + 1, K)
    return wall_im, icons


def main():
    url = "http://localhost:5173/"
    if "--url" in sys.argv:
        url = sys.argv[sys.argv.index("--url") + 1]
    flags = "--flags" in sys.argv
    extra_units = "--units" in sys.argv
    player_override = None
    if "--player" in sys.argv:
        px, py = sys.argv[sys.argv.index("--player") + 1].split(",")
        player_override = {"x": float(px), "y": float(py)}
    os.makedirs(SHOTS, exist_ok=True)

    print(f"capturing {url} ...")
    state, actual, bg, baked_cells = capture(url, flags, player_override, extra_units)
    print(json.dumps({k: v for k, v in state.items() if k != "units"}, indent=1))
    json.dump(state, open(os.path.join(SHOTS, "_radar_agent_state.json"), "w"), indent=1)

    with sync_playwright() as pw:
        b = pw.chromium.launch(args=["--force-color-profile=srgb"])
        pg = b.new_page()
        wall_im, swf_icons = compose_swf(pg, state)
        b.close()

    rb = Image.open(os.path.join(
        REPO, "public", "assets", "maps", f"{state['map']}_radarwall.png")).convert("RGBA")
    wall_baked = rb.resize((rb.width * K, rb.height * K), Image.BILINEAR)

    swf = compose(state["player"], state["units"], state["objectives"],
                  state["map"], wall_im, swf_icons, K)
    baked = compose(state["player"], state["units"], state["objectives"],
                    state["map"], wall_baked, baked_cells, K)

    expected = Image.alpha_composite(bg, swf)
    expected_baked = Image.alpha_composite(bg, baked)
    diff = np.abs(np.asarray(expected).astype(int) - np.asarray(actual).astype(int))
    diff_baked = np.abs(np.asarray(expected_baked).astype(int) - np.asarray(actual).astype(int))

    def report(name, d):
        over = (d.max(axis=2) > 24).mean() * 100
        print(f"  {name:6} max {d.max():3d}  mean {d.mean():5.2f}  pixels >24: {over:5.2f}%")

    print("difference vs the live radar:")
    report("swf", diff)
    report("baked", diff_baked)

    expected.save(os.path.join(SHOTS, "_radar_agent_swf.png"))
    expected_baked.save(os.path.join(SHOTS, "_radar_agent_baked.png"))
    actual.save(os.path.join(SHOTS, "_radar_port.png"))
    Image.fromarray(np.clip(diff.max(axis=2) * 6, 0, 255).astype(np.uint8)).save(
        os.path.join(SHOTS, "_radar_agent_diff.png"))
    side = Image.new("RGBA", (expected.width * 2 + 8, expected.height), (32, 32, 32, 255))
    side.paste(expected, (0, 0))
    side.paste(actual, (expected.width + 8, 0))
    side.save(os.path.join(SHOTS, "_radar_compare.png"))
    print("wrote shots/_radar_agent_swf.png, _radar_agent_baked.png, "
          "_radar_port.png, _radar_agent_diff.png, _radar_compare.png")


if __name__ == "__main__":
    main()
