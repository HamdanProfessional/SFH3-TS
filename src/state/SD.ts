import { UT } from "../core/UT";
import { isLowPower } from "../core/device";
import { Quality } from "./Quality";
import { bindControls, defaultControls, type ControlOptions } from "./controls";
import { UnitInfo, hasDevFace } from "../game/UnitInfo";
import { newHero } from "../game/newHero";
import { GunInfo, type GunInfoSave, applyPendingWeapons, getDefaultWeapon } from "../game/GunInfo";
import { MatchSettings } from "../game/MatchSettings";
import * as Guns from "../data/StatsGuns";
import * as Perks from "../data/StatsPerks";
import * as Classes from "../data/StatsClasses";
import { MAX_LVL, MAX_MISSION } from "../data/StatsMisc";
import { repairSave } from "./repairSave";

const STORAGE_KEY = "sfh3.save";
const BROKEN_KEY = "sfh3.save.broken";
export const SCHEMA = 2;

export const MAX_HEROES = 15;
export const MAX_ITEMS = 24;

export const STORAGE_STEP = 10;
export const STORAGE_COST0 = 5000;
export const MAX_STORAGE_LEVEL = 8;
export const STORE_SIZE = 12;
export const MAX_STATUS = 400;
export const MAX_FUNDS = 2147483647;

export const HIRES_PER_DAY = 5;

export const CRAFT_MARKUP = 1.25;

export const CRAFT_ODDS = (): { rarity: number; chance: number }[] =>
  [4, 0, 1, 2, 3].map((r) => ({
    rarity: r,
    chance: randStoreRarity.filter((x) => x === r).length / randStoreRarity.length,
  }));

export type InvItem = GunInfo | string;

export const achHooks: {
  check: (id: string, amt: number) => void;
  set: (id: string) => void;
} = {
  check: () => {},
  set: () => {},
};

function bag(...pairs: readonly (readonly [count: number, value: number])[]): number[] {
  const out: number[] = [];
  for (const [n, v] of pairs) for (let i = 0; i < n; i++) out.push(v);
  return out;
}

export const randRarity: readonly number[] = bag([13, 4], [30, 0], [10, 1], [5, 2], [1, 3]);
export const randAiRarity: readonly number[] = bag([16, 0], [8, 1], [4, 2], [2, 3]);
export const randStoreRarity: readonly number[] = bag([9, 4], [25, 0], [12, 1], [7, 2], [2, 3]);
export const randHighRarity: readonly number[] = bag([8, 1], [4, 2], [1, 3]);

export function shuffle<T>(ar: T[]): void {
  for (let i = 0; i < ar.length; i++) {
    const val = ar.splice(i, 1);
    ar.splice(UT.irand(0, ar.length - 1), 0, val[0]);
  }
}

export interface Options extends ControlOptions {
  graphQual: number;
  graphPart: number;
  graphLights: boolean;
  graphGlow: boolean;
  music: boolean;
  sound: boolean;
  voices: boolean;
  screenShake: boolean;
  screenBlood: boolean;
  blood: number;
  rightclick: number;
}

function defaultOptions(): Options {
  const low = isLowPower;
  return {
    graphQual: low ? 1 : 2, graphPart: low ? 1 : 2, graphLights: !low, graphGlow: true,
    music: true, sound: true, voices: true,
    screenShake: true, screenBlood: false,
    blood: 2, rightclick: 0,
    ...defaultControls(),
  };
}

export interface SaveBlob {
  schema: number;
  heroes: Record<string, unknown>[];
  selHero: number;
  squad: number[];
  items: (GunInfoSave | string)[][];
  funds: number;
  day: number;
  stages: number[];
  bpClasses: number[];
  uniqueClasses: string[];
  bpOwned: number[];
  bpBuilt: number[];
  gotAkq: boolean;
  justHired: boolean;
  hiresToday?: number;
  storageLevel?: number;
  lastDaily: string;
  mapItem: (GunInfoSave | string | number)[];
  storeItems: (GunInfoSave | string)[];
  storeOrder: number[];
  achievements: string[];
  achOb: Record<string, number>;
  options: Options;
}

