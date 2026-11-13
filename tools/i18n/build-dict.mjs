// Merge the reviewed translation drafts into the runtime dictionary src/i18n/zh.json (English source → Chinese).
// Usage: node tools/i18n/build-dict.mjs <catalog.json> <draft dir> [extra.json ...]
// Extra translations are applied in order and take precedence over the drafts:
//   *.ids.json is { "catalog id": "<Chinese>" }, used for corrections after review;
//   others are { "English": "<Chinese>" }, for strings outside the catalog (text missed at runtime, server messages, etc.).
// A null value keeps that entry in English.
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const [catalogPath, draftDir, ...extras] = process.argv.slice(2);
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const draft = {};
for (const f of fs.readdirSync(draftDir).filter((f) => f.endsWith(".json")).sort()) {
  Object.assign(draft, JSON.parse(fs.readFileSync(path.join(draftDir, f), "utf8")));
}

const dict = {};
let skipped = 0, conflicts = 0;
for (const e of catalog) {
  const zh = draft[String(e.id)];
  if (typeof zh !== "string" || !zh || zh === e.text) { skipped++; continue; }
  // Doubled {{ }} in templates are literal braces; the runtime does not need them
  const en = e.kind === "template" ? e.text.replace(/\{\{|\}\}/g, (m) => m[0]) : e.text;
  if (en in dict && dict[en] !== zh) conflicts++;
  dict[en] = zh;
}
// Badge progress has @ replaced with a number at runtime; rewrite it as a template so it matches
for (const [en, zh] of Object.entries(dict)) {
  if (!en.includes("@") || /\{\d+\}/.test(en)) continue;
  delete dict[en];
  dict[en.replace(/@/g, "{0}")] = zh.replace(/@/g, "{0}");
}
const byId = new Map(catalog.map((e) => [String(e.id), e]));
for (const f of extras) {
  for (const [k, zh] of Object.entries(JSON.parse(fs.readFileSync(f, "utf8")))) {
    let en = k;
    if (f.endsWith(".ids.json")) {
      const e = byId.get(k);
      if (!e) { console.log(`!! ${path.basename(f)}: no id ${k} in the catalog`); continue; }
      en = e.kind === "template" ? e.text.replace(/\{\{|\}\}/g, (m) => m[0]) : e.text;
    }
    if (zh === null) delete dict[en];
    else if (typeof zh === "string" && zh) dict[en] = zh;
  }
}

const sorted = Object.fromEntries(Object.entries(dict).sort(([a], [b]) => a.localeCompare(b)));
const out = path.join(ROOT, "src/i18n/zh.json");
fs.writeFileSync(out, JSON.stringify(sorted, null, 1) + "\n");
console.log(`${Object.keys(sorted).length} entries written to ${path.relative(ROOT, out)} (skipped ${skipped}, same-source conflicts ${conflicts})`);
