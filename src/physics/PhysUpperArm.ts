import type { Costume } from "./RagdollArt";
import { PhysPart } from "./PhysPart";

export class PhysUpperArm extends PhysPart {
  constructor(costume: Costume, flip: number, scale: number) {
    super("upperArm", costume, flip, scale);
  }
}
