import { Input } from "../core/Input";
import { controls, saveControls } from "../state/controls";
import { hasTouch } from "../core/device";

const SRC = "touch";
const REACH = 55;
const BTN_BG = "rgba(0,0,0,0.35)";
const BTN_DOWN = "rgba(255,255,255,0.35)";

interface Stick {
  id: number;
  ox: number;
  oy: number;
  base: HTMLDivElement;
  knob: HTMLDivElement;
  size: number;
}

interface StickEls {
  base: HTMLDivElement;
  knob: HTMLDivElement;
  size: number;
  rest: { x: number; y: number };
}

type Action = string | "fire";

interface Control {
  id: string;
  label: string;
  action: Action | null;
  x: number;
  y: number;
  w: number;
  h: number;
}

class TouchLayer {
  private root: HTMLDivElement | null = null;
  private rotate: HTMLDivElement | null = null;
  private shown = false;
  private sources = new Set<string>([SRC, `${SRC}-up`]);
  private buttons: HTMLDivElement[] = [];
  private move: Stick | null = null;
  private aim: Stick | null = null;
  private moveEls!: StickEls;
  private aimEls!: StickEls;
  private builtFor = "";
  private editing = false;
  private onEditDone: (() => void) | null = null;
  private touching = false;
  private seen = false;

  get available(): boolean {
    return hasTouch || this.seen;
  }

