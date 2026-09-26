import { Container, Sprite, type Text } from "pixi.js";
import { MenuPage, type PageHost } from "./MenuPage";
import type { MenuFigure } from "../../menu/MenuFigure";
import { animLabelFor, makeHeroFigure } from "../../menu/heroFigure";
import { HeroPicker, heroesCardState, type PickerCard } from "./HeroPicker";
import { focusable, hitTest, localMouseY } from "../../ui/kit";
import { itemBoxView, itemArtEpoch, UI, type BoxState } from "./InventoryPage";
import { beginEquip, type EquipSlot } from "./HeroesInvPage";
import { SH } from "../../audio/SH";
import { MenuPanels, panelFieldText } from "../../assets/MenuPanels";
import { MenuPicker } from "../../assets/MenuPicker";
import { MenuRig } from "../../assets/MenuRig";
import { PartButton, applyRec, partSprite, partsEpoch } from "../../assets/menuParts";
import { SD } from "../../state/SD";
import * as Classes from "../../data/StatsClasses";
import * as Perks from "../../data/StatsPerks";
import { GunInfo } from "../../game/GunInfo";

const BAR_MAX: Readonly<Record<Classes.RangedStat, number>> = {
  health: 300, crit: 100, aim: 10, mobile: 10, aggro: 10,
};

const STAT_INFO_ID: Readonly<Record<Classes.RangedStat, string>> = {
  health: "health", crit: "critical", aim: "aim",
  mobile: "mobility", aggro: "aggro",
};

const STATS: readonly Classes.RangedStat[] = ["health", "crit", "aim", "mobile", "aggro"];

interface Hoverable {
  id: string;
  x: number; y: number; w: number; h: number;
  title?: string;
  desc?: string;
}

const PAGE_TOP = 64;

const CHAR_X = 387.95;
const CHAR_Y = 496.75;
const CHAR_SCALE = 3.15;

const LEFT_HOME = -235;
const LEFT_IN = 0;
const RIGHT_HOME = 1050;
const RIGHT_IN = 800;

const SLOT_BOXES: readonly (readonly [string, EquipSlot, BoxState])[] = [
  ["primary", "primary", "idle2"],
  ["secondary", "secondary", "idle2"],
  ["gun", "weaponMod", "idle4"],
  ["armor", "armorMod", "idle4"],
];

let hireAnimPending = false;

export class HeroesPage extends MenuPage {
  private figure: MenuFigure | null = null;

  private hoverables: Hoverable[] = [];
  private deck: HeroPicker | null = null;
  private leftBox = new Container();
  private rightBox = new Container();
  private leftLive = new Container();
  private rightLive = new Container();
  private statusView = new Container();
  private leftX = LEFT_HOME;
  private rightX = RIGHT_HOME;
  private tempOb: Record<string, number> = {};
  private barW: Record<string, number> = {};
  private statsText: Record<string, Text> = {};
  private bars: Record<string, Sprite> = {};
  private xpBar: Sprite | null = null;
  private statusTxt: Text | null = null;
  private dismiss: PartButton | null = null;
  private leftPlate: Sprite | null = null;
  private rightPlate: Sprite | null = null;
  private statusPlate: Sprite | null = null;
  private partsAt = -1;
  private itemsAt = -1;

  constructor(host: PageHost) {
    super(host);
  }

  static requestHireAnim(): void {
    hireAnimPending = true;
  }

