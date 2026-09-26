import { Container, Graphics } from "pixi.js";
import { MenuPage } from "./MenuPage";
import { Button, COLOR, focusable, label, hitTest } from "../../ui/kit";
import {
  imgSprite, itemBoxView, itemField, preloadItemArt, itemArtEpoch, UI,
  STAGE_TOP, gunArt, blueprintGun,
} from "./InventoryPage";
import { ArtButton, itemOf } from "../../ui/art";
import { CRAFT_ODDS, SD } from "../../state/SD";
import { MAX_LVL } from "../../data/StatsMisc";
import { SH } from "../../audio/SH";
import { GunInfo, getUpgradeCost, upgradeGun } from "../../game/GunInfo";
import * as Guns from "../../data/StatsGuns";
import { UT } from "../../core/UT";

const ROWS_PER_PAGE = 5;
const ROW_W = 181;
const ROW_H = 76;
const ROW_STEP = 81;
const ROW_LEFT = 6;
const ROW_TOP = 6;
const HEAD_H = 20;
const ART = { w: 104, h: 37, cx: 58, cy: 39.5, grow: 2 };
const PILL = { x: 120, y: 31, w: 55, h: 24 };
const ART_SCALE = 0.965 * 1.6296;
const PANE_W = 193;
const PANE_H = 442;
const FOOT_H = 32;

export const BP_LIST = {
  perPage: ROWS_PER_PAGE, w: ROW_W, h: ROW_H, step: ROW_STEP,
  left: ROW_LEFT, top: ROW_TOP, head: HEAD_H,
  art: ART, pill: PILL, paneW: PANE_W, paneH: PANE_H, footH: FOOT_H,
} as const;

const PANE_START = 805;
const PANE_EASE = 0.3;
const UP_BT = { x: 5.45, y: -0.1, sx: 2.6465, sy: 1.7787 };
const UP_STARS = { x: 19.2, y: 3.3 };
const UP_DESC = { x: -170.25, y: 14.9 };
const UP_COST = { x: -34.3, y: 69.2, s: 0.7366 };

const enum Tier { Owned = 1, Built = 2, Other = 0 }

let wsSelGun: GunInfo | null = null;

export function setWorkshopGun(g: GunInfo | null): void {
  wsSelGun = g;
}
export function workshopGun(): GunInfo | null {
  return wsSelGun;
}

function stillOwned(g: GunInfo): boolean {
  for (let cat = 0; cat <= 10; cat++) {
    if ((SD.items[cat] ?? []).includes(g)) return true;
  }
  return false;
}
let wsLastRoll = "";
let wsCraft: { bpNum: number; level: number } | null = null;
const CRAFT_W = 380;
const CRAFT_H = 304;
const CRAFT_STEPS = [-5, -1, 1, 5] as const;
let wsBpPage = 0;
let wsPaneX = PANE_START;

interface BpRow {
  bpNum: number;
  tier: Tier;
}

export class WorkshopPage extends MenuPage {
  static enterFrame(): void {
    wsPaneX = PANE_START;
    wsCraft = null;
  }

  private bpRows: BpRow[] = [];
  private bpHits: {
    x: number; y: number; w: number; h: number; row: BpRow; glow: Graphics;
  }[] = [];
  private bpPrev: Button | null = null;
  private bpNext: Button | null = null;

  private weaponBox: ArtButton | null = null;

  private slide: { obj: Container; restX: number }[] = [];
  private paneDx = 0;

  private upHit: [number, number, number, number] = [0, 0, 0, 0];
  private upLive = false;

  private artEpoch = -1;

  private pageW = 800;
  private pageH = 450;
  private craftBtns: { b: Button; step: number }[] = [];
  private craftGo: Button | null = null;

  private craftCancel: Button | null = null;

  private get bpPage(): number { return wsBpPage; }
  private set bpPage(v: number) { wsBpPage = v; }

  private get selGun(): GunInfo | null {
    return wsSelGun;
  }

