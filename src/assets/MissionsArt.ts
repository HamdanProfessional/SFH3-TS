import { Assets, Container, Sprite, Texture } from "pixi.js";
import rig from "./missionsUi.json";
import menuUi from "./menuUi.json";

export interface MTex {
  file: string;
  w: number;
  h: number;
  ox: number;
  oy: number;
}

export interface MUse {
  name: string;
  cid: number | null;
  m: number[];
}

export interface MBoxFrame {
  under: MTex;
  over: MTex;
  place: MUse[];
  clip: number[];
}

export interface MButtonRec {
  states: Partial<Record<"up" | "over" | "down", string>>;
  offX: number;
  offY: number;
  w: number;
  h: number;
}

interface MissionsData {
  scale: number;
  plate: { file: string; x: number; y: number; w: number; h: number };
  cont: { tex: MTex; place: number[]; clip: number[] };
  fog: MTex;
  scroll: MTex;
  dots: { dot: MTex[]; chal: MTex[] };
  beat: (MTex | null)[];
  box: Record<string, MBoxFrame>;
  boxmap: Record<string, MTex>;
  boxmode: Record<string, MTex>;
  buttons: Record<string, MButtonRec>;
  text: Record<string, {
    font?: string; size?: number; color?: number; alpha?: number;
    align?: string; leading?: number; wordWrap?: boolean;
    x?: number; y?: number; w?: number; h?: number; text?: string;
  }>;
}

const R = rig as unknown as MissionsData;

export const MISSIONS_SCALE = 2;

const IMG_BASE = "assets/missions/";
const UI_BASE = "ui/";
const cache = new Map<string, Texture>();
const pending = new Set<string>();

function load(url: string): Texture {
  const hit = cache.get(url);
  if (hit) return hit;
  if (!pending.has(url)) {
    pending.add(url);
    Assets.load<Texture>(url)
      .then((t) => void cache.set(url, t))
      .catch(() => void pending.delete(url));
  }
  return Texture.EMPTY;
}

export function mTex(rec: MTex | null | undefined): Texture {
  return rec ? load(IMG_BASE + rec.file) : Texture.EMPTY;
}

export function uiTex(file: string | undefined): Texture {
  return file ? load(UI_BASE + file) : Texture.EMPTY;
}

export function mSprite(rec: MTex, x = 0, y = 0): Sprite {
  const sp = new Sprite();
  bindTex(sp, rec);
  sp.position.set(x, y);
  return sp;
}

export function sizeToRec(sp: Sprite, rec: MTex): void {
  sp.anchor.set(rec.w ? rec.ox / rec.w : 0, rec.h ? rec.oy / rec.h : 0);
  const t = sp.texture;
  if (!t || t === Texture.EMPTY || !t.width) {
    sp.scale.set(1 / MISSIONS_SCALE);
    return;
  }
  sp.scale.set(rec.w / t.width, rec.h / t.height);
}

const REC = Symbol("missionsTexRec");

export function bindTex(sp: Sprite, rec: MTex): void {
  (sp as unknown as Record<symbol, MTex>)[REC] = rec;
  sp.texture = mTex(rec);
  sizeToRec(sp, rec);
}

export function refreshMissionTex(root: Container): void {
  const visit = (c: Container): void => {
    for (const child of c.children) {
      const rec = (child as unknown as Record<symbol, MTex | undefined>)[REC];
      if (rec) {
        (child as Sprite).texture = mTex(rec);
        sizeToRec(child as Sprite, rec);
      }
      if ((child as Container).children) visit(child as Container);
    }
  };
  visit(root);
}

export class MissionButton extends Container {
  readonly w: number;
  readonly h: number;
  private offX: number;
  private offY: number;
  private sprites: { sp: Sprite; rec: MTex }[] = [];
  private up: Sprite | null = null;
  private over: Sprite | null = null;
  private down: Sprite | null = null;
  private state: "up" | "over" | "down" = "up";

  constructor(
    rec: MButtonRec | undefined, x: number, y: number, sx = 1, sy = 1,
  ) {
    super();
    this.position.set(x, y);
    this.scale.set(sx, sy);
    const art = rec ?? { states: {}, offX: 0, offY: 0, w: 0, h: 0 };
    this.offX = art.offX;
    this.offY = art.offY;
    this.w = art.w;
    this.h = art.h;

    const make = (file?: string): Sprite | null => {
      if (!file) return null;
      const sp = new Sprite(uiTex(file));
      sp.width = art.w;
      sp.height = art.h;
      sp.position.set(art.offX, art.offY);
      sp.visible = false;
      this.addChild(sp);
      const trec: MTex = { file, w: art.w, h: art.h, ox: -art.offX, oy: -art.offY };
      this.sprites.push({ sp, rec: trec });
      return sp;
    };
    this.up = make(art.states.up);
    this.over = make(art.states.over);
    this.down = make(art.states.down);
    if (this.up) this.up.visible = true;
  }

  hitBox(): [number, number, number, number] {
    const x0 = this.offX * this.scale.x;
    const x1 = (this.offX + this.w) * this.scale.x;
    const y0 = this.offY * this.scale.y;
    const y1 = (this.offY + this.h) * this.scale.y;
    return [
      this.x + Math.min(x0, x1), this.y + Math.min(y0, y1),
      Math.abs(x1 - x0), Math.abs(y1 - y0),
    ];
  }

  setState(s: "up" | "over" | "down"): void {
    if (this.state === s) return;
    this.state = s;
    if (this.up) {
      this.up.visible = s === "up" || (s === "over" && !this.over)
        || (s === "down" && !this.down && !this.over);
    }
    if (this.over) this.over.visible = s === "over" || (s === "down" && !this.down);
    if (this.down) this.down.visible = s === "down";
  }

  refresh(): void {
    for (const { sp, rec } of this.sprites) {
      const t = uiTex(rec.file);
      const wasEmpty = sp.texture === Texture.EMPTY;
      sp.texture = t;
      if (wasEmpty && t !== Texture.EMPTY) {
        sp.width = rec.w;
        sp.height = rec.h;
      }
    }
  }
}

export const MissionsArt = {
  data: R,
  scale: MISSIONS_SCALE,
  sprite: mSprite,
  button(cid: number, x: number, y: number, sx = 1, sy = 1): MissionButton {
    const rec = R.buttons[String(cid)]
      ?? (menuUi as unknown as { buttons: Record<string, MButtonRec> })
        .buttons[String(cid)];
    return new MissionButton(rec, x, y, sx, sy);
  },
  placed(frame: string, name: string): MUse | null {
    return R.box[frame]?.place.find((p) => p.name === name) ?? null;
  },
};
