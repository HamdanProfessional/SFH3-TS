import { UT } from "../core/UT";
import { getRotation, xMoveToRot, yMoveToRot, inBox, coinFlip } from "./Geom";
import { MatchSettings } from "./MatchSettings";
import { PIT_SURFACES, isSolidPixel, surfaceKey } from "./Arena";
import type { Arena, NodeWaypoint, NodeSpawn, DeadBody, WallMask } from "./Arena";

export const PIT_LOOKAHEAD = 24;
const PIT_PROBE_STEP = 2;

export function groundIsFatal(wall: WallMask, x: number, y: number): boolean {
  if (x < 0 || x > wall.width) return true;
  for (let py = y + 1; py < wall.height; py += PIT_PROBE_STEP) {
    const px = wall.getPixel32(x, py);
    if (PIT_SURFACES.has(surfaceKey(px))) return true;
    if (isSolidPixel(px)) return false;
  }
  return true;
}

export type { DeadBody } from "./Arena";

export const KEY = {
  UP: 1,
  DOWN: 2,
  LEFT: 4,
  RIGHT: 8,
} as const;

function u32(n: number): number {
  return Math.trunc(n);
}

export interface AIMovement {
  jumping: boolean;
  crouching: boolean;
  dontStop: boolean;
  xVel: number;
  yVel: number;
  hitTest(offX: number, offY: number): number;
  doJump(): void;
}

export interface AIStatus {
  sFrozen: number;
  sInvis: number;
  sSpawn: number;
  sTag: number;
  sWallhack: number;
  EnterFrame(): void;
}

export interface AIGunStats {
  vision: number;
  range: number;
  rps: number;
  loud: number;
  type: number;
  isMelee: boolean;
}

export interface AIGunHolder {
  readonly curGun: AIGunStats;
  readonly primary: AIGunStats;
  readonly secondary: AIGunStats;
  readonly shootDelay: number;
  shoot(): void;
  swapGuns(): void;
}

export interface AITargetable {
  readonly x: number;
  readonly y: number;
  readonly dead: DeadBody;
  readonly mov?: { readonly crouching: boolean };
}

export interface AIVisibleUnit extends AITargetable {
  readonly team: number;
  readonly status: AIStatus;
  readonly gun: AIGunHolder;
  readonly loudness: number;
  readonly unitInfo: { skills: Record<string, number> };
}

export interface AIKillstreak extends AITargetable {
  readonly shootable: boolean;
  readonly unit: { readonly team: number } | null;
}

export interface AIUnit {
  readonly x: number;
  readonly y: number;
  readonly human: boolean;
  team: number;
  readonly dead: DeadBody;
  respawnTimer: number;
  keys: number;
  aimX: number;
  aimY: number;
  target: AITargetable | null;
  scaleX: number;
  hasFlag: unknown;
  defendingFlag: boolean;
  capturing: boolean;
  diff: number;
  readonly mov: AIMovement;
  readonly status: AIStatus;
  readonly gun: AIGunHolder;
  readonly score: { streakReady(): boolean };
  readonly unitInfo: {
    level: number;
    mobile: number;
    aggro: number;
    aim: number;
    skills: Record<string, number>;
    extra: Record<string, unknown>;
  };
  useKillstreak(): void;
  brain?: unknown;
  unitEnterFrame(): void;
  tickArmClips(): void;
  tickDead(): void;
  unitSpawn(x?: number, y?: number, node?: string, showRope?: boolean): void;
}

export interface AIHost {
  readonly destroyed: boolean;
  readonly gameStarted: boolean;
  readonly arena: Arena;
  readonly units: readonly AIVisibleUnit[];
  readonly killstreaks: readonly AIKillstreak[];
  readonly aiEnabled: boolean;
}

export const AI_CURVES = {
  waitMod: (mobile: number): number => UT.getLinearRange(mobile, 9, 0.8, 0.2),
  waitNormal: (mobile: number): number => UT.getLinearRange(mobile, 9, 0.04, 0.001),
  waitTarget: (mobile: number): number => UT.getLinearRange(mobile, 9, 0.07, 0.02),
  crouchNormal: (mobile: number): number => UT.getLinearRange(mobile, 9, 0.06, 0.01),
  crouchTarget: (mobile: number): number => UT.getLinearRange(mobile, 9, 0.1, 0.03),
  waitFlag: (mobile: number): number => UT.getLinearRange(mobile, 9, 0.01, 0.001),
  shotChance: (aggro: number): number => UT.getLinearRange(aggro, 9, 1, 4),
  aimSpeed: (aim: number): number => UT.getLinearRange(aim, 9, 0.09, 0.9),
  aimRange: (aim: number): number => UT.getLinearRange(aim, 9, 400, 650),
} as const;

