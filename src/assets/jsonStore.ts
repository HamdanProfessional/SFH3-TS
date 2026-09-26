const store: Record<string, unknown> = {};

export function jsonAsset(name: string): unknown {
  if (!(name in store)) throw new Error(`JSON asset "${name}" was not preloaded`);
  return store[name];
}

export async function preloadJson(
  manifest: Record<string, string>,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const names = Object.keys(manifest).filter((n) => !(n in store));
  let done = 0;
  await Promise.all(names.map(async (name) => {
    const res = await fetch(manifest[name]);
    if (!res.ok) throw new Error(`${manifest[name]}: HTTP ${res.status}`);
    store[name] = await res.json();
    onProgress?.(++done, names.length);
  }));
}

let lazyManifest: Record<string, string> = {};
let lazyLoad: Promise<void> | null = null;

export function setLazyJson(manifest: Record<string, string>): void {
  lazyManifest = manifest;
}

export function loadLazyJson(
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  if (!lazyLoad) {
    lazyLoad = preloadJson(lazyManifest, onProgress).catch((err: unknown) => {
      lazyLoad = null;
      throw err;
    });
  }
  return lazyLoad;
}
