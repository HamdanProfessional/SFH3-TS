import { Assets, Container, Graphics, Sprite, Text, TextStyle, Texture } from "pixi.js";
import type { TextStyleOptions } from "pixi.js";
import { MenuPage } from "./MenuPage";
import { focusable, hitTest } from "../../ui/kit";
import { Focus } from "../../core/Focus";
import { SH } from "../../audio/SH";
import { MenuRig, rigEpoch } from "../../assets/MenuRig";
import { fillCache } from "../../assets/menuParts";
import { SD, MAX_ITEMS, STORAGE_STEP, type InvItem } from "../../state/SD";
import { GunInfo } from "../../game/GunInfo";
import * as Guns from "../../data/StatsGuns";
import * as Perks from "../../data/StatsPerks";
import { UT } from "../../core/UT";
import ui from "../../assets/itemUi.json";

export const STAGE_TOP = 64;

export interface ImgRec {
  file: string;
  w: number; h: number;
  ox: number; oy: number;
  s?: number;
}

export function imgUnit(rec: ImgRec): number {
  return 1 / (rec.s ?? UI.scale);
}

interface Place {
  name: string;
  cid?: number | null;
  m: number[];
}

interface TextSpec2 {
  cid: number;
  x: number; y: number; w: number; h: number;
  size?: number;
  font?: string;
  color?: number;
  alpha?: number;
  align?: "left" | "right" | "center" | "justify";
  leading?: number;
  wordWrap?: boolean;
}

interface ItemUi {
  scale: number;
  img: Record<string, ImgRec>;
  text: Record<string, TextSpec2>;
  box: {
    clip: Record<string, number[]>;
    statsClip: Record<string, number[]>;
    place: Record<string, Place[]>;
    tween: Record<string, {
      place: Place[]; clip: number[]; statsClip: number[];
    }[]>;
  };
  stats: { frames: Record<string, string>; place: Record<string, Place[]> };
  cont: Record<string, { img: string; place: Place[] }>;
  get: Record<string, { plate: string; place: Place[] }>;
  slot: {
    faces: Record<string, string>;
    chrome?: string;
    reels: number[][];
    fields: Record<string, [number, number]>;
    facePlace: [number, number];
    faceW: number; faceH: number;
  };
  layout: {
    stageTop: number;
    inventory: { cards: number[][]; tabs: number[][] };
    heroesInv: { cards: number[][]; tabs: number[][]; place: Record<string, number[]> };
    workshopInv: { cards: number[][]; tabs: number[][]; place: Record<string, number[]> };
    store: { cards: number[][]; place: Record<string, number[]> };
    workshop: Record<string, number[]>;
  };
  gunReg: Record<string, [number, number]>;
}

export const UI = ui as unknown as ItemUi;
export const CARD_W = 142.96;
export const CARD_H = 79.65;

const BASE = "ui/items/";
const cache = new Map<string, Texture>();
const loading = new Set<string>();
let epoch = 0;

export function itemArtEpoch(): number {
  return epoch + rigEpoch();
}

export function tex(rec: ImgRec): Texture {
  const hit = cache.get(rec.file);
  if (hit) return hit;
  if (!loading.has(rec.file)) {
    loading.add(rec.file);
    void Assets.load<Texture>(BASE + rec.file)
      .then((t) => { cache.set(rec.file, t); epoch++; })
      .catch(() => void loading.delete(rec.file));
  }
  return Texture.EMPTY;
}

export function preloadItemArt(): void {
  for (const rec of Object.values(UI.img)) tex(rec);
}

export function itemArtUrls(): string[] {
  return [...new Set(Object.values(UI.img).map((r) => BASE + r.file))];
}

export async function loadItemArt(): Promise<void> {
  await fillCache(BASE, Object.values(UI.img).map((r) => r.file), cache);
  epoch++;
}

export function imgSprite(rec: ImgRec | null | undefined): Sprite {
  if (!rec) return new Sprite();
  const sp = new Sprite(tex(rec));
  sp.anchor.set(rec.w ? rec.ox / rec.w : 0, rec.h ? rec.oy / rec.h : 0);
  const t = sp.texture;
  sp.scale.set(t.width ? rec.w / t.width : 1 / UI.scale,
               t.height ? rec.h / t.height : 1 / UI.scale);
  return sp;
}

