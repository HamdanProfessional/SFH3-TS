import { getMap, type MapInfo } from "../data/StatsMaps";
import type { CustomMap } from "../editor/format";

export const CUSTOM_MODES = ["tdm", "dm", "ctf", "dom"] as const;

export function customMapInfo(m: CustomMap): MapInfo {
  const base = getMap(m.backdrop);
  return {
    id: "custom", map: "custom", bg1: base.bg1, bg2: base.bg2, sky: base.sky,
    particles: base.particles, name: m.name, phys: "", extra: "", water: 0,
  };
}
