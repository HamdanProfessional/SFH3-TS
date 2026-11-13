// Check translation drafts: missing entries, placeholders, newlines, leading/trailing spaces, and terminology.
// Usage: node tools/i18n/check.mjs <catalog.json> <draft dir or merged zh.json> [--glossary=glossary.md]
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const [catalogPath, draftPath] = args;
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const byId = new Map(catalog.map((e) => [String(e.id), e]));

let draft = {};
if (fs.statSync(draftPath).isDirectory()) {
  for (const f of fs.readdirSync(draftPath).filter((f) => f.endsWith(".json")).sort()) {
    try { Object.assign(draft, JSON.parse(fs.readFileSync(path.join(draftPath, f), "utf8"))); }
    catch (e) { console.log(`!! ${f} is not valid JSON: ${e.message}`); }
  }
} else draft = JSON.parse(fs.readFileSync(draftPath, "utf8"));

const issues = [];
const note = (id, msg) => issues.push({ id: Number(id), msg });
const ph = (s) => (s.match(/\{\d+\}/g) ?? []).sort().join(",");
const count = (s, re) => (s.match(re) ?? []).length;

for (const [id, zh] of Object.entries(draft)) {
  const e = byId.get(id);
  if (!e) { note(id, "id not in the catalog"); continue; }
  if (zh === null) continue;
  if (typeof zh !== "string") { note(id, "value is not a string"); continue; }
  const en = e.text;
  // Placeholders for English plural and copula fragments may be dropped in Chinese
  const plural = new Set((e.occ[0].args ?? []).map((a, i) => (/["'](s|es| is| are|s are|s is)["']|plural\(/.test(a) ? `{${i}}` : null)).filter(Boolean));
  const enPh = (en.match(/\{\d+\}/g) ?? []).filter((x) => !(plural.has(x) && !zh.includes(x))).sort().join(",");
  if (enPh !== ph(zh)) note(id, `placeholder mismatch ${ph(en)} → ${ph(zh)}`);
  if (count(en, /@/g) !== count(zh, /@/g)) note(id, "@ count mismatch");
  if (count(en, /\n/g) !== count(zh, /\n/g) && en.length < 60) note(id, "newline count mismatch");
  if (/^\s/.test(en) !== /^\s/.test(zh) || /\s$/.test(en) !== /\s$/.test(zh)) note(id, "leading/trailing space mismatch");
  if (/^- /.test(en) && !/^- /.test(zh)) note(id, "leading '- ' dropped");
  if (!/[㐀-鿿]/.test(zh) && zh === en) note(id, "translation same as source (should be null?)");
  if (en.length <= 12 && zh.length > Math.max(6, en.length)) note(id, "translation too long for a short label");
  if (/[,!?:;](?=[㐀-鿿])|(?<=[㐀-鿿])[,!?;]/.test(zh)) note(id, "half-width punctuation in Chinese text");
}
const missing = catalog.filter((e) => !(String(e.id) in draft)).map((e) => e.id);

// Terms: if the source contains the English term as a whole word, the translation should contain the Chinese term
const glossaryArg = process.argv.find((a) => a.startsWith("--glossary="));
if (glossaryArg) {
  const md = fs.readFileSync(glossaryArg.slice(11), "utf8");
  const terms = [];
  var AMBIGUOUS = new Set(["play", "next", "back", "level", "custom", "slots", "ready", "controls", "damage", "rating",
    "close", "done", "reset", "fire", "jump", "pause", "level up", "build", "craft", "upgrade", "class", "store", "squad"]);
  for (const line of md.split("\n")) {
    const m = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/);
    if (!m || /^-+$/.test(m[1]) || m[1] === "英文") continue;
    if (/[（(]/.test(m[1])) continue;                 // terms with a note in parentheses are reviewed by hand
    const zhs = m[2].split("/").map((s) => s.trim()).filter(Boolean);
    for (const en of m[1].split("/").map((s) => s.trim())) {
      if (en.length >= 4 && !/\s\/\s/.test(en)) terms.push({ en, zhs });
    }
  }
  for (const [id, zh] of Object.entries(draft)) {
    const e = byId.get(id);
    if (!e || typeof zh !== "string") continue;
    for (const t of terms) {
      // Common words have other meanings in long sentences; only enforce them in short labels
      if (e.text.length > 24 && AMBIGUOUS.has(t.en.toLowerCase())) continue;
      const re = new RegExp(`\\b${t.en.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (re.test(e.text) && !t.zhs.some((z) => zh.includes(z))) note(id, `term ${t.en} should be translated as ${t.zhs.join("/")}`);
    }
  }
}

issues.sort((a, b) => a.id - b.id);
for (const i of issues) {
  const e = byId.get(String(i.id));
  console.log(`${i.id}\t${i.msg}\t${JSON.stringify(e?.text).slice(0, 70)} → ${JSON.stringify(draft[i.id]).slice(0, 50)}`);
}
console.log(`\n${Object.keys(draft).length} draft entries, ${issues.length} issues, ${missing.length} missing from the catalog${missing.length && missing.length < 40 ? ": " + missing.join(",") : ""}`);
