import { UT } from "../core/UT";
import * as Classes from "../data/StatsClasses";
import {
  GAME_MODE_IDS, MAX_LVL, getGameMode, getLevelReq,
} from "../data/StatsMisc";
import { MAP_ORDER, getMap, type MapInfo } from "../data/StatsMaps";
import { UnitInfo } from "./UnitInfo";
import { newHero } from "./newHero";
import { applyPendingWeapons } from "./GunInfo";
import { MatchInfo } from "./types";

export { getGameMode, getLevelReq, MAX_LVL, MAX_MISSION } from "../data/StatsMisc";
export type { GameMode } from "../data/StatsMisc";

export const SELECTABLE_MODES = GAME_MODE_IDS;

export type ModeId =
  | "dm" | "tdm" | "elim" | "telim" | "ctf" | "dom" | "one" | "zom" | "gg" | "tgg";

function clamp(val: number, min: number, max: number): number {
  return val < min ? min : val > max ? max : val;
}

export interface Mod {
  readonly id: string;
  readonly name: string;
  readonly desc: string;
  readonly expmod: number;
  readonly exp: string;
}

const MOD_TABLE: Record<string, { name: string; desc: string; expmod: number }> = {
  none: { name: "None", desc: "No mod selected.", expmod: 1 },
  sky9: { name: "Sky9", desc: "Super Physics!", expmod: 1 },
  clips: { name: "Pack Mule", desc: "Infinite spare ammo.", expmod: 0.4 },
  ammo: { name: "Wizardry", desc: "Magically infinite ammo.", expmod: 0.2 },
  party: { name: "Fiesta", desc: "Random weapons, every spawn.", expmod: 0.7 },
  bodypop: { name: "Tin Man", desc: "Joints are held on with glue.", expmod: 1 },
};

export function getMod(id: string): Mod {
  const row = MOD_TABLE[id] ?? { name: "", desc: "", expmod: 1 };
  return {
    id,
    name: row.name,
    desc: row.desc,
    expmod: row.expmod,
    exp: row.expmod === 1 ? "" : "-" + (100 - row.expmod * 100) + "% EXP",
  };
}

export function buildModList(unlockedAchievements: readonly string[]): string[] {
  const mods = ["none", "sky9", "clips"];
  if (unlockedAchievements.includes("secret1")) mods.push("bodypop");
  if (unlockedAchievements.includes("secret2")) mods.push("ammo");
  if (unlockedAchievements.includes("secret3")) mods.push("party");
  return mods;
}

export { HERO_NAMES, EVIL_NAMES } from "../data/names";

export const QM_DIFF_LABELS = [
  "Very Easy", "Easy", "Medium", "Hard", "Very Hard", "Insane",
] as const;

export function qmLevelFor(qmDiff: number): number {
  return Math.trunc(UT.getLinearRange(qmDiff, 6, 1, MAX_LVL));
}

export function enemyMaxFor(mode: string): number {
  return getGameMode(mode).teams ? 5 : 9;
}

export function squadSizeFor(mode: string): number {
  return getGameMode(mode).teams ? 5 : 1;
}

export function stepEnemies(current: number, dir: number, mode: string): number {
  const max = enemyMaxFor(mode);
  const next = current + dir;
  if (next < 1) return max;
  if (next > max) return 1;
  return next;
}

export function cycleQmMode(forward: boolean): void {
  const list = SELECTABLE_MODES as readonly string[];
  let i = list.indexOf(MatchSettings.qmMode);
  if (i < 0) i = 0;
  i = (i + (forward ? 1 : list.length - 1)) % list.length;
  const mode = getGameMode(list[i]);
  MatchSettings.qmMode = mode.id;
  MatchSettings.qmScore = mode.startscore;
  MatchSettings.qmTeams = mode.teams;
  MatchSettings.qmEnemies = mode.teams ? 5 : 9;
}

export type MatchType = 0 | 1 | 2;

class MatchSettingsStatics {
  qmMap: string = MAP_ORDER[0];
  qmMode = "tdm";
  qmScore = 10;
  qmMod = "none";
  qmTeams = true;
  qmDiff = 3;
  qmEnemies = 5;
  qmAiBots = true;
  qmLevel = 0;
  qmSquadCodeBots: UnitInfo[] = [];