export function itemField(
  cid: number, place: { x: number; y: number }, override: Partial<TextStyleOptions> = {},
): Text {
  const spec = UI.text[String(cid)];
  const align = spec?.align ?? "left";
  const t = new Text({
    text: "",
    style: new TextStyle({
      fontFamily: [spec?.font ?? "QTypeSquare-Book", "Verdana", "sans-serif"],
      fontSize: spec?.size ?? 12,
      fill: spec?.color ?? 0xffffff,
      align: align === "justify" ? "left" : align,
      wordWrap: spec?.wordWrap ?? false,
      wordWrapWidth: spec?.w ?? 200,
      lineHeight: spec?.size ? spec.size + (spec?.leading ?? 0) : undefined,
      ...override,
    }),
  });
  t.alpha = spec?.alpha ?? 1;
  const bx = place.x + (spec?.x ?? 0);
  const by = place.y + (spec?.y ?? 0);
  const bw = spec?.w ?? 0;
  if (align === "center") {
    t.anchor.set(0.5, 0);
    t.position.set(bx + bw / 2, by);
  } else if (align === "right") {
    t.anchor.set(1, 0);
    t.position.set(bx + bw, by);
  } else {
    t.position.set(bx, by);
  }
  return t;
}

function addArt(
  into: Container, imgName: string, m: number[], tint?: number,
): Sprite | null {
  const rec = UI.img[imgName];
  if (!rec) return null;
  const sp = imgSprite(rec);
  sp.position.set(m[4], m[5]);
  if (tint !== undefined) sp.tint = tint;
  into.addChild(sp);
  return sp;
}

export type BoxState = "idle1" | "idle2" | "idle3" | "idle4"
  | "open1" | "open2" | "open3" | "open4";

export interface BoxOptions {
  price?: number;
  armorPerk?: boolean;
  dim?: boolean;
  heroLevel?: number;
  tween?: number;
}

export function cantEquip(item: InvItem | null, heroLevel = 0): boolean {
  return !!heroLevel && item instanceof GunInfo && heroLevel < item.level;
}

export function overlevelPenalty(item: InvItem | null, heroLevel = 0): number {
  if (!cantEquip(item, heroLevel)) return 0;
  return Math.round((item as GunInfo).level - heroLevel) * 2;
}

export function boxBgFrame(item: InvItem | null, armorPerk = true): number {
  if (item instanceof GunInfo) return item.rarity + 1;
  if (typeof item === "string") {
    const p = Perks.itemOb[item];
    if (!p) return 1;
    return armorPerk && p.armorname ? 20 : p.type + 10;
  }
  return 1;
}

export function boxContState(item: InvItem | null, state?: BoxState): string {
  if (item instanceof GunInfo) return item.stats.type === 4 ? "gun2" : "gun";
  if (typeof item === "string") return "perk";
  return state && GUN_STATES.has(state) ? "default" : "none";
}

const GUN_STATES: ReadonlySet<string> = new Set(
  ["idle1", "idle2", "open1", "open2"]);

function boxStatsFrame(item: InvItem | null): number {
  if (item instanceof GunInfo) return 1;
  if (typeof item === "string") return 2;
  return 3;
}

export interface GunFit {
  w: number; h: number; cx: number; cy: number; grow?: number;
}

export function gunArt(
  item: GunInfo, scale: number, fit?: GunFit,
): Sprite | null {
  const frame = MenuRig.gunFrame(item.stats.sprite as string, item.rarity);
  const rec = MenuRig.gun(frame);
  const reg = UI.gunReg[String(frame)];
  if (!rec || !reg) return null;
  const tex = MenuRig.texture(rec);
  const sp = new Sprite(tex);
  const k = rec.w && tex.width ? rec.w / tex.width : 1;
  let total = scale * k;
  sp.anchor.set((rec.ox + reg[0]) / (rec.w || 1), (rec.oy + reg[1]) / (rec.h || 1));
  if (fit && tex.width && tex.height) {
    const bb = rec.bb ?? [0, 0, rec.w, rec.h];
    const pxPerUnit = rec.w ? tex.width / rec.w : 1;
    const aw = bb[2] * pxPerUnit, ah = bb[3] * pxPerUnit;
    if (aw > 0 && ah > 0) {
      total *= Math.min(fit.grow ?? 1,
        fit.w / (aw * total), fit.h / (ah * total));
      sp.scale.set(total);
      sp.position.set(
        fit.cx - (bb[0] * pxPerUnit + aw / 2 - sp.anchor.x * tex.width) * total,
        fit.cy - (bb[1] * pxPerUnit + ah / 2 - sp.anchor.y * tex.height) * total,
      );
    } else {
      sp.scale.set(total);
      sp.position.set(fit.cx, fit.cy);
    }
  } else {
    sp.scale.set(total);
  }
  if (item.rarity === 4) sp.tint = 0xffe6cc;
  else if (item.rarity === 5) sp.tint = 0xe6e6ff;
  return sp;
}

