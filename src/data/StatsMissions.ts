import { UnitInfo } from "../game/UnitInfo";
import { newHero } from "../game/newHero";
import { GAME_MODE_IDS, getGameMode, getLevelReq } from "./StatsMisc";
import { MAP_ORDER } from "./StatsMaps";

export interface Mission {
  challenge: string;
  num: number;
  i: number;
  mode: string;
  score: number;
  map: string;
  team1: number;
  team2: number;
  rewards: MissionReward[];
  units: UnitInfo[] | null;
  extra: Record<string, unknown>;
  squadExtra: Record<string, unknown>;
  desc: string;
  song: string | null;
}

export type MissionReward = number | string;

const REWARD_GUNS: readonly string[] = [
  "Five Seven", "Vector", "Club", "XM8A1", "Judge", "Lynx", "TAC 12", "SAW",
  "MK32", "Flame Thrower", "Laser Cutter",
  "P99", "UMP 45", "Axe", "AK12", "Sawed-Off", "L115", "MTS 255", "HMG50",
  "Panzer", "Flak Cannon", "Pulse Rifle",
  "Crossbow", "MTAR", "Katana", "FAL OSW", "Uzi", "MK14", "DB12", "XMG",
  "GL06", "Freeze Ray", "DSR1",
  "Desert Eagle", "P90", "Stun Baton", "ARX 160", "FMG9", "G36R", "USAS12",
  "Vulcan", "M202", "Acid Hound", "Rail Gun",
];

const MAP_QUEUE: readonly { mode: string; map: string }[] = [
  { mode: "tdm", map: "factory" },
  { mode: "dom", map: "frigate" },
  { mode: "tdm", map: "junkyard" },
  { mode: "tgg", map: "temple" },
  { mode: "tdm", map: "canyon" },
  { mode: "ctf", map: "frigate" },
  { mode: "one", map: "gorge" },
  { mode: "tdm", map: "forest" },
  { mode: "gg", map: "temple" },
  { mode: "tgg", map: "caves" },
  { mode: "tdm", map: "street" },
  { mode: "ctf", map: "forest" },
  { mode: "tdm", map: "caves" },
  { mode: "tgg", map: "junkyard" },
  { mode: "one", map: "construction" },
  { mode: "tdm", map: "cqc" },
  { mode: "dom", map: "factory" },
  { mode: "tgg", map: "forest" },
  { mode: "ctf", map: "volcano" },
  { mode: "gg", map: "forest" },
  { mode: "tdm", map: "temple" },
  { mode: "ctf", map: "factory" },
  { mode: "tdm", map: "volcano" },
  { mode: "ctf", map: "caves" },
  { mode: "dom", map: "junkyard" },
  { mode: "ctf", map: "cavesb" },
  { mode: "ctf", map: "construction" },
  { mode: "dom", map: "cavesb" },
  { mode: "ctf", map: "temple" },
  { mode: "one", map: "factory" },
  { mode: "tgg", map: "volcano" },
  { mode: "dom", map: "forest" },
  { mode: "tdm", map: "frigate" },
  { mode: "ctf", map: "gorge" },
  { mode: "dom", map: "caves" },
  { mode: "dm", map: "volcano" },
  { mode: "ctf", map: "canyon" },
  { mode: "dom", map: "volcano" },
  { mode: "tgg", map: "cavesb" },
  { mode: "dom", map: "canyon" },
  { mode: "tgg", map: "gorge" },
  { mode: "ctf", map: "junkyard" },
  { mode: "dom", map: "temple" },
  { mode: "tgg", map: "street" },
  { mode: "tdm", map: "construction" },
  { mode: "tgg", map: "canyon" },
  { mode: "tdm", map: "cavesb" },
  { mode: "dom", map: "gorge" },
  { mode: "tgg", map: "frigate" },
  { mode: "tgg", map: "cqc" },
  { mode: "dm", map: "canyon" },
  { mode: "dom", map: "construction" },
];

export const ALL_TRAITS: Readonly<Record<string, number>> = {
  turret1: 1, turret2: 1, coating: 1, energy: 1, proof: 1, boots: 1,
  gunplay: 1, inspire: 1, magnet: 1, assist: 1, deflect: 1, bomb: 1,
  aura: 1, love: 1, stealth: 1, dodge: 1,
};

const DEV_TRAITS: Readonly<Record<string, number>> = (() => {
  const bag: Record<string, number> = { streak_: 1 };
  for (const k of Object.keys(ALL_TRAITS)) {
    if (k !== "stealth") bag[k] = ALL_TRAITS[k];
  }
  return bag;
})();

export let itemAr: Mission[] = [];
export let missAr: Mission[] = [];
export let chalAr: Mission[] = [];
export let daily: Mission = blankMission();

let iMap = 0;
let iReward = 0;

