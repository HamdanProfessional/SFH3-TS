import picker from "./menuPicker.json";
import {
  applyRec, loadParts, manifestFiles, partTexture, PARTS_BASE,
  type PartRec,
} from "./menuParts";

export interface PickerRec extends PartRec {
  m?: number[];
}

export interface PickerButton {
  cid: number;
  states: Partial<Record<"up" | "over" | "down", string>>;
  offX: number;
  offY: number;
  w: number;
  h: number;
  m: number[];
}

interface PickerData {
  scale: number;
  card: Record<string, PickerRec>;
  tray: Record<string, PickerRec>;
  class: Record<string, PickerRec & { frame: number }>;
  selected: PickerRec & { m: number[] };
  newskill: PickerRec & { m: number[] };
  button: PickerButton;
  head: number[];
  icon: number[];
  deck: {
    firstX: number; firstY: number; step: number; count: number;
    place: Record<string, { x: number; y: number }>;
    openY: number;
    homeY: Record<string, number>;
  };
}

const P = picker as unknown as PickerData;

export function pickerArtUrls(): string[] {
  return [...manifestFiles(P)].map((f) => PARTS_BASE + f);
}

export function loadPickerArt(): Promise<void> {
  return loadParts(manifestFiles(P));
}

export const MenuPicker = {
  data: P,

  card(frame: number): PickerRec | null {
    return P.card[String(frame)] ?? null;
  },

  tray(frame: number): PickerRec | null {
    return P.tray[String(frame)] ?? null;
  },

  classIcon(id: string): PickerRec | null {
    return P.class[id] ?? null;
  },

  get selected(): PickerRec & { m: number[] } {
    return P.selected;
  },

  get newskill(): PickerRec & { m: number[] } {
    return P.newskill;
  },

  get button(): PickerButton {
    return P.button;
  },

  get headMatrix(): number[] {
    return P.head;
  },

  get iconMatrix(): number[] {
    return P.icon;
  },

  get deck(): PickerData["deck"] {
    return P.deck;
  },

  texture: partTexture,
  applyRec,
};