  build(w: number, h: number): void {
    this.hoverables = [];
    this.tempOb = {};
    for (const v of STATS) this.tempOb[v] = 0;
    this.barW = {};
    this.statsText = {};
    this.bars = {};
    this.xpBar = null;

    const hero = SD.selectedHero;
    const cls = Classes.itemOb[hero.cls];

    this.figure = makeHeroFigure(hero);
    this.figure.view.position.set(CHAR_X, CHAR_Y - PAGE_TOP);
    this.figure.view.scale.set(CHAR_SCALE * cls.size);
    this.view.addChild(this.figure.view);
    this.figure.playLabel(animLabelFor(hero));
    if (hireAnimPending) {
      hireAnimPending = false;
      this.figure.playLabel(hero.cls === "gun" ? "hire_akimbo" : "hire");
    }

    this.leftX = LEFT_HOME;
    this.rightX = RIGHT_HOME;
    this.leftBox.removeChildren();
    this.rightBox.removeChildren();
    this.leftLive.removeChildren();
    this.rightLive.removeChildren();
    this.statusView.removeChildren();

    const leftRec = MenuPanels.box("left");
    this.leftBox.position.set(this.leftX, leftRec.place.y - PAGE_TOP);
    this.leftPlate = partSprite(leftRec);
    this.leftBox.addChild(this.leftPlate);
    this.leftBox.addChild(this.leftLive);

    const rightRec = MenuPanels.box("right");
    this.rightBox.position.set(this.rightX, rightRec.place.y - PAGE_TOP);
    this.rightPlate = partSprite(rightRec);
    this.rightBox.addChild(this.rightPlate);
    this.rightBox.addChild(this.rightLive);

    const stRec = MenuPanels.box("status");
    this.statusView.position.set(stRec.place.x, stRec.place.y - PAGE_TOP);
    this.statusPlate = partSprite(stRec);
    this.statusView.addChild(this.statusPlate);
    const sf = MenuPanels.statusField;
    if (sf.spec) {
      this.statusTxt = panelFieldText({ m: sf.m, cid: sf.cid, spec: sf.spec }, "");
      this.statusView.addChild(this.statusTxt);
    }

    this.view.addChild(this.statusView);
    this.view.addChild(this.leftBox);
    this.view.addChild(this.rightBox);

    this.deck = new HeroPicker({
      label: "heroes",
      state: (i) => this.cardState(i),
      onPick: (i) => this.pickCard(i),
      onHover: () => undefined,
    });
    this.view.addChild(this.deck.view);

    this.refreshViews();
  }

  private cardState(i: number): PickerCard {
    return heroesCardState(SD.heroes, i, SD.selHero, SD.canHire());
  }

  private pickCard(i: number): void {
    SH.playSound("S_Empty");
    if (i === SD.heroes.length && SD.canHire()) {
      this.host.openHire();
      return;
    }
    if (i < SD.heroes.length) {
      SD.selHero = i;
      this.host.refresh();
    }
  }

