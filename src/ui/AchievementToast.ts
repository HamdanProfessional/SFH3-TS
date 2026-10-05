import { Assets, Container, Sprite, Text, TextStyle, Texture, type Ticker } from "pixi.js";
import ui from "../assets/achievementUi.json";
import { SH } from "../audio/SH";
import { MS_PER_FRAME } from "../core/Config";
import type { Achievement } from "../data/StatsAchievements";

interface TexRec {
  file: string;
  w: number;
  h: number;
  ox: number;
  oy: number;
}

interface TextSpec {
  x: number; y: number; w: number; h: number;
  font?: string;
  size?: number;
  color?: number;
  align?: string;
  leading?: number;
  wordWrap?: boolean;
}

interface AchievementUi {
  scale: number;
  toast: TexRec;
  medals: Record<string, TexRec>;
  place: {
    icon: [number, number];
    name: [number, number];
    desc: [number, number];
    unlock: [number, number];
  };
  y: number[];
  text: Record<string, TextSpec>;
}

const U = ui as unknown as AchievementUi;

const BASE = "ui/achievements/";
const LAST_FRAME = U.y.length;
const PLAY_MS = (LAST_FRAME - 1) * MS_PER_FRAME;

const DROP = U.y.map((v) => v - U.y[0]);

const texCache = new Map<string, Texture>();
const pending = new Map<string, Sprite[]>();

function request(rec: TexRec): void {
  if (texCache.has(rec.file) || pending.has(rec.file)) return;
  pending.set(rec.file, []);
  void Assets.load<Texture>(BASE + rec.file)
    .then((t) => {
      texCache.set(rec.file, t);
      for (const s of pending.get(rec.file) ?? []) s.texture = t;
      pending.delete(rec.file);
    })
    .catch(() => pending.delete(rec.file));
}

function useTexture(sp: Sprite, rec: TexRec): void {
  sp.anchor.set(rec.ox / (rec.w || 1), rec.oy / (rec.h || 1));
  sp.scale.set(1 / U.scale);
  const t = texCache.get(rec.file);
  if (t) {
    sp.texture = t;
    return;
  }
  request(rec);
  pending.get(rec.file)?.push(sp);
}

export class AchievementToast {
  readonly view = new Container();

  private readonly chrome = new Sprite();
  private readonly icon = new Sprite();
  private readonly nameText: Text;
  private readonly descText: Text;
  private readonly unlockText: Text;

  private frameN = 1;
  private running = false;
  private elapsedMs = 0;
  private id = "";

  constructor(ticker?: Ticker) {
    useTexture(this.chrome, U.toast);
    this.chrome.position.set(0, 0);
    this.view.addChild(this.chrome);

    this.icon.position.set(...U.place.icon);
    this.view.addChild(this.icon);

    this.nameText = this.field("3904", U.place.name);
    this.descText = this.field("3905", U.place.desc);
    this.unlockText = this.field("3903", U.place.unlock);

    ticker?.add((t) => this.tick(t.deltaMS));
    AchievementToast.preload();
  }

  static preload(): void {
    request(U.toast);
    for (const rec of Object.values(U.medals)) request(rec);
  }

  show(ach: Achievement): void {
    this.id = ach.id;
    const rec = U.medals[ach.id];
    if (rec) useTexture(this.icon, rec);
    this.nameText.text = ach.name;
    this.descText.text = ach.desc;
    this.unlockText.text = ach.unlock ? `${ach.unlock} mod unlocked!` : "";

    SH.playSound("S_Medal");

    this.running = true;
    this.elapsedMs = 0;
    this.seek(2);
  }

  advance(frames: number): void {
    this.tick(frames * MS_PER_FRAME);
  }

  private tick(dtMs: number): void {
    if (!this.running) return;
    this.elapsedMs += dtMs;
    const t = Math.min(1, this.elapsedMs / PLAY_MS);
    this.seek(2 + t * (LAST_FRAME - 2));
    if (this.elapsedMs >= PLAY_MS) this.finish();
  }

  private finish(): void {
    this.running = false;
    this.frameN = 1;
    this.view.y = DROP[0];
  }

  private seek(frame: number): void {
    const f = Math.max(2, Math.min(LAST_FRAME, frame));
    this.frameN = f;
    const i = Math.floor(f);
    const a = DROP[i - 1] ?? 0;
    const b = DROP[Math.min(i, LAST_FRAME - 1)] ?? a;
    this.view.y = a + (b - a) * (f - i);
  }

  private field(cid: string, place: [number, number]): Text {
    const spec = U.text[cid];
    const t = new Text({
      roundPixels: true,
      text: "",
      style: new TextStyle({
        fontFamily: [spec?.font ?? "QTypeSquare-Book", "Verdana", "sans-serif"],
        fontSize: spec?.size ?? 11,
        fill: spec?.color ?? 0xffffff,
        align: spec?.align === "justify" ? "left" : (spec?.align as "left" | "right" | "center" ?? "left"),
        wordWrap: spec?.wordWrap ?? false,
        wordWrapWidth: spec?.w ?? 200,
        lineHeight: spec?.size ? spec.size + (spec?.leading ?? 0) : undefined,
      }),
    });
    const bx = place[0] + (spec?.x ?? 0);
    const by = place[1] + (spec?.y ?? 0);
    const bw = spec?.w ?? 0;
    if (spec?.align === "center") {
      t.anchor.set(0.5, 0);
      t.position.set(bx + bw / 2, by);
    } else {
      t.position.set(bx, by);
    }
    this.view.addChild(t);
    return t;
  }

  get frame(): number { return this.frameN; }
  get playing(): boolean { return this.running; }
  get currentId(): string { return this.id; }
}
