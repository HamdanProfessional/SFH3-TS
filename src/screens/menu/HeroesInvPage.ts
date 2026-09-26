import { Container } from "pixi.js";
import { MenuPage } from "./MenuPage";
import { focusable, hitTest } from "../../ui/kit";
import { ArtButton, itemOf } from "../../ui/art";
import {
  UI, CARD_W, CARD_H, STAGE_TOP, GridPager, catTabs, focusTabs, gridCards, gridCells,
  hoverCell, preloadItemArt, itemArtEpoch, selItemCat, setItemCat, tabRow,
  type CellHit, type TabHit,
} from "./InventoryPage";
import { SD, type InvItem } from "../../state/SD";
import { SH } from "../../audio/SH";
import { GunInfo } from "../../game/GunInfo";
import * as Classes from "../../data/StatsClasses";
import * as Guns from "../../data/StatsGuns";

export type EquipSlot = "primary" | "secondary" | "weaponMod" | "armorMod";

let equipSlot: EquipSlot = "primary";

export function beginEquip(slot: EquipSlot): void {
  equipSlot = slot;
  const hero = SD.selectedHero;
  if (slot === "weaponMod") {
    setItemCat(11);
  } else if (slot === "armorMod") {
    setItemCat(12);
  } else {
    const held = hero[slot];
    const cls = Classes.itemOb[hero.cls];
    setItemCat(held instanceof GunInfo
      ? held.stats.type
      : (slot === "primary" ? cls.primary : cls.secondary)[0] ?? 0);
  }
}

export function equipSlotTarget(): EquipSlot {
  return equipSlot;
}

export type EquipResult = "ok" | "full" | "blocked";

export function equipItem(item: InvItem): EquipResult {
  const hero = SD.selectedHero;
  if (item instanceof GunInfo) {
    if (equipSlot !== "primary" && equipSlot !== "secondary") return "blocked";
    const old = hero[equipSlot] as GunInfo | null;
    if (old) {
      if (SD.items[old.stats.type].length >= SD.itemCap()
          && old.stats.type !== item.stats.type) {
        return "full";
      }
      SD.items[old.stats.type].push(old);
    }
    hero[equipSlot] = item;
  } else {
    if (equipSlot !== "weaponMod" && equipSlot !== "armorMod") return "blocked";
    const old = hero[equipSlot];
    if (old) SD.items[selItemCat].push(old);
    hero[equipSlot] = item;
  }
  const at = SD.items[selItemCat].indexOf(item);
  if (at >= 0) SD.items[selItemCat].splice(at, 1);
  hero.initStats();
  return "ok";
}

export function unequipSlot(): EquipResult {
  const hero = SD.selectedHero;
  if (equipSlot === "primary" || equipSlot === "secondary") {
    const old = hero[equipSlot] as GunInfo | null;
    if (old) {
      if (SD.items[old.stats.type].length >= SD.itemCap()) return "full";
      SD.items[old.stats.type].push(old);
    }
    hero[equipSlot] = null;
  } else {
    const old = hero[equipSlot];
    if (old) SD.items[selItemCat].push(old);
    hero[equipSlot] = "";
  }
  hero.initStats();
  return "ok";
}

export class HeroesInvPage extends MenuPage {
  private tabHits: TabHit[] = [];
  private cellHits: CellHit[] = [];
  private unequipHit: [number, number, number, number] | null = null;
  private pager: GridPager | null = null;
  private back: ArtButton | null = null;
  private hoverIndex = -1;
  private artEpoch = -1;

  build(_w: number, _h: number): void {
    preloadItemArt();
    this.artEpoch = itemArtEpoch();
    this.tabHits = [];
    this.cellHits = [];
    this.unequipHit = null;
    this.hoverIndex = -1;

    const L = UI.layout.heroesInv;
    const hero = SD.selectedHero;
    const bucket = SD.items[selItemCat] ?? [];

    this.tabHits = catTabs(this.view, L.tabs, selItemCat, (i) => this.tabAllowed(i));

    const up = L.place.unequip;
    if (up) {
      const full = bucket.length >= SD.itemCap();
      const box = tabRow(this.view, up[4], up[5] - STAGE_TOP,
                         full ? "Inventory Full" : "Unequip",
                         false, full ? 0.7 : 1, full ? 0xff9900 : 0xffffff);
      if (box && !full) this.unequipHit = [box.x, box.y, box.w, box.h];
    }

    this.cellHits = gridCells(L.cards, bucket.length);
    this.hoverIndex = hoverCell(this.cellHits, bucket);
    gridCards(this.view, this.cellHits, bucket,
              (i) => i === this.hoverIndex, hero.level);
    this.pager = GridPager.build(this.view, bucket.length);

    const bk = itemOf("heroesInv", "bt_back");
    if (bk) {
      this.back = new ArtButton(bk.cid, bk.x, bk.y - STAGE_TOP, bk.sx, bk.sy);
      this.view.addChild(this.back);
    }
  }

  private tabAllowed(i: number): boolean {
    if (selItemCat >= 11) return i === selItemCat;
    const cls = Classes.itemOb[SD.selectedHero.cls];
    const allow = equipSlot === "secondary" ? cls.secondary : cls.primary;
    return allow.includes(i);
  }

  update(): void {
    if (itemArtEpoch() !== this.artEpoch) {
      this.host.refresh();
      return;
    }
    if (this.back) {
      const [x, y, w, h] = this.back.hitBox();
      this.back.setState(hitTest(x, y, w, h) ? "over" : "up");
      focusable(x, y, w, h, { back: true });
    }
    focusTabs(this.tabHits, selItemCat);
    if (this.unequipHit) focusable(...this.unequipHit);
    this.pager?.update();
    const h = hoverCell(this.cellHits, SD.items[selItemCat] ?? []);
    if (h !== this.hoverIndex) {
      this.hoverIndex = h;
      this.host.refresh();
    }
  }

  onClick(): void {
    if (this.back) {
      const [x, y, w, h] = this.back.hitBox();
      if (hitTest(x, y, w, h)) {
        SH.playSound("S_Click");
        this.host.goto("heroes");
        return;
      }
    }
    const bucket = SD.items[selItemCat] ?? [];
    if (this.pager?.click(bucket.length)) {
      this.host.refresh();
      return;
    }
    for (const t of this.tabHits) {
      if (hitTest(t.x, t.y, t.w, t.h)) {
        SH.playSound("S_Click");
        setItemCat(t.i);
        this.host.refresh();
        return;
      }
    }
    for (const c of this.cellHits) {
      if (c.i >= bucket.length) continue;
      if (!hitTest(c.x, c.y, CARD_W, CARD_H)) continue;
      this.apply(equipItem(bucket[c.i]));
      return;
    }
    if (this.unequipHit && hitTest(...this.unequipHit)) this.apply(unequipSlot());
  }

  private apply(r: EquipResult): void {
    if (r !== "ok") {
      SH.playSound("S_Error");
      return;
    }
    SH.playSound("S_Equip");
    SD.save();
    this.host.goto("heroes");
  }
}
