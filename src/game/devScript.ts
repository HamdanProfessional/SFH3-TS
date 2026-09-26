import type { Unit } from "./Unit";

export interface DevScriptHost {
  readonly units: readonly Unit[];
  readonly team1score: number;
  say(unit: Unit, text: string): void;
  scaled?(unit: Unit, scale: number): void;
}

const TRUE_FORM_SCALE = 1.3;
const JUSTIN_FACE = 242;
const MIKE_FACE = 241;

export class DevScript {
  private step = 0;
  private mike: Unit | null = null;
  private justin: Unit | null = null;
  private looked = false;

  tick(h: DevScriptHost): void {
    if (!this.looked && h.units.length) {
      this.looked = true;
      for (const u of h.units) {
        const info = u.unitInfo;
        if (info.name === "Justin" && info.head === JUSTIN_FACE) this.justin = u;
        if (info.name === "Mike" && info.head === MIKE_FACE) this.mike = u;
      }
    }
    const devs = [this.mike, this.justin].filter((u): u is Unit => !!u);
    const mike = this.mike ?? devs[0];
    const justin = this.justin ?? devs[0];
    if (!mike || !justin) return;
    const both = (fn: (u: Unit) => void): void => {
      for (const u of devs) {
        fn(u);
        u.status.reset();
      }
    };
    const extra = (u: Unit): Record<string, unknown> => u.unitInfo.extra as Record<string, unknown>;
    const score = h.team1score;

    switch (this.step) {
      case 0:
        both((u) => { u.unitInfo.extra = {}; });
        ++this.step;
        break;
      case 1:
        if (score >= 4) {
          h.say(mike, "We're taking damage, Defensive Stance!");
          both((u) => { extra(u).permReflect = 1; });
          ++this.step;
        }
        break;
      case 2:
        if (score >= 8) {
          h.say(justin, "I've got an idea, Stick to the Shadows!");
          both((u) => {
            extra(u).permReflect = 0;
            u.unitInfo.skills.stealth_ = 1;
          });
          ++this.step;
        }
        break;
      case 3:
        if (score >= 12) {
          h.say(mike, "I'm in pain, here comes the Heal Train!");
          both((u) => {
            u.unitInfo.skills.stealth_ = 0;
            extra(u).permRegen = 1;
          });
          ++this.step;
        }
      case 4:
        if (score >= 16) {
          h.say(justin, "This isn't working... Bring on the Hax!");
          both((u) => {
            extra(u).permRegen = 0;
            extra(u).permWallhack = 1;
          });
          ++this.step;
        }
        break;
      case 5:
        if (score >= 20) {
          h.say(mike, "Time for our TRUE FORMS!");
          both((u) => {
            const e = extra(u);
            e.permReflect = 1;
            e.permWallhack = 1;
            e.permRegen = 1;
            u.unitInfo.skills.stealth_ = 1;
          });
          for (const u of devs) {
            u.oscale = u.scale = TRUE_FORM_SCALE;
            h.scaled?.(u, TRUE_FORM_SCALE);
          }
          ++this.step;
        }
        break;
      case 6:
        if (score >= 23) {
          h.say(justin, "That's it, DOUBLE WEAPONS!");
          both((u) => { extra(u).permAkimbo = 1; });
          ++this.step;
        }
    }
  }
}
