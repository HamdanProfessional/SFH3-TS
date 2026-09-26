import { UT } from "../../core/UT";
import { SD } from "../../state/SD";
import { combatHooks } from "../combatHooks";
import {
  getDist, getPosNegSign, getRotation, inBox, rotBounceOff, xMoveToRot, yMoveToRot,
} from "../Geom";
import type { CorpseLike, GameLike, GunLike, HitExtra, KillstreakLike } from "../types";
import type { Unit } from "../Unit";

export type HitType = "" | "wall" | "unit" | "corpse" | "killstreak";
export type HitObject = string | Unit | CorpseLike | KillstreakLike | null;

export interface BulletExtra extends HitExtra {
  dmgMod?: number;
  range?: number;
  noMove?: boolean;
  noUnit?: boolean;
  reflect?: Unit | null;
  hitX?: number;
  hitY?: number;
  corpseStick?: boolean;
  bounce?: number;
  splashDirect?: boolean;
  splashIndirect?: boolean;
  assassin?: number;
  shielded?: boolean;
  burrowMult?: number;
}

export type BulletCtor = new (
  game: GameLike,
  unit: Unit,
  rotation: number,
  x: number,
  y: number,
  dist: number,
  gun: GunLike,
  extra?: BulletExtra | null,
) => Bullet;

export const BULLET_CLASSES: Record<string, BulletCtor> = {};

export class Bullet {
  protected readonly game: GameLike;
  protected readonly unit: Unit;
  protected stats: GunLike;
  remove = false;

  protected rotation = 0;
  x = 0;
  y = 0;
  protected ox = 0;
  protected oy = 0;
  protected xVel = 0;
  protected yVel = 0;

  private readonly isProjectile: boolean;
  protected hitType: HitType = "";
  protected hitObject: HitObject = null;
  protected curDist = 0;
  protected maxDist = 0;
  protected dmgMod = 1;
  protected extra: BulletExtra;

  constructor(
    game: GameLike,
    unit: Unit,
    rotation: number,
    x: number,
    y: number,
    dist: number,
    gun: GunLike,
    isProjectile: boolean,
    extra: BulletExtra | null = null,
  ) {
    this.game = game;
    this.unit = unit;
    this.extra = extra ?? {};
    this.dmgMod = this.extra.dmgMod ? Number(this.extra.dmgMod) : 1;
    this.stats = gun;
    this.isProjectile = isProjectile;
    this.curDist = 0;
    this.maxDist = (this.extra.range ? this.extra.range : this.stats.range) + UT.irand(-3, 3);
    this.maxDist *= 10;

    if (this.extra.noMove) {
      this.xVel = 0;
      this.yVel = 0;
    } else {
      this.rotation = rotation;
      if (!this.extra.noUnit) {
        const perp = this.rotation + 90 * (this.unit.flip ? -1 : 1);
        const off = this.stats.yOff * this.unit.scale;
        this.x = x + xMoveToRot(perp, off);
        this.y = y + yMoveToRot(perp, off);
      } else {
        this.x = x;
        this.y = y;
      }
      this.xVel = xMoveToRot(this.rotation, 10);
      this.yVel = yMoveToRot(this.rotation, 10);
      for (let i = 0; i <= dist; i++) {
        this.x += this.xVel * 0.5;
        this.y += this.yVel * 0.5;
        this.hitObject = this.hitTestAll();
        if (this.hitObject) break;
      }
    }
    this.ox = this.x;
    this.oy = this.y;
    if (this.stats.effShoot) this.game.createEffect(this.ox, this.oy, this.stats.effShoot);
  }

  EnterFrame(): void {}

