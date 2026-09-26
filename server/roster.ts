import { UnitInfo } from "../src/game/UnitInfo";
import { newHero } from "../src/game/newHero";
import { applyPendingWeapons } from "../src/game/GunInfo";
import { getGameMode, MAX_LVL } from "../src/game/MatchSettings";
import { UT } from "../src/core/UT";
import * as Classes from "../src/data/StatsClasses";
import { heroFromWire, sanitiseHero, cleanName } from "../src/net/hero";
import type { MatchConfig } from "../src/net/protocol";
import type { RosterEntry } from "./ServerMatch";

export interface JoiningPlayer {
  id: string;
  name: string;
  squad: readonly Record<string, unknown>[];
  active: number;
  team: number;
  clan?: string;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function buildRoster(
  cfg: MatchConfig, players: readonly JoiningPlayer[],
  fixed = false,
): RosterEntry[] {
  const teamed = getGameMode(cfg.mode).teams;
  const out: RosterEntry[] = [];
  const teams = fixed ? players.map((p) => p.team) : assignTeams(players, teamed);

  players.forEach((p, i) => {
    const team = teamed ? teams[i] : 0;
    const squad = p.squad.length
      ? p.squad.map((blob) => heroForRound(blob, p.name, team))
      : [heroForRound(null, p.name, team)];
    const active = Math.max(0, Math.min(squad.length - 1, Math.floor(p.active) || 0));
    out.push({ info: squad[active], owner: p.id, squad, active });
  });

  for (let i = 0; i < cfg.bots; i++) {
    const info = newHero(UT.randEl(Classes.CLASSES_ALL), "", "");
    const lvl = clamp(Math.trunc(cfg.botLevel * UT.rand(0.8, 1.2)), 1, MAX_LVL + 5);
    applyPendingWeapons(info);
    info.setupLevelStats(lvl);
    info.team = teamed ? shortestTeam(out, i) : 0;
    info.extra = {};
    out.push({ info, owner: null });
  }

  return out;
}

export function heroForRound(
  blob: Record<string, unknown> | null, player: string, team: number,
): UnitInfo {
  const info = blob
    ? heroFromWire(sanitiseHero(blob))
    : newHero(UT.randEl(Classes.CLASSES_ALL), "", cleanName(player, "Rookie"));
  info.name = cleanName(player, info.name);
  info.team = team;
  info.extra = {};
  applyPendingWeapons(info);
  info.setupLevelStats(clamp(info.level, 1, MAX_LVL + 5));
  return info;
}

function assignTeams(players: readonly JoiningPlayer[], teamed: boolean): number[] {
  if (!teamed) return players.map(() => 0);
  const out = players.map(() => 0);
  const count = [0, 0, 0];
  players.forEach((p, i) => {
    if (p.team === 1 || p.team === 2) {
      out[i] = p.team;
      count[p.team]++;
    }
  });
  const cap = Math.ceil(players.length / 2);
  players.forEach((p, i) => {
    if (out[i]) return;
    const mate = p.clan
      ? players.findIndex((q, j) => j !== i && out[j] && q.clan === p.clan)
      : -1;
    const side = mate >= 0 ? out[mate] : count[1] <= count[2] ? 1 : 2;
    out[i] = side;
    count[side]++;
  });
  const withMate = (i: number): boolean => !!players[i].clan && players.some(
    (q, j) => j !== i && q.clan === players[i].clan && out[j] === out[i]);
  for (let side = 1; side <= 2; side++) {
    const other = side === 1 ? 2 : 1;
    for (let i = players.length - 1; i >= 0 && count[side] > cap; i--) {
      if (out[i] !== side || withMate(i)) continue;
      out[i] = other;
      count[side]--;
      count[other]++;
    }
  }
  return out;
}

function shortestTeam(sofar: readonly RosterEntry[], nth: number): number {
  let t1 = 0;
  let t2 = 0;
  for (const e of sofar) {
    if (e.info.team === 1) t1++;
    else if (e.info.team === 2) t2++;
  }
  if (t1 < t2) return 1;
  if (t2 < t1) return 2;
  return nth % 2 === 0 ? 1 : 2;
}

export type { UnitInfo };