class SaveData {
  heroes: UnitInfo[] = [];
  selHero = 0;
  squad: number[] = [];

  funds = 0;
  day = 1;
  items: InvItem[][] = [];
  storageLevel = 0;
  storeItems: InvItem[] = [];
  storeOrder: number[] = [];

  bpClasses: number[] = [];
  uniqueClasses: string[] = [];
  bpOwned: number[] = [];
  bpBuilt: number[] = [];
  bpOther: number[] = [];
  gotAkq = false;
  justHired = false;
  hiresToday = 0;

  autoShowAd = false;

  stages: number[] = [];
  curStage = 0;
  curDiff = 1;
  lastDaily = "";
  achievements: string[] = [];
  achOb: Record<string, number> = {};

  squadCode = "";

  mapItem: (GunInfo | string | number)[] = [];
  storeItem: GunInfo | string | null = null;
  workshopItem: GunInfo | string | null = null;

  soloTired = 1;

  options: Options = defaultOptions();

  newGame(): void {
    this.gotAkq = false;
    this.achievements = [];
    this.achOb = {};
    this.uniqueClasses = [];
    this.justHired = false;
    this.hiresToday = 0;
    this.storageLevel = 0;
    this.autoShowAd = false;
    this.bpClasses = [0];
    this.achOb.classes = this.bpClasses.length;
    this.curDiff = 1;
    this.curStage = 0;
    this.stages = [0];
    this.squad = [0];
    this.selHero = 0;
    this.heroes = [newHero("", "starter1")];
    for (const h of this.heroes) applyPendingWeapons(h);

    this.items = [];
    for (let i = 0; i < 13; i++) this.items.push([]);

    this.bpOwned = [];
    this.bpBuilt = [];
    this.bpOther = [];
    for (let i = 0; i < Guns.itemAr.length; i++) {
      if (Guns.itemAr[i].type <= 10) {
        if (Guns.itemAr[i].extra.bp) this.bpBuilt.push(i);
        else this.bpOther.push(i);
      }
    }

    this.storeOrder = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    shuffle(this.storeOrder);
    this.createStore();
    this.day = 1;
    this.funds = 400;
    this.mapItem = [];
    this.storeItem = null;
    this.workshopItem = null;
    this.soloTired = 1;
    this.options = defaultOptions();
  }

  get selectedHero(): UnitInfo {
    return this.heroes[this.selHero] ?? this.heroes[0];
  }

  setFunds(amt = 0): void {
    this.funds = Math.max(0, Math.min(MAX_FUNDS, this.funds + amt));
  }

  payMatchFunds(info: UnitInfo): void {
    if (!this.heroes.includes(info)) return;
    if (MatchSettings.sandbox) return;
    const target = info.payableFunds();
    if (target > info.paidFunds) {
      this.setFunds(target - info.paidFunds);
      info.paidFunds = target;
    }
  }

  getHighestLevel(): number {
    let lvl = 0;
    for (const h of this.heroes) if (h.level > lvl) lvl = Math.trunc(h.level);
    return lvl;
  }

  private squadCodeTot = 0;

  private cc(num: number, add = true): string {
    if (add) this.squadCodeTot += num;
    return String.fromCharCode(Math.trunc(num) + 36);
  }

  private cc2(code: string, spot: number, add = true): number {
    const num = code.charCodeAt(spot) - 36;
    if (add) this.squadCodeTot += num;
    return num;
  }

