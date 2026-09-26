import type { Costume } from "./RagdollArt";
import { PhysPart } from "./PhysPart";

export class PhysHand extends PhysPart {
  constructor(costume: Costume, flip: number, scale: number) {
    super("hand", costume, flip, scale);
  }
}
