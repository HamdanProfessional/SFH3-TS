import { UT } from "../../core/UT";
import { SD } from "../../state/SD";
import { getDist, getPythagorean, getRotation, rotateDirection, xMoveToRot, yMoveToRot } from "../Geom";
import { Bullet } from "./Bullet";
import type { BulletExtra } from "./Bullet";
import type { CorpseLike, GameLike, GunLike } from "../types";
import type { Unit } from "../Unit";

function p(stats: GunLike, i: number): number {
  return Number(stats.params?.[i] ?? 0);
}
function ps(stats: GunLike, i: number): string {
  return String(stats.params?.[i] ?? "");
}

export class Bullet_Proj_Basic extends Bullet {
  protected countDistX = 0;
  protected countDistY = 0;

  constructor(
    game: GameLike, unit: Unit, rotation: number, x: number, y: number,
    dist: number, gun: GunLike, extra: BulletExtra | null = null,
  ) {
    super(game, unit, rotation, x, y, dist, gun, true, extra);
    this.doHitEffect();
    this.xVel *= 0.5;
    this.yVel *= 0.5;
    this.countDistX = dist * Math.abs(this.xVel);
    this.countDistY = dist * Math.abs(this.yVel);
  }

  override EnterFrame(): void {
    this.yVel += p(this.stats, 2) * 0.1;
    const sub = p(this.stats, 1);
    for (let i = 0; i < sub; i++) {
      this.game.createEffect(this.x, this.y, ps(this.stats, 0));
      this.x += this.xVel;
      this.y += this.yVel;
      if (SD.options.graphPart) this.game.createEffect(this.x, this.y, ps(this.stats, 0));
      this.x += this.xVel;
      this.y += this.yVel;
      this.countDistX += Math.abs(this.xVel) * 2;
      this.countDistY += Math.abs(this.yVel) * 2;
      this.hitObject = this.hitTestAll();
      if (this.hitObject) break;
    }
    this.doHitEffect();
    if (getPythagorean(this.countDistX, this.countDistY) >= this.maxDist) this.removeMe();
    if (this.outOfBounds()) this.removeMe();
  }

  protected outOfBounds(): boolean {
    const w = this.game.arena.wall;
    return this.x < 0 || this.x > w.width || this.y < 0 || this.y > w.height;
  }
}

export class Bullet_Proj_Bounce extends Bullet {
  private fc = 0;

  constructor(
    game: GameLike, unit: Unit, rotation: number, x: number, y: number,
    dist: number, gun: GunLike, extra: BulletExtra | null = null,
  ) {
    super(game, unit, rotation, x, y, dist, gun, true, extra);
    this.extra.bounce = 0;
    this.doHitEffect();
    this.xVel *= 0.5;
    this.yVel *= 0.5;
  }

  override EnterFrame(): void {
    ++this.fc;
    this.yVel += p(this.stats, 2) * 0.1;
    const sub = p(this.stats, 1);
    for (let i = 0; i < sub; i++) {
      this.game.createEffect(this.x, this.y, ps(this.stats, 0));
      this.x += this.xVel;
      this.y += this.yVel;
      if (SD.options.graphPart) this.game.createEffect(this.x, this.y, ps(this.stats, 0));
      this.x += this.xVel;
      this.y += this.yVel;
      this.hitObject = this.hitTestAll(0, 0, true);
      if (this.hitObject) break;
      if (this.hitTestWall(0, 0)) {
        if (this.hitTestWall(0, 15)) {
          this.extra.bounce = (this.extra.bounce ?? 0) + 1;
          this.y -= this.yVel * 4;
          this.yVel *= -0.5;
          this.xVel *= 0.8;
        }
        if (this.hitTestWall(0, -15)) {
          this.extra.bounce = (this.extra.bounce ?? 0) + 1;
          this.y -= this.yVel * 4;
          this.yVel *= -0.5;
          this.xVel *= 0.8;
        }
        if (this.hitTestWall(10, -10)) {
          this.extra.bounce = (this.extra.bounce ?? 0) + 1;
          this.x -= this.xVel * 2;
          this.xVel *= -0.6;
          this.yVel *= 0.7;
        }
        if (this.hitTestWall(-10, -10)) {
          this.extra.bounce = (this.extra.bounce ?? 0) + 1;
          this.x -= this.xVel * 2;
          this.xVel *= -0.6;
          this.yVel *= 0.7;
        }
      }
    }
    this.doHitEffect();
    if (this.fc === p(this.stats, 3) * 30) this.doHitEffect(true);
    const w = this.game.arena.wall;
    if (this.x < 0 || this.x > w.width || this.y < 0 || this.y > w.height) this.removeMe();
  }
}

