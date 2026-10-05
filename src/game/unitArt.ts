import {
  Assets, BlurFilter, Container, Filter, GlProgram, Matrix, Rectangle, Sprite,
  Text, TextStyle, Texture, UniformGroup, defaultFilterVert,
} from "pixi.js";
import { ASSET_BASE, ASSET_V } from "../core/Config";
import { screenDensity } from "../core/device";
import { UT } from "../core/UT";
import type { Unit } from "./Unit";
import type { FilterSpec } from "./types";
import { lerpRows } from "./poseLerp";
import { LEVEL_ALPHA, NAME_ALPHA, NAME_FONT, NAME_GAP, TEXT_LIFT, nameTint } from "./plateStyle";
import rig from "../assets/unitAnim.json";
import hiSheets from "../assets/unitSheetsHi.json";
import hudUi from "../assets/hudUi.json";

interface GunLike {
  sprite?: string;
  rarity?: number;
  frameIdle?: string;
  unequip?: string;
}

interface Nested {
  cid: number;
  m: number[];
}

interface FrameRec {
  r: number[];
  skin?: Nested;
  gun?: Nested;
  face?: Nested;
  hair?: Nested;
}

interface SheetRec {
  file: string;
  w: number;
  h: number;
}

interface GroupRec {
  sheets: SheetRec[];
  frames: Record<string, FrameRec>;
}

interface SheetSet {
  scale: number;
  dir: string;
  groups: Record<string, { sheets: SheetRec[]; frames: Record<string, number[]> }>;
}

type Placement = (string | number)[];

interface RigData {
  scale: number;
  timeline: Placement[][];
  groups: Record<string, GroupRec>;
  gunLabels: Record<string, number>;
  stowLabels: Record<string, number>;
  arm1: Record<string, Placement[]>;
  arm2: Record<string, Placement[]>;
  arm1hold: Placement[];
}

const RIG = rig as unknown as RigData;

const LO_SET: SheetSet = {
  scale: RIG.scale,
  dir: `${ASSET_BASE}/units`,
  groups: Object.fromEntries(Object.entries(RIG.groups).map(([name, g]) => [name, {
    sheets: g.sheets,
    frames: Object.fromEntries(Object.entries(g.frames).map(([k, f]) => [k, f.r])),
  }])),
};

const HI_SET: SheetSet = {
  ...(hiSheets as unknown as Omit<SheetSet, "dir">),
  dir: `${ASSET_BASE}/units/hi`,
};

const HI_READY = Object.keys(RIG.groups).every((g) => g in HI_SET.groups);
const HI_AT = 2.25;

function sheetSet(): SheetSet {
  return HI_READY && screenDensity() > HI_AT ? HI_SET : LO_SET;
}

function setFiles(set: SheetSet): string[] {
  const files = new Set<string>();
  for (const g of Object.values(set.groups)) {
    for (const s of g.sheets) files.add(s.file);
  }
  return [...files];
}

const LIMB_GROUP: Readonly<Record<string, string>> = {
  body: "body", waist: "waist",
  legup1: "leg", legup2: "leg", leglow1: "shin", leglow2: "shin",
  foot1: "foot", foot2: "foot",
};

const SEG_GROUP: Readonly<Record<string, string>> = {
  armup1: "arm", armup2: "arm",
  armlow1: "forearm", armlow2: "forearm",
  hand1: "hand", hand2: "hand",
};

interface FigureHero {
  head: number;
  body: number;
  color: number;
  face: number;
  skin: number;
  hair: number;
}

const DEFAULT_HERO: FigureHero = { head: 81, body: 81, color: 1, face: 1, skin: 1, hair: 1 };
const DEG = Math.PI / 180;

function mul(inner: readonly number[], outer: readonly number[]): number[] {
  const [a, b, c, d, e, f] = inner;
  const [A, B, C, D, E, F] = outer;
  return [
    A * a + C * b, B * a + D * b,
    A * c + C * d, B * c + D * d,
    A * e + C * f + E, B * e + D * f + F,
  ];
}

function rotT(tx: number, ty: number, deg: number): number[] {
  const r = deg * DEG;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [c, s, -s, c, tx, ty];
}

