import { UT } from "../../core/UT";
import { getDist, xMoveToRot, yMoveToRot } from "../Geom";
import { Bullet } from "./Bullet";
import type { BulletExtra } from "./Bullet";
import type { GameLike, GunLike } from "../types";
import type { Unit } from "../Unit";

interface Pt {
  x: number;
  y: number;
}
interface LiftPt extends Pt {
  lift: number;
}

function p(stats: GunLike, i: number): number {
  return Number(stats.params?.[i] ?? 0);
}

export class Bullet_Line_Basic extends Bullet {
  private linePath: Pt[] = [];

  constructor(
    game: GameLike, unit: Unit, rotation: number, x: number, y: number,
    dist: number, gun: GunLike, extra: BulletExtra | null = null,
  ) {
    super(game, unit, rotation, x, y, dist, gun, true, extra);
    const steps = Math.trunc(this.maxDist / 10);
    for (let i = 0; i < steps; i++) {
      this.x += this.xVel;
      this.y += this.yVel;
      this.hitObject = this.hitTestAll();
      if (this.hitObject) break;
    }
    this.doHitEffect();
    this.curDist = Math.round(getDist(this.ox, this.oy, this.x, this.y));

    this.linePath = [];
    if (p(this.stats, 0)) {
      for (let i = Math.trunc(UT.irand(0, 100)); i < this.curDist; i += UT.irand(50, 250)) {
        this.linePath.push({
          x: this.ox + xMoveToRot(this.rotation, i),
          y: this.oy + yMoveToRot(this.rotation, i),
        });
      }
    } else {
      this.linePath.push({ x: this.ox, y: this.oy });
    }

    const strokes = ((this.stats.params?.length ?? 0) - 1) / 3;
    for (let j = 0; j < strokes; j++) {
      let newLine = true;
      const g = this.game.lineCont;
      g.lineStyle(p(this.stats, j * 3 + 1), p(this.stats, j * 3 + 2), p(this.stats, j * 3 + 3));
      for (let i = 0; i < this.linePath.length; i++) {
        if (newLine) g.moveTo(this.linePath[i].x, this.linePath[i].y);
        else g.lineTo(this.linePath[i].x, this.linePath[i].y);
        newLine = !newLine;
      }
      if (!newLine) g.lineTo(this.x, this.y);
    }
    this.removeMe();
  }
}

export class Bullet_Line_Bend extends Bullet {
  private alphaV = 1;
  private mid: Pt = { x: 0, y: 0 };
  private mid1: Pt = { x: 0, y: 0 };
  private mid1to: Pt = { x: 0, y: 0 };
  private mid2: Pt = { x: 0, y: 0 };
  private mid2to: Pt = { x: 0, y: 0 };

  constructor(
    game: GameLike, unit: Unit, rotation: number, x: number, y: number,
    dist: number, gun: GunLike, extra: BulletExtra | null = null,
  ) {
    super(game, unit, rotation, x, y, dist, gun, false, extra);
    const steps = Math.trunc(this.maxDist / 10);
    for (let i = 0; i < steps; i++) {
      this.x += this.xVel;
      this.y += this.yVel;
      this.hitObject = this.hitTestAll();
      if (this.hitObject) break;
    }
    this.doHitEffect();
    this.curDist = Math.round(getDist(this.ox, this.oy, this.x, this.y));
    this.mid = { x: (this.ox + this.x) / 2, y: (this.oy + this.y) / 2 };
    this.mid1 = { x: (this.ox + this.mid.x) / 2, y: (this.oy + this.mid.y) / 2 };
    this.mid2 = { x: (this.mid.x + this.x) / 2, y: (this.mid.y + this.y) / 2 };
    const rx = UT.rand(-90, 90);
    const ry = UT.rand(-90, 90);
    this.mid1to = { x: this.mid1.x + rx, y: this.mid1.y + ry };
    this.mid2to = { x: this.mid2.x - rx, y: this.mid2.y - ry };
    this.draw(1);
  }

  private draw(alpha: number): void {
    const strokes = ((this.stats.params?.length ?? 0) - 1) / 3;
    const g = this.game.lineCont;
    for (let j = 0; j < strokes; j++) {
      g.lineStyle(
        p(this.stats, j * 3 + 1), p(this.stats, j * 3 + 2),
        p(this.stats, j * 3 + 3) * alpha,
      );
      g.moveTo(this.ox, this.oy);
      g.curveTo(this.mid1.x, this.mid1.y, this.mid.x, this.mid.y);
      g.curveTo(this.mid2.x, this.mid2.y, this.x, this.y);
    }
  }

  override EnterFrame(): void {
    this.alphaV -= 0.1;
    this.mid1.x += (this.mid1to.x - this.mid1.x) * 0.1;
    this.mid1.y += (this.mid1to.y - this.mid1.y) * 0.1;
    this.mid2.x += (this.mid2to.x - this.mid2.x) * 0.1;
    this.mid2.y += (this.mid2to.y - this.mid2.y) * 0.1;
    this.draw(this.alphaV);
    if (this.alphaV <= 0) this.removeMe();
  }
}

