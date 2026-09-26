import { GAME_WIDTH, GAME_HEIGHT } from "./Config";
import { Input } from "./Input";
import { Focus, Repeat, type Dir } from "./Focus";
import { controls } from "../state/controls";

const SRC = "pad";
const START_SRC = "pad-start";
const DEAD = 0.25;
const CURSOR_SPEED = 16;
export const STICK_REACH = [120, 170, 240] as const;

const enum B {
  A = 0, B = 1, X = 2, Y = 3, LB = 4, RB = 5, LT = 6, RT = 7,
  BACK = 8, START = 9, UP = 12, DOWN = 13, LEFT = 14, RIGHT = 15,
}

class GamepadDriver {
  private prev: boolean[] = [];
  private cursor: HTMLDivElement | null = null;
  private cx = 0;
  private cy = 0;
  private live = false;
  private wasCursor = false;
  private cursorDown = false;
  private domDown: Element | null = null;
  private repeat = new Repeat();

  poll(): void {
    Input.aimReach = STICK_REACH[controls().stickReach] ?? STICK_REACH[1];
    const pad = firstPad();
    if (!pad) {
      if (this.live) this.reset();
      return;
    }
    const btn = pad.buttons.map((b) => b.pressed || b.value > 0.5);
    const ax = pad.axes;
    const [lx, ly] = radial(ax[0] ?? 0, ax[1] ?? 0);
    const [rx, ry] = radial(ax[2] ?? 0, ax[3] ?? 0);

    if (btn.some(Boolean) || lx || ly || rx || ry) {
      if (!this.live) {
        this.cx = Input.mouseX;
        this.cy = Input.mouseY;
      }
      this.live = true;
    }
    if (Input.device === "mouse" && this.live && !btn.some(Boolean) && !lx && !ly && !rx && !ry) {
      this.hideCursor();
    }
    if (!this.live) {
      this.prev = btn;
      return;
    }

    Input.setKey(START_SRC, "Escape", !!btn[B.START]);
    Input.setKey(START_SRC, "Tab", !!btn[B.BACK]);

    const cursorMode = !Input.playing;
    if (cursorMode !== this.wasCursor) {
      Input.releaseAll(SRC);
      this.release();
      this.cx = Input.mouseX;
      this.cy = Input.mouseY;
      this.wasCursor = cursorMode;
    }

    if (cursorMode) this.menu(btn, lx || rx, ly || ry);
    else this.play(btn, lx, ly, rx, ry);
    this.prev = btn;
  }

  private play(btn: boolean[], lx: number, ly: number, rx: number, ry: number): void {
    this.hideCursor();
    Input.setKey(SRC, "KeyA", lx < -0.3 || !!btn[B.LEFT]);
    Input.setKey(SRC, "KeyD", lx > 0.3 || !!btn[B.RIGHT]);
    Input.setKey(SRC, "KeyS", ly > 0.6 || !!btn[B.DOWN]);
    Input.setKey(SRC, "KeyW", !!btn[B.A] || !!btn[B.UP]);
    Input.setKey(SRC, "KeyR", !!btn[B.X]);
    Input.setKey(SRC, "KeyQ", !!btn[B.Y] || !!btn[B.RB]);
    Input.setKey(SRC, "KeyE", !!btn[B.B] || !!btn[B.LB]);
    Input.setButton(SRC, "left", !!btn[B.RT]);
    Input.setButton(SRC, "right", !!btn[B.LT]);
    if (rx || ry) Input.aimStick(rx, ry, "pad");
    else if (lx && Input.device !== "pad") Input.aimStick(Math.sign(lx), 0, "pad");
  }

  private menu(btn: boolean[], x: number, y: number): void {
    if (Focus.available()) {
      this.focusNav(btn, x, y);
      return;
    }
    if (btn[B.LEFT]) x = -1;
    if (btn[B.RIGHT]) x = 1;
    if (btn[B.UP]) y = -1;
    if (btn[B.DOWN]) y = 1;
    if (x || y || btn.some(Boolean)) Input.device = "pad";
    if (x || y) {
      this.cx = clamp(this.cx + x * CURSOR_SPEED, 0, GAME_WIDTH - 1);
      this.cy = clamp(this.cy + y * CURSOR_SPEED, 0, GAME_HEIGHT - 1);
    }
    if (Input.device !== "pad") return;
    Input.mouseX = this.cx;
    Input.mouseY = this.cy;
    this.showCursor();
    if (x || y) this.pointer("pointermove");

    const a = !!btn[B.A];
    if (a && !this.prev[B.A]) {
      const el = this.under();
      if (el) {
        this.domDown = el;
        this.dom(el, "pointerdown");
      } else {
        this.pointer("pointerdown");
        this.cursorDown = true;
      }
    } else if (!a) {
      this.release();
    }
    Input.setButton(SRC, "left", a && !this.domDown);
    Input.setKey(SRC, "ArrowLeft", !!btn[B.LB]);
    Input.setKey(SRC, "ArrowRight", !!btn[B.RB]);
  }