function weaponFrame(labels: Record<string, number>, id: string | undefined, rarity = 0): number {
  const frame = id ? labels[id] : undefined;
  if (!frame) return -1;
  return frame + (rarity >= 0 && rarity <= 3 ? rarity : 0);
}

export interface BakedTex {
  tex: Texture;
  rec: FrameRec;
  ax: number;
  ay: number;
  scale: number;
}

const GLOW_FRAG = `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform vec4 uInputClamp;

uniform vec3 uGlowColor;
uniform vec4 uGlowParams;
uniform vec2 uGlowRadius;

void main(void)
{
    vec4 src = texture(uTexture, vTextureCoord);
    float inner = uGlowParams.z;

    float acc = 0.0;
    float wsum = 0.0;
    for (int r = 0; r < 3; r++) {
        float fr = (float(r) + 1.0) / 3.0;
        float w = 1.0 - 0.28 * float(r);
        float base = float(r) * 0.2617994;
        for (int i = 0; i < 8; i++) {
            float ang = base + float(i) * 0.7853982;
            vec2 off = vec2(cos(ang), sin(ang)) * uGlowRadius * fr * uInputSize.zw;
            vec2 uv = clamp(vTextureCoord + off, uInputClamp.xy, uInputClamp.zw);
            float a = texture(uTexture, uv).a;
            acc += mix(a, 1.0 - a, inner) * w;
            wsum += w;
        }
    }

    float g = clamp(acc / wsum * uGlowParams.y, 0.0, 1.0) * uGlowParams.x;
    if (inner > 0.5) {
        g *= src.a;
        vec4 glow = vec4(uGlowColor * g, g);
        finalColor = glow + src * (1.0 - g) * (1.0 - uGlowParams.w);
    } else {
        vec4 glow = vec4(uGlowColor * g, g);
        finalColor = src * (1.0 - uGlowParams.w) + glow * (1.0 - src.a);
    }
}
`;

let glowProgram: GlProgram | null = null;

class UnitGlowFilter extends Filter {
  private readonly u: {
    uGlowColor: Float32Array;
    uGlowParams: Float32Array;
    uGlowRadius: Float32Array;
  };

  constructor() {
    glowProgram ??= GlProgram.from({
      vertex: defaultFilterVert,
      fragment: GLOW_FRAG,
      name: "sfh3-unit-glow",
    });
    const glowUniforms = new UniformGroup({
      uGlowColor: { value: new Float32Array([1, 1, 1]), type: "vec3<f32>" },
      uGlowParams: { value: new Float32Array([1, 1, 0, 0]), type: "vec4<f32>" },
      uGlowRadius: { value: new Float32Array([8, 8]), type: "vec2<f32>" },
    });
    super({ glProgram: glowProgram, resources: { glowUniforms } });
    this.u = (this.resources.glowUniforms as UniformGroup).uniforms as typeof this.u;
  }

  set(spec: Extract<FilterSpec, { kind: "glow" }>): void {
    const c = this.u.uGlowColor;
    c[0] = ((spec.color >> 16) & 0xff) / 255;
    c[1] = ((spec.color >> 8) & 0xff) / 255;
    c[2] = (spec.color & 0xff) / 255;
    const p = this.u.uGlowParams;
    p[0] = Math.max(0, Math.min(1, spec.alpha));
    p[1] = spec.strength;
    p[2] = spec.inner ? 1 : 0;
    p[3] = spec.knockout ? 1 : 0;
    const r = this.u.uGlowRadius;
    r[0] = spec.blurX;
    r[1] = spec.blurY;
    this.padding = spec.inner ? 0 : Math.ceil(Math.max(spec.blurX, spec.blurY)) + 2;
  }
}

const MAX_UNIT_FILTERS = 8;

const PLATE = {
  icon2: { x: -34.6, y: -88.45 },
  icon: { x: -34.7, y: -88.55 },
  level: { x: -28.0 + 2, y: -96.0 + 1 },
  name: { x: -9.0 + 2, y: -96.0 + 1 },
} as const;

function plateText(fontFamily: string[] = ["QTypeSquare-Bold", "Verdana", "sans-serif"]): Text {
  return new Text({
    roundPixels: true,
    text: "",
    style: new TextStyle({
      fontFamily,
      fontSize: 8,
      fill: 0xffffff,
    }),
  });
}

