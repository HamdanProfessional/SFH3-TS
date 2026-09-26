import { Assets } from "pixi.js";
import { menuArtUrls, loadArt } from "../ui/art";
import { hudArtUrls } from "../ui/hudArt";
import { rigArtUrls, loadRigArt } from "../assets/MenuRig";
import { pickerArtUrls, loadPickerArt } from "../assets/MenuPicker";
import { panelArtUrls, loadPanelArt } from "../assets/MenuPanels";
import { itemArtUrls, loadItemArt } from "../screens/menu/InventoryPage";
import { pageArtUrls, loadPageArt } from "../screens/menu/pageArt";
import { hasMap, type LoadedMap } from "../game/maps";
import { loadLazyJson } from "../assets/jsonStore";
import type { HeroArt } from "../game/unitArt";

export type PreloadProgress = (done: number, total: number, label: string) => void;

const POOL = 6;

async function warm(urls: readonly string[], label: string,
                    done: { n: number }, total: number,
                    onProgress?: PreloadProgress): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= urls.length) return;
      try {
        await Assets.load(urls[i]);
      } catch {
      }
      onProgress?.(++done.n, total, label);
    }
  };
  await Promise.all(Array.from({ length: Math.min(POOL, urls.length) }, worker));
}

export interface Step {
  label: string;
  urls: string[];
}

function bootSteps(): Step[] {
  return [
    { label: "Menu", urls: [...new Set([...menuArtUrls(), ...pageArtUrls()])] },
    { label: "Interface", urls: hudArtUrls() },
    { label: "Items", urls: itemArtUrls() },
    {
      label: "Characters",
      urls: [...new Set([...rigArtUrls(), ...pickerArtUrls(),
        ...panelArtUrls()])],
    },
  ];
}

export async function preloadCustomMatch(
  backdrop: string[], build: () => Promise<LoadedMap>, onProgress?: PreloadProgress,
): Promise<MatchAssets> {
  return (await matchHalf(onProgress)).preloadCustomMatch(backdrop, build, onProgress);
}

export async function run(steps: Step[], onProgress?: PreloadProgress): Promise<void> {
  const total = steps.reduce((n, s) => n + s.urls.length, 0);
  const done = { n: 0 };
  onProgress?.(0, total, steps[0]?.label ?? "");
  for (const s of steps) await warm(s.urls, s.label, done, total, onProgress);
}

export function bootAssetCount(): number {
  return bootSteps().reduce((n, s) => n + s.urls.length, 0);
}

export async function preloadBoot(onProgress?: PreloadProgress): Promise<void> {
  await run(bootSteps(), onProgress);
  await Promise.all([
    loadArt(), loadPageArt(),
    loadItemArt(), loadRigArt(), loadPickerArt(), loadPanelArt(),
  ]);
}

export interface MatchAssets {
  map: LoadedMap;
  hero: HeroArt;
}

async function matchHalf(onProgress?: PreloadProgress): Promise<typeof import("./PreloadMatch")> {
  await loadLazyJson((done, total) => onProgress?.(done, total, "Data"));
  return import("./PreloadMatch");
}

export async function preloadMatch(
  mapId: string, onProgress?: PreloadProgress,
): Promise<MatchAssets> {
  if (!hasMap(mapId)) throw new Error(`no baked map "${mapId}"`);
  return (await matchHalf(onProgress)).preloadMatch(mapId, onProgress);
}