  createSquadCode(): void {
    this.squadCodeTot = 0;
    let str = "";
    for (let i = 0; i < this.squad.length; i++) {
      const slot = this.squad[i];
      if (slot < 0) continue;
      const hero = this.heroes[slot];
      if (!hero) continue;
      let guy = "";
      guy += this.cc(Classes.itemOb[hero.cls].i);
      guy += this.cc(hero.level);
      guy += this.cc(Perks.itemOb[hero.flaw].iType);
      guy += this.cc(Perks.itemOb[hero.streak].iType);
      guy += this.cc(hero.getEquippedPerk(0).iType);
      guy += this.cc(hero.getEquippedPerk(1).iType);
      guy += this.cc(hero.getEquippedPerk(2).iType);
      const primary = (hero.primary as GunInfo | null)
        ?? getDefaultWeapon(hero.cls, "primary");
      guy += this.cc(primary.stats.i);
      guy += this.cc(primary.olevel);
      guy += this.cc(primary.rarity);
      const secondary = (hero.secondary as GunInfo | null)
        ?? getDefaultWeapon(hero.cls, "secondary");
      guy += this.cc(secondary.stats.i);
      guy += this.cc(secondary.olevel);
      guy += this.cc(secondary.rarity);
      const weaponMod = hero.weaponMod ? hero.weaponMod : "none";
      guy += this.cc(Perks.itemOb[weaponMod].iType);
      const armorMod = hero.armorMod ? hero.armorMod : "none";
      guy += this.cc(Perks.itemOb[armorMod].iTypeArmor);
      guy += this.cc(hero.face);
      guy += this.cc(hero.skin);
      guy += this.cc(hero.hair);
      guy += this.cc(hero.color);
      guy += this.cc(Math.trunc(hero.head / 10));
      guy += this.cc(hero.head % 10);
      guy += this.cc(Math.trunc(hero.body / 10));
      guy += this.cc(hero.body % 10);
      str += guy;
    }
    const totFlipped = 10000 - this.squadCodeTot;
    let totStr = "" + totFlipped;
    if (totFlipped < 100) totStr = "00" + totFlipped;
    if (totFlipped < 1000) totStr = "0" + totFlipped;
    let squadAmtCode = "";
    for (let i = 0; i < 4; i++) {
      squadAmtCode += this.cc(parseInt(totStr.charAt(i), 10), false);
    }
    let squadSize = 0;
    for (let i = 0; i < this.squad.length; i++) if (this.squad[i] >= 0) squadSize++;
    this.squadCode = "SFH3[" + this.cc(squadSize, false) + squadAmtCode + str + "]";
    this.squadCode = UT.replaceString(this.squadCode, "<", "!");
  }

  readSquadCode(code: string): boolean {
    code = UT.replaceString(code, "!", "<");
    if (code.length < 10) return false;
    code = code.substring(5, code.length - 1);
    const squadAmt = this.cc2(code, 0, false);
    if (!UT.between(squadAmt, 1, 5)) return false;
    let str = "";
    for (let i = 0; i < 4; i++) str += this.cc2(code, 1 + i, false);
    const numCode = 10000 - parseInt(str, 10);
    if ((code.length - 5) / squadAmt !== 23) return false;
    this.squadCodeTot = 0;
    MatchSettings.qmSquadCodeBots = [];
    for (let i = 0; i < squadAmt; i++) {
      str = code.substr(5 + 23 * i, 23);
      const info = new UnitInfo();
      info.cls = Classes.itemAr[this.cc2(str, 0)].id;
      info.level = this.cc2(str, 1);
      info.flaw = Perks.flawAr[this.cc2(str, 2)].id;
      info.streak = Perks.streakAr[this.cc2(str, 3)].id;
      info.perks = [];
      let tempCC = this.cc2(str, 4);
      info.perks.push([tempCC >= 0 ? Perks.perkAr[tempCC].id : "none", "none", 1]);
      tempCC = this.cc2(str, 5);
      info.perks.push([tempCC >= 0 ? Perks.perkAr[tempCC].id : "none", "none", 1]);
      tempCC = this.cc2(str, 6);
      info.perks.push([tempCC >= 0 ? Perks.perkAr[tempCC].id : "none", "none", 1]);
      info.primary = new GunInfo(Guns.itemAr[this.cc2(str, 7)].id, this.cc2(str, 8), this.cc2(str, 9), true);
      info.secondary = new GunInfo(Guns.itemAr[this.cc2(str, 10)].id, this.cc2(str, 11), this.cc2(str, 12), true);
      tempCC = this.cc2(str, 13);
      info.weaponMod = tempCC >= 0 ? Perks.weapAr[tempCC].id : "";
      tempCC = this.cc2(str, 14);
      info.armorMod = tempCC >= 0 ? Perks.armorAr[tempCC].id : "";
      info.face = this.cc2(str, 15);
      info.skin = this.cc2(str, 16);
      info.hair = this.cc2(str, 17);
      info.color = this.cc2(str, 18);
      info.head = this.cc2(str, 19) * 10 + this.cc2(str, 20);
      info.body = this.cc2(str, 21) * 10 + this.cc2(str, 22);
      info.initStats();
      MatchSettings.qmSquadCodeBots.push(info);
    }
    if (numCode !== this.squadCodeTot) return false;
    return true;
  }

