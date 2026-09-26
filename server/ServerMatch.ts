import { Arena, type ArenaDef } from "../src/game/Arena";
import { CombatWorld, tickBullets } from "../src/game/CombatWorld";
import type { CombatSinks } from "../src/game/CombatWorld";
import { MatchSettings, MatchState, getGameMode } from "../src/game/MatchSettings";
import type { MatchHost, ScoredUnit } from "../src/game/MatchSettings";
import { MatchInfo } from "../src/game/types";
import { DevScript } from "../src/game/devScript";
import type { HitExtra } from "../src/game/types";
import type { Unit } from "../src/game/Unit";
import { UnitInfo } from "../src/game/UnitInfo";
import { getMap, type MapInfo } from "../src/data/StatsMaps";
import { loadServerMap } from "./mapLoad";
import { heroToWire } from "../src/net/hero";
import {
  ANIM_IDS, EV, EDGE, UF, YF,
  type DeviceRow, type MatchConfig, type NetInput, type Snapshot, type UnitSlot,
  type YouState,
} from "../src/net/protocol";

const ANIM_INDEX = new Map(ANIM_IDS.map((a, i) => [a, i]));

function deviceRows(list: readonly unknown[]): DeviceRow[] {
  return list.filter(
    (k): k is DeviceRow => typeof k === "object" && k !== null && "kind" in k,
  );
}

export interface RosterEntry {
  info: UnitInfo;
  owner: string | null;
  squad?: UnitInfo[];
  active?: number;
}

export interface MatchResult {
  winner: number;
  team1: number;
  team2: number;
  ranOut: boolean;
}

export class ServerMatch {
  readonly arena: Arena;
  readonly combat: CombatWorld;
  readonly match: MatchState;
  readonly roster: readonly RosterEntry[];

  tick = 0;
  gameStarted = false;
  gameEnded = false;
  result: MatchResult | null = null;

  private introTimer = 61;

  private events: unknown[][] = [];
  private lines: number[] = [];

  private readonly inputs = new Map<number, NetInput>();
  private readonly edges = new Map<number, number>();
  private readonly acked = new Map<number, number>();
  private readonly youRows = new Map<number, YouState>();

  private readonly deaths: { at: number; victim: number; killer: number }[] = [];
  readonly gunKills = new Map<number, Map<string, number>>();
  private devScript: DevScript | null = null;

  private readonly nextHero = new Map<number, UnitInfo>();

  private readonly gunKeys: string[] = [];

  constructor(readonly cfg: MatchConfig, roster: readonly RosterEntry[], assetDir: string,
    custom?: { def: ArenaDef; info: MapInfo }) {
    this.roster = roster;

    const mode = getGameMode(cfg.mode);
    MatchSettings.matchType = 1;
    MatchSettings.useMap = custom?.info ?? getMap(cfg.map);
    MatchSettings.useMode = cfg.mode;
    MatchSettings.useScore = cfg.score;
    MatchSettings.useMod = cfg.mod;
    MatchSettings.useTeams = mode.teams;
    MatchSettings.useExtra = structuredClone(cfg.extra ?? {});
    MatchSettings.useBots = roster.map((r) => r.info);
    MatchInfo.matchType = 1;
    MatchInfo.useMode = cfg.mode;
    MatchInfo.useScore = cfg.score;
    MatchInfo.useMod = cfg.mod;
    MatchInfo.useExtra = MatchSettings.useExtra as Record<string, number | boolean>;

    this.arena = new Arena(
      custom?.def ?? loadServerMap(cfg.map, assetDir), cfg.mode, MatchSettings.useMap,
    );
    this.arena.screenShake = false;

    this.combat = new CombatWorld(this.sinks());
    this.combat.build(roster.map((r) => r.info), 0);
    this.combat.spawnAll(false);
    this.combat.gameStarted = false;

    roster.forEach((entry, i) => {
      if (!entry.owner) return;
      const u = this.combat.units[i];
      if (!u) return;
      u.human = true;
      u.keys = 0;
      u.charSelect = false;
      u.setBarColour();
      this.combat.brains.delete(u);
    });

    this.match = new MatchState(this.host());
    this.match.init();
  }