  protected doHitEffect(force = false): void {
    if (!this.hitType) {
      if (!force) return;
      this.hitType = "wall";
    }

    const bounceShots = this.stats.extra.bounceShots;
    if (this.hitType && bounceShots) {
      if (this.hitType === "unit") {
        (this.hitObject as Unit).status.damage(
          this.stats.dmg * this.dmgMod, this.unit, this.stats, this.extra,
        );
      }
      this.x -= this.xVel * 3;
      this.y -= this.yVel * 3;
      for (let i = 0; i < Number(bounceShots); i++) {
        const Ctor = BULLET_CLASSES["Bullet_Proj_Bounce"];
        const rec = bouncerRecord();
        if (Ctor && rec) {
          this.game.addBullet(
            new Ctor(this.game, this.unit, UT.rand(0, 360), this.x, this.y, 0, rec),
          );
        }
      }
      if (this.isProjectile) this.removeMe();
      return;
    }

    if (this.hitType === "unit") {
      const victim = this.hitObject as Unit;
      if (
        !this.stats.isMelee &&
        (victim.status.sReflect ||
          (victim.unitInfo.skills.deflect &&
            Math.random() < victim.unitInfo.skills.deflect))
      ) {
        const rotDiff =
          victim.aimRoation - getRotation(victim.x, victim.y, this.x, this.y);
        if (Math.abs(rotDiff) < 100) {
          if (this.extra.reflect) return;
          const rot = rotBounceOff(
            this.rotation,
            this.x - this.xVel * 10, this.y - this.yVel * 10,
            victim.x, victim.y - 10,
          );
          const Ctor = this.stats.cls ? BULLET_CLASSES[this.stats.cls] : undefined;
          if (Ctor) {
            this.game.addBullet(
              new Ctor(
                this.game, victim, rot + UT.rand(-10, 10),
                this.x, this.y, 0, this.stats, { reflect: this.unit },
              ),
            );
          }
          if (this.isProjectile) this.removeMe();
          this.game.playScreenSound(
            UT.randEl(["S_Reflect1", "S_Reflect2", "S_Reflect3"]), this.x, this.y,
          );
          this.game.createEffect(this.x, this.y, "bulletspark");
        }
      }
      if (!victim.status.sSpawn && !this.stats.noBlood) {
        if (this.extra.shielded || victim.status.arCur) {
          this.game.createEffect(this.x, this.y, "bulletspark");
        } else if (SD.options.blood) {
          this.game.createEffect(this.x, this.y, "bloodmist");
        }
      }
      if (this.isProjectile) {
        this.x -= this.xVel;
        this.y -= this.yVel;
        if (!this.stats.extra.pierce) this.removeMe();
      } else {
        this.x -= this.xVel * 0.5;
        this.y -= this.yVel * 0.5;
      }
      if (this.stats.effHit) this.game.createEffect(this.x, this.y, this.stats.effHit);
      if (this.stats.splash) {
        this.extra.hitX = this.x;
        this.extra.hitY = this.y;
      }
      victim.status.damage(
        this.stats.dmg * this.dmgMod, this.unit, this.stats, this.extra,
      );
    }

    if (this.hitType === "corpse") {
      if (SD.options.blood) this.game.createEffect(this.x, this.y, "bloodmist");
      if (this.isProjectile) {
        this.x -= this.xVel;
        this.y -= this.yVel;
        if (!this.stats.extra.pierce) this.removeMe();
      }
      if (this.stats.effHit) this.game.createEffect(this.x, this.y, this.stats.effHit);
      if (this.stats.splash) {
        this.extra.hitX = this.x;
        this.extra.hitY = this.y;
      }
      this.game.physWorld.hitCorpse(
        this.hitObject as CorpseLike, this.unit, this.stats, this.extra,
      );
    }

    if (this.hitType === "wall") {
      if (this.isProjectile) {
        this.x -= this.xVel;
        this.y -= this.yVel;
        if (!this.stats.extra.burrow) {
          this.removeMe();
        } else {
          this.extra.burrowMult = 2;
          this.yVel -= Number(this.stats.params?.[2] ?? 0) * 0.1;
        }
      }
      if (!this.stats.extra.burrow) {
        if (this.stats.effHit) this.game.createEffect(this.x, this.y, this.stats.effHit);
      } else {
        this.game.createEffect(this.x, this.y, "mud_splash");
      }
      switch (this.hitObject as string) {
        case "":
        case "ff0000":
        case "00ffff":
        case "670067":
        case "6699ff":
          break;
        case "ffff20":
          if (this.unit.human && Math.random() < this.stats.fire) {
            achievement("secret3");
          }
          break;
        case "993300":
          if (SD.options.graphPart) this.game.createEffect(this.x, this.y, "mud_splash");
          break;
        case "ffffff":
          if (SD.options.graphPart) this.game.createEffect(this.x, this.y, "snowSplash");
          break;
        case "006600":
          this.game.createEffect(this.x, this.y, "leaf_splash");
          for (let i = 0; i < SD.options.graphPart; i++) {
            this.game.createParticle(
              this.x + UT.rand(-10, 10), this.y,
              "leaf", 0, null, "leaves", "leaf" + UT.irand(1, 4),
            );
          }
          break;
        default:
          break;
      }
    }

    if (this.hitType === "killstreak") {
      const ks = this.hitObject as KillstreakLike;
      this.game.createEffect(this.x, this.y, "bulletspark");
      if (this.isProjectile) {
        this.x -= this.xVel;
        this.y -= this.yVel;
        if (!this.stats.extra.pierce) this.removeMe();
      } else {
        this.x -= this.xVel * 0.5;
        this.y -= this.yVel * 0.5;
      }
      if (this.stats.effHit) this.game.createEffect(this.x, this.y, this.stats.effHit);
      if (this.stats.splash) {
        this.extra.hitX = this.x;
        this.extra.hitY = this.y;
      }
      ks.damage(this.stats.dmg * this.dmgMod, this.unit, this.stats, this.extra);
    }

    if (this.stats.hitSound) {
      this.game.playScreenSound(this.stats.hitSound, this.x, this.y);
    }
    this.checkSplash();
  }

