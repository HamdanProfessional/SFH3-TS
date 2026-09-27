import { UT } from "../core/UT";
import * as Classes from "../data/StatsClasses";
import { ALL_TRAITS, u, type Mission } from "../data/StatsMissions";
import { HERO_NAMES } from "../data/names";
import { getGameMode } from "../game/MatchSettings";
import type { UnitInfo } from "../game/UnitInfo";
import type { Unit } from "../game/Unit";
import type { MatchScript, MatchScriptHost } from "../screens/GameScreen";
import {
  MISSION_CLASSES, isDev, isHero, type CustomMap, type EdMission, type EdMissionUnit, type MissionRule,
  type MissionWin,
} from "./format";
import { buildNav, checkMap, type BuildIssue, type NavGraph } from "./build";

type ClassId = typeof Classes.CLASSES_ALL[number];
type EdClassId = Exclude<typeof MISSION_CLASSES[number], "">;
const SAME_CLASSES: [ClassId] extends [EdClassId]
  ? [EdClassId] extends [ClassId] ? true : never : never = true;
void SAME_CLASSES;

export const MODE_LABELS: Readonly<Record<string, string>> = {
  tdm: "Team Deathmatch", dm: "Deathmatch", ctf: "Capture the Flag", dom: "Domination",
};

export const WIN_LABELS: Readonly<Record<MissionWin, string>> = {
  score: "Reach the score",
  survive: "Survive until the clock runs out",
  elim: "Eliminate every enemy",
  boss: "Defeat the boss",
};

export const RULE_LABELS: Readonly<Record<MissionRule, string>> = {
  none: "None",
  streak: "Killstreaks earned 2x quicker",
  invisible: "Your team is invisible",
  enemyInvisible: "Enemies are invisible",
  enemyRegen: "Enemies have super healing",
  allTraits: "Everyone has all traits",
  vampire: "Every kill heals 60%",
};

export const CLASS_LABELS: Readonly<Record<string, string>> = {
  "": "Random class", eng: "Engineer", jug: "Juggernaut", med: "Medic", gun: "Gunner",
  eli: "Elite", mer: "Mercenary", sni: "Sniper", nin: "Ninja",
  mike: "Mike (developer)", justin: "Justin (developer)",
  wesley: "Wesley (Engineer)", nathan: "Nathan (Engineer)", jyn: "Jyn (Sniper)",
  tower: "Tower (Juggernaut)", dex: "Dex (Mercenary)",
};

const HERO_SPECIFIC: Readonly<Record<string, string>> = {
  wesley: "starter1", nathan: "$eng", jyn: "$sni", tower: "$jug", dex: "$mer",
};

export const DEV_PHASE_SCORES = [4, 8, 12, 16, 20, 23] as const;

export function missionUnit(ally = false): EdMissionUnit {
  return {
    cls: "", lvl: 5, count: ally ? 1 : 3, ally, lives: 1, boss: false, name: "",
    statMod: 0, scale: 0,
  };
}

export function defaultMission(): EdMission {
  return {
    title: "", mode: "tdm", win: "score", score: getGameMode("tdm").startscore, time: 0,
    squad: 3, rule: "none", devPhases: false, units: [missionUnit()],
    text: { brief: "", start: "", half: "", win: "", lose: "" },
  };
}

export function missionTitle(m: CustomMap, mis: EdMission): string {
  return mis.title || m.name;
}

function ruleSkills(rule: MissionRule, enemy: boolean): Record<string, number> | null {
  switch (rule) {
    case "streak": return { streak_: 1 };
    case "invisible": return enemy ? null : { stealth_: 1 };
    case "enemyInvisible": return enemy ? { stealth_: 1 } : null;
    case "allTraits": return { ...ALL_TRAITS };
    default: return null;
  }
}

export interface Tracked {
  info: UnitInfo;
  lives: number;
  boss: boolean;
  ally: boolean;
}

