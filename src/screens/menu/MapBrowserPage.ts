import { Container, Graphics, Text, TextStyle } from "pixi.js";
import { MenuPage, type PageHost } from "./MenuPage";
import { hitTest } from "../../ui/kit";
import { SH } from "../../audio/SH";
import { account, accountVersion } from "../../net/account";
import { formOpen, openForm } from "../../ui/DomForm";
import type { BrowseRow, BrowseSort, MapThumb } from "../../editor/store";
import {
  BOLD, BOOK, CAPS, SFH, SfhButton, paintRow, sInfo, sPanel, sText, sTitle,
} from "./sfhStyle";

type Store = typeof import("../../editor/store");
type Format = typeof import("../../editor/format");

const ROW_H = 62;
const ROW_GAP = 4;
const INFO_W = 240;
const STALE_MS = 30_000;

const TABS: [BrowseSort, string, number][] = [["new", "New", 64], ["top", "Top", 64], ["week", "This week", 104]];

export class MapBrowserPage extends MenuPage {
  private static lib: { store: Store; format: Format } | null = null;
  private static sort: BrowseSort = "new";
  private static query = "";
  private static page = 0;
  private static per = 6;
  private static rows: BrowseRow[] = [];
  private static more = false;
  private static loading = false;
  private static loadedAt = 0;
  private static ask = 0;
  private static selected: string | null = null;
  private static status = "";
  private static statusBad = false;
  private static busy = false;
  private static version = 0;

  private static touch(): void {
    MapBrowserPage.version++;
  }

  private static say(text: string, bad = false): void {
    MapBrowserPage.status = text;
    MapBrowserPage.statusBad = bad;
    MapBrowserPage.touch();
  }

  private static async loadLib(): Promise<{ store: Store; format: Format }> {
    if (!MapBrowserPage.lib) {
      const [store, format] = await Promise.all([
        import("../../editor/store"), import("../../editor/format"),
      ]);
      MapBrowserPage.lib = { store, format };
    }
    return MapBrowserPage.lib;
  }

  private static async reload(): Promise<void> {
    const ask = ++MapBrowserPage.ask;
    MapBrowserPage.loading = true;
    MapBrowserPage.touch();
    try {
      const { store } = await MapBrowserPage.loadLib();
      const r = await store.browseShared(MapBrowserPage.sort, MapBrowserPage.query,
        MapBrowserPage.page, MapBrowserPage.per);
      if (ask !== MapBrowserPage.ask) return;
      MapBrowserPage.rows = r.rows;
      MapBrowserPage.more = r.more;
      if (!r.rows.some((m) => m.id === MapBrowserPage.selected)) {
        MapBrowserPage.selected = r.rows[0]?.id ?? null;
      }
      MapBrowserPage.status = "";
    } catch (e) {
      if (ask !== MapBrowserPage.ask) return;
      MapBrowserPage.rows = [];
      MapBrowserPage.more = false;
      MapBrowserPage.status = e instanceof Error ? e.message : "Could not load the maps";
      MapBrowserPage.statusBad = true;
    }
    MapBrowserPage.loading = false;
    MapBrowserPage.loadedAt = Date.now();
    MapBrowserPage.touch();
  }

  private seen = MapBrowserPage.version;
  private seenAcct = accountVersion();
  private buttons: { btn: SfhButton; go: () => void }[] = [];
  private rowHits: { x: number; y: number; w: number; h: number; row: BrowseRow; g: Graphics }[] = [];
  private hovered = -1;

  constructor(host: PageHost) {
    super(host);
    if (!MapBrowserPage.loading && Date.now() - MapBrowserPage.loadedAt > STALE_MS) {
      void MapBrowserPage.reload();
    }
  }

