import { Focus } from "../core/Focus";
import { BTN_TONE, sfhCss } from "./sfhCss";

export interface FormField {
  key: string;
  label: string;
  type?: "text" | "password";
  auto?: string;
  value?: string;
}

export interface FormOptions {
  title: string;
  note?: string;
  fields: FormField[];
  submit: string;
  onSubmit(values: Record<string, string>): Promise<string | null>;
  alt?: { label: string; run(): void };
  onCancel?(): void;
}

let open: HTMLElement | null = null;

export function formOpen(): boolean {
  return !!open;
}

export function closeForm(): void {
  if (open) Focus.popLayer(open);
  open?.remove();
  open = null;
}

const STOP = ["keydown", "keyup", "keypress", "mousedown", "mouseup", "click",
  "wheel", "contextmenu"] as const;

export function openForm(o: FormOptions): void {
  closeForm();
  if (typeof document === "undefined") return;

  sfhCss();
  const shade = document.createElement("div");
  shade.className = "sfh-ui";
  shade.style.cssText = "position:fixed;inset:0;z-index:50;display:flex;"
    + "align-items:center;justify-content:center;background:rgba(0,0,0,.55);";
  for (const t of STOP) shade.addEventListener(t, (e) => e.stopPropagation());

  const form = document.createElement("form");
  form.style.cssText = "background:rgba(0,0,0,.88);width:320px;";
  form.noValidate = true;

  const h = document.createElement("div");
  h.textContent = o.title;
  h.className = "sfh-band";
  h.style.cssText = "font-size:18px;padding:6px 14px 4px;";
  form.appendChild(h);
  const inner = document.createElement("div");
  inner.style.cssText = "padding:12px 16px 16px;";
  form.appendChild(inner);
  if (o.note) {
    const n = document.createElement("div");
    n.textContent = o.note;
    n.style.cssText = "font-size:12px;color:#b4b0b6;margin-bottom:10px;line-height:1.35;";
    inner.appendChild(n);
  }

  const inputs: Record<string, HTMLInputElement> = {};
  for (const f of o.fields) {
    const label = document.createElement("label");
    label.style.cssText = "display:block;font-size:12px;color:#b4b0b6;margin:8px 0 3px;"
      + "letter-spacing:1px;";
    label.textContent = f.label;
    const input = document.createElement("input");
    input.type = f.type ?? "text";
    input.name = f.key;
    input.value = f.value ?? "";
    if (f.auto) input.autocomplete = f.auto as AutoFill;
    input.spellcheck = false;
    input.style.cssText = "display:block;width:100%;box-sizing:border-box;padding:7px 8px;"
      + "font-size:14px;margin-top:3px;";
    label.appendChild(input);
    inner.appendChild(label);
    inputs[f.key] = input;
  }

  const err = document.createElement("div");
  err.style.cssText = "min-height:16px;font-size:12px;color:#ff4444;margin:10px 0 4px;";
  inner.appendChild(err);

  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:8px;justify-content:flex-end;";
  const btn = (text: string, primary: boolean): HTMLButtonElement => {
    const b = document.createElement("button");
    b.textContent = text;
    b.type = primary ? "submit" : "button";
    b.className = "sfh-btn";
    b.style.cssText = "padding:8px 16px 7px;font-size:12px;" + (primary ? BTN_TONE.cyan : "");
    return b;
  };
  const cancel = btn("Cancel", false);
  const ok = btn(o.submit, true);
  row.append(cancel, ok);
  inner.appendChild(row);

  if (o.alt) {
    const a = document.createElement("a");
    a.textContent = o.alt.label;
    a.href = "#";
    a.style.cssText = "display:block;margin-top:12px;font-size:12px;color:#00ffff;";
    const run = o.alt.run;
    a.addEventListener("click", (e) => { e.preventDefault(); closeForm(); run(); });
    inner.appendChild(a);
  }

  const dismiss = (): void => { closeForm(); o.onCancel?.(); };
  cancel.addEventListener("click", dismiss);
  shade.addEventListener("mousedown", (e) => { if (e.target === shade) dismiss(); });
  shade.addEventListener("keydown", (e) => { if (e.key === "Escape") dismiss(); });

  let busy = false;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    ok.disabled = true;
    err.textContent = "";
    const values: Record<string, string> = {};
    for (const [k, i] of Object.entries(inputs)) values[k] = i.value;
    void o.onSubmit(values).then((why) => {
      busy = false;
      ok.disabled = false;
      if (why === null) { if (open === shade) closeForm(); return; }
      err.textContent = why;
    }, (e2: unknown) => {
      busy = false;
      ok.disabled = false;
      err.textContent = e2 instanceof Error ? e2.message : "Something went wrong";
    });
  });

  shade.appendChild(form);
  document.body.appendChild(shade);
  open = shade;
  Focus.pushLayer(shade, dismiss);
  (Object.values(inputs).find((i) => !i.value) ?? Object.values(inputs)[0])?.focus();
}