const CLASS_IDS = [
  "sni", "med", "eng", "mer", "jug", "gun", "eli", "nin", "spe", "akq",
] as const;
const classIcons = new Map<string, Texture>();

const HUD_ICONS = (hudUi as unknown as {
  icons: Record<string, { ox: number; oy: number; w: number; h: number; px?: number }>;
}).icons;

async function loadClassIcons(): Promise<void> {
  await Promise.all(CLASS_IDS.map(async (cls) => {
    if (classIcons.has(cls)) return;
    try {
      classIcons.set(cls, await Assets.load<Texture>(`ui/hud/icon_${cls}.png`));
    } catch {
    }
  }));
}

export class HeroArt {
  private readonly set: SheetSet;
  private readonly sheets: Map<string, Texture>;
  private readonly cache = new Map<string, Texture>();

  constructor(set: SheetSet, sheets: Map<string, Texture>) {
    this.set = set;
    this.sheets = sheets;
  }

  rec(group: string, frame: number): FrameRec | null {
    return RIG.groups[group]?.frames[String(frame)] ?? null;
  }

  texture(group: string, frame: number): BakedTex | null {
    const rec = RIG.groups[group]?.frames[String(frame)];
    const g = this.set.groups[group];
    const r = g?.frames[String(frame)];
    if (!rec || !r) return null;
    const key = `${group}:${frame}`;
    let tex = this.cache.get(key);
    if (!tex) {
      const sheet = this.sheets.get(g.sheets[r[0]]?.file ?? "");
      if (!sheet) return null;
      tex = new Texture({ source: sheet.source, frame: new Rectangle(r[1], r[2], r[3], r[4]) });
      this.cache.set(key, tex);
    }
    return { tex, rec, ax: r[5] / r[3], ay: r[6] / r[4], scale: this.set.scale };
  }

  sprite(): HeroSprite {
    return new HeroSprite(this);
  }
}

const loaded = new Map<SheetSet, HeroArt>();

export function heroArtUrls(): string[] {
  const set = sheetSet();
  const files = setFiles(set).map((f) => `${set.dir}/${f}?v=${ASSET_V}`);
  for (const cls of CLASS_IDS) files.push(`ui/hud/icon_${cls}.png`);
  return files;
}

async function loadSet(set: SheetSet): Promise<HeroArt> {
  const done = loaded.get(set);
  if (done) return done;
  const [entries] = await Promise.all([
    Promise.all(
      setFiles(set).map(async (f) => {
        const tex = await Assets.load<Texture>(`${set.dir}/${f}?v=${ASSET_V}`);
        return [f, tex] as const;
      }),
    ),
    loadClassIcons(),
  ]);
  const art = new HeroArt(set, new Map(entries));
  loaded.set(set, art);
  return art;
}

export async function loadHero(): Promise<HeroArt> {
  const set = sheetSet();
  if (set === LO_SET) return loadSet(LO_SET);
  try {
    return await loadSet(set);
  } catch {
    return loadSet(LO_SET);
  }
}

export class HeroSprite extends Container {
  private readonly art: HeroArt;
  private unit: Unit | null = null;
  private face = 1;
  private readonly sprites = new Map<string, Sprite>();
  private readonly shown = new Set<string>();
  private anim = "idle";
  private frame = 1;
  private readonly muzzleFrame = new Map<string, number>();

  private readonly rig = new Container();

  private plate: {
    box: Container;
    icon2: Sprite;
    icon: Sprite;
    level: Text;
    name: Text;
  } | null = null;
  private plateKey = "";

  private glows: UnitGlowFilter[] = [];
  private blur: BlurFilter | null = null;
  private filterKey = "";

  constructor(art: HeroArt) {
    super();
    this.art = art;
    this.addChild(this.rig);
  }

  setState(anim: string, frame: number): void {
    this.anim = anim;
    this.frame = frame;
    this.pose(anim, frame, 1);
  }

  renderPose(alpha: number): void {
    this.pose(this.anim, this.frame, alpha);
  }

  bindUnit(u: Unit | null): void {
    this.unit = u;
  }

