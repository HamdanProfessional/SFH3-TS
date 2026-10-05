import { Container, Graphics, Sprite, Text } from "pixi.js";
import { MenuPage } from "./MenuPage";
import { focusable, hitTest } from "../../ui/kit";
import { DESIGN_WIDTH, DESIGN_HEIGHT } from "../../core/Config";
import { ArtButton, fieldText, itemOf } from "../../ui/art";
import {
  itemCard, imgSprite, itemField, preloadItemArt, itemArtEpoch, tex,
  UI, CARD_W, CARD_H, STAGE_TOP,
} from "./InventoryPage";
import { SD, MAX_STATUS, STORE_SIZE, achHooks, type InvItem } from "../../state/SD";
import { SH } from "../../audio/SH";
import { GunInfo } from "../../game/GunInfo";
import * as Guns from "../../data/StatsGuns";
import * as Perks from "../../data/StatsPerks";
import { MAX_LVL, GUN_TYPE_NAMES } from "../../data/StatsMisc";
import { UT } from "../../core/UT";

function bag(...pairs: readonly (readonly [number, string])[]): string[] {
  const out: string[] = [];
  for (const [n, v] of pairs) for (let i = 0; i < n; i++) out.push(v);
  return out;
}

export const slotChance: readonly string[] = bag(
  [35, ""], [20, "item"], [4, "money"], [13, "poop"], [3, "feast"],
);

export const itemChance: readonly string[] = bag(
  [3, "sfh"], [5, "sky"], [8, "star"], [13, "gun"], [5, "attach"], [5, "armor"],
);

export const RARITY_FACE: readonly string[] = ["gun", "star", "sky", "sfh"];

export interface SpinFilter {
  kind: string;
  type: number;
  rarity: number;
}

export const ANY_SPIN: SpinFilter = { kind: "", type: -1, rarity: -1 };

export function normalizeFilter(f: SpinFilter): SpinFilter {
  return f.kind === "gun" ? f : { kind: f.kind, type: -1, rarity: -1 };
}

function faceMatches(face: string, f: SpinFilter): boolean {
  const rarity = RARITY_FACE.indexOf(face);
  const weapon = rarity >= 0;
  if (f.kind === "gun" ? !weapon : f.kind !== "" && f.kind !== face) return false;
  if (f.rarity >= 0 && weapon && rarity !== f.rarity) return false;
  return true;
}

export function filterFaces(f: SpinFilter): string[] {
  return itemChance.filter((face) => faceMatches(face, f));
}

export function builtOfType(built: readonly number[], type: number): number {
  if (type < 0) return built.length;
  let n = 0;
  for (const i of built) if (Guns.itemAr[i]?.type === type) n++;
  return n;
}

export function filterMult(f: SpinFilter, built: readonly number[]): number {
  const faces = filterFaces(f).length;
  if (!faces) return 0;
  let m = itemChance.length / faces;
  if (f.kind === "gun" && f.type >= 0) {
    const n = builtOfType(built, f.type);
    if (!n) return 0;
    m *= built.length / n;
  }
  return m;
}

export function axisMults(f: SpinFilter, built: readonly number[]):
[number, number, number] {
  const all = filterMult(f, built);
  const noType = filterMult({ ...f, type: -1 }, built);
  const noRarity = filterMult({ ...f, rarity: -1 }, built);
  const kindOnly = filterMult({ kind: f.kind, type: -1, rarity: -1 }, built);
  if (!all) return [0, 0, 0];
  return [kindOnly, all / noType, all / noRarity];
}

export const ITEM_ODDS =
  slotChance.length / slotChance.filter((x) => x === "item").length;

export function pickOdds(f: SpinFilter, built: readonly number[]): {
  now: number; was: number;
} {
  const m = filterMult(f, built);
  return { now: ITEM_ODDS, was: m > 0 ? ITEM_ODDS * m : Infinity };
}

export function slotCost(): number {
  return Math.trunc(UT.getCurvedRange(SD.getHighestLevel(), MAX_LVL, 70, 1000) * 0.8);
}

export function filteredCost(f: SpinFilter, built: readonly number[]): number {
  const m = filterMult(f, built);
  return m > 0 ? Math.ceil(slotCost() * m) : 0;
}

export function rollSlot(f: SpinFilter = ANY_SPIN): string {
  const first = UT.randEl(slotChance);
  if (first !== "item") return first;
  if (f.kind === "") return UT.randEl(itemChance);
  const faces = filterFaces(f);
  return faces.length ? UT.randEl(faces) : UT.randEl(itemChance);
}