function addGun(
  into: Container, item: GunInfo, place: Place | undefined, hoverScale: number,
  dx: number, dy: number, rotation: number, fit?: GunFit,
): void {
  if (!place) return;
  const sp = gunArt(item, hoverScale * place.m[0], fit);
  if (!sp) return;
  if (!fit) sp.position.set(dx, dy);
  sp.rotation = rotation;
  into.addChild(sp);
}

export const BP_CARD = { x: -75.65, y: -33.05, w: 150, h: 68 } as const;

export const BP_GUN = { w: 140, h: 40, cx: -0.65, cy: 6 } as const;

export const BP_TITLE = { x: -65.2, y: -28 } as const;

export function blueprintGun(id: string): GunInfo {
  const g = new GunInfo(id, 1, 0);
  g.upgrades = 0;
  g.setStats();
  return g;
}

export function containerView(
  state: string,
  o: {
    gun?: GunInfo | null;
    perk?: string;
    classId?: string;
    blueprint?: { id: string; num: number; notFound?: boolean };
  } = {},
): Container {
  const c = new Container();
  const cs = UI.cont[state];
  if (!cs) return c;
  addArt(c, cs.img, [1, 0, 0, 1, 0, 0]);

  const byName = (n: string): Place | undefined => cs.place.find((p) => p.name === n);
  const hover = 0.965;

  if (o.gun && (state === "gun" || state === "gun2")) {
    const gunPlace = byName("gun");
    const gun2Place = byName("gun2");
    if (state === "gun2" && gun2Place) {
      const rot2 = Math.atan2(gun2Place.m[1], gun2Place.m[0]);
      addGun(c, o.gun, gun2Place, hover, 15, -8, rot2);
      addGun(c, o.gun, gunPlace, hover, -15, 8, 8 * Math.PI / 180);
    } else if (gunPlace) {
      addGun(c, o.gun, gunPlace, hover, 0, 0, 0);
    }
  } else if (state === "perk" && o.perk) {
    const p = byName("perk");
    const rec = UI.img[`perk_${o.perk}`];
    if (p && rec) {
      const sp = imgSprite(rec);
      const u = imgUnit(rec);
      sp.scale.set(p.m[0] * hover * u, p.m[3] * hover * u);
      sp.position.set(p.m[4], p.m[5]);
      c.addChild(sp);
    }
  } else if ((state === "class" || state === "class2" || state === "class3")
             && o.classId) {
    const p = byName("classicon");
    const rec = UI.img[`classicon_${o.classId}`];
    if (p && rec) {
      const sp = imgSprite(rec);
      const u = imgUnit(rec);
      sp.scale.set(p.m[0] * u, p.m[3] * u);
      sp.position.set(p.m[4], p.m[5]);
      c.addChild(sp);
    }
  } else if (state.startsWith("blueprint") && o.blueprint) {
    const b = byName("gun");
    if (b) addGun(c, blueprintGun(o.blueprint.id), b, hover, 0, 0, 0, BP_GUN);
    const tp = byName("txt_title");
    if (tp) {
      const t = itemField(tp.cid ?? 2337,
        o.blueprint.notFound ? { x: tp.m[4], y: tp.m[5] } : BP_TITLE);
      t.text = o.blueprint.notFound
        ? `BLUEPRINT ${o.blueprint.num + 1}\nNOT FOUND`
        : blueprintGun(o.blueprint.id).name.toUpperCase();
      c.addChild(t);
    }
  }
  return c;
}

