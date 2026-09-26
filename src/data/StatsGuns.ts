import { UT } from "../core/UT";
import { MAX_LVL, GUN_TYPE_NAMES } from "./StatsMisc";

export const DESC_SENTINEL = "ERROROROR2@@";

export interface GunStats {
  id: string;
  sprite: string;
  name: string;
  namePerf: string;
  costMod: number;
  type: number;
  dmg: number;
  clipSize: number;
  range: number;
  aim: number;
  fireType: number;
  rps: number;
  xOff: number;
  yOff: number;
  shotSound: string | null;
  cls: string | null;
  params: readonly unknown[] | null;
  extra: Readonly<Record<string, unknown>>;
  desc: string;
  extraPerf: Readonly<Record<string, unknown>> | null;
  descPerf: string;

  force: number;
  bodBreak: number;
  splash: number;
  splashMult: number;
  clipSpare: number;
  effShoot: string;
  effHit: string;
  effShell: string;
  unequip: string;
  hitSound: string | null;
  bp: boolean;
  frameIdle: string;
  frameFire: string;
  frameReload: string;
  frameMenu: string;

  headDmg: number;
  critDmg: number;
  vision: number;
  heartbeat: boolean;
  crit: number;
  recoilSpread: number;
  noHead: boolean;
  consume: number;
  isTurret: boolean;
  soundFrames: number;
  noCrit: boolean;
  multiShots: number;
  burst: number;
  fire: number;
  ice: number;
  acid: number;
  jam: number;
  zap: number;
  noBlood: boolean;
  selfDmg: number;
  loud: number;
  isExplosive: boolean;
  isMelee: boolean;
  reflectFrames: number;
  crap: number;
  noAmmo: boolean;
  noClip: boolean;
  infSpare: boolean;
  isDual: boolean;
  ksWeap: boolean;

  cost: number;
  dmgBase: number;
  recoil: number;
  shootDelay: number;
  ammoTotal: number;
  clipAmmo: number;
  spareAmmo: number;
  spareMax: number;
  rarity: number;
  i: number;
}

export const itemOb: Record<string, GunStats> = {};
export const itemAr: GunStats[] = [];
export const typeAr: GunStats[][] = Array.from({ length: 11 }, () => []);
export const impactAr: number[] = Array.from({ length: 11 }, () => 0);

export const RARITY: readonly { readonly text: string; readonly color: number }[] = [
  { text: "NORMAL", color: 0x999999 },
  { text: "REFINED", color: 0x66ff99 },
  { text: "FLAWLESS", color: 0x99ccff },
  { text: "CUSTOM", color: 0xffff00 },
  { text: "BROKEN", color: 0xcc9900 },
  { text: "PROTOTYPE", color: 0x9999ff },
];

export function u(n: number): number {
  return Math.trunc(n);
}