export interface SlotPrize {
  item: InvItem | null;
  cash: number;
  feast: boolean;
}

export function slotPrize(result: string, cost: number,
                          f: SpinFilter = ANY_SPIN): SlotPrize {
  const itemLevel = Math.max(1, Math.min(MAX_LVL, SD.getHighestLevel() + UT.irand(-3, 0)));
  switch (result) {
    case "poop":
      return { item: UT.randEl(Perks.poopAr).id, cash: 0, feast: false };
    case "money":
      return { item: null, cash: cost * 2, feast: false };
    case "armor":
      return { item: UT.randEl(Perks.perkAr).id, cash: 0, feast: false };
    case "attach":
      return { item: UT.randEl(Perks.weapAr).id, cash: 0, feast: false };
    case "gun": case "star": case "sky": case "sfh": {
      const rarity = { gun: 0, star: 1, sky: 2, sfh: 3 }[result] as number;
      return {
        item: new GunInfo(
          Guns.getRandomGunId(SD.bpBuilt, f.kind === "gun" ? f.type : -1),
          itemLevel, rarity,
        ),
        cash: result === "sfh" ? cost * 2 : 0,
        feast: false,
      };
    }
    case "feast":
      return { item: null, cash: 0, feast: true };
    default:
      return { item: null, cash: 0, feast: false };
  }
}

function feastRoster(): void {
  for (const hero of SD.heroes) {
    hero.status = Math.min(MAX_STATUS, hero.status + 50);
  }
}

export function applySlotResult(result: string, cost: number,
                                f: SpinFilter = ANY_SPIN): void {
  const p = slotPrize(result, cost, f);
  if (p.item) SD.storeItem = p.item;
  if (p.cash) SD.setFunds(p.cash);
  if (p.feast) feastRoster();
}

export const BATCH_SIZES: readonly number[] = [1, 10, 100];

export interface SpinEntry {
  result: string;
  prize: SlotPrize;
}

export function rollBatch(cost: number, n: number,
                          f: SpinFilter = ANY_SPIN): SpinEntry[] {
  const out: SpinEntry[] = [];
  for (let i = 0; i < n; i++) {
    const result = rollSlot(f);
    out.push({ result, prize: slotPrize(result, cost, f) });
  }
  return out;
}

const RESULT_RANK: readonly string[] = [
  "sfh", "sky", "star", "gun", "attach", "armor", "money", "feast", "poop", "",
];

export function bestResult(entries: readonly SpinEntry[]): string {
  let best = "";
  let rank = RESULT_RANK.length;
  for (const e of entries) {
    const r = RESULT_RANK.indexOf(e.result);
    if (r >= 0 && r < rank) {
      rank = r;
      best = e.result;
    }
  }
  return best;
}

export interface BatchLine {
  result: string;
  n: number;
  cash: number;
  items: number;
}

export interface BatchReport {
  n: number;
  lines: BatchLine[];
  cash: number;
  items: number;
  sold: number;
}

export function batchReport(entries: readonly SpinEntry[]): BatchReport {
  const by = new Map<string, BatchLine>();
  let cash = 0;
  let items = 0;
  let sold = 0;
  for (const e of entries) {
    const isPoop = e.result === "poop" && e.prize.item !== null;
    const paid = e.prize.cash + (isPoop ? SD.sellPriceOf(e.prize.item as InvItem) : 0);
    let line = by.get(e.result);
    if (!line) {
      line = { result: e.result, n: 0, cash: 0, items: 0 };
      by.set(e.result, line);
    }
    line.n++;
    line.cash += paid;
    cash += paid;
    if (isPoop) {
      sold++;
    } else if (e.prize.item) {
      items++;
      line.items++;
    }
  }
  const lines = [...by.values()].sort(
    (a, b) => RESULT_RANK.indexOf(a.result) - RESULT_RANK.indexOf(b.result),
  );
  return { n: entries.length, lines, cash, items, sold };
}

export function commitBatch(entries: readonly SpinEntry[]): BatchReport {
  const report = batchReport(entries);
  for (const e of entries) {
    const p = e.prize;
    if (e.result === "poop" && p.item) {
      const price = SD.sellPriceOf(p.item);
      SD.setFunds(price);
      achHooks.check("sell", price);
      continue;
    }
    if (p.item) SD.mapItem.push(p.item);
    if (p.cash) SD.setFunds(p.cash);
    if (p.feast) feastRoster();
  }
  return report;
}

