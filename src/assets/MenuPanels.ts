import { Text, TextStyle, type TextStyleOptions } from "pixi.js";
import panels from "./menuPanels.json";
import {
  applyRec, loadParts, manifestFiles, partTexture, PARTS_BASE,
  type PartRec,
} from "./menuParts";

export interface FieldSpec {
  cid: number;
  x: number; y: number; w: number; h: number;
  size?: number;
  font?: string;
  color?: number;
  alpha?: number;
  align?: "left" | "right" | "center" | "justify";
  leading?: number;
  wordWrap?: boolean;
}

export interface FieldRec {
  m: number[];
  cid: number;
  spec: FieldSpec;
}

interface PanelRec extends PartRec {
  place: { x: number; y: number };
}

interface PanelData {
  scale: number;
  box: { left: PanelRec; right: PanelRec; status: PanelRec };
  fields: Record<string, FieldRec>;
  items: Record<string, number[]>;
  cols: Record<string, PartRec & { m: number[] }>;
  sel: PartRec;
  button: {
    cid: number;
    states: Partial<Record<"up" | "over" | "down", string>>;
    offX: number; offY: number; w: number; h: number;
    m: number[];
  };
  statusField: { m: number[]; cid: number; spec: FieldSpec | null };
}

const D = panels as unknown as PanelData;

export function panelArtUrls(): string[] {
  return [...manifestFiles(D)].map((f) => PARTS_BASE + f);
}

export function loadPanelArt(): Promise<void> {
  return loadParts(manifestFiles(D));
}

export const MenuPanels = {
  data: D,
  scale: D.scale,

  box(key: "left" | "right" | "status"): PanelRec {
    return D.box[key];
  },

  field(name: string): FieldRec | null {
    return D.fields[name] ?? null;
  },

  item(name: string): number[] | null {
    return D.items[name] ?? null;
  },

  col(i: number): (PartRec & { m: number[] }) | null {
    return D.cols[String(i)] ?? null;
  },

  get sel(): PartRec {
    return D.sel;
  },

  get button(): PanelData["button"] {
    return D.button;
  },

  get statusField(): { m: number[]; cid: number; spec: FieldSpec | null } {
    return D.statusField;
  },

  texture: partTexture,
  applyRec,
};

export function panelFieldText(
  rec: FieldRec, value: string, override: Partial<TextStyleOptions> = {},
): Text {
  const spec = rec.spec ?? ({} as FieldSpec);
  const align = spec.align ?? "left";
  const t = new Text({
    text: value,
    style: new TextStyle({
      fontFamily: [spec.font ?? "QTypeSquare-Book", "Verdana", "sans-serif"],
      fontSize: spec.size ?? 12,
      fill: spec.color ?? 0xffffff,
      align: align === "justify" ? "left" : align,
      wordWrap: spec.wordWrap ?? false,
      wordWrapWidth: spec.w ?? 200,
      lineHeight: spec.size ? spec.size + (spec.leading ?? 0) : undefined,
      ...override,
    }),
  });
  t.alpha = spec.alpha ?? 1;
  const bx = rec.m[4] + (spec.x ?? 0);
  const by = rec.m[5] + (spec.y ?? 0);
  const bw = spec.w ?? 0;
  if (align === "center") {
    t.anchor.set(0.5, 0);
    t.position.set(bx + bw / 2, by);
  } else if (align === "right") {
    t.anchor.set(1, 0);
    t.position.set(bx + bw, by);
  } else {
    t.position.set(bx, by);
  }
  t.scale.set(rec.m[0] || 1, rec.m[3] || 1);
  return t;
}