  private host(): MatchHost {
    const self = this;
    return {
      get units(): readonly ScoredUnit[] { return self.combat.units; },
      get player(): ScoredUnit | null { return self.combat.player; },
      get holdpoints() { return self.arena.holdpoints; },
      endGame: () => self.finish(false),
      setScoreBar: () => {},
    };
  }

  private sinks(): CombatSinks {
    const self = this;
    const ev = (...row: unknown[]): void => { self.events.push(row); };
    return {
      arena: this.arena,
      hud: {
        setHealth: () => {},
        setArmor: () => {},
        setBloodyScreen: () => {},
        resetBloodyScreen: () => {},
        addKillFeed: (killer: Unit | null, victim: Unit, weaponId: string,
          extra: HitExtra) => {
          const k = killer ? self.indexOf(killer) : -1;
          const v = self.indexOf(victim);
          self.deaths.push({ at: self.tick, victim: v, killer: k });
          if (k >= 0 && k !== v) {
            let byGun = self.gunKills.get(k);
            if (!byGun) self.gunKills.set(k, byGun = new Map());
            byGun.set(weaponId, (byGun.get(weaponId) ?? 0) + 1);
          }
          const hit = extra as HitExtra & { hitX?: number; hitY?: number };
          ev(EV.KILL, k, v, weaponId,
            (extra.headMult ? 1 : 0) | (extra.critMult ? 2 : 0),
            r(hit.hitX ?? victim.x), r(hit.hitY ?? victim.y),
            r(victim.mov.xVel), r(victim.mov.yVel));
        },
        addCustomFeed: (unit: Unit, text: string) =>
          ev(EV.FEED, self.indexOf(unit), text),
        setDebug: () => {},
        setKillstreakNum: () => {},
        setStreakReady: () => {},
        clearStreak: () => {},
      },
      bitscreen: {
        paint: (x, y, over, name, frameLabel, frame) =>
          ev(EV.PAINT, r(x), r(y), over ? 1 : 0, name, frameLabel ?? "", frame ?? 0),
      },
      lineCont: {
        lineStyle: (t, c, a) => { self.lines.push(0, t, c, a); },
        moveTo: (x, y) => { self.lines.push(1, r(x), r(y)); },
        lineTo: (x, y) => { self.lines.push(2, r(x), r(y)); },
        curveTo: (cx, cy, x, y) => { self.lines.push(3, r(cx), r(cy), r(x), r(y)); },
      },
      physWorld: { actors: [], createCorpse: () => null, hitCorpse: () => {} },
      aimer: { x: 0, y: 0 },
      createEffect: (x, y, name) => ev(EV.FX, r(x), r(y), name),
      createEffectAtFrame: (x, y, name, sub, frame) =>
        ev(EV.FX_FRAME, r(x), r(y), name, sub, frame),
      createParticle: (x, y, type, rot, data, style, text, frame) =>
        ev(EV.PARTICLE, r(x), r(y), type, r(rot ?? 0), data ?? null,
          style ?? "", text ?? "", frame ?? 0),
      playScreenSound: (name, x, y) => ev(EV.SOUND, name, r(x), r(y)),
    };
  }

  private indexOf(u: Unit): number {
    return this.combat.units.indexOf(u);
  }

  setInput(slot: number, input: NetInput): void {
    this.inputs.set(slot, input);
    this.edges.set(slot, (this.edges.get(slot) ?? 0) | input.edges);
  }

  claimSlot(slot: number): void {
    const u = this.combat.units[slot];
    if (!u) return;
    this.combat.brains.delete(u);
    u.human = true;
    u.keys = 0;
    u.mDown = false;
    u.gun.shotPressed = false;
    u.charSelect = false;
    u.setBarColour();
    this.inputs.delete(slot);
    this.edges.delete(slot);
  }

  releaseSlot(slot: number): void {
    const u = this.combat.units[slot];
    if (!u) return;
    this.inputs.delete(slot);
    this.edges.delete(slot);
    this.acked.delete(slot);
    this.youRows.delete(slot);
    this.combat.giveBrain(u);
  }

  queueHero(slot: number, info: UnitInfo): void {
    this.nextHero.set(slot, info);
  }