const RESULT_EXTRA: Readonly<Record<string, string>> = {
  sfh: "Now THAT is a weapon!",
  feast: "All Heroes healed by 1 day!",
};

const RESULT_TEXT: Readonly<Record<string, string>> = {
  "": "No luck.",
  poop: "Gross!",
  armor: "Armor Mod!",
  attach: "Weapon Mod!",
  gun: "Weapon!",
  star: "Refined!",
  sky: "Flawless!",
  sfh: "Perfect!",
  feast: "Feast!",
};

let lastSpinResult = "";
let slotDesc = "";

function openShift(i: number): [number, number] {
  const si = i * 2 + (i % 2);
  let dx = 0;
  let dy = 0;
  if ((si + 1) % 4 === 0) dx -= 20;
  if (si === 0 || si % 4 === 0) dx += 20;
  if (si < 4) dy += 60;
  if (si > 19) dy -= 30;
  return [dx, dy];
}

let slotOpen = false;
let settledFaces: string[] | null = null;
let spunFaces: string[] | null = null;

let spinning = false;
let spinT = 0;
let settling = false;
let settleT = 0;
let pending = "";
let pendingCost = 0;
let pendingFilter: SpinFilter = { ...ANY_SPIN };
let settledOnce = false;

let chooseOpen = false;
let batch: SpinEntry[] | null = null;
let batchShown: BatchReport | null = null;

let spinFilter: SpinFilter = { ...ANY_SPIN };
let batchIndex = 0;

interface Choice {
  label: string;
  value: string | number;
  fill?: number;
}

const KIND_CHOICES: readonly Choice[] = [
  { label: "Anything", value: "" },
  { label: "Weapon", value: "gun" },
  { label: "Weapon Mod", value: "attach" },
  { label: "Armor Mod", value: "armor" },
];

const RARITY_CHOICES: readonly Choice[] = [
  { label: "Any", value: -1 },
  ...[1, 2, 3].map((r) => ({
    label: Guns.RARITY[r].text, value: r, fill: Guns.RARITY[r].color,
  })),
];

const TYPE_CHOICES: readonly Choice[] = [
  { label: "Any", value: -1 },
  ...GUN_TYPE_NAMES.slice(0, 11).map((label, i) => ({ label, value: i })),
];

const SPIN_CHOICES: readonly Choice[] = BATCH_SIZES.map(
  (n) => ({ label: n === 1 ? "Once" : `×${n}`, value: n }),
);

function wrap(i: number, n: number): number {
  return ((i % n) + n) % n;
}

function stepType(at: number, d: number, built: readonly number[]): number {
  for (let k = 1; k <= TYPE_CHOICES.length; k++) {
    const o = TYPE_CHOICES[wrap(at + d * k, TYPE_CHOICES.length)];
    const v = o.value as number;
    if (v < 0 || builtOfType(built, v) > 0) return v;
  }
  return -1;
}

function mult(m: number): string {
  if (!m) return "—";
  return m < 1.05 ? "—" : `×${m < 10 ? m.toFixed(1) : Math.round(m)}`;
}

function oneIn(n: number): string {
  if (!isFinite(n)) return "never";
  return n < 20 ? n.toFixed(1) : UT.addNumCommas(Math.round(n));
}

const BATCH_TEXT: Readonly<Record<string, string>> = {
  "": "No luck",
  poop: "Poop, sold",
  money: "Jackpot",
  armor: "Armor Mod",
  attach: "Weapon Mod",
  gun: "Weapon",
  star: "Refined weapon",
  sky: "Flawless weapon",
  sfh: "PERFECT!",
  feast: "Feast",
};

const SHEET = {
  top: 51,
  ruleTop: 121.5,
  ruleBot: 493.5,
  rule: 2,
  bottom: 621.75,
  wash: 0x545454,
  washAlpha: 0.749,
  title: { x: 98, y: 139.75 },
  btnY: 448.35,
  btnH: 37,
  btnW: 108.2,
  btnSY: 0.74,
} as const;

const SHEET_BLEED = 700;

const BODY_TOP = 200;
const BODY_BOT = 440;
const LINE_H = 18;

interface SheetBtn {
  art: ArtButton;
  enabled: boolean;
  hit: [number, number, number, number];
}

interface FilterRow {
  btn: SheetBtn;
  prev: [number, number, number, number];
  next: [number, number, number, number];
  step: (d: number) => void;
}