function statsView(frame: number, item: InvItem | null, price: number): Container {
  const c = new Container();
  const img = UI.img[UI.stats.frames[String(frame)]];
  if (img) addArt(c, UI.stats.frames[String(frame)], [1, 0, 0, 1, 0, 0]);
  const places = UI.stats.place[String(frame)] ?? [];

  const putText = (p: Place, cid: number, text: string, color?: number) => {
    if (!text) return;
    const t = itemField(cid, { x: p.m[4], y: p.m[5] });
    t.text = text;
    if (color !== undefined) t.style.fill = color;
    c.addChild(t);
  };

  if (item instanceof GunInfo) {
    const st = item.stats;
    const sizePow = Guns.impactAr[st.type] * 1.2;
    const bars: [string, number, number, boolean][] = [
      ["pow", st.dmgBase, sizePow, (item.upgrades & 1) !== 0],
      ["rps", st.rps, 10, (item.upgrades & 2) !== 0],
      ["acc", st.aim, 99, (item.upgrades & 4) !== 0],
      ["amm", st.clipSize, 100, (item.upgrades & 8) !== 0],
    ];
    for (const [name, value, size, up] of bars) {
      const bp = places.find((p) => p.name === `mc_${name}`);
      if (bp && UI.img.bar) {
        const sp = imgSprite(UI.img.bar);
        sp.position.set(bp.m[4], bp.m[5]);
        sp.scale.y *= bp.m[3];
        sp.width = Math.min(value / size * 100, 100);
        sp.tint = up ? 0xffffe6 : 0xffffff;
        c.addChild(sp);
      }
      const sp2 = places.find((p) => p.name === `star_${name}`);
      if (sp2 && up) addArt(c, "starup", sp2.m);
    }
    const stLvl = places.find((p) => p.name === "star_lvl");
    if (stLvl && (item.upgrades & 0x10)) addArt(c, "starup", stLvl.m);

    const txt: [string, number, string][] = [
      ["txt_pow", 2358, String(Math.round(st.dmgBase))],
      ["txt_rps", 2365, String(Math.round(st.rps * 3))],
      ["txt_acc", 2366, String(Math.round(st.aim))],
      ["txt_amm", 2369, String(Math.round(st.clipSize))],
      ["txt_dps", 2360, String(Math.ceil(st.dmg * st.rps))],
      ["txt_name", 2349, item.name],
    ];
    for (const [key, cid, value] of txt) {
      const p = places.find((q) => q.name === key);
      if (p) putText(p, cid, value);
    }
    const ic = places.find((p) => p.name === "mc_icon");
    if (ic) addArt(c, `icon_${st.type}`, ic.m);

    const rar = Guns.RARITY[item.rarity];
    const rp = places.find((p) => p.name === "txt_rarity");
    if (rp) putText(rp, 2356, rar.text, rar.color);

    const cp = places.find((p) => p.name === "txt_cost");
    const cost = price >= 0 ? price : Math.ceil(st.cost * 0.5);
    if (cp) putText(cp, 2357, `$${UT.addNumCommas(cost)}`, 0xffcc00);

    const sp = places.find((p) => p.name === "txt_special");
    if (sp) {
      if (item.rarity === 3) {
        putText(sp, 2355, st.descPerf === Guns.DESC_SENTINEL ? "" : st.descPerf,
                0xffff00);
      } else if (item.rarity === 4 && !st.isMelee) {
        putText(sp, 2355, "Chance to jam while firing", 0x990000);
      } else {
        putText(sp, 2355, st.desc === Guns.DESC_SENTINEL ? "" : st.desc, 0x333333);
      }
    }
    return c;
  }

  const p = Perks.itemOb[item as string];
  if (!p) return c;
  const armor = !!p.armorname;
  const nameP = places.find((q) => q.name === "txt_name");
  if (nameP) putText(nameP, 2373, armor ? p.armorname : p.name);
  const descP = places.find((q) => q.name === "txt_desc");
  if (descP) putText(descP, 2371, p.desc);
  const rarP = places.find((q) => q.name === "txt_rarity");
  const lab = Perks.PERK_TYPE_LABEL[p.type];
  if (rarP && lab) putText(rarP, 2372, lab.text, lab.color);
  const costP = places.find((q) => q.name === "txt_cost");
  if (costP && (armor || p.type === 5)) {
    putText(costP, 2374, `$${UT.addNumCommas(Math.ceil(p.cost * 0.5))}`, 0xffcc00);
  }
  return c;
}

