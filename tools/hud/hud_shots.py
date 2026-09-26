#!/usr/bin/env python3
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import swfio as S
import svgraster as R
import swftext as T
from uibake import fix_glyph_text

REPO = os.path.normpath(os.path.join(HERE, "..", ".."))
SHOTS = os.path.join(REPO, "shots")
HUD_CID = 3715
STATES = (("live", 1), ("pause", 8), ("end", 101))

DYNAMIC = [3574, 3576, 3592, 3594, 2034, 3609, 3622, 2076, 3616, 3567, 3570]
SPONSOR = [43]


def drive(pw, url):
    shots = {}
    b = pw.chromium.launch(args=["--force-color-profile=srgb"])
    try:
        pg = b.new_page(viewport={"width": 800, "height": 600},
                        device_scale_factor=2)
        pg.goto(url, wait_until="load")
        pg.wait_for_selector("canvas", timeout=30000)
        time.sleep(1.5)
        pg.wait_for_function("() => window.__sfh3?.screen", timeout=30000)
        pg.evaluate("() => window.__sfh3.screen.goto('deploy')")
        time.sleep(0.8)
        pg.mouse.click(400, 548)
        pg.wait_for_function(
            "() => { const s = window.__sfh3?.screen;"
            " return s && s.constructor.name === 'GameScreen' && s.gameStarted"
            " && s.hud.mode === 'idle'; }",
            timeout=60000)
        time.sleep(0.6)
        path = os.path.join(SHOTS, "_ws4_live.png")
        pg.screenshot(path=path)
        shots["live"] = path
        print("wrote", path)

        pg.evaluate("() => window.__sfh3.screen.hud.setBloodyScreen(0.85)")
        time.sleep(0.3)
        path = os.path.join(SHOTS, "_ws4_bloody.png")
        pg.screenshot(path=path)
        shots["bloody"] = path
        print("wrote", path)
        pg.evaluate("() => window.__sfh3.screen.hud.setBloodyScreen(0)")

        pg.evaluate(
            "() => window.__sfh3.screen.hud.setMsg("
            "'Captin Johnson', 'If you are reading this... Something is wrong.',"
            " 9999, true, {head: 1, body: 1, color: 1, face: 1, skin: 1, hair: 1})")
        time.sleep(0.5)
        path = os.path.join(SHOTS, "_ws4_speak.png")
        pg.screenshot(path=path)
        shots["speak"] = path
        print("wrote", path)
        pg.evaluate("() => window.__sfh3.screen.hud.setMsg('', '', 0, true)")

        pg.keyboard.press("Escape")
        pg.wait_for_function(
            "() => window.__sfh3?.screen?.hud?.mode === 'pause'", timeout=10000)
        time.sleep(0.4)
        path = os.path.join(SHOTS, "_ws4_pause.png")
        pg.screenshot(path=path)
        shots["pause"] = path
        print("wrote", path)

        pg.evaluate("() => window.__sfh3.screen.togglePause()")
        pg.wait_for_function(
            "() => window.__sfh3?.screen?.hud?.mode === 'idle'", timeout=10000)
        pg.evaluate("() => window.__sfh3.screen.endGame(true)")
        pg.wait_for_function(
            "() => window.__sfh3?.screen?.hud?.mode === 'end'", timeout=10000)
        time.sleep(0.15)
        path = os.path.join(SHOTS, "_ws4_end.png")
        pg.screenshot(path=path)
        shots["end"] = path
        print("wrote", path)
    finally:
        try:
            b.close()
        except Exception:
            pass
    return shots