  install(): void {
    const down = (e: PointerEvent | TouchEvent) => {
      if (!e.isTrusted) return;
      if ("pointerType" in e) {
        if (e.pointerType === "mouse") this.touching = false;
        if (e.pointerType !== "touch") return;
      }
      this.touching = this.seen = true;
      if (!this.root) this.build();
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("touchstart", down, { capture: true, passive: true });
    window.addEventListener("pointermove", (e) => {
      if (e.isTrusted && e.pointerType === "mouse" && (e.movementX || e.movementY)) {
        this.touching = false;
      }
    }, { capture: true, passive: true });
  }

  update(): void {
    if (!this.root) return;
    const portrait = window.innerHeight > window.innerWidth * 1.1;
    if (this.rotate) {
      this.rotate.style.display = portrait && this.touching && !this.editing ? "flex" : "none";
    }
    if (!this.move && !this.aim && this.builtFor !== sizeKey()) this.relayout();
    const show = (Input.playing && !portrait && this.touching) || this.editing;
    if (show === this.shown) return;
    this.shown = show;
    this.root.style.display = show ? "block" : "none";
    if (!show) this.releaseEverything();
  }

  applySettings(): void {
    if (this.root) this.relayout();
  }

  editLayout(done: () => void): void {
    if (!this.root) this.build();
    this.editing = true;
    this.onEditDone = done;
    this.relayout();
    this.update();
  }

  private build(): void {
    const root = div(document.body, "position:fixed;inset:0;z-index:10;display:none;"
      + "touch-action:none;user-select:none;-webkit-user-select:none;"
      + "-webkit-touch-callout:none;");
    this.root = root;
    root.addEventListener("mousedown", (e) => e.stopPropagation());

    this.rotate = div(document.body, "position:fixed;inset:0;z-index:30;display:none;"
      + "align-items:center;justify-content:center;background:#000;color:#fff;"
      + "font:18px QTypeSquare-Bold, sans-serif;text-align:center;padding:24px;");
    this.rotate.textContent = "Turn your device sideways to play";
    this.relayout();
    this.update();
  }

  private releaseEverything(): void {
    this.move = this.aim = null;
    if (this.moveEls) this.idle(this.moveEls);
    if (this.aimEls) this.idle(this.aimEls);
    for (const src of this.sources) Input.releaseAll(src);
    for (const b of this.buttons) b.style.background = BTN_BG;
  }

  private relayout(): void {
    const root = this.root;
    if (!root) return;
    this.releaseEverything();
    root.replaceChildren();
    this.buttons = [];
    this.builtFor = sizeKey();

    const o = controls();
    const s = clampNum(o.touchScale, 0.7, 1.6);
    const twin = o.touchLayout === 1;
    const w = window.innerWidth, h = window.innerHeight;
    const flip = (x: number): number => (o.touchLeft ? w - x : x);
    const at = (c: Control): { x: number; y: number } => {
      const saved = o.touchPos?.[`${o.touchLayout}:${c.id}`];
      const x = saved ? saved.x * w : c.x;
      const y = saved ? saved.y * h : c.y;
      return {
        x: clampNum(flip(x), c.w / 2, w - c.w / 2),
        y: clampNum(y, c.h / 2, h - c.h / 2),
      };
    };

    const stickSize = (twin ? 130 : 100) * s;
    const placed = layoutOf(twin, o.touchAutoFire, s, w, h);
    const moveC = placed.find((c) => c.id === "move")!;
    const aimC = placed.find((c) => c.id === "aim")!;
    const moveAt = at(moveC), aimAt = at(aimC);

    if (twin) {
      const grab = stickSize * 1.6;
      const zone = (p: { x: number; y: number }): HTMLDivElement => div(root, "position:absolute;"
        + `left:${p.x - grab / 2}px;top:${p.y - grab / 2}px;width:${grab}px;height:${grab}px;`
        + "border-radius:50%;");
      this.zone(zone(moveAt), "move", moveAt);
      this.zone(zone(aimAt), "aim", aimAt);
    } else {
      const left = div(root, "position:absolute;top:0;height:100%;"
        + (o.touchLeft ? "left:55%;right:0;" : "left:0;width:45%;"));
      const right = div(root, "position:absolute;top:0;height:100%;"
        + (o.touchLeft ? "left:0;width:55%;" : "left:45%;right:0;"));
      this.zone(left, "move", null);
      this.zone(right, "aim", null);
    }
    this.moveEls = stickEls(root, stickSize, moveAt);
    this.aimEls = stickEls(root, stickSize, aimAt);
    this.idle(this.moveEls);
    this.idle(this.aimEls);
    if (this.editing && twin) {
      this.draggable(this.moveEls.base, moveC);
      this.draggable(this.aimEls.base, aimC);
    }

    for (const c of placed) {
      if (!c.action) continue;
      const p = at(c);
      const b = button(root, c.label, `left:${p.x - c.w / 2}px;top:${p.y - c.h / 2}px;`
        + `width:${c.w}px;height:${c.h}px;`
        + `font-size:${Math.round(11 * Math.min(s, 1.3))}px;`);
      if (this.editing) this.draggable(b, c);
      else this.hold(b, c.action);
    }

    if (this.editing) this.toolbar(root);
  }

  private toolbar(root: HTMLDivElement): void {
    const bar = div(root, "position:absolute;left:50%;top:52px;transform:translateX(-50%);"
      + "display:flex;gap:10px;align-items:center;padding:8px 12px;border-radius:6px;"
      + "background:rgba(0,0,0,0.7);color:#fff;font:12px QTypeSquare-Bold, sans-serif;");
    div(bar, "").textContent = "Drag the controls";
    const act = (label: string, fn: () => void): void => {
      const b = div(bar, "padding:6px 12px;border:1px solid rgba(255,255,255,0.6);"
        + "border-radius:4px;cursor:pointer;");
      b.textContent = label;
      b.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); });
      b.addEventListener("click", (e) => { e.stopPropagation(); fn(); });
    };
    act("RESET", () => {
      const pre = `${controls().touchLayout}:`;
      for (const k of Object.keys(controls().touchPos)) {
        if (k.startsWith(pre)) delete controls().touchPos[k];
      }
      this.relayout();
    });
    act("DONE", () => {
      this.editing = false;
      saveControls();
      this.relayout();
      this.update();
      const done = this.onEditDone;
      this.onEditDone = null;
      done?.();
    });
  }

  private draggable(el: HTMLDivElement, c: Control): void {
    el.style.pointerEvents = "auto";
    el.style.outline = "2px dashed rgba(255,220,80,0.8)";
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const moveTo = (ev: PointerEvent): { x: number; y: number } => {
        const x = ev.clientX - dx, y = ev.clientY - dy;
        el.style.left = `${x - r.width / 2}px`;
        el.style.top = `${y - r.height / 2}px`;
        el.style.transform = "none";
        return { x, y };
      };
      const onMove = (ev: PointerEvent): void => { moveTo(ev); };
      const onUp = (ev: PointerEvent): void => {
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
        el.removeEventListener("pointercancel", onUp);
        const p = moveTo(ev);
        const w = window.innerWidth, h = window.innerHeight;
        const x = controls().touchLeft ? w - p.x : p.x;
        controls().touchPos[`${controls().touchLayout}:${c.id}`] = { x: x / w, y: p.y / h };
        this.relayout();
      };
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointercancel", onUp);
    });
  }

  private zone(el: HTMLDivElement, which: "move" | "aim", fixed: { x: number; y: number } | null): void {
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (this.editing) return;
      if (which === "move" ? this.move : this.aim) return;
      el.setPointerCapture(e.pointerId);
      const els = which === "move" ? this.moveEls : this.aimEls;
      const s: Stick = {
        id: e.pointerId, ox: fixed ? fixed.x : e.clientX, oy: fixed ? fixed.y : e.clientY,
        base: els.base, knob: els.knob, size: els.size,
      };
      if (which === "move") this.move = s; else this.aim = s;
      if (fixed) this.steer(which, s, e.clientX - s.ox, e.clientY - s.oy);
      else this.place(s, 0, 0);
      Input.device = "touch";
    });
    el.addEventListener("pointermove", (e) => {
      const s = which === "move" ? this.move : this.aim;
      if (!s || s.id !== e.pointerId) return;
      this.steer(which, s, e.clientX - s.ox, e.clientY - s.oy);
    });
    const end = (e: PointerEvent) => {
      const s = which === "move" ? this.move : this.aim;
      if (!s || s.id !== e.pointerId) return;
      if (which === "move") {
        this.move = null;
        for (const k of ["KeyA", "KeyD", "KeyS"]) Input.setKey(SRC, k, false);
        Input.releaseAll(`${SRC}-up`);
        this.idle(this.moveEls);
      } else {
        this.aim = null;
        Input.setButton(SRC, "left", false);
        this.idle(this.aimEls);
      }
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  }

  private steer(which: "move" | "aim", s: Stick, dx: number, dy: number): void {
    const reach = REACH * clampNum(controls().touchScale, 0.7, 1.6)
      * (controls().touchLayout === 1 ? 1.3 : 1);
    const m = Math.hypot(dx, dy);
    if (m > reach) { dx *= reach / m; dy *= reach / m; }
    this.place(s, dx, dy);
    const nx = dx / reach, ny = dy / reach;
    if (which === "move") {
      Input.setKey(SRC, "KeyA", nx < -0.3);
      Input.setKey(SRC, "KeyD", nx > 0.3);
      Input.setKey(SRC, "KeyS", ny > 0.6);
      Input.setKey(`${SRC}-up`, "KeyW", ny < -0.6);
    } else {
      const t = Math.hypot(nx, ny);
      if (t > 0.15) Input.aimStick(nx, ny, "touch");
      const fireAt = clampNum(controls().touchFireAt, 0.3, 0.95);
      Input.setButton(SRC, "left", controls().touchAutoFire && t > fireAt);
    }
  }

  private hold(b: HTMLDivElement, action: Action): void {
    const src = `${SRC}-${action}`;
    this.sources.add(src);
    this.buttons.push(b);
    const set = (on: boolean): void => {
      if (action === "fire") Input.setButton(src, "left", on);
      else Input.setKey(src, action, on);
    };
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      b.setPointerCapture(e.pointerId);
      b.style.background = BTN_DOWN;
      set(true);
    });
    const up = () => {
      b.style.background = BTN_BG;
      set(false);
    };
    b.addEventListener("pointerup", up);
    b.addEventListener("pointercancel", up);
  }

  private place(s: Stick, dx: number, dy: number): void {
    const r = s.size / 2, k = s.size * 0.22;
    s.base.style.opacity = "1";
    s.knob.style.opacity = "1";
    s.base.style.transform = `translate(${s.ox - r}px, ${s.oy - r}px)`;
    s.knob.style.transform = `translate(${s.ox + dx - k}px, ${s.oy + dy - k}px)`;
  }

  private idle(els: StickEls): void {
    const p = els.rest;
    const r = els.size / 2, k = els.size * 0.22;
    els.base.style.opacity = els.knob.style.opacity = "0.35";
    els.base.style.transform = `translate(${p.x - r}px, ${p.y - r}px)`;
    els.knob.style.transform = `translate(${p.x - k}px, ${p.y - k}px)`;
  }
}

