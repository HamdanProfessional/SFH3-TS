import { Container, Matrix, Sprite } from "pixi.js";
import { MenuRig, type TexRec } from "../assets/MenuRig";
import { MenuClip } from "./MenuAnim";

export interface FigureHero {
  head: number;
  body: number;
  color: number;
  face: number;
  skin: number;
  hair: number;
}

const CLIP: Readonly<Record<string, string>> = {
  frontArm: "arm", backArm: "arm",
  frontForearm: "forearm", backForearm: "forearm",
  frontHand: "hand", backHand: "hand",
  frontLeg: "leg", backLeg: "leg",
  frontShin: "shin", backShin: "shin",
  frontFoot: "foot", backFoot: "foot",
  body: "body", waist: "waist",
};

function mul(inner: readonly number[], outer: readonly number[]): number[] {
  const [a, b, c, d, e, f] = inner;
  const [A, B, C, D, E, F] = outer;
  return [
    A * a + C * b, B * a + D * b,
    A * c + C * d, B * c + D * d,
    A * e + C * f + E, B * e + D * f + F,
  ];
}

export class MenuFigure {
  readonly view = new Container();

  private hero: FigureHero = { head: 81, body: 81, color: 1, face: 1, skin: 1, hair: 1 };
  private primary = 0;
  private secondary = 0;
  private stowTarget = "body";
  private sprites = new Map<string, Sprite>();
  private frame = -1;
  private clip = new MenuClip();

  setHero(hero: FigureHero, primaryFrame = 0, secondaryFrame = 0,
          stowTarget = "body"): void {
    this.hero = { ...hero };
    this.primary = primaryFrame;
    this.secondary = secondaryFrame;
    this.stowTarget = stowTarget;
    this.frame = -1;
  }

  playLabel(label: string): void {
    this.clip.gotoAndPlay(label);
    this.setFrame(this.clip.frame);
  }

  tick(): void {
    if (!this.clip.playing) return;
    this.clip.tick();
    this.setFrame(this.clip.frame);
  }

  get animating(): boolean {
    return this.clip.playing;
  }

  setFrame(frame: number): void {
    const n = MenuRig.frameCount;
    const idx = ((Math.trunc(frame) % n) + n) % n;
    this.frame = idx;

    const h = this.hero;
    const bodyF = h.body + h.color - 1;
    const seen = new Set<string>();

    for (const placement of MenuRig.data.timeline.frames[idx]) {
      const name = String(placement[0]);
      const m = placement.slice(1) as readonly number[];
      switch (name) {
        case "shadow":
          this.draw(seen, "shadow", MenuRig.data.shadow, m);
          break;
        case "head":
          this.weldHead(h.head + h.color - 1, m, seen);
          break;
        case "gun":
          this.draw(seen, "gun", MenuRig.gun(this.primary), m);
          break;
        case "gun2":
          this.draw(seen, "gun2", MenuRig.gun(this.secondary || this.primary), m);
          break;
        default: {
          const base = CLIP[name];
          if (!base) continue;
          const limb = MenuRig.limb(base, bodyF);
          this.draw(seen, name, limb, m);
          if (limb?.stow && this.secondary && name === this.stowTarget) {
            this.draw(seen, "stow", MenuRig.stow(this.secondary),
                      mul(limb.stow.m, m));
          }
        }
      }
    }

    for (const [key, sp] of this.sprites) sp.visible = seen.has(key);
  }

  setHeadOnly(hero: FigureHero, m: readonly number[]): void {
    this.hero = { ...hero };
    this.frame = -1;
    const seen = new Set<string>();
    this.weldHead(hero.head + hero.color - 1, m, seen);
    for (const [key, sp] of this.sprites) sp.visible = seen.has(key);
  }

  private weldHead(headF: number, m: readonly number[], seen: Set<string>): void {
    const head = MenuRig.head(headF);
    if (!head) return;
    const h = this.hero;

    if (head.face) {
      const face = MenuRig.face(head.face.cid, h.face);
      this.draw(seen, "face", face, mul(head.face.m, m));
      if (face?.skin) {
        const skin = MenuRig.skin(face.skin.cid, h.skin);
        this.draw(seen, "skin", skin, mul(mul(face.skin.m, head.face.m), m));
      }
    }
    if (head.hair) {
      this.draw(seen, "hair", MenuRig.hair(head.hair.cid, h.hair),
                mul(head.hair.m, m));
    }
    this.draw(seen, "hat", head.tex, m);
  }

  private draw(seen: Set<string>, key: string, rec: TexRec | null, m: readonly number[]): void {
    seen.add(key);
    if (!rec) return;
    let sp = this.sprites.get(key);
    if (!sp) {
      sp = new Sprite();
      this.sprites.set(key, sp);
      this.view.addChild(sp);
    }
    const tex = MenuRig.texture(rec);
    sp.texture = tex;
    sp.anchor.set(rec.ox / (rec.w || 1), rec.oy / (rec.h || 1));
    const kx = tex.width > 1 && rec.w ? rec.w / tex.width : 1;
    const ky = tex.height > 1 && rec.h ? rec.h / tex.height : 1;
    const mm = (kx === 1 && ky === 1) ? m : mul([kx, 0, 0, ky, 0, 0], m);
    sp.setFromMatrix(new Matrix(mm[0], mm[1], mm[2], mm[3], mm[4], mm[5]));
    sp.visible = true;
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}