  private set selGun(v: GunInfo | null) {
    wsSelGun = v;
  }

  private get lastRoll(): string {
    return wsLastRoll;
  }

  private set lastRoll(v: string) {
    wsLastRoll = v;
  }

  build(w: number, h: number): void {
    this.pageW = w;
    this.pageH = h;
    this.craftBtns = [];
    this.craftGo = this.craftCancel = null;
    preloadItemArt();
    this.artEpoch = itemArtEpoch();
    this.bpHits = [];
    this.slide = [];
    this.bpPrev = this.bpNext = null;
    this.weaponBox = null;
    this.upLive = false;

    SD.rebuildBpOther();
    this.bpRows = [
      ...SD.bpOwned.map((n) => ({ bpNum: n, tier: Tier.Owned })),
      ...SD.bpBuilt.map((n) => ({ bpNum: n, tier: Tier.Built })),
      ...SD.bpOther.map((n) => ({ bpNum: n, tier: Tier.Other })),
    ];

    if (this.selGun && !stillOwned(this.selGun)) this.selGun = null;

    this.buildWeaponBox();
    this.buildUpgradeBox();
    this.buildBlueprintList();
    if (wsCraft && !SD.bpBuilt.includes(wsCraft.bpNum)) wsCraft = null;
    if (wsCraft) this.buildCraft(wsCraft.bpNum, wsCraft.level);
  }

  private buildWeaponBox(): void {
    const at = UI.layout.workshop.weapon ?? [144.45, 219.9];
    if (this.selGun) {
      const v = itemBoxView(this.selGun, "open2", {});
      v.position.set(at[0], at[1] - STAGE_TOP);
      this.view.addChild(v);
    }
    if (SD.stages.length <= 3) return;
    const wb = itemOf("workshop", "weaponbox");
    if (!wb) return;
    this.weaponBox = new ArtButton(wb.cid, wb.x, wb.y - STAGE_TOP, wb.sx, wb.sy);
    this.view.addChild(this.weaponBox);
  }

  private buildUpgradeBox(): void {
    const at = UI.layout.workshop.upgradebox ?? [67.45, 330.5];
    const px = at[0], py = at[1] - STAGE_TOP;
    const gun = this.selGun;
    let frame: number;
    if (!gun) frame = 2;
    else if (gun.upgradeAmt === 5) frame = 3;
    else if (SD.stages.length <= 3) frame = 4;
    else frame = 1;

    const rec = UI.img[`upgradebox_${frame}`];
    if (rec) {
      const sp = imgSprite(rec);
      sp.position.set(px, py);
      this.view.addChild(sp);
    }
    if (!gun || frame !== 1) return;

    const stars = UI.img[`upstar_${gun.upgradeAmt + 1}`];
    if (stars) {
      const sp = imgSprite(stars);
      sp.position.set(px + UP_STARS.x, py + UP_STARS.y);
      this.view.addChild(sp);
    }

    const cost = getUpgradeCost(gun);
    const poor = SD.funds < cost;
    const desc = itemField(2747, { x: px + UP_DESC.x, y: py + UP_DESC.y });
    desc.text = poor
      ? "Low Funds"
      : `${Math.round(Guns.getUpgradeChance(gun.upgradeAmt) * 100)}% odds`;
    desc.style.fill = poor ? 0xff3300 : 0xffcc00;
    this.view.addChild(desc);

    const costT = itemField(2746, { x: px + UP_COST.x, y: py + UP_COST.y });
    costT.scale.set(UP_COST.s);
    costT.text = `$${UT.addNumCommas(cost)}`;
    this.view.addChild(costT);

    this.upLive = !poor;
    this.upHit = [px + UP_BT.x, py + UP_BT.y, 50 * UP_BT.sx, 50 * UP_BT.sy];

    if (this.lastRoll) {
      const ok = this.lastRoll === "Success!";
      const d = UI.img[ok ? "updisplay_ok" : "updisplay_fail"];
      const dAt = UI.layout.workshop.upgradedisplay ?? at;
      if (d) {
        const sp = imgSprite(d);
        sp.position.set(dAt[0], dAt[1] - STAGE_TOP);
        this.view.addChild(sp);
      }
    }
  }

