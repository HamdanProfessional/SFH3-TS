import { Bullet } from "./Bullet";
import type { BulletExtra } from "./Bullet";
import type { GameLike, GunLike } from "../types";
import type { Unit } from "../Unit";

export class Bullet_Melee_Basic extends Bullet {
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
    this.removeMe();
  }
}

export class Bullet_Splash extends Bullet {
  constructor(
    game: GameLike, unit: Unit, rotation: number, x: number, y: number,
    dist: number, gun: GunLike, extra: BulletExtra | null = null,
  ) {
    super(game, unit, rotation, x, y, dist, gun, true, extra);
    if (!Number(this.stats.params?.[0] ?? 0)) {
      this.hitType = "unit";
      this.hitObject = this.unit;
    }
    if (this.stats.effHit) this.game.createEffect(this.x, this.y, this.stats.effHit);
    this.checkSplash();
    this.removeMe();
  }
}
