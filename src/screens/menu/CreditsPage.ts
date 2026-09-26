import { MenuPage } from "./MenuPage";
import { PAGES, drawRuns, pageSprite, refreshTex } from "./pageArt";
import { hitTest } from "../../ui/kit";
import { ARMOR_FIRST, urlArmor, urlNotDoppler } from "../../core/links";

const PAGE_TOP = 64;

export class CreditsPage extends MenuPage {
  private links: { x: number; y: number; w: number; h: number; go: () => void }[] = [];

  build(_w: number, _h: number): void {
    this.links = [];
    const C = PAGES.credits;
    for (const runs of Object.values(C.runs ?? {})) {
      drawRuns(this.view, runs, PAGE_TOP);
    }

    const slots: [string, boolean][] = [
      ["logo1", ARMOR_FIRST],
      ["logo2", !ARMOR_FIRST],
    ];
    for (const [name, armor] of slots) {
      const pos = (C as unknown as Record<string, { x: number; y: number }>)[name];
      if (!pos) continue;
      const rec = armor ? C.logo.armor : C.logo.notdoppler;
      this.view.addChild(pageSprite(rec, pos.x, pos.y - PAGE_TOP));
      this.links.push({
        x: pos.x - rec.ox, y: pos.y - PAGE_TOP - rec.oy,
        w: rec.w, h: rec.h,
        go: armor ? urlArmor : urlNotDoppler,
      });
    }
  }

  update(_dt: number): void {
    refreshTex(this.view);
  }

  onClick(): void {
    for (const l of this.links) {
      if (hitTest(l.x, l.y, l.w, l.h)) {
        l.go();
        return;
      }
    }
  }
}