  private buildBlueprintList(): void {
    const pane = UI.layout.workshop.scrollpane ?? [607.05, 124.15];
    const paneX = pane[0], paneY = pane[1] - STAGE_TOP;
    const paneW = PANE_W, paneH = PANE_H;

    const sheet = new Graphics();
    sheet.rect(paneX, paneY, paneW, paneH).fill({ color: 0xffffff });
    this.view.addChild(sheet);
    const holder = new Container();
    const mask = new Graphics();
    mask.rect(paneX, paneY, paneW, paneH).fill({ color: 0xffffff });
    holder.addChild(mask);
    this.view.addChild(holder);
    holder.mask = mask;
    this.slide.push({ obj: sheet, restX: 0 }, { obj: holder, restX: 0 });

    const pages = Math.max(1, Math.ceil(this.bpRows.length / ROWS_PER_PAGE));
    if (this.bpPage >= pages) this.bpPage = pages - 1;

    const start = this.bpPage * ROWS_PER_PAGE;
    for (let i = 0; i < ROWS_PER_PAGE; i++) {
      const row = this.bpRows[start + i];
      if (!row) break;
      const rx = paneX + ROW_LEFT;
      const ry = paneY + ROW_TOP + i * ROW_STEP;
      const { card, glow } = this.bpCard(row);
      card.position.set(rx, ry);
      holder.addChild(card);
      if (glow) {
        this.bpHits.push({ x: rx, y: ry, w: ROW_W, h: ROW_H, row, glow });
      }
    }

    if (pages > 1) {
      const footH = FOOT_H;
      const footY = paneY + paneH - footH;
      const foot = new Graphics();
      foot.rect(paneX, footY, paneW, footH).fill({ color: 0x000000, alpha: 0.7 });
      foot.rect(paneX, footY, paneW, 1).fill({ color: 0x7e7c80 });
      this.view.addChild(foot);
      this.slide.push({ obj: foot, restX: 0 });

      const by = footY + 3;
      this.bpPrev = new Button("<", paneX + 4, by, 34, 26, 11);
      this.bpNext = new Button(">", paneX + paneW - 38, by, 34, 26, 11);
      this.bpPrev.setEnabled(this.bpPage > 0);
      this.bpNext.setEnabled(this.bpPage < pages - 1);
      this.view.addChild(this.bpPrev);
      this.view.addChild(this.bpNext);
      const count = label(
        `${this.bpPage + 1} / ${pages}`, paneX + paneW / 2 - 16, by + 7,
        { fontSize: 10, fill: COLOR.dim },
      );
      this.view.addChild(count);
      for (const o of [this.bpPrev, this.bpNext, count]) {
        this.slide.push({ obj: o, restX: o.x });
      }
    }
    this.applySlide();
  }

