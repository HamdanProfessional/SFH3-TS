import { FxArt } from "../assets/FxArt";
import { nodeArtUrls, loadNodeArt } from "../game/nodeArt";
import { killstreakArtUrls, loadKillstreakArt } from "../game/killstreaks/KillstreakArt";
import { ragdollArtUrls, loadRagdollArt } from "../physics/RagdollArt";
import { heroArtUrls, loadHero } from "../game/unitArt";
import { mapAssetUrls, loadMap, type LoadedMap } from "../game/maps";
import { loadHudArt } from "../ui/Hud";
import { run, type MatchAssets, type PreloadProgress, type Step } from "./Preload";

function matchSteps(mapId: string): Step[] {
  return [
    { label: "Arena", urls: mapAssetUrls(mapId) },
    { label: "Soldiers", urls: heroArtUrls() },
    { label: "Effects", urls: FxArt.urls() },
    { label: "Props", urls: nodeArtUrls() },
    { label: "Ragdolls", urls: ragdollArtUrls() },
    { label: "Killstreaks", urls: killstreakArtUrls() },
  ];
}

async function settle(map: Promise<LoadedMap>): Promise<MatchAssets> {
  const [m, hero] = await Promise.all([map, loadHero()]);
  await Promise.all([
    FxArt.load(),
    loadNodeArt(),
    loadRagdollArt(),
    loadKillstreakArt(),
    loadHudArt(),
  ]);
  return { map: m, hero };
}

export async function preloadCustomMatch(
  backdrop: string[], build: () => Promise<LoadedMap>, onProgress?: PreloadProgress,
): Promise<MatchAssets> {
  const steps = matchSteps("");
  steps[0] = { label: "Arena", urls: backdrop };
  await run(steps, onProgress);
  return settle(build());
}

export async function preloadMatch(
  mapId: string, onProgress?: PreloadProgress,
): Promise<MatchAssets> {
  await run(matchSteps(mapId), onProgress);
  return settle(loadMap(mapId));
}
