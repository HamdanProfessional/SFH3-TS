import { UT } from "../../core/UT";
import { xMoveToRot, yMoveToRot } from "../Geom";
import { FxArt } from "../../assets/FxArt";
import type { Fx } from "./Fx";

export type ParticleExtra = Record<string, number>;

export class Particle {
  remove = false;

  private readonly behave: string;
  private readonly name: string;
  private readonly sub: string;
  private x: number;
  private y: number;
  private hitFrame: number;
  private readonly frames: number;
  private frame: number;
  private holdFrame = false;
  private xSpd = 0;
  private ySpd = 0;
  private xVel = 0;
  private yVel = 0;
  private readonly extra: ParticleExtra;
  private hitCount = 0;
  private rotation = 0;
  private fc = 0;

  constructor(
    private readonly fx: Fx,
    x: number,
    y: number,
    behave: string,
    hitFrame: number,
    extra: ParticleExtra | null,
    name: string,
    sub: string,
    frame: number,
  ) {
    this.x = x;
    this.y = y;
    this.behave = behave;
    this.hitFrame = hitFrame;
    this.name = name;
    this.sub = sub;
    this.extra = extra ?? {};
    const def = FxArt.def(name);
    const rotAmt = def?.rotAmt ?? 1;
    this.name += UT.irand(0, rotAmt - 1);
    this.frames = FxArt.subFrames(name, sub);
    if (frame) {
      this.frame = frame;
      this.holdFrame = true;
    } else {
      this.frame = 1;
    }

    switch (behave) {
      case "loop":
        break;
      case "fairy":
        this.extra.rot1 = Math.random() * 360;
        this.extra.rot2 = Math.random() * 360;
        break;
      case "space":
        this.extra.rot1 = Math.random() * 360;
        this.extra.rot2 = Math.random() * 360;
        break;
      case "waterdrop":
        this.holdFrame = true;
        this.xSpd = UT.rand(-1, 1);
        this.ySpd = UT.rand(0, 1);
        break;
      case "water":
        this.xSpd = UT.rand(this.extra.min, this.extra.max);
        this.ySpd = UT.rand(-1, 3);
        break;
      case "snow":
        this.xSpd = UT.rand(0, 1);
        this.ySpd = UT.rand(3, 5);
        break;
      case "rain":
        this.holdFrame = true;
        this.xSpd = UT.rand(0, 1);
        this.ySpd = UT.rand(30, 38);
        break;
      case "shell":
        this.xSpd = xMoveToRot(
          this.extra.rot - 110 * this.extra.flip + UT.rand(-15, 15), 8,
        );
        this.ySpd = yMoveToRot(
          this.extra.rot - 110 * this.extra.flip + UT.rand(-15, 15), 8,
        );
        break;
      case "spark":
        this.xSpd = UT.rand(-2, 2);
        this.ySpd = UT.rand(-1, 3);
        if (this.extra.xSpd) this.xSpd = this.extra.xSpd;
        if (this.extra.ySpd) this.ySpd = this.extra.ySpd;
        break;
      case "geiser":
        this.xSpd = UT.rand(-2, 2);
        this.ySpd = UT.rand(-1, 0);
        if (this.extra.xSpd) this.xSpd = this.extra.xSpd;
        if (this.extra.ySpd) this.ySpd = this.extra.ySpd;
        break;
      case "leaf":
        this.hitFrame = 10;
        this.xSpd = UT.rand(0, 1);
        this.ySpd = UT.rand(0.5, 3);
        this.rotation = Math.random() * 360;
        break;
      case "raise":
        this.ySpd = UT.rand(1, 3) * this.extra.ySpd;
        this.xSpd = this.ySpd * this.extra.xSpd ? Number(this.extra.xSpd) : 0;
        break;
      case "move":
        this.ySpd = this.extra.ySpd;
        this.xSpd = this.extra.xSpd;
        break;
      case "fish":
        this.extra.rot1 = Math.random() * 360;
        this.extra.rot2 = Math.random() * 360;
        break;
      case "text":
        this.ySpd = -1;
        this.yVel = 20;
        this.holdFrame = true;
        this.frame = 1;
        break;
      case "slowText":
        this.ySpd = -0.7;
        this.yVel = 35;
    }
  }

