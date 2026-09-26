import * as Missions from "../src/data/StatsMissions";
import { getLevelReq } from "../src/data/StatsMisc";
import * as Classes from "../src/data/StatsClasses";
import { newHero } from "../src/game/newHero";
import { applyPendingWeapons } from "../src/game/GunInfo";
import { getGameMode, MAX_LVL } from "../src/game/MatchSettings";
import { UT } from "../src/core/UT";
import { heroForRound, type JoiningPlayer } from "./roster";
import type { RosterEntry } from "./ServerMatch";
import type { MatchConfig } from "../src/net/protocol";
import type { UnitInfo } from "../src/game/UnitInfo";

const MAX_UNITS = 16;

const TEAM_FORM: Readonly<Record<string, string>> = {
  dm: "tdm", one: "tdm", gg: "tgg", elim: "telim", zom: "tdm",
};

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function coopMissions(maps: readonly string[]): number[] {
  return Missions.itemAr
    .filter((m) => !m.extra.tut1 && !m.extra.tut2 && maps.includes(m.map))
    .map((m) => m.i);
}

export function nextMission(list: readonly number[], i: number): number {
  const at = list.indexOf(i);
  return list[(at + 1) % list.length] ?? list[0] ?? 0;
}

export function coopConfig(base: MatchConfig, i: number, players: number): MatchConfig {
  const m = Missions.getMission(i);
  const ffa = !getGameMode(m.mode).teams;
  const mode = ffa ? TEAM_FORM[m.mode] ?? "tdm" : m.mode;
  const kills = getGameMode(mode).scoretype === "KILLS";
  return {
    ...base,
    map: m.map,
    mode,
    score: ffa && kills ? m.score * Math.max(1, players) : m.score,
    mod: "none",
    bots: 0,
    mission: m.i,
    extra: structuredClone(m.extra),
  };
}

export function describeMission(i: number): { title: string; desc: string } {
  const m = Missions.getMission(i);
  return { title: Missions.missionTitle(m), desc: m.desc };
}

export function buildCoopRoster(
  i: number, diff: number, players: readonly JoiningPlayer[],
): RosterEntry[] {
  Missions.init();
  const m = Missions.getMission(i);
  const ffa = !getGameMode(m.mode).teams;
  const raise = num(m.extra.raiseLvl);
  const level = (u: UnitInfo, extraRaise: number): void => {
    const lvl = clamp(Math.round(getLevelReq(m.i, diff) * UT.rand(0.8, 1.2)), 1, MAX_LVL + 5)
      + raise + extraRaise;
    applyPendingWeapons(u);
    u.setupLevelStats(clamp(lvl, 1, MAX_LVL + 5));
  };

  const out: RosterEntry[] = [];
  for (const p of players) {
    const squad = (p.squad.length ? p.squad : [null]).map((blob) => {
      const h = heroForRound(blob, p.name, 1);
      h.extra = structuredClone(m.squadExtra);
      return h;
    });
    const active = clamp(Math.floor(p.active) || 0, 0, squad.length - 1);
    out.push({ info: squad[active], owner: p.id, squad, active });
  }

  const allies = Math.max(0, (ffa ? 1 : m.team1) - players.length);
  for (let k = 0; k < allies && out.length < MAX_UNITS; k++) {
    const u = newHero(UT.randEl(Classes.CLASSES_BASIC), "", "");
    u.extra = structuredClone(m.squadExtra);
    level(u, 0);
    u.team = 1;
    out.push({ info: u, owner: null });
  }

  const extraFoes = Math.max(0, players.length - (ffa ? 1 : m.team1));
  const room = (): boolean => out.length < MAX_UNITS;
  if (m.units?.length) {
    for (const u of m.units) {
      if (!room()) break;
      level(u, num(u.extra.raiseLvl));
      u.team = u.extra.team !== undefined ? Number(u.extra.team) : 2;
      out.push({ info: u, owner: null });
    }
  }
  const generated = m.units?.length
    ? extraFoes
    : (ffa ? Math.min(m.team2, 2 + 2 * players.length) : m.team2 + extraFoes);
  for (let k = 0; k < generated && room(); k++) {
    const u = newHero(UT.randEl(Classes.CLASSES_BASIC), "enemy");
    level(u, 0);
    u.team = 2;
    out.push({ info: u, owner: null });
  }
  return out;
}