function addItem(
  type: number, id: string, name: string, namePerf: string,
  costMod: number, dmg: number, clipSize: number, range: number, aim: number,
  fireType: number, rps: number, xOff: number, yOff: number,
  shotSound: string | null, cls: string | null, params: readonly unknown[] | null,
  extra: Readonly<Record<string, unknown>>,
  desc: string = DESC_SENTINEL,
  extraPerf: Readonly<Record<string, unknown>> | null = null,
  descPerf: string = DESC_SENTINEL,
): void {
  const item: GunStats = {
    id, sprite: id, name: name ? name : id, namePerf, costMod, type,
    dmg, clipSize, range, aim, fireType, rps, xOff, yOff,
    shotSound, cls, params, extra, desc, extraPerf, descPerf,

    force: 3, bodBreak: 0, splash: 0, splashMult: 0, clipSpare: 2,
    effShoot: "smoke", effHit: "bulletspark", effShell: "pistol",
    unequip: "body", hitSound: null, bp: true, frameMenu: "idle",
    frameIdle: "", frameFire: "", frameReload: "",

    headDmg: 0, critDmg: 0, vision: 0.5, heartbeat: false, crit: 0,
    recoilSpread: 0.3, noHead: false, consume: 1, isTurret: false,
    soundFrames: 0, noCrit: false, multiShots: 0, burst: 3,
    fire: 0, ice: 0, acid: 0, jam: 0, zap: 0, noBlood: false,
    selfDmg: 1, loud: 0, isExplosive: false, isMelee: false,
    reflectFrames: 0, crap: 0, noAmmo: false, noClip: false,
    infSpare: false, isDual: false, ksWeap: false,

    cost: 0, dmgBase: 0, recoil: 0, shootDelay: 0,
    ammoTotal: 0, clipAmmo: 0, spareAmmo: 0, spareMax: 0, rarity: 0, i: 0,
  };

  switch (type) {
    case 0:
      item.force = 3; item.bodBreak = 0.01; item.effShell = "pistol";
      item.unequip = "legup1";
      item.frameIdle = item.frameFire = item.frameReload = "pistol";
      item.infSpare = true;
      break;
    case 1:
      item.force = 3; item.bodBreak = 0.01; item.effShell = "pistol";
      item.unequip = "body";
      item.frameIdle = item.frameFire = item.frameReload = "smg";
      item.infSpare = true;
      break;
    case 2:
      item.force = 10; item.bodBreak = 0.1; item.splash = 30; item.splashMult = 1;
      item.selfDmg = 0; item.effShoot = ""; item.effShell = "";
      item.unequip = "legup1";
      item.frameIdle = item.frameFire = item.frameReload = "knife";
      break;
    case 3:
      item.force = 5; item.bodBreak = 0.01; item.splash = 0; item.splashMult = 0;
      item.effShell = "pistol"; item.unequip = "body";
      item.frameIdle = item.frameFire = item.frameReload = "rifle";
      break;
    case 4:
      item.force = 3; item.bodBreak = 0.01; item.effShell = "pistol";
      item.unequip = "legup1";
      item.frameIdle = item.frameFire = item.frameReload = "pistol2";
      item.frameMenu = "idle_akimbo";
      break;
    case 5:
      item.force = 15; item.bodBreak = 0.1; item.effShoot = "bigsmoke";
      item.effShell = "sniper"; item.unequip = "body";
      item.frameIdle = item.frameFire = item.frameReload = "sniper";
      break;
    case 6:
      item.force = 15; item.bodBreak = 0.1; item.effShoot = "bigsmoke";
      item.effShell = "shotgun"; item.unequip = "body";
      item.frameIdle = item.frameFire = item.frameReload = "shotgun";
      item.multiShots = 5;
      break;
    case 7:
      item.force = 7; item.bodBreak = 0; item.effShell = "pistol";
      item.unequip = "body";
      item.frameIdle = item.frameFire = item.frameReload = "heavy";
      item.frameMenu = "idle_undermount";
      break;
    case 8:
      item.force = 25; item.bodBreak = 0.25; item.splash = 100; item.splashMult = 0.7;
      item.effShell = "rocket"; item.effShoot = "bigsmoke";
      item.effHit = "explosionSmall"; item.unequip = "body";
      item.frameIdle = item.frameFire = item.frameReload = "rocket";
      item.frameMenu = "idle_launcher";
      item.hitSound = "S_rocketExplode";
      break;
    case 9:
      item.force = 1; item.bodBreak = 0; item.splash = 75; item.splashMult = 0.8;
      item.effShell = ""; item.effShoot = ""; item.effHit = "";
      item.unequip = "body";
      item.frameIdle = item.frameFire = item.frameReload = "thrower";
      item.frameMenu = "idle_undermount";
      item.noClip = true;
      break;
    case 10:
      item.force = 5; item.bodBreak = 0.01; item.effShell = "";
      item.effShoot = "beam"; item.effHit = "laserhit"; item.unequip = "body";
      item.frameIdle = item.frameFire = item.frameReload = "rifle";
      item.frameMenu = "idle_undermount";
      item.noClip = true;
      break;
    default:
      break;
  }

  const sink = item as unknown as Record<string, unknown>;
  for (const k of Object.keys(extra)) sink[k] = extra[k];

  itemOb[id] = item;
  if (item.type < 11) {
    item.i = itemAr.length;
    itemAr.push(item);
    typeAr[type].push(item);
    if (dmg > impactAr[type]) impactAr[type] = dmg;
  }
}

addItem(0, "TAC 45", "", "45 Tactical", 0.8, 12, 12, 66, 70, 0, 5, 12, -8, "S_TAC45",
  "Bullet_Line_Basic", [true, 3.5, 16777156, 0.3, 1.5, 16777156, 0.6], { "bp": true },
  "Balanced", { "crit": 0.1 }, "+10% Critical Chance");
addItem(0, "Five Seven", "", "Popper", 0.8, 7, 12, 56, 60, 2, 8, 12, -8, "S_FiveSeven",
  "Bullet_Line_Basic", [true, 3.5, 16777156, 0.3, 1.5, 16777156, 0.6], {},
  "Fastest Fire Rate,Burst Fire", { "burst": 5 }, "5 Round Burst Fire");