function layoutOf(twin: boolean, autoFire: boolean, s: number, w: number, h: number): Control[] {
  const out: Control[] = [];
  const btn = (id: string, action: Action, x: number, y: number, d: number): void => {
    out.push({ id, label: id, action, x, y, w: d, h: d });
  };
  const col: [string, string][] = [["JUMP", "KeyW"], ["RELOAD", "KeyR"], ["SWAP", "KeyQ"],
    ["STREAK", "KeyE"]];
  if (twin) {
    const r = 65 * s, pad = 24;
    const my = h - pad - r;
    out.push({ id: "move", label: "", action: null, x: pad + r, y: my, w: 2 * r, h: 2 * r });
    const ax = w - pad - r;
    out.push({ id: "aim", label: "", action: null, x: ax, y: my, w: 2 * r, h: 2 * r });
    const R = r + 62 * s, d = 56 * s;
    col.forEach(([id, code], i) => {
      const a = Math.PI - (i * Math.PI) / 6;
      btn(id, code, ax + Math.cos(a) * R, my - Math.sin(a) * R, d);
    });
    if (!autoFire) {
      const a = Math.PI + Math.PI / 7;
      btn("FIRE", "fire", ax + Math.cos(a) * R, my - Math.sin(a) * R, 70 * s);
    }
  } else {
    out.push({ id: "move", label: "", action: null, x: 110, y: h - 110, w: 100 * s, h: 100 * s });
    out.push({ id: "aim", label: "", action: null, x: w - 200, y: h - 110, w: 100 * s, h: 100 * s });
    const d = 62 * s;
    col.forEach(([id, code], i) => btn(id, code, w - 14 - d / 2, h - 18 - d / 2 - i * 70 * s, d));
    if (!autoFire) btn("FIRE", "fire", w - 14 - d - 18 - 36 * s, h - 18 - 36 * s, 72 * s);
  }
  out.push({ id: "PAUSE", label: "II", action: "Escape", x: w / 2, y: 8 + 18 * s,
    w: 44 * s, h: 36 * s });
  return out;
}

