import { UT } from "../core/UT";
import * as Classes from "../data/StatsClasses";
import * as Perks from "../data/StatsPerks";
import { HERO_NAMES, EVIL_NAMES } from "../data/names";
import { UnitInfo } from "./UnitInfo";

export { HERO_NAMES, EVIL_NAMES } from "../data/names";

export const HERO_SPECIFICS = [
  "mike", "justin",
  "$eng", "$sni", "$jug", "$mer", "$med", "$gun", "$eli", "$nin", "$akq",
  "starter1", "starter2",
] as const;

export const RAND_AI_RARITY: readonly number[] = [
  ...Array<number>(16).fill(0),
  ...Array<number>(8).fill(1),
  ...Array<number>(4).fill(2),
  ...Array<number>(2).fill(3),
];

interface PendingWeapons {
  primary?: { id: string; rarity: number } | { random: "primary" };
  secondary?: { id: string; rarity: number } | { random: "secondary" };
  randomMods?: boolean;
}

export function newHero(cls = "", specific = "", name = ""): UnitInfo {
  const info = new UnitInfo();

  info.cls = cls || "eng";
  if ((Classes.CLASSES_ALL as readonly string[]).includes(specific)) info.cls = specific;

  info.name = name || UT.randEl(HERO_NAMES);
  info.trait = UT.randEl(Classes.itemOb[info.cls].traits);
  info.flaw = UT.randEl(Perks.flawAr).id;
  info.streak = UT.randEl(Classes.itemOb[info.cls].streaks);
  info.level = 1;
  info.exp = 0;
  info.status = 400;
  info.color = UT.irand(1, 6);
  info.face = UT.irand(1, 3);
  info.skin = UT.irand(1, 8);
  info.hair = UT.irand(1, 12);
  info.head = UT.randEl(Classes.itemOb[info.cls].frames);
  info.body = UT.randEl(Classes.itemOb[info.cls].frames);

  let randEquips = false;
  const pending: PendingWeapons = {};
  const frames = (c: string): readonly number[] => Classes.itemOb[c].frames;

  const unique = (
    heroName: string, heroCls: string, trait: string, flaw: string,
    streak: string, color: number, frame: number,
    perkPairs: readonly (readonly [string, string])[],
  ): void => {
    info.name = heroName;
    info.cls = heroCls;
    info.trait = trait;
    info.flaw = flaw;
    info.streak = streak;
    info.color = color;
    info.head = info.body = frame;
    info.perks = perkPairs.map(([a, b]) => [a, b, 0] as [string, string, number]);
    info.unique = true;
  };

  switch (specific) {
    case "justin":
      info.name = "Justin";
      info.cls = "nin";
      info.color = 1;
      info.trait = "bomb";
      info.streak = "dualtur";
      info.head = info.body = 242;
      pending.primary = { id: "Intervention", rarity: 3 };
      pending.secondary = { id: "Desert Eagle", rarity: 3 };
      pending.randomMods = true;
      info.randomPerks();
      break;

    case "mike":
      info.name = "Mike";
      info.cls = "mer";
      info.color = 1;
      info.trait = "bomb";
      info.streak = "rockettur";
      info.head = info.body = 241;
      pending.primary = { id: "R870", rarity: 3 };
      pending.secondary = { id: "Katana", rarity: 3 };
      pending.randomMods = true;
      info.randomPerks();
      break;

    case "eNin":
      info.name = UT.randEl(EVIL_NAMES);
      info.cls = "nin";
      info.color = 4;
      info.trait = "stealth_";
      info.streak = "smoke";
      info.head = info.body = frames("nin")[0];
      randEquips = true;
      info.randomPerks();
      break;

    case "eMer":
      info.name = UT.randEl(EVIL_NAMES);
      info.cls = "mer";
      info.trait = "boots";
      info.streak = "akimbo";
      info.head = info.body = frames("mer")[1];
      randEquips = true;
      info.randomPerks();
      break;

    case "eMed":
      info.name = UT.randEl(EVIL_NAMES);
      info.cls = "med";
      info.color = 6;
      info.trait = "aura";
      info.streak = "armor";
      info.head = frames("med")[0];
      info.body = frames("med")[1];
      info.extra.skills = { regen1: 1, regen2: 1, streak_: 1 };
      randEquips = true;
      info.randomPerks();
      break;

    case "eEli0": case "eEli1": case "eEli2": case "eEli3": case "eEli4": {
      const num = parseInt(specific.charAt(4), 10);
      info.name = UT.randEl(EVIL_NAMES);
      info.cls = "eli";
      info.color = [2, 6, 5, 1, 3][num];
      info.trait = "coating_";
      info.streak = UT.randEl(Classes.itemOb["eli"].streaks);
      info.head = info.body = frames("eli")[1];
      info.extra.pendingPrimaryTypeIndex = [10, num];
      pending.secondary = { random: "secondary" };
      pending.randomMods = true;
      info.randomPerks();
      break;
    }

    case "eSni":
      info.name = UT.randEl(EVIL_NAMES);
      info.cls = "sni";
      info.color = 4;
      info.trait = "magnet";
      info.streak = UT.randEl(Classes.itemOb["sni"].streaks);
      info.head = info.body = frames("sni")[0];
      pending.primary = { id: "Intervention", rarity: 3 };
      pending.secondary = { id: "Desert Eagle", rarity: 3 };
      pending.randomMods = true;
      info.randomPerks();
      break;

    case "enemy":
      info.name = UT.randEl(EVIL_NAMES);
      randEquips = true;
      info.randomPerks();
      break;

    case "$eng":
      unique("Nathan", "eng", "turret2", "status0", "rockettur", 2, 161,
        [["aim1", "regen1"], ["aim2", "regen2"], ["aim3", "luck1"]]);
      break;
    case "$sni":
      unique("Jyn", "sni", "magnet", "detect0", "wallhack", 4, 171,
        [["focus", "length1"], ["killsteal", "streak1"], ["sacrifice", "streak2"]]);
      break;
    case "$jug":
      unique("Tower", "jug", "deflect", "tired0", "element", 4, 181,
        [["burn1", "status1"], ["explo1", "will"], ["head1", "adren"]]);
      break;
    case "$mer":
      unique("Dex", "mer", "boots", "streak0", "akimbo", 1, 191,
        [["pickup1", "theif"], ["rage", "will"], ["sacrifice", "self1"]]);
      break;
    case "$med":
      unique("Mayday", "med", "aura", "head0", "heal", 5, 201,
        [["regen1", "detect1"], ["regen2", "exp1"], ["adren", "gold1"]]);
      break;
    case "$gun":
      unique("Calamity", "gun", "gunplay", "detect0", "rofboost", 6, 211,
        [["streak2", "spawn1"], ["focus", "gold1"], ["sacrifice", "length1"]]);
      break;
    case "$eli":
      unique("Fatale", "eli", "energy", "pickup0", "firebeam", 2, 221,
        [["self1", "will"], ["status1", "explo1"], ["burn1", "head1"]]);
      break;
    case "$nin":
      unique("Evelynn", "nin", "stealth", "aim0", "shuriken", 4, 231,
        [["damage1", "killsteal"], ["luck1", "rage"], ["adren", "sacrifice"]]);
      break;
    case "$akq":
      unique("Rusty", "akq", "tired1", "luck0", "mirror", 5, 251,
        [["proof", "boots"], ["dodge", "deflect"], ["stealth", "bomb"]]);
      break;

    case "starter1":
      info.name = "Wesley";
      info.cls = "eng";
      info.trait = "tired1";
      info.flaw = "detect0";
      info.streak = "aimbot";
      info.color = 3;
      info.face = 3;
      info.skin = 2;
      info.hair = 13;
      info.head = info.body = frames("eng")[0];
      info.perks = [["gold1", "exp1", 0], ["regen1", "regen2", 0], ["aim1", "aim3", 0]];
      break;

    case "starter2":
      info.name = "Sanchez";
      info.cls = "gun";
      info.trait = "inspire";
      info.flaw = "regen0";
      info.streak = "critboost";
      info.color = 1;
      info.face = 1;
      info.skin = 4;
      info.hair = 1;
      info.head = info.body = frames("gun")[1];
      info.perks = [["exp1", "tired1", 0], ["status1", "luck1", 0], ["tired1", "length1", 0]];
      break;

    default:
      info.randomPerks();
  }

  if (randEquips) {
    pending.primary = { random: "primary" };
    pending.secondary = { random: "secondary" };
    pending.randomMods = true;
  }
  if (Object.keys(pending).length) info.extra.pendingWeapons = pending;

  info.initStats();
  return info;
}