export interface AITuning {
  waitMod: number;
  waitNormal: number;
  waitTarget: number;
  crouchNormal: number;
  crouchTarget: number;
  waitFlag: number;
  shotChance: number;
  aimSpeed: number;
  aimRange: number;
  diff: number;
}

export function computeTuning(
  mobile: number, aggro: number, aim: number, level: number, gunVision = 0,
): AITuning {
  let aimRange = AI_CURVES.aimRange(aim);
  if (gunVision > 0.5) aimRange *= 1.3;
  return {
    waitMod: AI_CURVES.waitMod(mobile),
    waitNormal: AI_CURVES.waitNormal(mobile),
    waitTarget: AI_CURVES.waitTarget(mobile),
    crouchNormal: AI_CURVES.crouchNormal(mobile),
    crouchTarget: AI_CURVES.crouchTarget(mobile),
    waitFlag: AI_CURVES.waitFlag(mobile),
    shotChance: AI_CURVES.shotChance(aggro),
    aimSpeed: AI_CURVES.aimSpeed(aim),
    aimRange,
    diff: Math.trunc(level / 30),
  };
}

export class NodeWaypointPath {
  readonly path: string;
  readonly nodes: number;
  readonly dist: number;

  constructor(path: string, nodesOb: Readonly<Record<string, NodeWaypoint>>) {
    this.path = path;
    this.nodes = path.length;
    let dist = 0;
    for (let i = 0; i < this.nodes - 1; i++) {
      const a = nodesOb[path.charAt(i)];
      const b = nodesOb[path.charAt(i + 1)];
      if (a && b) dist += UT.getDist(a.x, a.y, b.x, b.y);
    }
    this.dist = dist;
  }
}

function searchNode(
  wpOb: Readonly<Record<string, NodeWaypoint>>,
  src: string,
  end: string,
  path: string,
  out: NodeWaypointPath[],
): void {
  path += src;
  if (src === end) out.push(new NodeWaypointPath(path, wpOb));
  const node = wpOb[src];
  if (!node) return;
  for (const con of node.connects) {
    const next = con.id;
    if (path.indexOf(next) === -1) searchNode(wpOb, next, end, path, out);
  }
}

export function pathFind(
  wpOb: Readonly<Record<string, NodeWaypoint>>,
  from: NodeWaypoint,
  end: string,
  randNode = 0,
): string {
  const out: NodeWaypointPath[] = [];
  for (const con of from.connects) searchNode(wpOb, con.id, end, from.id, out);
  out.sort((a, b) => a.dist - b.dist);
  let pick = randNode;
  if (pick > out.length - 1) {
    pick = (out.length - 1) >>> 0;
  }
  const chosen = out[UT.irand(0, pick)];
  return chosen.path.substring(1);
}

export class AI {
  curWp: NodeWaypoint | null = null;
  nextWp: NodeWaypoint | null = null;
  path = "@@";
  wpTimer = 0;
  private pitVeto = 0;

  private focusX = 0;
  private focusY = 0;

  private getTargetTimer = 0;
  private readonly getTargetEvent: number;

  wait = 0;
  nowait = 0;
  crouch = 0;
  nocrouch = 0;

  private shootSpd = 0;
  tuning: AITuning;

  constructor(
    readonly unit: AIUnit,
    readonly game: AIHost,
  ) {
    this.getTargetEvent = UT.irand(1, 12);
    this.tuning = computeTuning(
      unit.unitInfo.mobile, unit.unitInfo.aggro, unit.unitInfo.aim,
      unit.unitInfo.level, unit.gun.curGun.vision,
    );
    unit.diff = this.tuning.diff;
    unit.brain = this;
  }

  setDiffStats(): void {
    const ui = this.unit.unitInfo;
    this.tuning = computeTuning(
      ui.mobile, ui.aggro, ui.aim, ui.level, this.unit.gun.curGun.vision,
    );
    this.unit.diff = this.tuning.diff;
  }

  spawn(x = 0, y = 0, node = "", showRope = true): void {
    const u = this.unit;
    u.unitSpawn(x, y, node, showRope);
    u.aimX = u.x + 200;
    u.aimY = u.y - 50;
    if (u.unitInfo.extra.aimReverse) {
      u.aimX = u.y - 100;
      u.scaleX = -1;
    }
  }

