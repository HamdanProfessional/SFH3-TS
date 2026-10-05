import {
  Assets, ColorMatrixFilter, Container, Graphics, Matrix, Rectangle, Sprite,
  Text, TextStyle, Texture, type ColorMatrix, type TextStyleOptions,
} from "pixi.js";
import * as Config from "../core/Config";
import { COLOR, focusable, label, hitTest } from "./kit";
import { SH } from "../audio/SH";
import { FxArt } from "../assets/FxArt";
import { itemOb } from "../data/StatsClasses";
import { GAME_MODE_IDS, getGameMode } from "../data/StatsMisc";
import { MatchSettings } from "../game/MatchSettings";
import { MenuFigure, type FigureHero } from "../menu/MenuFigure";
import { HUD_BASE, HUD_MAN, hudArtFiles, hudArtUrls } from "./hudArt";

const RADAR_BIT = "radar";

export interface HudTexRec {
  file: string;
  w: number;
  h: number;
  ox: number;
  oy: number;
  px?: number;
}

interface HudPlacement {
  m: number[];
  cx?: [number[], number[]];
}

interface HudTextSpec {
  cid: number;
  x: number; y: number; w: number; h: number;
  size?: number;
  font?: string;
  color?: number;
  alpha?: number;
  align?: string;
  leading?: number;
  wordWrap?: boolean;
  multiline?: boolean;
  default?: string;
}

export interface HudManifest {
  design: [number, number];
  scale: number;
  states: Record<string, { frame: number; plate: string }>;
  children: Record<string, HudPlacement>;
  bars: { fill: HudTexRec } & Record<string, { m: number[]; color: number }>;
  scorebar: {
    row: HudTexRec;
    bars: Record<string, HudTexRec>;
    cap: HudTexRec;
    rowPlace: Record<string, HudPlacement>;
    barPlace: HudPlacement;
    capPlace: HudPlacement;
    modetxt: HudPlacement;
    scoretxt1: HudPlacement;
    scoretxt2: HudPlacement;
    rows: Record<string, HudTexRec & { frame: number }>;
    fields: Record<string, Record<string, { x: number; y: number }>>;
    iconPlace: Record<string, { x: number; y: number }>;
  };
  icons: Record<string, HudTexRec & { frame: number }>;
  flags: Record<string, HudTexRec>;
  bloody: { frames: Record<string, HudTexRec>; place: number[] };
  arrow: HudTexRec & { m: number[]; color: number; alpha: number };
  head: {
    plates: HudTexRec[];
    selected: HudTexRec;
    place: Record<string, HudPlacement>;
    slots: number[][];
    select: {
      states: Record<string, string>;
      offX: number; offY: number; w: number; h: number; m: number[];
    };
  };
  speak: {
    closed: HudTexRec;
    open: HudTexRec;
    head: HudPlacement;
    mask: number[][];
    txt_name: { x: number; y: number };
    txt_desc: { x: number; y: number };
  };
  aimer: {
    line: HudTexRec;
    circle: HudTexRec;
    lines: Record<string, HudPlacement>;
    circlePlace: HudPlacement;
  };
  song: {
    states: Partial<Record<"up" | "over" | "down", string>>;
    offX: number; offY: number; w: number; h: number;
    m: number[];
    mNext: number[];
  };
  text: Record<string, HudTextSpec>;
}

const MAN = HUD_MAN;
const TEXT = MAN.text;

const texCache = new Map<string, Texture>();
const artWaiters: Array<() => void> = [];
let artStarted = false;
let artLoaded = false;

function tex(file: string): Texture {
  return texCache.get(file) ?? Texture.EMPTY;
}

export { hudArtUrls };

export function loadHudArt(): Promise<void> {
  return new Promise((resolve) => ensureHudArt(resolve));
}

function ensureHudArt(onReady: () => void): void {
  artWaiters.push(onReady);
  if (artLoaded) {
    for (const cb of artWaiters.splice(0)) cb();
    return;
  }
  if (artStarted) return;
  artStarted = true;

  const files = hudArtFiles();
  const loads = files.map((f) => Assets.load<Texture>(HUD_BASE + f)
    .then((t) => void texCache.set(f, t))
    .catch(() => null));
  const fonts = typeof document !== "undefined" && document.fonts
    ? [...new Set(Object.values(TEXT).map((s) => s.font ?? ""))]
      .filter(Boolean)
      .map((f) => document.fonts.load(`16px "${f}"`).catch(() => null))
    : [];
  void Promise.all([...loads, ...fonts]).then(() => {
    artLoaded = true;
    for (const cb of artWaiters.splice(0)) cb();
  });
}

const IDENTITY_PLACE: HudPlacement = { m: [1, 0, 0, 1, 0, 0] };

const SB_MASK = [134.2, 1.1, 143.6, 16.7, 18.3, 16.7, 8.9, 1.1];
const SB_SLASH = [136.65, -0.75, 147.65, 18.25, 144.15, 18.25, 133.15, -0.75];

function dress(sp: Sprite, rec: HudTexRec, place: HudPlacement,
               dx = 0, dy = 0, kx = 1): void {
  sp.texture = tex(rec.file);
  sp.anchor.set(rec.ox / (rec.w || 1), rec.oy / (rec.h || 1));
  const m = place.m;
  sp.setFromMatrix(new Matrix(m[0] * kx, m[1] * kx, m[2], m[3],
    m[4] + dx, m[5] + dy));
}

function boxWidthScale(m: readonly number[], w: number, h: number,
                       want: number): number {
  const box = Math.abs(m[0]) * w + Math.abs(m[2]) * h;
  return box > 0 ? want / box : 0;
}

function at(name: string): { x: number; y: number } {
  const m = (MAN.children[name]?.m ?? [1, 0, 0, 1, 0, 0]);
  return { x: m[4], y: m[5] };
}

type Anchor = "left" | "centre" | "right";

const ANCHOR: Readonly<Record<string, Anchor>> = {
  scorebar: "left", mc_mode: "left", flags: "left", txt_flags: "left",
  debug: "left",
  txt_feed: "right",
  mc_class: "left", txt_classname: "left", txt_level: "left",
  txt_hp: "left", txt_ar: "left",
  txt_ammo: "right", txt_spare: "right", txt_curgun: "right",
  txt_streakready: "right", mc_streak: "right", mc_streakarrow: "right",
};

function anchorOf(name: string): Anchor {
  return ANCHOR[name] ?? "centre";
}

interface Field {
  t: Text;
  bx: number; by: number;
  w: number;
  align: string;
  anchor: Anchor;
}

function fieldStyle(cid: number): TextStyleOptions {
  const s = TEXT[String(cid)];
  const align = s?.align === "justify" ? "left" : (s?.align ?? "left");
  return {
    fontFamily: [s?.font ?? "QTypeSquare-Book", "Verdana", "sans-serif"],
    fontSize: s?.size ?? 12,
    fill: s?.color ?? COLOR.text,
    align: align as TextStyleOptions["align"],
    wordWrap: s?.wordWrap ?? false,
    wordWrapWidth: s?.w ?? 200,
    lineHeight: s?.size ? s.size + (s?.leading ?? 0) : undefined,
  };
}

const GUTTER = 2;

function placeField(f: Field, off: (a: Anchor) => number, dy: number): void {
  const bx = f.bx + off(f.anchor), by = f.by + dy + GUTTER;
  if (f.align === "center") {
    f.t.anchor.set(0.5, 0);
    f.t.position.set(bx + f.w / 2, by);
  } else if (f.align === "right") {
    f.t.anchor.set(1, 0);
    f.t.position.set(bx + f.w - GUTTER, by);
  } else {
    f.t.anchor.set(0, 0);
    f.t.position.set(bx + GUTTER, by);
  }
}

function newFieldText(cid: number, bx: number, by: number, initial = ""): Text {
  const s = TEXT[String(cid)];
  const t = new Text({ roundPixels: true, text: initial, style: new TextStyle(fieldStyle(cid)) });
  t.alpha = s?.alpha ?? 1;
  placeField({ t, bx, by, w: s?.w ?? 0, align: s?.align ?? "left",
    anchor: "centre" }, () => 0, 0);
  return t;
}

function fieldAt(cid: number, name: string, initial = ""): Text {
  const s = TEXT[String(cid)];
  const p = at(name);
  return newFieldText(cid, p.x + (s?.x ?? 0), p.y + (s?.y ?? 0), initial);
}

