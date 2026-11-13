// Extract English strings that may be shown to the player from src/ and write the translation catalog.
// Usage: node tools/i18n/extract.mjs <output.json>
// Literals are recorded as whole sentences; template strings and "a" + b concatenations are recorded as templates with {0} {1} placeholders.
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SRC = path.join(ROOT, "src");
const out = process.argv[2] ?? path.join(ROOT, "tools/i18n/catalog.json");

const SKIP_DIRS = new Set(["i18n"]);
// Random names stay in English; the cheat console only appears in browser devtools, so it is not translated
const SKIP_FILES = new Set(["src/data/names.ts", "src/core/DevConsole.ts"]);
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p); }
    else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) files.push(p);
  }
})(SRC);

// Strings that are clearly not UI text
function looksLikeCode(s) {
  const t = s.trim();
  if (!/[A-Za-z].*[A-Za-z]|^[A-Z]$/.test(t)) return true;
  if (/^[a-z][a-zA-Z0-9_]*$/.test(t)) return true;            // identifiers starting with a lowercase letter
  if (/^[a-z0-9_-]+(\.[a-z0-9_-]+)+$/i.test(t) && !/\s/.test(t) && /\.(png|webp|json|mp3|ogg|svg|ts|js|ttf|html)$/i.test(t)) return true;
  if (/^(\.{0,2}\/|https?:|wss?:|data:|#[0-9a-f]{3,8}$|@\/)/i.test(t)) return true;
  if (/^[a-z]+(-[a-z0-9]+)+$/.test(t)) return true;           // kebab-case
  if (/^[A-Z][A-Z0-9_]*_[A-Z0-9_]+$/.test(t)) return true;    // CONST_NAME
  if (/^\d+(px|em|%)?\s/.test(t) && /px/.test(t)) return true; // CSS font size
  if (/^(bold|normal|italic|left|right|center|top|bottom|middle|round|butt|miter|none|auto|pointer)$/i.test(t)) return true;
  if (/^(Verdana|sans-serif|QTypeSquare|Xoireqe)/.test(t)) return true;
  if (/^[0-9a-f]{6}$/i.test(t) || /^rgba?\(/.test(t)) return true;  // colors
  if (/^(S|M)_\w+$/.test(t) || /^[A-Z][A-Za-z0-9]*_[A-Za-z0-9_]+$/.test(t)) return true; // sound and class names
  if (/\b(uniform|gl_|vec[234]|f32)\b/.test(t)) return true;     // shaders
  if (!/\s/.test(t) && /[<>(){}=;\\]/.test(t)) return true;
  if (!/\s/.test(t) && /\//.test(t)) return true;                // paths
  if (!/\s/.test(t) && /^[a-z0-9_\-x]*\.[a-z0-9_.\-]+$/.test(t)) return true; // a.b-style keys
  return false;
}

const entries = new Map();
function add(text, kind, occ) {
  const key = kind + "\u0000" + text;
  let e = entries.get(key);
  if (!e) { e = { text, kind, occ: [] }; entries.set(key, e); }
  if (e.occ.length < 6) e.occ.push(occ);
  else e.more = (e.more ?? 0) + 1;
}

function calleeName(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isCallExpression(p) || ts.isNewExpression(p)) {
      const ex = p.expression;
      return ex ? ex.getText().slice(0, 40) : "";
    }
    if (ts.isBlock(p) || ts.isSourceFile(p)) return "";
  }
  return "";
}
function propName(node) {
  let p = node.parent;
  while (p && (ts.isBinaryExpression(p) || ts.isParenthesizedExpression(p) || ts.isConditionalExpression(p))) p = p.parent;
  if (p && ts.isPropertyAssignment(p) && p.name) return p.name.getText();
  if (p && ts.isBinaryExpression(p.parent ?? {}) ) return "";
  return "";
}

// Flatten + concatenation into a template; only handle chains with at least one string literal
function flattenConcat(node, parts) {
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    flattenConcat(node.left, parts); flattenConcat(node.right, parts); return;
  }
  if (ts.isParenthesizedExpression(node) && ts.isBinaryExpression(node.expression)
      && node.expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    flattenConcat(node.expression, parts); return;
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) parts.push({ lit: node.text });
  else if (ts.isTemplateExpression(node)) {
    parts.push({ lit: node.head.text });
    for (const sp of node.templateSpans) { parts.push({ expr: sp.expression.getText() }); parts.push({ lit: sp.literal.text }); }
  } else parts.push({ expr: node.getText() });
}
function partsToPattern(parts) {
  let s = ""; const args = []; let n = 0;
  for (const p of parts) {
    if (p.lit !== undefined) s += p.lit.replace(/[{}]/g, (c) => c + c);
    else { s += `{${n++}}`; args.push(p.expr.slice(0, 60)); }
  }
  return { s, args };
}

for (const file of files) {
  const rel = path.relative(ROOT, file).replace(/\\/g, "/");
  if (SKIP_FILES.has(rel)) continue;
  const code = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.ES2022, true);
  const lines = code.split("\n");

  const occOf = (node, extra = {}) => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    return { file: rel, line, src: lines[line - 1].trim().slice(0, 160), call: calleeName(node), prop: propName(node), ...extra };
  };

  const isConcatRoot = (node) =>
    ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken
    && !(ts.isBinaryExpression(node.parent) && node.parent.operatorToken.kind === ts.SyntaxKind.PlusToken)
    && !(ts.isParenthesizedExpression(node.parent) && ts.isBinaryExpression(node.parent.parent)
         && node.parent.parent.operatorToken.kind === ts.SyntaxKind.PlusToken);

  const inConcat = (node) => {
    let p = node.parent;
    while (p && ts.isParenthesizedExpression(p)) p = p.parent;
    return p && ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.PlusToken;
  };

  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isLiteralTypeNode(node)) return;
    if (ts.isCallExpression(node) && node.expression.getText() === "import") return;

    if (isConcatRoot(node)) {
      const parts = []; flattenConcat(node, parts);
      if (parts.some((p) => p.lit !== undefined && /[A-Za-z]{2}/.test(p.lit))) {
        const { s, args } = partsToPattern(parts);
        if (!looksLikeCode(s.replace(/\{\d+\}/g, ""))) add(s, "template", occOf(node, { args }));
      }
    } else if (ts.isTemplateExpression(node) && !inConcat(node)) {
      const parts = []; flattenConcat(node, parts);
      const { s, args } = partsToPattern(parts);
      const lit = s.replace(/\{\d+\}/g, "");
      if (/[A-Za-z]{2}/.test(lit) && !looksLikeCode(lit)) add(s, "template", occOf(node, { args }));
    } else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !inConcat(node)) {
      const p = node.parent;
      const isKey = (ts.isPropertyAssignment(p) && p.name === node) || ts.isElementAccessExpression(p) && p.argumentExpression === node
        || ts.isPropertySignature(p) || ts.isEnumMember(p);
      if (!isKey && !looksLikeCode(node.text)) add(node.text, "literal", occOf(node));
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
}