function blankMission(): Mission {
  return {
    challenge: "", num: 0, i: 0, mode: "", score: 0, map: "",
    team1: 0, team2: 0, rewards: [], units: null,
    extra: {}, squadExtra: {}, desc: "", song: null,
  };
}

export function u(
  cls: string, specific = "", name = "", extra: Record<string, unknown> | null = null,
): UnitInfo {
  const unit = newHero(cls, specific, name);
  if (extra) {
    const carried: Record<string, unknown> = {};
    for (const k of Object.keys(unit.extra)) {
      if (k.startsWith("pending")) carried[k] = unit.extra[k];
    }
    unit.extra = { ...structuredClone(extra), ...carried };
  }
  return unit;
}

function addItem(
  challenge: string, mode: string, score: number, map: string,
  team1: number, team2: number, rewards: MissionReward[],
  units: UnitInfo[] | null = null, desc = "",
  squadExtra: Record<string, unknown> | null = null,
  extra: Record<string, unknown> | null = null,
): void {
  const item: Mission = {
    challenge, num: 0, i: 0, mode, score, map, team1, team2,
    rewards: rewards.slice(), units,
    extra: extra ?? {},
    squadExtra: squadExtra ?? {},
    desc, song: null,
  };

  if (!item.mode) {
    item.mode = MAP_QUEUE[iMap].mode;
    item.map = MAP_QUEUE[iMap].map;
    if (!getGameMode(MAP_QUEUE[iMap].mode).teams) {
      item.team1 = 1;
      item.team2 = 7;
    }
    iMap++;
  }

  if (!item.score) item.score = getGameMode(item.mode).startscore;

  for (let i = 0; i < 3; i++) {
    if (item.rewards[i] === -1) {
      item.rewards[i] = 100 + getLevelReq(itemAr.length, i + 1) * 25;
    }
  }

  if (units) item.team2 = units.length;

  if (challenge && !item.extra.raiseLvl) item.extra.raiseLvl = 2;
  if (challenge) item.song = "M_French";
  if (item.extra.song) item.song = item.extra.song as string;

  item.i = itemAr.length;
  itemAr.push(item);
  if (challenge) {
    item.num = chalAr.length;
    chalAr.push(item);
  } else {
    item.num = missAr.length;
    missAr.push(item);
  }
}

function setDefaultRewards(): void {
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < itemAr.length; j++) {
      if (!itemAr[j].rewards[i]) {
        itemAr[j].rewards[i] = iReward === REWARD_GUNS.length
          ? "random2"
          : REWARD_GUNS[iReward++];
      }
    }
  }
}

export function createDaily(now: Date = new Date()): Mission {
  const num = now.getUTCDate() + now.getUTCMonth();
  const item = blankMission();
  item.mode = GAME_MODE_IDS[num % GAME_MODE_IDS.length];
  item.score = getGameMode(item.mode).scorelist[3];
  item.map = MAP_ORDER[num % MAP_ORDER.length];
  if (getGameMode(item.mode).teams) {
    item.team1 = 5;
    item.team2 = 5;
  } else {
    item.team1 = 1;
    item.team2 = 9;
  }
  return item;
}

