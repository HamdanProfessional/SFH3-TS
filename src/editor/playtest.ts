import type { Engine } from "../core/Engine";
import type { ScreenClass } from "../core/Screen";
import { MatchSettings, getGameMode, qmLevelFor } from "../game/MatchSettings";
import { backdropUrls } from "../game/maps";
import { preloadCustomMatch, type MatchAssets } from "../core/Preload";
import { LoaderScreen } from "../screens/LoaderScreen";
import type { MatchScript } from "../screens/GameScreen";
import { SD } from "../state/SD";
import type { CustomMap } from "./format";
import { customInfo, loadCustomMap } from "./art";
import type { LoadedMap } from "../game/maps";
import { MissionScript, missionRecord, missionTitle, type MissionResult } from "./mission";

export interface PlayOptions {
  mode: string;
  enemies: number;
  diff: number;
}

export const PLAY_MODES = [
  { key: "tdm", label: "Team Deathmatch" },
  { key: "dm", label: "Deathmatch" },
  { key: "ctf", label: "Capture the Flag" },
  { key: "dom", label: "Domination" },
] as const;

type Back = { screen: ScreenClass; arg?: unknown };

let pending: (() => void) | null = null;

export function endPlayTest(): void {
  pending?.();
  pending = null;
}

let lastMap: LoadedMap | null = null;

function freeLast(): void {
  if (!lastMap) return;
  lastMap.art.destroy(true);
  lastMap.radarTex.destroy(true);
  lastMap = null;
}

function stage(): Partial<typeof MatchSettings> {
  endPlayTest();
  freeLast();
  const saved = {
    qmMap: MatchSettings.qmMap, qmMode: MatchSettings.qmMode,
    qmScore: MatchSettings.qmScore, qmMod: MatchSettings.qmMod,
    qmTeams: MatchSettings.qmTeams, qmEnemies: MatchSettings.qmEnemies,
    qmLevel: MatchSettings.qmLevel, qmAiBots: MatchSettings.qmAiBots,
    matchType: MatchSettings.matchType,
  };
  const heroes = SD.heroes.map((h) => ({
    h, extra: h.extra, c: [h.earnedExp, h.earnedFunds, h.paidFunds] as const,
  }));
  pending = () => {
    Object.assign(MatchSettings, saved);
    MatchSettings.sandbox = false;
    for (const { h, extra, c } of heroes) {
      h.extra = extra;
      [h.earnedExp, h.earnedFunds, h.paidFunds] = c;
    }
  };
  return saved;
}

function launch(engine: Engine, m: CustomMap, mode: string, title: string, back: Back,
                script?: MatchScript): void {
  MatchSettings.useMap = customInfo(m);
  MatchSettings.sandbox = true;
  const home = back.screen;
  engine.setScreen(LoaderScreen, {
    title,
    run: (p) => preloadCustomMatch(
      backdropUrls(MatchSettings.useMap), () => loadCustomMap(m, mode), p,
    ),
    done: (r: unknown) => {
      const { map, hero } = r as MatchAssets;
      lastMap = map;
      void import("../screens/GameScreen").then((mod) => {
        engine.setScreen(mod.GameScreen, {
          map, hero, roster: MatchSettings.useBots, options: SD.options,
          exitTo: { screen: home, arg: back.arg }, script,
        });
      });
    },
    fail: () => engine.setScreen(home, back.arg),
  });
}

export function playCustomMap(engine: Engine, m: CustomMap, o: PlayOptions, back: Back): void {
  const saved = stage();
  const mode = getGameMode(o.mode);
  MatchSettings.matchType = 1;
  MatchSettings.qmMode = o.mode;
  MatchSettings.qmTeams = mode.teams;
  MatchSettings.qmScore = mode.startscore || 25;
  MatchSettings.qmMod = "none";
  MatchSettings.qmEnemies = Math.max(1, Math.min(mode.teams ? 5 : 9, o.enemies));
  MatchSettings.qmLevel = qmLevelFor(o.diff);
  MatchSettings.qmAiBots = true;
  const squad = mode.teams ? SD.squad : SD.squad.filter((i) => i >= 0).slice(0, 1);
  MatchSettings.setupMatch({
    squad, heroes: SD.heroes, curStage: SD.curStage, curDiff: SD.curDiff,
    bpClasses: SD.bpClasses, mission: null,
  });
  Object.assign(MatchSettings, saved);
  MatchSettings.matchType = 1;
  launch(engine, m, o.mode, m.name, back);
}

export function playCustomMission(engine: Engine, m: CustomMap, back: Back,
                                  onEnd: (r: MissionResult) => void): void {
  const mis = m.mission;
  if (!mis) return;
  stage();
  const teams = getGameMode(mis.mode).teams;
  const { record, roster } = missionRecord(m, mis);
  let seats = teams ? mis.squad : 1;
  const squad = SD.squad.map((i) => (i >= 0 && seats-- > 0 ? i : -1));
  if (!squad.some((i) => i >= 0) && SD.heroes.length) squad.splice(0, 1, 0);
  MatchSettings.matchType = 0;
  MatchSettings.setupMatch({
    squad, heroes: SD.heroes, curStage: 0, curDiff: 0, bpClasses: SD.bpClasses,
    mission: record,
  });
  const deployed = squad.filter((i) => i >= 0).map((i) => SD.heroes[i]).filter((h) => !!h);
  const title = missionTitle(m, mis);
  const script = new MissionScript(mis, title, roster, deployed, onEnd);
  launch(engine, m, mis.mode, title, back, script);
}
