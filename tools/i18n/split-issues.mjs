// Split check results by batch, for the polishing agents.
// Usage: node tools/i18n/split-issues.mjs <batch dir> <check output.txt> <output dir>
import fs from "node:fs";
import path from "node:path";

const [batchDir, issuesPath, outDir] = process.argv.slice(2);
const lines = fs.readFileSync(issuesPath, "utf8").split("\n").filter((l) => /^\d+\t/.test(l));
fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(batchDir).filter((f) => f.endsWith(".json"))) {
  const ids = new Set(JSON.parse(fs.readFileSync(path.join(batchDir, f), "utf8")).map((e) => String(e.id)));
  const mine = lines.filter((l) => ids.has(l.split("\t")[0]));
  fs.writeFileSync(path.join(outDir, f.replace(".json", ".txt")), mine.join("\n") + "\n");
  console.log(`${f}: ${mine.length} issues`);
}