  useMap: MapInfo = getMap(MAP_ORDER[0]);
  useMode = "tdm";
  useScore = 25;
  useMod = "";
  useTeams = true;
  useBots: UnitInfo[] = [];
  useExtra: Record<string, unknown> = {};
  useFlag = "flag";
  useSong: unknown = null;
  matchType: MatchType = 1;
  sandbox = false;

  soloTired = 1;

  init(): void {
    this.qmMap = MAP_ORDER[0];
    this.qmMode = "tdm";
    this.qmTeams = true;
    this.qmScore = 10;
    this.qmMod = "none";
    this.qmDiff = 3;
    this.qmEnemies = 5;
    this.qmAiBots = true;
    this.qmLevel = qmLevelFor(this.qmDiff);
  }

  setupMatch(ctx: SetupContext): void {
    this.useExtra = {};
    this.useFlag = "flag";
    this.useSong = null;
    for (const idx of ctx.squad) {
      if (idx >= 0 && ctx.heroes[idx]) ctx.heroes[idx].extra = {};
    }
    this.soloTired = 1;

    const squadUnits = (): UnitInfo[] => {
      const out: UnitInfo[] = [];
      for (const idx of ctx.squad) {
        if (idx < 0) continue;
        const unit = ctx.heroes[idx];
        if (!unit) continue;
        unit.team = this.useTeams ? 1 : 0;
        out.push(unit);
      }
      return out;
    };

    if (this.matchType === 0) {
      const mission = requireMission(ctx, "campaign");
      this.useMap = getMap(mission.map);
      this.useMode = mission.mode;
      this.useScore = mission.score;
      this.useMod = "";
      this.useTeams = getGameMode(this.useMode).teams;
      if (mission.song) this.useSong = mission.song;
      if (mission.extra) this.useExtra = mission.extra;

      for (const idx of ctx.squad) if (idx === -1) this.soloTired += 0.2;

      this.useBots = [];
      for (const unit of squadUnits()) {
        if (mission.squadExtra) unit.extra = mission.squadExtra;
        this.useBots.push(unit);
      }

      const raise = numberOr(this.useExtra.raiseLvl, 0);
      if (mission.units && mission.units.length) {
        for (const unit of mission.units) {
          let lvl = clamp(
            Math.round(getLevelReq(ctx.curStage, ctx.curDiff) * UT.rand(0.8, 1.2)),
            1, MAX_LVL + 5,
          );
          lvl += raise;
          lvl += numberOr(unit.extra.raiseLvl, 0);
          applyPendingWeapons(unit);
          unit.setupLevelStats(lvl);
          unit.team = this.useTeams ? 2 : 0;
          if (unit.extra.team !== undefined) unit.team = Number(unit.extra.team);
          this.useBots.push(unit);
        }
      } else {
        for (let i = 0; i < mission.team2; i++) {
          const unit = newHero(UT.randEl(Classes.CLASSES_BASIC), "enemy");
          let lvl = clamp(
            Math.round(getLevelReq(ctx.curStage, ctx.curDiff) * UT.rand(0.8, 1.2)),
            1, MAX_LVL + 5,
          );
          lvl += raise;
          applyPendingWeapons(unit);
          unit.setupLevelStats(lvl);
          unit.team = this.useTeams ? 2 : 0;
          this.useBots.push(unit);
        }
      }
      return;
    }

    if (this.matchType === 2) {
      const mission = requireMission(ctx, "daily");
      this.useMap = getMap(mission.map);
      this.useMode = mission.mode;
      this.useScore = mission.score;
      this.useMod = "";
      this.useTeams = getGameMode(this.useMode).teams;
      this.useBots = squadUnits();
      for (let i = 0; i < mission.team2; i++) {
        const clsId = ctx.bpClasses.length
          ? (Classes.itemAr[UT.randEl(ctx.bpClasses)]?.id ?? "eng")
          : UT.randEl(Classes.CLASSES_BASIC);
        const unit = newHero(clsId, "enemy");
        const lvl = clamp(
          Math.round(getLevelReq(ctx.curStage, ctx.curDiff) + UT.rand(1, 2)),
          1, MAX_LVL + 5,
        );
        applyPendingWeapons(unit);
        unit.setupLevelStats(lvl);
        unit.team = this.useTeams ? 2 : 0;
        this.useBots.push(unit);
      }
      return;
    }

    this.useMap = getMap(this.qmMap);
    this.useMode = this.qmMode;
    this.useScore = this.qmScore;
    this.useMod = this.qmMod;
    this.useTeams = this.qmTeams;
    this.useBots = squadUnits();

    if (this.qmAiBots) {
      for (let i = 0; i < this.qmEnemies; i++) {
        const unit = newHero(UT.randEl(Classes.CLASSES_ALL), "enemy");
        const lvl = clamp(Math.trunc(this.qmLevel * UT.rand(0.8, 1.2)), 1, MAX_LVL + 5);
        applyPendingWeapons(unit);
        unit.setupLevelStats(lvl);
        unit.team = this.useTeams ? 2 : 0;
        this.useBots.push(unit);
      }
    } else {
      for (let i = 0; i < this.qmSquadCodeBots.length; i++) {
        const unit = this.qmSquadCodeBots[i];
        unit.name = "EnemySquad " + (i + 1);
        unit.team = this.useTeams ? 2 : 0;
        this.useBots.push(unit);
      }
    }
  }
}

