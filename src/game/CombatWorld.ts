import type {
  AimerLike, BitScreenLike, GameLike, HudLike, KillstreakLike, LineSink, PhysWorldLike,
} from "./types";
import { MatchInfo } from "./types";
import type { Arena } from "./Arena";
import { UT } from "../core/UT";
import { Unit } from "./Unit";
import { AI, type AIHost, type AIKillstreak } from "./AI";
import { installKillstreaks } from "./killstreaks";
import type { Bullet } from "./bullets/Bullet";
import type { UnitInfo } from "./UnitInfo";
import * as Classes from "../data/StatsClasses";

type AnyKillstreak = AIKillstreak & KillstreakLike;

export interface CombatSinks {
  readonly arena: Arena;
  readonly hud: HudLike;
  readonly bitscreen: BitScreenLike;
  readonly lineCont: LineSink;
  readonly physWorld: PhysWorldLike;
  readonly aimer: AimerLike;
  createEffect(x: number, y: number, name: string, rot?: number, scale?: number): void;
  createEffectAtFrame(x: number, y: number, name: string, sub: string, frame: number): void;
  createParticle(
    x: number, y: number, type: string, rot?: number,
    data?: Record<string, number> | null, style?: string, text?: string,
    frame?: number,
  ): void;
  playScreenSound(name: string, x: number, y: number): void;
}

export class CombatWorld implements GameLike {
  gameStarted = false;
  gameEnded = false;
  beamDelay = 0;
  destroyed = false;

  readonly bullets: Bullet[] = [];
  readonly units: Unit[] = [];
  readonly killstreaks: AnyKillstreak[] = [];
  player: Unit | null = null;

  aiEnabled = true;

  enemyAmt = 0;
  enemyLvlAvg = 0;

  readonly brains = new Map<Unit, AI>();

  constructor(private readonly sinks: CombatSinks) {
    installKillstreaks();
  }

  private get aiHost(): AIHost {
    const self = this;
    return {
      get destroyed() { return self.destroyed; },
      get gameStarted() { return self.gameStarted; },
      get arena() { return self.sinks.arena; },
      get units() { return self.units; },
      get killstreaks() { return self.killstreaks; },
      get aiEnabled() { return self.aiEnabled; },
    };
  }

  get arena(): Arena { return this.sinks.arena; }
  get hud(): HudLike { return this.sinks.hud; }
  get bitscreen(): BitScreenLike { return this.sinks.bitscreen; }
  get lineCont(): LineSink { return this.sinks.lineCont; }
  get physWorld(): PhysWorldLike { return this.sinks.physWorld; }
  get aimer(): AimerLike { return this.sinks.aimer; }

  createEffect(x: number, y: number, name: string, rot?: number, scale?: number): void {
    this.sinks.createEffect(x, y, name, rot, scale);
  }

  createEffectAtFrame(
    x: number, y: number, name: string, sub: string, frame: number,
  ): void {
    this.sinks.createEffectAtFrame(x, y, name, sub, frame);
  }

  createParticle(
    x: number, y: number, type: string, rot?: number,
    data?: Record<string, number> | null, style?: string, text?: string,
    frame?: number,
  ): void {
    this.sinks.createParticle(x, y, type, rot, data, style, text, frame);
  }

  playScreenSound(name: string, x: number, y: number): void {
    this.sinks.playScreenSound(name, x, y);
  }

  addBullet(b: Bullet): void {
    this.bullets.push(b);
  }

  build(roster: readonly UnitInfo[], humanIndex = 0): void {
    this.units.length = 0;
    this.brains.clear();
    this.player = null;

    roster.forEach((info, i) => {
      info.prepareForGame(i === 0);
      const unit = new Unit(this, info);
      unit.human = i === humanIndex;
      this.units.push(unit);
      if (!unit.human) this.brains.set(unit, new AI(unit, this.aiHost));
    });

    const human = this.units[humanIndex];
    if (human) this.setPlayer(human);

    this.enemyAmt = 0;
    let lvlSum = 0;
    for (const u of this.units) {
      if (u === this.player) continue;
      if (u.team === 0 || u.team === 2) {
        lvlSum += u.unitInfo.level;
        ++this.enemyAmt;
      }
    }
    this.enemyLvlAvg = this.enemyAmt ? Math.floor(lvlSum / this.enemyAmt) : 0;

    if (MatchInfo.useMode === "one" && this.units.length) {
      UT.randEl(this.units).setJug();
    }
  }

  giveBrain(unit: Unit): void {
    unit.human = false;
    unit.focused = false;
    unit.mDown = false;
    unit.keys = 0;
    unit.gun.shotPressed = false;
    unit.setBarColour();
    unit.charSelect = false;
    if (!this.brains.has(unit)) this.brains.set(unit, new AI(unit, this.aiHost));
  }

  setPlayer(unit: Unit, becomeHuman = true): void {
    const old = this.player;
    if (old) {
      old.human = false;
      old.focused = false;
      old.mDown = false;
      old.gun.shotPressed = false;
      old.setBarColour();
      old.charSelect = false;
      if (!this.brains.has(old)) this.brains.set(old, new AI(old, this.aiHost));
    }
    this.player = unit;
    unit.focused = true;
    unit.status.setHudStuff();
    unit.gun.setHudStuff();
    this.sinks.hud.setPlayerInfo?.(
      Classes.itemOb[unit.unitInfo.cls]?.name ?? "", unit.unitInfo.level);
    if (becomeHuman) {
      unit.human = true;
      unit.setBarColour();
      unit.keys = 0;
      unit.charSelect = false;
      this.brains.delete(unit);
    } else {
      unit.charSelect = true;
    }
    unit.setKillstreakNum(unit.score.streak);
    this.arena.setFocus(unit, unit.gun.curGun?.vision ?? 0.5);
  }

  spawnAll(showRope = false): void {
    for (const u of this.units) {
      const extra = u.unitInfo.extra;
      if (extra.noSpawn) {
        u.visible = false;
        u.x = -4000;
        u.y = -4000;
        continue;
      }
      const sp = extra.spawn as { x: number; y: number; node: string } | undefined;
      if (sp) u.spawn(sp.x, sp.y, sp.node, showRope);
      else u.spawn(0, 0, "", showRope);
    }
  }

  update(tickHuman?: (unit: Unit) => void): void {
    if (this.beamDelay) {
      --this.beamDelay;
      if (this.beamDelay === 45) this.playScreenSound("S_Karthus", 0, 0);
    }
    for (let i = 0; i < this.killstreaks.length; i++) {
      this.killstreaks[i].EnterFrame();
    }
    for (const u of this.units) {
      const brain = this.brains.get(u);
      if (brain) brain.enterFrame();
      else if (tickHuman) tickHuman(u);
    }
  }
}

export function tickBullets(bullets: Bullet[]): void {
  for (const b of bullets) b.EnterFrame();
  for (let i = 0; i < bullets.length; i++) {
    if (bullets[i].remove) bullets.splice(i, 1);
  }
}
