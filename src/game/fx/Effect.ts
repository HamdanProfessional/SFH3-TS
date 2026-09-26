import { UT } from "../../core/UT";
import { FxArt } from "../../assets/FxArt";
import type { Fx } from "./Fx";

export class Effect {
  remove = false;
  private readonly name: string;
  private readonly frames: number;
  private frame: number;

  constructor(
    private readonly fx: Fx,
    private readonly x: number,
    private readonly y: number,
    name: string,
    private readonly sub: string,
    frame: number,
  ) {
    const rotAmt = FxArt.def(name)?.rotAmt ?? 1;
    this.name = name + UT.irand(0, rotAmt - 1);
    this.frames = FxArt.subFrames(name, sub);
    this.frame = frame;
  }

  enterFrame(): void {
    if (this.remove) return;
    this.fx.bitScreen.paint(
      this.x + this.fx.arena.x, this.y + this.fx.arena.y,
      true, this.name, this.sub, this.frame,
    );
    ++this.frame;
    if (this.frame > this.frames) this.remove = true;
  }
}