const PAUSE_SEED: Readonly<Record<string, number>> = {
  qual: 3696, eff: 3695, glow: 3694, music: 3693, sound: 3692,
  voice: 3691, shake: 3690, bloody: 3689, gore: 3688, right: 3687,
};

export const PAUSE_ROWS: readonly { id: string; y: number; textX: number; butX: number }[] = [
  { id: "qual", y: 154.7, textX: 610, butX: 604.5 },
  { id: "eff", y: 175.3, textX: 610, butX: 604.5 },
  { id: "glow", y: 193.7, textX: 610, butX: 604.5 },
  { id: "song", y: 215.5, textX: 610, butX: 604.5 },
  { id: "music", y: 234.5, textX: 610, butX: 604.5 },
  { id: "sound", y: 252.2, textX: 610, butX: 604.5 },
  { id: "voice", y: 271.9, textX: 1044.9, butX: 1039.4 },
  { id: "shake", y: 312.6, textX: 610, butX: 604.5 },
  { id: "bloody", y: 332.1, textX: 610, butX: 604.5 },
  { id: "gore", y: 350.1, textX: 610, butX: 604.5 },
  { id: "right", y: 368.2, textX: 574.0, butX: 568.7 },
];

export function getUnitColour(unit: { human: boolean; team: number }): number {
  if (unit.human) return 0x99ccff;
  if (unit.team === 1) return 0x6699ff;
  return 0xff6600;
}

export const HUD_GLOW = [
  { kind: "dropShadow", distance: 5, angle: 45, color: 0x000000, alpha: 1, blurX: 5, blurY: 5, strength: 1, quality: 1 },
  { kind: "glow", color: 0x00ffff, alpha: 1, blurX: 3, blurY: 3, strength: 1, quality: 1 },
] as const;

export const HUD_SHADOW = [HUD_GLOW[0]] as const;

export interface FeedUnit {
  readonly name: string;
  readonly human: boolean;
  readonly team: number;
}

export interface FeedEntry {
  txt: string[];
  col: number[];
  timer: number;
}

export interface HudHead {
  readonly hero: FigureHero;
  readonly cls: string;
  readonly status: number;
}

interface HeadTile {
  root: Container;
  plate: Sprite;
  figure: MenuFigure;
  crop: Graphics;
  glyph: Sprite;
  ring: Sprite;
}

export interface HudScoreRow {
  y: number;
  frame: string;
  name: string;
  score: string;
  kills: string;
  deaths: string;
  cls: string;
  status: string;
}

export interface HudOptions {
  graphQual: number;
  graphPart: number;
  graphLights: boolean;
  music: boolean;
  sound: boolean;
  voices: boolean;
  screenShake: boolean;
  screenBlood: boolean;
  blood: number;
  rightclick: number;
}

export type HudMode = "start" | "idle" | "pause" | "end"
  | "tutmove" | "tutswitch" | "tutstreak" | "tutmember";

export const HUD_STATE_FRAME: Readonly<Record<HudMode, number>> = {
  idle: 1, tutmove: 2, tutswitch: 3, tutstreak: 4, tutmember: 5,
  pause: 8, start: 9, end: 101,
};

const LIVE_MODES: ReadonlySet<HudMode> = new Set<HudMode>([
  "idle", "tutmove", "tutswitch", "tutstreak", "tutmember", "start",
]);

const FULL_PLATE: ReadonlySet<HudMode> = new Set<HudMode>(["pause"]);

const CENTER_PANEL: ReadonlySet<HudMode> = new Set<HudMode>(["end"]);
const CENTER_L = 200;
const CENTER_R = 600;

const START_LEN = 92;

function startCardAlpha(f: number): number {
  if (f <= 2) return f * 0.5;
  if (f <= 55) return 1;
  return Math.max(0, 1 - (f - 55) * 0.25);
}

const VEIL_HOLD = 0.81;
function startVeilAlpha(f: number): number {
  if (f <= 8) return 1 - (1 - VEIL_HOLD) * (f / 8);
  if (f <= 60) return VEIL_HOLD;
  return Math.max(0, VEIL_HOLD * (1 - (f - 60) / 7));
}

export function bloodyFrame(frame: number): "1" | "2" {
  return frame === 2 ? "2" : "1";
}

