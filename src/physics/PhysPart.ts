import { Container } from "pixi.js";
import { buildPartView, type Costume, type PartKind } from "./RagdollArt";

export class PhysPart extends Container {
  constructor(kind: PartKind, costume: Costume, flip: number, scale: number) {
    super();
    buildPartView(this, kind, costume);
    this.scale.set(scale * flip, scale);
  }
}