export function missionRecord(m: CustomMap, mis: EdMission): { record: Mission; roster: Tracked[] } {
  const teams = getGameMode(mis.mode).teams;
  const roster: Tracked[] = [];
  const allySkills = ruleSkills(mis.rule, false);
  const enemySkills = ruleSkills(mis.rule, true);
  for (const row of mis.units) {
    if (row.ally && !teams) continue;
    for (let i = 0; i < row.count; i++) {
      const extra: Record<string, unknown> = { raiseLvl: row.lvl - 1 };
      if (row.statMod) extra.statMod = row.statMod;
      if (row.scale) extra.scale = row.scale;
      if (row.ally) extra.team = 1;
      const dev = isDev(row.cls);
      const ruled = row.ally ? allySkills : enemySkills;
      const skills = dev ? { ...ALL_TRAITS, streak_: 1, ...ruled } : ruled;
      if (skills) extra.skills = skills;
      if (!row.ally && mis.rule === "enemyRegen") extra.permRegen = 1;
      const hero = isHero(row.cls);
      const info = dev
        ? u("", row.cls, "", extra)
        : hero
          ? u("", HERO_SPECIFIC[row.cls], "", extra)
          : u(row.cls || UT.randEl(Classes.CLASSES_ALL), "enemy", "", extra);
      if (dev) info.devHero = true;
      if (hero) {
        info.extra.pendingWeapons = {
          primary: { random: "primary" }, secondary: { random: "secondary" }, randomMods: true,
        };
      }
      if (!dev && !hero) {
        if (row.name) info.name = row.name;
        else if (row.ally) info.name = UT.randEl(HERO_NAMES);
      }
      roster.push({ info, lives: row.lives, boss: row.boss, ally: row.ally });
    }
  }
  const squadSkills = ruleSkills(mis.rule, false);
  const phases = mis.devPhases && mis.units.some((r) => isDev(r.cls) && (teams || !r.ally));
  const extra: Record<string, unknown> = mis.rule === "vampire" ? { vampire: 1 } : {};
  if (phases) extra.developers = {};
  const record: Mission = {
    challenge: missionTitle(m, mis),
    num: 0,
    i: -1,
    mode: mis.mode,
    score: mis.score,
    map: m.backdrop,
    team1: teams ? mis.squad : 1,
    team2: roster.filter((t) => !t.ally).length,
    rewards: [],
    units: roster.map((t) => t.info),
    extra,
    squadExtra: squadSkills ? { skills: squadSkills } : {},
    desc: mis.rule === "none" ? "" : RULE_LABELS[mis.rule],
    song: phases ? "M_SFH" : null,
  };
  return { record, roster };
}

export function checkMission(
  m: CustomMap, mis: EdMission, nav: NavGraph = buildNav(m, mis.mode),
): BuildIssue[] {
  const out: BuildIssue[] = [];
  const teams = getGameMode(mis.mode).teams;
  if (!mis.units.some((r) => !r.ally)) out.push({ level: "error", text: "Add at least one enemy." });
  if (mis.win === "boss" && !mis.units.some((r) => r.boss)) {
    out.push({ level: "error", text: "\"Defeat the boss\" needs a roster row marked Boss." });
  }
  if (mis.win === "survive" && !mis.time) {
    out.push({ level: "error", text: "\"Survive\" needs a time limit." });
  }
  if (!teams && mis.units.some((r) => r.ally)) {
    out.push({ level: "warn", text: "Deathmatch has no teams: allies are left out." });
  }
  if (!teams && mis.squad > 1) {
    out.push({ level: "warn", text: "Deathmatch fields one hero, whatever the squad size." });
  }
  if (mis.devPhases) {
    const devs = mis.units.some((r) => isDev(r.cls) && (teams || !r.ally));
    const reached = DEV_PHASE_SCORES.filter((s) => s <= mis.score).length;
    if (!devs) {
      out.push({ level: "warn", text: "Boss phases need Mike or Justin on the roster." });
    } else if (reached < DEV_PHASE_SCORES.length) {
      out.push({ level: "warn", text: `Boss phases run to ${DEV_PHASE_SCORES.at(-1)} points: `
        + `a cap of ${mis.score} ends the match after ${reached} of ${DEV_PHASE_SCORES.length}.` });
    }
  }
  return out.concat(checkMap(m, mis.mode, nav));
}

export interface MissionResult {
  won: boolean;
  title: string;
  secs: number;
  kills: number;
  deaths: number;
  reason: string;
  text: string;
}

