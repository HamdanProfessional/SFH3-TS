import { Container, Sprite, Texture } from "pixi.js";
import { FxArt } from "../assets/FxArt";

export class FxLayer {
  readonly root = new Container();
  private readonly pool: Sprite[] = [];
  private used = 0;

  clear(): void {
    for (const sp of this.pool) sp.visible = false;
    this.used = 0;
  }

  paint(name: string, cellIndex: number, x: number, y: number): void {
    const def = FxArt.def(name);
    const cell = def?.cells[cellIndex];
    if (!def || !cell || !cell.w || !cell.h) return;

    const sp = this.next();
    sp.texture = FxArt.cell(name, cellIndex) ?? Texture.EMPTY;
    sp.position.set(x + cell.lx * 2, y + cell.ly * 2);
    const scale = FxArt.stageScale(name);
    sp.scale.set(scale);
    sp.alpha = def.alpha ?? 1;
    sp.tint = def.tint ?? 0xffffff;
  }

  private next(): Sprite {
    let sp = this.pool[this.used];
    if (!sp) {
      sp = new Sprite(Texture.EMPTY);
      this.root.addChild(sp);
      this.pool.push(sp);
    }
    sp.visible = true;
    this.used++;
    return sp;
  }
}
