import * as Config from "../../core/Config";
import { FxArt } from "../../assets/FxArt";
import { BitScreen } from "./BitScreen";
import { Effect } from "./Effect";
import { Particle, type ParticleExtra } from "./Particle";
import type { FxLayer } from "../../ui/FxLayer";
import type { WallMask } from "../types";

function uint(n: number): number {
  return Math.trunc(n);
}

export interface FxUnit {
  readonly x: number;
  readonly y: number;
  readonly dead: unknown;
}

export interface FxWorld {
  readonly destroyed: boolean;
  readonly arena: {
    readonly x: number;
    readonly y: number;
    readonly wall: WallMask;
  };
  readonly player: FxUnit | null;
  readonly units: readonly FxUnit[];
}

export class Fx {
  readonly effects: (Effect | Particle)[] = [];
  readonly bitScreen: BitScreen;
  private readonly warned = new Set<string>();

  constructor(
    private readonly layer: FxLayer,
    private readonly world: FxWorld,
  ) {
    this.bitScreen = new BitScreen(layer, world);
  }

  get destroyed(): boolean { return this.world.destroyed; }
  get arena(): FxWorld["arena"] { return this.world.arena; }
  get player(): FxUnit | null { return this.world.player; }
  get units(): readonly FxUnit[] { return this.world.units; }

  clear(): void {
    this.layer.clear();
  }

  enterFrame(): void {
    for (const e of this.effects) e.enterFrame();
    let n = 0;
    for (const e of this.effects) if (!e.remove) this.effects[n++] = e;
    this.effects.length = n;
  }

  createEffect(x: number, y: number, name: string, sub = "idle", frame = 1): void {
    if (!this.onScreen(x, y, 80)) return;
    if (!this.known(name, sub)) return;
    this.effects.push(new Effect(this, x, y, name, sub, frame));
  }

  createEffectAtFrame(
    x: number, y: number, name: string, sub = "idle", frame = 1,
  ): void {
    if (!this.onScreen(x, y, 80)) return;
    if (!this.known(name, sub)) return;
    this.effects.push(new Effect(this, x, y, name, sub, uint(frame)));
  }

  createParticle(
    x: number,
    y: number,
    behave: string,
    hitFrame = 0,
    extra: ParticleExtra | null = null,
    name = "",
    sub = "idle",
    frame = 0,
    force = false,
  ): void {
    if (!force && !this.onScreen(x, y, 300)) return;
    if (!this.known(name, sub)) return;
    this.effects.push(
      new Particle(this, x, y, behave, uint(hitFrame), extra, name, sub, uint(frame)),
    );
  }

  onScreen(x: number, y: number, pad = 0): boolean {
    const sx = x + this.world.arena.x;
    const sy = y + this.world.arena.y;
    return sx > -pad && sx < Config.GAME_WIDTH + pad
      && sy > -pad && sy < Config.GAME_HEIGHT + pad;
  }

  private known(name: string, sub: string): boolean {
    const hit = FxArt.resolve(name);
    if (!hit || FxArt.cellIndex(hit.base, hit.rot, sub, 1) < 0) {
      const what = hit ? `${hit.base}/${sub}` : name;
      if (!this.warned.has(what)) {
        this.warned.add(what);
        console.warn(`Fx: no atlas entry for ${what}`);
      }
      return false;
    }
    return true;
  }
}