def main():
    url = "http://localhost:5173/"
    if "--url" in sys.argv:
        url = sys.argv[sys.argv.index("--url") + 1]
    os.makedirs(SHOTS, exist_ok=True)

    hides = [str(c) for c in sorted(set(T.parse()) | set(DYNAMIC) | set(SPONSOR))]

    from playwright.sync_api import sync_playwright
    shots = None
    with sync_playwright() as pw:
        for attempt in range(5):
            try:
                shots = drive(pw, url)
                break
            except Exception as e:
                print(f"capture attempt {attempt + 1} failed: {e}")
                shots = None
        if shots is None:
            raise SystemExit("could not capture the match")

        b = pw.chromium.launch(args=["--force-color-profile=srgb"])
        pg = b.new_page(viewport={"width": 1280, "height": 900},
                        device_scale_factor=R.BASE_DSF * 2)
        pg.set_content(R.PAGE)
        for name, frame in STATES:
            svg = fix_glyph_text(
                open(S.frame_svgs(HUD_CID)[frame - 1], encoding="utf-8").read())
            path = os.path.join(SHOTS, f"_ws4_swf_{name}.png")
            R.render(pg, svg, path, hide_cids=hides)
            print("wrote", path)
            shots[f"swf_{name}"] = path
        b.close()

        pg2b = pw.chromium.launch(args=["--force-color-profile=srgb"])
        p2 = pg2b.new_page(viewport={"width": 1280, "height": 900},
                           device_scale_factor=R.BASE_DSF * 2)
        p2.set_content(R.PAGE)
        speak_svg = open(S.frame_svgs(3622)[15], encoding="utf-8").read()
        path = os.path.join(SHOTS, "_ws4_swf_speak.png")
        R.render(p2, speak_svg, path, rect=(12.125, 62.775, 170, 85))
        shots["swf_speak"] = path
        print("wrote", path)
        pg2b.close()

        b2 = pw.chromium.launch(args=["--force-color-profile=srgb"])
        p3 = b2.new_page(viewport={"width": 1280, "height": 900},
                         device_scale_factor=R.BASE_DSF * 2)
        p3.set_content(R.PAGE)
        path = os.path.join(SHOTS, "_ws4_swf_bloody.png")
        R.render(p3, open(S.frame_svgs(3574)[0], encoding="utf-8").read(), path)
        shots["swf_bloody"] = path
        print("wrote", path)
        b2.close()

    from PIL import Image
    for name, _frame in STATES:
        live = Image.open(shots[name]).convert("RGB")
        ref = Image.open(shots[f"swf_{name}"]).convert("RGB")
        if live.size != ref.size:
            live = live.resize(ref.size, Image.BILINEAR)
        side = Image.new("RGB", (ref.width, ref.height * 2 + 8), (24, 24, 24))
        side.paste(ref, (0, 0))
        side.paste(live, (0, ref.height + 8))
        out = os.path.join(SHOTS, f"_ws4_{name}_vs_swf.png")
        side.save(out)
        print("wrote", out, "(top: SWF, bottom: port)")

    live = Image.open(shots["speak"]).convert("RGB").crop((480, 20, 1160, 360))
    ref = Image.open(shots["swf_speak"]).convert("RGB")
    if ref.size != live.size:
        ref = ref.resize(live.size, Image.BILINEAR)
    side = Image.new("RGB", (live.width, live.height * 2 + 8), (24, 24, 24))
    side.paste(ref, (0, 0))
    side.paste(live, (0, live.height + 8))
    out = os.path.join(SHOTS, "_ws4_speak_vs_swf.png")
    side.save(out)
    print("wrote", out, "(top: SWF, bottom: port)")

    live = Image.open(shots["bloody"]).convert("RGB")
    ref = Image.open(shots["swf_bloody"]).convert("RGB")
    if ref.size != live.size:
        ref = ref.resize(live.size, Image.BILINEAR)
    side = Image.new("RGB", (ref.width, ref.height * 2 + 8), (24, 24, 24))
    side.paste(ref, (0, 0))
    side.paste(live, (0, ref.height + 8))
    out = os.path.join(SHOTS, "_ws4_bloody_vs_swf.png")
    side.save(out)
    print("wrote", out, "(top: SWF, bottom: port)")


if __name__ == "__main__":
    main()