  checkDaily(now: Date = new Date()): boolean {
    return this.lastDaily === dailyKey(now);
  }

  saveDaily(now: Date = new Date()): void {
    this.lastDaily = dailyKey(now);
  }

  getHirePrice(): number {
    if (this.heroes.length === 1) return 0;
    return 150 + this.heroes.length * 50;
  }

  canHire(): boolean {
    return this.hiresToday < HIRES_PER_DAY && this.heroes.length < MAX_HEROES;
  }

  hireHero(): UnitInfo | null {
    const price = this.getHirePrice();
    if (price > this.funds) return null;
    this.setFunds(-price);
    achHooks.check("buy", price);
    let info: UnitInfo;
    if (this.stages.length === 2 && this.heroes.length === 1) {
      info = newHero("", "starter2");
    } else if (this.uniqueClasses.length) {
      info = newHero("", this.uniqueClasses.shift() as string);
    } else {
      info = newHero(Classes.itemAr[UT.randEl(this.bpClasses)].id);
    }
    applyPendingWeapons(info);
    this.heroes.push(info);
    this.selHero = this.heroes.length - 1;
    this.justHired = true;
    this.hiresToday += 1;
    return info;
  }

  dismissHero(): void {
    if (this.heroes.length <= 1) return;
    this.heroes.splice(this.selHero, 1);
    const at = this.squad.indexOf(this.selHero);
    if (at !== -1) this.squad[at] = -1;
    if (this.selHero > 0) this.selHero--;
  }

  createStore(): void {
    this.storeItems = [];
    this.createStoreRow(STORE_SIZE);
  }

  createStoreRow(amt: number): void {
    const highest = this.getHighestLevel();
    for (let i = 0; i < amt; i++) {
      const idNum = this.storeOrder.pop() as number;
      if (!this.storeOrder.length) {
        this.storeOrder = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
        shuffle(this.storeOrder);
      }
      let item: InvItem;
      if (idNum <= 10) {
        let lvl = UT.irand(highest - 4, highest);
        if (lvl < 1) lvl = 1;
        item = new GunInfo(
          Guns.getRandomGunId(this.bpBuilt, idNum), lvl, UT.randEl(randStoreRarity),
        );
      } else if (idNum === 11) {
        item = UT.randEl(Perks.weapAr).id;
      } else {
        item = UT.randEl(Perks.armorAr).id;
      }
      this.storeItems.unshift(item);
    }
  }

  nextStoreRow(): void {
    if (this.storeItems.length < STORE_SIZE) {
      this.createStoreRow(STORE_SIZE - this.storeItems.length);
    } else {
      this.storeItems.pop();
      this.storeItems.pop();
      this.createStoreRow(2);
    }
  }

  itemCap(): number {
    return MAX_ITEMS + STORAGE_STEP * this.storageLevel;
  }

  storageCost(): number | null {
    if (this.storageLevel >= MAX_STORAGE_LEVEL) return null;
    return STORAGE_COST0 * 2 ** this.storageLevel;
  }

  buyStorage(): boolean {
    const cost = this.storageCost();
    if (cost === null || cost > this.funds) return false;
    this.setFunds(-cost);
    this.storageLevel += 1;
    return true;
  }

  bucketOf(item: InvItem): number {
    if (typeof item === "string") return Perks.getGunType(item);
    const t = item.stats?.type;
    return Number.isInteger(t) && t >= 0 && t < 13 ? t : 13;
  }