  enterFrame(): void {
    if (this.fx.destroyed) return;
    if (this.remove) return;
    ++this.fc;
    switch (this.behave) {
      case "fairy":
        this.extra.rot1 += 1;
        this.extra.rot2 += 2;
        this.x += xMoveToRot(this.extra.rot1, 1);
        this.y += yMoveToRot(this.extra.rot2, 0.6);
        this.paint();
        break;
      case "space":
        this.extra.rot1 += 0.3;
        this.extra.rot2 += 0.6;
        this.x += xMoveToRot(this.extra.rot1, 1);
        this.y += yMoveToRot(this.extra.rot2, 0.6);
        this.paint();
        break;
      case "waterdrop":
        this.x += this.xSpd;
        this.y += this.ySpd;
        this.ySpd += 0.5;
        if (!this.hitCount && (this.hitTest() || this.hitTestPlayer())) {
          this.y -= this.ySpd;
          this.ySpd = 0;
          this.hitCount = 1;
        }
        this.paint();
        if (this.hitCount) {
          ++this.frame;
          if (this.frame === this.frames) this.remove = true;
        }
        break;
      case "water":
        this.x += this.xSpd;
        this.y += this.ySpd;
        this.ySpd += 0.5;
        if (!this.hitCount) {
          if (this.fc >= this.hitFrame && this.hitTest()) this.hitCount = 1;
          for (const u of this.fx.units) {
            if (!u.dead && UT.inBox(this.x, this.y, u.x - 25, u.y - 70, 50, 50)) {
              this.hitCount = 1;
            }
          }
        }
        if (this.hitCount === 1) {
          this.xSpd *= 3;
          this.y -= this.ySpd;
          this.ySpd *= -UT.rand(0.2, 0.5);
          this.hitCount = 1;
        }
        if (this.hitCount) {
          ++this.hitCount;
          if (this.hitCount === 20) this.remove = true;
          this.paint(Math.trunc(this.hitCount / 10) + 2);
        } else {
          this.paint(1);
        }
        break;
      case "snow":
        this.x += this.xSpd;
        this.y += this.ySpd;
        if (this.fc % 3 === 0 && this.hitTest()) {
          this.remove = true;
          this.fx.createEffect(this.x, this.y, "snowSplash");
        }
        this.paint();
        break;
      case "rain":
        this.x += this.xSpd;
        this.y += this.ySpd;
        this.ySpd += 0.5;
        if (!this.hitCount && (this.hitTest() || this.hitTestPlayer())) {
          this.y -= this.ySpd;
          this.ySpd = 0;
          this.hitCount = 1;
        }
        this.paint();
        if (this.hitCount) {
          ++this.frame;
          if (this.frame === this.frames) this.remove = true;
        }
        break;
      case "leaf":
        if (this.hitCount) {
          ++this.hitCount;
          if (this.hitCount > 60) {
            this.frame = Math.trunc((this.hitCount - 60) / 10) + 4;
            if (this.hitCount >= 90) this.remove = true;
          }
        } else {
          this.rotation += 5;
          this.x += xMoveToRot(this.rotation, 2);
          this.x += this.xSpd;
          this.y += this.ySpd;
          if (this.fc % 3 === 0 && this.hitTest()) this.hitCount = 1;
        }
        this.paint();
        break;
      case "loop":
        this.paint();
        break;
      case "shell":
        this.x += this.xSpd;
        this.y += this.ySpd;
        this.ySpd += 1;
        if (!this.hitCount) {
          if (this.hitTest()) {
            this.hitCount = 1;
            this.xSpd *= 0.6;
            this.ySpd *= -0.3;
            this.ySpd -= 5;
          }
        } else {
          if (this.hitTest()) this.ySpd *= -0.6;
          ++this.hitCount;
          if (this.hitCount > 20) this.remove = true;
        }
        this.paint();
        break;
      case "spark":
        this.x += this.xSpd;
        this.y += this.ySpd;
        this.ySpd += 0.5;
        if (!this.hitCount && (this.hitTest() || this.hitTestPlayer())) {
          this.xSpd *= 3;
          this.y -= this.ySpd;
          this.ySpd *= -UT.rand(0.2, 0.5);
          this.hitCount = 1;
        }
        if (this.hitCount) {
          ++this.hitCount;
          if (this.hitCount === 20) this.remove = true;
          this.paint(Math.trunc(this.hitCount / 10) + 2);
        } else {
          this.paint(1);
        }
        break;
      case "geiser":
        this.x += this.xSpd;
        this.y += this.ySpd;
        this.ySpd += 0.5;
        if (!this.hitCount && (this.hitTest() || this.hitTestPlayer())) {
          this.xSpd *= 10;
          this.ySpd = UT.rand(-2, 2);
          this.hitCount = 1;
        }
        if (!this.hitCount && this.ySpd > 0) this.hitCount = 1;
        if (this.hitCount) {
          ++this.hitCount;
          if (this.hitCount >= 15) this.remove = true;
          this.paint(Math.trunc(this.hitCount / 10) + 2);
        } else {
          this.paint(1);
        }
        break;
      case "raise":
        this.x += this.xSpd;
        this.y -= this.ySpd;
        if (this.fc === 20) this.remove = true;
        this.paint();
        break;
      case "move":
        this.x += this.xSpd;
        this.y += this.ySpd;
        if (this.frame === this.frames) this.remove = true;
        this.paint();
        break;
      case "fish":
        this.extra.rot1 += 0.4;
        this.extra.rot2 += 2;
        this.xVel = xMoveToRot(this.extra.rot1, 1);
        this.yVel = yMoveToRot(this.extra.rot2, 0.1);
        this.x += this.xVel;
        this.y += this.yVel;
        this.paint(this.xVel > 0 ? 1 : 2);
        break;
      case "text":
      case "slowText":
        this.y += this.ySpd;
        this.paint();
        if (this.fc > this.yVel) this.remove = true;
    }
    if (!this.holdFrame) {
      ++this.frame;
      if (this.frame > this.frames) this.frame = 1;
    }
  }

  private paint(frame = this.frame): void {
    this.fx.bitScreen.paint(
      this.x + this.fx.arena.x, this.y + this.fx.arena.y,
      true, this.name, this.sub, frame,
    );
  }

  private hitTest(offX = 0, offY = 0): number {
    if (this.fc < this.hitFrame) return 0;
    const pixel = this.fx.arena.wall.getPixel32(this.x + offX, this.y + offY);
    if (!pixel) return pixel;
    return (pixel >>> 0).toString(16).substring(0, 2) === "ff" ? pixel : 0;
  }

  private hitTestPlayer(): boolean {
    const player = this.fx.player;
    if (!player || player.dead) return false;
    if (this.fc < this.hitFrame) return false;
    return UT.inBox(
      this.x, this.y,
      player.x - 20, player.y - UT.rand(55, 70), 40, 50,
    );
  }
}
