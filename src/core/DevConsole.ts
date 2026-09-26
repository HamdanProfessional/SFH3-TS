import {
  HIRES_PER_DAY, MAX_FUNDS, MAX_HEROES, MAX_STATUS, SCHEMA, SD, STORE_SIZE,
  achHooks, type InvItem, type SaveBlob,
} from "../state/SD";
import { MAX_HERO_LVL, MAX_MISSION } from "../data/StatsMisc";
import { getNextExp } from "../data/StatsClasses";
import * as Classes from "../data/StatsClasses";
import * as Guns from "../data/StatsGuns";
import * as Perks from "../data/StatsPerks";
import { UT } from "./UT";
import { HERO_SPECIFICS, newHero } from "../game/newHero";
import { GunInfo, applyPendingWeapons } from "../game/GunInfo";
import { hasDevFace, type UnitInfo } from "../game/UnitInfo";

interface Refreshable {
  refresh?: () => void;
}

export interface HeroHandle {
  readonly name: string;
  cls: string;
  class: ClassPicker | string;
  level: number;
  exp: number;
  perks: PerkSlots | readonly (string | number)[];
  flaw: string;
  trait: string;
  streak: string;
  weaponMod: string;
  armorMod: string;
  fatigue: number;
  readonly info: UnitInfo;
}

export interface PerkSlots {
  0: string;
  1: string;
  2: string;
  roll: () => void;
  clear: () => void;
}

export type ClassPicker = Record<string, HeroHandle | undefined>;

export interface HeroAdd {
  (who?: string, cls?: string): HeroHandle | undefined;
  [who: string]: HeroHandle | undefined;
}

export interface HeroApi {
  new: (kind?: string, cls?: string) => HeroHandle | undefined;
  add: HeroAdd;
  [key: string]:
    | HeroHandle | HeroAdd
    | ((kind?: string, cls?: string) => HeroHandle | undefined) | undefined;
}

export interface GiveApi {
  (what?: string, level?: number, rarity?: number): GunInfo | string | undefined;
  all: (level?: number, rarity?: number) => void;
  mods: () => void;
  clear: () => number;
  [what: string]: unknown;
}

export interface BpApi {
  all: () => number;
  give: (what: string) => number | null;
  none: () => number;
  list: () => void;
}

export interface StoreApi {
  reroll: (rarity?: number) => number;
  list: () => void;
}

export interface SaveApi {
  text: () => string;
  copy: () => string;
  load: (text: string) => boolean;
  reset: () => void;
  to: (name: string) => boolean;
  from: (name: string) => boolean;
  list: () => string[];
  drop: (name: string) => boolean;
}

export interface ListApi {
  guns: () => void;
  perks: () => void;
  mods: () => void;
  streaks: () => void;
  flaws: () => void;
  traits: () => void;
}

export interface DevConsole {
  funds: number;
  addFunds: (amt: number) => number;
  hero: HeroApi;
  setLevel: (who: string | number, level: number) => number;
  levelAll: (level: number) => number;
  roster: () => void;
  unlock: (count?: number, cleared?: number) => number;
  lock: () => number;
  give: GiveApi;
  bp: BpApi;
  store: StoreApi;
  rest: (status?: number) => number;
  day: number;
  hires: () => number;
  daily: () => void;
  save: SaveApi;
  list: ListApi;
  help: () => void;
}

export function setHeroLevel(u: UnitInfo, want: number): number {
  const n = Math.min(MAX_HERO_LVL, Math.max(1, Math.trunc(want) || 1));
  const from = u.level;
  if (n > from) {
    for (let i = from; i < n; i++) u.levelUp();
  } else if (n < from) {
    u.level = n;
    u.hasLevel = false;
    if (u.hasUpgrade >= 0 && n < (u.hasUpgrade + 1) * 5) u.hasUpgrade = -1;
  }
  u.exp = n >= MAX_HERO_LVL ? getNextExp(n) : 0;
  u.initStats();
  if (n >= MAX_HERO_LVL && from < MAX_HERO_LVL) achHooks.set("levelmax");
  return n;
}