export function init(): void {
  itemAr = [];
  missAr = [];
  chalAr = [];
  iMap = 0;
  iReward = 0;

  const fourMissions = (): void => {
    addItem("", "", 0, "", 5, 5, [0, 0, 0]);
    addItem("", "", 0, "", 5, 5, [-1, -1, -1]);
    addItem("", "", 0, "", 5, 5, [0, 0, 0]);
    addItem("", "", 0, "", 5, 5, ["random2", "random2", "random2"]);
  };

  addItem("", "", 7, "", 1, 1, ["gun", 0, 0], null, "", null,
    { tut1: 1, raiseLvl: -1 });
  addItem("", "", 0, "", 2, 2, [0, -1, -1], null, "", null, { tut2: 1 });
  addItem("", "", 15, "", 2, 2, ["features", 0, 0]);
  addItem("", "", 0, "", 3, 3, ["random2", "random2", "random2"]);

  {
    const traits = { permRegen: 1, statMod: 0.2 };
    const enemies = Array.from({ length: 5 }, () => u("", "eMed", "", traits));
    addItem("Doctors of Doom", "tdm", 15, "street", 5, 5,
      ["med", "random2", "$med"], enemies, "Enemies have Super Healing");
  }

  addItem("", "", 0, "", 3, 3, [-1, 0, 0]);
  addItem("", "", 0, "", 4, 4, ["jug", -1, -1]);
  addItem("", "", 0, "", 4, 4, [-1, 0, 0]);
  addItem("", "", 0, "", 5, 5, ["random2", "random2", "random2"]);

  {
    const traits = { skills: { streak_: 1 }, statMod: 0.4 };
    const enemies = Array.from({ length: 5 }, () => u("", "", "", traits));
    addItem("Reverse Perfection", "gg", 25, "street", 1, 5,
      ["random2", "random2", "$gun"], enemies, "Gun Game, custom weapons",
      null, { gungame: "reverse" });
  }

  fourMissions();

  {
    const traits = { statMod: 0.2 };
    const enemies = Array.from({ length: 4 }, () => u("", "eNin", "", traits));
    addItem("Ninja Nights", "tdm", 10, "street", 4, 4,
      ["nin", "random2", "$nin"], enemies, "Enemies are Invisible");
  }

  fourMissions();

  {
    const traits = { skills: ALL_TRAITS };
    const enemies = Array.from({ length: 4 }, () => u("", "enemy", "", traits));
    addItem("Raze Protocol", "tdm", 10, "street", 4, 4,
      ["random2", "random2", "random2"], enemies,
      "Everyone has ALL possible traits", traits);
  }

  fourMissions();

  {
    const traits = { skills: { streak_: 1 }, statMod: 0.4 };
    const enemies = Array.from({ length: 5 }, () => u("", "eMer", "", traits));
    addItem("Rocket Race 4.0", "gg", 20, "street", 1, 5,
      ["mer", "random2", "$mer"], enemies, "Like Gun Game, but more Boom!",
      null, { gungame: "rocket" });
  }

  fourMissions();

  {
    const traits = { skills: { streak_: 1 }, statMod: 0.2 };
    const enemies = Array.from({ length: 4 }, () => u("", "enemy", "", traits));
    addItem("Going Streaking!", "tdm", 10, "street", 4, 4,
      ["random2", "random2", "$eng"], enemies,
      "All Killstreaks are earned 2x quicker", { skills: { streak_: 1 } });
  }

  fourMissions();

  {
    const enemies = [
      u("", "eSni", "", { kills: 2, statMod: 0.2 }),
      u("", "eSni", "", { kills: 2, statMod: 0.2 }),
      u("", "eSni", "", { kills: 2, statMod: 0.2 }),
      u("", "eSni", "", { kills: 3, statMod: 0.2 }),
      u("", "eSni", "", { kills: 3, statMod: 0.2 }),
    ];
    addItem("Watch Your Back", "tdm", 15, "street", 1, 5,
      ["sni", "random2", "$sni"], enemies, "You are Invisible",
      { skills: { stealth_: 1 } });
  }

  fourMissions();

  {
    const traits = { statMod: 0.2 };
    const enemies = Array.from({ length: 4 }, () => u("", "enemy", "", traits));
    enemies.push(u("", "hitman", "", { statMod: 2, raiseLvl: 5, scale: 0.5 }));
    addItem("The Hitman", "tdm", 10, "street", 5, 5,
      ["random2", "random2", "$jug"], enemies, "Beware the Hitman");
  }

  fourMissions();

  {
    const traits = { skills: { streak_: 1 }, statMod: 0.25 };
    const enemies = [0, 1, 2, 3, 4].map((n) => u("", `eEli${n}`, "", traits));
    addItem("Elemental Fury", "tdm", 10, "street", 5, 5,
      ["eli", "random2", "$eli"], enemies, "Face a team of Powerful Elites");
  }

  fourMissions();

  {
    const traits = { skills: { streak__: 1 }, statMod: 0.3 };
    const enemies = ["$nin", "$med", "$gun", "$eli"]
      .map((id) => u("", id, "", traits));
    addItem("Next Generation", "tdm", 10, "street", 5, 4,
      ["random2", "random2", "random2"], enemies, "The Best of the Best",
      null, { raiseLvl: 3 });
  }

  fourMissions();

  {
    const traits = { skills: { streak_: 1 }, statMod: 0.5 };
    const enemies = ["$eng", "$sni", "$jug", "$mer"]
      .map((id) => u("", id, "", traits));
    addItem("Veteran Heroes", "tdm", 10, "street", 5, 4,
      ["random2", "random2", "random2"], enemies, "Defeat the OG Heroes",
      null, { raiseLvl: 3 });
  }

  fourMissions();

  {
    const traits = { statMod: 1, skills: DEV_TRAITS };
    const enemies = ["justin", "mike"].map((id) => u("", id, "", traits));
    addItem("Devs de la muerte", "tdm", 25, "street", 2, 2,
      ["random2", "random2", "random2"], enemies, "Defeat the Developers",
      null, { raiseLvl: 5, developers: {}, song: "M_SFH" });
  }

  setDefaultRewards();
  daily = createDaily();
}

init();

export function getMission(i: number): Mission {
  return itemAr[Math.max(0, Math.min(itemAr.length - 1, i))];
}

export function missionTitle(m: Mission): string {
  return m.challenge || `Mission ${m.num + 1}`;
}
