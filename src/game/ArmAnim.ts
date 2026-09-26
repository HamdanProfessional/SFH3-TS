import { isStep } from "./poseLerp";
import rig from "../assets/armAnim.json";

export type ArmName = "arm1" | "arm2";

export type ArmPlacement = (string | number)[];

export interface ArmRec {
  total: number;
  labels: Record<string, [number, number]>;
  scripts: Record<string, string[]>;
  frames: ArmPlacement[][];
}

const RIG = rig as unknown as Record<ArmName, ArmRec>;

export interface ArmHost {
  doneShoot(): void;
  doneReload(): void;
  reloadSound(): void;
}

export class ArmClip {
  readonly rec: ArmRec;
  frame = 1;
  prevFrame = 1;
  stepped = false;
  playing = true;
  label = "";

  constructor(name: ArmName, private readonly host: ArmHost) {
    this.rec = RIG[name];
  }

  gotoAndStop(label: string): void {
    this.jump(label);
    this.playing = false;
  }

  gotoAndPlay(label: string): void {
    this.jump(label);
    this.playing = true;
  }

  stop(): void {
    this.playing = false;
    this.stepped = false;
  }

  play(): void {
    this.playing = true;
  }

  tick(): void {
    if (!this.playing) return;
    const total = this.rec.total;
    this.prevFrame = this.frame;
    this.frame = this.frame >= total ? 1 : this.frame + 1;
    this.stepped = isStep(this.prevFrame, this.frame);
    this.runScript();
  }

  private jump(label: string): void {
    const range = this.rec.labels[label];
    this.label = label;
    this.prevFrame = this.frame;
    this.stepped = false;
    if (!range) return;
    if (this.frame === range[0]) return;
    this.frame = range[0];
    this.runScript();
  }

  private runScript(): void {
    const calls = this.rec.scripts[String(this.frame)];
    if (!calls) return;
    for (const call of calls) {
      switch (call) {
        case "doneShoot":
          this.host.doneShoot();
          break;
        case "doneReload":
          this.host.doneReload();
          break;
        case "reloadSound":
          this.host.reloadSound();
          break;
        case "stop":
          this.playing = false;
          break;
        default:
          break;
      }
    }
  }
}