  setAiSpawnNode(node: NodeSpawn | { waypoint?: NodeWaypoint | null }): void {
    if (node.waypoint) this.getNextWaypoint(node.waypoint, true);
  }

  setSpawnWaypointId(id: string): void {
    if (!id) return;
    for (const wp of this.game.arena.waypoints) {
      if (wp.id === id) {
        this.getNextWaypoint(wp, true);
        break;
      }
    }
  }

  private shrugUppityHose(): void {
    const arena = this.game.arena;
    const u = this.unit;
    if (!u.hasFlag) {
      const enemyFlag = u.team === 1 ? arena.flag2 : arena.flag1;
      if (Math.random() < 0.3 && enemyFlag && !enemyFlag.unitCaptured && this.curWp) {
        this.path = pathFind(arena.wpOb, this.curWp, enemyFlag.id, 5);
      }
    } else {
      const homeFlag = u.team === 1 ? arena.flag1 : arena.flag2;
      if (homeFlag && this.curWp) {
        this.path = pathFind(arena.wpOb, this.curWp, homeFlag.id, 5);
      }
    }
  }

  getNextWaypoint(wp: NodeWaypoint | null = null, force = false): void {
    const u = this.unit;
    this.wpTimer = 0;
    if (!force && u.mov.jumping && this.nextWp && Math.abs(u.y - this.nextWp.y) > 30) {
      return;
    }
    if (wp) {
      this.curWp = this.nextWp;
      this.nextWp = wp;
      return;
    }

    this.curWp = this.nextWp;
    if (MatchSettings.useMode === "ctf" && !this.path && this.path.charAt(0) !== "@") {
      this.shrugUppityHose();
    }
    if (!this.curWp) {
      this.getClosestWp();
      return;
    }
    if (Math.abs(u.y - this.curWp.y) > 50) {
      this.getClosestWp();
    } else if (Math.abs(u.y - this.curWp.y) < 50) {
      if (this.path && this.path.charAt(0) !== "@") {
        this.nextWp = this.game.arena.wpOb[this.path.charAt(0)] ?? this.nextWp;
        this.path = this.path.substring(1);
        if (this.path === "") this.path = "@";
      } else {
        this.nextWp = UT.randEl(this.curWp.connects) ?? this.nextWp;
        if (this.path.charAt(0) === "@") this.path = this.path.substring(1);
      }
    }
  }

  getClosestWp(): void {
    const u = this.unit;
    this.wpTimer = 0;
    this.path = "@";
    let best: NodeWaypoint | null = null;
    let bestDist = Infinity;
    for (const wp of this.game.arena.waypoints) {
      if (Math.abs(u.y - wp.y) < 100) {
        const d = Math.abs(u.x - wp.x);
        if (d < bestDist) {
          bestDist = d;
          best = wp;
        }
      }
    }
    this.nextWp = best ?? (this.curWp ? UT.randEl(this.curWp.connects) : this.nextWp);
  }

  pathFind(end: string, randNode = 0): string {
    if (!this.curWp) return "";
    return pathFind(this.game.arena.wpOb, this.curWp, end, randNode);
  }

  enterFrame(): boolean {
    const u = this.unit;
    const game = this.game;
    if (game.destroyed) return false;
    if (u.unitInfo.extra.noSpawn) return false;

    if (u.dead) {
      this.tickDead();
      return false;
    }

    if (!u.mov.jumping && !this.wait && !this.crouch) ++this.wpTimer;
    if (this.wpTimer >= 30 * 4) this.getClosestWp();

    if (u.status.sFrozen) {
      u.status.EnterFrame();
      return false;
    }

    u.tickArmClips();

    u.keys = 0;
    if (!game.aiEnabled) {
      u.unitEnterFrame();
      return true;
    }
    this.tickNavigation();
    this.tickObjectives();
    this.tickWaitCrouch();
    this.tickTargeting();
    this.aimAtTarget();
    this.tickMeleeSwap();
    this.tickFiring();

    if (u.score.streakReady()) u.useKillstreak();

    this.tickActionBoxes();

    u.unitEnterFrame();
    return true;
  }

  private tickDead(): void {
    this.unit.tickDead();
  }

  private tickNavigation(): void {
    const u = this.unit;
    if (u.mov.dontStop || u.unitInfo.extra.dontStop) {
      this.wait = 0;
      this.crouch = 0;
    }
    const next = this.nextWp;
    if (!next) return;
    if (next.x > u.x - 30 && next.x < u.x + 30) {
      this.getNextWaypoint();
      return;
    }
    if (this.wait) return;

    const dir = next.x > u.x ? 1 : -1;
    if (this.pitAhead(dir)) {
      if (++this.pitVeto % 15 === 0) this.getNextWaypoint();
      return;
    }
    this.pitVeto = 0;
    u.keys |= dir > 0 ? KEY.RIGHT : KEY.LEFT;
  }

