// Chinese UI handling for Pixi text: translate on display, add Chinese fonts, allow line breaks in Chinese text.
// Must be installed before any Text is created (called right after initI18n in app.ts).
import { AbstractText, CanvasTextMetrics, TextStyle } from "pixi.js";
import { ASSET_V } from "../core/Config";
import { isZh, tr } from "./index";

type Src = { __src?: string; __raw?: boolean };

const TITLE = "SFH3 ZH Title";
const SANS = "SFH3 ZH Sans";
const SANS_BOLD = "SFH3 ZH Sans Bold";
const ZH_FAMILIES = [TITLE, SANS, SANS_BOLD];

/** Chinese font for each original font: title fonts get the blocky style, bold gets bold sans, the rest get regular sans. */
function zhFamilyFor(first: string): string {
  if (/BlackMajuscles|Xoireqe/i.test(first)) return TITLE;
  if (/QTypeSquare-(Bold|Medium)/i.test(first)) return SANS_BOLD;
  return SANS;
}

function withZhFont(value: string | string[]): string | string[] {
  const list = Array.isArray(value) ? [...value] : String(value).split(",").map((s) => s.trim().replace(/^["']|["']$/g, ""));
  if (!list.length || list.some((f) => ZH_FAMILIES.includes(f))) return value;
  list.splice(1, 0, zhFamilyFor(list[0]));
  return list;
}

// Chinese punctuation must not start a line; opening brackets and quotes must not end a line
const NO_START = new Set("，。！？：；、）》」』”’…—～%".split(""));
const NO_END = new Set("（《「『“‘".split(""));
const CJK = /[　-〿㐀-鿿＀-￯]/;

let installed = false;

export function installTextHooks(): void {
  if (installed || !isZh()) return;
  installed = true;

  const proto = AbstractText.prototype as unknown as object;
  const textDesc = Object.getOwnPropertyDescriptor(proto, "text")!;
  Object.defineProperty(proto, "text", {
    configurable: true,
    enumerable: textDesc.enumerable,
    get: textDesc.get,
    set(this: Src, value: unknown) {
      const s = value == null ? "" : String(value);
      this.__src = s;
      textDesc.set!.call(this, this.__raw ? s : tr(s));
    },
  });

  const styleProto = TextStyle.prototype as unknown as object;
  const famDesc = Object.getOwnPropertyDescriptor(styleProto, "fontFamily")!;
  Object.defineProperty(styleProto, "fontFamily", {
    configurable: true,
    enumerable: famDesc.enumerable,
    get: famDesc.get,
    set(value: string | string[]) {
      famDesc.set!.call(this, withZhFont(value));
    },
  });

  // Pixi only breaks lines at spaces; long strings with Chinese may break between any characters
  const canBreakWords = CanvasTextMetrics.canBreakWords;
  CanvasTextMetrics.canBreakWords = (token: string, breakWords: boolean) =>
    canBreakWords(token, breakWords) || CJK.test(token);
  CanvasTextMetrics.canBreakChars = (char: string, next: string) =>
    !(next && NO_START.has(next)) && !NO_END.has(char) && !(/[A-Za-z0-9]/.test(char) && /[A-Za-z0-9]/.test(next ?? ""));
}

/** Text comes from players (names, chat, map names); do not translate. */
export function rawText<T extends AbstractText>(t: T): T {
  const s = t as unknown as Src;
  s.__raw = true;
  if (s.__src !== undefined) t.text = s.__src;
  return t;
}

/** Use this, not t.text, when code needs to compare against the English source. */
export function srcText(t: AbstractText): string {
  return (t as unknown as Src).__src ?? t.text;
}

const FONT_FILES: [string, string][] = [
  [TITLE, "zh-title.woff2"],
  [SANS, "zh-sans.woff2"],
  [SANS_BOLD, "zh-sans-bold.woff2"],
];

/** Load the Chinese font subsets. If a font is missing, text falls back to a system Chinese font; the game is not affected. */
export async function loadZhFonts(): Promise<void> {
  if (!isZh() || typeof FontFace === "undefined") return;
  await Promise.all(FONT_FILES.map(async ([family, file]) => {
    try {
      const face = new FontFace(family, `url(fonts/zh/${file}?v=${ASSET_V})`, { display: "block" });
      document.fonts.add(face);
      await face.load();
    } catch {
    }
  }));
}