export class Bullet_Proj_Follow extends Bullet {
  private countDistX = 0;
  private countDistY = 0;

  constructor(
    game: GameLike, unit: Unit, rotation: number, x: number, y: number,
    dist: number, gun: GunLike, extra: BulletExtra | null = null,
  ) {
    super(game, unit, rotation, x, y, dist, gun, true, extra);
    this.doHitEffect();
    this.xVel *= 0.5;
    this.yVel *= 0.5;
    this.countDistX = dist * Math.abs(this.xVel);
    this.countDistY = dist * Math.abs(this.yVel);
  }

  override EnterFrame(): void {
    this.yVel += p(this.stats, 2) * 0.1;
    this.rotation = getRotation(this.x, this.y, this.x + this.xVel, this.y + this.yVel);
    for (let i = 0; i < this.game.units.length; i++) {
      const u = this.game.units[i];
      if (u === this.unit) continue;
      if (u.dead) continue;
      if (this.unit.team && this.unit.team === u.team) continue;
      if (getDist(this.x, this.y, u.x, u.y - 40) < p(this.stats, 3)) {
        this.rotation +=
          rotateDirection(this.rotation, getRotation(this.x, this.y, u.x, u.y - 40)) *
          p(this.stats, 4);
      }
    }
    this.xVel = xMoveToRot(this.rotation, 5);
    this.yVel = yMoveToRot(this.rotation, 5);

    const sub = p(this.stats, 1);
    for (let i = 0; i < sub; i++) {
      this.game.createEffect(this.x, this.y, ps(this.stats, 0));
      this.x += this.xVel;
      this.y += this.yVel;
      if (SD.options.graphPart) this.game.createEffect(this.x, this.y, ps(this.stats, 0));
      this.x += this.xVel;
      this.y += this.yVel;
      this.countDistX += Math.abs(this.xVel) * 2;
      this.countDistY += Math.abs(this.yVel) * 2;
      this.hitObject = this.hitTestAll();
      if (this.hitObject) break;
    }
    this.doHitEffect();
    if (getPythagorean(this.countDistX, this.countDistY) >= this.maxDist) this.removeMe();
    const w = this.game.arena.wall;
    if (this.x < 0 || this.x > w.width || this.y < 0 || this.y > w.height) this.removeMe();
  }
}

export class Bullet_Proj_Frames extends Bullet {
  private frame = 0;
  private name = "";
  private frames = 1;

  constructor(
    game: GameLike, unit: Unit, rotation: number, x: number, y: number,
    dist: number, gun: GunLike, extra: BulletExtra | null = null,
  ) {
    super(game, unit, rotation, x, y, dist, gun, true, extra);
    this.doHitEffect();
    const base = ps(this.stats, 0);
    const st = bitAniStats(base);
    this.frames = st.frames;
    this.name = base + UT.irand(0, st.rotAmt - 1);
    this.frame = 1;
  }