  get facing(): number {
    return this.face;
  }

  set facing(v: number) {
    this.face = v < 0 ? -1 : 1;
  }

  private pose(anim: string, frame: number, t: number): void {
    const u = this.unit;
    const clamp = (f: number): number =>
      Math.max(1, Math.min(RIG.timeline.length, f)) - 1;
    const row0 = RIG.timeline[clamp(frame)];
    if (!row0) return;
    const mc = u?.MC;
    const row = mc?.stepped && t < 1
      ? lerpRows(RIG.timeline[clamp(mc.prevFrame)] ?? row0, row0, t)
      : row0;

    const hero: FigureHero = u
      ? {
        head: u.unitInfo.head, body: u.unitInfo.body, color: u.unitInfo.color,
        face: u.unitInfo.face, skin: u.unitInfo.skin, hair: u.unitInfo.hair,
      }
      : DEFAULT_HERO;
    const costume = hero.body + hero.color - 1;
    const gun = u?.gun;
    const cur = gun?.curGun as GunLike | undefined;
    const other = gun?.otherGun as GunLike | undefined;
    const gunFrame = weaponFrame(RIG.gunLabels, cur?.sprite, cur?.rarity);
    const legStowFrame = weaponFrame(RIG.gunLabels, other?.sprite, other?.rarity);
    const stowFrame = weaponFrame(RIG.stowLabels, other?.sprite, other?.rarity);
    const unequip = other?.unequip ?? "body";
    const idle = cur?.frameIdle && RIG.arm1[cur.frameIdle] ? cur.frameIdle : "pistol";
    const armLayout = (which: "arm1" | "arm2"): readonly Placement[] => {
      const clip = u?.MC?.[which];
      const row = clip ? clip.rec.frames[clip.frame - 1] : undefined;
      if (!clip || !row?.length) return RIG[which][idle] ?? RIG[which].pistol ?? [];
      if (!clip.stepped || t >= 1) return row;
      const from = clip.rec.frames[clip.prevFrame - 1];
      return from?.length ? lerpRows(from, row, t) : row;
    };
    const arm1 = armLayout("arm1");
    const arm2 = armLayout("arm2");
    const holders = anim === "spawn" && !!u && !u.MC.gunsVisible;

    let hx = 0;
    let hy = 0;
    for (const e of row) {
      if (e[0] === "headhold") {
        hx = Number(e[5]);
        hy = Number(e[6]);
      }
    }

    const rotArm = u ? u.armRotation : 0;
    const rotHead = u ? u.headRotation : 0;

    this.shown.clear();
    for (const e of row) {
      const name = String(e[0]);
      const m: number[] = [Number(e[1]), Number(e[2]), Number(e[3]), Number(e[4]), Number(e[5]), Number(e[6])];
      switch (name) {
        case "arm2":
          if (holders) break;
          this.drawArm("arm2", arm2, rotT(u ? u.MC.armX : m[4], u ? u.MC.armY : m[5], rotArm), costume, gunFrame);
          break;
        case "rope":
          this.draw("rope", "rope", 1, m);
          break;
        case "body":
          this.drawPart("body", "body", costume, m);
          this.drawStowOn("body", m, unequip, stowFrame, legStowFrame);
          break;
        case "waist":
          this.drawPart("waist", "waist", costume, m);
          break;
        case "legup1":
        case "legup2":
          this.drawPart(name, "leg", costume, m);
          this.drawStowOn(name, m, unequip, stowFrame, legStowFrame);
          break;
        case "leglow1":
        case "leglow2":
          this.drawPart(name, "shin", costume, m);
          break;
        case "foot1":
        case "foot2":
          this.drawPart(name, "foot", costume, m);
          break;
        case "headhold":
          if (holders) this.drawHead("headhold", m, hero);
          break;
        case "arm1hold":
          if (holders) this.drawArm("arm1hold", RIG.arm1hold, m, costume, -1);
          break;
        case "head":
          if (!holders) this.drawHead("head", rotT(hx, hy, rotHead), hero);
          break;
        case "arm1":
          if (!holders) {
            this.drawArm("arm1", arm1, rotT(u ? u.MC.armX : m[4], u ? u.MC.armY : m[5], rotArm), costume, gunFrame);
          }
          break;
        case "landfx":
          this.draw("landfx", "landfx", 1, m);
          break;
        default:
          break;
      }
    }
    for (const [key, sp] of this.sprites) sp.visible = this.shown.has(key);

    this.rig.rotation = u ? u.MC.rotation * DEG : 0;
    const scale = u ? u.scale : 1;
    this.rig.scale.set(this.face * scale, scale);
    this.rig.alpha = u ? u.mcAlpha : 1;

    this.applyFilters(u);
    this.updatePlate(u);
  }