addItem(0, "P99", "", "Licence to Kill", 0.8, 15, 10, 66, 75, 0, 4, 15, -8, "S_P99",
  "Bullet_Line_Basic", [true, 3.5, 16777156, 0.3, 1.5, 16777156, 0.6], { "loud": -40 },
  "Low Detection", { "headDmg": 0.5 }, "50% Headshot Damage");
addItem(0, "Crossbow", "", "Bolt Sticker", 1.3, 55, 1, 76, 80, 0, 1, 15, -8, "S_Crossbow",
  "Bullet_Line_Basic", [true, 3.5, 16777156, 0.3, 1.5, 16777156, 0.6],
  { "frameIdle": "pistol", "frameFire": "pistol", "frameReload": "magnum" }, "Most Accurate",
  { "zap": 1 }, "Electrocutes Enemies");
addItem(0, "Desert Eagle", "", "Jericho", 1, 25, 7, 60, 60, 0, 2, 15, -8, "S_DEagle",
  "Bullet_Line_Basic", [true, 3.5, 16777156, 0.3, 1.5, 16777156, 0.6],
  { "frameIdle": "magnum", "frameFire": "magnum", "frameReload": "pistol" }, "Highest Impact",
  { "rps": 3.5 }, "+75% Fire Rate");

addItem(1, "Bizon", "", "Righteous Bizon", 0.8, 6, 64, 66, 50, 1, 8, 15, -8, "S_Bizon",
  "Bullet_Line_Basic", [true, 3.5, 16777156, 0.3, 1.5, 16777156, 0.6], { "bp": true },
  "Balanced", { "fire": 0.05 }, "Chance to Ignite Enemies");
addItem(1, "Vector", "", "Greaser", 1.3, 2, 25, 50, 60, 1, 9.5, 15, -8, "S_Vector",
  "Bullet_Line_Basic", [true, 3.5, 16777156, 0.3, 1.5, 16777156, 0.6], { "unequip": "legup1" },
  "Fastest Fire Rate", { "acid": 0.05 }, "Chance to Poison Enemies");
addItem(1, "UMP 45", "", "Cleaner", 0.8, 7, 30, 76, 70, 1, 7, 15, -8, "S_UMP",
  "Bullet_Line_Basic", [true, 3.5, 16777156, 0.3, 1.5, 16777156, 0.6], {}, "Most Accurate",
  { "critDmg": 0.25, "headDmg": 0.25 }, "+25% Critical and Headshot Damage");
addItem(1, "MTAR", "", "Tavor", 1, 8, 35, 60, 60, 2, 7, 15, -8, "S_MTAR", "Bullet_Line_Basic",
  [true, 3.5, 16777156, 0.3, 1.5, 16777156, 0.6],
  { "frameIdle": "top", "frameFire": "top", "frameReload": "bullpup" },
  "Highest Impact, Burst Fire", { "burst": 5 }, "5 Round Burst");
addItem(1, "P90", "", "RCP 90", 1, 5, 60, 56, 50, 1, 9, 15, -8, "S_P90", "Bullet_Line_Basic",
  [true, 3.5, 16777156, 0.3, 1.5, 16777156, 0.6],
  { "frameIdle": "top", "frameFire": "top", "frameReload": "top" }, "Largest Ammo",
  { "clipSize": 90 }, "+50% Bigger Clip");

addItem(2, "Knife", "", "First Blood", 0.8, 35, 0, 5, 100, 0, 7, 8, -8, "S_Knife",
  "Bullet_Melee_Basic", [],
  { "bp": true, "isDual": true, "noAmmo": true, "isMelee": true, "noHead": true },
  "Fastest Fire Rate", { "bodBreak": 1, "crit": 0.3 }, "+30% Critical Chance");
addItem(2, "Club", "", "Sky9 Iron", 1.1, 65, 0, 11, 100, 0, 3, 8, -8, "S_Club",
  "Bullet_Melee_Basic", [],
  { "isDual": true, "noAmmo": true, "isMelee": true, "noHead": true, "unequip": "body", "bodBreak": 0, "splash": 60, "splashMult": 1, "force": 15 },
  "Longest Range", { "force": 45 }, "Going, going, gone!");
addItem(2, "Axe", "", "Big Willy", 1, 45, 0, 7, 100, 0, 6, 8, -8, "S_Axe",
  "Bullet_Melee_Basic", [],
  { "isDual": true, "noAmmo": true, "isMelee": true, "noHead": true, "unequip": "body" },
  "Balanced", { "bodBreak": 1, "critDmg": 1 }, "+100% Critical Damage");
