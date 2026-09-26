#!/usr/bin/env python3
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from devurl import goto_menu

URL = os.environ.get("SFH3_URL", "http://localhost:5178/")


def main():
    from playwright.sync_api import sync_playwright

    fails = []
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        pg = b.new_page(viewport={"width": 800, "height": 600},
                        device_scale_factor=1)
        errs = []
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errs.append(str(e)))
        goto_menu(pg, URL)
        time.sleep(2.5)

        pg.evaluate("""() => {
          const SD = window.sfh3Dev.SD;
          SD.heroes[0].level = 30;
          SD.heroes[0].primary = null;
          for (const b of SD.items) b.length = 0;
          window.__sfh3.screen.goto('heroes');
        }""")
        time.sleep(1.5)

        box = pg.evaluate("""() => {
          const p = window.__sfh3.screen.page;
          return {n: p.rightLive.children.length};
        }""")
        if box["n"] < 4:
            fails.append(f"box_right has {box['n']} live children, expected >= 4")

        pt = pg.evaluate("""() => {
          const p = window.__sfh3.screen.page;
          const v = p.rightLive.children[0];
          const g = v.toGlobal({x: 0, y: 0});
          return {x: g.x, y: g.y};
        }""")
        pg.mouse.move(pt["x"], pt["y"])
        time.sleep(0.4)
        pg.mouse.click(pt["x"], pt["y"])
        time.sleep(1.5)

        st = pg.evaluate("""() => ({
          frame: window.__sfh3.screen.curFrame,
          cat: window.__sfh3.screen.page?.constructor?.name,
        })""")
        if st["frame"] != "heroesInv":
            fails.append(f"primary box did not navigate: frame={st['frame']!r}")
        if st["cat"] != "HeroesInvPage":
            fails.append(f"routed to {st['cat']!r}, not HeroesInvPage")

        made = pg.evaluate("""() => {
          const SD = window.sfh3Dev.SD;
          const cat = window.sfh3Dev.selItemCat();
          const g = window.sfh3Dev.makeGun(cat);
          if (!g) return null;
          SD.items[cat].push(g);
          window.__sfh3.screen.host.refresh();
          return {cat, id: g.stats.id};
        }""")
        if not made:
            fails.append("could not stock the open bucket")
        else:
            time.sleep(1.2)
            card = pg.evaluate("""() => {
              const p = window.__sfh3.screen.page;
              const c = p.cellHits[0];
              return p.view.toGlobal({x: c.x + 71.48, y: c.y + 39.8});
            }""")
            pg.mouse.move(card["x"], card["y"])
            time.sleep(0.4)
            pg.mouse.click(card["x"], card["y"])
            time.sleep(1.5)
            out = pg.evaluate("""() => {
              const SD = window.sfh3Dev.SD;
              const g = SD.heroes[0].primary;
              return {frame: window.__sfh3.screen.curFrame,
                      gun: g ? g.stats.id : null,
                      left: SD.items[window.sfh3Dev.selItemCat()].length};
            }""")
            if out["gun"] != made["id"]:
                fails.append(f"hero holds {out['gun']!r}, expected {made['id']!r}")
            if out["frame"] != "heroes":
                fails.append(f"equip left us on {out['frame']!r}, not heroes")
            if out["left"] != 0:
                fails.append(f"bucket still holds {out['left']} item(s)")

        pg.evaluate("""() => {
          const SD = window.sfh3Dev.SD;
          SD.stages = [0,1,2,3,4,5];
          for (const b of SD.items) b.length = 0;
          window.__sfh3.screen.goto('workshop');
        }""")
        time.sleep(1.5)
        wb = pg.evaluate("""() => {
          const p = window.__sfh3.screen.page;
          if (!p.weaponBox) return null;
          const [x, y, w, h] = p.weaponBox.hitBox();
          return p.view.toGlobal({x: x + w / 2, y: y + h / 2});
        }""")
        if not wb:
            fails.append("workshop has no weaponbox on an unlocked save")
        else:
            pg.mouse.move(wb["x"], wb["y"])
            time.sleep(0.4)
            pg.mouse.click(wb["x"], wb["y"])
            time.sleep(1.5)
            got = pg.evaluate("""() => ({
              frame: window.__sfh3.screen.curFrame,
              page: window.__sfh3.screen.page?.constructor?.name,
              cat: window.sfh3Dev.selItemCat(),
            })""")
            if got["page"] != "WorkshopInvPage":
                fails.append(f"weaponbox opened {got['page']!r}, not WorkshopInvPage")
            if got["cat"] > 10:
                fails.append(f"workshopInv opened on mod bucket {got['cat']}")
            else:
                pg.evaluate("""() => {
                  const SD = window.sfh3Dev.SD;
                  const cat = window.sfh3Dev.selItemCat();
                  SD.items[cat].push(window.sfh3Dev.makeGun(cat));
                  window.__sfh3.screen.host.refresh();
                }""")
                time.sleep(1.2)
                pick = pg.evaluate("""() => {
                  const p = window.__sfh3.screen.page;
                  const c = p.cellHits[0];
                  return p.view.toGlobal({x: c.x + 71.48, y: c.y + 39.8});
                }""")
                pg.mouse.move(pick["x"], pick["y"])
                time.sleep(0.4)
                pg.mouse.click(pick["x"], pick["y"])
                time.sleep(1.5)
                end = pg.evaluate("""() => ({
                  frame: window.__sfh3.screen.curFrame,
                  sel: !!window.__sfh3.screen.page?.selGun,
                })""")
                if end["frame"] != "workshop":
                    fails.append(f"pick left us on {end['frame']!r}, not workshop")
                if not end["sel"]:
                    fails.append("the picked weapon did not reach the upgrade box")

        b.close()

    for e in dict.fromkeys(errs):
        print("  console:", e[:200])
    if fails:
        for f in fails:
            print("  FAIL ", f)
        return 1
    print("equip loop: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