  private applyFilters(u: Unit | null): void {
    const specs = u ? u.MCfiltersApplied : null;
    if (!specs || !specs.length) {
      if (this.filterKey) {
        this.rig.filters = [];
        this.filterKey = "";
      }
      return;
    }
    const n = Math.min(specs.length, MAX_UNIT_FILTERS);
    let key = "";
    for (let i = 0; i < n; i++) {
      const s = specs[i];
      key += s.kind === "glow" ? (s.inner ? "i" : "o") : "b";
    }

    const out: Filter[] = [];
    let glowAt = 0;
    for (let i = 0; i < n; i++) {
      const s = specs[i];
      if (s.kind === "blur") {
        this.blur ??= new BlurFilter({ strengthX: 0, strengthY: 0, quality: 1 });
        this.blur.strengthX = s.blurX;
        this.blur.strengthY = s.blurY;
        this.blur.quality = s.quality;
        out.push(this.blur);
      } else {
        let g = this.glows[glowAt];
        if (!g) {
          g = new UnitGlowFilter();
          this.glows[glowAt] = g;
        }
        ++glowAt;
        g.set(s);
        out.push(g);
      }
    }
    if (key !== this.filterKey) {
      this.filterKey = key;
      this.rig.filters = out;
    }
  }

  private updatePlate(u: Unit | null): void {
    if (!u) {
      if (this.plate) this.plate.box.visible = false;
      return;
    }
    let p = this.plate;
    if (!p) {
      p = {
        box: new Container(),
        icon2: new Sprite(Texture.EMPTY),
        icon: new Sprite(Texture.EMPTY),
        level: plateText(),
        name: plateText(NAME_FONT),
      };
      p.icon2.anchor.set(0.5);
      p.icon.anchor.set(0.5);
      p.icon2.position.set(PLATE.icon2.x, PLATE.icon2.y);
      p.icon.position.set(PLATE.icon.x, PLATE.icon.y);
      p.level.position.set(PLATE.level.x, PLATE.level.y - TEXT_LIFT);
      p.name.position.set(PLATE.name.x, PLATE.name.y - TEXT_LIFT);
      p.box.addChild(p.icon2, p.icon, p.name, p.level);
      this.plate = p;
      this.addChild(p.box);
    }
    p.box.visible = true;

    const color = u.status.healthColor;
    const key = `${u.unitInfo.cls}|${u.name}|${u.unitInfo.level}|${color}`;
    if (key === this.plateKey) return;
    this.plateKey = key;

    const tex = classIcons.get(u.unitInfo.cls) ?? Texture.EMPTY;
    p.icon2.texture = tex;
    p.icon.texture = tex;
    const rec = HUD_ICONS[u.unitInfo.cls];
    const k = 1 / (rec?.px ?? 1);
    for (const sp of [p.icon2, p.icon]) {
      sp.anchor.set(rec ? rec.ox / (rec.w || 1) : 0.5,
                    rec ? rec.oy / (rec.h || 1) : 0.5);
      sp.scale.set(k);
    }
    p.icon2.visible = false;
    p.icon.tint = color;
    p.icon.alpha = LEVEL_ALPHA;
    p.level.text = String(u.unitInfo.level);
    p.level.tint = color;
    p.level.alpha = LEVEL_ALPHA;
    p.name.text = u.name;
    p.name.tint = nameTint(color);
    p.name.alpha = NAME_ALPHA;
    p.name.x = p.level.x + p.level.width + NAME_GAP;
  }

  private drawPart(key: string, group: string, costume: number, m: readonly number[]): void {
    const rec = this.art.rec(group, costume);
    if (rec?.skin) {
      this.draw(`${key}.skin`, `skin_${rec.skin.cid}`, this.heroSkin(), mul(rec.skin.m, m));
    }
    this.draw(key, group, costume, m);
  }