function sizeKey(): string {
  return `${window.innerWidth}x${window.innerHeight}`;
}

function clampNum(v: number, lo: number, hi: number): number {
  return !(v >= lo) ? lo : v > hi ? hi : v;
}

function div(parent: HTMLElement, css: string): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText = css;
  parent.appendChild(el);
  return el;
}

function stickEls(root: HTMLDivElement, size: number, rest: { x: number; y: number }): StickEls {
  const common = "position:absolute;left:0;top:0;border-radius:50%;pointer-events:none;";
  const knob = size * 0.44;
  return {
    base: div(root, common + `width:${size}px;height:${size}px;border:2px solid rgba(255,255,255,0.5);`
      + "background:rgba(0,0,0,0.2);box-sizing:border-box;"),
    knob: div(root, common + `width:${knob}px;height:${knob}px;background:rgba(255,255,255,0.45);`),
    size,
    rest,
  };
}

function button(root: HTMLDivElement, label: string, css: string): HTMLDivElement {
  const b = div(root, "position:absolute;display:flex;align-items:center;justify-content:center;"
    + "border-radius:50%;border:2px solid rgba(255,255,255,0.55);background:" + BTN_BG + ";"
    + "color:#fff;font:bold 11px QTypeSquare-Bold, sans-serif;box-sizing:border-box;" + css);
  b.textContent = label;
  return b;
}

export const TouchControls = new TouchLayer();