  build(w: number, h: number): void {
    this.buttons = [];
    this.rowHits = [];
    this.hovered = -1;
    this.seen = MapBrowserPage.version;
    this.seenAcct = accountVersion();
    const S = MapBrowserPage;

    this.add(sTitle("Shared maps", 16, 2));

    let tx = 220;
    for (const [key, label, bw] of TABS) {
      const b = this.addButton(new SfhButton(label, tx, 4, bw, 24), () => {
        S.sort = key;
        S.page = 0;
        void S.reload();
      });
      b.setActive(S.sort === key);
      tx += bw + 6;
    }
    const q = S.query;
    this.addButton(new SfhButton(q ? `Search: ${clip(q, 14)}` : "Search", w - 16 - 64 - 6 - 150, 4, 150, 24),
      () => this.openSearch());
    this.addButton(new SfhButton("Clear", w - 16 - 64, 4, 64, 24), () => {
      S.query = "";
      S.page = 0;
      void S.reload();
    }).setEnabled(!!q);

    const panelY = 36;
    const footH = 40;
    const listW = w - 32 - INFO_W - 8;
    const panelH = h - panelY - footH;
    this.add(sPanel(16, panelY, listW, panelH));
    const rowW = listW - 16;
    const per = Math.max(1, Math.floor((panelH - 16 + ROW_GAP) / (ROW_H + ROW_GAP)));
    if (per !== S.per && !S.loading) {
      S.per = per;
      S.page = 0;
      void S.reload();
    }

    const lib = S.lib;
    if (!S.rows.length) {
      const msg = S.loading ? "Loading shared maps..."
        : S.status ? "The map list is unavailable."
          : S.query ? `No maps match "${S.query}".`
            : S.sort === "week" ? "Nothing has been played or rated this week yet."
              : S.page > 0 ? "No more maps." : "No maps have been shared yet.";
      this.add(sText(msg, 30, panelY + 16, 13, SFH.grey));
    }
    S.rows.forEach((row, i) => {
      const x = 24;
      const y = panelY + 8 + i * (ROW_H + ROW_GAP);
      const sel = row.id === S.selected;
      const g = paintRow(new Graphics(), rowW, ROW_H, sel);
      g.position.set(x, y);
      this.add(g);
      if (lib) this.add(thumbView(row.thumb, lib.format, 92, 52)).position.set(x + 10, y + 5);
      this.add(sText(clip(row.name.toUpperCase(), 20), x + 112, y + 7, 13, SFH.white, CAPS));
      this.add(sText(`by ${row.author}`, x + 112, y + 26, 11, SFH.grey));
      this.add(sText(`${row.w} x ${row.h}  -  ${age(row.created)}`, x + 112, y + 43, 10, SFH.dim));
      this.add(sText("PLAYS", x + rowW - 146, y + 12, 9, SFH.grey, CAPS));
      this.add(sText(String(row.plays), x + rowW - 146, y + 28, 14, SFH.white, BOLD));
      this.add(sText("RATING", x + rowW - 74, y + 12, 9, SFH.grey, CAPS));
      const [rate, col] = rating(row);
      this.add(sText(rate, x + rowW - 74, y + 28, 14, col, BOLD));
      this.rowHits.push({ x, y, w: rowW, h: ROW_H, row, g });
    });

    const ix = w - 16 - INFO_W;
    this.add(sInfo(ix, panelY, INFO_W, panelH));
    const cur = S.rows.find((m) => m.id === S.selected) ?? null;
    const iw = INFO_W - 24;
    let y = panelY + 12;
    if (cur) {
      if (lib) this.add(thumbView(cur.thumb, lib.format, iw, 112)).position.set(ix + 12, y);
      y += 120;
      this.add(sText(clip(cur.name.toUpperCase(), 18), ix + 12, y, 14, SFH.white, CAPS));
      this.add(sText(`by ${cur.author}`, ix + 12, y + 20, 12, SFH.grey));
      this.add(sText(`${cur.w} x ${cur.h} cells  -  shared ${age(cur.created)}`, ix + 12, y + 38, 10, SFH.dim));
      const [rate, col] = rating(cur);
      this.add(sText(`${cur.plays} ${cur.plays === 1 ? "play" : "plays"}`, ix + 12, y + 54, 12, SFH.white, BOLD));
      this.add(sText(`${rate}  (${cur.up} up, ${cur.down} down)`, ix + 100, y + 54, 12, col, BOLD));
      y += 78;

      const busy = S.busy;
      this.addButton(new SfhButton("Play", ix + 12, y, iw, 28, 13), () => void this.play(cur))
        .setEnabled(!busy);
      y += 34;
      this.addButton(new SfhButton("Edit a copy", ix + 12, y, iw, 24), () => void this.editCopy(cur))
        .setEnabled(!busy);
      y += 30;
      this.addButton(new SfhButton("Copy link", ix + 12, y, iw, 24), () => void this.copyLink(cur));
      y += 30;
      const me = account();
      const own = !!me && me.name.toLowerCase() === cur.author.toLowerCase();
      const half = (iw - 6) / 2;
      const up = this.addButton(new SfhButton(cur.mine > 0 ? "Liked" : "Like", ix + 12, y, half, 24),
        () => void this.rate(cur, 1));
      const down = this.addButton(new SfhButton(cur.mine < 0 ? "Disliked" : "Dislike",
        ix + 18 + half, y, half, 24), () => void this.rate(cur, -1));
      up.setActive(cur.mine > 0);
      down.setActive(cur.mine < 0);
      up.setEnabled(!own && !busy);
      down.setEnabled(!own && !busy);
      y += 30;
      const hint = own ? "Your map: others rate it." : me ? "" : "Sign in (Multiplayer) to rate.";
      if (hint) this.add(sText(hint, ix + 12, y, 10, SFH.dim));
    } else {
      this.add(sText(S.loading ? "" : "Pick a map on the left.", ix + 12, y, 12, SFH.grey));
    }
    if (S.status) {
      const t = new Text({
        roundPixels: true,
        text: S.status,
        style: new TextStyle({
          fontFamily: BOOK, fontSize: 11, fill: S.statusBad ? SFH.red : SFH.green,
          wordWrap: true, wordWrapWidth: iw, breakWords: true,
        }),
      });
      t.position.set(ix + 12, panelY + panelH - 12 - Math.min(t.height, 60));
      this.add(t);
    }

    const fy = h - footH + 8;
    this.addButton(new SfhButton("Prev", 16, fy, 80, 24), () => {
      S.page = Math.max(0, S.page - 1);
      void S.reload();
    }).setEnabled(S.page > 0 && !S.loading);
    this.add(sText(`PAGE ${S.page + 1}`, 110, fy + 5, 12, SFH.white, CAPS));
    this.addButton(new SfhButton("Next", 180, fy, 80, 24), () => {
      S.page++;
      void S.reload();
    }).setEnabled(S.more && !S.loading);
    this.add(sText("Plays as a quick match with bots. Nothing is earned.", 276, fy + 6, 10, SFH.dim));
    this.addButton(new SfhButton("Map editor", w - 16 - 110 - 6 - 80, fy, 110, 24),
      () => this.host.openEditor());
    this.addButton(new SfhButton("Back", w - 16 - 80, fy, 80, 24), () => this.host.goto("missions"));
  }