  priceOf(item: InvItem): number {
    return typeof item === "string" ? Perks.itemOb[item].cost : item.stats.cost;
  }

  sellPriceOf(item: InvItem): number {
    return Math.ceil(this.priceOf(item) * 0.5);
  }

  canAcquire(item: InvItem, buying: boolean): number {
    const bucket = this.bucketOf(item);
    if (bucket === 13) return 3;
    if (this.items[bucket].length >= this.itemCap()) return 1;
    if (buying && this.priceOf(item) > this.funds) return 2;
    return 0;
  }

  buyStoreItem(item: InvItem): boolean {
    if (this.canAcquire(item, true) !== 0) return false;
    const price = this.priceOf(item);
    this.items[this.bucketOf(item)].push(item);
    this.setFunds(-price);
    achHooks.check("buy", price);
    const at = this.storeItems.indexOf(item);
    if (at !== -1) this.storeItems.splice(at, 1);
    return true;
  }

  sellItem(item: InvItem): boolean {
    const bucket = this.bucketOf(item);
    const at = this.items[bucket].indexOf(item);
    if (at === -1) return false;
    this.items[bucket].splice(at, 1);
    const price = this.sellPriceOf(item);
    this.setFunds(price);
    achHooks.check("sell", price);
    return true;
  }

  rebuildBpOther(): void {
    this.bpOwned.sort((a, b) => a - b);
    this.bpBuilt.sort((a, b) => a - b);
    this.bpOther = [];
    for (let i = 0; i < Guns.itemAr.length; i++) {
      if (this.bpOwned.indexOf(i) === -1 && this.bpBuilt.indexOf(i) === -1) {
        this.bpOther.push(i);
      }
    }
  }

  findBlueprint(id: string): number {
    const bpNum = Guns.itemOb[id].i;
    this.bpOther.splice(this.bpOwned.indexOf(bpNum), 1);
    this.bpOwned.push(bpNum);
    return bpNum;
  }

  buildBlueprint(bpNum: number): boolean {
    const stats = Guns.itemAr[bpNum];
    const price = Guns.getBlueprintPrice(stats.costMod);
    if (price > this.funds) return false;
    this.setFunds(-price);
    achHooks.check("buy", price);
    const item = new GunInfo();
    item.id = stats.id;
    item.rarity = 5;
    item.setStats();
    this.workshopItem = item;
    const at = this.bpOwned.indexOf(bpNum);
    if (at !== -1) this.bpOwned.splice(at, 1);
    this.bpBuilt.push(bpNum);
    return true;
  }

  craftGun(bpNum: number, level: number, rarity = 0): GunInfo {
    const lvl = Math.max(1, Math.min(MAX_LVL, Math.round(level)));
    const rar = rarity >= 0 && rarity <= 4 ? rarity : 0;
    const gun = new GunInfo(Guns.itemAr[bpNum].id, lvl, rar, false);
    gun.upgrades = 0;
    gun.setStats();
    return gun;
  }

  craftPrice(bpNum: number, level: number): number {
    return Math.ceil(this.craftGun(bpNum, level, 0).stats.cost * CRAFT_MARKUP);
  }

  craftBlueprint(bpNum: number, level: number): number {
    if (!this.bpBuilt.includes(bpNum)) return 4;
    const price = this.craftPrice(bpNum, level);
    const gun = this.craftGun(bpNum, level, UT.randEl(randStoreRarity));
    if (this.items[gun.stats.type].length >= this.itemCap()) return 1;
    if (price > this.funds) return 2;
    this.setFunds(-price);
    achHooks.check("buy", price);
    this.workshopItem = gun;
    return 0;
  }