  override EnterFrame(): void {
    this.yVel += p(this.stats, 2) * 0.1;
    if (this.frame >= this.frames) {
      this.removeMe();
    } else {
      const sub = p(this.stats, 1);
      for (let i = 0; i < sub; i++) {
        this.x += this.xVel;
        this.y += this.yVel;
        this.game.bitscreen.paint(
          this.x + this.game.arena.x, this.y + this.game.arena.y,
          true, this.name, "idle", this.frame,
        );
        if (this.frame < this.frames) ++this.frame;
        this.x += this.xVel;
        this.y += this.yVel;
        if (SD.options.graphPart) {
          this.game.bitscreen.paint(
            this.x + this.game.arena.x, this.y + this.game.arena.y,
            true, this.name, "idle", this.frame,
          );
        }
        if (this.frame < this.frames - p(this.stats, 3)) {
          this.hitObject = this.hitTestAll();
          if (this.hitObject) {
            this.game.createEffectAtFrame(
              this.x, this.y, ps(this.stats, 0), "idle", this.frame,
            );
            this.doHitEffect();
            break;
          }
        }
      }
    }
    const w = this.game.arena.wall;
    if (this.x < 0 || this.x > w.width || this.y < 0 || this.y > w.height) this.removeMe();
  }
}

export class Bullet_Proj_Stick extends Bullet {
  private fc = 0;
  private xOff = 0;
  private yOff = 0;

  constructor(
    game: GameLike, unit: Unit, rotation: number, x: number, y: number,
    dist: number, gun: GunLike, extra: BulletExtra | null = null,
  ) {
    super(game, unit, rotation, x, y, dist, gun, true, extra);
    this.xVel *= 0.5;
    this.yVel *= 0.5;
  }

  override EnterFrame(): void {
    if (!this.hitObject) {
      this.yVel += p(this.stats, 2) * 0.1;
      const sub = p(this.stats, 1);
      for (let i = 0; i < sub; i++) {
        this.game.createEffect(this.x, this.y, ps(this.stats, 0));
        this.x += this.xVel;
        this.y += this.yVel;
        if (SD.options.graphPart) this.game.createEffect(this.x, this.y, ps(this.stats, 0));
        this.x += this.xVel;
        this.y += this.yVel;
        this.hitObject = this.hitTestAll();
        if (this.hitObject) {
          if (this.hitType === "unit") {
            const u = this.hitObject as Unit;
            this.xOff = this.x - u.x;
            this.yOff = this.y - u.y;
          }
          if (this.hitType === "corpse") {
            const c = this.hitObject as CorpseLike;
            this.xOff = this.x - c.x;
            this.yOff = this.y - c.y;
            this.extra.corpseStick = true;
          }
          break;
        }
      }
    } else {
      ++this.fc;
      if (this.hitType === "unit") {
        const u = this.hitObject as Unit;
        this.x = u.x + this.xOff;
        this.y = u.y + this.yOff;
        if (u.dead) {
          this.hitObject = u.dead;
          this.hitType = "corpse";
          this.extra.corpseStick = true;
        }
      }
      if (this.hitType === "corpse") {
        const c = this.hitObject as CorpseLike;
        this.x = c.x + this.xOff;
        this.y = c.y + this.yOff;
      }
      this.game.createEffect(this.x, this.y, ps(this.stats, 0));
      if (this.fc === p(this.stats, 3) * 30) this.doHitEffect();
    }
    const w = this.game.arena.wall;
    if (this.x < 0 || this.x > w.width || this.y < 0 || this.y > w.height) this.removeMe();
  }
}

let bitAniStats: (name: string) => { rotAmt: number; frames: number } = (name) =>
  DEFAULT_BIT_STATS[name] ?? { rotAmt: 1, frames: 1 };

const DEFAULT_BIT_STATS: Readonly<Record<string, { rotAmt: number; frames: number }>> = {
  FT: { rotAmt: 2, frames: 15 },
  Ice: { rotAmt: 2, frames: 15 },
  acid: { rotAmt: 2, frames: 15 },
};

export function setBitAniStatsLookup(
  fn: (name: string) => { rotAmt: number; frames: number },
): void {
  bitAniStats = fn;
}