  private refreshViews(): void {
    const hero = SD.selectedHero;
    const cls = Classes.itemOb[hero.cls];
    const band = Classes.getStatusBand(hero.status);

    this.leftLive.removeChildren();
    this.rightLive.removeChildren();
    this.dismiss = null;
    this.statsText = {};
    this.bars = {};
    this.xpBar = null;

    const putField = (name: string, value: string, fill?: number): Text | null => {
      const rec = MenuPanels.field(name);
      if (!rec) return null;
      const t = panelFieldText(rec, value, fill !== undefined ? { fill } : {});
      this.leftLive.addChild(t);
      return t;
    };
    putField("txt_name", hero.name);
    putField("txt_class", cls.name);
    putField("txt_level", `Lv ${hero.level}`);

    const iconM = MenuPanels.item("mc_class");
    const glyph = MenuPicker.classIcon(cls.id);
    if (glyph && iconM) {
      const sp = partSprite(glyph);
      sp.scale.set(iconM[0] / MenuPanels.scale, iconM[3] / MenuPanels.scale);
      sp.position.set(iconM[4], iconM[5]);
      this.leftLive.addChild(sp);
    }

    const newM = MenuPanels.item("newskill");
    if (newM && hero.hasUpgrade >= 0) {
      const marker = partSprite(MenuPicker.newskill);
      marker.scale.set(newM[0] / MenuPanels.scale, newM[3] / MenuPanels.scale);
      marker.position.set(newM[4], newM[5]);
      this.leftLive.addChild(marker);
      putField("txt_newskill", "NEW SKILL");
    }

    const barM = MenuPanels.item("bar");
    const barRec = MenuRig.bar;
    if (barM && barRec) {
      const sp = new Sprite(MenuRig.texture(barRec));
      sp.anchor.set(barRec.ox / (barRec.w || 1), barRec.oy / (barRec.h || 1));
      sp.position.set(barM[4], barM[5]);
      sp.scale.y = barM[3];
      this.leftLive.addChild(sp);
      this.xpBar = sp;
    }

    for (let i = 1; i <= 6; i++) {
      const rec = MenuPanels.col(i);
      if (!rec) continue;
      const sp = partSprite(rec);
      sp.scale.set(rec.m[0] / MenuPanels.scale, rec.m[3] / MenuPanels.scale);
      sp.position.set(rec.m[4], rec.m[5]);
      sp.alpha = hero.color === i ? 1 : 0.5;
      this.leftLive.addChild(sp);
    }

    for (const stat of STATS) {
      const txt = MenuPanels.field(`txt_${stat}`);
      if (txt) {
        const t = panelFieldText(txt, "");
        this.leftLive.addChild(t);
        this.statsText[stat] = t;
      }
      for (const key of [`bar2_${stat}`, `bar1_${stat}`]) {
        const m = MenuPanels.item(key);
        if (!m || !barRec) continue;
        const sp = new Sprite(MenuRig.texture(barRec));
        sp.anchor.set(barRec.ox / (barRec.w || 1), barRec.oy / (barRec.h || 1));
        sp.position.set(m[4], m[5]);
        sp.scale.y = m[3];
        this.leftLive.addChild(sp);
        this.bars[key] = sp;
        this.barW[key] = m[0] * (barRec.w || 0);
      }
    }

    const putBox = (name: string, item: string | GunInfo | null,
                    armorPerk = false): Container | null => {
      const m = MenuPanels.item(name);
      if (!m) return null;
      const v = itemBoxView(item as never, "idle4", { armorPerk });
      v.position.set(m[4], m[5]);
      v.scale.set(m[0], m[3]);
      this.leftLive.addChild(v);
      return v;
    };
    putBox("trait", hero.trait);
    putBox("flaw", hero.flaw);
    putBox("streak", hero.streak);

    for (let slot = 0; slot < 3; slot++) {
      const unlocked = hero.level >= (slot + 1) * 5;
      const pair = hero.perks[slot];
      for (let choice = 0; choice < 2; choice++) {
        const name = `perk${slot}${choice}`;
        const id = pair ? (choice === 0 ? pair[0] : pair[1]) : "none";
        const item = unlocked ? id : `lock${slot}`;
        const v = putBox(name, item);
        if (v && pair && pair[2] === choice + 1) {
          const sel = this.selMarker();
          if (sel) v.addChild(sel);
        }
      }
    }

    const putGun = (name: string, item: GunInfo | string | null, state: string,
                    armorPerk = false) => {
      const m = MenuPanels.item(name);
      if (!m) return;
      const v = itemBoxView(item as never, state as never, { armorPerk });
      v.position.set(m[4], m[5]);
      v.scale.set(m[0], m[3]);
      this.rightLive.addChild(v);
    };
    putGun("primary", hero.primary instanceof GunInfo ? hero.primary : null, "idle2");
    putGun("secondary", hero.secondary instanceof GunInfo ? hero.secondary : null, "idle2");
    putGun("gun", hero.weaponMod || null, "idle4");
    putGun("armor", hero.armorMod || null, "idle4", true);

    const btn = MenuPanels.button;
    if (SD.heroes.length > 1 && SD.stages.length > 3) {
      const b = new PartButton(btn, btn.m[4], btn.m[5]);
      b.scale.set(btn.m[0], btn.m[3]);
      this.rightLive.addChild(b);
      this.dismiss = b;
    }

    this.statusView.visible = hero.status <= 300;
    if (this.statusTxt) {
      this.statusTxt.text = hero.status <= 300 ? band.label : "";
      this.statusTxt.style.fill = band.color;
    }

    this.hoverables = [];
    const clsField = MenuPanels.field("txt_class");
    if (clsField) {
      this.hoverables.push({
        id: "$class", x: clsField.m[4] - 10, y: clsField.m[5] - 4, w: 210, h: 22,
        title: cls.name, desc: cls.desc,
      });
    }
    for (const stat of STATS) {
      const m = MenuPanels.item(`bar1_${stat}`);
      if (!m) continue;
      this.hoverables.push({
        id: STAT_INFO_ID[stat], x: m[4] - 45, y: m[5] - 5, w: 200, h: 20,
      });
    }
    for (const [name, item] of [
      ["trait", hero.trait], ["flaw", hero.flaw], ["streak", hero.streak],
    ] as const) {
      const m = MenuPanels.item(name);
      if (!m) continue;
      const p = Perks.itemOb[item];
      this.hoverables.push({
        id: "$perk", x: m[4] - 35, y: m[5] - 25, w: 70, h: 50,
        title: p?.name, desc: p?.desc,
      });
    }
    for (let slot = 0; slot < 3; slot++) {
      const unlocked = hero.level >= (slot + 1) * 5;
      const pair = hero.perks[slot];
      for (let choice = 0; choice < 2; choice++) {
        const m = MenuPanels.item(`perk${slot}${choice}`);
        if (!m || !pair) continue;
        const id = unlocked ? (choice === 0 ? pair[0] : pair[1]) : `lock${slot}`;
        const p = Perks.itemOb[id];
        this.hoverables.push({
          id: "$perk", x: m[4] - 35, y: m[5] - 25, w: 70, h: 50,
          title: p?.name, desc: p?.desc,
        });
      }
    }

    this.deck?.refresh();
  }

