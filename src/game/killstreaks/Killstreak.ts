import * as Classes from "../../data/StatsClasses";
import type { GunStats } from "../../data/StatsGuns";
import { GunInfo } from "../GunInfo";
import type { GameLike, GunLike, HitExtra, KillstreakLike } from "../types";
import type { Unit } from "../Unit";

export interface HpBar {
  min: number;
  max: number;
  cur: number;
}

export class Killstreak implements KillstreakLike {
  protected readonly game: GameLike;
  readonly unit: Unit;

  x: number;
  y: number;
  shootable: boolean;
  readonly gun: GunStats;
  target: Unit | null = null;
  fc = 0;
  protected shootTimer = 0;
  protected timer: number;
  readonly dead = null;
  hpCur = 0;
  hpMax = 0;
  hpBarDist = 0;
  readonly healthBar: HpBar = { min: 0, max: 0, cur: 0 };
  healthColor = 0xffffff;
  ownerName = "";
  ownerLevel = 1;

  constructor(
    game: GameLike, unit: Unit, timer: number, gunName: string, shootable: boolean,
  ) {
    this.game = game;
    this.unit = unit;
    this.x = 0;
    this.y = 0;
    this.timer = timer;
    if (unit.unitInfo.skills.turret2) this.timer *= unit.unitInfo.skills.turret2;
    this.shootable = shootable;
    this.gun = new GunInfo(gunName, unit.unitInfo.level, 0).stats;
  }

  setText(): void {
    if (!this.shootable) return;
    this.ownerName = this.unit.name;
    this.ownerLevel = this.unit.unitInfo.level;
    this.healthColor = this.unit.status.healthColor;
    this.hpMax = Classes.getStat(this.unit.unitInfo.level, "jug", "health");
    if (this.unit.unitInfo.skills.turret2) this.hpMax *= this.unit.unitInfo.skills.turret2;
    this.hpCur = this.hpMax;
    this.healthBar.min = 0;
    this.healthBar.max = 35 + this.hpMax * 0.05;
    this.healthBar.cur = this.healthBar.max;
    this.hpBarDist = this.hpMax / 25;
    this.hpBarDist = this.healthBar.max / this.hpBarDist;
    this.setBars();
  }

  damage(
    _amt: number, _shooter: Unit, _weapon: GunLike, _extra: HitExtra, _forceDmg = false,
  ): void {
    if (!this.shootable) return;
    this.hpCur -= _amt;
    if (this.hpCur <= 0) {
      this.hpCur = 0;
      this.end(true);
    }
    this.setBars();
  }

  setBars(): void {
    this.healthBar.cur = (this.hpCur / this.hpMax) * this.healthBar.max;
  }

  end(_forceEnd = true): void {
    if (_forceEnd) this.unit.endKillstreak();
    const i = this.game.killstreaks.indexOf(this);
    if (i >= 0) this.game.killstreaks.splice(i, 1);
  }

  protected hitTestWall(offX = 0, offY = 0): boolean {
    const pixel = this.game.arena.wall.getPixel32(this.x + offX, this.y + offY);
    return !!pixel && (pixel >>> 0).toString(16).substring(0, 2) === "ff";
  }

  EnterFrame(): void {
  }
}
