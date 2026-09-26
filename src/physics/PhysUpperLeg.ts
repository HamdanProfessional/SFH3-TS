import type { Costume } from "./RagdollArt";
import { PhysPart } from "./PhysPart";

export class PhysUpperLeg extends PhysPart {
  constructor(costume: Costume, flip: number, scale: number) {
    super("upperLeg", costume, flip, scale);
  }
}
