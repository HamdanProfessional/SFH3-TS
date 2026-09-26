import { FxArt } from "../../assets/FxArt";
import type { BitScreenLike } from "../types";
import type { FxLayer } from "../../ui/FxLayer";

export interface BitScreenWorld {
  readonly destroyed: boolean;
}

export class BitScreen implements BitScreenLike {
  private readonly warned = new Set<string>();

  constructor(
    private readonly layer: FxLayer,
    private readonly world: BitScreenWorld,
  ) {}

  paint(
    x: number,
    y: number,
    _over: boolean,
    name: string,
    sub = "idle",
    frame = 1,
  ): void {
    if (this.world.destroyed) return;
    const hit = FxArt.resolve(name);
    if (!hit) {
      this.warn(`${name} (no BH entry)`);
      return;
    }
    const index = FxArt.cellIndex(hit.base, hit.rot, sub, frame);
    if (index < 0) {
      this.warn(`${name}/${sub}#${frame}`);
      return;
    }
    this.layer.paint(hit.base, index, x, y);
  }

  private warn(what: string): void {
    if (this.warned.has(what)) return;
    this.warned.add(what);
    console.warn(`BitScreen: no atlas entry for ${what}`);
  }
}