  protected hitTestAll(offX = 0, offY = 0, physObject = false): HitObject {
    const pixel = this.game.arena.wall.getPixel32(this.x + offX, this.y + offY);
    if (!this.unit.status.sWallhack && !physObject && pixel) {
      const hex = (pixel >>> 0).toString(16);
      if (hex.substring(0, 2) === "ff") {
        this.hitType = "wall";
        return hex.substring(2);
      }
    }

    for (let i = 0; i < this.game.units.length; i++) {
      const u = this.game.units[i];
      if (u === this.unit) continue;
      if (u.dead) continue;
      if (this.unit.team && this.unit.team === u.team) continue;

      const unitXl = u.x - 13 * u.scale;
      const unitXr = 26 * u.scale;
      const unitHead = (u.mov.crouching ? 50 : 78) * u.scale;
      const unitNeck = (u.mov.crouching ? 38 : 64) * u.scale;

      if (!inBox(this.x, this.y, unitXl, u.y - unitHead, unitXr, unitHead)) continue;
      const body = inBox(this.x, this.y, unitXl, u.y - unitNeck, unitXr, unitNeck);
      if (!body) {
        if (getPosNegSign(this.unit.x - u.x) !== (u.flip ? -1 : 1) * u.scale) {
          this.extra.assassin = 1.5;
        }
        this.extra.headMult = 1.5;
      }
      this.hitType = "unit";
      if (this.stats.splash >= 80) this.extra.splashDirect = true;
      return u;
    }

    const actors = this.game.physWorld.actors;
    for (let i = 0; i < actors.length; i++) {
      if (getDist(this.x, this.y, actors[i].x, actors[i].y) < 30) {
        this.hitType = "corpse";
        return actors[i];
      }
    }

    for (let i = 0; i < this.game.killstreaks.length; i++) {
      const ks = this.game.killstreaks[i];
      if (!ks.shootable) continue;
      if (ks.unit === this.unit) continue;
      if (this.unit.team && ks.unit.team === this.unit.team) continue;
      if (inBox(this.x, this.y, ks.x - 15, ks.y - 55, 30, 55)) {
        this.hitType = "killstreak";
        return ks;
      }
    }

    this.hitType = "";
    return null;
  }

  protected hitTestWall(offX = 0, offY = 0): boolean {
    const pixel = this.game.arena.wall.getPixel32(this.x + offX, this.y + offY);
    if (!pixel) return false;
    const hex = (pixel >>> 0).toString(16);
    return hex.substring(0, 2) === "ff" && hex.substring(2).indexOf("00000") === -1;
  }

  protected checkSplash(): void {
    if (!this.stats.splash) return;
    const splashSize = this.stats.splash;
    for (let i = 0; i < this.game.units.length; i++) {
      const u = this.game.units[i];
      if (u.dead) continue;
      if (this.hitType === "unit" && this.hitObject === u) continue;
      if (getDist(this.x, this.y, u.x, u.y - 45) >= splashSize) continue;
      this.cleanExtra();
      const rot = getRotation(this.x, this.y, u.x, u.y - 45);
      const pixel = this.game.arena.wall.getPixel32(
        this.x + xMoveToRot(rot, 10), this.y + yMoveToRot(rot, 10),
      );
      const blocked = pixel !== 0 && (pixel >>> 0).toString(16).substring(0, 2) === "ff";
      if (blocked) continue;
      if (this.stats.splash && this.stats.splash < 80) this.extra.splashIndirect = true;
      this.extra.hitX = this.x;
      this.extra.hitY = this.y;
      this.extra.splashMult = this.stats.splashMult;
      u.status.damage(this.stats.dmg, this.unit, this.stats, this.extra);
    }
  }

  protected removeMe(): void {
    this.remove = true;
  }

  protected cleanExtra(): void {
    this.extra = { corpseStick: this.extra.corpseStick, reflect: this.extra.reflect };
  }
}

const achievement = (id: string): void => combatHooks.bullet(id);
export function setBulletAchievementHook(fn: (id: string) => void): void {
  combatHooks.bullet = fn;
}

let bouncerRecord: () => GunLike | undefined = () => undefined;
export function setBouncerRecordLookup(fn: () => GunLike | undefined): void {
  bouncerRecord = fn;
}
