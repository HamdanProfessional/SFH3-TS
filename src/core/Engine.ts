import { Application, Container, Graphics } from "pixi.js";
import {
  GAME_WIDTH, GAME_HEIGHT, DESIGN_WIDTH, DESIGN_HEIGHT, MS_PER_FRAME, setStageSize,
  computeStageSize,
} from "./Config";
import { Input } from "./Input";
import { Gamepads } from "./Gamepads";
import { Focus } from "./Focus";
import { TouchControls } from "../ui/TouchControls";
import { FullscreenButton } from "../ui/FullscreenButton";
import { Quality } from "../state/Quality";
import { Tween } from "./Tween";
import { Transition, type TransitionKind } from "./Transition";
import type { Screen, ScreenClass } from "./Screen";
import { MAX_DPR } from "./device";

const FADE_MS = 150;

export class Engine {
  readonly app: Application;
  readonly root = new Container();
  readonly overlay = new Container();

  private current: Screen | null = null;
  private accumulator = 0;
  private lastLogic = 0;
  private tickWorker: Worker | null = null;

  private curtain = new Graphics();
  private fade = 0;
  private fadeDir = 0;
  private pending: { Ctor: ScreenClass; arg?: unknown } | null = null;
  private currentSpec: { Ctor: ScreenClass; arg?: unknown } | null = null;
  private rebuildTimer = 0;
  private transition = new Transition();

  private constructor(app: Application) {
    this.app = app;
    this.app.stage.addChild(this.root);
    this.app.stage.addChild(this.transition.view);
    this.app.stage.addChild(this.overlay);

    this.curtain.rect(0, 0, GAME_WIDTH, GAME_HEIGHT).fill({ color: 0x000000 });
    this.curtain.alpha = 0;
    this.curtain.visible = false;
    this.app.stage.addChild(this.curtain);
  }

  static async create(mount: HTMLElement): Promise<Engine> {
    const app = new Application();
    await app.init({
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
      background: 0x000000,
      antialias: true,
      autoDensity: false,
      resolution: Math.min(window.devicePixelRatio || 1, 2, MAX_DPR),
    });
    mount.appendChild(app.canvas);

    const engine = new Engine(app);
    engine.setupScaling(mount);
    Input.attach(app.canvas as unknown as HTMLElement);
    app.canvas.style.touchAction = "none";
    TouchControls.install();
    FullscreenButton.install();
    engine.startLoop();
    if (import.meta.env.DEV) {
      (window as any).__sfh3 = engine;
    }
    void import("./DevConsole").then((m) => m.installDevConsole(() => engine.current));
    return engine;
  }

  private setupScaling(mount: HTMLElement): void {
    const resize = () => {
      const vw = Math.max(1, mount.clientWidth);
      const vh = Math.max(1, mount.clientHeight);
      const { width: logicalW, height: logicalH, scale } = computeStageSize(vw, vh);

      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const resolution = Math.max(1, Math.min(scale * dpr, 4));
      this.app.renderer.resize(logicalW, logicalH, resolution);

      const canvas = this.app.canvas;
      canvas.style.width = `${vw}px`;
      canvas.style.height = `${vh}px`;

      setStageSize(logicalW, logicalH);
      this.curtain.clear();
      this.curtain.rect(0, 0, logicalW, logicalH).fill({ color: 0x000000 });
      this.relayoutScreen();
    };
    window.addEventListener("resize", resize);
    resize();
  }

  private applyQuality = (): void => {
    this.app.ticker.maxFPS = Quality.maxFps;
  };

  private startLoop(): void {
    this.applyQuality();
    Quality.onChange(this.applyQuality);
    this.lastLogic = performance.now();

    this.app.ticker.add((ticker) => {
      Tween.update(ticker.deltaMS);
      this.advanceTransition(ticker.deltaMS);
      if (document.hidden) return;
      this.stepLogic();
      this.current?.renderFrame?.(this.accumulator / MS_PER_FRAME);
    });

    this.startTickWorker();
  }

  private startTickWorker(): void {
    try {
      const worker = new Worker(new URL("./tickWorker.ts", import.meta.url), {
        type: "module",
      });
      worker.onmessage = () => {
        if (document.hidden) this.stepLogic();
      };
      worker.postMessage(MS_PER_FRAME);
      this.tickWorker = worker;
    } catch {
      this.tickWorker = null;
    }
  }

  private stepLogic(): void {
    const now = performance.now();
    this.accumulator += Math.min(now - this.lastLogic, MS_PER_FRAME * 5);
    this.lastLogic = now;
    let steps = 0;
    while (this.accumulator >= MS_PER_FRAME && steps < 5) {
      this.accumulator -= MS_PER_FRAME;
      steps++;
      this.transition.enterFrame();
      Gamepads.poll();
      Focus.poll();
      const cur = this.current;
      Focus.begin(!!cur?.padFocus, !!cur?.focusKeys, GAME_WIDTH, GAME_HEIGHT);
      cur?.enterFrame(1);
      Focus.end();
      Input.endFrame();
    }
    if (steps) {
      TouchControls.update();
      FullscreenButton.update();
    }
  }

  setScreen(ScreenCtor: ScreenClass, arg?: unknown, kind?: TransitionKind): void {
    if (!this.current) {
      this.swapScreen(ScreenCtor, arg);
      this.fade = 1;
      this.fadeDir = -1;
      return;
    }
    if (kind) {
      this.slideScreen(ScreenCtor, arg, kind);
      return;
    }
    this.pending = { Ctor: ScreenCtor, arg };
    this.fadeDir = 1;
  }

  private slideScreen(ScreenCtor: ScreenClass, arg: unknown, kind: TransitionKind): void {
    const renderer = this.app.renderer;
    const outgoing = this.current!.view;
    const w = renderer.width;
    const h = renderer.height;
    this.transition.start(
      renderer, outgoing, kind, w, h,
      () => this.current!.view,
      () => { this.root.visible = true; },
    );
    this.swapScreen(ScreenCtor, arg);
    this.root.visible = false;
  }

  private swapScreen(ScreenCtor: ScreenClass, arg?: unknown): void {
    if (this.current) {
      this.root.removeChild(this.current.view);
      this.current.destructor();
      this.current = null;
    }
    Tween.cancel();
    this.currentSpec = { Ctor: ScreenCtor, arg };
    this.current = new ScreenCtor(this, arg);
    this.root.addChild(this.current.view);
  }

  private relayoutScreen(): void {
    if (!this.current) return;
    if (this.current.destroyedView) return;
    this.transition.finish();
    if (this.current.resize) {
      this.current.resize();
      return;
    }
    clearTimeout(this.rebuildTimer);
    this.rebuildTimer = window.setTimeout(() => {
      const spec = this.currentSpec;
      if (spec && this.current) this.swapScreen(spec.Ctor, spec.arg);
    }, 160);
  }

  private advanceTransition(dtMs: number): void {
    if (this.fadeDir !== 0) {
      this.fade += (dtMs / FADE_MS) * this.fadeDir;
      if (this.fadeDir > 0 && this.fade >= 1) {
        this.fade = 1;
        const next = this.pending;
        this.pending = null;
        if (next) {
          this.transition.finish();
          this.swapScreen(next.Ctor, next.arg);
        }
        this.fadeDir = -1;
      } else if (this.fadeDir < 0 && this.fade <= 0) {
        this.fade = 0;
        this.fadeDir = 0;
      }
    }
    this.curtain.alpha = this.fade;
    this.curtain.visible = this.fade > 0;
  }

  get screen(): Screen | null {
    return this.current;
  }
}