  private pitAhead(dir: number): boolean {
    const u = this.unit;
    if (u.mov.jumping || u.mov.dontStop || u.unitInfo.extra.dontStop) return false;
    if (this.inActionBox()) return false;
    return groundIsFatal(this.game.arena.wall, u.x + dir * PIT_LOOKAHEAD, u.y);
  }

  private inActionBox(): boolean {
    const u = this.unit;
    const next = this.nextWp;
    if (!next) return false;
    for (const ab of next.actionBoxes) {
      if (inBox(u.x, u.y, ab.x, ab.y, ab.width, ab.height)) return true;
    }
    return false;
  }

  private tickObjectives(): void {
    const u = this.unit;
    const arena = this.game.arena;

    if (MatchSettings.useMode === "dom") {
      for (const hp of arena.holdpoints) {
        if (!inBox(u.x, u.y, hp.x - 120, hp.y - 150, 240, 200)) continue;
        const flagRising = false;
        if (!this.wait && !this.nowait && (u.team !== hp.curTeam || flagRising)) {
          if (Math.random() < 0.5) this.wait = UT.irand(1, 8) * 30;
          else this.crouch = UT.irand(1, 8) * 30;
          this.nowait = 0;
        }
      }
    }

    if (MatchSettings.useMode === "ctf") {
      const home = u.team === 1 ? arena.flag1 : arena.flag2;
      if (home && !home.unitCaptured
        && inBox(u.x, u.y, home.x - 100, home.y - 40, 200, 100)) {
        if (!this.wait && !this.nowait && !u.hasFlag) {
          u.defendingFlag = true;
          if (Math.random() < 0.5) this.wait = UT.irand(1, 8) * 30;
          else this.crouch = UT.irand(1, 8) * 30;
          this.nowait = this.wait + UT.irand(1, 3) * 30;
        }
      }
      if (!this.wait && !this.nowait) u.defendingFlag = false;
    }
  }

  private tickWaitCrouch(): void {
    const u = this.unit;

    if (!this.wait && !this.nowait && !u.mov.jumping
      && Math.random() < (u.target ? this.tuning.waitTarget : this.tuning.waitNormal)
      && !u.status.sSpawn) {
      this.wait = u32(UT.irand(1, 3) * this.tuning.waitMod * 30);
      this.nowait = u32(this.wait + UT.irand(2, 4) * this.tuning.waitMod * 30);
      if (u.hasFlag) this.wait = u32(this.wait * 0.2);
    }

    if (!this.crouch
      && Math.random() < (u.target ? this.tuning.crouchTarget : 0)
      && !u.status.sSpawn && !this.nocrouch) {
      this.crouch = u32(UT.irand(2, 4) * this.tuning.waitMod * 30);
      this.nocrouch = u32(this.crouch + UT.irand(0, 2) * 30);
    }

    if (this.wait) --this.wait;
    if (this.nowait) --this.nowait;

    if (u.mov.dontStop || u.unitInfo.extra.dontStop) {
      this.wait = 0;
      this.crouch = 0;
    }

    if (this.crouch && (u.keys & KEY.LEFT) && u.mov.hitTest(-19, -20)) this.crouch = 0;
    if (this.crouch && (u.keys & KEY.RIGHT) && u.mov.hitTest(19, -20)) this.crouch = 0;

    if (this.crouch) {
      u.keys |= KEY.DOWN;
      --this.crouch;
    }
    if (this.nocrouch) --this.nocrouch;
  }

