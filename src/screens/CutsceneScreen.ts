import { Container, Graphics, Sprite, Text } from "pixi.js";
import { Screen } from "../core/Screen";
import type { Engine } from "../core/Engine";
import {
  GAME_WIDTH, GAME_HEIGHT, DESIGN_WIDTH, DESIGN_HEIGHT,
} from "../core/Config";
import { Input } from "../core/Input";
import { focusable, hitTest, setHitOrigin } from "../ui/kit";
import {
  PageButton, bindTex, pageField, refreshTex,
  type PageTextSpec, type PageTex,
} from "./menu/pageArt";
import cut from "../assets/cutsceneUi.json";
import { SH } from "../audio/SH";

export interface CutsceneArg {
  start?: number;
  end?: number;
  showCredits?: boolean;
}

interface FrameRec {
  art: { file: string; x: number; y: number; w: number; h: number };
  cut1: [number, number, number, number];
  cut2: [number, number, number, number];
  markers: string[];
  caption: string;
}

interface CutUi {
  scale: number;
  frames: Record<string, FrameRec>;
  top: {
    file: string; w: number; h: number;
    black: [number, number, number, number];
    fields: Record<string, PageTextSpec>;
  };
  skip: {
    states: Partial<Record<"up" | "over" | "down", string>>;
    w: number; h: number; offX: number; offY: number;
    x: number; y: number; sx: number; sy: number;
  };
  credits: {
    roll: { file: string; y: number; h: number };
    end: { file: string };
    rate: number; ref: number; first: number; last: number;
    offset: [number, number];
  };
}

const C = cut as unknown as CutUi;

function tex(rec: PageTex): PageTex {
  return { file: `cutscene/${rec.file.replace(/^cutscene\//, "")}`, w: rec.w, h: rec.h, ox: rec.ox, oy: rec.oy };
}

export interface FrameTiming {
  frameTimer: number;
  fadeTimer: number;
  fadeSpeed: number;
  introSpeed: number;
}

export function frameTiming(markers: readonly string[]): FrameTiming {
  let frameTimer = 30 * 5;
  let fadeSpeed = 0.4;
  let introSpeed = 0.4;
  if (markers.includes("short1")) introSpeed = 0.05;
  if (markers.includes("long1")) {
    introSpeed = 0.04;
    frameTimer += 40;
  }
  if (markers.includes("short0")) frameTimer -= 80;
  if (markers.includes("long0")) frameTimer += 80;
  let fadeTimer = frameTimer - 6;
  if (markers.includes("long2")) {
    frameTimer += 60;
    fadeTimer = frameTimer - 60;
    fadeSpeed = 0.05;
  }
  return { frameTimer, fadeTimer, fadeSpeed, introSpeed };
}

export function storyboardRange(start: number, end: number): number[] {
  const out: number[] = [];
  for (let f = start; f <= end + 1; f++) out.push(f);
  return out;
}

export class CutsceneScreen extends Screen {
  private root = new Container();
  private sp = new Container();
  private bgLayer = new Container();
  private art: Sprite | null = null;
  private artFile = "";
  private topArt: Sprite | null = null;
  private black = new Graphics();
  private caption: Text | null = null;
  private skipBtn: PageButton | null = null;
  private roll: Sprite | null = null;
  private endCard: Sprite | null = null;

  private readonly start: number;
  private readonly end: number;
  private readonly showCredits: boolean;
  private curFrame: number;
  private timer = 0;
  private fc = 0;
  private frameTimer = 150;
  private fadeTimer = 144;
  private fadeSpeed = 0.4;
  private introSpeed = 0.4;
  private cut2: [number, number, number, number] = [1, 1, 400, 250];
  private stopPlaying = false;
  private rollFrame = -1;
  private leaving = false;

  constructor(engine: Engine, arg?: unknown) {
    super(engine, arg);
    const a = (arg as CutsceneArg | undefined) ?? {};
    this.start = a.start ?? 11;
    this.end = a.end ?? 19;
    this.showCredits = a.showCredits ?? false;
    this.curFrame = this.start;

    this.view.addChild(this.root);
    this.root.addChild(this.sp);
    this.bgLayer.position.set(-400, -250);
    this.sp.addChild(this.bgLayer);

    this.topArt = new Sprite();
    bindTex(this.topArt, tex({ file: C.top.file, w: C.top.w, h: C.top.h, ox: 0, oy: 0 }));
    this.root.addChild(this.topArt);

    this.caption = pageField(C.top.fields["3780"], { x: -23.6, y: 494 }, "");
    this.root.addChild(this.caption);

    this.black.alpha = 1;
    this.root.addChild(this.black);

    this.skipBtn = new PageButton(C.skip, C.skip.x, C.skip.y);
    this.skipBtn.visible = false;
    this.root.addChild(this.skipBtn);
    this.anchor();

    this.setFrame();
    SH.playMusic("M_Epic");
  }

  private anchor(): void {
    const dx = Math.round((GAME_WIDTH - DESIGN_WIDTH) / 2);
    const dy = Math.round((GAME_HEIGHT - DESIGN_HEIGHT) / 2);
    this.root.position.set(dx, dy);

    if (this.topArt) {
      this.topArt.position.set(-dx, -dy);
      this.topArt.width = GAME_WIDTH;
      this.topArt.height = GAME_HEIGHT;
    }
    this.black.clear();
    this.black.rect(-dx, -dy, GAME_WIDTH, GAME_HEIGHT).fill({ color: 0x000000 });
    if (this.skipBtn) {
      this.skipBtn.x = C.skip.x + (GAME_WIDTH - DESIGN_WIDTH - dx);
    }
  }