  private bpCard(row: BpRow): { card: Container; glow: Graphics | null } {
    const stats = Guns.itemAr[row.bpNum];
    const locked = row.tier === Tier.Other;
    const buildable = row.tier === Tier.Owned;
    const price = Guns.getBlueprintPrice(stats.costMod);
    const poor = SD.funds < price;
    const craftable = row.tier === Tier.Built;

    const card = new Container();
    const head = buildable ? COLOR.active : locked ? 0x39414b : COLOR.panel;
    const body = locked ? 0xdfe1e4 : buildable ? 0xf7f8f9 : 0xe7e9eb;
    const edge = buildable ? 0xc79f00 : 0xbcc1c7;

    const g = new Graphics();
    g.roundRect(0, 0, ROW_W, ROW_H, 4).fill({ color: body })
      .stroke({ color: edge, width: 1 });
    g.roundRect(0, 0, ROW_W, HEAD_H, 4).fill({ color: head });
    g.rect(0, HEAD_H - 4, ROW_W, 4).fill({ color: head });
    card.addChild(g);

    card.addChild(label(
      locked ? `BLUEPRINT ${row.bpNum + 1}` : stats.name.toUpperCase(), 8, 4,
      {
        fontSize: 11, fontWeight: "bold",
        fill: buildable ? 0x1b2129 : locked ? 0x9aa4b0 : COLOR.text,
      },
    ));

    if (locked) {
      const miss = label("NOT FOUND", ROW_W / 2, HEAD_H + 20,
        { fontSize: 12, fontWeight: "bold", fill: 0x9aa4b0 });
      miss.anchor.set(0.5, 0);
      card.addChild(miss);
      return { card, glow: null };
    }

    const art = gunArt(blueprintGun(stats.id), ART_SCALE, ART);
    if (art) card.addChild(art);
    card.addChild(label(Guns.getGunType(stats.type), 8, ROW_H - 15,
      { fontSize: 9, fill: 0x6b7480 }));

    const pill = new Graphics();
    pill.roundRect(PILL.x, PILL.y, PILL.w, PILL.h, 3)
      .fill({ color: COLOR.panel });
    card.addChild(pill);
    const state = label(
      buildable ? `$${UT.addNumCommas(price)}` : craftable ? "CRAFT" : "BUILT",
      PILL.x + PILL.w / 2, PILL.y + 5,
      {
        fontSize: buildable ? 12 : 11, fontWeight: "bold",
        fill: craftable ? COLOR.active
          : !buildable ? 0x9aa4b0 : poor ? COLOR.critical : COLOR.active,
      },
    );
    state.anchor.set(0.5, 0);
    card.addChild(state);

    if (!buildable && !craftable) return { card, glow: null };

    const glow = new Graphics();
    glow.roundRect(0, 0, ROW_W, ROW_H, 4)
      .fill({ color: 0xffffff, alpha: 0.16 })
      .stroke({ color: COLOR.active, width: 2 });
    glow.visible = false;
    card.addChild(glow);
    return { card, glow };
  }

