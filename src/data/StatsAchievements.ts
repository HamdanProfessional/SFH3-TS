import type { Container, Ticker } from "pixi.js";
import { SD, achHooks } from "../state/SD";
import { upgradeHooks } from "../game/GunInfo";
import { combatHooks } from "../game/combatHooks";
import { AchievementToast } from "../ui/AchievementToast";

export interface Achievement {
  readonly id: string;
  readonly sprite: string;
  readonly name: string;
  readonly desc: string;
  readonly max?: number;
  readonly progress?: string;
  readonly useMax?: boolean;
  readonly unlock?: string;
}

export const achOrder = [
  "campaign", "challenges", "levelmax", "hard", "insane", "upgrade",
  "buy", "sell", "enemies", "eng", "mer", "gun", "sni", "jug", "eli",
  "med", "nin", "classes",
  "secret1", "secret2", "secret3",
] as const;

const TABLE: Readonly<Record<string, Omit<Achievement, "id" | "sprite">>> = {
  campaign: { name: "The End?", desc: "Beat the game." },
  challenges: { name: "Strike Force Hero", desc: "Complete all Challenges." },
  levelmax: { name: "Maxed Out", desc: "Reach level 50 with any Soldier." },
  hard: { name: "Battle Hero", desc: "Complete all Stages on Hard." },
  insane: { name: "Veteran", desc: "Complete all Stages on Insane." },
  upgrade: { name: "Heavily Equipped", desc: "Upgrade a weapon to 5 stars." },
  buy: {
    name: "Big Spender", desc: "Spend $750,000 funds.",
    max: 750000, progress: "$@ spent",
  },
  sell: {
    name: "Entrepreneur", desc: "Sell $100,000 worth of items.",
    max: 100000, progress: "$@ sold",
  },
  enemies: {
    name: "Take out the Trash", desc: "Defeat 500 enemies.",
    max: 500, progress: "@ defeated",
  },
  eng: {
    name: "Turret Master", desc: "Get 150 kills with Turrets as an Engineer.",
    max: 150, progress: "@ kills",
  },
  mer: {
    name: "Unfair Advantage", desc: "Get 200 killstreak kills as a Mercenary.",
    max: 200, progress: "@ kills",
  },
  gun: {
    name: "Going Streaking", desc: "Activate 75 killstreaks as a Gunslinger.",
    max: 75, progress: "@ activated",
  },
  sni: {
    name: "Boom, Headshot!", desc: "Get 175 headshot kills as a Sniper.",
    max: 175, progress: "@ kills",
  },
  jug: {
    name: "Iron Man", desc: "Take 100,000 damage as a Juggernaut.",
    max: 100000, progress: "@ damage",
  },
  eli: {
    name: "Elementalist", desc: "Kill 250 status afflicted enemies as an Elite.",
    max: 250, progress: "@ kills",
  },
  med: {
    name: "Close Call", desc: "Activate 75 killstreaks as a Medic.",
    max: 75, progress: "@ activated",
  },
  nin: {
    name: "Assassin", desc: "Kill 175 unaware enemies as a Ninja.",
    max: 175, progress: "@ kills",
  },
  classes: {
    name: "Diversity", desc: "Unlock all Classes.",
    max: 8, progress: "@ unlocked", useMax: true,
  },
  secret1: {
    name: "Heads Up!", desc: "Found a Future Soldier!", unlock: "Tin Man",
  },
  secret2: {
    name: "Thumbs Up!", desc: "High Five the Future Soldier!", unlock: "Wizardry",
  },
  secret3: {
    name: "Cold Feet!", desc: "Thaw the Future Soldier!", unlock: "Fiesta",
  },
};

export function getAchievement(id: string): Achievement {
  return { id, sprite: id, ...(TABLE[id] ?? { name: "", desc: "" }) };
}

export function getAchievementNum(n: number): Achievement {
  return getAchievement(achOrder[n] ?? "");
}

export function idToNum(id: string): number {
  return (achOrder as readonly string[]).indexOf(id);
}

export function hasAchievement(id: string): boolean {
  return SD.achievements.includes(id);
}

export function setAchievement(id: string): boolean {
  if (idToNum(id) === -1) return false;
  if (SD.achievements.includes(id)) return false;
  SD.achievements.push(id);
  SD.save();
  return true;
}

export function checkAchVariable(id: string, addAmt: number): void {
  const cur: number | undefined = SD.achOb[id];
  SD.achOb[id] = (typeof cur === "number" && !Number.isNaN(cur) ? cur : 0) + addAmt;

  const max = getAchievement(id).max;
  if (max !== undefined && SD.achOb[id] >= max) {
    awardAchievement(id);
  }
}

let toast: AchievementToast | null = null;
let installed = false;

export function awardAchievement(id: string): boolean {
  if (!setAchievement(id)) return false;
  toast?.show(getAchievement(id));
  return true;
}

export function installAchievements(
  overlay?: Container,
  ticker?: Ticker,
): AchievementToast | null {
  if (installed) return toast;
  installed = true;

  combatHooks.unit = (id, amt) => {
    if (getAchievement(id).max === undefined) awardAchievement(id);
    else checkAchVariable(id, amt);
  };
  combatHooks.variable = checkAchVariable;
  combatHooks.bullet = (id) => void awardAchievement(id);
  combatHooks.secret1 = () => void awardAchievement("secret1");
  upgradeHooks.onFullyUpgraded = () => void awardAchievement("upgrade");
  upgradeHooks.onUpgradeCost = (cost) => checkAchVariable("buy", cost);
  achHooks.check = checkAchVariable;
  achHooks.set = (id) => void awardAchievement(id);

  if (overlay) {
    toast = new AchievementToast(ticker);
    overlay.addChild(toast.view);
  }
  return toast;
}