  private add<T extends Container>(o: T): T {
    this.view.addChild(o);
    return o;
  }

  private addButton(b: SfhButton, go: () => void): SfhButton {
    this.view.addChild(b);
    this.buttons.push({ btn: b, go });
    return b;
  }

  private openSearch(): void {
    openForm({
      title: "Search shared maps",
      note: "Part of a map's name, or its author's.",
      fields: [{ key: "q", label: "Name or author", value: MapBrowserPage.query }],
      submit: "Search",
      onSubmit: async (v) => {
        MapBrowserPage.query = (v.q ?? "").trim().slice(0, 40);
        MapBrowserPage.page = 0;
        void MapBrowserPage.reload();
        return null;
      },
    });
  }

  private async task(run: () => Promise<void>): Promise<void> {
    const S = MapBrowserPage;
    if (S.busy) return;
    S.busy = true;
    S.touch();
    try {
      await run();
    } catch (e) {
      S.say(e instanceof Error ? e.message : "Something went wrong", true);
    }
    S.busy = false;
    S.touch();
  }

  private play(row: BrowseRow): Promise<void> {
    return this.task(async () => {
      MapBrowserPage.say("Loading the map...");
      const { store } = await MapBrowserPage.loadLib();
      const { map } = await store.fetchShared(row.id);
      const bad = await this.host.playCustom(map);
      if (bad) { MapBrowserPage.say(`Can't play this map: ${bad}`, true); return; }
      store.reportPlay(row.id);
      MapBrowserPage.status = "";
      MapBrowserPage.loadedAt = 0;
    });
  }