  private selMarker(): Sprite | null {
    const place = UI.box.place.idle4?.find((p) => p.name === "sel");
    if (!place) return null;
    const sp = partSprite(MenuPanels.sel);
    sp.scale.set(place.m[0] / MenuPanels.scale, place.m[3] / MenuPanels.scale);
    sp.position.set(place.m[4], place.m[5]);
    return sp;
  }

  update(dt: number): void {
    if (partsEpoch() !== this.partsAt) {
      this.partsAt = partsEpoch();
      if (this.leftPlate) applyRec(this.leftPlate, MenuPanels.box("left"));
      if (this.rightPlate) applyRec(this.rightPlate, MenuPanels.box("right"));
      if (this.statusPlate) applyRec(this.statusPlate, MenuPanels.box("status"));
      this.refreshViews();
    }
    if (itemArtEpoch() !== this.itemsAt) {
      this.itemsAt = itemArtEpoch();
      this.refreshViews();
    }

    this.figure?.tick();

    const k = 1 - Math.pow(0.7, Math.max(0, dt) * 30);
    this.leftX += (LEFT_IN - this.leftX) * k;
    this.rightX += (RIGHT_IN - this.rightX) * k;
    this.leftBox.position.x = this.leftX;
    this.rightBox.position.x = this.rightX;

    const hero = SD.selectedHero;
    const cls = Classes.itemOb[hero.cls];
    const barRec = MenuRig.bar;

    for (const stat of STATS) {
      const target = Classes.getStat(hero.level, hero.cls, stat);
      this.tempOb[stat] += (target - this.tempOb[stat]) * k;
      const t = this.statsText[stat];
      if (t) {
        const shown = String(Math.round(this.tempOb[stat]));
        if (t.text !== shown) t.text = shown;
      }
      const max = BAR_MAX[stat];
      const b1 = this.bars[`bar1_${stat}`];
      const b2 = this.bars[`bar2_${stat}`];
      this.barW[`bar1_${stat}`] += (target / max * 150 - this.barW[`bar1_${stat}`]) * k;
      this.barW[`bar2_${stat}`] += (cls[stat][1] / max * 150 - this.barW[`bar2_${stat}`]) * k;
      if (b1) {
        if (b1.texture !== MenuRig.texture(barRec)) b1.texture = MenuRig.texture(barRec);
        b1.width = Math.max(0, this.barW[`bar1_${stat}`]);
      }
      if (b2) {
        if (b2.texture !== MenuRig.texture(barRec)) b2.texture = MenuRig.texture(barRec);
        b2.width = Math.max(0, this.barW[`bar2_${stat}`]);
      }
    }

    if (this.xpBar) {
      const tex = MenuRig.texture(barRec);
      if (this.xpBar.texture !== tex) this.xpBar.texture = tex;
      const frac = Math.max(0, Math.min(1, hero.exp / Classes.getNextExp(hero.level)));
      this.xpBar.width = frac * 215;
    }

    this.dismiss?.update();
    if (this.dismiss) {
      const [x, y, w, h] = this.dismiss.hitBox();
      this.dismiss.setState(hitTest(x + this.rightBox.x, y + this.rightBox.y, w, h)
        ? "over" : "up");
    }

    this.deck?.setOpen(localMouseY() + PAGE_TOP > 500);
    this.deck?.update(dt);

    for (const hv of this.hoverables) {
      const x = this.leftBox.x + hv.x;
      const y = this.leftBox.y + hv.y;
      if (hitTest(x, y, hv.w, hv.h)) {
        const id = hv.id === "$perk" ? "$class" : hv.id;
        this.host.tooltip.show(id, x, y, hv.w, hv.h, hv.title, hv.desc);
        break;
      }
    }
    this.registerFocus();
  }

