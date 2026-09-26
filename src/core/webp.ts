import { extensions, ExtensionType } from "pixi.js";

const PNG = /\.png(?=\?|#|$)/i;

extensions.add({
  extension: { type: ExtensionType.ResolveParser, name: "sfh3-webp", priority: 100 },
  test: (url: string) => PNG.test(url),
  parse: (url: string) => ({ resolution: 1, format: "webp", src: url.replace(PNG, ".webp") }),
});
