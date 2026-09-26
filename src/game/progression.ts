import { getNextExp } from "../data/StatsClasses";
import { MAX_HERO_LVL } from "../data/StatsMisc";
import type { UnitInfo } from "./UnitInfo";

export interface LevelChange {
  name: string;
  from: number;
  to: number;
}

export function applyExpPerks(u: UnitInfo): void {
  if (u.skills.exp1) u.earnedExp *= u.skills.exp1;
  if (u.skills.exp0) u.earnedExp *= u.skills.exp0;
}

export function poolExp(heroes: readonly UnitInfo[]): void {
  let shared = 0;
  for (const u of heroes) {
    applyExpPerks(u);
    shared += u.earnedExp * 0.6;
    u.earnedExp -= u.earnedExp * 0.6;
  }
  const each = heroes.length ? shared / heroes.length : 0;
  for (const u of heroes) u.earnedExp += each;
}

export function commitExp(
  u: Pick<UnitInfo, "name" | "level" | "exp" | "earnedExp">,
): LevelChange | null {
  const from = u.level;
  if (u.level >= MAX_HERO_LVL) {
    u.exp = getNextExp(u.level);
  } else {
    u.exp += u.earnedExp;
    while (u.exp > getNextExp(u.level) && u.level < MAX_HERO_LVL) {
      u.exp -= getNextExp(u.level);
      u.level++;
    }
    if (u.level >= MAX_HERO_LVL) u.exp = getNextExp(u.level);
  }
  return u.level > from ? { name: u.name, from, to: u.level } : null;
}