  private drawStowOn(key: string, m: readonly number[], unequip: string, stowFrame: number,
                     legStowFrame: number): void {
    const rec = this.art.rec(LIMB_GROUP[key], this.costume());
    if (!rec?.gun) return;
    if (key === "body" && this.unit?.hasFlag) {
      const team = (this.unit.hasFlag as { team?: number }).team ?? 1;
      const frame = weaponFrame(RIG.stowLabels, `flag${team}`, 0);
      if (frame > 0) this.draw(`${key}.stow`, "stow", frame, mul(rec.gun.m, m));
      return;
    }
    if (key !== unequip) return;
    const frame = key === "body" ? stowFrame : legStowFrame;
    const strip = key === "body" ? "stow" : "gun";
    if (frame > 0) this.draw(`${key}.stow`, strip, frame, mul(rec.gun.m, m));
  }

  private drawHead(key: string, m: readonly number[], hero: FigureHero): void {
    const f = hero.head + hero.color - 1;
    const rec = this.art.rec("head", f);
    if (rec?.face) {
      this.draw(`${key}.face`, `face_${rec.face.cid}`, hero.face, mul(rec.face.m, m));
      const face = this.art.rec(`face_${rec.face.cid}`, hero.face);
      if (face?.skin) {
        this.draw(`${key}.skin`, `skin_${face.skin.cid}`, hero.skin,
                  mul(face.skin.m, mul(rec.face.m, m)));
      }
    }
    if (rec?.hair) {
      this.draw(`${key}.hair`, `hair_${rec.hair.cid}`, hero.hair, mul(rec.hair.m, m));
    }
    this.draw(key, "head", f, m);
  }

  private drawArm(key: string, layout: readonly Placement[], A: number[], costume: number,
                  gunFrame: number): void {
    for (const e of layout) {
      const name = String(e[0]);
      const L: number[] = [Number(e[1]), Number(e[2]), Number(e[3]), Number(e[4]), Number(e[5]), Number(e[6])];
      const seg = SEG_GROUP[name];
      if (seg) {
        this.drawPart(`${key}.${name}`, seg, costume, mul(L, A));
      } else if ((name === "gun" || name === "gun2") && gunFrame > 0) {
        this.draw(`${key}.${name}`, "gun", gunFrame, mul(L, A));
      } else if (name.startsWith("muzzle:")) {
        this.drawMuzzle(`${key}.muzzle`, name.slice(7), mul(L, A));
      }
    }
  }

  private drawMuzzle(key: string, weapon: string, m: readonly number[]): void {
    const group = RIG.groups[`muzzle_${weapon}`];
    if (!group) return;
    const n = Object.keys(group.frames).length;
    if (!n) return;
    const sp = this.sprites.get(key);
    let frame = this.muzzleFrame.get(key) ?? 0;
    if (!sp || !sp.visible || !frame) {
      frame = UT.irand(1, n);
      this.muzzleFrame.set(key, frame);
    }
    this.draw(key, `muzzle_${weapon}`, frame, m);
  }

  private heroSkin(): number {
    return this.unit ? this.unit.unitInfo.skin : DEFAULT_HERO.skin;
  }

  private costume(): number {
    if (!this.unit) return DEFAULT_HERO.body + DEFAULT_HERO.color - 1;
    return this.unit.unitInfo.body + this.unit.unitInfo.color - 1;
  }

  private draw(key: string, group: string, frame: number, m: readonly number[]): void {
    const baked = this.art.texture(group, frame);
    if (!baked) return;
    let sp = this.sprites.get(key);
    if (!sp) {
      sp = new Sprite(Texture.EMPTY);
      this.sprites.set(key, sp);
      this.rig.addChild(sp);
    }
    sp.texture = baked.tex;
    sp.anchor.set(baked.ax, baked.ay);
    const s = baked.scale;
    sp.setFromMatrix(new Matrix(
      m[0] / s, m[1] / s, m[2] / s, m[3] / s, m[4], m[5]));
    sp.visible = true;
    this.shown.add(key);
  }
}
