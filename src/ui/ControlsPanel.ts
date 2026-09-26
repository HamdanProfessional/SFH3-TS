import { controls, saveControls } from "../state/controls";
import { TouchControls } from "./TouchControls";
import { Focus } from "../core/Focus";
import { sfhCss } from "./sfhCss";

class ControlsSheet {
  private root: HTMLDivElement | null = null;
  private body: HTMLDivElement | null = null;

  open(): void {
    if (!this.root) this.build();
    this.root!.style.display = "flex";
    this.render();
    Focus.pushLayer(this.root!, () => this.close());
  }

  close(): void {
    if (!this.root) return;
    this.root.style.display = "none";
    Focus.popLayer(this.root);
    saveControls();
  }

  private build(): void {
    sfhCss();
    const root = document.createElement("div");
    root.className = "sfh-ui";
    root.style.cssText = "position:fixed;inset:0;z-index:40;display:none;align-items:center;"
      + "justify-content:center;background:rgba(0,0,0,0.55);touch-action:manipulation;"
      + "user-select:none;-webkit-user-select:none;";
    for (const t of ["mousedown", "pointerdown", "touchstart"]) {
      root.addEventListener(t, (e) => e.stopPropagation());
    }
    root.addEventListener("click", (e) => {
      if (e.target === root) this.close();
    });
    const body = document.createElement("div");
    body.style.cssText = "width:min(460px,92vw);max-height:90vh;overflow:auto;padding:10px 12px 12px;"
      + "background:rgba(0,0,0,.88);font-size:13px;box-sizing:border-box;";
    root.appendChild(body);
    document.body.appendChild(root);
    this.root = root;
    this.body = body;
  }

  private render(): void {
    const body = this.body;
    if (!body) return;
    body.replaceChildren();
    const o = controls();

    if (TouchControls.available) this.touchRows(body);

    heading(body, "GAMEPAD");
    this.cycle(body, "Aim distance", ["Near", "Medium", "Far"], o.stickReach, (v) => { o.stickReach = v; });
    const pad = firstPadId();
    const info = document.createElement("div");
    info.style.cssText = "padding:6px 2px;color:#b4b0b6;font-size:11px;line-height:1.5;";
    info.innerHTML = (pad ? `Connected: ${escapeHtml(pad)}` : "No gamepad found: press a button on it.")
      + "<br>Left stick move, A jump, right stick aim, RT fire, LT right-click action,"
      + " X reload, Y/RB swap, B/LB killstreak, Start pause.";
    body.appendChild(info);

    const end = document.createElement("div");
    end.style.cssText = "display:flex;justify-content:flex-end;padding-top:10px;";
    body.appendChild(end);
    button(end, "CLOSE", () => this.close(), true);
  }

  private touchRows(body: HTMLDivElement): void {
    const o = controls();
    heading(body, "TOUCH CONTROLS");
    this.cycle(body, "Layout", ["Classic", "Twin-stick"], o.touchLayout, (v) => { o.touchLayout = v; });
    this.stepper(body, "Size", `${Math.round(o.touchScale * 100)}%`, (d) => {
      o.touchScale = round2(clamp(o.touchScale + d * 0.1, 0.7, 1.6));
    });
    this.cycle(body, "Handed", ["Right", "Left"], o.touchLeft ? 1 : 0, (v) => { o.touchLeft = v === 1; });
    this.cycle(body, "Auto-fire", ["Off", "On"], o.touchAutoFire ? 1 : 0,
      (v) => { o.touchAutoFire = v === 1; });
    if (o.touchAutoFire) {
      this.stepper(body, "Fires past", `${Math.round(o.touchFireAt * 100)}% tilt`, (d) => {
        o.touchFireAt = round2(clamp(o.touchFireAt + d * 0.05, 0.3, 0.95));
      });
    }
    const edit = row(body, "Button positions");
    button(edit, "EDIT LAYOUT", () => {
      this.root!.style.display = "none";
      Focus.popLayer(this.root!);
      TouchControls.editLayout(() => this.open());
    });
  }

  private cycle(body: HTMLDivElement, name: string, labels: string[], at: number,
    set: (v: number) => void): void {
    button(row(body, name), labels[at] ?? labels[0], () => {
      set(((at | 0) + 1) % labels.length);
      this.changed();
    });
  }

  private stepper(body: HTMLDivElement, name: string, value: string, step: (d: number) => void): void {
    const r = row(body, name);
    const box = document.createElement("div");
    box.style.cssText = "display:flex;align-items:center;gap:4px;";
    r.appendChild(box);
    button(box, "-", () => { step(-1); this.changed(); });
    const v = document.createElement("span");
    v.style.cssText = "min-width:74px;text-align:center;font-family:QTypeSquare-Bold,Verdana,sans-serif;";
    v.textContent = value;
    box.appendChild(v);
    button(box, "+", () => { step(1); this.changed(); });
  }

  private changed(): void {
    TouchControls.applySettings();
    this.render();
  }
}

function heading(body: HTMLDivElement, text: string): void {
  const h = document.createElement("div");
  h.className = "sfh-band";
  h.style.cssText = "margin-top:10px;font-size:16px;";
  h.textContent = text;
  body.appendChild(h);
}

function row(body: HTMLDivElement, name: string): HTMLDivElement {
  const r = document.createElement("div");
  r.className = "sfh-row";
  const l = document.createElement("div");
  l.className = "sfh-lab";
  l.textContent = name;
  const vals = document.createElement("div");
  vals.className = "sfh-vals";
  r.append(l, vals);
  body.appendChild(r);
  return vals;
}

function button(parent: HTMLElement, text: string, fn: () => void, slab = false): void {
  const b = document.createElement("div");
  b.className = slab ? "sfh-btn" : "sfh-val";
  b.style.cssText = slab ? "padding:8px 18px 7px;font-size:12px;text-align:center;"
    : "text-align:center;";
  b.dataset.focus = "";
  b.textContent = text;
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    fn();
  });
  parent.appendChild(b);
}

function firstPadId(): string | null {
  const pads = navigator.getGamepads?.() ?? [];
  for (const p of pads) if (p && p.connected) return p.id;
  return null;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function clamp(v: number, lo: number, hi: number): number {
  return !(v >= lo) ? lo : v > hi ? hi : v;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export const ControlsPanel = new ControlsSheet();