export const BOX_TWEEN_FRAMES = UI.box.tween?.open1?.length ?? 0;

export function itemBoxView(
  item: InvItem | null, state: BoxState, opts: BoxOptions = {},
): Container {
  const v = new Container();
  const tw = opts.tween !== undefined
    ? UI.box.tween?.[state]?.[opts.tween]
    : undefined;
  const clip = tw ? tw.clip : UI.box.clip[state];
  const places = tw ? tw.place : UI.box.place[state];
  if (!clip || !places) return v;
  const open = state.startsWith("open");
  const dim = opts.dim ?? !open;
  const armorPerk = opts.armorPerk ?? true;
  const price = opts.price ?? -1;

  for (const pl of places) {
    switch (pl.name) {
      case "bg": {
        const rec = UI.img[`bg_${boxBgFrame(item, armorPerk)}`];
        if (rec) {
          const sp = imgSprite(rec);
          const u = imgUnit(rec);
          sp.position.set(pl.m[4], pl.m[5]);
          sp.scale.set(pl.m[0] * u, pl.m[3] * u);
          if (dim) sp.tint = 0xcccccc;
          v.addChild(sp);
        }
        break;
      }
      case "stars": {
        if (!(item instanceof GunInfo)) break;
        const rec = UI.img[`stars_${item.upgradeAmt + 1}`];
        if (rec) {
          const sp = imgSprite(rec);
          sp.position.set(pl.m[4], pl.m[5]);
          if (dim) sp.tint = 0xcccccc;
          v.addChild(sp);
        }
        break;
      }
      case "cont": {
        const c = containerView(boxContState(item, state), {
          gun: item instanceof GunInfo ? item : null,
          perk: typeof item === "string"
            ? (Perks.itemOb[item]?.sprite ?? item) : undefined,
        });
        c.position.set(pl.m[4], pl.m[5]);
        c.scale.set(pl.m[0], pl.m[3]);
        if (dim) {
          c.alpha = 0.8;
          for (const child of c.children) {
            if (child instanceof Sprite && child.tint === 0xffffff) {
              child.tint = 0xcccccc;
            }
          }
        }
        v.addChild(c);
        break;
      }
      case "txt_level": {
        if (!(item instanceof GunInfo)) break;
        const penalty = overlevelPenalty(item, opts.heroLevel);
        const t = itemField(2347, { x: pl.m[4], y: pl.m[5] },
                            { fill: penalty ? 0xff6600 : 0xffcc00 });
        t.text = penalty
          ? `-${penalty}% stats\nLv ${item.level}`
          : `\nLv ${item.level}`;
        if (dim) t.alpha *= 0.8;
        v.addChild(t);
        break;
      }
      case "stats": {
        if (!open) break;
        const s = statsView(boxStatsFrame(item), item, price);
        s.position.set(pl.m[4], pl.m[5]);
        const win = tw ? tw.statsClip : UI.box.statsClip?.[state];
        if (win) {
          const m2 = new Graphics().rect(win[0], win[1], win[2], win[3])
            .fill({ color: 0xffffff });
          v.addChild(m2);
          s.mask = m2;
        }
        v.addChild(s);
        break;
      }
      default:
        break;
    }
  }

  const mask = new Graphics();
  mask.rect(clip[0], clip[1], clip[2], clip[3]).fill({ color: 0xffffff });
  v.addChild(mask);
  v.mask = mask;
  return v;
}

export let selItemCat = 0;
export function setItemCat(n: number): void {
  selItemCat = n;
  invPage = 0;
}

let invPage = 0;
export const PAGE_SIZE = MAX_ITEMS;

let storageArmed = false;

export function getInvPage(): number {
  return invPage;
}

export function pageCount(len: number): number {
  return Math.max(1, Math.ceil(len / PAGE_SIZE));
}