// Initial text of Flash text fields in JSON assets (HTML tags stripped)
const ASSETS = path.join(SRC, "assets");
for (const f of fs.readdirSync(ASSETS).filter((f) => f.endsWith(".json"))) {
  const raw = fs.readFileSync(path.join(ASSETS, f), "utf8");
  const seen = new Set();
  for (const m of raw.matchAll(/"(text|html|caption|label|title)":\s*"((?:[^"\\]|\\.)*)"/g)) {
    let s = JSON.parse(`"${m[2]}"`);
    s = s.replace(/<\/p>\s*<p[^>]*>/g, "\n").replace(/<br\s*\/?>/g, "\n").replace(/<[^>]*>/g, "")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();
    if (!s || seen.has(s) || looksLikeCode(s)) continue;
    seen.add(s);
    add(s, "literal", { file: `src/assets/${f}`, line: 0, src: `json ${m[1]}`, call: "", prop: m[1] });
  }
}

const list = [...entries.values()].sort((a, b) =>
  a.occ[0].file.localeCompare(b.occ[0].file) || a.occ[0].line - b.occ[0].line);
list.forEach((e, i) => { e.id = i + 1; });
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(list, null, 1));
const t = list.filter((e) => e.kind === "template").length;
console.log(`${list.length} entries (${list.length - t} literal, ${t} template) from ${files.length} files -> ${out}`);
