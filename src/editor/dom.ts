import { BTN_TONE, sfhCss } from "../ui/sfhCss";

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, css = "", text = "",
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (text) e.textContent = text;
  return e;
}

export const BTN = "padding:5px 7px 4px;font-size:10px;text-align:left;";
export const BTN_ON = BTN_TONE.on;
export const INPUT = "width:100%;box-sizing:border-box;padding:4px 6px;font-size:12px;";
export const BTN_GO = BTN + BTN_TONE.go + "width:100%;margin-top:6px;padding:9px 8px 8px;"
  + "font-size:13px;text-align:center;";
export const HEAD = "background:#000;color:#fff;border-bottom:2px solid #7e7c80;"
  + "font-family:Xoireqe,QTypeSquare-Bold,Verdana,sans-serif;text-transform:uppercase;"
  + "letter-spacing:1px;padding:3px 6px 2px;";
export const HINT = "font-size:10px;color:#9a979c;margin-top:4px;line-height:1.3;";

export function button(label: string, run: () => void, hint = ""): HTMLButtonElement {
  sfhCss();
  const b = el("button", BTN, label);
  b.className = "sfh-btn";
  b.type = "button";
  if (hint) b.title = hint;
  b.addEventListener("click", (e) => { e.preventDefault(); run(); });
  return b;
}

export function row(...kids: HTMLElement[]): HTMLDivElement {
  const r = el("div", "display:flex;gap:4px;flex-wrap:wrap;margin-top:4px;");
  r.append(...kids);
  return r;
}

export function select(sel: HTMLSelectElement, opts: [string, string][], value: string,
                       on: (v: string) => void): HTMLSelectElement {
  sel.innerHTML = "";
  for (const [v, label] of opts) {
    const o = el("option", "", label);
    o.value = v;
    sel.appendChild(o);
  }
  sel.value = value;
  sel.addEventListener("change", () => on(sel.value));
  return sel;
}