addItem(2, "Katana", "", "Hattori Hanzo", 1.4, 70, 0, 10, 100, 0, 2, 8, -8, "S_Katana",
  "Bullet_Melee_Basic", [],
  { "isDual": true, "noAmmo": true, "isMelee": true, "noHead": true, "unequip": "body", "splash": 60, "splashMult": 1, "reflectFrames": 4 },
  "Highest Impact", { "bodBreak": 1, "reflectFrames": 7 }, "Reflects More Projectiles");
addItem(2, "Stun Baton", "", "Sick Stick", 1.4, 65, 0, 5, 100, 0, 3, 8, -8, "S_Stun",
  "Bullet_Melee_Basic", [],
  { "isDual": true, "noAmmo": true, "isMelee": true, "noHead": true, "unequip": "body", "splash": 60, "splashMult": 1, "zap": 1, "bodBreak": 0 },
  "Electrocutes Enemies", { "acid": 1 }, "Poisons Enemies");

addItem(3, "Honey Badger", "", "Crazy Badger", 1, 10, 30, 66, 70, 1, 8, 15, -8, "S_HBadger",
  "Bullet_Line_Basic", [true, 3.5, 16777156, 0.3, 1.5, 16777156, 0.6],
  { "bp": true, "loud": -40 }, "Low Detection", { "dmg": 13, "multiShots": 3 },
  "Bullets are split into 3");
addItem(3, "XM8A1", "", "Harbinger", 1, 11, 30, 66, 70, 1, 7, 15, -8, "S_XM8",
  "Bullet_Line_Basic", [true, 3.5, 16777156, 0.3, 1.5, 16777156, 0.6], {}, "Balanced",
  { "crit": 0.3 }, "+15% Crit Chance");
addItem(3, "AK12", "", "Iron Curtain", 1.2, 12, 32, 60, 60, 1, 9, 17, -8, "S_AK12",
  "Bullet_Line_Basic", [true, 3.5, 16777156, 0.3, 1.5, 16777156, 0.6], {}, "Highest Impact",
  { "acid": 0.1 }, "Chance to Poison Enemies");
addItem(3, "FAL OSW", "", "Peacekeeper", 1, 20, 18, 80, 80, 0, 5, 15, -8, "S_FAL",
  "Bullet_Line_Basic", [true, 3.5, 16777156, 0.3, 1.5, 16777156, 0.6], {},
  "Most Accurate, Semi-Auto", { "headDmg": 0.5 }, "+50% Headshot Damage");
addItem(3, "ARX 160", "", "Future Soldier", 1.2, 9, 40, 66, 75, 2, 8, 15, -8, "S_ARX",
  "Bullet_Line_Basic", [true, 3.5, 16777156, 0.3, 1.5, 16777156, 0.6], {},
  "Largest Ammo, Burst Fire", { "burst": 5 }, "5 Round Burst");

addItem(4, "BM9", "", "Tequilas", 0.8, 10, 24, 66, 70, 0, 8, 15, -8, "S_BM9",
  "Bullet_Line_Basic", [true, 3.5, 16777156, 0.3, 1.5, 16777156, 0.6],
  { "bp": true, "isDual": true }, "Balanced", { "crit": 0.2 }, "+20% Critical Chance");
addItem(4, "Judge", "", "Executioners", 0.9, 30, 12, 50, 80, 0, 5, 15, -8, "S_Judge",
  "Bullet_Line_Basic", [true, 3.5, 16777156, 0.3, 1.5, 16777156, 0.6],
  { "isDual": true, "frameIdle": "magnum2", "frameFire": "magnum2", "frameReload": "magnum2" },
  "Most Accurate", { "headDmg": 0.5 }, "+50% Headshot Damage");
addItem(4, "Sawed-Off", "", "Hand Cannons", 1.3, 35, 4, 40, 40, 0, 4, 15, -8, "S_SOff",
  "Bullet_Line_Basic", [true, 3.5, 16777156, 0.3, 1.5, 16777156, 0.6],
  { "isDual": true, "multiShots": 5, "frameIdle": "magnum2", "frameFire": "magnum2", "frameReload": "magnum2" },
  "Highest Impact", { "crit": 0.1, "critDmg": 0.25 }, "+10% Crit Chance, +25% Crit Damage");
addItem(4, "Uzi", "", "Avengers", 1, 10, 64, 50, 50, 1, 9, 15, -8, "S_Uzi",
  "Bullet_Line_Basic", [true, 3.5, 16777156, 0.3, 1.5, 16777156, 0.6], { "isDual": true },
  "Fastest Fire Rate", { "fire": 0.05 }, "Chance to Ignite Enemies");
