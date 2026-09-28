import { Input } from "../core/Input";

type FsDoc = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void;
  webkitFullscreenEnabled?: boolean };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => void };

const ENTER = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#fff" '
  + 'stroke-width="2"><path d="M1 6V1h5M12 1h5v5M17 12v5h-5M6 17H1v-5"/></svg>';
const EXIT = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#fff" '
  + 'stroke-width="2"><path d="M6 1v5H1M17 6h-5V1M12 17v-5h5M1 12h5v5"/></svg>';

const ARROW = '<svg width="34" height="44" viewBox="0 0 34 44" fill="none" stroke="#ffcc00" '
  + 'stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M17 42V4M4 17 17 4l13 13"/></svg>';

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

function barsShowing(): boolean {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (h >= w) return false;
  return h < Math.min(screen.width, screen.height) - 12;
}

class FullscreenToggle {
  private el: HTMLDivElement | null = null;
  private tip: HTMLDivElement | null = null;
  private shown = true;
  private homeScreenOnly = false;
  private swipe: HTMLDivElement | null = null;
  private swipeSkipped = false;
  private swipeTimer = 0;

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
      this.installSwipe();
      let seen = false;
      try { seen = localStorage.getItem(TIP_KEY) === "1"; } catch { seen = true; }
      if (!seen) {
        const first = () => {
          window.removeEventListener("pointerdown", first, true);
          if (this.swipe?.style.display !== "flex") window.setTimeout(() => this.showTip(8000), 600);
          try { localStorage.setItem(TIP_KEY, "1"); } catch { return; }
        };
        window.addEventListener("pointerdown", first, true);
      }
    }
  }

  private installSwipe(): void {
    const html = document.documentElement.style;
    html.height = "auto";
    html.overflowX = "hidden";
    html.overflowY = "auto";
    const body = document.body.style;
    body.height = "auto";
    body.overflow = "visible";
    body.minHeight = "calc(100vh + 240px)";
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;inset:0;z-index:35;display:none;flex-direction:column;"
      + "align-items:center;justify-content:center;gap:10px;padding:16px;box-sizing:border-box;"
      + "background:rgba(0,0,0,0.72);color:#fff;text-align:center;touch-action:pan-y;"
      + "font:13px/1.4 QTypeSquare-Bold, Verdana, sans-serif;user-select:none;-webkit-user-select:none;";
    const arrow = document.createElement("div");
    arrow.innerHTML = ARROW;
    const title = document.createElement("div");
    title.style.cssText = "font-size:20px;color:#ffcc00;";
    title.textContent = "Swipe up for full screen";
    const sub = document.createElement("div");
    sub.style.cssText = "max-width:360px;opacity:0.85;";
    sub.innerHTML = "That tucks Safari's bar away. For no bars at all, tap <b>Share</b> and "
      + "<b>Add to Home Screen</b>, then play from the icon.<br><span style=\"opacity:0.7\">Tap to skip</span>";
    box.append(arrow, title, sub);
    arrow.animate([{ transform: "translateY(10px)" }, { transform: "translateY(-10px)" }],
      { duration: 800, iterations: Infinity, direction: "alternate", easing: "ease-in-out" });
    let sx = 0;
    let sy = 0;
    box.addEventListener("pointerdown", (e) => { sx = e.clientX; sy = e.clientY; });
    box.addEventListener("pointerup", (e) => {
      if (Math.abs(e.clientX - sx) < 10 && Math.abs(e.clientY - sy) < 10) {
        this.swipeSkipped = true;
        this.paintSwipe();
      }
    });
    box.addEventListener("mousedown", (e) => e.stopPropagation());
    document.body.appendChild(box);
    this.swipe = box;
    const check = () => this.paintSwipe();
    window.addEventListener("resize", check);
    window.visualViewport?.addEventListener("resize", check);
    window.addEventListener("orientationchange", () => {
      for (const ms of [120, 400, 900]) window.setTimeout(check, ms);
    });
    window.addEventListener("scroll", () => {
      check();
      clearTimeout(this.swipeTimer);
      this.swipeTimer = window.setTimeout(() => {
        if (window.scrollY > 0 && barsShowing()) {
          this.swipeSkipped = true;
          this.paintSwipe();
        }
      }, 900);
    }, { passive: true });
    check();
  }

  private paintSwipe(): void {
    if (!this.swipe) return;
    const show = !this.swipeSkipped && !Input.playing && barsShowing();
    this.swipe.style.display = show ? "flex" : "none";
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
    this.paintSwipe();
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
