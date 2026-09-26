import { build } from "esbuild";
import { mkdirSync, statSync } from "node:fs";

mkdirSync("server/dist", { recursive: true });

await build({
  entryPoints: ["server/index.ts"],
  outfile: "server/dist/sfh3-server.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  external: ["bufferutil", "utf-8-validate"],
  define: { __ASSET_V__: '"server"' },
  logLevel: "info",
});

const kb = statSync("server/dist/sfh3-server.cjs").size / 1024;
console.log(`server/dist/sfh3-server.cjs  ${kb.toFixed(0)} KB`);
