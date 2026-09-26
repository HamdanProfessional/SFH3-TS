import { Input } from "./Input";

export type Dir = "up" | "down" | "left" | "right";
export type FocusCmd = Dir | "ok" | "back" | "navPrev" | "navNext" | "pagePrev" | "pageNext";
export type Rect = readonly [number, number, number, number];

export interface FocusOpts {
  key?: string;
  back?: boolean;
  tab?: "nav" | "page";
  order?: number;
  clip?: Rect;
  reveal?: () => void;
}

interface Entry extends FocusOpts {
  x: number;
  y: number;
  w: number;
  h: number;
  auto: boolean;
}

const MAX_AREA = 0.35;
const DELAY = 10;
const REPEAT = 4;
const AWAY_X = -100000;
const AWAY_Y = 100000;
const DOM_FOCUSABLE = "button, input, textarea, select, a[href], [data-focus]";

interface Layer { root: HTMLElement; back: () => void }

class FocusNav {
  private last: Entry[] = [];
  private cur: Entry[] = [];
  private recording = false;
  private screenOn = false;
  private keysOn = false;
  private tabsNow: Partial<Record<"nav" | "page", number>> = {};
  private tabs: Partial<Record<"nav" | "page", number>> = {};
  private layers: Layer[] = [];

  private shown = false;
  private focus: Entry | null = null;
  private domFocus: HTMLElement | null = null;
  private domRect: Box | null = null;
  private queue: FocusCmd[] = [];
  private pendingDir: Dir | null = null;
  private surveying = false;
  private homeX = 0;
  private homeY = 0;
  private tapping = false;
  private ring: HTMLDivElement | null = null;
  private listening = false;
  private width = 0;
  private height = 0;

  begin(on: boolean, keys: boolean, w: number, h: number): void {
    this.listen();
    this.recording = on;
    this.screenOn = on;
    this.keysOn = keys;
    this.width = w;
    this.height = h;
    this.cur = [];
    this.tabsNow = {};
  }

  end(): void {
    if (!this.recording) this.cur = [];
    this.recording = false;
    this.last = this.prune(this.cur);
    this.tabs = this.tabsNow;
    this.cur = [];
  }

  hit(x: number, y: number, w: number, h: number): void {
    if (!this.recording) return;
    if (w < 4 || h < 4 || w * h > this.width * this.height * MAX_AREA) return;
    this.cur.push({ x, y, w, h, auto: true });
  }

  add(x: number, y: number, w: number, h: number, o: FocusOpts = {}): void {
    if (!this.recording || w <= 0 || h <= 0) return;
    this.cur.push({ ...o, x, y, w, h, auto: false });
  }

  activeTab(group: "nav" | "page", order: number): void {
    if (this.recording) this.tabsNow[group] = order;
  }

  pushLayer(root: HTMLElement, back: () => void): void {
    this.popLayer(root);
    this.layers.push({ root, back });
    this.domFocus = null;
    this.domRect = null;
  }

  popLayer(root: HTMLElement): void {
    this.layers = this.layers.filter((l) => l.root !== root);
    this.domFocus = null;
  }

  available(): boolean {
    return !!this.topLayer() || (this.screenOn && this.last.length > 0);
  }

  command(c: FocusCmd): void {
    this.queue.push(c);
  }

