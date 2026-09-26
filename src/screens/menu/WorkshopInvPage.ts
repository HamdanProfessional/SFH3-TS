import { MenuPage } from "./MenuPage";
import { focusable, hitTest } from "../../ui/kit";
import { ArtButton, itemOf } from "../../ui/art";
import {
  UI, CARD_W, CARD_H, GridPager, catTabs, focusTabs, gridCards, gridCells, hoverCell,
  preloadItemArt, itemArtEpoch, selItemCat, setItemCat,
  type CellHit, type TabHit,
} from "./InventoryPage";
import { setWorkshopGun } from "./WorkshopPage";
import { SD } from "../../state/SD";
import { SH } from "../../audio/SH";
import { GunInfo } from "../../game/GunInfo";

const LAST_GUN_CAT = 10;

export class WorkshopInvPage extends MenuPage {
  private tabHits: TabHit[] = [];
  private cellHits: CellHit[] = [];
  private pager: GridPager | null = null;
  private back: ArtButton | null = null;
  private hoverIndex = -1;
  private artEpoch = -1;

  build(_w: number, _h: number): void {
    preloadItemArt();
    this.artEpoch = itemArtEpoch();
    this.hoverIndex = -1;

    if (selItemCat > LAST_GUN_CAT) setItemCat(0);

    const L = UI.layout.workshopInv;
    const bucket = SD.items[selItemCat] ?? [];

    this.tabHits = catTabs(this.view, L.tabs, selItemCat, (i) => i <= LAST_GUN_CAT);
    this.cellHits = gridCells(L.cards, bucket.length);
    this.hoverIndex = hoverCell(this.cellHits, bucket);
    gridCards(this.view, this.cellHits, bucket, (i) => i === this.hoverIndex);
    this.pager = GridPager.build(this.view, bucket.length);

    const bk = itemOf("workshopInv", "bt_back");
    if (bk) {
      this.back = new ArtButton(bk.cid, bk.x, bk.y - UI.layout.stageTop, bk.sx, bk.sy);
      this.view.addChild(this.back);
    }
  }

  update(): void {
    if (itemArtEpoch() !== this.artEpoch) {
      this.host.refresh();
      return;
    }
    if (this.back) {
      const [x, y, w, h] = this.back.hitBox();
      this.back.setState(hitTest(x, y, w, h) ? "over" : "up");
      focusable(x, y, w, h, { back: true });
    }
    focusTabs(this.tabHits, selItemCat);
    this.pager?.update();
    const h = hoverCell(this.cellHits, SD.items[selItemCat] ?? []);
    if (h !== this.hoverIndex) {
      this.hoverIndex = h;
      this.host.refresh();
    }
  }

  onClick(): void {
    if (this.back) {
      const [x, y, w, h] = this.back.hitBox();
      if (hitTest(x, y, w, h)) {
        SH.playSound("S_Click");
        this.host.goto("workshop");
        return;
      }
    }
    const bucket = SD.items[selItemCat] ?? [];
    if (this.pager?.click(bucket.length)) {
      this.host.refresh();
      return;
    }
    for (const t of this.tabHits) {
      if (hitTest(t.x, t.y, t.w, t.h)) {
        SH.playSound("S_Click");
        setItemCat(t.i);
        this.host.refresh();
        return;
      }
    }
    for (const c of this.cellHits) {
      if (c.i >= bucket.length) continue;
      if (!hitTest(c.x, c.y, CARD_W, CARD_H)) continue;
      const item = bucket[c.i];
      SH.playSound("S_Empty");
      setWorkshopGun(item instanceof GunInfo ? item : null);
      this.host.goto("workshop");
      return;
    }
  }
}