function makeBloodyTexture(blank: boolean, flipX: number, flipY: number): Texture {
  const from = (Texture as unknown as {
    from?: (source: HTMLCanvasElement) => Texture;
  }).from;
  if (typeof document === "undefined" || typeof from !== "function") {
    return Texture.EMPTY;
  }
  const w = Math.max(2, Math.round(Config.GAME_WIDTH));
  const h = Math.max(2, Math.round(Config.GAME_HEIGHT));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d");
  if (!g) return Texture.EMPTY;

  if (!blank) {
    const cx = w / 2;
    const cy = h / 2;
    const inner = Math.min(w, h) * 0.30;
    const outer = Math.hypot(w, h) * 0.62;
    const vig = g.createRadialGradient(cx, cy, inner, cx, cy, outer);
    vig.addColorStop(0, "rgba(140,0,0,0)");
    vig.addColorStop(0.55, "rgba(170,8,8,0.30)");
    vig.addColorStop(1, "rgba(215,26,26,0.92)");
    g.fillStyle = vig;
    g.fillRect(0, 0, w, h);

    let seed = 0x2f6e2b1 ^ (flipX < 0 ? 0x9e3779b9 : 0)
      ^ (flipY < 0 ? 0x85ebca6b : 0);
    const rnd = (): number => {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = 0; i < 56; i++) {
      const side = Math.floor(rnd() * 4);
      const u = rnd();
      const inset = Math.pow(rnd(), 2) * Math.min(w, h) * 0.28;
      let x = 0;
      let y = 0;
      if (side === 0) { x = u * w; y = inset; }
      else if (side === 1) { x = w - inset; y = u * h; }
      else if (side === 2) { x = u * w; y = h - inset; }
      else { x = inset; y = u * h; }
      if (flipX < 0) x = w - x;
      if (flipY < 0) y = h - y;
      const r = Math.min(w, h) * (0.03 + rnd() * 0.10);
      const a = 0.18 + rnd() * 0.34;
      const blob = g.createRadialGradient(x, y, 0, x, y, r);
      blob.addColorStop(0, `rgba(190,14,14,${a})`);
      blob.addColorStop(0.7, `rgba(165,10,10,${a * 0.6})`);
      blob.addColorStop(1, "rgba(150,0,0,0)");
      g.fillStyle = blob;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
  }
  return from(canvas);
}

export class Hud extends Container {
  mode: HudMode = "start";

  private plateL = new Sprite();
  private plateR = new Sprite();
  private plateMaskL = new Graphics();
  private plateMaskR = new Graphics();
  private plateFull = new Sprite();
  private plateBack = new Sprite();
  private plateMaskFull = new Graphics();
  private plateMaskBack = new Graphics();
  private plateC = new Sprite();
  private plateMaskC = new Graphics();
  private backdropCache = new Map<string, Texture>();
  private bloody = new Sprite();
  private hudBg = new Container();
  private barsL = new Container();
  private barsR = new Container();
  private barSprites: Record<string, Sprite> = {};
  private scorebarC = new Container();
  private sbRows = [new Container(), new Container()];
  private sbBars: Sprite[] = [];
  private sbCaps: Sprite[] = [];
  private flagCont = new Container();
  private flagSprites: Sprite[] = [];
  private flagLetters: Text[] = [];
  private arrowSprite = new Sprite();
  private mcClass = new Sprite();
  private mcStreak = new Sprite();
  private mcMode = new Sprite();
  private mcStartmode = new Sprite();
  private startCard = new Container();
  private startVeil = new Graphics();
  private startFrame = 0;
  private speak = new Container();
  private speakBox = new Sprite();
  private speakMask = new Graphics();
  private figure = new MenuFigure();

  private txtHp: Text;
  private txtAr: Text;
  private txtCurgun: Text;
  private txtAmmo: Text;
  private txtSpare: Text;
  private txtStreakready: Text;
  private txtClassname: Text;
  private txtLevel: Text;
  private txtRespawn: Text;
  private txtFlags: Text;
  private txtWin: Text;
  private txtStartTitle: Text;
  private txtStartDesc: Text;
  private txtSpeakName: Text;
  private txtSpeakDesc: Text;
  private modetxt: Text;
  private scoreTxt1: Text;
  private scoreTxt2: Text;
  private txtFeed = new Container();
  private debugTxts: Text[] = [];
  private barCont = new Container();
  private pauseCont = new Container();
  private pauseMask = new Graphics();
  private pauseSong!: Text;
  private pauseResume!: Text;
  private pauseQuit!: Text;
  private songPrev = new Sprite();
  private songNext = new Sprite();
  private songPrevHover = false;
  private songNextHover = false;
  private pauseTxts = new Map<string, Text>();
  private headCont = new Container();
  private headTiles: HeadTile[] = [];
  private selectBtn = new Sprite();
  private heads: (HudHead | null)[] = [null, null, null, null, null];
  private headSel = -1;
  private headsShown = false;
  private selectShown = false;
  private fields: Field[] = [];

  readonly radar = new Radar();

  readonly feeds: FeedEntry[] = [];
  private hpCur = 0;
  private hpMax = 1;
  private arCur = 0;
  private arMax = 1;
  private ammoFrac = 1;
  private streakFrac = 0;
  private streakArrow = false;
  private streakGlow = false;
  private score1 = 0;
  private score2 = 0;
  private team1 = 1;
  private team2 = 2;
  private useScore = 1;
  private bloodyAlpha = 0;
  private bloodyFlipX = 1;
  private bloodyFlipY = 1;
  private bloodyFrameKey: "1" | "2" = "1";
  private bloodyTex: Texture | null = null;
  private bloodyTexKey = "";
  private msgTimer = 0;
  private msgForce = false;
  private respawnTimer = 0;
  private debugOpen = false;

  get storyMsgOpen(): boolean {
    return this.msgTimer > 0;
  }

  private flagTeams: number[] = [0, 0, 0];

  private classIcon = "sni";
  private streakIcon: string | null = null;
  private speakHero: FigureHero | null = null;
  private modeIcon = "dm";

  options: HudOptions | null = null;

  constructor() {
    super();
    this.plateL.mask = this.plateMaskL;
    this.plateR.mask = this.plateMaskR;
    this.plateFull.mask = this.plateMaskFull;
    this.plateC.mask = this.plateMaskC;
    this.plateBack.mask = this.plateMaskBack;
    this.addChild(this.bloody,
      this.plateMaskL, this.plateMaskR, this.plateMaskFull, this.plateMaskC,
      this.plateMaskBack,
      this.plateBack, this.plateL, this.plateR, this.plateC, this.plateFull,
      this.hudBg);
    this.hudBg.addChild(this.barsL, this.barsR);
    for (const key of ["hp", "ar", "ammo", "streak"]) {
      const sp = new Sprite();
      this.barSprites[key] = sp;
      (key === "hp" || key === "ar" ? this.barsL : this.barsR).addChild(sp);
    }
    this.addChild(this.scorebarC, this.txtFeed, this.flagCont, this.arrowSprite);
    this.addChild(this.mcStreak, this.mcClass, this.mcMode);
    this.addChild(this.speak);

    for (let i = 0; i < 2; i++) {
      const clip = new Container();
      const mask = new Graphics().poly(SB_MASK).fill({ color: 0xffffff });
      clip.addChild(this.sbBars[i] = new Sprite(),
        this.sbCaps[i] = new Sprite());
      clip.mask = mask;
      this.sbRows[i].addChild(mask, clip,
        new Graphics().poly(SB_SLASH).fill({ color: 0xffffff }));
      this.scorebarC.addChild(this.sbRows[i]);
    }
    const sbx = at("scorebar");
    this.modetxt = this.makeFieldAt(3597,
      sbx.x + MAN.scorebar.modetxt.m[4], sbx.y + MAN.scorebar.modetxt.m[5],
      "", "left");
    this.scoreTxt1 = this.makeFieldAt(3598,
      sbx.x + MAN.scorebar.scoretxt1.m[4], sbx.y + MAN.scorebar.scoretxt1.m[5],
      "", "left");
    this.scoreTxt2 = this.makeFieldAt(3599,
      sbx.x + MAN.scorebar.scoretxt2.m[4], sbx.y + MAN.scorebar.scoretxt2.m[5],
      "", "left");
    this.scorebarC.addChild(this.modetxt, this.scoreTxt1, this.scoreTxt2);

    for (let i = 0; i < 3; i++) {
      const sp = new Sprite();
      this.flagSprites.push(sp);
      this.flagLetters.push(newFieldText(3603, 0, 0, String.fromCharCode(65 + i)));
      this.flagCont.addChild(sp, this.flagLetters[i]);
    }

    this.txtHp = this.makeField(3584, "txt_hp");
    this.txtHp.style.fill = 0xffffff;
    this.txtAr = this.makeField(3611, "txt_ar");
    this.txtCurgun = this.makeField(3582, "txt_curgun");
    this.txtAmmo = this.makeField(3612, "txt_ammo");
    this.txtSpare = this.makeField(3583, "txt_spare");
    this.txtStreakready = this.makeField(3586, "txt_streakready");
    this.txtClassname = this.makeField(3585, "txt_classname");
    this.txtLevel = this.makeField(3581, "txt_level");
    this.txtRespawn = this.makeField(3617, "txt_respawn");
    this.txtFlags = this.makeField(3610, "txt_flags");
    this.txtWin = this.makeField(3711, "txt_win");
    for (const t of [
      this.txtHp, this.txtAr, this.txtCurgun, this.txtAmmo, this.txtSpare,
      this.txtStreakready, this.txtClassname, this.txtLevel, this.txtRespawn,
      this.txtFlags, this.txtWin,
    ]) this.addChild(t);
    this.addChild(this.txtFeed, this.barCont, this.pauseCont, this.pauseMask);
    this.pauseCont.mask = this.pauseMask;

    this.speak.addChild(this.speakBox, this.speakMask, this.figure.view);
    this.speakMask
      .poly(MAN.speak.mask.flat())
      .fill({ color: 0xffffff });
    this.figure.view.mask = this.speakMask;
    this.txtSpeakName = newFieldText(3619, MAN.speak.txt_name.x + (TEXT["3619"]?.x ?? 0),
      MAN.speak.txt_name.y + (TEXT["3619"]?.y ?? 0));
    this.txtSpeakDesc = newFieldText(3621, MAN.speak.txt_desc.x + (TEXT["3621"]?.x ?? 0),
      MAN.speak.txt_desc.y + (TEXT["3621"]?.y ?? 0));
    this.speak.addChild(this.txtSpeakName, this.txtSpeakDesc);

    this.txtStartTitle = fieldAt(3702, "txt_starttitle");
    this.txtStartDesc = fieldAt(3701, "txt_startdesc");
    this.startCard.addChild(this.mcStartmode, this.txtStartTitle, this.txtStartDesc);

    for (let i = 1; i <= 3; i++) {
      const t = label("", 4, (i - 1) * 14, { fontSize: 10, fill: 0x66ff99 });
      this.debugTxts.push(t);
      this.addChild(t);
    }

    this.txtWin.visible = false;
    this.buildPause();
    this.buildHeads();
    this.addChild(this.startVeil, this.startCard);
    this.addChild(this.radar);
    this.layout();
    this.applyArt();
    ensureHudArt(() => this.applyArt());
  }

  private makeField(cid: number, place: string, initial = ""): Text {
    const m = at(place);
    return this.makeFieldAt(cid, m.x, m.y, initial, anchorOf(place));
  }

  private makeFieldAt(cid: number, x: number, y: number, initial = "",
                      anchor: Anchor = "centre"): Text {
    const s = TEXT[String(cid)];
    const bx = x + (s?.x ?? 0), by = y + (s?.y ?? 0);
    const f: Field = {
      t: newFieldText(cid, bx, by, initial),
      bx, by, w: s?.w ?? 0, align: s?.align ?? "left", anchor,
    };
    this.fields.push(f);
    return f.t;
  }

  layout(): void {
    const W = Config.GAME_WIDTH;
    const H = Config.GAME_HEIGHT;
    const surplus = W - Config.DESIGN_WIDTH;
    const dx = surplus / 2;
    const off = (a: Anchor): number =>
      a === "left" ? 0 : a === "right" ? surplus : dx;
    const dy = H - Config.DESIGN_HEIGHT;

    const centred = CENTER_PANEL.has(this.mode);
    const mL = centred ? CENTER_L : Config.DESIGN_WIDTH / 2;
    const mR = centred ? CENTER_R : Config.DESIGN_WIDTH / 2;
    for (const [sp, gfx, x, edge, right] of [
      [this.plateL, this.plateMaskL, 0, mL, false],
      [this.plateR, this.plateMaskR, surplus, mR, true],
    ] as [Sprite, Graphics, number, number, boolean][]) {
      sp.position.set(x, dy);
      sp.width = Config.DESIGN_WIDTH;
      sp.height = Config.DESIGN_HEIGHT;
      gfx.clear();
      gfx.rect(right ? x + edge : -W, dy,
        right ? W + Config.DESIGN_WIDTH - edge : W + edge,
        Config.DESIGN_HEIGHT).fill({ color: 0xffffff });
    }

    this.plateFull.position.set(dx, dy);
    this.plateFull.width = Config.DESIGN_WIDTH;
    this.plateFull.height = Config.DESIGN_HEIGHT;
    this.plateC.position.set(dx, dy);
    this.plateC.width = Config.DESIGN_WIDTH;
    this.plateC.height = Config.DESIGN_HEIGHT;
    this.plateMaskFull.clear();
    this.plateMaskFull.rect(0, dy, W, Config.DESIGN_HEIGHT)
      .fill({ color: 0xffffff });
    this.plateMaskC.clear();
    this.plateMaskC.rect(dx + CENTER_L, dy, CENTER_R - CENTER_L,
      Config.DESIGN_HEIGHT).fill({ color: 0xffffff });
    this.plateBack.position.set(0, dy);
    this.plateBack.width = W;
    this.plateBack.height = Config.DESIGN_HEIGHT;
    this.plateMaskBack.clear();
    const leftW = Math.max(0, dx);
    const rightX = Math.min(W, dx + Config.DESIGN_WIDTH);
    if (leftW > 0) {
      this.plateMaskBack.rect(0, dy, leftW, Config.DESIGN_HEIGHT)
        .fill({ color: 0xffffff });
    }
    if (W - rightX > 0) {
      this.plateMaskBack.rect(rightX, dy, W - rightX, Config.DESIGN_HEIGHT)
        .fill({ color: 0xffffff });
    }
    this.applyBloody();

    const bg = MAN.children["hud_bg"].m;
    this.hudBg.setFromMatrix(new Matrix(1, 0, 0, 1, bg[4], bg[5] + dy));
    this.barsL.x = 0;
    this.barsR.x = surplus;

    const sb = at("scorebar");
    for (let i = 0; i < 2; i++) {
      const p = MAN.scorebar.rowPlace[String(i + 1)].m;
      this.sbRows[i].setFromMatrix(new Matrix(p[0], p[1], p[2], p[3],
        sb.x + p[4] + off(anchorOf("scorebar")), sb.y + p[5] + dy));
    }

    for (const f of this.fields) placeField(f, off, dy);
    this.txtFeed.position.set(off(anchorOf("txt_feed")), dy);

    const flagX = [25, 58, 91];
    const ls = TEXT["3603"];
    const lx = -12 + (ls?.x ?? 0) + (ls?.w ?? 0) / 2;
    const ly = 15 + (ls?.y ?? 0) + GUTTER;
    for (let i = 0; i < 3; i++) {
      this.flagSprites[i].setFromMatrix(new Matrix(1, 0, 0, 1, flagX[i], 80 + dy));
      this.flagLetters[i].position.set(flagX[i] + lx, 80 + dy + ly);
    }

    this.placeIcon(this.mcClass, "mc_class", off, dy, this.iconPx(this.classIcon));
    this.placeIcon(this.mcStreak, "mc_streak", off, dy,
      this.iconPx(this.streakIcon ?? this.classIcon));
    this.placeIcon(this.mcMode, "mc_mode", off, dy, this.iconPx(this.modeIcon));
    this.placeIcon(this.arrowSprite, "mc_streakarrow", off, dy);
    this.placeIcon(this.mcStartmode, "mc_startmode", () => 0, 0,
      this.iconPx(this.modeIcon));
    this.startCard.position.set(dx, dy);

    this.startVeil.clear();
    this.startVeil.rect(0, 0, W, H).fill({ color: 0x000000 });

    const speakAt = at("mc_speak");
    this.speak.setFromMatrix(
      new Matrix(1, 0, 0, 1, speakAt.x + dx, speakAt.y + dy));

    this.barCont.position.set(dx, dy);
    this.placeBarCont();
    this.radar.position.set(W - Radar.VIEW_W, 0);
    for (let i = 0; i < this.debugTxts.length; i++) {
      this.debugTxts[i].position.set(-0.5 + 4, -84.5 + dy + 100 + i * 14);
      this.debugTxts[i].visible = this.debugOpen;
    }
    this.pauseCont.x = dx;
    this.pauseCont.y = dy;
    this.pauseMask.clear();
    this.pauseMask.rect(dx, dy, Config.DESIGN_WIDTH, Config.DESIGN_HEIGHT)
      .fill({ color: 0xffffff });
    this.applyHeads();
    this.applyBars();
    this.applyScore();
    this.applyBloody();
    this.applySongButtons();
  }

  private applySongButtons(): void {
    const s = MAN.song;
    const up = s.states.up ?? "";
    const over = s.states.over ?? up;
    this.songPrev.texture = tex(this.songPrevHover ? over : up);
    this.songNext.texture = tex(this.songNextHover ? over : up);
    this.songPrev.position.set(s.m[4] + s.offX, s.m[5] + s.offY);
    this.songNext.position.set(s.mNext[4] - s.offX, s.mNext[5] + s.offY);
    const show = this.mode === "pause" && !MatchSettings.useSong;
    this.songPrev.visible = show;
    this.songNext.visible = show;
  }

  private iconPx(label: string | undefined): number {
    return (label && MAN.icons[label]?.px) || 1;
  }

  private placeIcon(sp: Sprite, name: string,
                    off: (a: Anchor) => number, dy: number, px = 1): void {
    const dx = off(anchorOf(name));
    const m = MAN.children[name].m;
    const k = 1 / px;
    sp.setFromMatrix(new Matrix(m[0] * k, m[1] * k, m[2] * k, m[3] * k,
                                m[4] + dx, m[5] + dy));
  }

  private placeBarCont(): void {
    const dx = (Config.GAME_WIDTH - Config.DESIGN_WIDTH) / 2;
    const dy = Config.GAME_HEIGHT - Config.DESIGN_HEIGHT;
    const end = this.mode === "end";
    this.barCont.position.set((end ? 242.3 : 132.3) + dx,
      (end ? 175.35 : 135.35) + dy);
  }

  setHealth(cur: number, max: number): void {
    this.hpCur = cur;
    this.hpMax = max || 1;
    this.txtHp.text = String(Math.ceil(cur));
    this.applyBars();
  }

  setArmor(cur: number, max: number): void {
    this.arCur = cur;
    this.arMax = max || 1;
    this.txtAr.text = String(Math.ceil(cur));
    this.applyBars();
  }

  setBloodyScreen(alpha: number): void {
    this.bloodyAlpha = alpha;
    this.applyBloody();
  }

  resetBloodyScreen(scaleX: number, scaleY: number, frame: number): void {
    this.bloodyFlipX = scaleX < 0 ? -1 : 1;
    this.bloodyFlipY = scaleY < 0 ? -1 : 1;
    this.bloodyFrameKey = bloodyFrame(frame);
    this.bloodyAlpha = 0;
    this.applyBloody();
  }

  get bloodyState(): { flipX: number; flipY: number; frame: string; alpha: number } {
    return {
      flipX: this.bloodyFlipX, flipY: this.bloodyFlipY,
      frame: this.bloodyFrameKey, alpha: this.bloody.alpha,
    };
  }

  setAmmoCount(gun: {
    noAmmo: boolean; clipAmmo: number; clipSize: number;
    spareAmmo: number; spareMax: number;
  }): void {
    if (gun.noAmmo) {
      this.txtAmmo.text = "-";
      this.txtSpare.text = "---";
      this.ammoFrac = 1;
    } else {
      this.txtAmmo.text = String(Math.ceil(gun.clipAmmo));
      this.ammoFrac = gun.clipSize ? gun.clipAmmo / gun.clipSize : 0;
      this.txtSpare.text = padSpare(gun.spareAmmo, gun.spareMax);
    }
    this.applyBars();
  }

  setGuns(curGun: { name: string }, _nextGun?: { name: string }): void {
    this.txtCurgun.text = curGun.name;
  }

  setKillstreakNum(amt: number, streakVal: number): void {
    this.streakFrac = streakVal ? amt / streakVal : 0;
    this.streakArrow = amt === streakVal;
    this.applyBars();
  }

  setStreakReady(name: string): void {
    this.txtStreakready.text = name + " ready!";
    this.streakArrow = true;
    this.streakGlow = true;
    this.applyBars();
  }

  clearStreak(): void {
    this.txtStreakready.text = "";
    this.streakArrow = false;
    this.streakGlow = false;
    this.applyBars();
  }

  setStreakInProgress(label = true): void {
    this.streakArrow = false;
    this.streakGlow = false;
    if (label) this.txtStreakready.text = "In Progress!";
    this.applyBars();
  }

  setHudStuff(clsName: string, level: number, modeName: string, streak = ""): void {
    const cls = itemOb[clsName];
    this.setPlayerInfo(cls ? cls.name : clsName, level);
    this.setClassIcon(clsName);
    if (streak) this.setStreakIcon(streak);
    this.modetxt.text = modeName;
    const mode = GAME_MODE_IDS.map((id) => getGameMode(id)).find((m) => m.name === modeName);
    this.modeIcon = mode?.sprite ?? "dm";
    this.txtStartTitle.text = modeName;
    this.txtStartDesc.text = mode?.desc ?? "";
    this.applyIcons();
  }

  setPlayerInfo(displayName: string, level: number): void {
    this.txtClassname.text = displayName;
    this.txtLevel.text = "LVL: " + level;
  }

  setClassIcon(cls: string): void {
    this.classIcon = cls;
    this.applyIcons();
  }

  setStreakIcon(streak: string): void {
    this.streakIcon = streak;
    this.applyIcons();
  }

  setScoreBar(t1: number, s1: number, t2: number, s2: number, useScore: number): void {
    this.team1 = t1;
    this.team2 = t2;
    this.score1 = s1;
    this.score2 = s2;
    this.useScore = useScore || 1;
    this.scoreTxt1.text = "> " + s1;
    this.scoreTxt2.text = "" + s2;
    this.applyScore();
  }

  addKillFeed(
    killer: FeedUnit | null, dead: FeedUnit, weaponLabel: string,
  ): void {
    const deadCol = getUnitColour(dead);
    if (!killer || killer === dead) {
      this.feeds.unshift({
        txt: ["Suicide", ` [${weaponLabel}] `, dead.name],
        col: [0xff99ff, 0xcccccc, deadCol],
        timer: 90,
      });
    } else {
      this.feeds.unshift({
        txt: [killer.name, ` [${weaponLabel}] `, dead.name],
        col: [getUnitColour(killer), 0xcccccc, deadCol],
        timer: 90,
      });
    }
    this.processFeed();
  }

  addKillstreakFeed(user: FeedUnit, streakName: string): void {
    this.feeds.unshift({
      txt: [user.name, " used killstreak ", streakName],
      col: [getUnitColour(user), 0xcccccc, 0xccffff],
      timer: 90,
    });
    this.processFeed();
  }

  addCustomFeed(unit: FeedUnit, kind: string): void {
    const col = getUnitColour(unit);
    switch (kind) {
      case "levelup":
        this.feeds.unshift({
          txt: [unit.name, " has LEVELED UP"], col: [col, 0xffff00], timer: 90,
        });
        break;
      case "flag":
        this.feeds.unshift({
          txt: [`${unit.name} has captured ${unit.team === 1 ? "the enemy" : "your"} flag!`],
          col: [col], timer: 90,
        });
        break;
      case "jug":
        this.feeds.unshift({
          txt: [`${unit.name} is the One Man Army!`], col: [col], timer: 90,
        });
        break;
      case "holdpoint":
        this.feeds.unshift({
          txt: [`${unit.team === 1 ? "An enemy" : "Your"} point has been captured!`],
          col: [col], timer: 90,
        });
        break;
      default:
        return;
    }
    this.processFeed();
  }

  private processFeed(): void {
    if (this.feeds.length > 13) this.feeds.pop();

    const spec = TEXT["3601"];
    const feedAt = at("txt_feed");
    const right = feedAt.x + (spec?.x ?? 0) + (spec?.w ?? 0);
    const top = feedAt.y + (spec?.y ?? 0);

    this.txtFeed.removeChildren();
    let y = 0;
    for (const feed of this.feeds) {
      let lineW = 0;
      for (let j = 0; j < feed.txt.length; j++) {
        lineW += widthOf(feed.txt[j], 12, j === feed.txt.length - 1
          ? "" : feed.txt[j + 1].charAt(0));
      }
      let x = right - lineW;
      for (let j = 0; j < feed.txt.length; j++) {
        const isLast = j === feed.txt.length - 1;
        const bleed = isLast ? "" : feed.txt[j + 1].charAt(0);
        const t = label(feed.txt[j] + bleed, x, top + y, {
          fontSize: 12, fill: feed.col[j] ?? 0xcccccc,
        });
        this.txtFeed.addChild(t);
        x += widthOf(feed.txt[j], 12);
      }
      y += (spec?.size ?? 12) + (spec?.leading ?? 2);
    }
  }

  setRespawnText(txt: string, col = 0xffffff): void {
    this.txtRespawn.text = txt;
    this.txtRespawn.style.fill = col;
    this.respawnTimer = 3 * 30;
  }

  setMsg(name: string, desc: string, timer = 4, force = false,
         hero?: FigureHero): boolean {
    if (this.msgForce && !force) return false;
    this.msgForce = force;
    this.msgTimer = timer * 30;
    this.txtSpeakName.text = name;
    this.txtSpeakDesc.text = desc;
    if (hero) {
      this.speakHero = hero;
      this.figure.setHeadOnly(hero, MAN.speak.head.m);
      this.figure.view.visible = true;
    }
    this.showSpeak(true);
    return true;
  }

  private showSpeak(open: boolean): void {
    dress(this.speakBox, open ? MAN.speak.open : MAN.speak.closed,
      { m: [1, 0, 0, 1, 0, 0] });
    const live = LIVE_MODES.has(this.mode) || this.mode === "pause";
    this.speak.visible = open && live && this.msgTimer > 0;
    this.weldSpeak();
  }

  private weldSpeak(): void {
    if (this.speak.visible && this.speakHero) {
      this.figure.setHeadOnly(this.speakHero, MAN.speak.head.m);
    }
  }

  setDebug(slot: number, text: string): void {
    const t = this.debugTxts[slot - 1];
    if (t) t.text = text;
  }

  toggleDebug(): void {
    this.debugOpen = !this.debugOpen;
    for (const t of this.debugTxts) t.visible = this.debugOpen;
  }

  setDomination(holdpointTeams: readonly number[]): void {
    let owned = 0;
    for (let i = 0; i < this.flagTeams.length; i++) {
      const t = holdpointTeams[i] ?? 0;
      this.flagTeams[i] = t;
      if (t === 1) owned++;
      this.setFlag(i, t + 1, String.fromCharCode(65 + i));
      this.flagSprites[i].visible = true;
      this.flagLetters[i].visible = true;
    }
    this.txtFlags.text = `${owned} point${owned !== 1 ? "s" : ""} per 3 sec`;
  }

  setCtf(
    flag1Team: number, flag1Taken: boolean,
    flag2Team: number, flag2Taken: boolean,
  ): void {
    this.flagTeams = [flag1Team, 0, flag2Team];
    this.setFlag(0, flag1Team * 5 + (flag1Taken ? 1 : 0),
      flag1Taken ? (flag1Team === 1 ? "?" : "!") : "");
    this.setFlag(2, flag2Team * 5 + (flag2Taken ? 1 : 0),
      flag2Taken ? (flag2Team === 1 ? "?" : "!") : "");
    this.flagSprites[1].visible = false;
    this.flagLetters[1].visible = false;
    for (const i of [0, 2]) {
      this.flagSprites[i].visible = true;
      this.flagLetters[i].visible = true;
    }
    this.txtFlags.text =
      (flag1Taken && flag1Team === 1) || (flag2Taken && flag2Team === 1)
        ? "Your flag is taken!" : "";
  }

  clearFlags(): void {
    for (let i = 0; i < 3; i++) {
      this.flagSprites[i].visible = false;
      this.flagLetters[i].visible = false;
    }
    this.flagTeams = [0, 0, 0];
  }

  private setFlag(i: number, frame: number, letter: string): void {
    const rec = MAN.flags[String(frame)];
    if (rec) {
      const sp = this.flagSprites[i];
      sp.texture = tex(rec.file);
      sp.anchor.set(rec.ox / (rec.w || 1), rec.oy / (rec.h || 1));
    }
    this.flagLetters[i].text = letter;
  }

  showScores(rows: readonly HudScoreRow[]): void {
    this.barCont.removeChildren();
    for (const r of rows) {
      const rec = MAN.scorebar.rows[r.frame] ?? MAN.scorebar.rows["ffa_ai"];
      const row = new Container();
      row.y = r.y;

      const plate = new Sprite();
      plate.texture = tex(rec.file);
      plate.anchor.set(rec.ox / (rec.w || 1), rec.oy / (rec.h || 1));
      row.addChild(plate);

      const fields = MAN.scorebar.fields[r.frame] ?? MAN.scorebar.fields["ffa_ai"];
      const top = r.frame === "top";
      const field = (cid: number, name: string, text: string): void => {
        const s = TEXT[String(cid)];
        row.addChild(newFieldText(cid,
          fields[name].x + (s?.x ?? 0), fields[name].y + (s?.y ?? 0),
          top ? (s?.default ?? "") : text));
      };
      field(3723, "txt_name", r.name);
      field(3724, "txt_score", r.score);
      field(3725, "txt_kills", r.kills);
      field(3726, "txt_deaths", r.deaths);

      const icon = (labelName: string, x: number, y: number): void => {
        const ir = MAN.icons[labelName];
        if (!ir) return;
        const sp = new Sprite();
        sp.texture = tex(ir.file);
        sp.anchor.set(ir.ox / (ir.w || 1), ir.oy / (ir.h || 1));
        sp.scale.set(1 / (ir.px ?? 1));
        sp.position.set(x, y);
        row.addChild(sp);
      };
      if (r.cls) icon(r.cls, MAN.scorebar.iconPlace.icon_class.x,
        MAN.scorebar.iconPlace.icon_class.y);
      if (r.status === "dm") icon("dm", MAN.scorebar.iconPlace.icon_status.x,
        MAN.scorebar.iconPlace.icon_status.y);

      this.barCont.addChild(row);
    }
  }

  private buildPause(): void {
    this.pauseCont.visible = false;
    for (const r of PAUSE_ROWS) {
      const cid = PAUSE_SEED[r.id];
      if (cid === undefined) continue;
      const t = fieldAt(cid, "txt_" + r.id);
      this.pauseTxts.set(r.id, t);
      this.pauseCont.addChild(t);
    }
    this.pauseSong = fieldAt(3685, "txt_song");
    this.pauseResume = fieldAt(3686, "txt_resume", "Resume");
    this.pauseQuit = fieldAt(3684, "txt_quit", "Quit");
    this.songPrev.anchor.set(0, 0);
    this.songNext.anchor.set(0, 0);
    this.songNext.scale.x = -1;
    this.pauseCont.addChild(this.songPrev, this.songNext);
    this.pauseCont.addChild(this.pauseSong, this.pauseResume, this.pauseQuit);
  }

  setPauseText(o: HudOptions): void {
    this.options = o;
    const onoff = (b: boolean): string => (b ? "On" : "Off");
    const three = ["Low", "Medium", "High"];
    const set = (id: string, v: string): void => {
      const t = this.pauseTxts.get(id);
      if (t) t.text = v;
    };
    set("qual", three[o.graphQual] ?? "");
    set("eff", three[o.graphPart] ?? "");
    set("glow", onoff(o.graphLights));
    if (this.pauseSong) this.pauseSong.text = SH.currentSongName() || "—";
    set("music", onoff(o.music));
    set("sound", onoff(o.sound));
    set("voice", onoff(o.voices));
    set("shake", onoff(o.screenShake));
    set("bloody", onoff(o.screenBlood));
    set("gore", three[o.blood] ?? "");
    set("right", ["Reload", "Killstreak", "Swap Gun"][o.rightclick] ?? "");
  }

  hitPauseRow(): string | null {
    const dx = (Config.GAME_WIDTH - Config.DESIGN_WIDTH) / 2;
    for (const r of PAUSE_ROWS) {
      if (r.butX - 4 + 90 > Config.DESIGN_WIDTH) continue;
      if (hitTest(r.butX + dx - 4, r.y - 2, 90, 20)) return r.id;
    }
    return null;
  }

  private registerPauseFocus(): void {
    const dx = (Config.GAME_WIDTH - Config.DESIGN_WIDTH) / 2;
    for (const r of PAUSE_ROWS) {
      if (r.butX - 4 + 90 > Config.DESIGN_WIDTH || r.id === "song") continue;
      focusable(r.butX + dx - 4, r.y - 2, 90, 20);
    }
    const confirming = this.quitConfirm;
    focusable(127.8 + dx, 458, 110, 26, { back: !confirming });
    focusable(542.8 + dx, 458, 110, 26, { back: confirming });
  }

  hitResume(): boolean {
    const dx = (Config.GAME_WIDTH - Config.DESIGN_WIDTH) / 2;
    return hitTest(127.8 + dx, 458, 110, 26);
  }

  hitQuit(): boolean {
    const dx = (Config.GAME_WIDTH - Config.DESIGN_WIDTH) / 2;
    return hitTest(542.8 + dx, 458, 110, 26);
  }

  get quitConfirm(): boolean {
    return this.pauseQuit.text === "Cancel";
  }

  setQuitConfirm(on: boolean): void {
    this.pauseResume.text = on ? "Confirm" : "Resume";
    this.pauseQuit.text = on ? "Cancel" : "Quit";
  }

  hitSongPrev(): boolean {
    if (!this.songPrev.visible) return false;
    const s = MAN.song;
    const dx = (Config.GAME_WIDTH - Config.DESIGN_WIDTH) / 2;
    const dy = Config.GAME_HEIGHT - Config.DESIGN_HEIGHT;
    return hitTest(s.m[4] + s.offX + dx, s.m[5] + s.offY + dy, s.w, s.h);
  }

  hitSongNext(): boolean {
    if (!this.songNext.visible) return false;
    const s = MAN.song;
    const dx = (Config.GAME_WIDTH - Config.DESIGN_WIDTH) / 2;
    const dy = Config.GAME_HEIGHT - Config.DESIGN_HEIGHT;
    return hitTest(
      s.mNext[4] - s.offX - s.w + dx, s.mNext[5] + s.offY + dy, s.w, s.h);
  }

  private buildHeads(): void {
    this.addChild(this.headCont, this.selectBtn);
    for (let i = 0; i < 5; i++) {
      const t: HeadTile = {
        root: new Container(), plate: new Sprite(), figure: new MenuFigure(),
        crop: new Graphics(), glyph: new Sprite(), ring: new Sprite(),
      };
      const r = MAN.head.plates[0];
      t.crop.rect(-r.ox, -r.oy, r.w, r.h).fill({ color: 0xffffff });
      t.figure.view.mask = t.crop;
      t.root.addChild(t.plate, t.crop, t.figure.view, t.glyph, t.ring);
      t.root.visible = false;
      this.headCont.addChild(t.root);
      this.headTiles.push(t);
    }
    this.headCont.visible = false;
    this.selectBtn.visible = false;
  }

  setSquadHeads(heads: readonly (HudHead | null)[], selected = -1): void {
    for (let i = 0; i < 5; i++) this.heads[i] = heads[i] ?? null;
    this.headSel = selected;
    this.applyHeads();
  }

  setHeadSelected(i: number): void {
    this.headSel = i;
    this.applyHeads();
  }

  setHeadVisibility(dead: boolean, human: boolean): void {
    this.headsShown = dead || !human;
    this.selectShown = !human;
    const live = LIVE_MODES.has(this.mode);
    this.headCont.visible = this.headsShown && live;
    this.selectBtn.visible = this.selectShown && live;
    this.applyHeads();
  }

  private applyHeads(): void {
    const dx = (Config.GAME_WIDTH - Config.DESIGN_WIDTH) / 2;
    const dy = Config.GAME_HEIGHT - Config.DESIGN_HEIGHT;
    const P = MAN.head.place;
    for (let i = 0; i < 5; i++) {
      const t = this.headTiles[i];
      const h = this.heads[i];
      t.root.visible = !!h;
      if (!h) continue;
      const m = MAN.head.slots[i];
      t.root.setFromMatrix(new Matrix(m[0], m[1], m[2], m[3], m[4] + dx, m[5] + dy));
      const band = Math.max(1, Math.min(4, Math.ceil(h.status / 100)));
      dress(t.plate, MAN.head.plates[band - 1], IDENTITY_PLACE);
      t.figure.setHeadOnly(h.hero, P.head.m);
      this.dressIcon(t.glyph, MAN.icons[h.cls]);
      const g = P.mc_class.m;
      const gp = 1 / (MAN.icons[h.cls]?.px ?? 1);
      t.glyph.setFromMatrix(new Matrix(g[0] * gp, g[1] * gp, g[2] * gp, g[3] * gp,
                                       g[4], g[5]));
      dress(t.ring, MAN.head.selected, P.selected);
      t.ring.visible = i === this.headSel;
    }

    const s = MAN.head.select;
    this.selectBtn.texture = tex(s.states[this.overSelect() ? "over" : "up"]);
    this.selectBtn.position.set(s.m[4] + s.offX + dx, s.m[5] + s.offY + dy);
  }

  private overSelect(): boolean {
    const dx = (Config.GAME_WIDTH - Config.DESIGN_WIDTH) / 2;
    const dy = Config.GAME_HEIGHT - Config.DESIGN_HEIGHT;
    const s = MAN.head.select;
    return hitTest(s.m[4] + s.offX + dx, s.m[5] + s.offY + dy, s.w, s.h);
  }

  hitHead(): number {
    if (!this.headCont.visible) return -1;
    const dx = (Config.GAME_WIDTH - Config.DESIGN_WIDTH) / 2;
    const dy = Config.GAME_HEIGHT - Config.DESIGN_HEIGHT;
    const r = MAN.head.plates[0];
    for (let i = 0; i < 5; i++) {
      if (!this.heads[i] || i === this.headSel) continue;
      const m = MAN.head.slots[i];
      if (hitTest(m[4] + dx - r.ox, m[5] + dy - r.oy, r.w, r.h)) return i;
    }
    return -1;
  }

  hitSelect(): boolean {
    return this.selectBtn.visible && this.overSelect();
  }

  setMode(mode: HudMode): void {
    this.mode = mode;
    this.startFrame = 0;
    const live = LIVE_MODES.has(mode);
    this.applyPlateArt();
    this.layout();
    this.hudBg.visible = live;
    this.scorebarC.visible = live;
    this.flagCont.visible = live;
    this.arrowSprite.visible = live && this.streakArrow;
    this.mcClass.visible = live;
    this.mcStreak.visible = live;
    this.mcMode.visible = live;
    this.txtFeed.visible = live;
    for (const t of [
      this.txtHp, this.txtAr, this.txtCurgun, this.txtAmmo, this.txtSpare,
      this.txtStreakready, this.txtClassname, this.txtLevel, this.txtRespawn,
      this.txtFlags,
    ]) t.visible = live;
    this.applyStart();
    this.txtWin.visible = mode === "end";
    this.pauseCont.visible = mode === "pause";
    this.headCont.visible = live && this.headsShown;
    this.selectBtn.visible = live && this.selectShown;
    this.barCont.visible = mode === "pause" || mode === "end";
    this.placeBarCont();
    this.radar.visible = live;
    this.showSpeak(this.msgTimer > 0);
  }

  setEndCard(won: boolean): void {
    this.txtRespawn.text = "";
    this.txtWin.text = won ? "Victory" : "Defeat";
    this.txtWin.style.fill = won ? 0xccffff : 0xffccd9;
    this.setMode("end");
  }

  enterFrame(): void {
    if (this.mode === "pause") {
      this.pauseResume.alpha = this.hitResume() ? 1 : 0.5;
      this.pauseQuit.alpha = this.hitQuit() ? 1 : 0.5;
      const prev = this.hitSongPrev();
      const next = this.hitSongNext();
      if (prev !== this.songPrevHover || next !== this.songNextHover) {
        this.songPrevHover = prev;
        this.songNextHover = next;
        this.applySongButtons();
      }
      this.registerPauseFocus();
      return;
    }

    if (this.mode === "start") {
      if (++this.startFrame >= START_LEN) this.setMode("idle");
      else this.applyStart();
    }

    if (this.msgTimer) {
      --this.msgTimer;
      if (this.msgTimer === 0) {
        this.msgForce = false;
        this.showSpeak(false);
      }
      this.weldSpeak();
    }
    if (this.respawnTimer) {
      --this.respawnTimer;
      if (this.respawnTimer === 1) this.txtRespawn.text = "";
    }

    let dirty = false;
    for (let i = 0; i < this.feeds.length; i++) {
      --this.feeds[i].timer;
      if (!this.feeds[i].timer) {
        this.feeds.pop();
        dirty = true;
      }
    }
    if (dirty) this.processFeed();
  }

  private applyStart(): void {
    const on = this.mode === "start";
    this.startVeil.visible = on;
    this.startCard.visible = on;
    if (!on) return;
    this.startVeil.alpha = startVeilAlpha(this.startFrame);
    this.startCard.alpha = startCardAlpha(this.startFrame);
    if (this.startVeil.alpha <= 0) this.startVeil.visible = false;
    if (this.startCard.alpha <= 0) this.startCard.visible = false;
  }

  private applyPlateArt(): void {
    const file = MAN.states[this.mode].plate;
    const t = tex(file);
    this.plateL.texture = this.plateR.texture = t;
    this.plateFull.texture = this.plateC.texture = t;
    this.plateBack.texture = t.width > 1 ? this.backdropOf(file, t) : Texture.EMPTY;
    const full = FULL_PLATE.has(this.mode);
    this.plateFull.visible = full;
    this.plateBack.visible = full;
    this.plateL.visible = this.plateR.visible = !full;
    this.plateC.visible = CENTER_PANEL.has(this.mode);
  }

  private backdropOf(file: string, t: Texture): Texture {
    let bt = this.backdropCache.get(file);
    if (!bt) {
      const col = Math.min(t.width - 1,
        Math.round(2 * t.width / Config.DESIGN_WIDTH));
      bt = new Texture({ source: t.source, frame: new Rectangle(col, 0, 1, t.height) });
      this.backdropCache.set(file, bt);
    }
    return bt;
  }

  private applyArt(): void {
    this.applyPlateArt();
    this.applyIcons();
    this.dressIcon(this.arrowSprite, MAN.arrow);
    this.arrowSprite.tint = MAN.arrow.color;
    this.arrowSprite.alpha = MAN.arrow.alpha;
    this.applyBars();
    this.applyScore();
    this.applyBloody();
    this.applyHeads();
    this.applySongButtons();
    this.showSpeak(this.msgTimer > 0);
  }

  private dressIcon(sp: Sprite, rec: HudTexRec | undefined): void {
    if (!rec) return;
    sp.texture = tex(rec.file);
    sp.anchor.set(rec.ox / (rec.w || 1), rec.oy / (rec.h || 1));
  }

  private applyIcons(): void {
    this.dressIcon(this.mcClass, MAN.icons[this.classIcon]);
    this.dressIcon(this.mcStreak, MAN.icons[this.streakIcon ?? this.classIcon]);
    this.dressIcon(this.mcMode, MAN.icons[this.modeIcon]);
    this.dressIcon(this.mcStartmode, MAN.icons[this.modeIcon]);
  }

  private applyBars(): void {
    const setBar = (key: string, kx: number): void => {
      const spec = MAN.bars[key];
      const sp = this.barSprites[key];
      dress(sp, MAN.bars.fill, spec, 0, 0, kx);
      sp.tint = spec.color;
    };
    setBar("hp", clamp01(this.hpCur / this.hpMax));
    setBar("ar", clamp01(this.arCur / this.arMax));
    setBar("ammo", clamp01(this.ammoFrac));
    const fill = MAN.bars.fill;
    setBar("streak", clamp01(this.streakFrac)
      * boxWidthScale(MAN.bars.streak.m, fill.w, fill.h, 116));
    this.arrowSprite.visible = LIVE_MODES.has(this.mode) && this.streakArrow;
  }

  private applyScore(): void {
    const f1 = this.team1 === 0 ? 1 : this.team1 + 2;
    const f2 = this.team2 + 2;
    const w1 = clamp01(this.score1 / this.useScore) * 130;
    const w2 = clamp01(this.score2 / this.useScore) * 130;
    const place = MAN.scorebar.barPlace;
    for (let i = 0; i < 2; i++) {
      const rec = MAN.scorebar.bars[String(i === 0 ? f1 : f2)];
      const w = i === 0 ? w1 : w2;
      dress(this.sbBars[i], rec, place, 0, 0,
        boxWidthScale(place.m, rec.w, rec.h, w));
      dress(this.sbCaps[i], MAN.scorebar.cap, MAN.scorebar.capPlace);
      this.sbCaps[i].x = place.m[4] + w;
    }
  }

  private applyBloody(): void {
    this.bloody.texture = this.bloodyTexture();
    this.bloody.alpha = clamp01(this.bloodyAlpha);
    this.bloody.anchor.set(0, 0);
    this.bloody.position.set(0, 0);
    this.bloody.scale.set(1, 1);
    this.bloody.width = Config.GAME_WIDTH;
    this.bloody.height = Config.GAME_HEIGHT;
  }

  private bloodyTexture(): Texture {
    const key = `${this.bloodyFrameKey}|${this.bloodyFlipX}|${this.bloodyFlipY}`
      + `|${Math.round(Config.GAME_WIDTH)}x${Math.round(Config.GAME_HEIGHT)}`;
    if (key === this.bloodyTexKey && this.bloodyTex) return this.bloodyTex;
    this.bloodyTexKey = key;
    this.bloodyTex = makeBloodyTexture(
      this.bloodyFrameKey === "2", this.bloodyFlipX, this.bloodyFlipY);
    return this.bloodyTex;
  }
}

export class Aimer extends Container {
  private lines: Sprite[] = [];
  private circle = new Sprite();

  constructor() {
    super();
    for (const key of ["line1", "line2", "line3", "line4"]) {
      const sp = new Sprite();
      this.lines.push(sp);
      this.addChild(sp);
    }
    this.addChild(this.circle);
    this.applyArt();
    ensureHudArt(() => this.applyArt());
  }

  private applyArt(): void {
    for (let i = 0; i < this.lines.length; i++) {
      dress(this.lines[i], MAN.aimer.line, MAN.aimer.lines[`line${i + 1}`]);
    }
    dress(this.circle, MAN.aimer.circle, MAN.aimer.circlePlace);
  }

  update(x: number, y: number, lineDist: number): void {
    this.position.set(x, y);
    this.lines[0].y = -lineDist;
    this.lines[1].x = lineDist;
    this.lines[2].y = lineDist;
    this.lines[3].x = -lineDist;
    this.circle.width = this.circle.height = lineDist * 2;
  }
}

export interface RadarBlip {
  readonly x: number;
  readonly y: number;
  readonly human: boolean;
  readonly team: number;
  readonly dead: unknown;
}

export const RADAR_WHITEN: ColorMatrix = [
  0, 0, 0, 0, 1,
  0, 0, 0, 0, 1,
  0, 0, 0, 0, 1,
  0, 0, 0, 179 / 256, 0,
];

export function radarScroll(player: { x: number; y: number }): { x: number; y: number } {
  return {
    x: player.x * -Radar.SCALE + Radar.VIEW_W / 2,
    y: player.y * -Radar.SCALE + Radar.VIEW_H / 2,
  };
}

export function radarBlipVisible(paintX: number, paintY: number): boolean {
  const left = paintX - Radar.ICON_BITMAP_W / 2;
  const top = paintY - Radar.ICON_BITMAP_H / 2;
  return left < Radar.VIEW_W && left + Radar.ICON_BITMAP_W > 0
    && top < Radar.VIEW_H && top + Radar.ICON_BITMAP_H > 0;
}

export function radarIconOffset(cell: { lx: number; ly: number }): { x: number; y: number } {
  return {
    x: Radar.ICON_MC_X - Radar.ICON_BITMAP_W / 2 + cell.lx * 2,
    y: Radar.ICON_MC_Y - Radar.ICON_BITMAP_H / 2 + cell.ly * 2,
  };
}

export class Radar extends Container {
  static readonly VIEW_W = 160;
  static readonly VIEW_H = 120;
  static readonly SCALE = 0.1;
  static readonly PANEL = { x: 0.05, y: -0.8, w: 153.9, h: 124 } as const;
  static readonly PANEL_ALPHA = 38 / 255;
  static readonly CONT_X = 1.75;
  static readonly CONT_Y = -0.05;
  static readonly ICON_BITMAP_W = Math.trunc(5.4 * 7.213104248046875);
  static readonly ICON_BITMAP_H = Math.trunc(5.4 * 4.0833587646484375);
  static readonly ICON_MC_X = 19.9;
  static readonly ICON_MC_Y = 12.15;

  private panel = new Graphics();
  private mapLayer = new Container();
  private map = new Sprite();
  private mapMask = new Graphics();
  private dots = new Container();
  private dotsMask = new Graphics();
  private whiten = new ColorMatrixFilter();
  private pool: Sprite[] = [];
  private iconScale = 1;

  constructor() {
    super();
    const p = Radar.PANEL;
    this.panel.rect(p.x, p.y, p.w, p.h)
      .fill({ color: 0x000000, alpha: Radar.PANEL_ALPHA });
    this.mapMask.rect(p.x, p.y, p.w, p.h).fill({ color: 0xffffff });
    this.mapLayer.addChild(this.map);
    this.mapLayer.mask = this.mapMask;
    this.dotsMask.rect(0, 0, Radar.VIEW_W, Radar.VIEW_H).fill({ color: 0xffffff });
    this.dots.mask = this.dotsMask;

    this.whiten.matrix = [...RADAR_WHITEN] as ColorMatrix;
    this.map.filters = [this.whiten];

    this.addChild(this.panel, this.mapLayer, this.mapMask, this.dots, this.dotsMask);
  }

  setMap(texture: Texture | null): void {
    this.map.texture = texture ?? Texture.EMPTY;
    this.map.visible = !!texture;
    this.map.scale.set(1);
    this.iconScale = FxArt.stageScale(RADAR_BIT);
    if (texture) void FxArt.loadName(RADAR_BIT);
  }

  update(
    player: { x: number; y: number } | null,
    units: readonly RadarBlip[],
    objectives: readonly { x: number; y: number; team: number }[] = [],
  ): void {
    if (!player) {
      this.hideAll();
      return;
    }
    const bmp = radarScroll(player);
    this.map.position.set(Radar.CONT_X + bmp.x, Radar.CONT_Y + bmp.y);

    let n = 0;
    const paint = (sub: string, x: number, y: number, dy: number): void => {
      const idx = FxArt.subFrame(RADAR_BIT, sub);
      const def = FxArt.def(RADAR_BIT);
      const cell = def?.cells[idx];
      if (!cell) return;
      const px = x * Radar.SCALE + bmp.x + 2;
      const py = y * Radar.SCALE + bmp.y + dy;
      if (!radarBlipVisible(px, py)) return;
      const off = radarIconOffset(cell);
      let sp = this.pool[n++];
      if (!sp) {
        sp = new Sprite();
        this.dots.addChild(sp);
        this.pool.push(sp);
      }
      sp.texture = FxArt.cell(RADAR_BIT, idx) ?? Texture.EMPTY;
      sp.position.set(px + off.x, py + off.y);
      sp.scale.set(this.iconScale);
      sp.visible = true;
    };

    for (const u of units) {
      if (u.human && !u.dead) paint("player", u.x, u.y, -4);
      else if (u.team === 1) paint(u.dead ? "allyskull" : "ally", u.x, u.y, -4);
    }
    for (const o of objectives) paint(`flag${o.team}`, o.x, o.y, -3);

    for (let i = n; i < this.pool.length; i++) this.pool[i].visible = false;
  }

  private hideAll(): void {
    for (const sp of this.pool) sp.visible = false;
  }
}

function clamp01(n: number): number {
  if (!isFinite(n) || n < 0) return 0;
  return n > 1 ? 1 : n;
}

export function padSpare(spareAmmo: number, spareMax: number): string {
  if (spareMax === 0) return "---";
  if (spareAmmo < 10) return "00" + spareAmmo;
  if (spareAmmo < 100) return "0" + spareAmmo;
  return "" + spareAmmo;
}

function widthOf(s: string, size: number, extra = ""): number {
  return (s.length + extra.length) * size * 0.55;
}
