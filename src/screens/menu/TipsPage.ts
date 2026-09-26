import { MenuPage } from "./MenuPage";
import { PAGES, drawRuns, refreshTex } from "./pageArt";

const PAGE_TOP = 64;

export class TipsPage extends MenuPage {
  build(_w: number, _h: number): void {
    for (const runs of Object.values(PAGES.tips.runs ?? {})) {
      drawRuns(this.view, runs, PAGE_TOP);
    }
  }

  update(): void {
    refreshTex(this.view);
  }
}
