import { Container, RenderTexture, Sprite } from "pixi.js";
import type { Renderer } from "pixi.js";

export type TransitionKind =
  | "slideLeft"
  | "slideRight"
  | "zoomIn"
  | "zoomOut"
  | "fallOff";

const WAIT_FRAMES = 2;
const ZOOM_FRAMES = 10;

class Snap {
  readonly view = new Container();
  readonly spr = new Container();
  private sprite: Sprite | null = null;
  private tex: RenderTexture | null = null;

  id = "";
  toX = 0;
  count = 0;
  alphCh = 0;
  rot = 0;
  velY = 0;
  reveals = false;

  constructor() {
    this.view.addChild(this.spr);
    this.view.visible = false;
  }

  capture(renderer: Renderer, source: Container, w: number, h: number): void {
    this.release();
    this.tex = RenderTexture.create({ width: w, height: h, antialias: false });
    renderer.render({ container: source, target: this.tex, clear: true });
    this.sprite = new Sprite(this.tex);
    this.spr.addChild(this.sprite);
    this.view.visible = true;
  }

  reset(): void {
    this.id = "";
    this.view.visible = false;
    this.view.x = 0;
    this.view.y = 0;
    this.view.rotation = 0;
    this.spr.scale.set(1);
    this.spr.alpha = 1;
    this.release();
  }

  private release(): void {
    if (this.sprite) {
      this.spr.removeChild(this.sprite);
      this.sprite.destroy();
      this.sprite = null;
    }
    this.tex?.destroy(true);
    this.tex = null;
  }

  destroy(): void {
    this.release();
    this.view.destroy({ children: true });
  }
}

export class Transition {
  readonly view = new Container();

  private t1 = new Snap();
  private t2 = new Snap();
  private kind: TransitionKind = "slideLeft";
  private wait = -1;
  private w = 0;
  private h = 0;
  private onDone: (() => void) | null = null;
  private onCapture: (() => void) | null = null;

  constructor() {
    this.view.addChild(this.t1.view);
    this.view.addChild(this.t2.view);
    this.view.visible = false;
  }

  get working(): boolean {
    return !!this.t1.id || !!this.t2.id || this.wait > -1;
  }

  start(
    renderer: Renderer,
    outgoing: Container,
    kind: TransitionKind,
    w: number,
    h: number,
    capture: () => Container,
    done: () => void,
  ): void {
    this.finish();
    this.kind = kind;
    this.w = w;
    this.h = h;
    this.onDone = done;
    this.view.visible = true;
    this.t1.capture(renderer, outgoing, w, h);

    switch (kind) {
      case "slideLeft":
        this.t1.id = "slideLeft";
        this.t1.toX = -w;
        break;
      case "slideRight":
        this.t1.id = "slideRight";
        this.t1.toX = w;
        break;
      case "zoomIn":
      case "zoomOut":
        this.t1.id = kind;
        this.t1.count = 4;
        this.t1.alphCh = -0.16;
        this.t1.spr.scale.set(1);
        break;
      case "fallOff":
        this.t1.id = "fall";
        this.t1.rot = Math.random() * 4 - 1;
        this.t1.velY = -Math.random() * 20;
        this.t1.reveals = true;
        this.onCapture = null;
        return;
    }
    this.t1.reveals = false;
    this.onCapture = () => this.captureArriving(renderer, capture());
    this.wait = WAIT_FRAMES;
  }

  private captureArriving(renderer: Renderer, incoming: Container): void {
    this.t2.capture(renderer, incoming, this.w, this.h);
    this.t2.reveals = true;
    this.t2.toX = 0;
    switch (this.kind) {
      case "slideLeft":
        this.t2.id = "slideLeft";
        this.t2.view.x = this.w;
        break;
      case "slideRight":
        this.t2.id = "slideRight";
        this.t2.view.x = -this.w;
        break;
      case "zoomIn":
        this.t2.id = "zoomIn";
        this.t2.count = 0;
        this.t2.alphCh = 0.1;
        this.t2.spr.scale.set(0.5);
        this.t2.spr.alpha = 0;
        break;
      case "zoomOut":
        this.t2.id = "zoomOut";
        this.t2.count = 0;
        this.t2.alphCh = 0.1;
        this.t2.spr.scale.set(1.5);
        this.t2.spr.alpha = 0;
        break;
    }
  }

  enterFrame(): boolean {
    if (this.wait > -1) {
      if (this.wait === 0) this.onCapture?.();
      this.wait--;
    }
    this.advance(this.t1);
    this.advance(this.t2);
    if (!this.working) {
      this.view.visible = false;
      return false;
    }
    return true;
  }

  private advance(s: Snap): void {
    switch (s.id) {
      case "slideLeft":
        s.view.x += (s.toX - s.view.x) * 0.3;
        s.view.x -= 5;
        if (s.view.x - s.toX < 1) this.land(s);
        break;
      case "slideRight":
        s.view.x += (s.toX - s.view.x) * 0.3;
        s.view.x += 5;
        if (s.view.x - s.toX > -1) this.land(s);
        break;
      case "zoomIn":
        s.count++;
        s.spr.scale.x += 0.05;
        s.spr.scale.y += 0.05;
        s.spr.alpha += s.alphCh;
        if (s.count === ZOOM_FRAMES) this.land(s);
        break;
      case "zoomOut":
        s.count++;
        s.spr.scale.x -= 0.05;
        s.spr.scale.y -= 0.05;
        s.spr.alpha += s.alphCh;
        if (s.count === ZOOM_FRAMES) this.land(s);
        break;
      case "fall":
        s.view.rotation += (s.rot * Math.PI) / 180;
        s.velY += 4;
        s.view.y += s.velY;
        if (s.view.y > this.h + 100) this.land(s);
        break;
    }
  }

  private land(s: Snap): void {
    const reveals = s.reveals;
    s.reset();
    if (reveals) {
      this.onDone?.();
      this.onDone = null;
    }
  }

  finish(): void {
    this.wait = -1;
    this.onCapture = null;
    this.t1.reset();
    this.t2.reset();
    this.view.visible = false;
    const done = this.onDone;
    this.onDone = null;
    done?.();
  }

  destroy(): void {
    this.t1.destroy();
    this.t2.destroy();
    this.view.destroy({ children: true });
  }
}