addItem(4, "FMG9", "", "Ballers", 1, 12, 60, 70, 60, 1, 8, 15, -8, "S_FMG",
  "Bullet_Line_Basic", [true, 3.5, 16777156, 0.3, 1.5, 16777156, 0.6], { "isDual": true },
  "Longest Range", { "critDmg": 0.25, "headDmg": 0.25 }, "+25% Critical and Headshot Damage");

addItem(5, "Intervention", "", "Rehab", 1.4, 60, 5, 80, 90, 0, 2, 20, -8, "S_Interv",
  "Bullet_Line_Sniper", [true, 3.5, 13421772, 0.3, 1.5, 15658734, 0.6],
  { "bp": true, "loud": -40 }, "Low Detection", { "loud": -100 }, "Extremely Low Detection");
addItem(5, "Lynx", "", "Farsight", 1.3, 40, 6, 100, 75, 0, 4, 20, -8, "S_Lynx",
  "Bullet_Line_Sniper", [true, 3.5, 13421772, 0.3, 1.5, 15658734, 0.6], {}, "Longest Range",
  { "vision": 1.5 }, "+100% Increased Vision");
addItem(5, "L115", "", "AWP", 1.4, 70, 3, 80, 90, 0, 1, 20, -8, "S_L115", "Bullet_Line_Sniper",
  [true, 3.5, 13421772, 0.3, 1.5, 15658734, 0.6], {}, "Highest Impact", { "headDmg": 0.5 },
  "+50% Headshot Damage");
addItem(5, "MK14", "", "Marksman", 1, 20, 12, 70, 90, 0, 5, 20, -8, "S_MK14",
  "Bullet_Line_Sniper", [true, 3.5, 13421772, 0.3, 1.5, 15658734, 0.6],
  { "frameIdle": "rifle", "frameFire": "rifle", "frameReload": "sniper" }, "Most Accurate",
  { "aim": 100 }, "Perfect Accuracy");
addItem(5, "G36R", "", "Wildcat", 1.1, 17, 24, 90, 70, 1, 6, 20, -8, "S_G36R",
  "Bullet_Line_Sniper", [true, 3.5, 13421772, 0.3, 1.5, 15658734, 0.6],
  { "frameIdle": "rifle", "frameFire": "rifle", "frameReload": "sniper" },
  "Fastest Fire Rate, Fully Automatic", { "crit": 0.2 }, "+20% Critical Chance");

addItem(6, "R870", "", "Defriender", 0.8, 55, 8, 37, 50, 0, 3, 15, -8, "S_R870",
  "Bullet_Line_Basic", [true, 3.5, 16777156, 0.3, 1.5, 16777156, 0.6], { "bp": true },
  "Longest Range", { "range": 50 }, "+30% Increased Range");
addItem(6, "TAC 12", "", "Ice Chamber", 1, 45, 12, 25, 20, 0, 3, 15, -8, "S_TAC12",
  "Bullet_Line_Basic", [true, 3.5, 16777156, 0.3, 1.5, 16777156, 0.6], {}, "Longest Range",
  { "ice": 1 }, "Freezes Enemies");
addItem(6, "MTS 255", "", "Old Yeller", 1.1, 60, 3, 15, 35, 0, 3, 15, -8, "S_MTS",
  "Bullet_Line_Basic", [true, 3.5, 16777156, 0.3, 1.5, 16777156, 0.6], {}, "Highest Impact",
  { "fire": 1 }, "Ignites Enemies");
addItem(6, "DB12", "", "Boomstick 2.0", 1.3, 50, 4, 25, 55, 2, 9.5, 15, -8, "S_DB12",
  "Bullet_Line_Basic", [true, 3.5, 16777156, 0.3, 1.5, 16777156, 0.6], { "burst": 2 },
  "Burst Fire", { "crit": 0.2 }, "+20% Critical Chance");
addItem(6, "USAS12", "", "Closing Time", 1.4, 25, 12, 20, 40, 1, 7, 15, -8, "S_USAS",
  "Bullet_Line_Basic", [true, 3.5, 16777156, 0.3, 1.5, 16777156, 0.6],
  { "frameIdle": "shotgun", "frameFire": "shotgun", "frameReload": "rifle" },
  "Fastest Fire Rate, Fully Automatic", { "clipSize": 18 }, "+50% Bigger Clip");