  poll(): void {
    if (this.tapping) {
      Input.setButton("focus", "left", false);
      this.tapping = false;
    }
    const queue = this.queue;
    this.queue = [];
    if (!this.available()) {
      this.endSurvey();
      this.focus = null;
      this.hideRing();
      return;
    }
    const layer = this.topLayer();
    if (layer) {
      this.endSurvey();
      this.pollDom(layer, queue);
      return;
    }
    this.domFocus = null;

    if (this.surveying) {
      this.surveying = false;
      const d = this.pendingDir;
      this.pendingDir = null;
      if (!this.focus) this.focus = this.nearest(this.homeX, this.homeY);
      else if (d) this.focus = this.step(this.follow(this.focus) ?? this.focus, d, this.last);
      if (!this.focus) [Input.mouseX, Input.mouseY] = [this.homeX, this.homeY];
    } else if (this.focus) {
      this.focus = this.follow(this.focus) ?? this.nearest(...centre(this.focus));
    }

    for (const c of queue) {
      if (c === "back") {
        const b = this.last.find((e) => e.back);
        if (b) this.tap(b);
        continue;
      }
      if (c === "navPrev" || c === "navNext") { this.stepTab("nav", c === "navNext" ? 1 : -1); continue; }
      if (c === "pagePrev" || c === "pageNext") { this.stepTab("page", c === "pageNext" ? 1 : -1); continue; }
      if (!this.shown || !this.focus) {
        this.shown = true;
        this.survey(null);
        break;
      }
      if (c === "ok") this.tap(this.focus);
      else this.survey(c);
    }

    if (!this.shown) {
      this.hideRing();
      return;
    }
    const f = this.focus;
    if (f?.reveal && !inside(f, f.clip)) f.reveal();
    if (this.tapping) {
    } else if (this.surveying) {
      Input.mouseX = AWAY_X;
      Input.mouseY = AWAY_Y;
    } else if (f) {
      [Input.mouseX, Input.mouseY] = target(f);
    }
    if (f) this.showStageRing(f);
    else this.hideRing();
  }

  private survey(d: Dir | null): void {
    if (!this.surveying) {
      this.homeX = Input.mouseX;
      this.homeY = Input.mouseY;
    }
    this.surveying = true;
    this.pendingDir = d;
  }

  private endSurvey(): void {
    if (!this.surveying) return;
    this.surveying = false;
    this.pendingDir = null;
    [Input.mouseX, Input.mouseY] = [this.homeX, this.homeY];
  }

  private tap(e: Entry): void {
    [Input.mouseX, Input.mouseY] = target(e);
    Input.setButton("focus", "left", true);
    this.tapping = true;
  }

  private stepTab(group: "nav" | "page", d: 1 | -1): void {
    const row = this.last.filter((e) => e.tab === group && e.order !== undefined)
      .sort((a, b) => a.order! - b.order!);
    if (!row.length) return;
    const at = this.tabs[group] ?? -Infinity;
    const next = d > 0
      ? row.find((e) => e.order! > at) ?? row[0]
      : [...row].reverse().find((e) => e.order! < at) ?? row[row.length - 1];
    if (next.order === at) return;
    this.tap(next);
  }