  private applyHeroes(): void {
    for (const [slot, info] of this.nextHero) {
      const u = this.combat.units[slot];
      if (!u) { this.nextHero.delete(slot); continue; }
      if (!u.dead) continue;
      this.nextHero.delete(slot);
      if (u.unitInfo === info) continue;
      info.team = u.team;
      info.prepareForGame(slot === 0);
      u.adoptHero(info);
      this.events.push([EV.HERO, slot, heroToWire(info)]);
    }
  }

  heroPending(slot: number): boolean {
    return this.nextHero.has(slot);
  }

  youState(slot: number): YouState | undefined {
    return this.youRows.get(slot);
  }

  update(): void {
    this.events = [];
    this.lines = [];
    if (this.gameEnded) return;
    ++this.tick;
    if (this.nextHero.size) this.applyHeroes();

    if (!this.gameStarted && --this.introTimer <= 0) {
      this.gameStarted = true;
      this.combat.gameStarted = true;
    }

    if ((MatchSettings.useExtra as { developers?: unknown }).developers) {
      const self = this;
      (this.devScript ??= new DevScript()).tick({
        get units(): readonly Unit[] { return self.combat.units; },
        get team1score(): number { return self.match.team1score; },
        say: (u, text) => { self.events.push([EV.SAY, self.indexOf(u), text]); },
        scaled: (u, scale) => { self.events.push([EV.SCALE, self.indexOf(u), scale]); },
      });
    }

    this.combat.update((u) => this.tickHuman(u));
    for (const p of this.arena.pickups) p.enterFrame();
    tickBullets(this.combat.bullets);
    this.match.enterFrame();

    if (this.cfg.timeLimit > 0 && this.tick >= this.cfg.timeLimit * 30) {
      this.finish(true);
    }
  }

  private tickHuman(u: Unit): void {
    const slot = this.indexOf(u);
    this.driveHuman(u, slot);
    this.recordYou(u, slot);
  }

  private recordYou(u: Unit, slot: number): void {
    const mov = u.mov;
    let fl = 0;
    if (mov.jumping) fl |= YF.JUMPING;
    if (mov.crouching) fl |= YF.CROUCHING;
    if (mov.landHard) fl |= YF.LAND_HARD;
    if (mov.jumpClimb) fl |= YF.JUMP_CLIMB;
    if (mov.parachute) fl |= YF.PARACHUTE;
    if (u.dead || u.status.sFrozen) fl |= YF.NO_SIM;
    if (u.status.sSpawn) fl |= YF.SPAWN;
    this.youRows.set(slot, {
      t: this.tick,
      q: this.acked.get(slot) ?? 0,
      x: r2(u.x), y: r2(u.y),
      xVel: r2(mov.xVel), yVel: r2(mov.yVel),
      fl,
      ft: mov.falltimer,
      cl: mov.climb,
      cs: mov.climbSize,
    });
  }

  private driveHuman(u: Unit, slot: number): void {
    const inp = this.inputs.get(slot);
    const edge = this.edges.get(slot) ?? 0;
    this.edges.set(slot, 0);
    if (inp) this.acked.set(slot, inp.seq);

    if (edge & EDGE.MDOWN) {
      if (this.gameStarted && !u.status.sFrozen && !u.unitInfo.extra.noShoot) {
        u.mDown = true;
      }
    }
    if (edge & EDGE.MUP) {
      u.mDown = false;
      u.gun.releaseMouse();
    }

    if (u.dead) {
      u.tickDead();
      return;
    }
    if (u.status.sFrozen) {
      u.status.EnterFrame();
      return;
    }
    u.tickArmClips();
    if (!this.gameStarted) {
      u.unitEnterFrame();
      return;
    }

    if (inp && !u.unitInfo.extra.noAim) {
      u.aimX += (inp.aimX - u.aimX) * 0.5;
      u.aimY += (inp.aimY - u.aimY) * 0.5;
    }

    u.keys = inp ? inp.keys & 15 : 0;
    if (edge & EDGE.JUMP) u.mov.doJump();
    if (edge & EDGE.RELOAD) u.gun.manualReload();
    if (edge & EDGE.SWAP) u.gun.swapGuns();
    if (edge & EDGE.STREAK) u.useKillstreak();
    if (u.mDown) u.gun.shoot();

    u.unitEnterFrame();
  }