  private registerFocus(): void {
    const hero = SD.selectedHero;
    for (let i = 1; i <= 6; i++) {
      const rec = MenuPanels.col(i);
      if (!rec) continue;
      focusable(this.leftBox.x + rec.m[4], this.leftBox.y + rec.m[5],
        rec.w * rec.m[0], rec.h * rec.m[3]);
    }
    for (let slot = 0; slot < 3; slot++) {
      if (hero.level < (slot + 1) * 5) continue;
      for (let choice = 0; choice < 2; choice++) {
        const m = MenuPanels.item(`perk${slot}${choice}`);
        if (!m || hero.perks[slot]?.[2] === choice + 1) continue;
        focusable(this.leftBox.x + m[4] - 36, this.leftBox.y + m[5] - 20, 72, 40);
      }
    }
    for (const [name, , state] of SLOT_BOXES) {
      const m = MenuPanels.item(name);
      const clip = UI.box.clip[state];
      if (!m || !clip) continue;
      focusable(this.rightBox.x + m[4] + clip[0] * m[0], this.rightBox.y + m[5] + clip[1] * m[3],
        clip[2] * m[0], clip[3] * m[3]);
    }
  }

  onClick(): void {
    if (this.deck?.pick()) return;

    const hero = SD.selectedHero;

    for (let i = 1; i <= 6; i++) {
      const rec = MenuPanels.col(i);
      if (!rec) continue;
      const x = this.leftBox.x + rec.m[4];
      const y = this.leftBox.y + rec.m[5];
      const w = rec.w * rec.m[0];
      const h = rec.h * rec.m[3];
      if (hitTest(x, y, w, h)) {
        hero.color = i;
        this.refreshViews();
        return;
      }
    }

    for (let slot = 0; slot < 3; slot++) {
      const unlocked = hero.level >= (slot + 1) * 5;
      for (let choice = 0; choice < 2; choice++) {
        const m = MenuPanels.item(`perk${slot}${choice}`);
        if (!m) continue;
        const pair = hero.perks[slot];
        if (!unlocked || pair?.[2] === choice + 1) continue;
        const x = this.leftBox.x + m[4] - 36;
        const y = this.leftBox.y + m[5] - 20;
        if (!hitTest(x, y, 72, 40)) continue;
        pair[2] = choice + 1;
        if (hero.hasUpgrade === slot) hero.hasUpgrade = -1;
        hero.initStats();
        this.refreshViews();
        return;
      }
    }

    for (const [name, slot, state] of SLOT_BOXES) {
      const m = MenuPanels.item(name);
      const clip = UI.box.clip[state];
      if (!m || !clip) continue;
      const x = this.rightBox.x + m[4] + clip[0] * m[0];
      const y = this.rightBox.y + m[5] + clip[1] * m[3];
      if (!hitTest(x, y, clip[2] * m[0], clip[3] * m[3])) continue;
      SH.playSound("S_Click");
      beginEquip(slot);
      this.host.goto("heroesInv");
      return;
    }

    if (this.dismiss) {
      const [x, y, w, h] = this.dismiss.hitBox();
      if (hitTest(x + this.rightBox.x, y + this.rightBox.y, w, h)) {
        SH.playSound("S_Click");
        this.host.openFire();
        return;
      }
    }
  }
}
