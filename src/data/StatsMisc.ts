export const MAX_LVL = 30;

export const MAX_HERO_LVL = 50;

export const EXP_RATE = 3;

export const MAX_MISSION = 60;

export interface Mod {
  readonly id: string;
  readonly name: string;
  readonly desc: string;
  readonly expmod: number;
  readonly exp: string;
}

const MOD_TABLE: Readonly<Record<string, { name: string; desc: string; expmod: number }>> = {
  none: { name: "None", desc: "No mod selected.", expmod: 1 },
  sky9: { name: "Sky9", desc: "Super Physics!", expmod: 1 },
  clips: { name: "Pack Mule", desc: "Infinite spare ammo.", expmod: 0.4 },
  ammo: { name: "Wizardry", desc: "Magically infinite ammo.", expmod: 0.2 },
  party: { name: "Fiesta", desc: "Random weapons, every spawn.", expmod: 0.7 },
  bodypop: { name: "Tin Man", desc: "Joints are held on with glue.", expmod: 1 },
};

export function getMod(id: string): Mod {
  const m = MOD_TABLE[id] ?? { name: id, desc: "", expmod: 1 };
  return {
    id, ...m,
    exp: m.expmod === 1 ? "" : `-${100 - m.expmod * 100}% EXP`,
  };
}

export function buildModList(unlocked: readonly string[]): string[] {
  const mods = ["none", "sky9", "clips"];
  if (unlocked.includes("secret1")) mods.push("bodypop");
  if (unlocked.includes("secret2")) mods.push("ammo");
  if (unlocked.includes("secret3")) mods.push("party");
  return mods;
}

export interface GameMode {
  readonly id: string;
  readonly sprite: string;
  readonly name: string;
  readonly desc: string;
  readonly scoretype: "KILLS" | "FLAGS" | "POINTS" | "LIVES";
  readonly startscore: number;
  readonly scorelist: readonly number[];
  readonly teams: boolean;
}

const GAME_MODES: Readonly<Record<string, GameMode>> = {
  dm: {
    id: "dm", sprite: "dm", name: "Deathmatch",
    desc: "Kill enemies to reach the score.",
    scoretype: "KILLS", startscore: 10, scorelist: [5, 10, 15, 25, 50], teams: false,
  },
  tdm: {
    id: "tdm", sprite: "tdm", name: "Team Deathmatch",
    desc: "Kill enemies to reach the score.",
    scoretype: "KILLS", startscore: 25, scorelist: [10, 15, 25, 50, 100], teams: true,
  },
  elim: {
    id: "elim", sprite: "elim", name: "Elimination",
    desc: "Kill all enemies and be the survivor.",
    scoretype: "LIVES", startscore: 5, scorelist: [3, 5, 10, 15, 25], teams: false,
  },
  telim: {
    id: "telim", sprite: "telim", name: "Team Elimination",
    desc: "Kill the enemy team and be the surviving team.",
    scoretype: "LIVES", startscore: 5, scorelist: [3, 5, 10, 15, 25], teams: true,
  },
  ctf: {
    id: "ctf", sprite: "ctf", name: "Capture the Flag",
    desc: "Capture the enemy's flag.",
    scoretype: "FLAGS", startscore: 3, scorelist: [3, 5, 7, 10, 15], teams: true,
  },
  dom: {
    id: "dom", sprite: "dom", name: "Domination",
    desc: "Capture and hold zones to gain points.",
    scoretype: "POINTS", startscore: 50, scorelist: [50, 75, 100, 150, 200], teams: true,
  },
  one: {
    id: "one", sprite: "one", name: "One Man Army",
    desc: "Work as a team to kill the One Man Army.",
    scoretype: "KILLS", startscore: 10, scorelist: [5, 10, 25, 50, 100], teams: false,
  },
  zom: {
    id: "zom", sprite: "zom", name: "Outbreak",
    desc: "Survive the zombies. Get killed by one, and become one.",
    scoretype: "LIVES", startscore: 10, scorelist: [5, 10, 25, 50, 100], teams: false,
  },
  gg: {
    id: "gg", sprite: "gg", name: "Gun Game",
    desc: "Kill to upgrade your weapon.",
    scoretype: "KILLS", startscore: 15, scorelist: [10, 15, 25, 50, 75], teams: false,
  },
  tgg: {
    id: "tgg", sprite: "tgg", name: "Team Gun Game",
    desc: "Kills upgrade your team weapons.",
    scoretype: "KILLS", startscore: 25, scorelist: [10, 15, 25, 50, 75], teams: true,
  },
};

