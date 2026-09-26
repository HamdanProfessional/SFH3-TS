import manifest, { lazy } from "virtual:json-manifest";
import { preloadJson, setLazyJson } from "./assets/jsonStore";

function reloadForNewBuild(): void {
  const KEY = "sfh3.chunkReload";
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {}
  location.reload();
}
window.addEventListener("vite:preloadError", (e) => {
  e.preventDefault();
  reloadForNewBuild();
});
window.addEventListener("unhandledrejection", (e) => {
  const msg = String((e.reason as Error | undefined)?.message ?? e.reason ?? "");
  if (/dynamically imported module|Importing a module script failed/.test(msg)) {
    reloadForNewBuild();
  }
});


async function boot(): Promise<void> {
  setLazyJson(lazy);
  const total = Object.keys(manifest).length;
  let bar: HTMLDivElement | null = null;
  if (total) {
    const track = document.createElement("div");
    track.style.cssText = "position:fixed;left:50%;top:50%;width:240px;height:4px;"
      + "margin:-2px 0 0 -120px;background:#222;";
    bar = document.createElement("div");
    bar.style.cssText = "height:100%;width:0;background:#e8b21e;transition:width .1s;";
    track.appendChild(bar);
    document.body.appendChild(track);
  }
  await preloadJson(manifest, (done, n) => {
    if (bar) bar.style.width = `${(done / n) * 100}%`;
  });
  bar?.parentElement?.remove();
  await import("./app");
}

boot().catch((err) => {
  console.error("Failed to start SFH3:", err);
});