  override get padFocus(): boolean {
    return true;
  }

  resize(): void {
    this.anchor();
  }

  private setFrame(): void {
    const rec = C.frames[String(this.curFrame)];
    if (!rec) return;
    this.cut2 = rec.cut2;

    if (this.artFile !== rec.art.file) {
      this.artFile = rec.art.file;
      this.art?.destroy();
      const s = new Sprite();
      bindTex(s, tex({ file: rec.art.file, w: rec.art.w, h: rec.art.h, ox: 0, oy: 0 }));
      s.position.set(rec.art.x, rec.art.y);
      s.scale.set(1 / C.scale);
      this.art = s;
      this.bgLayer.addChild(s);
    }

    const t = frameTiming(rec.markers);
    this.frameTimer = t.frameTimer;
    this.fadeTimer = t.fadeTimer;
    this.fadeSpeed = t.fadeSpeed;
    this.introSpeed = t.introSpeed;

    this.sp.position.set(800 - rec.cut1[2], 500 - rec.cut1[3]);
    this.sp.scale.set(rec.cut1[0], rec.cut1[1]);
    this.timer = 0;

    if (this.caption) this.caption.text = rec.caption;

    switch (this.curFrame) {
      case 7: SH.playMusic("M_Menu"); break;
      case 13: SH.playMusic("M_Speed", false, 19 * 1000); break;
      case 17: SH.playMusic("M_Mute"); break;
      case 18: SH.playSound("S_Radar"); break;
      case 19: SH.playSound("S_Twist"); break;
    }
  }

  private tick(): void {
    if (this.stopPlaying) {
      if (this.rollFrame >= 0) this.tickRoll();
      return;
    }
    this.fc++;
    if (this.fc >= 45 && this.skipBtn) this.skipBtn.visible = true;

    this.sp.x += ((800 - this.cut2[2]) - this.sp.x) * 0.01;
    this.sp.y += ((500 - this.cut2[3]) - this.sp.y) * 0.01;
    this.sp.scale.x += (this.cut2[0] - this.sp.scale.x) * 0.01;
    this.sp.scale.y += (this.cut2[1] - this.sp.scale.y) * 0.01;

    this.timer++;
    if (this.timer > this.fadeTimer) {
      this.black.alpha += (1 - this.black.alpha) * this.fadeSpeed;
    } else {
      this.black.alpha += (0 - this.black.alpha) * this.introSpeed;
    }

    if (this.timer > this.frameTimer) {
      this.curFrame++;
      if (this.curFrame === this.end + 1) {
        if (this.showCredits) {
          this.setFrame();
          this.startCredits();
          this.stopPlaying = true;
          return;
        }
        this.leave("menu");
        this.stopPlaying = true;
        return;
      }
      this.setFrame();
    }
  }

  private startCredits(): void {
    this.topArt!.visible = false;
    this.art!.visible = false;
    this.caption!.visible = false;
    this.black.alpha = 1;
    this.roll = new Sprite();
    bindTex(this.roll, tex({ file: C.credits.roll.file, w: 800, h: C.credits.roll.h, ox: 0, oy: 0 }));
    this.roll.width = 800;
    this.roll.height = C.credits.roll.h;
    this.roll.position.set(0, C.credits.roll.y);
    this.root.addChild(this.roll);
    this.endCard = new Sprite();
    bindTex(this.endCard, tex({ file: C.credits.end.file, w: 800, h: 600, ox: 0, oy: 0 }));
    this.endCard.width = 800;
    this.endCard.height = 600;
    this.endCard.visible = false;
    this.root.addChild(this.endCard);
    this.rollFrame = 0;
  }

  private tickRoll(): void {
    this.rollFrame++;
    if (this.rollFrame === 21) {
      SH.playSound("S_Powerup");
      SH.playMusic("M_Rush", false, 16.4 * 1000);
    }
    const c = C.credits;
    if (this.rollFrame < c.first) return;
    if (this.rollFrame > c.last) {
      if (this.roll) this.roll.visible = false;
      if (this.endCard) this.endCard.visible = true;
      return;
    }
    if (this.roll) {
      this.roll.visible = true;
      this.roll.y = c.roll.y - c.rate * (this.rollFrame - c.ref);
    }
  }

  private leave(where: "menu" | "postgame"): void {
    if (this.leaving) return;
    this.leaving = true;
    if (where === "menu") {
      void import("./MenuScreen").then((m) => {
        this.engine.setScreen(m.MenuScreen, "missions");
      });
    } else {
      void import("./PostGameScreen").then((m) => {
        this.engine.setScreen(m.PostGameScreen, { won: true, afterCutscene: true });
      });
    }
  }

  enterFrame(dt: number): void {
    SH.enterFrame();
    for (let i = 0; i < Math.max(1, Math.round(dt)); i++) this.tick();
    this.skipBtn?.refresh();
    refreshTex(this.root);

    setHitOrigin(this.root.x, this.root.y);
    if (this.skipBtn?.visible) {
      const hit = hitTest(...this.skipBtn.hitBox());
      this.skipBtn.setState(hit ? "over" : "up");
      focusable(...this.skipBtn.hitBox(), { back: true });
      if (Input.mousePressed && hit) {
        if (this.showCredits) this.leave("postgame");
        else this.leave("menu");
      }
    }
    setHitOrigin(0, 0);
  }
}