function gameText(
  str: string, x: number, y: number,
  o: {
    font?: string; size?: number; fill?: number; alpha?: number;
    anchorX?: number; anchorY?: number;
  } = {},
): Text {
  const t = new Text({
    roundPixels: true,
    text: str,
    style: {
      fontFamily: [o.font ?? "QTypeSquare-Book", "Verdana", "sans-serif"],
      fontSize: o.size ?? 16,
      fill: o.fill ?? 0xffffff,
    },
  });
  t.anchor.set(o.anchorX ?? 0, o.anchorY ?? 0);
  t.position.set(x, y);
  t.alpha = o.alpha ?? 1;
  return t;
}

export class StorePage extends MenuPage {
  static enterFrame(): void {
    slotDesc = "";
    chooseOpen = false;
  }

  private cellHits: { x: number; y: number; i: number }[] = [];
  private spinBtn: ArtButton | null = null;
  private spinHit: [number, number, number, number] = [0, 0, 0, 0];
  private hoverIndex = -1;
  private reelFaces: Sprite[] = [];
  private artEpoch = -1;
  private sheetBtns: SheetBtn[] = [];
  private filterRows: FilterRow[] = [];
  private goBtn: SheetBtn | null = null;
  private cancelBtn: SheetBtn | null = null;
  private okBtn: SheetBtn | null = null;
  private hoverBtn = -1;

  build(w: number, h: number): void {
    preloadItemArt();
    this.artEpoch = itemArtEpoch();
    this.cellHits = [];
    this.reelFaces = [];
    this.spinBtn = null;
    this.sheetBtns = [];
    this.filterRows = [];
    this.goBtn = null;
    this.cancelBtn = null;
    this.okBtn = null;

    const L = UI.layout.store;

    for (let i = 0; i < STORE_SIZE && i < L.cards.length; i++) {
      const [cx, cy] = L.cards[i];
      this.cellHits.push({ x: cx - CARD_W / 2, y: cy - CARD_H / 2 - STAGE_TOP, i });
    }
    this.hoverIndex = this.computeHover();

    let lifted: Container | null = null;
    for (const c of this.cellHits) {
      if (c.i >= SD.storeItems.length) continue;
      const open = c.i === this.hoverIndex;
      const [dx, dy] = open ? openShift(c.i) : [0, 0];
      const v = itemCard(this.view, SD.storeItems[c.i], c.x + dx, c.y + dy, open,
                         SD.priceOf(SD.storeItems[c.i]));
      if (open) lifted = v;
    }
    if (lifted) this.view.setChildIndex(lifted, this.view.children.length - 1);

    const spin = lastSpinResult;
    const settled = settledOnce;

    const price = L.place.txt_slotPrice;
    if (price) {
      const t = fieldText(2708, { x: price[4], y: price[5] - STAGE_TOP });
      t.scale.set(price[0]);
      t.text = `$${UT.addNumCommas(slotCost())}`;
      this.view.addChild(t);
    }
    const cost = slotCost();
    const desc = L.place.txt_slotDesc;
    if (desc) {
      const t = fieldText(2709, { x: desc[4], y: desc[5] - STAGE_TOP });
      t.scale.set(desc[0]);
      if (SD.funds >= cost) {
        if (!slotDesc) {
          slotDesc = UT.randEl([
            "Test your luck!", "Spin to win!", "Give it a whirl!",
            "Spin it to win it!", "Just do it!", "You could win!",
            "A winner is you!",
          ]);
        }
        t.text = slotDesc;
        t.style.fill = 0xffcc00;
      } else {
        t.text = "Can not afford!";
        t.style.fill = 0xff6600;
      }
      this.view.addChild(t);
    }

    const bt = itemOf("store", "bt_slots");
    if (bt) {
      this.spinBtn = new ArtButton(bt.cid, bt.x, bt.y - STAGE_TOP, bt.sx, bt.sy);
      this.spinHit = [
        bt.x, bt.y - STAGE_TOP,
        50 * (L.place.bt_slots?.[0] ?? 1), 50 * (L.place.bt_slots?.[3] ?? 1),
      ];
      this.spinBtn.visible = SD.funds >= cost;
      this.view.addChild(this.spinBtn);
    }

    if (slotOpen) {
      const chrome = UI.slot.chrome ? UI.img[UI.slot.chrome] : undefined;
      if (chrome) {
        const sp = imgSprite(chrome);
        sp.position.set(0, -STAGE_TOP);
        this.view.addChild(sp);
      }
      const faces = settled
        ? (settledFaces ?? this.settleFaces(spin))
        : ["sfh", "sfh", "sfh"];
      for (let i = 0; i < UI.slot.reels.length; i++) {
        const [rx, ry] = UI.slot.reels[i];
        const sp = this.slotFace(faces[i] ?? "sfh", rx, ry);
        if (sp) this.view.addChild(sp);
      }
    }

    const rf = UI.slot.fields.txt_result;
    if (rf && settled && slotOpen) {
      const t = itemField(2741, { x: rf[0], y: rf[1] - STAGE_TOP });
      t.text = spin === "money" ? `+$${pendingCost * 2}` : (RESULT_TEXT[spin] ?? spin);
      this.view.addChild(t);
    }
    const xf = UI.slot.fields.txt_extra;
    const extra = RESULT_EXTRA[spin];
    if (xf && extra && slotOpen) {
      const t = itemField(2740, { x: xf[0], y: xf[1] - STAGE_TOP });
      t.text = extra;
      this.view.addChild(t);
    }

    if (chooseOpen) this.buildChooser();
    else if (batchShown) this.buildSummary(batchShown);
  }