export function setInvPage(n: number, len: number): void {
  invPage = Math.max(0, Math.min(pageCount(len) - 1, n));
}

export function itemName(item: InvItem): string {
  return typeof item === "string" ? Perks.itemOb[item].name : item.name;
}

export function itemRarity(item: InvItem): number {
  return typeof item === "string" ? -1 : item.rarity;
}

export function itemCard(
  into: Container, item: InvItem | null, x: number, y: number,
  selected: boolean, price = -1, heroLevel = 0,
): Container {
  const gun = item instanceof GunInfo;
  const state: BoxState = selected
    ? (gun ? "open1" : "open3")
    : (gun ? "idle1" : "idle3");
  const v = itemBoxView(item, state, { price, dim: !selected, heroLevel });
  v.position.set(x + CARD_W / 2, y + CARD_H / 2);
  into.addChild(v);
  return v;
}

export function itemDetail(
  into: Container, item: InvItem, x: number, y: number, w: number,
): void {
  const state: BoxState = item instanceof GunInfo ? "open1" : "open3";
  const clip = UI.box.clip[state];
  const v = itemBoxView(item, state, {});
  const s = clip ? Math.min(1, w / clip[2]) : 1;
  v.scale.set(s);
  v.position.set(x - (clip?.[0] ?? 0) * s, y - (clip?.[1] ?? 0) * s);
  into.addChild(v);
}

export function asGun(item: InvItem): GunInfo | null {
  return item instanceof GunInfo ? item : null;
}

export interface TabHit { x: number; y: number; w: number; h: number; i: number }
export interface CellHit { x: number; y: number; i: number }

const ROW_X = -0.5;
const COUNT_Y = 442.55 - STAGE_TOP + 24.9 + 5;
const STORAGE_Y = 489.05 - STAGE_TOP;
const PAGER_Y = STORAGE_Y + 24.9 + 8;
const LABEL_X = ROW_X - 37.75 + 63.3;
const ROW_RIGHT = ROW_X - 48.05 + 241.55 - 20;

export function tabRow(
  into: Container, x: number, y: number, text: string,
  selected: boolean, alpha = 1, color = 0xffffff,
): { x: number; y: number; w: number; h: number } | null {
  const rec = UI.img[selected ? "tab_2" : "tab_1"];
  const row = new Container();
  let box: { x: number; y: number; w: number; h: number } | null = null;
  if (rec) {
    const sp = imgSprite(rec);
    sp.position.set(x, y);
    row.addChild(sp);
    box = { x: x - rec.ox, y: y - rec.oy, w: rec.w, h: rec.h };
  }
  const t = itemField(2578, { x: x - 37.75, y: y + 3.05 }, { fill: color });
  t.text = text;
  row.addChild(t);
  row.alpha = alpha;
  into.addChild(row);
  return box;
}

export function catTabs(
  into: Container, tabs: readonly number[][], selected: number,
  allowed: (i: number) => boolean = () => true,
): TabHit[] {
  const hits: TabHit[] = [];
  for (let i = 0; i < 13 && i < tabs.length; i++) {
    const [sx, sy] = tabs[i];
    const live = allowed(i);
    const box = tabRow(into, sx, sy - STAGE_TOP,
                       Guns.getGunType(i) + (i !== 12 ? "s" : ""),
                       i === selected, live ? 1 : 0.1);
    if (box && live && i !== selected) hits.push({ ...box, i });
  }
  return hits;
}

export function gridCells(cards: readonly number[][], len: number): CellHit[] {
  setInvPage(invPage, len);
  const base = invPage * PAGE_SIZE;
  const out: CellHit[] = [];
  for (let k = 0; k < PAGE_SIZE && k < cards.length; k++) {
    const [cx, cy] = cards[k];
    out.push({ x: cx - CARD_W / 2, y: cy - CARD_H / 2 - STAGE_TOP, i: base + k });
  }
  return out;
}

export class GridPager {
  private constructor(
    private readonly prev: RowZone,
    private readonly next: RowZone,
  ) {}