export class Bullet_Line_Laser extends Bullet {
  private line1: Pt[] = [];
  private line2: Pt[] = [];

  constructor(
    game: GameLike, unit: Unit, rotation: number, x: number, y: number,
    dist: number, gun: GunLike, extra: BulletExtra | null = null,
  ) {
    super(game, unit, rotation, x, y, dist, gun, false, extra);
    this.line1 = [{ x: this.ox, y: this.oy }];
    this.line2 = [{ x: this.ox, y: this.oy }];
    const steps = Math.trunc(this.maxDist / 10);
    for (let i = 0; i < steps; i++) {
      this.x += this.xVel;
      this.y += this.yVel;
      this.line1.push({ x: this.x + UT.rand(-1, 1), y: this.y + UT.rand(-1, 1) });
      this.line2.push({ x: this.x + UT.rand(-1, 1), y: this.y + UT.rand(-1, 1) });
      this.hitObject = this.hitTestAll();
      if (this.hitObject) break;
    }
    this.doHitEffect();
  }

  override EnterFrame(): void {
    const g = this.game.lineCont;
    g.lineStyle(p(this.stats, 0), p(this.stats, 1), p(this.stats, 2));
    g.moveTo(this.line1[0].x, this.line1[0].y);
    for (let i = 1; i < this.line1.length; i++) {
      this.line1[i].x += UT.rand(-1, 1);
      this.line1[i].y += UT.rand(-1, 1);
      g.lineTo(this.line1[i].x, this.line1[i].y);
    }
    g.lineStyle(p(this.stats, 3), p(this.stats, 4), p(this.stats, 5));
    g.moveTo(this.line2[0].x, this.line2[0].y);
    for (let i = 1; i < this.line2.length; i++) {
      this.line2[i].x += UT.rand(-1, 1);
      this.line2[i].y += UT.rand(-1, 1);
      g.lineTo(this.line2[i].x, this.line2[i].y);
    }
    this.removeMe();
  }
}

export class Bullet_Line_Sniper extends Bullet {
  private linePath: LiftPt[] = [];
  private alphaV = 1;

  constructor(
    game: GameLike, unit: Unit, rotation: number, x: number, y: number,
    dist: number, gun: GunLike, extra: BulletExtra | null = null,
  ) {
    super(game, unit, rotation, x, y, dist, gun, false, extra);
    const steps = Math.trunc(this.maxDist / 10);
    for (let i = 0; i < steps; i++) {
      this.x += this.xVel;
      this.y += this.yVel;
      this.hitObject = this.hitTestAll();
      if (this.hitObject) break;
    }
    this.doHitEffect();
    this.curDist = Math.round(getDist(this.ox, this.oy, this.x, this.y));
    const rMin = p(this.stats, 0) ? 0.2 : -0.2;
    const rMax = p(this.stats, 0) ? 0.5 : 0.2;
    this.linePath = [{ x: this.ox, y: this.oy, lift: UT.rand(rMin, rMax) }];
    for (let i = 0; i < this.curDist; i += 30) {
      this.linePath.push({
        x: this.ox + xMoveToRot(this.rotation, i),
        y: this.oy + yMoveToRot(this.rotation, i),
        lift: UT.rand(rMin, rMax),
      });
    }
    this.linePath.push({ x: this.x, y: this.y, lift: UT.rand(rMin, rMax) });
    this.draw(1);
  }

  private draw(alpha: number): void {
    const strokes = ((this.stats.params?.length ?? 0) - 1) / 3;
    const g = this.game.lineCont;
    for (let j = 0; j < strokes; j++) {
      g.lineStyle(
        p(this.stats, j * 3 + 1), p(this.stats, j * 3 + 2),
        p(this.stats, j * 3 + 3) * alpha,
      );
      for (let i = 0; i < this.linePath.length; i++) {
        if (i === 0) g.moveTo(this.linePath[i].x, this.linePath[i].y);
        else g.lineTo(this.linePath[i].x, this.linePath[i].y);
      }
    }
  }

  override EnterFrame(): void {
    this.alphaV -= 0.03;
    for (let i = 0; i < this.linePath.length; i++) this.linePath[i].y -= this.linePath[i].lift;
    this.draw(this.alphaV);
    if (this.alphaV <= 0) this.removeMe();
  }
}

export class Bullet_Line_Electric extends Bullet {
  private line1Path: LiftPt[] = [];
  private line2Path: LiftPt[] = [];
  private line3Path: LiftPt[] = [];
  private alphaV = 1;