  private sheet(): Container {
    const c = new Container();
    c.position.set(0, -STAGE_TOP);
    this.view.addChild(c);

    const dim = new Graphics();
    dim.rect(-SHEET_BLEED, 0, DESIGN_WIDTH + SHEET_BLEED * 2, DESIGN_HEIGHT)
      .fill({ color: 0x000000, alpha: 0.72 });
    c.addChild(dim);

    const rec = UI.img.gi_get;
    if (rec) c.addChild(imgSprite(rec));
    const g = new Graphics();
    this.sheetWing(g, -SHEET_BLEED, SHEET_BLEED);
    this.sheetWing(g, DESIGN_WIDTH, SHEET_BLEED);
    c.addChild(g);
    return c;
  }

  private sheetWing(g: Graphics, x: number, w: number): void {
    const S = SHEET;
    g.rect(x, S.top, w, S.ruleTop - S.top).fill({ color: 0x000000 });
    g.rect(x, S.ruleTop, w, S.rule).fill({ color: 0xffffff });
    g.rect(x, S.ruleTop + S.rule, w, S.ruleBot - S.ruleTop - S.rule)
      .fill({ color: S.wash, alpha: S.washAlpha });
    g.rect(x, S.ruleBot, w, S.rule).fill({ color: 0xffffff });
    g.rect(x, S.ruleBot + S.rule, w, S.bottom - S.ruleBot - S.rule)
      .fill({ color: 0x000000 });
  }

  private sheetTitle(into: Container, text: string): void {
    const t = itemField(2382, SHEET.title);
    t.text = text;
    into.addChild(t);
  }

  private sheetBtn(into: Container, text: string, cx: number, y: number,
                   w: number = SHEET.btnW, enabled = true,
                   right?: string): SheetBtn {
    const art = new ArtButton(2087, cx - w / 2, y, w / 50, SHEET.btnSY);
    art.alpha = enabled ? 1 : 0.45;
    into.addChild(art);
    const fill = enabled ? 0xffffff : 0xbfbfbf;
    const mid = y + SHEET.btnH / 2;
    const pad = 18;
    const labels = right === undefined
      ? [gameText(text, cx, mid, { anchorX: 0.5 })]
      : [gameText(text, cx - w / 2 + pad, mid, { anchorX: 0 }),
         gameText(right, cx + w / 2 - pad, mid, { anchorX: 1 })];
    for (let i = 0; i < labels.length; i++) {
      const t = labels[i];
      t.style.fontFamily = ["QTypeSquare-Bold", "Verdana", "sans-serif"];
      t.style.fontSize = 15;
      t.style.fill = i && enabled ? 0xffcc00 : fill;
      t.anchor.y = 0.5;
      t.style.stroke = { color: 0x000000, width: 3 };
      into.addChild(t);
    }
    const btn: SheetBtn = {
      art, enabled, hit: [cx - w / 2, y - STAGE_TOP, w, SHEET.btnH],
    };
    this.sheetBtns.push(btn);
    return btn;
  }