export interface MissionLike {
  map: string;
  mode: string;
  score: number;
  team1: number;
  team2: number;
  song?: unknown;
  extra?: Record<string, unknown>;
  squadExtra?: Record<string, unknown> | null;
  units?: UnitInfo[] | null;
}

export interface SetupContext {
  squad: number[];
  heroes: UnitInfo[];
  curStage: number;
  curDiff: number;
  bpClasses: number[];
  mission?: MissionLike | null;
}

function requireMission(ctx: SetupContext, kind: string): MissionLike {
  if (!ctx.mission) {
    throw new Error(`setupMatch: matchType needs a ${kind} mission record`);
  }
  return ctx.mission;
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === "number" ? v : fallback;
}

export const MatchSettings = new MatchSettingsStatics();

export interface ScoredUnit {
  readonly name: string;
  readonly human: boolean;
  team: number;
  pscore: number;
  readonly dead: unknown;
  readonly unitInfo: { readonly cls: string; readonly extra: Record<string, unknown> };
  readonly score: { readonly kills: number; readonly deaths: number };
}

export interface MatchHost {
  readonly units: readonly ScoredUnit[];
  readonly player: ScoredUnit | null;
  readonly holdpoints: readonly { curTeam: number; unitCaptured: { pscore: number } | null }[];
  endGame(won: boolean): void;
  setScoreBar(team1: number, score1: number, team2: number, score2: number): void;
}

export interface ScoreRow {
  y: number;
  frame: string;
  text: string;
  name: string;
  score: string;
  kills: string;
  deaths: string;
  cls: string;
  status: string;
}

const NO_SCORES = (): void => {};

export class MatchState {
  private initiated = false;
  private fc = 0;
  private published: (() => void) | null = null;
  private team0: ScoredUnit[] = [];
  team1: ScoredUnit[] = [];
  team2: ScoredUnit[] = [];
  team1score = 0;
  team2score = 0;

  constructor(private readonly game: MatchHost) {}

  init(): void {
    this.initiated = true;
    this.publish();
    if (!MatchSettings.useTeams) {
      this.team0 = this.game.units.slice();
      const player = this.game.player;
      const other = this.game.units[1] ?? player;
      if (player && other) {
        this.game.setScoreBar(player.team, player.pscore, other.team, other.pscore);
      }
    } else {
      this.team1 = [];
      this.team2 = [];
      for (const unit of this.game.units) {
        if (unit.team === 1) this.team1.push(unit);
        else if (unit.team === 2) this.team2.push(unit);
      }
      this.game.setScoreBar(1, 0, 2, 0);
    }
    this.updateScores();
  }

  private publish(): void {
    MatchInfo.matchType = MatchSettings.matchType;
    MatchInfo.useMode = MatchSettings.useMode;
    MatchInfo.useScore = MatchSettings.useScore;
    MatchInfo.useMod = MatchSettings.useMod;
    MatchInfo.useExtra =
      MatchSettings.useExtra as Record<string, number | boolean>;
    this.published = () => this.updateScores();
    MatchInfo.updateScores = this.published;
  }

  dispose(): void {
    if (this.published && MatchInfo.updateScores === this.published) {
      MatchInfo.updateScores = NO_SCORES;
    }
    this.published = null;
  }

