// Chinese UI: re-lay out the "static text fragment" pages (tips, credits).
// These pages come from Flash static text: one word per fragment, placed by coordinates to form paragraphs. Translating word by word would produce fragments.
// Here fragments are regrouped by line; paragraphs that match a whole dictionary entry are replaced with re-laid-out Chinese text, and anything that does not match stays in English.
// In the translation, "|" marks the gap an icon occupies in the original text: text before the mark is placed to the left of the gap, and text after it continues from the right of the gap.
import { CanvasTextMetrics, Container, Text, TextStyle } from "pixi.js";
import { isZh, trLoose } from "./index";
import { rawText } from "./pixi";

type Run = readonly [number, number, number, string, string | number, number, string];

const RIGHT = 770;
const GAP = 12;

function styleOf(r: Run): TextStyle {
  return new TextStyle({ fontFamily: [r[3], "Verdana", "sans-serif"], fontSize: r[2], fill: r[4] as string });
}

function width(s: string, style: TextStyle): number {
  return CanvasTextMetrics.measureText(s, style).width;
}

/** Break lines between characters (English words and numbers stay whole); the first and following lines have different available widths. */
function breakLines(s: string, style: TextStyle, first: number, rest: number): string[] {
  const tokens = s.match(/[A-Za-z0-9%$+\-.,']+|\s|./gu) ?? [];
  const lines: string[] = [];
  let line = "";
  let max = first;
  for (const t of tokens) {
    const next = line + t;
    if (line && width(next, style) > max && !/^[，。！？：；、）」』”’…%]$/.test(t)) {
      lines.push(line.trimEnd());
      line = t.trimStart();
      max = rest;
    } else line = next;
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines;
}

/** Returns true if the runs were laid out in Chinese; on false the caller draws the English fragments as they are. */
export function drawRunsZh(
  view: Container, runs: readonly Run[], dy: number, ascent: (font: string, size: number) => number,
): boolean {
  if (!isZh() || !runs.length) return false;

  // Group into lines by baseline, sorted by x within each line
  const byY = new Map<number, Run[]>();
  for (const r of runs) {
    const y = Math.round(r[1]);
    const key = [...byY.keys()].find((k) => Math.abs(k - y) <= 2) ?? y;
    (byY.get(key) ?? byY.set(key, []).get(key)!).push(r);
  }
  const lines = [...byY.entries()].sort((a, b) => a[0] - b[0]).map(([, l]) => l.sort((a, b) => a[0] - b[0]));
  const lineText = (l: Run[]) => l.map((r) => r[6]).join(" ");

  const place = (t: Text, x: number, y: number, r: Run) => {
    t.position.set(x, y - dy - ascent(r[3], r[2]));
    t.alpha = r[5];
    view.addChild(t);
  };
  const drawEnglish = (l: Run[]) => {
    for (const r of l) {
      const t = rawText(new Text({ roundPixels: true, style: styleOf(r) }));
      t.text = r[6];
      place(t, r[0], r[1], r);
    }
  };

  for (let i = 0; i < lines.length;) {
    // Try the longest candidate paragraph first, then shorter ones
    let matched = 0;
    let zh: string | null = null;
    for (let j = Math.min(lines.length, i + 6); j > i; j--) {
      zh = trLoose(lines.slice(i, j).map(lineText).join(" "));
      if (zh) { matched = j - i; break; }
    }
    if (!zh) {
      drawEnglish(lines[i]);
      i++;
      continue;
    }

    const para = lines.slice(i, i + matched);
    const first = para[0][0];
    const style = styleOf(first);
    const x0 = first[0];
    const y0 = first[1];
    const lead = para.length > 1 ? (para[para.length - 1][0][1] - y0) / (para.length - 1) : first[2] * 1.4;

    const single = matched === 1 && !zh.includes("|");
    const lastRun = para[0][para[0].length - 1];
    const enRight = lastRun[0] + width(lastRun[6], styleOf(lastRun));
    if (single && /Xoireqe|BlackMajuscles/.test(first[3])) {
      // Title: center within the original width
      const t = new Text({ roundPixels: true, text: zh, style });
      t.anchor.set(0.5, 0);
      place(rawText(t), (x0 + enRight) / 2, y0, first);
    } else if (single && para[0].length === 1) {
      place(rawText(new Text({ roundPixels: true, text: zh, style })), x0, y0, first);
    } else {
      // Icon gap: the first large gap in the original first line
      let gapStart = 0;
      let gapEnd = 0;
      let after: Run | null = null;
      const l0 = para[0];
      for (let k = 0; k + 1 < l0.length; k++) {
        const end = l0[k][0] + width(l0[k][6], styleOf(l0[k]));
        if (l0[k + 1][0] - end - width(" ", styleOf(l0[k])) > GAP) {
          gapStart = end;
          gapEnd = l0[k + 1][0];
          after = l0[k + 1];
          break;
        }
      }
      const [head, tail] = zh.includes("|") && after ? zh.split("|", 2) : ["", zh.replace("|", "")];
      let rows: { s: string; x: number; st: TextStyle; r: Run }[] = [];
      if (head) {
        // Text before the gap is right-aligned against the gap
        rows.push({ s: head, x: Math.max(x0, gapStart - width(head, style)), st: style, r: first });
        const st2 = styleOf(after!);
        breakLines(tail, st2, RIGHT - gapEnd, RIGHT - x0).forEach((s, k) =>
          rows.push({ s, x: k === 0 ? gapEnd : x0, st: st2, r: after! }));
      } else {
        rows = breakLines(tail, style, RIGHT - x0, RIGHT - x0).map((s) => ({ s, x: x0, st: style, r: first }));
      }
      // The text before the gap and the first line after it share the first row
      const sameRow = head ? 2 : 1;
      let row = 0;
      for (let k = 0; k < rows.length; k++) {
        if (k >= sameRow) row++;
        const { s, x, st, r } = rows[k];
        place(rawText(new Text({ roundPixels: true, text: s, style: st })), x, y0 + row * lead, r);
      }
    }
    i += matched;
  }
  return true;
}