export const GAME_MODE_IDS = ["dm", "one", "gg", "tdm", "ctf", "dom", "tgg"] as const;

export const ALL_GAME_MODE_IDS = [
  "dm", "tdm", "elim", "telim", "ctf", "dom", "one", "zom", "gg", "tgg",
] as const;

const GUN_GAME_DEFAULT: Readonly<Record<number, readonly string[]>> = {
  10: [
    "P99",
    "MTAR",
    "AK12",
    "Uzi",
    "MK14",
    "DB12",
    "Vulcan",
    "Acid Hound",
    "DSR1",
    "M202",
  ],
  15: [
    "P99",
    "MTAR",
    "AK12",
    "Sawed-Off",
    "Uzi",
    "MK14",
    "DB12",
    "XMG",
    "Vulcan",
    "Freeze Ray",
    "Acid Hound",
    "DSR1",
    "GL06",
    "M202",
    "Rail Gun",
  ],
  25: [
    "Crossbow",
    "Desert Eagle",
    "MTAR",
    "P90",
    "AK12",
    "FAL OSW",
    "Sawed-Off",
    "Uzi",
    "FMG9",
    "L115",
    "MK14",
    "MTS 255",
    "DB12",
    "USAS12",
    "HMG50",
    "XMG",
    "Vulcan",
    "Panzer",
    "GL06",
    "M202",
    "Freeze Ray",
    "Acid Hound",
    "Pulse Rifle",
    "DSR1",
    "Rail Gun",
  ],
  50: [
    "TAC 45",
    "Five Seven",
    "P99",
    "Crossbow",
    "Desert Eagle",
    "Bizon",
    "Vector",
    "UMP 45",
    "MTAR",
    "P90",
    "Honey Badger",
    "XM8A1",
    "AK12",
    "FAL OSW",
    "ARX 160",
    "BM9",
    "Judge",
    "Sawed-Off",
    "Uzi",
    "FMG9",
    "Intervention",
    "Lynx",
    "L115",
    "MK14",
    "G36R",
    "R870",
    "TAC 12",
    "MTS 255",
    "DB12",
    "USAS12",
    "MK48",
    "SAW",
    "HMG50",
    "XMG",
    "Vulcan",
    "SMAWG",
    "MK32",
    "Panzer",
    "GL06",
    "M202",
    "Tesla",
    "Flame Thrower",
    "Flak Cannon",
    "Freeze Ray",
    "Acid Hound",
    "Ion Cannon",
    "Laser Cutter",
    "Pulse Rifle",
    "DSR1",
    "Rail Gun",
  ],
  75: [
    "TAC 45",
    "Five Seven",
    "P99",
    "Crossbow",
    "Desert Eagle",
    "$P99",
    "$Desert Eagle",
    "Bizon",
    "Vector",
    "UMP 45",
    "MTAR",
    "P90",
    "$Bizon",
    "$UMP 45",
    "Honey Badger",
    "XM8A1",
    "AK12",
    "FAL OSW",
    "ARX 160",
    "$XM8A1",
    "$AK12",
    "BM9",
    "Judge",
    "Sawed-Off",
    "Uzi",
    "FMG9",
    "$Judge",
    "$Sawed-Off",
    "Intervention",
    "Lynx",
    "L115",
    "MK14",
    "G36R",
    "$Lynx",
    "$L115",
    "R870",
    "TAC 12",
    "MTS 255",
    "DB12",
    "USAS12",
    "$R870",
    "$TAC 12",
    "MK48",
    "SAW",
    "HMG50",
    "XMG",
    "Vulcan",
    "$SAW",
    "$HMG50",
    "SMAWG",
    "MK32",
    "Panzer",
    "GL06",
    "M202",
    "$MK32",
    "$M202",
    "Tesla",
    "Flame Thrower",
    "Flak Cannon",
    "Freeze Ray",
    "Acid Hound",
    "$Flame Thrower",
    "$Freeze Ray",
    "Ion Cannon",
    "Laser Cutter",
    "Pulse Rifle",
    "DSR1",
    "Rail Gun",
    "$Ion Cannon",
    "$Pulse Rifle",
    "Katana",
    "Stun Baton",
    "Club",
    "Axe",
    "Knife",
  ],
};