  static build(into: Container, len: number): GridPager | null {
    const pages = pageCount(len);
    if (pages < 2) return null;
    const box = tabRow(into, ROW_X, PAGER_Y, "", false);
    const top = box?.y ?? PAGER_Y;
    const h = box?.h ?? 24.5;
    const third = ROW_RIGHT / 3;
    const mid = itemField(2578, { x: ROW_X - 37.75, y: PAGER_Y + 3.05 }, { fill: 0xffffff });
    mid.text = `Page ${invPage + 1} / ${pages}`;
    mid.anchor.set(0.5, 0);
    mid.x = ROW_RIGHT / 2 + 6;
    into.addChild(mid);
    const prev = new RowZone(into, "<", LABEL_X, 0, third, top, h, invPage > 0);
    const next = new RowZone(into, ">", ROW_RIGHT - 12, ROW_RIGHT - third, ROW_RIGHT, top, h,
                             invPage < pages - 1);
    return new GridPager(prev, next);
  }

  update(): void {
    this.prev.update();
    this.next.update();
  }

  click(len: number): boolean {
    if (this.prev.activate()) {
      setInvPage(invPage - 1, len);
      return true;
    }
    if (this.next.activate()) {
      setInvPage(invPage + 1, len);
      return true;
    }
    return false;
  }
}

const ROW_HOVER = 0xff9900;

class RowZone {
  private readonly glyph: Text;
  private hovered = false;

  constructor(
    into: Container, text: string, gx: number,
    private readonly x0: number, private readonly x1: number,
    private readonly y: number, private readonly h: number,
    private readonly enabled: boolean,
  ) {
    this.glyph = itemField(2578, { x: ROW_X - 37.75, y: PAGER_Y + 3.05 }, { fill: 0xffffff });
    this.glyph.text = text;
    this.glyph.x = gx;
    this.glyph.alpha = enabled ? 1 : 0.25;
    into.addChild(this.glyph);
  }

  hit(): boolean {
    return this.enabled && hitTest(this.x0, this.y, this.x1 - this.x0, this.h);
  }

  update(): void {
    const h = this.hit();
    if (h === this.hovered) return;
    this.hovered = h;
    this.glyph.style.fill = h ? ROW_HOVER : 0xffffff;
  }

  activate(): boolean {
    const h = this.hit();
    if (h) SH.playSound("S_Click");
    return h;
  }
}

class TabButton extends Container {
  private readonly idle: Container;
  private readonly lit: Container;
  private readonly box: { x: number; y: number; w: number; h: number };
  private hovered = false;

  constructor(
    text: string, y: number,
    private readonly enabled: boolean,
    private readonly active: boolean,
    fontSize = 14,
  ) {
    super();
    this.idle = new Container();
    this.lit = new Container();
    const b = tabRow(this.idle, ROW_X, y, text, false);
    tabRow(this.lit, ROW_X, y, text, true);
    for (const c of [this.idle, this.lit]) {
      for (const ch of c.children) if (ch instanceof Container) fitLabel(ch, fontSize);
    }
    this.addChild(this.idle, this.lit);
    this.box = b ?? { x: ROW_X - 48.05, y: y - 0.5, w: 241.55, h: 24.5 };
    this.alpha = enabled ? 1 : 0.5;
    this.paint();
  }

  hit(): boolean {
    const b = this.box;
    return this.enabled && hitTest(Math.max(0, b.x), b.y, ROW_RIGHT - Math.max(0, b.x), b.h);
  }

  update(): void {
    const h = this.hit();
    if (h === this.hovered) return;
    this.hovered = h;
    this.paint();
  }

  activate(): boolean {
    const h = this.hit();
    if (h) SH.playSound("S_Click");
    return h;
  }

  private paint(): void {
    const on = this.active || this.hovered;
    this.idle.visible = !on;
    this.lit.visible = on;
  }
}

function fitLabel(row: Container, fontSize: number): void {
  for (const ch of row.children) {
    if (!(ch instanceof Text)) continue;
    ch.style.fontSize = fontSize;
    const room = ROW_RIGHT - ch.x;
    if (ch.width > room && ch.width > 0) ch.scale.set(room / ch.width);
  }
}

export function gridCards(
  into: Container, cells: readonly CellHit[], bucket: readonly InvItem[],
  open: (i: number) => boolean, heroLevel = 0,
): void {
  let lifted: Container | null = null;
  for (const c of cells) {
    if (c.i >= bucket.length) continue;
    const up = open(c.i);
    const v = itemCard(into, bucket[c.i] ?? null, c.x, c.y, up, -1, heroLevel);
    if (up) lifted = v;
  }
  if (lifted) into.setChildIndex(lifted, into.children.length - 1);
}