  enterFrame(): void {
    ++this.fc;
    if (MatchSettings.useMode === "dom" && this.fc % (30 * 3) === 0) {
      for (const hp of this.game.holdpoints) {
        if (hp.curTeam && hp.unitCaptured) hp.unitCaptured.pscore++;
      }
      this.updateScores();
    }
  }

  updateTeams(): void {
    const t1: ScoredUnit[] = [];
    const t2: ScoredUnit[] = [];
    for (const unit of [...this.team1, ...this.team2]) {
      if (unit.team === 1) t1.push(unit);
      else if (unit.team === 2) t2.push(unit);
    }
    this.team1 = t1;
    this.team2 = t2;
  }

  updateScores(): void {
    if (!this.initiated) return;
    const cap = MatchSettings.useScore;

    switch (MatchSettings.useMode) {
      case "dm":
      case "gg":
      case "zom":
      case "one": {
        let best: ScoredUnit | null = null;
        for (const unit of this.team0) {
          if (!unit.human && (!best || unit.pscore > best.pscore)) best = unit;
          if (unit.pscore >= cap) {
            unit.pscore = cap;
            this.game.endGame(unit.human);
          }
        }
        const player = this.game.player;
        const other = best ?? player;
        if (player && other) {
          this.game.setScoreBar(player.team, player.pscore, other.team, other.pscore);
        }
        break;
      }
      case "tdm":
      case "tgg":
      case "dom":
      case "ctf": {
        sortByScoreDesc(this.team1);
        sortByScoreDesc(this.team2);
        this.team1score = sumScore(this.team1);
        this.team2score = sumScore(this.team2);
        if (this.team1score >= cap) {
          this.team1score = cap;
          this.game.endGame(true);
        } else if (this.team2score >= cap) {
          this.team2score = cap;
          this.game.endGame(false);
        }
        this.game.setScoreBar(1, this.team1score, 2, this.team2score);
        break;
      }
      default:
        break;
    }
  }

  showScores(): ScoreRow[] {
    const rows: ScoreRow[] = [];
    let y = 0;
    rows.push(headerRow(y, "top", ""));

    if (!MatchSettings.useTeams) {
      sortByScoreDesc(this.team0);
      for (const unit of this.team0) {
        if (unit.unitInfo.extra.noSpawn) continue;
        rows.push(unitRow((y += 20), unit));
      }
      return rows;
    }

    sortByScoreDesc(this.team1);
    sortByScoreDesc(this.team2);
    this.team1score = Math.min(sumScore(this.team1), MatchSettings.useScore);
    this.team2score = Math.min(sumScore(this.team2), MatchSettings.useScore);

    const first = this.team1score >= this.team2score ? 1 : 2;
    const second = first === 1 ? 2 : 1;
    for (const n of [first, second]) {
      const units = n === 1 ? this.team1 : this.team2;
      const score = n === 1 ? this.team1score : this.team2score;
      rows.push(headerRow(
        (y += 20), `team${n}_player`, (n === 1 ? "Blue" : "Orange") + " Team", score,
      ));
      for (const unit of units) {
        if (unit.unitInfo.extra.noSpawn) continue;
        rows.push(unitRow((y += 20), unit));
      }
    }
    return rows;
  }
}

function sumScore(ar: readonly ScoredUnit[]): number {
  let total = 0;
  for (const u of ar) total += u.pscore;
  return total;
}

function sortByScoreDesc(ar: ScoredUnit[]): void {
  ar.sort((a, b) => b.pscore - a.pscore);
}

function headerRow(y: number, frame: string, text: string, score = 0): ScoreRow {
  return {
    y, frame, text,
    name: text,
    score: text ? String(score) : "",
    kills: "", deaths: "", cls: "", status: "",
  };
}

function unitRow(y: number, unit: ScoredUnit): ScoreRow {
  const frame = !unit.team
    ? "ffa_" + (unit.human ? "player" : "ai")
    : `team${unit.team}_` + (unit.human ? "player" : "ai");
  return {
    y, frame, text: "",
    name: unit.name,
    score: String(unit.pscore),
    kills: String(unit.score.kills),
    deaths: String(unit.score.deaths),
    cls: unit.unitInfo.cls,
    status: unit.dead ? "dm" : "",
  };
}