  private buildCraft(bpNum: number, level: number): void {
    const gun = SD.craftGun(bpNum, level, 0);
    const price = SD.craftPrice(bpNum, level);
    const full = SD.items[gun.stats.type].length >= SD.itemCap();
    const poor = SD.funds < price;

    const veil = new Graphics();
    veil.rect(0, 0, this.pageW, this.pageH).fill({ color: 0x000000, alpha: 0.6 });
    this.view.addChild(veil);

    const x = Math.round((this.pageW - CRAFT_W) / 2);
    const y = Math.round((this.pageH - CRAFT_H) / 2);
    const rims = new Graphics();
    const frame = (fx: number, fy: number, fw: number, fh: number): void => {
      rims.rect(fx - 1, fy - 1, fw + 2, fh + 2).stroke({ color: 0x7e7c80, width: 1 });
    };
    const g = new Graphics();
    g.rect(x, y, CRAFT_W, CRAFT_H).fill({ color: 0x1c1c1e, alpha: 0.97 });
    g.rect(x, y, CRAFT_W, 26).fill({ color: 0x000000 });
    g.rect(x, y + 26, CRAFT_W, 2).fill({ color: 0x7e7c80 });
    this.view.addChild(g);

    this.view.addChild(label(`CRAFT ${gun.stats.name.toUpperCase()}`, x + 10, y + 6,
      { fontSize: 13, fontWeight: "bold", fill: COLOR.active }));
    const cat = label(Guns.getGunType(gun.stats.type), x + CRAFT_W - 10, y + 8,
      { fontSize: 10, fill: COLOR.dim });
    cat.anchor.set(1, 0);
    this.view.addChild(cat);

    const art = gunArt(gun, ART_SCALE, { w: 150, h: 62, cx: x + 95, cy: y + 82, grow: 2 });
    if (art) this.view.addChild(art);

    const st = gun.stats;
    const lines: [string, string][] = [
      ["Level", `${gun.level}  (as Normal)`],
      ["DPS", String(Math.ceil(st.dmg * st.rps))],
      ["Impact", String(Math.round(st.dmgBase))],
      ["Fire rate", String(Math.round(st.rps * 3))],
      ["Ammo", String(Math.round(st.clipSize))],
    ];
    lines.forEach(([k, v], i) => {
      const ly = y + 40 + i * 17;
      this.view.addChild(label(k, x + 200, ly, { fontSize: 11, fill: COLOR.dim }));
      const t = label(v, x + CRAFT_W - 12, ly, { fontSize: 11, fontWeight: "bold", fill: COLOR.text });
      t.anchor.set(1, 0);
      this.view.addChild(t);
    });

    const rowY = y + 136;
    const bw = 44, gap = 6, mid = 80;
    const rowW = bw * 4 + gap * 4 + mid;
    let bx = x + (CRAFT_W - rowW) / 2;
    CRAFT_STEPS.forEach((step, i) => {
      if (i === 2) {
        const lv = label(`LV ${level}`, bx + mid / 2, rowY + 5,
          { fontSize: 15, fontWeight: "bold", fill: COLOR.text });
        lv.anchor.set(0.5, 0);
        this.view.addChild(lv);
        bx += mid + gap;
      }
      const b = new Button(step > 0 ? `+${step}` : String(step), bx, rowY, bw, 28, 12);
      b.setEnabled(step > 0 ? level < MAX_LVL : level > 1);
      frame(bx, rowY, bw, 28);
      this.view.addChild(b);
      this.craftBtns.push({ b, step });
      bx += bw + gap;
    });

    const rarY = y + 172;
    const head = label("RARITY IS ROLLED", x + CRAFT_W / 2, rarY,
      { fontSize: 10, fontWeight: "bold", fill: COLOR.dim });
    head.anchor.set(0.5, 0);
    this.view.addChild(head);
    const odds = CRAFT_ODDS();
    const gapO = 12;
    for (const [row, list] of [odds.slice(0, 3), odds.slice(3)].entries()) {
      const ts = list.map((o) => {
        const t = label(`${Guns.RARITY[o.rarity].text} ${Math.round(o.chance * 100)}%`, 0,
          rarY + 15 + row * 14,
          { fontSize: 10, fontWeight: "bold", fill: Guns.RARITY[o.rarity].color });
        this.view.addChild(t);
        return t;
      });
      const rowO = ts.reduce((n, t) => n + t.width, 0) + gapO * (ts.length - 1);
      let ox = x + (CRAFT_W - rowO) / 2;
      for (const t of ts) { t.x = ox; ox += t.width + gapO; }
    }

    const priceT = label(`$${UT.addNumCommas(price)}`, x + CRAFT_W / 2, y + 226,
      { fontSize: 16, fontWeight: "bold", fill: poor ? COLOR.critical : COLOR.active });
    priceT.anchor.set(0.5, 0);
    this.view.addChild(priceT);
    const note = full ? `Your ${Guns.getGunType(gun.stats.type)} slots are full.`
      : poor ? "Low Funds" : "Higher levels cost more. The rarity is luck.";
    const noteT = label(note, x + CRAFT_W / 2, y + 248,
      { fontSize: 10, fill: full || poor ? COLOR.critical : COLOR.dim });
    noteT.anchor.set(0.5, 0);
    this.view.addChild(noteT);

    const by = y + CRAFT_H - 38;
    frame(x + 12, by, 110, 28);
    frame(x + CRAFT_W - 122, by, 110, 28);
    this.craftCancel = new Button("Cancel", x + 12, by, 110, 28, 12);
    this.craftGo = new Button("Craft", x + CRAFT_W - 122, by, 110, 28, 12);
    this.craftGo.setEnabled(!full && !poor);
    this.craftGo.setActive(!full && !poor);
    this.view.addChild(rims, this.craftCancel, this.craftGo);
  }

