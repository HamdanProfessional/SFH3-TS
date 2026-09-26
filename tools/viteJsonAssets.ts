import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import type { Plugin, Rollup } from "vite";

const VIRTUAL = "virtual:json-manifest";
const PLACEHOLDER = "__SFH3_JSON_MANIFEST__";
const LAZY_PLACEHOLDER = "__SFH3_JSON_LAZY__";
const JSON_ID = "\0sfh3-json:";

export function jsonAssets(root: string): Plugin {
  const dir = resolve(root, "src/assets");
  const store = resolve(dir, "jsonStore.ts").replace(/\\/g, "/");
  const manifest: Record<string, string> = {};
  let build = false;
  let base = "/";

  return {
    name: "sfh3-json-assets",
    enforce: "pre",
    configResolved(c) {
      build = c.command === "build";
      base = c.base;
    },
    resolveId(id, importer) {
      if (id === VIRTUAL) return "\0" + VIRTUAL;
      if (!build || !importer || !id.endsWith(".json")) return null;
      const file = resolve(dirname(importer.split("?")[0]), id);
      return file.toLowerCase().startsWith(dir.toLowerCase()) ? JSON_ID + file.slice(0, -5) : null;
    },
    load(id) {
      if (id === "\0" + VIRTUAL) {
        return build
          ? `export default ${JSON.stringify(PLACEHOLDER)};\n`
            + `export const lazy = ${JSON.stringify(LAZY_PLACEHOLDER)};\n`
          : "export default {};\nexport const lazy = {};\n";
      }
      if (!id.startsWith(JSON_ID)) return null;
      const file = id.slice(JSON_ID.length) + ".json";
      const source = readFileSync(file);
      const name = basename(file, ".json");
      const hash = createHash("sha256").update(source).digest("base64url").slice(0, 8);
      const fileName = `assets/${name}-${hash}.json`;
      if (!manifest[name]) this.emitFile({ type: "asset", fileName, source });
      manifest[name] = base + fileName;
      return `import { jsonAsset } from ${JSON.stringify(store)};\n`
        + `export default jsonAsset(${JSON.stringify(name)});\n`;
    },
    transformIndexHtml: {
      order: "post",
      handler(_html, ctx) {
        if (!ctx.bundle) return;
        const chunks = Object.values(ctx.bundle);
        const app = chunks.find((c) => c.type === "chunk"
          && c.moduleIds.some((m) => m.replace(/\\/g, "/").endsWith("/src/app.ts")));
        if (!app || app.type !== "chunk") return;
        const files = [app.fileName, ...app.imports];
        return files.map((f) => ({
          tag: "link", attrs: { rel: "modulepreload", crossorigin: "", href: base + f },
          injectTo: "head" as const,
        }));
      },
    },
    renderChunk(code, chunk, _options, meta) {
      if (!code.includes(PLACEHOLDER)) return null;
      const bootNames = bootJson(chunk, meta.chunks);
      const boot: Record<string, string> = {};
      const lazy: Record<string, string> = {};
      for (const [name, url] of Object.entries(manifest)) {
        (bootNames.has(name) ? boot : lazy)[name] = url;
      }
      const put = (s: string, key: string, value: object): string =>
        s.replace(new RegExp(`(["'\`])${key}\\1`, "g"), JSON.stringify(value));
      return { code: put(put(code, PLACEHOLDER, boot), LAZY_PLACEHOLDER, lazy), map: null };
    },
  };
}

function bootJson(entry: Rollup.RenderedChunk,
                  chunks: Record<string, Rollup.RenderedChunk>): Set<string> {
  const isApp = (c: Rollup.RenderedChunk): boolean =>
    c.moduleIds.some((m) => m.replace(/\\/g, "/").endsWith("/src/app.ts"));
  const seen = new Set<string>();
  const walk = (c: Rollup.RenderedChunk | undefined): void => {
    if (!c || seen.has(c.fileName)) return;
    seen.add(c.fileName);
    for (const f of c.imports) walk(chunks[f]);
  };
  walk(entry);
  for (const c of Object.values(chunks)) if (isApp(c)) walk(c);
  const names = new Set<string>();
  for (const f of seen) {
    for (const m of chunks[f]?.moduleIds ?? []) {
      if (m.startsWith(JSON_ID)) names.add(basename(m.slice(JSON_ID.length)));
    }
  }
  return names;
}
