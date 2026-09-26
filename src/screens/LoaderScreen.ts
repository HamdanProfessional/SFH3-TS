import { Assets, Container, Graphics, Sprite, Text, TextStyle, Texture,
  type TextStyleOptions } from "pixi.js";
import { Screen } from "../core/Screen";
import type { Engine } from "../core/Engine";
import { GAME_WIDTH, GAME_HEIGHT, VERSION, onStageResize } from "../core/Config";
import { Input } from "../core/Input";
import { Focus } from "../core/Focus";
import type { PreloadProgress } from "../core/Preload";
import UI from "../assets/loaderUi.json";

export interface LoaderArg {
  run: (onProgress: PreloadProgress) => Promise<unknown>;
  done: (result: unknown) => void;
  fail?: (err: unknown) => void;
  title?: string;
  play?: boolean;
}

interface TextSpec {
  x: number; y: number;
  w: number; h: number;
  size: number;
  font: string;
  color: number;
  alpha: number;
  align: string;
  leading: number;
}

interface Part { file: string; x: number; y: number; w: number; h: number }

const TEXT = UI.text as unknown as Record<string, TextSpec>;
const AT = UI.children as unknown as Record<string, { x: number; y: number }>;
const FIELD = UI.fields as unknown as Record<string, number>;
const PART = UI.parts as unknown as Record<string, Part>;

const LOADER_BASE = "ui/";
const BAR_FULL = 300;

const LOGO_TOP = 0.2;
const LOGO_GAP = 104;
const EDGE = 16;
const PLAY_HOVER = 0xffffff;
const PLAY_IDLE = 0xbbbbbb;

function fieldStyle(cid: number): TextStyleOptions {
  const s = TEXT[String(cid)];
  return {
    fontFamily: [s.font, "Verdana", "sans-serif"],
    fontSize: s.size,
    fill: s.color,
    align: (s.align === "justify" ? "left" : s.align) as TextStyleOptions["align"],
    lineHeight: s.size + s.leading,
  };
}

function fieldAt(name: string, initial = ""): Text {
  const cid = FIELD[name];
  const s = TEXT[String(cid)];
  const p = AT[name];
  const t = new Text({ text: initial, style: new TextStyle(fieldStyle(cid)) });
  t.alpha = s.alpha;
  const bx = p.x + s.x, by = p.y + s.y;
  if (s.align === "center") {
    t.anchor.set(0.5, 0);
    t.position.set(bx + s.w / 2, by);
  } else if (s.align === "right") {
    t.anchor.set(1, 0);
    t.position.set(bx + s.w, by);
  } else {
    t.anchor.set(0, 0);
    t.position.set(bx, by);
  }
  return t;
}

export class LoaderScreen extends Screen {
  private bg = new Graphics();
  private plate = new Container();
  private parts: Record<string, Sprite> = {};
  private bar = new Sprite();
  private txtLoading: Text;
  private txtSize: Text;
  private txtVersion: Text;
  private txtPlay: Text;

  private arg: LoaderArg;
  private unsubscribe: () => void;
  private dead = false;

  private target = 0;
  private shown = 0;
  private status = "";
  private finished = false;
  private result: unknown = null;
  private handedOff = false;
  private failed = false;
  private holdTimer = 0;
  private awaitingPlay = false;

  constructor(engine: Engine, arg?: unknown) {
    super(engine, arg);
    const a = (arg ?? {}) as LoaderArg;
    this.arg = a;

    for (const key of Object.keys(PART)) {
      const sp = new Sprite();
      sp.scale.set(1 / UI.scale);
      this.parts[key] = sp;
      this.plate.addChild(sp);
    }
    this.bar.visible = false;

    this.txtLoading = fieldAt("txt_loading", "Loading\n0%");
    this.txtSize = fieldAt("txt_size");
    this.txtVersion = fieldAt("txt_version", VERSION);
    this.txtPlay = fieldAt("txt_play", "PLAY");
    this.txtSize.anchor.set(0.5, 0);
    this.txtPlay.visible = false;

    this.plate.addChild(this.bar, this.txtLoading, this.txtSize,
      this.txtVersion, this.txtPlay);
    this.view.addChild(this.bg, this.plate);
    this.unsubscribe = onStageResize(() => this.resize());
    this.resize();
    void this.begin(a);
  }

