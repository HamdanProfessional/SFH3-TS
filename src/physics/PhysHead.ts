import type { Costume } from "./RagdollArt";
import { PhysPart } from "./PhysPart";

export class PhysHead extends PhysPart {
  constructor(costume: Costume, flip: number, scale: number) {
    super("head", costume, flip, scale);
  }
}