addItem(7, "MK48", "", "LAW Giver", 0.8, 8, 70, 60, 50, 1, 8, 15, 5, "S_MK48",
  "Bullet_Line_Basic", [true, 3.5, 16777156, 0.3, 1.5, 16777156, 0.6],
  { "bp": true, "frameMenu": "idle" }, "Balanced", { "crit": 0.2 }, "+20% Critical Chance");
addItem(7, "SAW", "", "Chain SAW", 1.3, 7, 80, 58, 35, 1, 9.5, 15, 15, "S_SAW",
  "Bullet_Line_Basic", [true, 3.5, 16777156, 0.3, 1.5, 16777156, 0.6],
  { "frameIdle": "cannon", "frameFire": "cannon", "frameReload": "heavy" },
  "Fastest Fire Rate", { "fire": 0.05 }, "Chance to Ignite Enemies");
addItem(7, "HMG50", "", "Ratatouille", 1, 9, 60, 64, 60, 1, 7, 15, 5, "S_HMG",
  "Bullet_Line_Basic", [true, 3.5, 16777156, 0.3, 1.5, 16777156, 0.6], { "frameMenu": "idle" },
  "Most Accurate", { "acid": 0.05 }, "Chance to Poison Enemies");
addItem(7, "XMG", "", "Mobile Turret", 1.1, 7, 70, 68, 40, 1, 9, 15, 15, "S_XMG",
  "Bullet_Line_Basic", [true, 3.5, 16777156, 0.3, 1.5, 16777156, 0.6],
  { "noClip": true, "frameIdle": "cannon", "frameFire": "cannon" },
  "Longest Range, No Reloads", { "zap": 0.05 }, "Chance to Electrocute Enemies");
addItem(7, "Vulcan", "", "Raven", 1.4, 6, 100, 60, 40, 1, 9, 15, 15, "S_Vulcan",
  "Bullet_Line_Basic", [true, 3.5, 16777156, 0.3, 1.5, 16777156, 0.6],
  { "noClip": true, "frameIdle": "cannon", "frameFire": "cannon" }, "Largest Ammo, No Reloads",
  { "ice": 0.05 }, "Chance to Freeze Enemies");

addItem(8, "SMAWG", "", "Dragon's Breath", 1, 120, 1, 60, 70, 0, 1, 8, -8, "S_Panzer",
  "Bullet_Proj_Basic", ["gas_rocket", 7, 0.5],
  { "bp": true, "isExplosive": true, "clipSpare": 10 }, "Highest Impact",
  { "fire": 1, "bodBreak": 1 }, "Ignites Enemies, Body Pop");
addItem(8, "MK32", "", "Bam Bam", 0.9, 38, 12, 66, 60, 1, 5, 8, -8, "S_Commando",
  "Bullet_Proj_Bounce", ["grenade", 3, 4, 1.5],
  { "frameMenu": "idle_undermount", "isExplosive": true, "effHit": "explosionSmall", "frameIdle": "rifle", "frameFire": "rifle", "frameReload": "shotgun" },
  "Largest Ammo, Fully Automatic", { "clipSize": 24 }, "+100% Bigger Clip");
addItem(8, "Panzer", "", "Tank Buster", 1.2, 110, 1, 70, 80, 0, 1, 8, -8, "S_Panzer",
  "Bullet_Proj_Follow", ["gas_rocket", 2, 0, 180, 3], { "isExplosive": true, "clipSpare": 10 },
  "Homing Missiles", { "params": ["gas_rocket", 2, 0, 180, 7] }, "Stronger Homing Capability");
addItem(8, "GL06", "", "Thumper", 1.1, 70, 2, 66, 90, 0, 1, 8, -8, "S_MK32",
  "Bullet_Proj_Stick", ["grenade", 3, 4, 1.5],
  { "frameMenu": "idle_undermount", "isExplosive": true, "clipSpare": 10, "effHit": "explosionSmall", "frameIdle": "rifle", "frameFire": "rifle", "frameReload": "sniper" },
  "Sticks to Enemies", { "multiShots": 2, "dmg": 80 }, "Fires 2 Grenades at Once");
addItem(8, "M202", "", "Bennett's Doom", 1.1, 40, 4, 80, 80, 1, 7, 8, -8, "S_Commando",
  "Bullet_Proj_Basic", ["gas_rocket", 2, 0], { "isExplosive": true, "clipSpare": 4 },
  "Fastest Fire Rate, Fully Automatic",
  { "cls": "Bullet_Line_Sniper", "params": [false, 10, 16777156, 0.3, 5, 16777156, 0.6] },
  "Instant Projectile Speed");