  private finish(ranOut: boolean): void {
    if (this.gameEnded) return;
    this.gameEnded = true;
    this.combat.gameEnded = true;

    let winner = 0;
    if (MatchSettings.useTeams) {
      const { team1score: t1, team2score: t2 } = this.match;
      winner = t1 === t2 ? 0 : t1 > t2 ? 1 : 2;
      this.result = { winner, team1: t1, team2: t2, ranOut };
      return;
    }
    let best = -1;
    let bestScore = -Infinity;
    let tied = false;
    this.combat.units.forEach((u, i) => {
      if (u.pscore > bestScore) { bestScore = u.pscore; best = i; tied = false; }
      else if (u.pscore === bestScore) tied = true;
    });
    this.result = {
      winner: tied && ranOut ? 0 : best,
      team1: bestScore === -Infinity ? 0 : bestScore,
      team2: 0,
      ranOut,
    };
  }

  private unitRows(): number[][] {
    return this.combat.units.map((u) => {
      const st = u.status;
      const gun = u.gun.curGun;
      let flags = 0;
      if (u.visible) flags |= UF.VISIBLE;
      if (u.dead) flags |= UF.DEAD;
      if (u.human) flags |= UF.HUMAN;
      if (u.isJug) flags |= UF.JUG;
      if (u.hasFlag) flags |= UF.FLAG;
      if (u.scaleX < 0) flags |= UF.FACE_LEFT;
      if (u.streakInProgress) flags |= UF.STREAK_ON;
      if (u.MC.gunsVisible) flags |= UF.GUNS_VIS;
      return [
        r(u.x), r(u.y), flags,
        ANIM_INDEX.get(u.MC.curAnim) ?? 0, u.MC.currentFrame,
        Math.round(u.alpha * 100),
        r(st.hpCur), r(st.hpMax), r(st.arCur), r(st.arMax),
        r(u.aimX), r(u.aimY),
        u.team, u.pscore, u.score.kills, u.score.deaths,
        r(u.rotArm), r(u.rotReload),
        u.MC.arm1.frame, u.MC.arm2.frame,
        gun ? gun.clipAmmo : 0, gun ? gun.spareAmmo : 0,
        r(u.score.streak), r(u.respawnTimer),
      ];
    });
  }

  private gunEvents(): void {
    this.combat.units.forEach((u, i) => {
      const cur = u.gun.curGun;
      const other = u.gun.otherGun as typeof cur | undefined;
      if (!cur) return;
      const key = `${cur.id}/${cur.rarity}|${other?.id ?? ""}/${other?.rarity ?? 0}`;
      if (this.gunKeys[i] === key) return;
      this.gunKeys[i] = key;
      this.events.push([
        EV.GUN, i, cur.id, cur.rarity, other?.id ?? "", other?.rarity ?? 0,
      ]);
    });
  }

  private objRow(): number[] {
    const out: number[] = [];
    for (const h of this.arena.holdpoints) out.push(h.curTeam, r(h.flagPos));
    for (const f of this.arena.ctfflags) {
      const c = f.unitCaptured as Unit | null;
      out.push(f.team, c ? this.indexOf(c) : -1);
    }
    for (const p of this.arena.pickups) out.push(p.taken);
    return out;
  }

  snapshot(): Snapshot {
    this.gunEvents();
    return {
      t: this.tick,
      started: this.gameStarted,
      ended: this.gameEnded,
      units: this.unitRows(),
      devices: deviceRows(this.combat.killstreaks),
      ev: this.events,
      lines: this.lines,
      obj: this.objRow(),
      s1: this.match.team1score,
      s2: this.match.team2score,
    };
  }

  slots(): UnitSlot[] {
    return this.roster.map((entry, i) => {
      const info = this.combat.units[i]?.unitInfo ?? entry.info;
      return {
        i,
        owner: entry.owner,
        name: info.name,
        team: this.combat.units[i]?.team ?? info.team,
        info: heroToWire(info),
        ...(this.cfg.mission !== undefined ? { extra: structuredClone(info.extra) } : {}),
      };
    });
  }
}

function r(v: number): number {
  return Math.round(v) || 0;
}

function r2(v: number): number {
  return Math.round(v * 100) / 100 || 0;
}
