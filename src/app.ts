import "./core/webp";
import { Engine } from "./core/Engine";
import { MenuScreen } from "./screens/MenuScreen";
import { LoaderScreen } from "./screens/LoaderScreen";
import { loadLazyJson } from "./assets/jsonStore";
import { preloadBoot, preloadMatch, type MatchAssets } from "./core/Preload";
import { loadFonts } from "./ui/art";
import { hasMap } from "./game/maps";
import { SD } from "./state/SD";
import { Sound } from "./audio/Sounds";
import { SH } from "./audio/SH";
import { installAchievements, awardAchievement } from "./data/StatsAchievements";
import { partsEpoch } from "./assets/menuParts";
import { itemArtEpoch, selItemCat, setItemCat } from "./screens/menu/InventoryPage";
import { GunInfo } from "./game/GunInfo";
import * as Guns from "./data/StatsGuns";
import * as Missions from "./data/StatsMissions";
import { newHero } from "./game/newHero";
import { MatchSettings } from "./game/MatchSettings";

async function main() {
  const mount = document.getElementById("game");
  if (!mount) throw new Error("#game mount element not found");

  const engine = await Engine.create(mount);
  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).sfh3Dev = { SD, SH, Sound };
  await loadFonts();
  engine.setScreen(LoaderScreen, {
    run: (p) => preloadBoot(p),
    done: () => void boot(engine),
    play: !navigator.webdriver,
  });
}

async function boot(engine: Engine): Promise<void> {
  const achToast = installAchievements(engine.overlay, engine.app.ticker);
  if (import.meta.env.DEV) {
    Object.assign((window as unknown as Record<string, unknown>).sfh3Dev as object, {
      awardAchievement, achToast,
      artEpochs: () => [partsEpoch(), itemArtEpoch()],
      selItemCat: () => selItemCat,
      setItemCat,
      makeGun: (type: number, level = 1) => {
        const id = Guns.getRandomGunId(SD.bpBuilt, type);
        return id ? new GunInfo(id, level, 0) : null;
      },
      newHero,
      mission: (stage: number) => Missions.getMission(stage),
      MatchSettings,
    });
  }
  void Sound.loadAll();
  const m = /^#map=([a-z0-9]+)/.exec(location.hash);
  if (m && hasMap(m[1])) {
    const id = m[1];
    engine.setScreen(LoaderScreen, {
      title: id,
      run: (p) => preloadMatch(id, p),
      done: (r: unknown) => {
        const { map, hero } = r as MatchAssets;
        void import("./screens/GameScreen").then((mod) => {
          engine.setScreen(mod.GameScreen, { map, hero });
        });
      },
    });
    return;
  }
  const cm = /^#cmap=([A-Za-z0-9_-]{6,16})/.exec(location.hash);
  if (cm) {
    const { EditorScreen } = await import("./screens/EditorScreen");
    engine.setScreen(EditorScreen, { shared: cm[1] });
    return;
  }
  if (introPending()) {
    markIntroSeen();
    await loadLazyJson();
    const { CutsceneScreen } = await import("./screens/CutsceneScreen");
    engine.setScreen(CutsceneScreen, { start: 1, end: 10 });
    return;
  }
  engine.setScreen(MenuScreen);
  prefetchLate();
}

function prefetchLate(): void {
  const go = (): void => {
    void loadLazyJson()
      .then(() => import("./core/PreloadMatch"))
      .catch(() => {});
  };
  if ("requestIdleCallback" in window) window.requestIdleCallback(go, { timeout: 3000 });
  else setTimeout(go, 1000);
}

const SAVE_KEY = "sfh3.save";
const INTRO_KEY = "sfh3.intro";

function introPending(): boolean {
  if (location.hash === "#nointro") return false;
  if (location.hash === "#intro") return true;
  try {
    return !localStorage.getItem(SAVE_KEY) && !localStorage.getItem(INTRO_KEY);
  } catch {
    return false;
  }
}

function markIntroSeen(): void {
  try {
    localStorage.setItem(INTRO_KEY, "1");
  } catch {
  }
}

main().catch((err) => {
  console.error("Failed to start SFH3:", err);
});