  private tickTargeting(): void {
    const u = this.unit;
    ++this.getTargetTimer;
    if (this.getTargetTimer > 12) this.getTargetTimer = 0;
    if (this.getTargetTimer !== this.getTargetEvent) return;

    const candidates: { dist: number; unit: AIVisibleUnit; rot: number }[] = [];
    for (const other of this.game.units) {
      if ((other as unknown) === (u as unknown)) continue;
      if (other.dead) continue;
      if (u.team && u.team === other.team) continue;
      if (other.status.sInvis === 1) continue;
      if (other.status.sSpawn) continue;

      const dist = UT.getDist(u.x, u.y, other.x, other.y);
      let loud = this.tuning.aimRange - 100 + other.loudness;
      if (other.status.sTag) loud += 150;
      loud += other.gun.curGun.loud;
      loud = Math.max(100, loud);
      if (dist < Math.min(u.gun.curGun.range * 10, loud)) {
        candidates.push({ dist, unit: other, rot: getRotation(u.x, u.y, other.x, other.y) });
      }
    }

    if (!u.status.sWallhack) {
      for (let i = 0; i < candidates.length; i++) {
        if (!this.hasLineOfSight(candidates[i].rot, candidates[i].dist)) {
          candidates.splice(i, 1);
          i--;
        }
      }
    }

    if (candidates.length) {
      candidates.sort((a, b) => a.dist - b.dist);
      u.target = candidates[0].unit;
    } else {
      u.target = null;
    }

    if (u.target) return;

    for (const ks of this.game.killstreaks) {
      if (!ks.shootable) continue;
      if (!ks.unit) continue;
      if ((ks.unit as unknown) === (u as unknown)) continue;
      if (u.team && u.team === ks.unit.team) continue;
      const dist = UT.getDist(u.x, u.y, ks.x, ks.y);
      if (dist >= Math.min(u.gun.curGun.range * 10, this.tuning.aimRange)) continue;
      const rot = getRotation(u.x, u.y, ks.x, ks.y);
      if (this.hasLineOfSight(rot, dist)) u.target = ks;
    }
  }

  private hasLineOfSight(rot: number, dist: number): boolean {
    const u = this.unit;
    const eye = u.mov.crouching ? 20 : 50;
    for (let d = 0; d < dist; d += 20) {
      if (u.mov.hitTest(xMoveToRot(rot, d), yMoveToRot(rot, d) - eye)) return false;
    }
    return true;
  }

  private aimAtTarget(): void {
    const u = this.unit;
    const t = u.target;
    if (!t) {
      this.focusX = u.x + u.scaleX * 50 + u.mov.xVel * 10;
      this.focusY = u.y - 40 + u.mov.yVel * 8;
      u.aimX += (this.focusX - u.aimX) * 0.4;
      u.aimY += (this.focusY - u.aimY) * 0.3;
      return;
    }
    if (!t.dead) {
      this.focusX = t.x;
      this.focusY = t.y - (t.mov?.crouching ? 20 : 40);
    } else {
      this.focusX = t.dead.x;
      this.focusY = t.dead.y + 10;
    }
    u.aimX += (this.focusX - u.aimX) * this.tuning.aimSpeed;
    u.aimY += (this.focusY - u.aimY) * this.tuning.aimSpeed;
  }

  private tickMeleeSwap(): void {
    const u = this.unit;
    if (!u.gun.secondary.isMelee) return;
    const t = u.target;
    if (t && UT.getDist(u.x, u.y, t.x, t.y) < u.gun.secondary.range * 10 + 30) {
      if (u.gun.curGun !== u.gun.secondary && !u.gun.shootDelay) u.gun.swapGuns();
    } else if (u.gun.curGun !== u.gun.primary && !u.gun.shootDelay) {
      u.gun.swapGuns();
    }
  }

  private tickFiring(): void {
    const u = this.unit;
    if (!this.game.gameStarted || !u.target || u.status.sSpawn) return;
    this.shootSpd = 0.06 + u.gun.curGun.rps * 0.006;
    this.shootSpd *= this.tuning.shotChance;
    if (u.gun.curGun.type === 9) this.shootSpd = 1;
    if (Math.random() < this.shootSpd) u.gun.shoot();
  }

  private tickActionBoxes(): void {
    const u = this.unit;
    const next = this.nextWp;
    if (!next) return;
    for (const ab of next.actionBoxes) {
      if (!inBox(u.x, u.y, ab.x, ab.y, ab.width, ab.height)) continue;
      if (u.keys & KEY.DOWN) u.keys ^= KEY.DOWN;
      switch (ab.action) {
        case "j":
          if (!u.capturing) {
            this.wait = 0;
            this.nowait = 30;
            if (!u.mov.jumping) u.mov.doJump();
          }
          break;
        case "c":
          u.keys |= KEY.DOWN;
          break;
        case "fc":
          this.forceWaypoint("c");
          break;
        case "fp":
          this.forceWaypoint("p");
          break;
        case "fd":
          this.forceWaypoint("d");
          break;
        case "fx":
          if (next.id !== "m" && next.id !== "l") this.forceWaypoint(coinFlip("m", "l"));
          break;
      }
    }
  }

  private forceWaypoint(id: string): void {
    const wp = this.game.arena.wpOb[id];
    if (wp) this.getNextWaypoint(wp, true);
  }
}
