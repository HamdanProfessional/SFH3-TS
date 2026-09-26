import { Input } from "../core/Input";

type FsDoc = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void;
  webkitFullscreenEnabled?: boolean };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => void };

const ENTER = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#fff" '
  + 'stroke-width="2"><path d="M1 6V1h5M12 1h5v5M17 12v5h-5M6 17H1v-5"/></svg>';
const EXIT = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#fff" '
  + 'stroke-width="2"><path d="M6 1v5H1M17 6h-5V1M12 17v-5h5M1 12h5v5"/></svg>';

class FullscreenToggle {
  private el: HTMLDivElement | null = null;
  private shown = true;

  install(): void {
    const doc = document as FsDoc;
    if (!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled)) return;
    const el = document.createElement("div");
    el.title = "Fullscreen";
    el.style.cssText = "position:fixed;right:8px;bottom:8px;z-index:15;width:34px;height:34px;"
      + "display:flex;align-items:center;justify-content:center;cursor:pointer;"
      + "background:rgba(0,0,0,0.6);border:0;"
      + "opacity:0.6;touch-action:manipulation;";
    el.addEventListener("pointerenter", () => { el.style.opacity = "1"; });
    el.addEventListener("pointerleave", () => { el.style.opacity = "0.6"; });
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggle();
    });
    el.addEventListener("mousedown", (e) => e.stopPropagation());
    document.addEventListener("fullscreenchange", () => this.paint());
    document.addEventListener("webkitfullscreenchange", () => this.paint());
    document.body.appendChild(el);
    this.el = el;
    this.paint();
  }

  update(): void {
    if (!this.el) return;
    const show = !Input.playing;
    if (show === this.shown) return;
    this.shown = show;
    this.el.style.display = show ? "flex" : "none";
  }

  private paint(): void {
    if (this.el) this.el.innerHTML = fullscreenElement() ? EXIT : ENTER;
  }
}

function fullscreenElement(): Element | null {
  const doc = document as FsDoc;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

function toggle(): void {
  const doc = document as FsDoc;
  if (fullscreenElement()) {
    if (doc.exitFullscreen) void doc.exitFullscreen().catch(() => {});
    else doc.webkitExitFullscreen?.();
    return;
  }
  const root = document.documentElement as FsEl;
  const done = () => {
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    if (Input.device === "touch" || matchMedia("(pointer: coarse)").matches) {
      void o?.lock?.("landscape").catch(() => {});
    }
  };
  if (root.requestFullscreen) {
    void root.requestFullscreen({ navigationUI: "hide" }).then(done, () => {});
  } else {
    root.webkitRequestFullscreen?.();
    done();
  }
}

export const FullscreenButton = new FullscreenToggle();