export function resolveClass(want: string): string | null {
  const key = String(want ?? "").trim().toLowerCase();
  if (!key) return null;
  if (Classes.itemOb[key]) return key;
  return Classes.itemAr.find((c) => c.name.toLowerCase() === key)?.id ?? null;
}

export function setHeroClass(u: UnitInfo, want: string): string | null {
  const id = resolveClass(want);
  if (!id) return null;
  const c = Classes.itemOb[id];
  const rolled = Classes.itemOb[u.cls]?.frames.includes(u.head) ?? true;
  if (u.cls === id) return id;
  u.cls = id;
  u.trait = UT.randEl(c.traits);
  u.streak = UT.randEl(c.streaks);
  if (rolled) u.head = u.body = UT.randEl(c.frames);
  if (u.perks.every((slot) => slot[2] === 0)) u.randomPerks();
  u.initStats();
  return id;
}

let specifics: Map<string, string> | null = null;

export function specificKey(key: string): string | null {
  const want = String(key ?? "").trim().toLowerCase();
  if (!want) return null;
  if (!specifics) {
    specifics = new Map();
    for (const k of HERO_SPECIFICS) {
      specifics.set(k, k);
      specifics.set(newHero("", k).name.toLowerCase(), k);
    }
  }
  return specifics.get(want) ?? null;
}

export function isSpecific(key: string): boolean {
  return specificKey(key) !== null;
}

export function addHero(who = "", cls = ""): UnitInfo | null {
  if (SD.heroes.length >= MAX_HEROES) return null;
  const key = String(who ?? "").trim();
  const want = String(cls ?? "").trim();
  const specific = specificKey(key);
  let info: UnitInfo;
  if (specific) {
    info = newHero("", specific);
    if (want && !setHeroClass(info, want)) return null;
  } else {
    const id = want
      ? resolveClass(want)
      : UT.randEl(Classes.CLASSES_ALL as readonly string[]);
    if (!id) return null;
    info = newHero(id, "", key);
  }
  info.devHero = hasDevFace(info);
  applyPendingWeapons(info);
  info.initStats();
  SD.heroes.push(info);
  SD.selHero = SD.heroes.length - 1;
  return info;
}