  private follow(f: Entry): Entry | null {
    if (f.key !== undefined) return this.last.find((e) => e.key === f.key) ?? null;
    const [fx, fy] = centre(f);
    let best: Entry | null = null;
    let bestD = 60;
    for (const e of this.last) {
      if (Math.abs(e.w - f.w) > 2 || Math.abs(e.h - f.h) > 2) continue;
      const [ex, ey] = centre(e);
      const d = Math.hypot(ex - fx, ey - fy);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  private nearest(x: number, y: number): Entry | null {
    let best: Entry | null = null;
    let bestD = Infinity;
    for (const e of this.last) {
      if (x >= e.x && x <= e.x + e.w && y >= e.y && y <= e.y + e.h) return e;
      const [ex, ey] = centre(e);
      const d = Math.hypot(ex - x, ey - y);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  private step<T extends Box>(from: T, d: Dir, list: readonly T[]): T {
    return pick(from, d, list) ?? from;
  }

  private topLayer(): Layer | null {
    const l = this.layers[this.layers.length - 1];
    if (l && !l.root.isConnected) {
      this.popLayer(l.root);
      return this.topLayer();
    }
    return l ?? null;
  }

  private pollDom(layer: Layer, queue: FocusCmd[]): void {
    const els = [...layer.root.querySelectorAll<HTMLElement>(DOM_FOCUSABLE)]
      .filter((el) => el.getClientRects().length > 0 && !(el as HTMLButtonElement).disabled);
    const boxes = els.map((el) => ({ el, ...box(el.getBoundingClientRect()) }));
    let f = this.domFocus && this.domFocus.isConnected
      ? boxes.find((b) => b.el === this.domFocus) ?? null : null;
    if (!f && boxes.length) {
      const was = this.domRect;
      f = was ? nearestBox(boxes, was.x + was.w / 2, was.y + was.h / 2) : boxes[0];
    }
    for (const c of queue) {
      if (c === "back") { layer.back(); this.domFocus = null; this.hideRing(); return; }
      if (!this.shown) { this.shown = true; break; }
      if (!f) continue;
      if (c === "ok") {
        if (f.el instanceof HTMLInputElement || f.el instanceof HTMLTextAreaElement) f.el.focus();
        else f.el.click();
      } else if (c === "up" || c === "down" || c === "left" || c === "right") {
        const n = pick(f, c, boxes);
        if (n) { f = n; n.el.scrollIntoView({ block: "nearest" }); }
      }
    }
    if (!layer.root.isConnected || !f || !f.el.isConnected) {
      this.domFocus = null;
      this.hideRing();
      return;
    }
    this.domFocus = f.el;
    this.domRect = f;
    if (this.shown) this.showRing(f.x, f.y, f.w, f.h);
    else this.hideRing();
  }

  private showStageRing(e: Entry): void {
    const [x, y, w, h] = visible(e);
    const a = Input.toClient(x, y);
    const b = Input.toClient(x + w, y + h);
    if (!a || !b) return;
    this.showRing(a.x, a.y, b.x - a.x, b.y - a.y);
  }

  private showRing(x: number, y: number, w: number, h: number): void {
    if (!this.ring) {
      const el = document.createElement("div");
      el.style.cssText = "position:fixed;left:0;top:0;z-index:60;pointer-events:none;"
        + "box-sizing:border-box;border:2px solid #ffcc00;"
        + "box-shadow:0 0 0 1px #000,0 0 10px rgba(255,204,0,0.8);display:none;";
      document.body.appendChild(el);
      this.ring = el;
    }
    const s = this.ring.style;
    s.display = "block";
    s.transform = `translate(${x - 3}px, ${y - 3}px)`;
    s.width = `${w + 6}px`;
    s.height = `${h + 6}px`;
  }

  private hideRing(): void {
    if (this.ring) this.ring.style.display = "none";
  }

  private listen(): void {
    if (this.listening || typeof window === "undefined") return;
    this.listening = true;
    const off = (): void => {
      if (!this.shown) return;
      this.shown = false;
      this.focus = null;
      this.surveying = false;
      this.pendingDir = null;
      this.hideRing();
    };
    window.addEventListener("mousemove", (e) => {
      if (e.isTrusted && (e.movementX || e.movementY)) off();
    });
    window.addEventListener("pointerdown", (e) => { if (e.isTrusted) off(); });
    window.addEventListener("touchstart", (e) => { if (e.isTrusted) off(); }, { passive: true });
    window.addEventListener("keydown", this.onKey);
  }

  private onKey = (e: KeyboardEvent): void => {
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement
      || (t instanceof HTMLElement && t.isContentEditable)) return;
    if (!this.keysOn && !this.topLayer()) return;
    if (e.repeat && (e.code === "Enter" || e.code === "Escape")) return;
    const c: FocusCmd | null = e.code === "ArrowUp" ? "up" : e.code === "ArrowDown" ? "down"
      : e.code === "ArrowLeft" ? "left" : e.code === "ArrowRight" ? "right"
        : e.code === "Enter" || e.code === "NumpadEnter" ? "ok"
          : e.code === "Escape" ? "back" : null;
    if (!c) return;
    this.command(c);
  };

  private prune(list: Entry[]): Entry[] {
    const out: Entry[] = [];
    for (const e of list) {
      const dup = out.find((o) => same(o, e));
      if (!dup) { out.push(e); continue; }
      if (!e.auto) {
        Object.assign(dup, e, { auto: dup.auto && e.auto });
      }
    }
    return out.filter((e) => {
      if (!e.auto) return true;
      let inner = 0;
      for (const o of out) {
        if (o !== e && o.x >= e.x - 1 && o.y >= e.y - 1 && o.x + o.w <= e.x + e.w + 1
          && o.y + o.h <= e.y + e.h + 1 && ++inner >= 2) return false;
      }
      return true;
    });
  }
}

interface Box { x: number; y: number; w: number; h: number }

function box(r: DOMRect): Box {
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

function centre(b: Box): [number, number] {
  return [b.x + b.w / 2, b.y + b.h / 2];
}

function same(a: Box, b: Box): boolean {
  return Math.abs(a.x - b.x) <= 1.5 && Math.abs(a.y - b.y) <= 1.5
    && Math.abs(a.w - b.w) <= 1.5 && Math.abs(a.h - b.h) <= 1.5;
}

function visible(e: Entry): [number, number, number, number] {
  const c = e.clip;
  if (!c) return [e.x, e.y, e.w, e.h];
  const x0 = Math.max(e.x, c[0]);
  const y0 = Math.max(e.y, c[1]);
  const x1 = Math.min(e.x + e.w, c[0] + c[2]);
  const y1 = Math.min(e.y + e.h, c[1] + c[3]);
  if (x1 <= x0 || y1 <= y0) return [e.x, e.y, e.w, e.h];
  return [x0, y0, x1 - x0, y1 - y0];
}

function inside(e: Box, c: Rect | undefined): boolean {
  if (!c) return true;
  return e.x >= c[0] - 1 && e.y >= c[1] - 1 && e.x + e.w <= c[0] + c[2] + 1
    && e.y + e.h <= c[1] + c[3] + 1;
}

function target(e: Entry): [number, number] {
  const [x, y, w, h] = visible(e);
  return [x + w / 2, y + h / 2];
}

function nearestBox<T extends Box>(list: readonly T[], x: number, y: number): T | null {
  let best: T | null = null;
  let bestD = Infinity;
  for (const b of list) {
    const [bx, by] = centre(b);
    const d = Math.hypot(bx - x, by - y);
    if (d < bestD) { bestD = d; best = b; }
  }
  return best;
}

function pick<T extends Box>(from: Box, d: Dir, list: readonly T[]): T | null {
  const [fx, fy] = centre(from);
  const horiz = d === "left" || d === "right";
  const sign = d === "right" || d === "down" ? 1 : -1;
  let best: T | null = null;
  let bestS = Infinity;
  for (const b of list) {
    if (same(b, from)) continue;
    const [bx, by] = centre(b);
    const along = (horiz ? bx - fx : by - fy) * sign;
    if (along <= 1) continue;
    const gap = horiz
      ? Math.max(0, sign > 0 ? b.x - (from.x + from.w) : from.x - (b.x + b.w))
      : Math.max(0, sign > 0 ? b.y - (from.y + from.h) : from.y - (b.y + b.h));
    const off = horiz
      ? Math.max(0, Math.max(b.y, from.y) - Math.min(b.y + b.h, from.y + from.h))
      : Math.max(0, Math.max(b.x, from.x) - Math.min(b.x + b.w, from.x + from.w));
    const skew = Math.abs(horiz ? by - fy : bx - fx);
    const s = gap + along * 0.1 + off * 4 + skew * 0.3;
    if (s < bestS) { bestS = s; best = b; }
  }
  return best;
}

export class Repeat {
  private held: Dir | null = null;
  private ticks = 0;

  next(d: Dir | null): Dir | null {
    if (d !== this.held) {
      this.held = d;
      this.ticks = 0;
      return d;
    }
    if (!d) return null;
    this.ticks++;
    return this.ticks >= DELAY && (this.ticks - DELAY) % REPEAT === 0 ? d : null;
  }
}

export const Focus = new FocusNav();
