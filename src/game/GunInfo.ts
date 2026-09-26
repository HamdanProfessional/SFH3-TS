import { UT } from "../core/UT";
import { MAX_LVL } from "../data/StatsMisc";
import * as Classes from "../data/StatsClasses";
import * as Perks from "../data/StatsPerks";
import {
  type GunStats, clone, itemAr, typeAr, u,
  getUpgradeChance,
} from "../data/StatsGuns";
import { RAND_AI_RARITY } from "./newHero";
import type { UnitInfo } from "./UnitInfo";

export function intToBit(num: number): number {
  let res = 1;
  for (let i = 0; i < num - 1; i++) res *= 2;
  return res;
}

export const UPGRADE_ALL = 31;

export interface GunInfoSave {
  id: string;
  rarity: number;
  level: number;
  upgrades: number;
}

export const upgradeHooks: {
  onFullyUpgraded: (() => void) | null;
  onUpgradeCost: ((cost: number) => void) | null;
} = {
  onFullyUpgraded: null,
  onUpgradeCost: null,
};

export class GunInfo {
  id: string;
  stats!: GunStats;
  rarity: number;
  olevel: number;
  level = 0;
  upgrades = 0;
  upgradeAmt = 0;
  name = "";

  constructor(id = "", level = 1, rarity = -1, statSet = true) {
    this.id = id ? id : UT.randEl(itemAr).id;
    let lvl = level;
    if (lvl > MAX_LVL) lvl = MAX_LVL + 1;
    this.olevel = lvl;
    this.rarity = rarity;
    if (this.rarity < 0) this.rarity = UT.irand(0, 5);
    this.upgrades = 0;
    this.upgradeAmt = 0;
    for (let i = 0; i < 5; i++) {
      if (Math.random() < 0.1) this.upgrades += intToBit(i + 1);
    }
    if (statSet) this.setStats();
    else this.stats = clone(this.id);
  }

  static loadObject(ob: GunInfoSave): GunInfo {
    const info = new GunInfo(ob.id, ob.level, ob.rarity, false);
    info.upgrades = ob.upgrades;
    info.setStats();
    return info;
  }

  setStats(): void {
    setGunInfoStats(this);
    this.name = this.stats.name;
    if (this.rarity === 3) this.name = this.stats.namePerf;
  }

  createObject(): GunInfoSave {
    return {
      id: this.id,
      rarity: this.rarity,
      level: this.olevel,
      upgrades: this.upgrades,
    };
  }
}

export function setGunInfoStats(gunInfo: GunInfo): void {
  const st = clone(gunInfo.id);
  gunInfo.stats = st;
  gunInfo.level = gunInfo.olevel;
  st.cost = u(UT.getCurvedRange(gunInfo.level, MAX_LVL, 70, 1000));
  st.rarity = gunInfo.rarity;
  switch (gunInfo.rarity) {
    case 0:
      break;
    case 1:
      st.dmg *= 1.03; st.range = u(st.range * 1.03); st.aim *= 1.03;
      st.rps *= 1.03; st.cost = u(st.cost * 1.1);
      break;
    case 2:
      st.dmg *= 1.06; st.range = u(st.range * 1.06); st.aim *= 1.06;
      st.rps *= 1.06; st.cost = u(st.cost * 1.45);
      break;
    case 3: {
      if (st.extraPerf) {
        const sink = st as unknown as Record<string, unknown>;
        for (const s of Object.keys(st.extraPerf)) sink[s] = st.extraPerf[s];
      }
      st.dmg *= 1.1; st.range = u(st.range * 1.1); st.aim *= 1.1;
      st.rps *= 1.1; st.cost = u(st.cost * 2);
      st.name = st.namePerf;
      break;
    }
    case 4:
      st.dmg *= 0.9; st.range = u(st.range * 0.9); st.aim *= 0.9;
      st.rps *= 0.9; st.cost = u(st.cost * 0.7);
      if (!st.isMelee) st.jam = 0.08;
      break;
    case 5:
      st.dmg *= 0.95; st.range = u(st.range * 0.95); st.aim *= 0.95;
      st.rps *= 0.95; st.cost = u(st.cost * 0.5);
      break;
    default:
      break;
  }
  gunInfo.upgradeAmt = 0;
  if (gunInfo.upgrades & 1) {
    st.dmg *= 1.1; ++gunInfo.upgradeAmt; st.cost = u(st.cost * 1.5);
  }
  if (gunInfo.upgrades & 2) {
    st.rps *= 1.1; ++gunInfo.upgradeAmt; st.cost = u(st.cost * 1.3);
  }
  if (gunInfo.upgrades & 4) {
    st.aim *= 1.1; ++gunInfo.upgradeAmt; st.cost = u(st.cost * 1.2);
  }
  if (gunInfo.upgrades & 8) {
    st.clipSize = u(st.clipSize * 1.3); ++gunInfo.upgradeAmt;
    st.cost = u(st.cost * 1.1);
  }
  st.rps = Math.min(st.rps, 10);
  st.aim = Math.min(st.aim, 99);
  st.dmgBase = st.dmg;
  st.dmg *= UT.getLinearRange(gunInfo.level, MAX_LVL, 1, 2.5);
  if (st.multiShots) st.dmg /= st.multiShots;
  st.recoil = 10 - st.aim * 0.1;
  st.shootDelay = (10 - st.rps + 0.2) * 2 + 0.8;
  if (gunInfo.upgrades & 0x10) {
    --gunInfo.level; ++gunInfo.upgradeAmt; st.cost = u(st.cost * 1.4);
  }
}

