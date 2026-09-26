import { MenuPage } from "./MenuPage";
import { ArtButton, itemOf } from "../../ui/art";
import { hitTest } from "../../ui/kit";
import { SH } from "../../audio/SH";
import { urlPad, urlPhone } from "../../core/links";

const PAGE_TOP = 64;

export class AppstorePage extends MenuPage {
  private buttons: { btn: ArtButton; go: () => void }[] = [];

  build(_w: number, _h: number): void {
    this.buttons = [];
    const rows: [string, () => void][] = [
      ["bt_iphone", urlPhone],
      ["bt_ipad", urlPad],
    ];
    for (const [name, go] of rows) {
      const it = itemOf("appstore", name);
      if (!it) continue;
      const b = new ArtButton(it.cid, it.x, it.y - PAGE_TOP, it.sx, it.sy);
      this.view.addChild(b);
      this.buttons.push({ btn: b, go });
    }
  }

  update(_dt: number): void {
    for (const { btn } of this.buttons) {
      btn.setState(hitTest(...btn.hitBox()) ? "over" : "up");
    }
  }

  onClick(): void {
    for (const { btn, go } of this.buttons) {
      if (!hitTest(...btn.hitBox())) continue;
      SH.playSound("S_Ammo");
      go();
      return;
    }
  }
}