  save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.toBlob()));
    } catch {
    }
  }

  toBlob(): SaveBlob {
    return {
      schema: SCHEMA,
      heroes: this.heroes.map(saveHero),
      selHero: this.selHero,
      squad: this.squad,
      items: this.items.map((b) => b.map(saveItem)),
      funds: this.funds,
      day: this.day,
      stages: this.stages,
      bpClasses: this.bpClasses,
      uniqueClasses: this.uniqueClasses,
      bpOwned: this.bpOwned,
      bpBuilt: this.bpBuilt,
      gotAkq: this.gotAkq,
      justHired: this.justHired,
      hiresToday: this.hiresToday,
      storageLevel: this.storageLevel,
      lastDaily: this.lastDaily,
      mapItem: this.mapItem.map((v) => (v instanceof GunInfo ? v.createObject() : v)),
      storeItems: this.storeItems.map(saveItem),
      storeOrder: this.storeOrder,
      achievements: this.achievements,
      achOb: this.achOb,
      options: this.options,
    };
  }

  fromBlob(raw: SaveBlob): void {
    const ob = repairSave(raw);
    this.heroes = ob.heroes.map(loadHero);
    this.selHero = ob.selHero;
    this.squad = ob.squad;
    this.items = ob.items.map((b) => b.map(loadItem));
    this.funds = ob.funds;
    this.day = ob.day;
    this.stages = ob.stages.length ? ob.stages.slice(0, MAX_MISSION) : [0];
    this.bpClasses = ob.bpClasses;
    this.uniqueClasses = ob.uniqueClasses;
    this.bpOwned = ob.bpOwned;
    this.bpBuilt = ob.bpBuilt;
    this.gotAkq = ob.gotAkq;
    this.justHired = ob.justHired;
    this.hiresToday = ob.hiresToday ?? (ob.justHired ? 1 : 0);
    this.storageLevel = Math.max(0, Math.min(MAX_STORAGE_LEVEL,
                                             Math.floor(ob.storageLevel ?? 0) || 0));
    this.lastDaily = ob.lastDaily;
    this.mapItem = ob.mapItem.map((v) =>
      typeof v === "string" || typeof v === "number" ? v : GunInfo.loadObject(v));
    this.storeItems = ob.storeItems.map(loadItem);
    this.storeOrder = ob.storeOrder;
    this.achievements = ob.achievements;
    this.achOb = ob.achOb;
    this.options = { ...defaultOptions(), ...ob.options };
    this.storeItem = null;
    this.workshopItem = null;
    this.curStage = this.stages.length - 1;
    this.rebuildBpOther();
    for (const h of this.heroes) h.initStats();
  }

  load(): void {
    this.loadSave();
    if (isLowPower) {
      const o = this.options;
      const level = (["low", "medium", "high"] as const)[o.graphQual] ?? "high";
      Quality.set(level, !o.graphLights, true, o.graphPart);
    }
  }

  private loadSave(): void {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch {
      raw = null;
    }
    if (!raw) {
      this.newGame();
      return;
    }
    try {
      const ob = JSON.parse(raw) as SaveBlob;
      if (ob.schema === SCHEMA) {
        this.fromBlob(ob);
        if (this.heroes.length) return;
      }
    } catch {
    }
    try {
      localStorage.setItem(BROKEN_KEY, raw);
    } catch {
    }
    this.newGame();
  }
}

function dailyKey(now: Date): string {
  return `${now.getUTCDate()}-${now.getUTCMonth()}`;
}

function saveHero(h: UnitInfo): Record<string, unknown> {
  const ob = h.createObject();
  if (ob.primary instanceof GunInfo) ob.primary = ob.primary.createObject();
  if (ob.secondary instanceof GunInfo) ob.secondary = ob.secondary.createObject();
  return ob;
}

function loadHero(ob: Record<string, unknown>): UnitInfo {
  const info = UnitInfo.loadObject(ob);
  if (!info.perks.length) info.randomPerks();
  if (info.primary) info.primary = GunInfo.loadObject(info.primary as GunInfoSave);
  if (info.secondary) info.secondary = GunInfo.loadObject(info.secondary as GunInfoSave);
  info.devHero = hasDevFace(info);
  return info;
}

function saveItem(v: InvItem): GunInfoSave | string {
  return typeof v === "string" ? v : v.createObject();
}

function loadItem(v: GunInfoSave | string): InvItem {
  return typeof v === "string" ? v : GunInfo.loadObject(v);
}


export const SD = new SaveData();
bindControls(() => SD.options, () => SD.save());