  private editCopy(row: BrowseRow): Promise<void> {
    return this.task(async () => {
      MapBrowserPage.say("Loading the map...");
      const { store } = await MapBrowserPage.loadLib();
      const { map, author } = await store.fetchShared(row.id);
      MapBrowserPage.status = "";
      this.host.openEditor({
        copy: map,
        notice: `A copy of "${map.name}" by ${author || "somebody"}. Save or share it as your own.`,
      });
    });
  }

  private async copyLink(row: BrowseRow): Promise<void> {
    const { store } = await MapBrowserPage.loadLib();
    const link = store.shareLink(row.id);
    try {
      if (!navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(link);
      MapBrowserPage.say("Link copied. Anyone with it can open and play the map.");
    } catch {
      MapBrowserPage.say(`Copy this link: ${link}`);
    }
  }

  private rate(row: BrowseRow, v: 1 | -1): Promise<void> {
    return this.task(async () => {
      if (!account()) {
        MapBrowserPage.say("Sign in on the Multiplayer page to rate maps.", true);
        return;
      }
      const { store } = await MapBrowserPage.loadLib();
      const r = await store.rateShared(row.id, row.mine === v ? 0 : v);
      Object.assign(row, r);
      MapBrowserPage.status = "";
    });
  }

  update(_dt: number): void {
    const over = this.rowAt();
    if (over !== this.hovered) {
      this.lit(this.hovered, false);
      this.lit(over, true);
      this.hovered = over;
    }
    for (const b of this.buttons) b.btn.update();
    if (this.seen !== MapBrowserPage.version || this.seenAcct !== accountVersion()) {
      this.host.refresh();
    }
  }

  onClick(): void {
    if (formOpen()) return;
    for (const { btn, go } of this.buttons) {
      if (btn.activate()) { go(); return; }
    }
    const i = this.rowAt();
    if (i >= 0) {
      SH.playSound("S_Click");
      MapBrowserPage.selected = this.rowHits[i].row.id;
      MapBrowserPage.status = "";
      MapBrowserPage.touch();
    }
  }

  private rowAt(): number {
    for (let i = 0; i < this.rowHits.length; i++) {
      const r = this.rowHits[i];
      if (hitTest(r.x, r.y, r.w, r.h)) return i;
    }
    return -1;
  }

  private lit(i: number, on: boolean): void {
    const r = this.rowHits[i];
    if (r) paintRow(r.g, r.w, r.h, on || r.row.id === MapBrowserPage.selected);
  }
}

function thumbView(t: MapThumb, format: Format, bw: number, bh: number): Graphics {
  const g = new Graphics();
  g.rect(0, 0, bw, bh).fill({ color: 0x02080a, alpha: 0.85 });
  const s = Math.min(bw / Math.max(1, t.w), bh / Math.max(1, t.h));
  const ox = (bw - t.w * s) / 2;
  const oy = (bh - t.h * s) / 2;
  for (let y = 0; y < t.h; y++) {
    let x = 0;
    while (x < t.w) {
      const c = t.cells.charCodeAt(y * t.w + x);
      let n = 1;
      while (x + n < t.w && t.cells.charCodeAt(y * t.w + x + n) === c) n++;
      const id = parseInt(String.fromCharCode(c), 36);
      const mat = id > 0 ? format.MATERIALS[id] : undefined;
      if (mat) {
        g.rect(ox + x * s, oy + y * s, n * s, s).fill({ color: mat.tint, alpha: mat.solid ? 1 : 0.6 });
      }
      x += n;
    }
  }
  g.rect(0, 0, bw, bh).stroke({ color: SFH.cyan, alpha: 0.35, width: 1 });
  return g;
}

function rating(r: BrowseRow): [string, number] {
  const n = r.up + r.down;
  if (!n) return ["-", SFH.dim];
  const pct = Math.round((r.up / n) * 100);
  return [`${pct}%`, pct >= 70 ? SFH.green : pct >= 40 ? SFH.gold : SFH.red];
}

function age(ms: number): string {
  const d = Math.floor((Date.now() - ms) / 86_400_000);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 60) return `${d} days ago`;
  return new Date(ms).toISOString().slice(0, 10);
}

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}...` : s;
}