export function hoverCell(
  cells: readonly CellHit[], bucket: readonly InvItem[],
): number {
  for (const c of cells) {
    if (c.i < bucket.length && hitTest(c.x, c.y, CARD_W, CARD_H)) return c.i;
  }
  return -1;
}

export function focusTabs(tabs: readonly TabHit[], selected: number): void {
  for (const t of tabs) focusable(t.x, t.y, t.w, t.h, { tab: "page", order: t.i });
  Focus.activeTab("page", selected);
}

export class InventoryPage extends MenuPage {
  private tabHits: TabHit[] = [];
  private cellHits: CellHit[] = [];
  private pager: GridPager | null = null;
  private storage: TabButton | null = null;
  private hoverIndex = -1;
  private artEpoch = -1;

  build(_w: number, _h: number): void {
    preloadItemArt();
    this.artEpoch = itemArtEpoch();
    this.tabHits = [];
    this.cellHits = [];

    const bucket = SD.items[selItemCat] ?? [];
    const L = UI.layout.inventory;
    this.hoverIndex = -1;

    this.tabHits = catTabs(this.view, L.tabs, selItemCat);

    this.cellHits = gridCells(L.cards, bucket.length);
    this.hoverIndex = hoverCell(this.cellHits, bucket);
    gridCards(this.view, this.cellHits, bucket, (i) => i === this.hoverIndex);
    this.pager = GridPager.build(this.view, bucket.length);

    const cap = SD.itemCap();
    const count = itemField(2578, { x: ROW_X - 37.75, y: COUNT_Y }, {
      fill: bucket.length >= cap ? 0xff9900 : 0xffffff, fontSize: 12,
    });
    count.text = `${bucket.length} / ${cap} items`;
    count.alpha = bucket.length >= cap ? 1 : 0.7;
    this.view.addChild(count);
    this.buildStorageButton();
  }

  private buildStorageButton(): void {
    const cost = SD.storageCost();
    const text = cost === null
      ? "Storage Maxed"
      : storageArmed
        ? `Confirm  $${UT.addNumCommas(cost)}`
        : `+${STORAGE_STEP} Slots  $${UT.addNumCommas(cost)}`;
    const bt = new TabButton(text, STORAGE_Y, cost !== null && cost <= SD.funds, storageArmed);
    this.view.addChild(bt);
    this.storage = bt;
  }

  update(): void {
    if (itemArtEpoch() !== this.artEpoch) {
      this.host.refresh();
      return;
    }
    this.pager?.update();
    this.storage?.update();
    focusTabs(this.tabHits, selItemCat);
    if (storageArmed && !this.storage?.hit()) {
      storageArmed = false;
      this.host.refresh();
      return;
    }
    const h = hoverCell(this.cellHits, SD.items[selItemCat] ?? []);
    if (h !== this.hoverIndex) {
      this.hoverIndex = h;
      this.host.refresh();
    }
  }

  onClick(): void {
    const bucket = SD.items[selItemCat] ?? [];
    if (this.storage?.activate()) {
      this.clickStorage();
      return;
    }
    storageArmed = false;
    if (this.pager?.click(bucket.length)) {
      this.host.refresh();
      return;
    }
    for (const t of this.tabHits) {
      if (hitTest(t.x, t.y, t.w, t.h)) {
        setItemCat(t.i);
        this.host.refresh();
        return;
      }
    }
    for (const c of this.cellHits) {
      if (c.i < bucket.length && hitTest(c.x, c.y, CARD_W, CARD_H)) {
        SH.playSound("S_Click");
        this.host.openTransaction(bucket[c.i], "sell");
        return;
      }
    }
  }

  private clickStorage(): void {
    if (!storageArmed) {
      storageArmed = true;
      this.host.refresh();
      return;
    }
    storageArmed = false;
    if (SD.buyStorage()) {
      SH.playSound("S_Buy");
      SD.save();
    } else {
      SH.playSound("S_Error");
    }
    this.host.refresh();
  }
}
