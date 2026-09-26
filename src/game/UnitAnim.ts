import type { Unit } from "./Unit";
import { ArmClip, type ArmHost } from "./ArmAnim";
import { isStep } from "./poseLerp";
import rig from "../assets/unitAnim.json";

import { LABELS, TOTAL_FRAMES } from "./unitLabels";
export { LABELS, TOTAL_FRAMES } from "./unitLabels";

const RIG = rig as unknown as { timeline: (string | number)[][][] };

export function armRotationOf(rotReload: number, rotArm: number): number {
  return rotReload + rotArm;
}
export function headRotationOf(rotReload: number, rotArm: number): number {
  return rotReload + rotArm * 0.6;
}

export class UnitAnim implements ArmHost {
  readonly unit: Unit;

  currentFrame = 1;
  prevFrame = 1;
  stepped = false;
  curAnim = "idle";
  playing = true;

  rotation = 0;
  alpha = 1;

  readonly arm1 = new ArmClip("arm1", this);
  readonly arm2 = new ArmClip("arm2", this);

  armPlaying = true;

  armX = 0;
  armY = 0;

  gunsVisible = true;

  constructor(unit: Unit) {
    this.unit = unit;
    this.updateHolders();
  }

  private updateHolders(): void {
    const row = RIG.timeline[this.currentFrame - 1];
    if (!row) return;
    for (const e of row) {
      if (e[0] === "arm1hold") {
        this.armX = Number(e[5]);
        this.armY = Number(e[6]);
      }
    }
  }

  EnterFrame(): void {
  }

  prepareSpawn(showRope: boolean): void {
    if (showRope) {
      this.unit.status.sSpawn = 1.5 * 30;
      this.goto("spawn", true);
      this.gunsVisible = false;
      this.unit.canRotate = false;
    } else {
      this.showGuns();
      this.unit.canRotate = true;
    }
  }

  showGuns(): void {
    this.gunsVisible = true;
  }

  spawned(): void {
    this.unit.status.sSpawn = 0;
  }

  stop(): void {
    this.playing = false;
    this.stepped = false;
  }

  play(): void {
    this.playing = true;
  }

  doneShoot(): void {
    this.unit.gun?.setFrame("idle");
  }

  doneReload(): void {
    this.unit.gun?.setFrame("idle");
    this.unit.gun?.reloaded();
  }

  reloadSound(): void {
    this.unit.gun?.playReloadSound();
  }

  goto(frame: string | null, force = false): void {
    let f = frame ?? "idle";
    if (!force) {
      const rt = this.unit.unitInfo.runType;
      const cur = this.curAnim;

      if (cur === "spawn") return;
      if (cur === f) return;
      if (cur === "climbsmall" || cur === "climbbig") return;
      if (cur === "landhard") return;
      if (cur === "jump" && f === "fall") return;
      if (cur === "tuck" && f === "fall") return;
      if (cur === "land" && f === "idle") return;
      if (cur === "landrun" + rt && f === "run" + rt) return;
      if (cur === "landrunback" + rt && f === "runback" + rt) return;
      if (cur === "duckloop" && f === "duck") return;

      if (cur === "duckrun" && f === "duck") f = "duckloop";
      if (cur === "duckrunback" && f === "duck") f = "duckloop";
      if (cur === "slide" && f === "duck") f = "duckloop";
      if (cur === "duck" && f === "idle") f = "getup";
      if ((cur === "run" + rt || cur === "landrun" + rt) && f === "duckrun") f = "slide";
      if (cur === "runback" + rt && f === "duckrunback") f = "duck";
      if (cur === "duckrun" && f === "run" + rt) f = "getup";
      if (cur === "duckrunback" && f === "runback" + rt) f = "getup";

      if (cur === "slide") return;
      if (cur === "duck" && f === "duckrun") return;
      if (cur === "duck" && f === "duckrunback") return;
      if (cur === "getup" && f === "run" + rt) return;
      if (cur === "getup" && f === "runback" + rt) return;

      if (cur === "duckloop" && f === "idle") f = "getup";

      if (cur === "getup" && f === "idle") return;
    }
    this.curAnim = f;
    this.gotoAndPlay(f);
  }

  private gotoAndPlay(label: string): void {
    const range = LABELS[label];
    if (!range) return;
    this.currentFrame = range[0];
    this.prevFrame = this.currentFrame;
    this.stepped = false;
    this.playing = true;
    this.updateHolders();
  }

  netPose(anim: string, frame: number): void {
    const was = this.currentFrame;
    this.curAnim = anim;
    this.currentFrame = frame;
    this.prevFrame = was;
    this.stepped = isStep(was, frame);
    this.playing = false;
    this.updateHolders();
  }

  tick(): void {
    if (!this.playing) return;
    this.prevFrame = this.currentFrame;
    this.currentFrame = this.currentFrame >= TOTAL_FRAMES ? 1 : this.currentFrame + 1;
    this.stepped = isStep(this.prevFrame, this.currentFrame);
    this.updateHolders();
    this.runFrameScript(this.currentFrame);
  }

  tickArms(): void {
    this.arm1.tick();
    this.arm2.tick();
    this.armPlaying = this.arm1.playing;
  }

  private runFrameScript(f: number): void {
    switch (f) {
      case 30:
        this.goto("idle", true);
        break;
      case 52:
        this.unit.canRotate = true;
        break;
      case 58:
        this.showGuns();
        break;
      case 64:
        this.spawned();
        this.goto("idle", true);
        break;
      case 86:
      case 104:
        this.goto("run1", true);
        break;
      case 126:
      case 144:
        this.goto("runback1", true);
        break;
      case 172:
      case 193:
        this.goto("run2", true);
        break;
      case 221:
      case 242:
        this.goto("runback2", true);
        break;
      case 269:
        this.goto("fall");
        break;
      case 325:
        this.gotoAndPlay("fallloop");
        break;
      case 340:
        this.goto("idle", true);
        break;
      case 351:
        this.goto("duckloop", true);
        break;
      case 355:
        this.goto("duckloop");
        break;
      case 371:
        this.goto("duckloop", true);
        break;
      case 404:
        this.goto("duckrun", true);
        break;
      case 437:
        this.goto("duckrunback", true);
        break;
      case 441:
        this.goto("idle", true);
        break;
      case 446:
      case 458:
        this.unit.mov.climb = 0;
        this.goto("idle", true);
        break;
      case 499:
        this.unit.mov.landHard = false;
        this.goto("idle", true);
        break;
      default:
        break;
    }
  }
}