addItem(9, "Tesla", "", "Edison's Bane", 1, 3, 300, 20, 80, 1, 10, 10, 30, "S_Tesla",
  "Bullet_Line_Zapper", [5572351, 633087],
  { "bp": true, "noHead": true, "noCrit": true, "noBlood": true, "zap": 1, "consume": 0.7, "effHit": "lightningPurple", "soundFrames": 9 },
  "Electrocutes Enemies", { "consume": 0.25 }, "Reduced Ammo Consumption");
addItem(9, "Flame Thrower", "", "Afterburner", 1.2, 2, 300, 20, 80, 1, 10, 10, 15, "S_Fire",
  "Bullet_Proj_Frames", ["FT", 0.7, -3, 1],
  { "noHead": true, "noCrit": true, "noBlood": true, "fire": 1, "consume": 0.7, "effHit": "flame", "soundFrames": 9 },
  "Ignites Fire", { "consume": 0.25 }, "Reduced Ammo Consumption");
addItem(9, "Flak Cannon", "Microwave", "Bad News", 1, 6, 300, 20, 90, 1, 10, 10, 30,
  "S_Microwave", "Bullet_Line_Laser", [10, 16777164, 0.7, 5, 13434879, 0.5],
  { "consume": 0.5, "effHit": "explosionTiny", "soundFrames": 9 },
  "Highest Impact, No Element", { "consume": 0.7 }, "Reduced Ammo Consumption");
addItem(9, "Freeze Ray", "", "Sub Zero", 0.9, 4, 300, 20, 80, 1, 10, 10, 30, "S_AcidHit",
  "Bullet_Proj_Frames", ["Ice", 0.7, 3, 1],
  { "noHead": true, "noCrit": true, "noBlood": true, "ice": 1, "effShoot": "shard", "consume": 0.7, "effHit": "bulletsparkIce", "soundFrames": 9 },
  "Freezes Enemies", { "consume": 0.25 }, "Reduced Ammo Consumption");
addItem(9, "Acid Hound", "", "Liquifier", 0.8, 3, 300, 20, 80, 1, 10, 10, 30, "S_AcidHit",
  "Bullet_Proj_Frames", ["acid", 0.7, 3, 1],
  { "noHead": true, "noCrit": true, "noBlood": true, "acid": 1, "consume": 0.7, "effHit": "bulletsparkAcid", "soundFrames": 9 },
  "Poisons Enemies", { "consume": 0.25 }, "Reduced Ammo Consumption");

addItem(10, "Ion Cannon", "", "Paralyzer", 0.9, 60, 80, 20, 60, 1, 7, 15, -8, "S_Ion",
  "Bullet_Line_Bend", [true, 10, 10079232, 0.5, 5, 13434828, 0.6],
  { "bp": true, "noBlood": true, "acid": 0.07, "multiShots": 3, "effHit": "bulletsparkAcid" },
  "Chance to Poison Enemies", { "acid": 1 }, "Poisons Enemies");
addItem(10, "Laser Cutter", "", "Decimator", 1, 15, 100, 30, 50, 1, 8, 15, -8, "S_Laser",
  "Bullet_Line_Basic", [true, 4.5, 16711680, 0.3, 1.5, 16711680, 0.8],
  { "noBlood": true, "fire": 0.15, "multiShots": 2, "effHit": "flame" },
  "Chance to Ignite Enemies", { "fire": 1 }, "Ignites Enemies");
addItem(10, "Pulse Rifle", "", "Futurama", 1.1, 22, 70, 46, 80, 1, 5, 15, -8, "S_Pulse",
  "Bullet_Proj_Basic", ["bulletsparkIce", 3, 0],
  { "splash": 50, "splashMult": 0.7, "noBlood": true, "ice": 0.2, "effHit": "bulletsparkIce" },
  "Chance to Freeze Enemies", { "ice": 1 }, "Freezes Enemies");
addItem(10, "DSR1", "", "Precision Shot", 0.8, 30, 60, 60, 80, 1, 6, 20, -8, "S_DSR",
  "Bullet_Proj_Bounce", ["snowFall", 4, 3, 1], { "noBlood": true, "effHit": "bulletsparkIce" },
  "Highest Impact", { "crit": 0.3 }, "+30% Critical Chance");
addItem(10, "Rail Gun", "", "Fortune's 500", 1.2, 50, 24, 66, 80, 0, 3, 15, -8, "S_Rail",
  "Bullet_Line_Electric", [true, 3.5, 52479, 0.4, 2.5, 39423, 0.5, 1.5, 13434879, 0.4],
  { "noBlood": true, "zap": 0.4, "effHit": "lightningPurple" },
  "Chance to Electrocute Enemies", { "zap": 1 }, "Electrocutes Enemies");

