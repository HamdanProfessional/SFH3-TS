import type { Costume } from "./RagdollArt";
import { PhysPart } from "./PhysPart";

export class PhysLowerLeg extends PhysPart {
  constructor(costume: Costume, flip: number, scale: number) {
    super("lowerLeg", costume, flip, scale);
  }
}
