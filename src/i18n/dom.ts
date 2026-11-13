// Chinese UI: translate UI text in the DOM (map editor, forms, tooltip layers).
// Text nodes and the title/placeholder/aria-label attributes go through tr() when inserted or changed;
// text players type into inputs is left alone. Elements with data-raw and their subtrees are not translated either.
import { isZh, tr } from "./index";

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "CODE", "PRE"]);
const ATTRS = ["title", "placeholder", "aria-label"];
const done = new WeakMap<Node, string>();

function skipped(el: Element | null): boolean {
  for (let e = el; e; e = e.parentElement) {
    if (SKIP_TAGS.has(e.tagName) || (e as HTMLElement).isContentEditable || e.hasAttribute("data-raw")) return true;
  }
  return false;
}

function textNode(n: Text): void {
  const v = n.nodeValue ?? "";
  if (done.get(n) === v || !/[A-Za-z]/.test(v) || skipped(n.parentElement)) return;
  const out = tr(v);
  done.set(n, out);
  if (out !== v) n.nodeValue = out;
}

function attrs(el: Element): void {
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (v && /[A-Za-z]/.test(v)) {
      const out = tr(v);
      if (out !== v) el.setAttribute(a, out);
    }
  }
  if (el instanceof HTMLInputElement && (el.type === "button" || el.type === "submit") && el.value) {
    const out = tr(el.value);
    if (out !== el.value) el.value = out;
  }
}

function walk(root: Node): void {
  if (root.nodeType === Node.TEXT_NODE) return textNode(root as Text);
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const el = root as Element;
  if (skipped(el)) return;
  attrs(el);
  const it = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let n = it.nextNode(); n; n = it.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) textNode(n as Text);
    else attrs(n as Element);
  }
}

export function installDomTranslation(): void {
  if (!isZh() || typeof MutationObserver === "undefined") return;
  walk(document.body);
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "characterData") textNode(r.target as Text);
      else if (r.type === "attributes") attrs(r.target as Element);
      else r.addedNodes.forEach(walk);
    }
  }).observe(document.body, {
    subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: [...ATTRS, "value"],
  });
}