function norm(s: string): string {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

let gunKeys: Map<string, Guns.GunStats> | null = null;

export function resolveGun(want: string): Guns.GunStats | null {
  const key = norm(want);
  if (!key) return null;
  if (!gunKeys) {
    gunKeys = new Map();
    for (const g of Guns.itemAr) gunKeys.set(norm(g.id), g);
    for (const g of Guns.itemAr) {
      const alt = norm(g.namePerf);
      if (alt && !gunKeys.has(alt)) gunKeys.set(alt, g);
    }
  }
  return gunKeys.get(key) ?? null;
}

export function resolvePerk(
  want: string, pool: readonly Perks.Perk[],
): Perks.Perk | null {
  const key = norm(want);
  if (!key) return null;
  return pool.find((p) => norm(p.id) === key || norm(p.name) === key
    || (p.armorname !== "" && norm(p.armorname) === key)) ?? null;
}

export function unlockCampaign(count = MAX_MISSION, cleared = 3): number {
  const n = Math.min(MAX_MISSION, Math.max(1, Math.trunc(count) || 1));
  const done = Math.min(3, Math.max(0, Math.trunc(cleared) || 0));
  SD.stages = new Array<number>(n).fill(done);
  SD.curStage = n - 1;
  return n;
}

export function giveItem(item: InvItem): boolean {
  if (SD.canAcquire(item, false) !== 0) return false;
  SD.items[SD.bucketOf(item)].push(item);
  return true;
}

export function giveGun(want: string, level = -1, rarity = -1): GunInfo | null {
  const stats = resolveGun(want);
  if (!stats) return null;
  const lvl = level >= 0 ? Math.trunc(level) : Math.max(1, SD.getHighestLevel());
  const gun = new GunInfo(stats.id, Math.max(1, lvl), Math.trunc(rarity));
  return giveItem(gun) ? gun : null;
}

export function giveMod(want: string): string | null {
  const p = resolvePerk(want, Perks.weapAr) ?? resolvePerk(want, Perks.armorAr);
  if (!p) return null;
  return giveItem(p.id) ? p.id : null;
}

export function giveAllGuns(level = -1, rarity = -1): [number, number] {
  let ok = 0;
  let full = 0;
  for (const i of SD.bpBuilt) {
    const stats = Guns.itemAr[i];
    if (!stats) continue;
    if (giveGun(stats.id, level, rarity)) ok++;
    else full++;
  }
  return [ok, full];
}

export function giveAllMods(): [number, number] {
  let ok = 0;
  let full = 0;
  for (const p of [...Perks.weapAr, ...Perks.armorAr]) {
    if (giveMod(p.id)) ok++;
    else full++;
  }
  return [ok, full];
}

export function clearItems(): number {
  let n = 0;
  for (const bucket of SD.items) {
    n += bucket.length;
    bucket.length = 0;
  }
  return n;
}

export function buildAllBlueprints(): number {
  let n = 0;
  for (let i = 0; i < Guns.itemAr.length; i++) {
    if (Guns.itemAr[i].type > 10) continue;
    if (SD.bpBuilt.indexOf(i) === -1) {
      SD.bpBuilt.push(i);
      n++;
    }
  }
  SD.bpOwned = [];
  SD.rebuildBpOther();
  return n;
}

export function giveBlueprint(want: string): number | null {
  const stats = resolveGun(want);
  if (!stats || stats.type > 10) return null;
  const at = SD.bpBuilt.indexOf(stats.i);
  if (at !== -1) SD.bpBuilt.splice(at, 1);
  if (SD.bpOwned.indexOf(stats.i) === -1) SD.bpOwned.push(stats.i);
  SD.rebuildBpOther();
  return stats.i;
}

export function resetBlueprints(): number {
  SD.bpOwned = [];
  SD.bpBuilt = [];
  for (let i = 0; i < Guns.itemAr.length; i++) {
    if (Guns.itemAr[i].type <= 10 && Guns.itemAr[i].extra.bp) SD.bpBuilt.push(i);
  }
  SD.rebuildBpOther();
  return SD.bpBuilt.length;
}

export function setPerkSlot(
  u: UnitInfo, slot: number, want: string | number,
): string | null {
  const i = Math.trunc(slot);
  if (!Number.isFinite(i) || i < 0 || i > 2) return null;
  while (u.perks.length <= i) u.perks.push(["none", "none", 0]);
  const s = u.perks[i];
  const asNum = typeof want === "number" ? want : Number(String(want).trim());
  if (String(want).trim() !== "" && Number.isInteger(asNum)) {
    if (asNum < 0 || asNum > 2) return null;
    s[2] = asNum;
    u.initStats();
    return u.getEquippedPerk(i).id;
  }
  if (norm(String(want)) === "none") {
    s[2] = 0;
    u.initStats();
    return "none";
  }
  const p = resolvePerk(String(want), Perks.perkAr);
  if (!p) return null;
  if (s[0] === p.id) s[2] = 1;
  else if (s[1] === p.id) s[2] = 2;
  else {
    s[0] = p.id;
    s[2] = 1;
  }
  u.initStats();
  return p.id;
}

export function rollPerks(u: UnitInfo): void {
  u.randomPerks();
  u.initStats();
}

const PERK_FIELDS: Readonly<Record<string, () => readonly Perks.Perk[]>> = {
  flaw: () => Perks.flawAr,
  trait: () => Perks.traitAr,
  streak: () => Perks.streakAr,
  weaponMod: () => Perks.weapAr,
  armorMod: () => Perks.armorAr,
};

export type PerkField = "flaw" | "trait" | "streak" | "weaponMod" | "armorMod";

export function setPerkField(
  u: UnitInfo, field: PerkField, want: string,
): string | null {
  const key = String(want ?? "").trim();
  if (key === "" || norm(key) === "none") {
    if (field !== "weaponMod" && field !== "armorMod") return null;
    u[field] = "";
    u.initStats();
    return "";
  }
  const p = resolvePerk(key, PERK_FIELDS[field]());
  if (!p) return null;
  u[field] = p.id;
  u.initStats();
  return p.id;
}

export function setFatigue(u: UnitInfo, want: number): number {
  const n = Math.max(0, Math.min(MAX_STATUS, Math.trunc(want) || 0));
  u.status = n;
  return n;
}

export function restAll(want = MAX_STATUS): number {
  const n = Math.max(0, Math.min(MAX_STATUS, Math.trunc(want) || 0));
  for (const u of SD.heroes) u.status = n;
  return n;
}

export function rerollStore(rarity = -1): number {
  SD.createStore();
  const r = Math.trunc(rarity);
  if (r >= 0) {
    for (const item of SD.storeItems) {
      if (item instanceof GunInfo) {
        item.rarity = Math.min(5, r);
        item.setStats();
      }
    }
  }
  return SD.storeItems.length;
}

export function setDay(want: number): number {
  SD.day = Math.max(1, Math.trunc(want) || 1);
  return SD.day;
}

export function resetHires(): number {
  SD.hiresToday = 0;
  SD.justHired = false;
  return HIRES_PER_DAY;
}

export function clearDaily(): void {
  SD.lastDaily = "";
}

export function saveText(): string {
  return JSON.stringify(SD.toBlob());
}

export function loadSaveText(text: string): boolean {
  let ob: SaveBlob;
  try {
    ob = JSON.parse(String(text)) as SaveBlob;
  } catch {
    return false;
  }
  if (!ob || typeof ob !== "object" || ob.schema !== SCHEMA) return false;
  if (!Array.isArray(ob.heroes) || !ob.heroes.length) return false;
  try {
    SD.fromBlob(ob);
  } catch {
    return false;
  }
  return true;
}

export function installDevConsole(screen: () => unknown): void {
  const redraw = (): void => {
    SD.save();
    (screen() as Refreshable | null)?.refresh?.();
  };
  const commitFunds = (): number => {
    SD.setFunds();
    redraw();
    return SD.funds;
  };

  const find = (key: string | number): UnitInfo | null => {
    const list = SD.heroes;
    if (typeof key === "number" || /^\d+$/.test(key)) {
      return list[Number(key)] ?? null;
    }
    const want = String(key).toLowerCase();
    return list.find((u) => u.name.toLowerCase() === want) ?? null;
  };

  const classPicker = (u: UnitInfo): ClassPicker =>
    new Proxy({} as ClassPicker, {
      get(_t, key) {
        if (typeof key !== "string") return undefined;
        if (!setHeroClass(u, key)) return undefined;
        redraw();
        return handle(u);
      },
    });

  const perkSlots = (u: UnitInfo): PerkSlots => {
    const o = {
      roll() { rollPerks(u); redraw(); },
      clear() {
        for (let i = 0; i < 3; i++) setPerkSlot(u, i, 0);
        redraw();
      },
    } as PerkSlots;
    for (let i = 0; i < 3; i++) {
      Object.defineProperty(o, i, {
        enumerable: true,
        get: () => u.getEquippedPerk(i).id,
        set: (v: string | number) => { setPerkSlot(u, i, v); redraw(); },
      });
    }
    return o;
  };

  const perkProp = (u: UnitInfo, field: PerkField): PropertyDescriptor => ({
    enumerable: true,
    get: () => u[field],
    set: (v: string) => { setPerkField(u, field, v); redraw(); },
  });

  const handle = (u: UnitInfo): HeroHandle => {
    const h = {
      get name() { return u.name; },
      get info() { return u; },
      get cls() { return u.cls; },
      set cls(v: string) { setHeroClass(u, v); redraw(); },
      get class() { return classPicker(u); },
      set class(v: ClassPicker | string) {
        if (typeof v === "string") { setHeroClass(u, v); redraw(); }
      },
      get level() { return u.level; },
      set level(v: number) { setHeroLevel(u, v); redraw(); },
      get exp() { return u.exp; },
      set exp(v: number) {
        u.exp = Math.max(0, Math.trunc(v) || 0);
        redraw();
      },
      get perks() { return perkSlots(u); },
      set perks(v: PerkSlots | readonly (string | number)[]) {
        if (!Array.isArray(v)) return;
        v.forEach((want, i) => setPerkSlot(u, i, want as string | number));
        redraw();
      },
      get fatigue() { return u.status; },
      set fatigue(v: number) { setFatigue(u, v); redraw(); },
    } as HeroHandle;
    for (const f of ["flaw", "trait", "streak", "weaponMod", "armorMod"] as const) {
      Object.defineProperty(h, f, perkProp(u, f));
    }
    return h;
  };

  const hire = (who: string, cls: string): HeroHandle | undefined => {
    const u = addHero(who, cls);
    if (!u) {
      const why = SD.heroes.length >= MAX_HEROES
        ? `the roster is full (${MAX_HEROES}) — dismiss somebody first`
        : `no class ${JSON.stringify(cls)} — try sfh3.help()`;
      console.warn(`sfh3: could not hire ${JSON.stringify(who)} — ${why}`);
      return undefined;
    }
    redraw();
    return handle(u);
  };

  const hireKind = (kind = "", cls = ""): HeroHandle | undefined => {
    const who = String(kind ?? "").trim();
    const want = String(cls ?? "").trim();
    if (want) return hire(who, want);
    return isSpecific(who) ? hire(who, "") : hire("", who);
  };

  const NOT_A_NAME = new Set(["then", "toJSON", "inspect", "constructor"]);

  const add = new Proxy(
    ((who?: string, cls?: string) => hire(who ?? "", cls ?? "")) as HeroAdd,
    {
      get(target, key, recv) {
        if (typeof key !== "string" || NOT_A_NAME.has(key)
            || Reflect.has(target, key)) {
          return Reflect.get(target, key, recv) as HeroHandle | undefined;
        }
        return hire(key, "");
      },
    },
  );

  const hero = new Proxy({} as HeroApi, {
    get(_t, key) {
      if (typeof key !== "string") return undefined;
      if (key === "add") return add;
      if (key === "new") return hireKind;
      const u = find(key);
      return u ? handle(u) : undefined;
    },
    ownKeys() { return SD.heroes.map((_u, i) => String(i)); },
    getOwnPropertyDescriptor(_t, key) {
      if (typeof key !== "string") return undefined;
      const u = find(key);
      if (!u) return undefined;
      return { value: handle(u), enumerable: true, configurable: true };
    },
  });

  const giveOne = (
    what: string, level = -1, rarity = -1,
  ): GunInfo | string | undefined => {
    const key = String(what ?? "").trim();
    const stats = resolveGun(key);
    const mod = stats
      ? null
      : (resolvePerk(key, Perks.weapAr) ?? resolvePerk(key, Perks.armorAr));
    if (!stats && !mod) {
      console.warn(`sfh3: no weapon or mod ${JSON.stringify(key)}`
        + " — try sfh3.list.guns() or sfh3.list.mods()");
      return undefined;
    }
    const got = stats ? giveGun(stats.id, level, rarity) : giveMod(mod?.id ?? "");
    if (!got) {
      console.warn(`sfh3: that bucket is full (${SD.itemCap()})`
        + " — sell something, or sfh3.give.clear()");
      return undefined;
    }
    redraw();
    return got;
  };

  const report = (noun: string, ok: number, full: number): void => {
    redraw();
    console.log(`sfh3: ${ok} ${noun} in`
      + (full ? `, ${full} refused — buckets full at ${SD.itemCap()}` : ""));
  };

  const giveFn = ((what?: string, level?: number, rarity?: number) =>
    giveOne(what ?? "", level ?? -1, rarity ?? -1)) as GiveApi;
  giveFn.all = (level = -1, rarity = -1) => {
    const [ok, full] = giveAllGuns(level, rarity);
    report("weapons", ok, full);
  };
  giveFn.mods = () => {
    const [ok, full] = giveAllMods();
    report("mods", ok, full);
  };
  giveFn.clear = () => {
    const n = clearItems();
    redraw();
    return n;
  };

  const give = new Proxy(giveFn, {
    get(target, key, recv) {
      if (typeof key !== "string" || NOT_A_NAME.has(key)
          || Reflect.has(target, key)) {
        return Reflect.get(target, key, recv) as unknown;
      }
      return giveOne(key);
    },
  });

  const bp: BpApi = {
    all() {
      const n = buildAllBlueprints();
      redraw();
      return n;
    },
    give(what: string) {
      const i = giveBlueprint(what);
      if (i === null) {
        console.warn(`sfh3: no weapon ${JSON.stringify(what)}`
          + " — try sfh3.list.guns()");
        return null;
      }
      redraw();
      return i;
    },
    none() {
      const n = resetBlueprints();
      redraw();
      return n;
    },
    list() {
      console.log(`sfh3: ${SD.bpBuilt.length} built, ${SD.bpOwned.length} found`
        + ` but unbuilt, ${SD.bpOther.length} locked`);
      const name = (i: number): string => Guns.itemAr[i]?.id ?? `#${i}`;
      if (SD.bpOwned.length) {
        console.log(`  unbuilt:  ${SD.bpOwned.map(name).join(", ")}`);
      }
      if (SD.bpOther.length) {
        console.log(`  locked:   ${SD.bpOther.map(name).join(", ")}`);
      }
    },
  };

  const store: StoreApi = {
    reroll(rarity = -1) {
      const n = rerollStore(rarity);
      redraw();
      return n;
    },
    list() {
      const rows = SD.storeItems.map((item, i) =>
        (item instanceof GunInfo
          ? {
            i, item: item.name, lvl: item.olevel,
            rarity: Guns.RARITY[item.rarity]?.text ?? item.rarity,
            cost: SD.priceOf(item),
          }
          : { i, item: Perks.itemOb[item]?.name ?? item, lvl: "", rarity: "mod",
            cost: SD.priceOf(item) }));
      if (console.table) console.table(rows);
      else console.log(rows);
    },
  };

  const SLOT_PREFIX = "sfh3.save.slot.";
  const slotKey = (name: string): string =>
    SLOT_PREFIX + String(name ?? "").trim().toLowerCase();

  const stash = (name: string, text: string): boolean => {
    const key = slotKey(name);
    if (key === SLOT_PREFIX) return false;
    try {
      localStorage.setItem(key, text);
      return true;
    } catch {
      return false;
    }
  };

  const save: SaveApi = {
    text() {
      const t = saveText();
      console.log(t);
      return t;
    },
    copy() {
      const t = saveText();
      console.log(t);
      navigator.clipboard?.writeText(t).then(
        () => console.log("sfh3: ...and on the clipboard"),
        () => console.warn("sfh3: the clipboard refused — copy the JSON above"),
      );
      return t;
    },
    load(text: string) {
      stash("undo", saveText());
      if (!loadSaveText(text)) {
        console.warn(`sfh3: not a save for this build (schema ${SCHEMA})`
          + " — nothing was changed");
        return false;
      }
      SD.save();
      redraw();
      return true;
    },
    reset() {
      stash("undo", saveText());
      SD.newGame();
      SD.save();
      redraw();
      console.log("sfh3: new game — sfh3.save.from('undo') puts it back");
    },
    to(name: string) {
      const ok = stash(name, saveText());
      if (!ok) console.warn(`sfh3: could not write slot ${JSON.stringify(name)}`);
      return ok;
    },
    from(name: string) {
      let text: string | null = null;
      try {
        text = localStorage.getItem(slotKey(name));
      } catch {
        text = null;
      }
      if (text === null) {
        console.warn(`sfh3: no slot ${JSON.stringify(name)}`
          + " — try sfh3.save.list()");
        return false;
      }
      return this.load(text);
    },
    list() {
      const out: string[] = [];
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith(SLOT_PREFIX)) out.push(k.slice(SLOT_PREFIX.length));
        }
      } catch {
      }
      out.sort();
      console.log(out.length ? `sfh3: slots — ${out.join(", ")}` : "sfh3: no slots");
      return out;
    },
    drop(name: string) {
      try {
        localStorage.removeItem(slotKey(name));
        return true;
      } catch {
        return false;
      }
    },
  };

  const dump = (rows: unknown[]): void => {
    if (console.table) console.table(rows);
    else console.log(rows);
  };
  const perkRows = (pool: readonly Perks.Perk[]): unknown[] =>
    pool.filter((p) => p.id !== "none")
      .map((p) => ({ id: p.id, name: p.name, armour: p.armorname, desc: p.desc }));

  const list: ListApi = {
    guns() {
      dump(Guns.itemAr.filter((g) => g.type <= 10).map((g) => ({
        id: g.id,
        category: Guns.getGunType(g.type),
        custom: g.namePerf,
        built: SD.bpBuilt.includes(g.i),
      })));
    },
    perks() { dump(perkRows(Perks.perkAr)); },
    mods() {
      dump([
        ...Perks.weapAr.map((p) => ({ id: p.id, name: p.name, slot: "weapon" })),
        ...Perks.armorAr.map((p) => ({ id: p.id, name: p.armorname, slot: "armour" })),
      ]);
    },
    streaks() { dump(perkRows(Perks.streakAr)); },
    flaws() { dump(perkRows(Perks.flawAr)); },
    traits() { dump(perkRows(Perks.traitAr)); },
  };

  const api: DevConsole = {
    get funds() { return SD.funds; },
    set funds(v: number) {
      SD.funds = Number.isFinite(v) ? v : 0;
      commitFunds();
    },
    addFunds(amt: number) {
      SD.funds += Number.isFinite(amt) ? amt : 0;
      return commitFunds();
    },
    hero,
    setLevel(who: string | number, level: number) {
      const u = find(who);
      if (!u) {
        console.warn(`sfh3: no hero ${JSON.stringify(who)} — try sfh3.roster()`);
        return -1;
      }
      const n = setHeroLevel(u, level);
      redraw();
      return n;
    },
    levelAll(level: number) {
      let n = -1;
      for (const u of SD.heroes) n = setHeroLevel(u, level);
      redraw();
      return n;
    },
    unlock(count?: number, cleared?: number) {
      const n = unlockCampaign(count, cleared);
      redraw();
      return n;
    },
    lock() {
      const n = unlockCampaign(1, 0);
      redraw();
      return n;
    },
    give,
    bp,
    store,
    rest(status?: number) {
      const n = restAll(status);
      redraw();
      return n;
    },
    get day() { return SD.day; },
    set day(v: number) { setDay(v); redraw(); },
    hires() {
      const n = resetHires();
      redraw();
      return n;
    },
    daily() {
      clearDaily();
      redraw();
    },
    save,
    list,
    roster() {
      const rows = SD.heroes.map((u, i) => ({
        i, name: u.name, cls: u.cls, level: u.level,
        exp: `${Math.round(u.exp)} / ${getNextExp(u.level)}`,
        fatigue: u.status,
      }));
      if (console.table) console.table(rows);
      else console.log(rows);
    },
    help() {
      console.log(
        [
          "sfh3 — hand-testing cheats",
          "",
          `  sfh3.funds            read the balance (max ${UT.addNumCommas(MAX_FUNDS)})`,
          "  sfh3.funds = 99999    set it; clamps, saves, redraws the menu",
          "  sfh3.addFunds(-500)   spend/grant relative to the balance",
          "",
          "  sfh3.roster()         the roster, with the indices below",
          "  sfh3.hero[0]          a hero by index, or by name: sfh3.hero.Rico",
          `  sfh3.hero[0].level = 25   re-level (1..${MAX_HERO_LVL}), saves, redraws`,
          "  sfh3.setLevel(0, 25)  the same thing as a call",
          "  sfh3.levelAll(25)     every hero at once",
          "",
          `  sfh3.hero.new()       hire one, free and off the books (max ${MAX_HEROES})`,
          "  sfh3.hero.new('jug')  ... of a class, by id or by name",
          "  sfh3.hero.new('mike') ... or a named character, listed below",
          "  sfh3.hero.new('Nathan', 'sniper')     a character, respecced",
          "  sfh3.hero.add.Nathan  the same characters, chained, by name or key",
          "  sfh3.hero.add.Nathan.class.jug        ... respecced, face kept",
          "  sfh3.hero.add.Steve   anything else is just a name, random class",
          "  sfh3.hero.add('Steve', 'jug')         the same thing as a call",
          "  sfh3.hero[0].class = 'sni'            respec somebody already hired",
          "",
          "  sfh3.hero[0].perks           the three upgrade slots",
          "  sfh3.hero[0].perks[0] = 2    ... take the second rolled option",
          "  sfh3.hero[0].perks[0] = 'gold1'       ... or any perk at all",
          "  sfh3.hero[0].perks.roll()    re-roll all three; .clear() deselects",
          "  sfh3.hero[0].streak = 'dualtur'       also .flaw .trait",
          "  sfh3.hero[0].weaponMod = 'Foregrip'   also .armorMod; '' to remove",
          `  sfh3.hero[0].fatigue = 0     0..${MAX_STATUS}, and ${MAX_STATUS} is FRESH`,
          "  sfh3.rest()                  un-tire the whole roster",
          "",
          `  sfh3.unlock()         open the campaign — all ${MAX_MISSION}, beaten on INSANE`,
          "  sfh3.unlock(12, 0)    ... or 12 positions, none beaten",
          "  sfh3.lock()           back to a one-mission save",
          "",
          "  sfh3.give('AK12')     a weapon into the inventory, at your best level",
          "  sfh3.give.AK12        the same, chained — spaces are optional",
          "  sfh3.give('AK12', 30, 4)              ... at a level and a rarity",
          "  sfh3.give.all()       one of every BUILT weapon; .mods() for mods",
          "  sfh3.give.clear()     empty every bucket",
          "",
          "  sfh3.bp.all()         every blueprint built — anything can now drop",
          "  sfh3.bp.give('Lynx')  one found but UNBUILT, for the workshop",
          "  sfh3.bp.none()        back to the starting set; .list() to see them",
          "",
          "  sfh3.store.reroll()   re-stock the shelf; reroll(5) for PROTOTYPEs",
          "  sfh3.store.list()     what is on it",
          "",
          "  sfh3.day = 40         the counter in the bar",
          `  sfh3.hires()          give the day's ${HIRES_PER_DAY} hires back`,
          "  sfh3.daily()          re-arm the daily mission",
          "",
          "  sfh3.save.copy()      the save as JSON, logged and on the clipboard",
          "  sfh3.save.load(str)   replace it; refuses anything but this schema",
          "  sfh3.save.to('clean') stash a copy; .from('clean') restores it",
          "  sfh3.save.list()      the stashed names; .drop(name) deletes one",
          "  sfh3.save.reset()     new game. 'undo' is stashed first, always",
          "",
          "  sfh3.list.guns()      what give() and bp.give() accept",
          "  sfh3.list.perks()     ... and perks[n]; also .mods() .streaks()",
          "                        .flaws() .traits()",
          "",
          `  classes:  ${Classes.itemAr.map((c) => `${c.id} (${c.name})`).join(", ")}`,
          "  characters (either column works):",
          ...HERO_SPECIFICS.map((k) => {
            const u = newHero("", k);
            return `    ${u.name.padEnd(10)} ${k.padEnd(9)}`
              + `${Classes.itemOb[u.cls].name}`;
          }),
          "",
          "  window.__sfh3         the live Engine — DEV builds only",
        ].join("\n"),
      );
    },
  };

  Object.defineProperty(window, "sfh3", {
    value: api,
    configurable: true,
  });
}

declare global {
  var sfh3: DevConsole | undefined;
}
