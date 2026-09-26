import { defineConfig } from "vite";
import { resolve } from "path";
import { execSync } from "node:child_process";
import { jsonAssets } from "./tools/viteJsonAssets";

function assetVersion(): string {
  try {
    return execSync("git rev-parse HEAD:public/assets", { encoding: "utf8" })
      .trim().slice(0, 12);
  } catch {
    return String(Date.now());
  }
}

export default defineConfig({
  plugins: [jsonAssets(__dirname)],
  define: {
    __ASSET_V__: JSON.stringify(assetVersion()),
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5174,
    open: true,
    watch: {
      ignored: ["**/test/_*.mjs", "**/shots/**", "**/dist/**"],
    },
  },
  build: {
    target: "es2022",
    outDir: "dist",
  },
});