  private async begin(a: LoaderArg): Promise<void> {
    try {
      const keys = Object.keys(PART);
      const [bar, ...art] = await Promise.all([
        Assets.load<Texture>(LOADER_BASE + UI.bar.file),
        ...keys.map((k) => Assets.load<Texture>(LOADER_BASE + PART[k].file)),
      ]);
      if (this.dead) return;
      this.bar.texture = bar;
      keys.forEach((k, i) => { this.parts[k].texture = art[i]; });
      this.resize();
    } catch (err) {
      console.warn("SFH3: loader art missing", err);
      if (this.dead) return;
    }

    try {
      const result = await a.run?.((done, total, label) => {
        if (this.dead) return;
        this.target = total > 0 ? Math.min(1, done / total) : 0;
        this.status = `${a.title ? a.title + " — " : ""}${label}`
          + (total > 0 ? `  ${done} / ${total}` : "");
      });
      if (this.dead) return;
      this.target = 1;
      this.result = result;
      this.finished = true;
    } catch (err) {
      console.error("SFH3: loading failed", err);
      if (this.dead) return;
      this.failed = true;
      a.fail?.(err);
    }
  }

  resize(): void {
    const W = GAME_WIDTH, H = GAME_HEIGHT;
    this.bg.clear();
    this.bg.rect(0, 0, W, H).fill({ color: 0x000000 });
    this.plate.position.set(0, 0);

    const mid = Math.round(W / 2);
    const logo = PART.logo;
    const logoY = Math.round(H * LOGO_TOP);
    this.place("logo", mid - logo.w / 2, logoY);

    const barY = logoY + logo.h + LOGO_GAP;
    const barX = mid - BAR_FULL / 2;
    this.bar.position.set(barX + (UI.bar.x - AT.bar1.x),
      barY + (UI.bar.y - AT.bar1.y));
    this.txtLoading.position.set(mid, barY + (AT.txt_loading.y - AT.bar1.y));
    this.txtSize.position.set(mid, barY + (AT.txt_size.y - AT.bar1.y));
    this.txtPlay.position.set(mid, barY + (AT.txt_play.y - AT.bar1.y));

    const rowY = H - EDGE - PART.sky9.h;
    this.place("sky9", EDGE, rowY);
    this.place("copy", mid - PART.copy.w / 2, rowY);
    const v = TEXT[String(FIELD.txt_version)];
    this.txtVersion.position.set(W - EDGE, rowY + (PART.sky9.h - v.h) / 2);
  }

  private place(key: string, x: number, y: number): void {
    this.parts[key].position.set(Math.round(x), Math.round(y));
  }

  enterFrame(_dt: number): void {
    this.shown += (this.target - this.shown) * 0.25;
    if (this.target - this.shown < 0.002) this.shown = this.target;
    const pct = Math.max(0, Math.min(1, this.shown));
    this.bar.scale.set((pct * BAR_FULL) / UI.bar.w / UI.scale, 1 / UI.scale);
    this.bar.visible = pct > 0.001;

    if (this.handedOff) return;
    if (this.failed) {
      this.txtLoading.text = "Loading\nfailed";
      this.txtSize.text = "";
      return;
    }
    if (this.awaitingPlay) {
      this.tickPlay();
      return;
    }

    this.txtLoading.text = `Loading\n${Math.ceil(pct * 100)}%`;
    this.txtSize.text = this.status;

    if (!this.finished) return;
    if (this.shown < 0.999) return;
    if (++this.holdTimer < 3) return;
    if (this.arg.play) {
      this.awaitingPlay = true;
      this.txtLoading.text = "";
      this.txtSize.text = "";
      this.txtPlay.visible = true;
      return;
    }
    this.hand();
  }

  private tickPlay(): void {
    const b = this.txtPlay.getBounds();
    const hover = Input.mouseX >= b.x && Input.mouseX <= b.x + b.width
      && Input.mouseY >= b.y && Input.mouseY <= b.y + b.height;
    this.txtPlay.style.fill = hover ? PLAY_HOVER : PLAY_IDLE;
    Focus.add(b.x, b.y, b.width, b.height);
    if (hover && Input.mousePressed) {
      this.txtPlay.visible = false;
      this.hand();
    }
  }

  private hand(): void {
    this.handedOff = true;
    this.arg.done?.(this.result);
  }

  override get padFocus(): boolean {
    return true;
  }

  destructor(): void {
    this.dead = true;
    this.unsubscribe();
    super.destructor();
  }
}