const GUN_GAME_ROCKET: readonly string[] = [
  "$Desert Eagle",
  "Flak Cannon",
  "Flame Thrower",
  "Laser Cutter",
  "MK32",
  "GL06",
  "SMAWG",
  "Panzer",
  "M202",
  "Betsy",
  "$Flak Cannon",
  "$Flame Thrower",
  "$Laser Cutter",
  "$MK32",
  "$GL06",
  "$SMAWG",
  "$Panzer",
  "$M202",
  "$Betsy",
  "$Axe",
];

const GUN_GAME_REVERSE: readonly string[] = [
  "$Shuriken",
  "$Betsy",
  "$M202",
  "$MK32",
  "$Vulcan",
  "$SAW",
  "$FAL OSW",
  "$ARX 160",
  "$L115",
  "$Lynx",
  "$DSR1",
  "$Rail Gun",
  "$Acid Hound",
  "$Freeze Ray",
  "$TAC 12",
  "$MTS 255",
  "$Sawed-Off",
  "$Judge",
  "$P90",
  "$UMP 45",
  "$Desert Eagle",
  "$Crossbow",
  "$Katana",
  "$Stun Baton",
  "$Knife",
];

export const GUN_GAME_LADDERS: Readonly<Record<string, readonly string[]>> = {
  "10": GUN_GAME_DEFAULT[10],
  "15": GUN_GAME_DEFAULT[15],
  "25": GUN_GAME_DEFAULT[25],
  "50": GUN_GAME_DEFAULT[50],
  "75": GUN_GAME_DEFAULT[75],
  rocket: GUN_GAME_ROCKET,
  reverse: GUN_GAME_REVERSE,
};

export function getGunGameWeapon(
  score: number, gungame: string, useScore: number,
): string | undefined {
  let ar: readonly string[];
  switch (gungame) {
    case "rocket": ar = GUN_GAME_ROCKET; break;
    case "reverse": ar = GUN_GAME_REVERSE; break;
    default: ar = GUN_GAME_DEFAULT[useScore] ?? []; break;
  }
  if (score >= ar.length) score = ar.length - 1;
  if (score < 0) score = 0;
  return ar[score];
}

export function getGameMode(id: string): GameMode {
  return GAME_MODES[id] ?? {
    id, sprite: id, name: id, desc: "",
    scoretype: "KILLS", startscore: 0, scorelist: [], teams: false,
  };
}

export function getLevelReq(curStage: number, diff: number): number {
  switch (diff) {
    case 1: return Math.ceil((curStage + 1) * 0.3);
    case 2: return Math.ceil((curStage + 1) * 0.3) + 10;
    case 3: return MAX_LVL;
    default: return 0;
  }
}

export const DIFF_NAMES = ["FUN", "NORMAL", "HARD", "INSANE"] as const;
export const DIFF_COLORS = [0x66ff99, 0xffffff, 0xffcc00, 0xcc3300] as const;

export const GUN_TYPE_NAMES = [
  "Pistol", "SMG", "Blade", "Rifle", "Dual", "Sniper", "Shotgun",
  "Machine Gun", "Explosive", "Elemental", "Experimental",
  "Attachment", "Equipment", "Poop", "ERROR",
] as const;
