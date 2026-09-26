export interface MapInfo {
  readonly id: string;
  readonly map: string;
  readonly bg1: string;
  readonly bg2: string;
  readonly sky: string;
  readonly particles: string;
  readonly name: string;
  readonly phys: string;
  readonly extra: string;
  readonly water: number;
}

export const MAP_ORDER = [
  "factory", "street", "canyon", "caves", "forest", "cavesb", "cqc",
  "frigate", "construction", "junkyard", "temple", "volcano", "gorge",
] as const;

const MAPS: Readonly<Record<string, MapInfo>> = {
  street: {
    id: "street", map: "street", bg1: "street1", bg2: "street2", sky: "street",
    particles: "street", name: "Street", phys: "", extra: "", water: 0,
  },
  factory: {
    id: "factory", map: "factory", bg1: "factory1", bg2: "factory2", sky: "factory",
    particles: "factory", name: "Factory", phys: "", extra: "", water: 0,
  },
  caves: {
    id: "caves", map: "caves", bg1: "caves1", bg2: "caves2", sky: "caves",
    particles: "caves", name: "Caves", phys: "", extra: "", water: 0,
  },
  canyon: {
    id: "canyon", map: "canyon", bg1: "canyon1", bg2: "canyon2", sky: "canyon",
    particles: "canyon", name: "Canyon", phys: "canyon", extra: "", water: 0,
  },
  forest: {
    id: "forest", map: "forest", bg1: "forest1", bg2: "forest2", sky: "forest",
    particles: "forest", name: "Forest", phys: "", extra: "", water: 0,
  },
  cavesb: {
    id: "cavesb", map: "cavesb", bg1: "cavern1", bg2: "cavern2", sky: "cavern",
    particles: "cavesb", name: "Ice Caverns", phys: "", extra: "", water: 0,
  },
  cqc: {
    id: "cqc", map: "cqc", bg1: "cqc1", bg2: "", sky: "",
    particles: "cqc", name: "Furnace", phys: "cqc", extra: "", water: 0,
  },
  frigate: {
    id: "frigate", map: "frigate", bg1: "", bg2: "", sky: "frigate",
    particles: "frigate", name: "Frigate", phys: "frigate", extra: "", water: 0,
  },
  construction: {
    id: "construction", map: "construction", bg1: "construction1",
    bg2: "construction2", sky: "construction", particles: "construction",
    name: "Construction", phys: "", extra: "", water: 0,
  },
  junkyard: {
    id: "junkyard", map: "junkyard", bg1: "junkyard1", bg2: "junkyard2",
    sky: "junkyard", particles: "junkyard", name: "junkyard",
    phys: "", extra: "", water: 0,
  },
  temple: {
    id: "temple", map: "temple", bg1: "temple1", bg2: "temple2", sky: "temple",
    particles: "temple", name: "Temple", phys: "", extra: "", water: 0,
  },
  volcano: {
    id: "volcano", map: "volcano", bg1: "volcano1", bg2: "volcano2", sky: "volcano",
    particles: "volcano", name: "Volcano", phys: "", extra: "", water: 0,
  },
  gorge: {
    id: "gorge", map: "gorge", bg1: "canyon1", bg2: "canyon2", sky: "canyon",
    particles: "gorge", name: "Gorge", phys: "canyon", extra: "", water: 0,
  },
};

export function getMap(id: string): MapInfo {
  return MAPS[id] ?? {
    id, map: "", bg1: "", bg2: "", sky: "", particles: "",
    name: id, phys: "", extra: "", water: 0,
  };
}