export function getDefaultWeapon(cls: string, slot: "primary" | "secondary"): GunInfo {
  const weapNum = Classes.itemOb[cls][slot][0];
  return new GunInfo(typeAr[weapNum][0].id, 1, 0);
}

export function getRandomWeapon(cls: string, slot: "primary" | "secondary"): GunInfo {
  const weapNum = UT.randEl(Classes.itemOb[cls][slot]);
  return new GunInfo(UT.randEl(typeAr[weapNum]).id, 1, UT.randEl(RAND_AI_RARITY));
}

interface PendingWeapons {
  primary?: { id: string; rarity: number } | { random: "primary" };
  secondary?: { id: string; rarity: number } | { random: "secondary" };
  randomMods?: boolean;
}

export function applyPendingWeapons(info: UnitInfo): void {
  const pending = info.extra.pendingWeapons as PendingWeapons | undefined;
  const typeIdx = info.extra.pendingPrimaryTypeIndex as [number, number] | undefined;
  if (typeIdx) {
    info.primary = new GunInfo(typeAr[typeIdx[0]][typeIdx[1]].id, 1, 0);
    delete info.extra.pendingPrimaryTypeIndex;
  }
  if (!pending) return;
  for (const slot of ["primary", "secondary"] as const) {
    const want = pending[slot];
    if (!want) continue;
    info[slot] = "random" in want
      ? getRandomWeapon(info.cls, slot)
      : new GunInfo(want.id, 1, want.rarity);
  }
  if (pending.randomMods) {
    info.weaponMod = UT.randEl(Perks.weapAr).id;
    info.armorMod = UT.randEl(Perks.armorAr).id;
    info.initStats();
  }
  delete info.extra.pendingWeapons;
}

export function getUpgradeCost(gunInfo: GunInfo): number {
  return Math.ceil(gunInfo.stats.cost * (0.4 + gunInfo.upgradeAmt * 0.4));
}

export function upgradeGun(gunInfo: GunInfo): boolean {
  upgradeHooks.onUpgradeCost?.(getUpgradeCost(gunInfo));
  let priority: number[];
  if (Math.random() < getUpgradeChance(gunInfo.upgradeAmt)) {
    priority = [];
    if (Math.random() < 0.6) priority.push(4, 3);
    else priority.push(3, 4);
    priority.push(2);
    if (Math.random() < 0.6) priority.push(5, 1);
    else priority.push(1, 5);
    for (let i = 0; i < priority.length; i++) {
      if (!(gunInfo.upgrades & intToBit(priority[i]))) {
        gunInfo.upgrades |= intToBit(priority[i]);
        if (gunInfo.upgrades === UPGRADE_ALL) upgradeHooks.onFullyUpgraded?.();
        gunInfo.setStats();
        break;
      }
    }
    return true;
  }
  if (Math.random() < 0.3) {
    priority = [];
    if (Math.random() < 0.6) priority.push(1, 5);
    else priority.push(5, 1);
    priority.push(2);
    if (Math.random() < 0.6) priority.push(3, 4);
    else priority.push(4, 3);
    for (let i = 0; i < priority.length; i++) {
      if (gunInfo.upgrades & intToBit(priority[i])) {
        gunInfo.upgrades ^= intToBit(priority[i]);
        gunInfo.setStats();
        break;
      }
    }
  }
  return false;
}