  private focusNav(btn: boolean[], x: number, y: number): void {
    this.hideCursor();
    this.release();
    Input.releaseAll(SRC);
    if (btn.some(Boolean) || x || y) Input.device = "pad";
    let d: Dir | null = btn[B.UP] ? "up" : btn[B.DOWN] ? "down"
      : btn[B.LEFT] ? "left" : btn[B.RIGHT] ? "right" : null;
    if (!d && Math.max(Math.abs(x), Math.abs(y)) > 0.5) {
      d = Math.abs(x) > Math.abs(y) ? (x > 0 ? "right" : "left") : (y > 0 ? "down" : "up");
    }
    const step = this.repeat.next(d);
    if (step) Focus.command(step);
    const edge = (b: B): boolean => !!btn[b] && !this.prev[b];
    if (edge(B.A)) Focus.command("ok");
    if (edge(B.B)) Focus.command("back");
    if (edge(B.LB)) Focus.command("navPrev");
    if (edge(B.RB)) Focus.command("navNext");
    if (edge(B.LT)) Focus.command("pagePrev");
    if (edge(B.RT)) Focus.command("pageNext");
  }

  private release(): void {
    if (this.cursorDown) this.pointer("pointerup");
    this.cursorDown = false;
    const el = this.domDown;
    if (el) {
      this.domDown = null;
      this.dom(el, "pointerup");
      if (el.isConnected && el instanceof HTMLElement) el.click();
    }
  }

  private under(): Element | null {
    const at = Input.toClient(this.cx, this.cy);
    const canvas = Input.canvas;
    if (!at || !canvas) return null;
    const el = document.elementFromPoint(at.x, at.y);
    if (!el || el === canvas || canvas.contains(el)) return null;
    if (el === document.body || el === document.documentElement) return null;
    if (el.contains(canvas)) return null;
    return el;
  }

  private dom(el: Element, type: string): void {
    const at = Input.toClient(this.cx, this.cy);
    if (!at) return;
    el.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true,
      clientX: at.x, clientY: at.y, pointerId: 1, pointerType: "mouse",
      isPrimary: true, button: 0, buttons: type === "pointerdown" ? 1 : 0,
    }));
  }

  private pointer(type: string): void {
    const canvas = Input.canvas;
    const at = Input.toClient(this.cx, this.cy);
    if (!canvas || !at) return;
    const down = type === "pointerdown";
    canvas.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true,
      clientX: at.x, clientY: at.y, pointerId: 1, pointerType: "mouse",
      isPrimary: true, button: type === "pointermove" ? -1 : 0,
      buttons: down || (type === "pointermove" && this.cursorDown) ? 1 : 0,
    }));
  }

  private showCursor(): void {
    const at = Input.toClient(this.cx, this.cy);
    if (!at) return;
    if (!this.cursor) {
      const el = document.createElement("div");
      el.style.cssText = "position:fixed;left:0;top:0;width:22px;height:22px;z-index:50;"
        + "pointer-events:none;will-change:transform;";
      el.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M2 2 L2 18 L7 13'
        + ' L10 20 L13 19 L10 12 L17 12 Z" fill="#fff" stroke="#000" stroke-width="1.5"'
        + ' stroke-linejoin="round"/></svg>';
      document.body.appendChild(el);
      this.cursor = el;
    }
    this.cursor.style.display = "block";
    this.cursor.style.transform = `translate(${at.x - 2}px, ${at.y - 2}px)`;
  }

  private hideCursor(): void {
    if (this.cursor) this.cursor.style.display = "none";
  }

  private reset(): void {
    Input.releaseAll(SRC);
    Input.releaseAll(START_SRC);
    this.release();
    this.hideCursor();
    this.live = false;
    this.prev = [];
    if (Input.device === "pad") Input.device = "mouse";
  }
}

function firstPad(): Gamepad | null {
  const pads = navigator.getGamepads?.() ?? [];
  for (const p of pads) if (p && p.connected) return p;
  return null;
}

function radial(x: number, y: number): [number, number] {
  const m = Math.hypot(x, y);
  if (m < DEAD) return [0, 0];
  const k = Math.min(1, (m - DEAD) / (1 - DEAD)) / m;
  return [x * k, y * k];
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export const Gamepads = new GamepadDriver();