  private applySlide(): void {
    const rest = UI.layout.workshop.scrollpane?.[0] ?? 607.05;
    if (Math.abs(wsPaneX - rest) < 0.5) wsPaneX = rest;
    this.paneDx = wsPaneX - rest;
    for (const s of this.slide) s.obj.x = s.restX + this.paneDx;
  }

  update(): void {
    if (itemArtEpoch() !== this.artEpoch) {
      this.host.refresh();
      return;
    }
    if (wsCraft) {
      for (const { b } of this.craftBtns) b.update();
      this.craftCancel?.update();
      this.craftGo?.update();
      for (const b of this.craftBtns.map((c) => c.b).concat(this.craftGo ? [this.craftGo] : [])) {
        if (b && b.visible) focusable(b.x, b.y, b.w, b.h);
      }
      return;
    }
    const rest = UI.layout.workshop.scrollpane?.[0] ?? 607.05;
    if (wsPaneX !== rest) {
      wsPaneX += (rest - wsPaneX) * PANE_EASE;
      this.applySlide();
    }
    this.bpPrev?.update();
    this.bpNext?.update();
    for (const hit of this.bpHits) {
      const on = hitTest(hit.x + this.paneDx, hit.y, hit.w, hit.h);
      if (hit.glow.visible !== on) hit.glow.visible = on;
    }
    if (this.weaponBox) {
      const [x, y, w, h] = this.weaponBox.hitBox();
      this.weaponBox.setState(hitTest(x, y, w, h) ? "over" : "up");
    }
    if (this.upLive && this.selGun) focusable(...this.upHit);
  }

  onClick(): void {
    if (wsCraft) {
      this.clickCraft(wsCraft);
      return;
    }
    if (this.weaponBox) {
      const [x, y, w, h] = this.weaponBox.hitBox();
      if (hitTest(x, y, w, h)) {
        SH.playSound("S_Click");
        this.lastRoll = "";
        this.host.goto("workshopInv");
        return;
      }
    }
    for (const hit of this.bpHits) {
      if (hitTest(hit.x + this.paneDx, hit.y, hit.w, hit.h)) {
        SH.playSound("S_Click");
        if (hit.row.tier === Tier.Built) {
          wsCraft = {
            bpNum: hit.row.bpNum,
            level: Math.max(1, Math.min(MAX_LVL, SD.getHighestLevel())),
          };
          this.host.refresh();
          return;
        }
        this.host.openBuild(hit.row.bpNum);
        return;
      }
    }
    if (this.bpPrev?.hit()) { this.bpPage--; this.host.refresh(); return; }
    if (this.bpNext?.hit()) { this.bpPage++; this.host.refresh(); return; }

    if (this.upLive && this.selGun && hitTest(...this.upHit)) {
      const cost = getUpgradeCost(this.selGun);
      SD.setFunds(-cost);
      const ok = upgradeGun(this.selGun);
      SH.playSound(ok ? "S_Skill" : "S_Error");
      this.lastRoll = ok ? "Success!" : "Failed.";
      SD.save();
      this.host.refresh();
    }
  }

  private clickCraft(c: { bpNum: number; level: number }): void {
    for (const { b, step } of this.craftBtns) {
      if (b.activate()) {
        c.level = Math.max(1, Math.min(MAX_LVL, c.level + step));
        this.host.refresh();
        return;
      }
    }
    if (this.craftCancel?.activate()) {
      wsCraft = null;
      this.host.refresh();
      return;
    }
    if (this.craftGo?.hit()) {
      const r = SD.craftBlueprint(c.bpNum, c.level);
      SH.playSound(r === 0 ? "S_Buy" : "S_Error");
      if (r !== 0) return;
      wsCraft = null;
      SD.save();
      this.host.refresh();
    }
  }
}