  private filterRow(
    into: Container, name: string, y: number, w: number,
    choices: readonly Choice[], at: number, enabled: boolean,
    right: string, step: (d: number) => void,
  ): void {
    const cx = DESIGN_WIDTH / 2;
    const art = new ArtButton(2087, cx - w / 2, y, w / 50, SHEET.btnSY);
    art.alpha = enabled ? 1 : 0.3;
    into.addChild(art);

    const mid = y + SHEET.btnH / 2;
    const pad = 16;
    const opt = choices[at] ?? choices[0];
    const fade = enabled ? 1 : 0.4;
    const put = (t: Text): void => {
      t.style.stroke = { color: 0x000000, width: 3 };
      t.anchor.y = 0.5;
      into.addChild(t);
    };
    put(gameText(name, cx - w / 2 + pad, mid,
                 { font: "QTypeSquare-Bold", size: 13, alpha: 0.7 * fade }));
    put(gameText(enabled ? `‹   ${opt.label}   ›` : opt.label, cx, mid, {
      font: "QTypeSquare-Bold", size: 15, anchorX: 0.5, alpha: fade,
      fill: enabled ? opt.fill ?? 0xffffff : 0xbfbfbf,
    }));
    put(gameText(right, cx + w / 2 - pad, mid, {
      font: "QTypeSquare-Bold", size: 13, anchorX: 1, alpha: fade,
      fill: right.startsWith("×") ? 0xffcc00 : 0xffffff,
    }));

    const x0 = cx - w / 2;
    const y0 = y - STAGE_TOP;
    const btn: SheetBtn = { art, enabled, hit: [x0, y0, w, SHEET.btnH] };
    this.sheetBtns.push(btn);
    this.filterRows.push({
      btn,
      prev: [x0, y0, w / 2, SHEET.btnH],
      next: [cx, y0, w / 2, SHEET.btnH],
      step,
    });
  }

  private buildChooser(): void {
    const c = this.sheet();
    const cx = DESIGN_WIDTH / 2;
    const built = SD.bpBuilt;
    const f = normalizeFilter(spinFilter);
    const W = 340;

    this.sheetTitle(c, "Slot Machine");
    c.addChild(gameText(`you have $${UT.addNumCommas(SD.funds)}`,
                        cx, 180, { size: 15, alpha: 0.8, anchorX: 0.5 }));

    const [mKind, mType, mRarity] = axisMults(f, built);
    const weapon = f.kind === "gun";
    const kindAt = Math.max(0, KIND_CHOICES.findIndex((o) => o.value === f.kind));
    const typeAt = Math.max(0, TYPE_CHOICES.findIndex((o) => o.value === f.type));
    const rarAt = Math.max(0, RARITY_CHOICES.findIndex((o) => o.value === f.rarity));

    this.filterRow(c, "PRIZE", 200, W, KIND_CHOICES, kindAt, true, mult(mKind),
                   (d) => {
                     const i = wrap(kindAt + d, KIND_CHOICES.length);
                     spinFilter = normalizeFilter(
                       { ...spinFilter, kind: KIND_CHOICES[i].value as string });
                   });
    this.filterRow(c, "WEAPON", 240, W, TYPE_CHOICES, typeAt, weapon, mult(mType),
                   (d) => {
                     spinFilter = { ...spinFilter, type: stepType(typeAt, d, built) };
                   });
    this.filterRow(c, "QUALITY", 280, W, RARITY_CHOICES, rarAt, weapon, mult(mRarity),
                   (d) => {
                     const i = wrap(rarAt + d, RARITY_CHOICES.length);
                     spinFilter = { ...spinFilter, rarity: RARITY_CHOICES[i].value as number };
                   });

    const cost = filteredCost(f, built);
    const n = BATCH_SIZES[batchIndex];
    const total = cost * n;
    this.filterRow(c, "SPINS", 320, W, SPIN_CHOICES, batchIndex, true,
                   cost ? `$${UT.addNumCommas(total)}` : "—",
                   (d) => { batchIndex = wrap(batchIndex + d, BATCH_SIZES.length); });

    const odds = pickOdds(f, built);
    const plain = f.kind === "";
    c.addChild(gameText(
      plain ? `1 spin in ${oneIn(odds.now)} pays an item`
        : `your pick: 1 spin in ${oneIn(odds.now)}  ·  unfiltered, 1 in ${oneIn(odds.was)}`,
      cx, 370, { size: 15, anchorX: 0.5, fill: 0xffcc00 }));
    c.addChild(gameText(
      cost ? "the other spins are still blanks, poop and cash"
        : "no blueprint built for that category",
      cx, 394, { size: 13, anchorX: 0.5, alpha: 0.65,
                 fill: cost ? 0xffffff : 0xff6600 }));

    const ok = cost > 0 && SD.funds >= total;
    this.goBtn = this.sheetBtn(c, n === 1 ? "SPIN" : `SPIN ×${n}`,
                               cx - 72, SHEET.btnY, 130, ok);
    this.cancelBtn = this.sheetBtn(c, "CANCEL", cx + 72, SHEET.btnY, 130);
  }

