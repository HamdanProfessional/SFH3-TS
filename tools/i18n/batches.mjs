// Split the translation catalog into batches for sub-agent translation.
// Usage: node tools/i18n/batches.mjs <catalog.json> <output dir> [entries per batch] [--only=ids.json]
// --only builds batches only for the listed ids (for incremental translation).
import fs from "node:fs";
import path from "node:path";

const [catalogPath, outDir, sizeArg] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const only = process.argv.find((a) => a.startsWith("--only="));
const size = Number(sizeArg ?? 150);
let list = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
if (only) {
  const ids = new Set(JSON.parse(fs.readFileSync(only.slice(7), "utf8")));
  list = list.filter((e) => ids.has(e.id));
}

const compact = (e) => {
  const o = e.occ[0];
  const where = `${o.file.replace(/^src\//, "")}:${o.line}`;
  const hint = [o.call && `call=${o.call}`, o.prop && `prop=${o.prop}`].filter(Boolean).join(" ");
  const r = { id: e.id, text: e.text, ctx: `${where} ${hint} :: ${o.src}`.slice(0, 220) };
  if (e.kind === "template") r.args = o.args;
  if (e.occ.length > 1) r.alsoIn = [...new Set(e.occ.slice(1).map((x) => x.file.replace(/^src\//, "")))].slice(0, 3);
  return r;
};

// Keep entries from the same file in one batch when possible; a batch never exceeds 1.3x size
const batches = [];
let cur = [], curFile = "";
for (const e of list) {
  const f = e.occ[0].file;
  if (cur.length >= size && (f !== curFile || cur.length >= size * 1.3)) { batches.push(cur); cur = []; }
  cur.push(e); curFile = f;
}
if (cur.length) batches.push(cur);

fs.mkdirSync(outDir, { recursive: true });
batches.forEach((b, i) => {
  const name = `batch_${String(i + 1).padStart(2, "0")}.json`;
  fs.writeFileSync(path.join(outDir, name), JSON.stringify(b.map(compact), null, 1));
  const files = [...new Set(b.map((e) => e.occ[0].file.replace(/^src\//, "")))];
  console.log(`${name}: ${b.length} entries  ${files.slice(0, 4).join(", ")}${files.length > 4 ? ` ... ${files.length} files in total` : ""}`);
});
