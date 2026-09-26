import { getRotation } from "./Geom";
import type { Unit } from "./Unit";

export class Movement {
  private readonly unit: Unit;

  xVel = 0;
  xVelSlide = 0;
  readonly xAcc = 1.8;
  readonly xBrake = 1.7;
  readonly xCrouchBrake = 0.5;
  readonly xAirAcc = 1.4;
  readonly xAirBrake = 0.4;
  readonly xMax = 9.5;
  readonly xCrouchMax = 4;

  yVel = 0;
  readonly yGrav = 0.8;
  readonly yMax = 20;
  readonly yJump = 13;
  readonly yJumpBoost = 6;
  readonly yDjump = 10;

  manualJump = false;
  jumping = false;
  crouching = false;

  tiltL = 0;
  tiltR = 0;

  modSpeed = 1;
  modMax = 1;
  modBrake = 1;
  modJump = 1;
  modSlide = 0;
  modMove = 0;
  modGrav = 1;
  modMegaJump = false;
  dontStop = false;

  climb = 0;
  jumpClimb = false;
  climbSize = 0;

  falltimer = 0;
  landHard = false;
  noJump = false;
  parachute = false;

  constructor(unit: Unit) {
    this.unit = unit;
    if (this.unit) this.reset();
  }

  reset(): void {
    this.resetMods();
    this.manualJump = false;
    this.jumping = false;
    this.crouching = false;
    this.falltimer = 0;
    this.climb = 0;
    this.climbSize = 0;
    this.xVel = 0;
    this.yVel = 0;
    this.parachute = false;
    const extra = this.unit.unitInfo.extra;
    if (extra.parachute) {
      this.parachute = true;
      if (extra.paraOnce) extra.parachute = false;
    }
  }

  resetMods(): void {
    this.modMegaJump = false;
    this.modSpeed = 1;
    this.modMax = 1;
    this.modBrake = 1;
    this.modJump = 1;
    this.modGrav = 1;
    this.modSlide = 0;
    this.modMove = 0;
    this.dontStop = false;
  }

  doJump(climb = 0): void {
    if (!this.unit.game.gameStarted) return;
    if (this.crouching) return;
    if (this.climb) return;
    if (this.landHard) return;
    if (this.unit.status.sSpawn) return;

    if (this.unit.constAnim) {
      this.unit.game.createParticle(
        this.unit.x, this.unit.y - 120,
        "move", 0, { xspd: -50, yspd: 0 }, this.unit.constAnim, "animate",
      );
      this.unit.constAnim = "";
    }
    this.parachute = false;

    if (climb) {
      this.climb = climb;
      this.jumpClimb = this.jumping;
      if (this.climbSize === 1) this.yVel = -7;
      else if (this.climbSize === 2) this.yVel = -10;
      this.unit.MC.goto("climb" + (this.climbSize === 1 ? "small" : "big"));
    } else if (!this.jumping && !this.noJump) {
      this.unit.y -= this.yJumpBoost;
      this.yVel -= this.yJump * this.modJump;
      this.jumping = true;
      this.manualJump = true;
      this.unit.MC.goto("jump");
    }
  }

