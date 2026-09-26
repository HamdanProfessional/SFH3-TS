import { Sound } from "../audio/Sounds";
import { GAME_WIDTH, GAME_HEIGHT } from "./Config";

class InputManager {
  private down = new Set<string>();
  private pressed = new Set<string>();

  mouseX = 0;
  mouseY = 0;
  mouseDown = false;
  mousePressed = false;
  mouseReleased = false;
  blurred = false;
  rightDown = false;
  rightPressed = false;
  wheelDelta = 0;

  showHitboxes = false;

  private virtual = new Map<string, Set<string>>();
  private leftBy = new Set<string>();
  private rightBy = new Set<string>();

  device: "mouse" | "pad" | "touch" = "mouse";
  playing = false;
  private aimDir: { x: number; y: number } | null = null;
  aimReach = 170;

  private attached = false;
  private target: HTMLElement | null = null;

  attach(target: HTMLElement): void {
    if (this.attached) return;
    this.attached = true;
    this.target = target;

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    target.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("blur", this.onBlur);
    target.addEventListener("wheel", this.onWheel, { passive: true });
    target.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  isDown(code: string): boolean {
    return this.down.has(code) || (this.virtual.get(code)?.size ?? 0) > 0;
  }

  setKey(source: string, code: string, on: boolean): void {
    let by = this.virtual.get(code);
    if (on) {
      if (!this.isDown(code)) this.pressed.add(code);
      if (!by) this.virtual.set(code, by = new Set());
      by.add(source);
    } else {
      by?.delete(source);
    }
  }

  setButton(source: string, button: "left" | "right", on: boolean): void {
    const by = button === "left" ? this.leftBy : this.rightBy;
    const was = by.size > 0;
    if (on) by.add(source); else by.delete(source);
    const now = by.size > 0;
    if (button === "left") {
      if (now && !was) this.mousePressed = true;
      if (!now && was) this.mouseReleased = true;
      this.mouseDown = now;
    } else {
      if (now && !was) this.rightPressed = true;
      this.rightDown = now;
    }
  }

  releaseAll(source: string): void {
    for (const code of this.virtual.keys()) this.setKey(source, code, false);
    this.setButton(source, "left", false);
    this.setButton(source, "right", false);
  }

  aimStick(x: number, y: number, source: "pad" | "touch"): void {
    const m = Math.hypot(x, y);
    if (m < 1e-3) return;
    this.aimDir = { x: x / m, y: y / m };
    this.device = source;
  }

  setAimOrigin(x: number, y: number): void {
    if (this.device === "mouse" || !this.aimDir) return;
    this.mouseX = x + this.aimDir.x * this.aimReach;
    this.mouseY = y + this.aimDir.y * this.aimReach;
  }

  toClient(x: number, y: number): { x: number; y: number } | null {
    const rect = this.target?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return null;
    return { x: rect.left + (x * rect.width) / GAME_WIDTH, y: rect.top + (y * rect.height) / GAME_HEIGHT };
  }

  get canvas(): HTMLElement | null {
    return this.target;
  }

  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  endFrame(): void {
    this.pressed.clear();
    this.mousePressed = false;
    this.mouseReleased = false;
    this.rightPressed = false;
    this.blurred = false;
  }

  private onKeyDown = (e: KeyboardEvent) => {
    Sound.resume();
    if (!this.down.has(e.code)) {
      this.pressed.add(e.code);
      if (e.code === "KeyM") this.showHitboxes = !this.showHitboxes;
    }
    this.down.add(e.code);
    if (
      e.code === "Space" ||
      e.code.startsWith("Arrow") ||
      e.code === "Tab"
    ) {
      e.preventDefault();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.down.delete(e.code);
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.target) return;
    if (e.isTrusted && (e.movementX || e.movementY)) {
      this.device = "mouse";
      this.aimDir = null;
    }
    const rect = this.target.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.mouseX = ((e.clientX - rect.left) * GAME_WIDTH) / rect.width;
    this.mouseY = ((e.clientY - rect.top) * GAME_HEIGHT) / rect.height;
  };

  private onMouseDown = (e: MouseEvent) => {
    Sound.resume();
    if (!e.isTrusted) return;
    if (e.button === 0) this.setButton("mouse", "left", true);
    else if (e.button === 2) this.setButton("mouse", "right", true);
  };

  private onMouseUp = (e: MouseEvent) => {
    if (!e.isTrusted) return;
    if (e.button === 0) this.setButton("mouse", "left", false);
    else if (e.button === 2) this.setButton("mouse", "right", false);
  };

  private onWheel = (e: WheelEvent) => {
    this.wheelDelta += e.deltaY > 0 ? 1 : -1;
  };

  private onBlur = () => {
    this.down.clear();
    this.virtual.clear();
    this.leftBy.clear();
    this.rightBy.clear();
    if (this.mouseDown) this.mouseReleased = true;
    this.mouseDown = false;
    this.rightDown = false;
    this.blurred = true;
  };
}

export const Input = new InputManager();
