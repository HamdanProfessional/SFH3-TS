import { SD, randRarity, randHighRarity, achHooks } from "./SD";
import { UT } from "../core/UT";
import { GunInfo } from "../game/GunInfo";
import { getRandomGunId } from "../data/StatsGuns";
import { MAX_HERO_LVL, MAX_MISSION, getLevelReq } from "../data/StatsMisc";
import { MatchSettings } from "../game/MatchSettings";
import * as Missions from "../data/StatsMissions";
import type { UnitInfo } from "../game/UnitInfo";
import { commitExp, poolExp, type LevelChange } from "../game/progression";

export interface FatigueChange {
  name: string;
  before: number;
  after: number;
}

export type { LevelChange };

export interface HeroTally {
  slot: number;
  name: string;
  level0: number;
  exp0: number;
  status0: number;
  status1: number;
  addedExp: number;
  funds: number;
}

export interface PostGameResult {
  won: boolean;
  fundsGained: number;
  levelUps: LevelChange[];
  fatigue: FatigueChange[];
  rewards: (string | number)[];
  unlocked: boolean;
  tally: HeroTally[];
  funds0: number;
  day0: number;
}

function lowRarity(): GunInfo {
  const id = getRandomGunId(SD.bpBuilt);
  const rarity = UT.randEl(randRarity);
  let level = getLevelReq(SD.curStage, SD.curDiff);
  if (level < 1) level = 1;
  if (level > 31) level = 31;
  return new GunInfo(id, level, rarity);
}

function highRarity(): GunInfo {
  const id = getRandomGunId(SD.bpBuilt);
  const rarity = UT.randEl(randHighRarity);
  let level = getLevelReq(SD.curStage, SD.curDiff) + UT.irand(-3, 2);
  if (level < 1) level = 1;
  if (level > 31) level = 31;
  return new GunInfo(id, level, rarity);
}

export function randomHighRarity(): GunInfo {
  return highRarity();
}

function deployed(): UnitInfo[] {
  const out: UnitInfo[] = [];
  for (const idx of SD.squad) {
    if (idx < 0) continue;
    const u = SD.heroes[idx];
    if (u) out.push(u);
  }
  return out;
}

export function resolvePostGame(won: boolean): PostGameResult {
  const squad = deployed();
  const rows: { u: UnitInfo; slot: number }[] = [];
  SD.squad.forEach((idx, slot) => {
    if (idx < 0) return;
    const u = SD.heroes[idx];
    if (u) rows.push({ u, slot });
  });

  let paidFunds = 0;
  for (const u of squad) {
    SD.payMatchFunds(u);
    paidFunds += u.paidFunds;
  }
  poolExp(squad);

  const levelUps: LevelChange[] = [];
  const fatigue: FatigueChange[] = [];
  const tally: HeroTally[] = [];
  const funds0 = SD.funds - paidFunds;
  const day0 = SD.day;

  for (const { u, slot } of rows) {
    let reduce = 15 + SD.stages.length * 0.25;
    reduce *= MatchSettings.soloTired;
    if (u.skills.tired1) reduce *= u.skills.tired1;
    if (u.skills.tired0) reduce *= u.skills.tired0;
    if (u.status <= 300) {
      if (u.status > 200) reduce *= 1.1;
      else if (u.status > 100) reduce *= 1.5;
      else reduce *= 10;
    }
    const before = u.status;
    u.status = Math.max(0, u.status - reduce);
    fatigue.push({ name: u.name, before, after: u.status });

    tally.push({
      slot, name: u.name, level0: u.level, exp0: u.exp,
      status0: before, status1: u.status,
      addedExp: u.earnedExp, funds: u.paidFunds,
    });

    const up = commitExp(u);
    if (up) {
      levelUps.push(up);
      if (u.level >= MAX_HERO_LVL) achHooks.set("levelmax");
    }

    u.earnedExp = 0;
    u.earnedFunds = 0;
    u.paidFunds = 0;
  }

  for (let i = 0; i < SD.heroes.length; i++) {
    if (SD.squad.indexOf(i) !== -1) continue;
    SD.heroes[i].status = Math.min(400, SD.heroes[i].status + 50);
  }

  SD.day += 1;
  SD.nextStoreRow();

  const rewards: (string | number)[] = [];
  let unlocked = false;
  const campaign = !MatchSettings.sandbox;
  const mis = Missions.itemAr[SD.curStage] as Missions.Mission | undefined;

  if (won && campaign && MatchSettings.matchType === 0 && mis) {
    let gaveItem = false;
    for (let i = 0; i < 3; i++) {
      if (SD.curDiff > SD.stages[SD.curStage] && SD.stages[SD.curStage] === i) {
        SD.stages[SD.curStage] = i + 1;
        const r = mis.rewards[i];
        SD.mapItem.push(r === "random2" ? highRarity() : r);
        rewards.push(r);
        gaveItem = true;
      }
    }
    if (!gaveItem) {
      SD.mapItem.push(lowRarity());
      rewards.push("random");
    }
    if (!mis.challenge
        && SD.curStage === SD.stages.length - 1
        && SD.stages.length < MAX_MISSION) {
      if (SD.stages.length === 4) SD.autoShowAd = true;
      SD.stages.push(0);
      SD.curStage = SD.stages.length - 1;
      unlocked = true;
      if (Missions.itemAr[SD.stages.length - 1]?.challenge
          && SD.stages.length < MAX_MISSION) {
        SD.stages.push(0);
        SD.curStage = SD.stages.length - 1;
      }
    }

    if (SD.stages.length >= MAX_MISSION) {
      let lowMis = 99;
      let lowCha = 99;
      let lowAny = 99;
      for (let i = 0; i < MAX_MISSION; i++) {
        if (Missions.itemAr[i].challenge) lowCha = Math.min(lowCha, SD.stages[i]);
        else lowMis = Math.min(lowMis, SD.stages[i]);
        lowAny = Math.min(lowAny, SD.stages[i]);
      }
      if (lowMis >= 1) achHooks.set("campaign");
      if (lowCha >= 1) achHooks.set("challenges");
      if (lowAny >= 2) achHooks.set("hard");
      if (lowAny >= 3) achHooks.set("insane");
    }
  } else if (won && campaign && MatchSettings.matchType === 2) {
    if (!SD.checkDaily()) {
      SD.mapItem.push(highRarity());
      rewards.push("random");
    }
    SD.saveDaily();
  }

  SD.justHired = false;
  SD.hiresToday = 0;
  SD.save();

  return {
    won,
    fundsGained: paidFunds,
    levelUps,
    fatigue,
    rewards,
    unlocked,
    tally,
    funds0,
    day0,
  };
}
