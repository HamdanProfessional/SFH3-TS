#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", ".."))
RIG = os.path.join(REPO, "src", "assets", "menuRig.json")
PNG_ROOT = os.path.join(REPO, "public", "assets", "menu-parts")

sys.path.insert(0, HERE)
from bake_menu_unit import art_bbox


def main() -> int:
    check = "--check" in sys.argv
    with open(RIG, encoding="utf-8") as fh:
        rig = json.load(fh)

    added = missing = 0
    for store in ("guns", "stows"):
        for frame, rec in sorted(rig.get(store, {}).items(), key=lambda kv: int(kv[0])):
            png = os.path.join(PNG_ROOT, rec["file"].replace("/", os.sep))
            if not os.path.isfile(png):
                missing += 1
                continue
            bb = art_bbox(png, rec)
            if not bb:
                continue
            if rec.get("bb") != bb:
                added += 1
                if not check:
                    rec["bb"] = bb

    if missing:
        print(f"  {missing} records have no PNG on disk (skipped)")
    if check:
        print(f"{added} records would change" if added else "up to date")
        return 1 if added else 0

    if added:
        with open(RIG, "w", encoding="utf-8") as fh:
            json.dump(rig, fh, separators=(",", ":"))
        print(f"wrote {added} bb records to {os.path.relpath(RIG, REPO)}")
    else:
        print("up to date")

    ws = [r["bb"][2] for r in rig["guns"].values() if "bb" in r]
    hs = [r["bb"][3] for r in rig["guns"].values() if "bb" in r]
    if ws:
        cell = next(iter(rig["guns"].values()))
        print(f"  cell {cell['w']}x{cell['h']}  "
              f"art w {min(ws):.1f}..{max(ws):.1f}  h {min(hs):.1f}..{max(hs):.1f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