addItem(11, "Betsy", "", "Golden Betsy", 0, 20, 20, 40, 30, 1, 7, 15, 15, "S_Betsy",
  "Bullet_Line_Bend", [false, 8, 16776960, 0.3, 4, 16777156, 0.6],
  { "noClip": true, "frameIdle": "cannon", "frameFire": "cannon", "splash": 50, "splashMult": 0.6, "effHit": "explosionSmall", "ksWeap": true },
  "", { "rps": 5, "multiShots": 2 });
addItem(11, "Shuriken", "Deadily Shuriken", "Multi-Shurikens", 0, 55, 3, 50, 80, 0, 8, 8, -8,
  "S_Shuriken", "Bullet_Proj_Basic", ["knifeSpin", 7, 0.5],
  { "noHead": true, "noClip": true, "frameIdle": "knife", "frameFire": "knife", "effHit": "", "ksWeap": true, "acid": 1 },
  "", { "dmg": 75, "multiShots": 3 });
addItem(11, "env", "Environment", "", 0, 50, 0, 0, 0, 0, 0, 0, 0, null, null, null, {});
addItem(11, "Empty", "", "", 0, 50, 0, 0, 0, 0, 0, 0, 0, "S_Empty", null, null, {});
addItem(11, "fire", "Fire", "", 0, 6, 0, 0, 0, 0, 0, 0, 0, null, null, null, {});
addItem(11, "acid", "Poison", "", 0, 3, 0, 0, 0, 0, 0, 0, 0, null, null, null, {});
addItem(11, "turret", "Shotgun Turret", "", 1, 65, 0, 30, 0, 1, 7, 0, 0, "S_TAC12",
  "Bullet_Line_Basic", [true, 3.5, 16777156, 0.3, 1.5, 16777156, 0.6],
  { "isTurret": true, "multiShots": 5, "effShell": "shotgun" });
addItem(11, "sentry", "Rocket Sentry", "", 1.5, 45, 0, 66, 0, 1, 5, 0, 0, "S_Panzer",
  "Bullet_Proj_Follow", ["gas_rocket", 2, 0, 160, 7],
  { "noHead": true, "noCrit": true, "isExplosive": true, "isTurret": true, "effShell": "rocket" });
addItem(11, "firebeam", "Death Ray", "", 1.5, 30, 0, 66, 0, 1, 0, 0, 0, null, null, null,
  { "noHead": true, "noCrit": true });
addItem(11, "icebeam", "Satelite Beam", "", 1.5, 30, 0, 66, 0, 1, 0, 0, 0, null, null, null,
  { "noHead": true, "noCrit": true });
addItem(11, "bomb", "Vital Bomb", "", 0, 80, 0, 66, 0, 1, 0, 0, 0, null, "Bullet_Splash",
  [true], { "noHead": true, "noCrit": true, "isExplosive": true });

export function getGunType(num: number): string {
  return GUN_TYPE_NAMES[num];
}

export function cloneStats(stats: GunStats): GunStats {
  return { ...stats };
}

export function clone(id: string): GunStats {
  return cloneStats(itemOb[id]);
}

export function getBlueprintPrice(mod: number): number {
  return u(150 * mod);
}

export function getStatsAtLevel(id: string, lvl: number): GunStats {
  const stats = clone(id);
  stats.dmg *= UT.getLinearRange(lvl, MAX_LVL, 1, 2.5);
  return stats;
}

export function getDamageAtLevel(id: string, lvl: number): number {
  itemOb[id].dmg = UT.getLinearRange(lvl, MAX_LVL, 1, 2.5);
  return itemOb[id].dmg;
}

export function getRandomGunId(built: readonly number[], type = -1): string {
  if (built.length === 0) return itemAr[0].id;
  if (type === -1) return itemAr[UT.randEl(built)].id;
  for (let tries = 0; tries < 1000; tries++) {
    const num = UT.randEl(typeAr[type]).i;
    if (built.indexOf(num) !== -1) return itemAr[num].id;
  }
  return itemAr[UT.randEl(built)].id;
}

export function getUpgradeChance(stars: number): number {
  switch (stars) {
    case 0: return 0.9;
    case 1: return 0.85;
    case 2: return 0.75;
    case 3: return 0.6;
    case 4: return 0.4;
    default: return 0;
  }
}