  private buildSummary(rep: BatchReport): void {
    const c = this.sheet();
    const cx = DESIGN_WIDTH / 2;
    const left = 255;
    const right = 545;

    this.sheetTitle(c, `${rep.n} Spins!`);
    c.addChild(gameText(`$${UT.addNumCommas(pendingCost * rep.n)} spent`,
                        cx, 186, { size: 16, alpha: 0.8, anchorX: 0.5 }));

    const blockH = rep.lines.length * LINE_H + 6 + 24 + 18;
    const y0 = BODY_TOP + Math.max(0, (BODY_BOT - BODY_TOP - blockH) / 2);

    for (let i = 0; i < rep.lines.length; i++) {
      const ln = rep.lines[i];
      const y = y0 + i * LINE_H;
      const win = ln.result !== "";
      c.addChild(gameText(`${BATCH_TEXT[ln.result] ?? ln.result}  ×${ln.n}`,
                          left, y, { size: 15, alpha: win ? 1 : 0.55 }));
      c.addChild(gameText(
        ln.cash ? `+$${UT.addNumCommas(ln.cash)}` : ln.items ? "collect" : "—",
        right, y,
        { size: 15, anchorX: 1, fill: ln.cash ? 0xffcc00 : 0xffffff,
          alpha: ln.cash ? 1 : 0.55 }));
    }

    const listEnd = y0 + rep.lines.length * LINE_H;
    const rule = new Graphics();
    rule.rect(left, listEnd + 5, right - left, 1)
      .fill({ color: 0xffffff, alpha: 0.35 });
    c.addChild(rule);

    const totalY = listEnd + 12;
    c.addChild(gameText("Winnings", left, totalY,
                        { font: "QTypeSquare-Bold", size: 18, fill: 0xffcc00 }));
    c.addChild(gameText(`+$${UT.addNumCommas(rep.cash)}`, right, totalY,
                        { font: "QTypeSquare-Bold", size: 18, fill: 0xffcc00,
                          anchorX: 1 }));
    c.addChild(gameText(
      rep.sold ? `${rep.items} to collect · ${rep.sold} sold as junk`
        : `${rep.items} to collect`,
      left, totalY + 26, { size: 13, alpha: 0.7 }));

    this.okBtn = this.sheetBtn(c, "COLLECT", cx, SHEET.btnY);
  }

  private startSpin(times: number): void {
    const f = normalizeFilter(spinFilter);
    const cost = filteredCost(f, SD.bpBuilt);
    const total = cost * times;
    if (!cost || SD.funds < total) {
      SH.playSound("S_Error");
      return;
    }
    pendingFilter = f;
    SH.playSound("S_SlotSpin");
    slotOpen = true;
    settledFaces = null;
    settledOnce = false;
    lastSpinResult = "";
    SD.setFunds(-total);
    achHooks.check("buy", total);
    pendingCost = cost;
    if (times > 1) {
      batch = rollBatch(cost, times, f);
      pending = bestResult(batch);
    } else {
      batch = null;
      pending = rollSlot(f);
    }
    spunFaces = this.settleFaces(pending);
    spinning = true;
    spinT = 45;
    this.host.refresh();
  }

  private slotFace(result: string, reelX: number, reelY: number): Sprite | null {
    const imgName = UI.slot.faces[result] ?? UI.slot.faces.gun;
    const rec = UI.img[imgName];
    if (!rec) return null;
    const sp = imgSprite(rec);
    sp.position.set(reelX + UI.slot.facePlace[0], reelY + UI.slot.facePlace[1] - STAGE_TOP);
    sp.width = rec.w;
    sp.height = rec.h;
    this.reelFaces.push(sp);
    return sp;
  }

