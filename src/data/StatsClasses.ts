import { UT } from "../core/UT";
import { MAX_LVL } from "./StatsMisc";

export type StatRange = readonly [min: number, max: number];

export type RangedStat = "health" | "crit" | "aim" | "mobile" | "aggro";

export interface GameClass {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly health: StatRange;
  readonly crit: StatRange;
  readonly aim: StatRange;
  readonly mobile: StatRange;
  readonly aggro: StatRange;
  readonly traits: readonly string[];
  readonly streaks: readonly string[];
  readonly frames: readonly number[];
  readonly perks: readonly number[];
  readonly primary: readonly number[];
  readonly secondary: readonly number[];
  readonly desc: string;
  readonly i: number;
}

export const itemOb: Record<string, GameClass> = {};
export const itemAr: GameClass[] = [];

function addItem(
  id: string, name: string, size: number,
  health: StatRange, crit: StatRange, aim: StatRange,
  mobile: StatRange, aggro: StatRange,
  traits: readonly string[], streaks: readonly string[],
  frames: readonly number[], perks: readonly number[],
  primary: readonly number[], secondary: readonly number[],
  desc: string,
): void {
  const item: GameClass = {
    id, name, size, health, crit, aim, mobile, aggro,
    traits, streaks, frames, perks, primary, secondary, desc,
    i: itemAr.length,
  };
  itemOb[id] = item;
  itemAr.push(item);
}

addItem("eng", "Engineer", 1, [85, 185], [5, 18], [4, 8], [3, 7], [2, 6],
  ["turret1", "turret2"], ["rockettur", "dualtur"], [81, 91], [0, 1, 2], [3, 8], [0, 1, 2],
  "Engineers are balanced fighters that rely on their turret killstreaks.");

addItem("eli", "Elite", 0.95, [90, 205], [6, 20], [3, 7], [2, 6], [3, 7],
  ["coating", "energy"], ["firebeam", "icebeam"], [21, 31], [2, 0, 1], [10, 9], [2, 0, 1],
  "Elites are high tech soldiers that use advanced elemental weaponry.");

addItem("jug", "Juggernaut", 1.1, [130, 300], [2, 10], [1, 5], [2, 6], [2, 6],
  ["deflect", "bomb"], ["mirror", "element"], [121, 131], [1, 0, 1], [9, 6], [1, 2],
  "Juggernauts prefer close range and can take the most damage before going down.");

addItem("mer", "Mercenary", 1.05, [105, 230], [4, 15], [2, 6], [3, 7], [5, 9],
  ["proof", "bomb"], ["akimbo", "betsy"], [141, 151], [1, 2, 1], [8, 7], [1, 2],
  "Mercenaries will stop at nothing to kill. They work best solo.");

addItem("sni", "Sniper", 1, [70, 140], [8, 30], [5, 9], [1, 4], [1, 5],
  ["magnet", "assist"], ["aimbot", "wallhack"], [101, 111], [2, 0, 2], [5, 10], [0, 2],
  "Snipers prefer long range, but are vulnerable up close.");

addItem("nin", "Ninja", 0.95, [75, 150], [13, 40], [2, 6], [5, 9], [3, 7],
  ["stealth", "dodge"], ["shuriken", "smoke"], [61, 71], [2, 1, 2], [6, 4], [2, 0],
  "Ninjas move quickly and take out singled enemies with ease.");

addItem("med", "Medic", 0.95, [90, 195], [3, 12], [4, 8], [1, 5], [1, 4],
  ["aura", "love"], ["armor", "heal"], [1, 11], [0, 1, 0], [7, 3], [1, 0],
  "Medics keep their team alive through heals and buffs.");

addItem("gun", "Gunslinger", 0.95, [80, 160], [18, 50], [1, 4], [4, 8], [4, 8],
  ["gunplay", "inspire"], ["critboost", "rofboost"], [41, 51], [0, 2, 0], [4, 5], [0, 1],
  "Gunslingers are pistol enthusiasts that boost team effectiveness.");

addItem("akq", "Knight", 0.9, [115, 255], [0, 0], [1, 1], [5, 10], [5, 10],
  ["gunplay", "inspire"], ["critboost", "rofboost"], [41, 51], [0, 2, 0], [2], [2],
  "The Knight is an excellent melee specialist. However he doesn't know how to use ranged weapons...");

export const CLASSES_BASIC = ["eng", "jug", "med", "gun"] as const;
export const CLASSES_ALL = ["eng", "jug", "med", "gun", "eli", "mer", "sni", "nin"] as const;

export const AMMO_CAPACITY: Readonly<Record<string, number>> = {
  jug: 2.0,
  mer: 1.75,
  gun: 1.75,
  eng: 1.5,
  eli: 1.5,
  med: 1.5,
  nin: 1.25,
  sni: 1.25,
  akq: 1.0,
};

export function ammoCapacity(cls: string): number {
  return AMMO_CAPACITY[cls] ?? 1;
}

export function getStat(lvl: number, cls: string, val: RangedStat): number {
  const range = itemOb[cls][val];
  return UT.getLinearRange(lvl, MAX_LVL, range[0], range[1]);
}

export function getArmor(lvl: number): number {
  return UT.getLinearRange(lvl, MAX_LVL, 75, 150);
}

export function getNextExp(level: number): number {
  return Math.trunc(level * level * 4.5 + 40);
}

export function getUnitExp(level: number): number {
  return Math.trunc(4 + level * 1.4);
}

export function getAiLevel(diff: number): number {
  let lvl = Math.round(diff * 3.5) + UT.irand(-3, 4);
  if (lvl > 50 || diff === 15) lvl = 50;
  return lvl > 0 ? lvl : 1;
}

export function getReccLevel(diff: number): string {
  if (diff === 15) return "50";
  let min = Math.trunc(Math.round(diff - 1) * 3.5);
  if (min < 1) min = 1;
  let max = Math.round((diff + 1) * 3.5);
  if (max > 50) max = 50;
  return `${min} - ${max}`;
}

export function getHirePrice(rosterSize: number): number {
  if (rosterSize === 1) return 0;
  return 150 + rosterSize * 50;
}

export interface StatusBand {
  readonly label: string;
  readonly info: string;
  readonly color: number;
  readonly statMod: number;
  readonly anim: string;
}

export function getStatusBand(status: number): StatusBand {
  if (status > 300) {
    return { label: "", info: "", color: 0x00ff66, statMod: 1, anim: "idle" };
  }
  if (status > 200) {
    return { label: "Tired", info: "Tired: -20% Stats", color: 0xffcc33, statMod: 0.8, anim: "tired" };
  }
  if (status > 100) {
    return { label: "Injured", info: "Injured: -50% Stats", color: 0xff6600, statMod: 0.5, anim: "injured" };
  }
  return { label: "Critical", info: "Critical: -99% Stats", color: 0xff3300, statMod: 0.01, anim: "critical" };
}
