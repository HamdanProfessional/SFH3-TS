import type { Costume } from "./RagdollArt";
import { PhysPart } from "./PhysPart";

export class PhysLowerArm extends PhysPart {
  constructor(costume: Costume, flip: number, scale: number) {
    super("lowerArm", costume, flip, scale);
  }
}