export function clock(secs: number): string {
  const s = Math.max(0, Math.ceil(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export class MissionScript implements MatchScript {
  caption = "";
  private bodies: { unit: Unit; t: Tracked }[] | null = null;
  private squadUnits: Unit[] = [];
  private ticks = 0;
  private started = false;
  private saidHalf = false;
  private finishing = false;
  private over = false;
  private reason = "";

  constructor(
    private readonly mis: EdMission,
    private readonly title: string,
    private readonly roster: readonly Tracked[],
    private readonly squad: readonly UnitInfo[],
    private readonly onEnd: (r: MissionResult) => void,
  ) {}

  tick(h: MatchScriptHost): void {
    if (this.over || !h.gameStarted) return;
    if (!this.bodies) {
      this.bodies = [];
      for (const t of this.roster) {
        const unit = h.units.find((x) => x.unitInfo === t.info);
        if (unit) this.bodies.push({ unit, t });
      }
      this.squadUnits = h.units.filter((x) => this.squad.includes(x.unitInfo));
    }
    if (!this.started) {
      this.started = true;
      if (this.mis.text.start) h.say(this.boss()?.unit ?? null, this.mis.text.start);
    }
    ++this.ticks;
    const secs = this.ticks / 30;
    const mis = this.mis;

    const counted = this.bodies.filter((b) =>
      !b.t.ally && (mis.win === "elim" || (mis.win === "boss" && b.t.boss)));
    let down = 0;
    for (const b of counted) {
      const extra = b.unit.unitInfo.extra;
      if (!extra.noSpawn && b.unit.dead && b.unit.score.deaths >= b.t.lives) {
        extra.noSpawn = true;
      }
      if (extra.noSpawn) ++down;
    }

    if (!this.saidHalf && mis.text.half && this.progress(h, secs, down, counted) >= 0.5) {
      this.saidHalf = true;
      h.say(this.boss()?.unit ?? null, mis.text.half);
    }

    const left = mis.time ? mis.time - secs : 0;
    switch (mis.win) {
      case "survive": this.caption = `SURVIVE ${clock(left)}`; break;
      case "elim": this.caption = `ENEMIES LEFT ${counted.length - down}`; break;
      case "boss": this.caption = `BOSS: ${(this.boss()?.unit.name ?? "").toUpperCase()}`; break;
      default: this.caption = "";
    }
    if (mis.time && mis.win !== "survive") {
      this.caption = this.caption ? `${this.caption}  ${clock(left)}` : clock(left);
    }

    if (mis.win === "elim" && counted.length && down >= counted.length) {
      this.finish(h, true, "Every enemy eliminated");
    } else if (mis.win === "boss" && counted.length && down >= counted.length) {
      this.finish(h, true, "The boss is down");
    } else if (mis.time && secs >= mis.time) {
      if (mis.win === "survive") this.finish(h, true, "You survived");
      else this.finish(h, false, "Out of time");
    }
  }

  private progress(h: MatchScriptHost, secs: number, down: number,
                   counted: readonly { unit: Unit; t: Tracked }[]): number {
    const mis = this.mis;
    switch (mis.win) {
      case "survive": return mis.time ? secs / mis.time : 0;
      case "elim": return counted.length ? down / counted.length : 0;
      case "boss": {
        const b = counted[0];
        if (!b) return 0;
        const st = b.unit.status;
        const hurt = b.unit.dead || !st.hpMax ? 0 : 1 - st.hpCur / st.hpMax;
        return (b.unit.score.deaths + hurt) / b.t.lives;
      }
      default: {
        const mine = getGameMode(mis.mode).teams ? h.team1score : h.player?.pscore ?? 0;
        return mine / mis.score;
      }
    }
  }

  private boss(): { unit: Unit; t: Tracked } | undefined {
    return this.bodies?.find((b) => b.t.boss);
  }

  private finish(h: MatchScriptHost, won: boolean, reason: string): void {
    this.reason = reason;
    this.finishing = true;
    h.endGame(won);
    this.finishing = false;
  }

  allowEnd(won: boolean): boolean {
    return this.finishing || !won || this.mis.win === "score";
  }

  ended(won: boolean): void {
    if (this.over) return;
    this.over = true;
    this.caption = "";
    const reason = this.reason
      || (won ? "Score reached" : "The enemy reached the score limit");
    let kills = 0;
    let deaths = 0;
    for (const x of this.squadUnits) {
      kills += x.score.kills;
      deaths += x.score.deaths;
    }
    this.onEnd({
      won, title: this.title, secs: Math.floor(this.ticks / 30), kills, deaths, reason,
      text: won ? this.mis.text.win : this.mis.text.lose,
    });
  }
}