  EnterFrame(): void {
    const unit = this.unit;
    const keys = () => unit.keys;

    if (!unit.game.gameStarted || unit.status.sSpawn) unit.keys = 0;

    if (!this.jumping && keys() & unit.DOWN && !this.landHard) {
      this.crouching = true;
    } else if (this.crouching && (this.hitTest(-17, -45) || this.hitTest(17, -45))) {
      this.crouching = true;
    } else {
      this.crouching = false;
    }

    if (this.parachute) this.modGrav = 0.2;

    let back = "back";
    if (keys() & unit.LEFT && !this.landHard && !unit.status.sSpawn) {
      if (unit.human && unit.unitInfo.extra.noAim) {
        unit.aimX = unit.x - 200;
        unit.aimY = unit.y - 0;
        back = "";
      }
      if (this.crouching) {
        unit.nextAnim = unit.flip ? "duckrun" : "duckrun" + back;
        this.xVel += (this.jumping ? -this.xAirAcc : -this.xAcc) * this.modSpeed;
        if (this.xVel < -this.xCrouchMax * this.modMax) {
          this.xVel = -this.xCrouchMax * this.modMax;
        }
      } else {
        unit.nextAnim = (unit.flip ? "run" : "run" + back) + unit.unitInfo.runType;
        this.xVel += (this.jumping ? -this.xAirAcc : -this.xAcc) * this.modSpeed;
        if (this.xVel < -this.xMax * this.modMax) this.xVel = -this.xMax * this.modMax;
      }
    } else if (keys() & unit.RIGHT && !this.landHard && !unit.status.sSpawn) {
      if (unit.human && unit.unitInfo.extra.noAim) {
        unit.aimX = unit.x + 200;
        unit.aimY = unit.y - 0;
        back = "";
      }
      if (this.crouching) {
        unit.nextAnim = unit.flip ? "duckrun" + back : "duckrun";
        this.xVel += (this.jumping ? this.xAirAcc : this.xAcc) * this.modSpeed;
        if (this.xVel > this.xCrouchMax * this.modMax) {
          this.xVel = this.xCrouchMax * this.modMax;
        }
      } else {
        unit.nextAnim = (unit.flip ? "run" + back : "run") + unit.unitInfo.runType;
        this.xVel += (this.jumping ? this.xAirAcc : this.xAcc) * this.modSpeed;
        if (this.xVel > this.xMax * this.modMax) this.xVel = this.xMax * this.modMax;
      }
    } else {
      unit.nextAnim = "idle";
      const brake =
        (this.jumping ? this.xAirBrake : this.crouching ? this.xCrouchBrake : this.xBrake) *
        this.modBrake;
      if (this.xVel > brake) this.xVel -= brake;
      if (this.xVel < -brake) this.xVel += brake;
      if (this.xVel > -brake - 0.1 && this.xVel < brake + 0.1) this.xVel = 0;
    }

    if (this.climb === 1) this.xVel = 5;
    else if (this.climb === -1) this.xVel = -5;

    unit.x += this.xVel;
    unit.x += this.modMove;

    if (!this.modSlide) this.xVel += this.xVelSlide;
    this.xVelSlide = Math.round(unit.MC.rotation) * this.modSlide;
    if (this.xVelSlide > 0) this.xVelSlide -= 0.05;
    if (this.xVelSlide < 0) this.xVelSlide += 0.05;
    if (this.xVelSlide > -0.1 && this.xVelSlide < 0.1) this.xVelSlide = 0;
    unit.x += this.xVelSlide;

    unit.y += this.yVel;

    if (this.climb && this.jumpClimb) {
      while (this.hitTest(this.climb * 5, 14) && !this.hitTest(this.climb * 5, -1)) {
        unit.y += 0.5;
      }
    } else if (this.climb) {
      while (this.hitTest(0, 6) && !this.hitTest(0, -1)) unit.y += 0.5;
    } else {
      while (this.hitTest(0, 8) && !this.hitTest(0, -1)) unit.y += 0.5;
    }

    if (this.hitTest(0, 1)) {
      if (this.falltimer >= 1.3 * 30) {
        if (unit.human) unit.game.arena.setShake(4, 8);
        this.landHard = true;
      }
      if (this.yVel > 0) {
        if (keys() & unit.LEFT) {
          unit.nextAnim = (unit.flip ? "landrun" : "landrunback") + unit.unitInfo.runType;
        } else if (keys() & unit.RIGHT) {
          unit.nextAnim = (unit.flip ? "landrunback" : "landrun") + unit.unitInfo.runType;
        } else {
          unit.nextAnim = "land";
        }
      }
      this.manualJump = false;
      this.jumping = false;
      this.yVel = 0;
      this.falltimer = 0;
      if (unit.constAnim) {
        unit.game.createParticle(
          unit.x, unit.y - 120,
          "move", 0, { xspd: -50, yspd: 0 }, unit.constAnim, "animate",
        );
        unit.constAnim = "";
      }
      this.parachute = false;
    } else {
      if (this.yVel > 0) ++this.falltimer;
      unit.nextAnim = "fall";
      this.jumping = true;
      this.yVel += this.yGrav * this.modGrav;
      if (this.yVel > this.yMax * this.modGrav) this.yVel = this.yMax * this.modGrav;
    }

    while (this.hitTest(0, -50)) {
      ++unit.y;
      if (this.yVel < 0) this.yVel = 0;
    }

    let climbRight = false;
    if (keys() & unit.RIGHT && this.hitTest(17, -40) && !this.hitTest(17, -55)) {
      this.climbSize = 2;
      climbRight = true;
    } else if (keys() & unit.RIGHT && this.hitTest(17, -20) && !this.hitTest(17, -55)) {
      this.climbSize = 1;
      climbRight = true;
    }
    if (this.crouching) {
      while (this.hitTest(17, -20) || this.hitTest(17, -25) || this.hitTest(17, -35)) {
        --unit.x;
      }
    } else {
      while (
        this.hitTest(17, -20) || this.hitTest(17, -25) ||
        this.hitTest(17, -35) || this.hitTest(17, -45)
      ) {
        --unit.x;
      }
    }

    let climbLeft = false;
    if (keys() & unit.LEFT && this.hitTest(-17, -40) && !this.hitTest(-17, -55)) {
      this.climbSize = 2;
      climbLeft = true;
    } else if (keys() & unit.LEFT && this.hitTest(-17, -20) && !this.hitTest(-17, -55)) {
      this.climbSize = 1;
      climbLeft = true;
    }
    if (this.crouching) {
      while (this.hitTest(-17, -20) || this.hitTest(-17, -25) || this.hitTest(-17, -35)) {
        ++unit.x;
      }
    } else {
      while (
        this.hitTest(-17, -20) || this.hitTest(-17, -25) ||
        this.hitTest(-17, -35) || this.hitTest(-17, -45)
      ) {
        ++unit.x;
      }
    }

    while (this.hitTest(0, 0)) unit.y -= 0.5;

    if (climbRight) this.doJump(1);
    if (climbLeft) this.doJump(-1);

    if (unit.canRotate) {
      let rotTo: number;
      if (!this.jumping) {
        this.tiltL = this.tiltR = -10;
        let i = 0;
        while (i < 30 && !this.hitTest(-10, this.tiltL)) {
          i++;
          ++this.tiltL;
        }
        i = 0;
        while (i < 30 && !this.hitTest(10, this.tiltR)) {
          i++;
          ++this.tiltR;
        }
        if (this.tiltL < 20 && this.tiltR < 20) {
          rotTo = getRotation(-10, this.tiltL, 10, this.tiltR) - 90;
        } else {
          rotTo = 0;
        }
      } else {
        rotTo = 0;
      }
      unit.MC.rotation += (rotTo - unit.MC.rotation) * 0.3;
    } else {
      unit.MC.rotation = 0;
    }

    if (this.crouching && !(keys() & unit.LEFT) && !(keys() & unit.RIGHT)) {
      unit.nextAnim = "duck";
    }
    if (this.landHard) unit.nextAnim = "landhard";
  }

  hitTest(offX = 0, offY = 0): number {
    const pixel = this.unit.game.arena.wall.getPixel32(this.unit.x + offX, this.unit.y + offY);
    if (!pixel) return pixel;
    const hex = (pixel >>> 0).toString(16);
    return hex.substring(0, 2) === "ff" && hex.substring(2).indexOf("00000") === -1
      ? pixel
      : 0;
  }
}