  constructor(
    game: GameLike, unit: Unit, rotation: number, x: number, y: number,
    dist: number, gun: GunLike, extra: BulletExtra | null = null,
  ) {
    super(game, unit, rotation, x, y, dist, gun, false, extra);
    const steps = Math.trunc(this.maxDist / 10);
    for (let i = 0; i < steps; i++) {
      this.x += this.xVel;
      this.y += this.yVel;
      this.hitObject = this.hitTestAll();
      if (this.hitObject) break;
    }
    this.doHitEffect();
    this.curDist = Math.round(getDist(this.ox, this.oy, this.x, this.y));

    const build = (): LiftPt[] => {
      const path: LiftPt[] = [{ x: this.ox, y: this.oy, lift: UT.rand(-0.3, 0.3) }];
      for (let i = 0; i < this.curDist; i += 30) {
        path.push({
          x: this.ox + xMoveToRot(this.rotation, i),
          y: this.oy + yMoveToRot(this.rotation, i),
          lift: UT.rand(-0.3, 0.3),
        });
      }
      path.push({ x: this.x, y: this.y, lift: UT.rand(-0.3, 0.3) });
      return path;
    };
    this.line1Path = build();
    this.line2Path = build();
    this.line3Path = build();

    if (p(this.stats, 0)) {
      for (let i = 0; i < this.line1Path.length; i++) {
        this.line1Path[i].x += this.line1Path[i].lift * 10;
        this.line1Path[i].y += this.line1Path[i].lift * 10;
        this.line2Path[i].x += this.line2Path[i].lift * 10;
        this.line2Path[i].y += this.line2Path[i].lift * 10;
        this.line3Path[i].x += this.line2Path[i].lift * 10;
        this.line3Path[i].y += this.line2Path[i].lift * 10;
      }
    }

    const g = this.game.lineCont;
    this.stroke(g, this.line1Path, 1, 2, 3, this.alphaV, false);
    this.stroke(g, this.line2Path, 4, 5, 6, this.alphaV, false);
    this.stroke(g, this.line3Path, 4, 5, 6, this.alphaV, false);
  }

  private stroke(
    g: GameLike["lineCont"],
    path: LiftPt[],
    wi: number,
    ci: number,
    ai: number,
    alpha: number,
    drift: boolean,
  ): void {
    g.lineStyle(p(this.stats, wi), p(this.stats, ci), p(this.stats, ai) * alpha);
    for (let i = 0; i < path.length; i++) {
      if (drift) {
        path[i].x += path[i].lift;
        path[i].y += path[i].lift;
      }
      if (i === 0) g.moveTo(path[i].x, path[i].y);
      else g.lineTo(path[i].x, path[i].y);
    }
  }

  override EnterFrame(): void {
    this.alphaV -= 0.03;
    const g = this.game.lineCont;
    this.stroke(g, this.line1Path, 1, 2, 3, this.alphaV, true);
    this.stroke(g, this.line2Path, 4, 5, 6, this.alphaV, true);
    this.stroke(g, this.line3Path, 7, 8, 9, this.alphaV, true);
    if (this.alphaV <= 0) this.removeMe();
  }
}

export class Bullet_Line_Zapper extends Bullet {
  private alphaV = 1;
  private line1: Pt[] = [];
  private line2: Pt[] = [];
  private strength = 1.7;

  constructor(
    game: GameLike, unit: Unit, rotation: number, x: number, y: number,
    dist: number, gun: GunLike, extra: BulletExtra | null = null,
  ) {
    super(game, unit, rotation, x, y, dist, gun, false, extra);
    this.line1 = [{ x: this.ox, y: this.oy }];
    this.line2 = [{ x: this.ox, y: this.oy }];
    const steps = Math.trunc(this.maxDist / 10);
    for (let i = 0; i < steps; i++) {
      this.x += this.xVel;
      this.y += this.yVel;
      this.line1.push({ x: this.x + UT.rand(-1, 1), y: this.y + UT.rand(-1, 1) });
      this.line2.push({ x: this.x + UT.rand(-1, 1), y: this.y + UT.rand(-1, 1) });
      this.hitObject = this.hitTestAll();
      if (this.hitObject) break;
    }
    this.curDist = getDist(this.ox, this.oy, this.x, this.y);
    this.doHitEffect();
    if (!this.hitObject) {
      this.alphaV = 0.8;
      const len = this.line1.length;
      for (let i = 1; i < len; i++) {
        this.line1[i].x += UT.rand(i * -1, i * 1);
        this.line1[i].y += UT.rand(i * -1, i * 1);
        this.line2[i].x += UT.rand(i * -1, i * 1);
        this.line2[i].y += UT.rand(i * -1, i * 1);
      }
      this.strength = 1.7;
    } else {
      this.strength = ((this.maxDist - this.curDist) / this.maxDist + 0.1) * 5;
    }
  }

  override EnterFrame(): void {
    const g = this.game.lineCont;
    g.lineStyle(3 * this.strength, p(this.stats, 0), this.alphaV * 0.5);
    g.moveTo(this.line1[0].x, this.line1[0].y);
    for (let i = 1; i < this.line1.length; i++) {
      this.line1[i].x += UT.rand(-1, 1);
      this.line1[i].y += UT.rand(-1, 1);
      g.lineTo(this.line1[i].x, this.line1[i].y);
    }
    g.lineStyle(2 * this.strength, p(this.stats, 1), this.alphaV * 0.8);
    g.moveTo(this.line2[0].x, this.line2[0].y);
    for (let i = 1; i < this.line2.length; i++) {
      this.line2[i].x += UT.rand(-1, 1);
      this.line2[i].y += UT.rand(-1, 1);
      g.lineTo(this.line2[i].x, this.line2[i].y);
    }
    this.removeMe();
  }
}