  update(): void {
    if (itemArtEpoch() !== this.artEpoch) {
      this.host.refresh();
      return;
    }
    if (chooseOpen || batchShown) {
      this.pollSheetHover();
      if (chooseOpen && !batchShown) {
        for (const r of this.filterRows) {
          if (!r.btn.enabled) continue;
          focusable(...r.prev);
          focusable(...r.next);
        }
      }
      return;
    }
    if (this.spinBtn) focusable(...this.spinHit);
    if (spinning) {
      --spinT;
      if (spinT === 15 || spinT === 10 || spinT === 5) SH.playSound("S_SlotClick");
      const names = Object.keys(UI.slot.faces);
      for (let i = 0; i < this.reelFaces.length; i++) {
        const frozen = spunFaces && spinT <= 15 - i * 5 ? spunFaces[i] : undefined;
        const rec = frozen
          ? UI.img[UI.slot.faces[frozen] ?? UI.slot.faces.gun]
          : UI.img[UI.slot.faces[names[Math.floor(Math.random() * names.length)]]];
        if (rec) this.reelFaces[i].texture = tex(rec);
      }
      if (spinT === 5 && lastSpinResult === "") {
        lastSpinResult = pending;
        settledFaces = spunFaces;
        settledOnce = true;
        this.playResultCue(pending);
        this.host.refresh();
        return;
      }
      if (spinT <= 0) {
        spinning = false;
        lastSpinResult = pending;
        settledFaces = spunFaces ?? this.settleFaces(pending);
        settledOnce = true;
        settling = true;
        settleT = 30;
        this.host.refresh();
        return;
      }
    }
    if (settling && --settleT <= 0) {
      settling = false;
      if (batch) {
        batchShown = batchReport(batch);
        this.host.refresh();
        return;
      }
      applySlotResult(pending, pendingCost, pendingFilter);
      lastSpinResult = "";
      settledFaces = null;
      spunFaces = null;
      settledOnce = false;
      slotOpen = false;
      SD.save();
      this.host.refresh();
      return;
    }
    const h = this.computeHover();
    if (h !== this.hoverIndex) {
      this.hoverIndex = h;
      this.host.refresh();
    }
  }

  private pollSheetHover(): void {
    let over = -1;
    for (let i = 0; i < this.sheetBtns.length; i++) {
      const b = this.sheetBtns[i];
      const hit = b.enabled && hitTest(...b.hit);
      b.art.setState(hit ? "over" : "up");
      if (hit) over = i;
    }
    this.hoverBtn = over;
  }

  private took(b: SheetBtn | null): boolean {
    if (!b || !b.enabled || !hitTest(...b.hit)) return false;
    SH.playSound("S_Click");
    return true;
  }

  private computeHover(): number {
    for (const c of this.cellHits) {
      if (c.i < SD.storeItems.length && hitTest(c.x, c.y, CARD_W, CARD_H)) return c.i;
    }
    return -1;
  }

  private settleFaces(result: string): string[] {
    const names = Object.keys(UI.slot.faces);
    if (result !== "") return [result, result, result];
    const pick = (): string => names[Math.floor(Math.random() * names.length)];
    const a = pick();
    const b = pick();
    let c = pick();
    while (a === b && b === c) c = pick();
    return [a, b, c];
  }

  private playResultCue(result: string): void {
    switch (result) {
      case "": break;
      case "poop": SH.playSound("S_Fart"); break;
      case "money": SH.playSound("S_Buy"); break;
      case "sfh": SH.playSound("S_Win3"); break;
      default: SH.playSound("S_Win1");
    }
  }

  onClick(): void {
    if (batchShown) {
      if (this.took(this.okBtn)) this.collectBatch();
      return;
    }
    if (chooseOpen) {
      for (const r of this.filterRows) {
        if (!r.btn.enabled) continue;
        const d = hitTest(...r.prev) ? -1 : hitTest(...r.next) ? 1 : 0;
        if (!d) continue;
        SH.playSound("S_Click");
        r.step(d);
        this.host.refresh();
        return;
      }
      if (this.took(this.goBtn)) {
        chooseOpen = false;
        this.startSpin(BATCH_SIZES[batchIndex]);
        return;
      }
      if (this.took(this.cancelBtn)) {
        chooseOpen = false;
        this.host.refresh();
      }
      return;
    }
    for (const c of this.cellHits) {
      if (c.i < SD.storeItems.length && hitTest(c.x, c.y, CARD_W, CARD_H)) {
        SH.playSound("S_Click");
        this.host.openTransaction(SD.storeItems[c.i], "buy");
        return;
      }
    }
    if (this.spinBtn && hitTest(...this.spinHit)) {
      if (spinning || settling) return;
      if (SD.funds < slotCost()) {
        SH.playSound("S_Error");
        return;
      }
      SH.playSound("S_Click");
      chooseOpen = true;
      this.host.refresh();
      return;
    }
  }

  private collectBatch(): void {
    if (batch) commitBatch(batch);
    batch = null;
    batchShown = null;
    lastSpinResult = "";
    settledFaces = null;
    spunFaces = null;
    settledOnce = false;
    slotOpen = false;
    SD.save();
    this.host.refresh();
  }
}

