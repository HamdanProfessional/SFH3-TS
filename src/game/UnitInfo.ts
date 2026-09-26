import { UT } from "../core/UT";
import * as Classes from "../data/StatsClasses";
import * as Perks from "../data/StatsPerks";
import type { Perk } from "../data/StatsPerks";
import { EXP_RATE } from "../data/StatsMisc";
import type { GunInfo } from "./GunInfo";

export type PerkSlot = [optionA: string, optionB: string, selected: number];

export const DEV_FACES: readonly number[] = [241, 242];

export function hasDevFace(info: UnitInfo): boolean {
  return info.head === info.body && DEV_FACES.includes(info.head);
}

const SAVED_KEYS = [
  "name", "level", "cls", "trait", "streak", "flaw", "perks", "exp",
  "head", "body", "face", "skin", "hair", "color",
  "status", "weaponMod", "armorMod",
] as const;

export class UnitInfo {
  name = "";
  level = 1;
  team = 0;
  cls = "eng";
  trait = "";
  flaw = "";
  streak = "";
  perks: PerkSlot[] = [];
  weaponMod = "";
  armorMod = "";

  primary: unknown = null;
  secondary: unknown = null;

  hasUpgrade = -1;
  hasLevel = false;
  status = 400;
  extra: Record<string, unknown> = {};
  devHero = false;

  health = 0;
  crit = 0;
  armor = 0;
  aim = 0;
  mobile = 0;
  aggro = 0;
  runType = 1;
  idleType = 1;
  skills: Record<string, number> = {};

  exp = 0;
  legendary = false;
  earnedExp = 0;
  earnedFunds = 0;
  paidFunds = 0;
  deaths = 0;
  unique = false;

  head = 0;
  body = 0;
  face = 1;
  skin = 1;
  hair = 1;
  color = 1;

  initStats(statMod = 1): void {
    if (typeof this.extra.statMod === "number") statMod += this.extra.statMod;

    this.health = Math.ceil(Classes.getStat(this.level, this.cls, "health") * statMod);
    this.crit = Math.ceil(Classes.getStat(this.level, this.cls, "crit") * statMod);
    this.armor = Math.ceil(Classes.getArmor(this.level) * statMod);
    this.aim = Math.ceil(Classes.getStat(this.level, this.cls, "aim") * statMod);
    this.mobile = Math.ceil(Classes.getStat(this.level, this.cls, "mobile") * statMod);
    this.aggro = Math.ceil(Classes.getStat(this.level, this.cls, "aggro") * statMod);
    this.runType = 1;
    this.idleType = 1;

    const skills: Record<string, number> = {};
    const put = (id: string): void => {
      if (id && Perks.itemOb[id]) skills[id] = Perks.itemOb[id].val;
    };
    put(this.trait);
    put(this.flaw);
    put(this.weaponMod);
    put(this.armorMod);
    for (let i = 0; i < 3; i++) {
      const p = this.getEquippedPerk(i);
      skills[p.id] = p.val;
    }
    const extraSkills = this.extra.skills as Record<string, unknown> | undefined;
    if (extraSkills) for (const id of Object.keys(extraSkills)) put(id);
    if (this.devHero) {
      for (const p of Perks.traitAr) put(p.id);
      put("streak_");
    }
    this.skills = skills;
  }

  getEquippedPerk(num: number): Perk {
    const slot = this.perks[num];
    const sel = slot ? Math.trunc(slot[2]) : 0;
    if (sel > 0) {
      const id = slot[sel - 1];
      if (Perks.itemOb[id]) return Perks.itemOb[id];
    }
    return Perks.itemOb["none"];
  }

  randomPerks(): void {
    const used = new Set<string>([Perks.itemOb[this.flaw]?.clash ?? ""]);
    const buckets = Classes.itemOb[this.cls].perks;
    this.perks = [];
    for (let i = 0; i < 3; i++) {
      const pool = [Perks.perk0Ar, Perks.perk1Ar, Perks.perk2Ar][buckets[i]];
      const a = drawUnused(pool, used);
      const b = drawUnused(pool, used);
      this.perks.push([a, b, 0]);
    }
  }

  prepareForGame(captain = false): void {
    this.earnedExp = 0;
    this.earnedFunds = 0;
    this.paidFunds = 0;
    const band = Classes.getStatusBand(this.status);
    const statMod = this.status > 300 && captain ? 1.15 : band.statMod;
    this.initStats(statMod);
  }

  addExp(amt: number): number {
    const exp = amt * EXP_RATE;
    this.earnedExp += exp;
    this.earnedFunds += amt;
    return exp;
  }

  payableFunds(): number {
    const mul = (this.skills.gold1 ?? 1) * (this.skills.gold0 ?? 1);
    return Math.round(this.earnedFunds * mul);
  }

  addDeath(): void {
    this.deaths++;
  }

  setupLevelStats(num: number): void {
    this.level = num;
    if (typeof this.extra.levelUp === "number") this.level += this.extra.levelUp;
    const primary = this.primary as GunInfo | null;
    if (primary) {
      primary.level = primary.olevel = num;
      primary.setStats();
    }
    const secondary = this.secondary as GunInfo | null;
    if (secondary) {
      secondary.level = secondary.olevel = num;
      secondary.setStats();
    }
  }

  levelUp(): void {
    this.level++;
    if (this.level === 5) this.hasUpgrade = 0;
    if (this.level === 10) this.hasUpgrade = 1;
    if (this.level === 15) this.hasUpgrade = 2;
    this.hasLevel = true;
  }

  createObject(): Record<string, unknown> {
    const ob: Record<string, unknown> = {};
    for (const k of SAVED_KEYS) ob[k] = this[k];
    if (this.primary) ob.primary = this.primary;
    if (this.secondary) ob.secondary = this.secondary;
    return ob;
  }

  static loadObject(ob: Record<string, unknown>): UnitInfo {
    const info = new UnitInfo();
    const sink = info as unknown as Record<string, unknown>;
    for (const k of SAVED_KEYS) {
      if (ob[k] !== undefined) sink[k] = ob[k];
    }
    if (ob.primary) info.primary = ob.primary;
    if (ob.secondary) info.secondary = ob.secondary;
    return info;
  }
}

function drawUnused(pool: readonly Perk[], used: Set<string>): string {
  const free = pool.filter((p) => !used.has(p.id));
  const pick = free.length ? UT.randEl(free) : UT.randEl(pool);
  used.add(pick.id);
  return pick.id;
}
