import { UT } from "../../core/UT";
import { getDist, getRotation, rotateDirection, xMoveToRot, yMoveToRot } from "../Geom";
import { makeBullet } from "../bullets";
import { Killstreak } from "./Killstreak";
import type { GameLike, KillstreakLike } from "../types";
import type { Unit } from "../Unit";

export type KillstreakTurretKind = "turret" | "sentry";

export const TURRET_KINDS: Readonly<Record<KillstreakTurretKind, {
  readonly idleFrame: number;
  readonly headFrom: number;
  readonly headY: number;
  readonly headFrames: number;
  readonly deployFrame: number;
}>> = {
  turret: { idleFrame: 33, headFrom: 32, headY: -46.8, headFrames: 7, deployFrame: 2 },
  sentry: { idleFrame: 33, headFrom: 33, headY: -53.3, headFrames: 7, deployFrame: 2 },
};

const FRAME_END = 70;

export class Killstreak_Turret extends Killstreak implements KillstreakLike {
  readonly kind: KillstreakTurretKind;
  rot = 0;

  frame: number;
  playing: boolean;
  headFrame = 1;
  headPlaying = false;

  active = false;
  private yVel = 0;

  laserX: number;
  laserY: number;

  constructor(
    game: GameLike, unit: Unit, timer: number, id: KillstreakTurretKind,
  ) {
    super(game, unit, timer, id, true);
    if (unit.unitInfo.extra.permaStreak) this.timer = 9999999;
    this.kind = id;
    this.x = unit.x;
    this.y = unit.y;
    this.setText();
    this.shootTimer = UT.irand(0, 25);
    this.laserX = this.x;
    this.laserY = this.y - 40;
    this.playing = id === "sentry";
    this.frame = 1;
  }

  override EnterFrame(): void {
    if (!this.active) {
      this.yVel += 1;
      if (this.yVel > 25) this.yVel = 25;
      this.y += this.yVel;
      if (this.hitTestWall(0, 2)) {
        while (this.hitTestWall(0, 2)) this.y -= 1;
        this.active = true;
        this.gotoAndPlay(TURRET_KINDS[this.kind].deployFrame);
        this.game.playScreenSound("S_Deploy", this.x, this.y);
        return;
      }
      this.tickFrame();
      return;
    }

    this.tickFrame();
    ++this.fc;
    if (this.fc < 33) return;
    ++this.shootTimer;

    if (this.fc % 20 === 0) this.acquireTarget();
    this.slewAndLaser();

    let rps = this.gun.shootDelay;
    const turret1 = this.unit.unitInfo.skills.turret1;
    if (turret1) rps *= turret1;
    if (this.target && this.shootTimer > rps) this.fire();

    if (this.unit.dead || this.fc >= this.timer) this.end();
  }

  private acquireTarget(): void {
    const candidates: { dist: number; unit: Unit; rot: number }[] = [];
    for (let i = 0; i < this.game.units.length; i++) {
      const u = this.game.units[i];
      if (u === this.unit) continue;
      if (u.dead) continue;
      if (this.unit.team && this.unit.team === u.team) continue;
      if (u.status.sInvis === 1) continue;
      if (u.status.sSpawn) continue;
      const dist = getDist(this.x, this.y, u.x, u.y);
      if (dist < this.gun.range * 10) {
        candidates.push({ dist, unit: u, rot: getRotation(this.x, this.y, u.x, u.y) });
      }
    }
    for (let i = 0; i < candidates.length; i++) {
      let canHit = true;
      for (let d = 0; canHit && d < candidates[i].dist; d += 20) {
        if (this.hitTestWall(
          xMoveToRot(candidates[i].rot, d), yMoveToRot(candidates[i].rot, d) - 40,
        )) {
          canHit = false;
        }
      }
      if (!canHit) {
        candidates.splice(i, 1);
        i--;
      }
    }
    if (candidates.length) {
      candidates.sort((a, b) => a.dist - b.dist);
      this.target = candidates[0].unit;
    } else {
      this.target = null;
      this.laserX = this.x;
      this.laserY = this.y - 40;
    }
  }

  private slewAndLaser(): void {
    if (this.target) {
      this.laserX += (this.target.x - this.laserX) * 0.5;
      this.laserY += (this.target.y - 40 - this.laserY) * 0.5;
      this.game.lineCont.lineStyle(1, 0xff0000, 0.5);
      this.game.lineCont.moveTo(this.x, this.y - 40);
      this.game.lineCont.lineTo(this.laserX, this.laserY);
      const rotTo = getRotation(this.x, this.y - 40, this.target.x, this.target.y - 35);
      if (Math.abs(this.rot - rotTo) > 5) {
        this.rot += rotateDirection(this.rot, rotTo) * 6;
      } else {
        this.rot = rotTo;
      }
      if (this.target.dead || getDist(this.x, this.y, this.target.x, this.target.y) > this.gun.range * 10) {
        this.target = null;
      }
    } else {
      this.laserX += (this.x - this.laserX) * 0.7;
      this.laserY += (this.y - 40 - this.laserY) * 0.7;
    }
  }

  private fire(): void {
    this.shootTimer = 0;
    this.game.playScreenSound(this.gun.shotSound ?? "", this.x, this.y);
    const shots = this.gun.multiShots || 1;
    for (let i = 0; i < shots; i++) {
      const b = makeBullet(
        this.game, this.unit, this.rot + UT.rand(-5, 5),
        this.x, this.y - 40, 5, this.gun, { noUnit: true },
      );
      if (b) this.game.addBullet(b);
    }
    this.headFrame = 2;
    this.headPlaying = true;
    this.game.createParticle(
      this.x, this.y + TURRET_KINDS[this.kind].headY, "shell", 0,
      { rot: this.rot - 90, flip: 0 }, "shell", String(this.gun.effShell),
    );
  }

  override end(_forceEnd = true): void {
    super.end(_forceEnd);
    this.game.createEffect(this.x, this.y - 20, "explosionSmall");
    this.game.playScreenSound("S_rocketExplode", this.x, this.y);
  }

  private tickFrame(): void {
    const K = TURRET_KINDS[this.kind];
    if (this.playing) {
      ++this.frame;
      if (this.frame >= FRAME_END) this.frame = K.idleFrame;
    }
    if (this.headPlaying) {
      ++this.headFrame;
      if (this.headFrame > K.headFrames) {
        this.headFrame = 1;
        this.headPlaying = false;
      }
    }
  }

  private gotoAndPlay(frame: number): void {
    this.frame = frame;
    this.playing = true;
  }
}
