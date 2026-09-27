import { Input } from "../core/Input";

type FsDoc = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void;
  webkitFullscreenEnabled?: boolean };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => void };

const ENTER = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#fff" '
  + 'stroke-width="2"><path d="M1 6V1h5M12 1h5v5M17 12v5h-5M6 17H1v-5"/></svg>';
const EXIT = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#fff" '
  + 'stroke-width="2"><path d="M6 1v5H1M17 6h-5V1M12 17v-5h5M1 12h5v5"/></svg>';

const TIP_KEY = "sfh3.homeTip";

function isIOS(): boolean {
  const n = navigator as Navigator & { maxTouchPoints?: number };
  return /iPhone|iPad|iPod/.test(n.userAgent) || (n.platform === "MacIntel" && (n.maxTouchPoints ?? 0) > 1);
}

function installed(): boolean {
  const n = navigator as Navigator & { standalone?: boolean };
  return n.standalone === true || matchMedia("(display-mode: standalone)").matches
    || matchMedia("(display-mode: fullscreen)").matches;
}

class FullscreenToggle {
  private el: HTMLDivElement | null = null;
  private tip: HTMLDivElement | null = null;
  private shown = true;
  private homeScreenOnly = false;

  install(): void {
    const doc = document as FsDoc;
    const native = !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
    if (!native) {
      if (!isIOS() || installed()) return;
      this.homeScreenOnly = true;
    }
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
      if (this.homeScreenOnly) this.showTip();
      else toggle();
    });
    el.addEventListener("mousedown", (e) => e.stopPropagation());
    document.addEventListener("fullscreenchange", () => this.paint());
    document.addEventListener("webkitfullscreenchange", () => this.paint());
    document.body.appendChild(el);
    this.el = el;
    this.paint();
    if (this.homeScreenOnly) {
      let seen = false;
      try { seen = localStorage.getItem(TIP_KEY) === "1"; } catch { seen = true; }
      if (!seen) {
        const first = () => {
          window.removeEventListener("pointerdown", first, true);
          window.setTimeout(() => this.showTip(8000), 600);
          try { localStorage.setItem(TIP_KEY, "1"); } catch { return; }
        };
        window.addEventListener("pointerdown", first, true);
      }
    }
  }

  private showTip(autoHide = 0): void {
    if (!this.tip) {
      const tip = document.createElement("div");
      tip.style.cssText = "position:fixed;right:8px;bottom:50px;z-index:40;max-width:260px;"
        + "padding:10px 34px 10px 12px;background:rgba(0,0,0,0.88);color:#fff;"
        + "font:12px/1.4 QTypeSquare-Bold, Verdana, sans-serif;border-left:3px solid #ffcc00;"
        + "touch-action:manipulation;";
      tip.innerHTML = "<b style=\"color:#ffcc00\">Play full screen</b><br>"
        + "Tap <b>Share</b> in Safari, then <b>Add to Home Screen</b>. "
        + "Open the game from your home screen and the browser bars are gone.";
      const x = document.createElement("div");
      x.textContent = "✕";
      x.style.cssText = "position:absolute;right:8px;top:6px;padding:4px 6px;cursor:pointer;";
      tip.appendChild(x);
      for (const t of ["pointerdown", "mousedown", "touchstart"]) {
        tip.addEventListener(t, (e) => e.stopPropagation());
      }
      x.addEventListener("pointerdown", () => { tip.style.display = "none"; });
      document.body.appendChild(tip);
      this.tip = tip;
    }
    this.tip.style.display = "block";
    if (autoHide) {
      const tip = this.tip;
      window.setTimeout(() => { tip.style.display = "none"; }, autoHide);
    }
  }

  update(): void {
    if (!this.el) return;
    const show = !Input.playing;
    if (show === this.shown) return;
    this.shown = show;
    this.el.style.display = show ? "flex" : "none";
  }

  private paint(): void {
    if (this.el) this.el.innerHTML = !this.homeScreenOnly && fullscreenElement() ? EXIT : ENTER;
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
