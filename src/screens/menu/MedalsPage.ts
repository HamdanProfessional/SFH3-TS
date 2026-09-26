import { MenuPage } from "./MenuPage";
import { PAGES, pageField, pageSprite, refreshTex, type PageTextSpec } from "./pageArt";
import { UT } from "../../core/UT";
import { SD } from "../../state/SD";
import { achOrder, getAchievement, hasAchievement } from "../../data/StatsAchievements";

const PAGE_TOP = 64;
const BAR_MAX = 150;

export interface MedalRow {
  got: boolean;
  name: string;
  desc: string;
  caption: string;
  barW: number;
  counter: boolean;
}

export function medalRow(id: string): MedalRow {
  const ach = getAchievement(id);
  const got = hasAchievement(id);
  const num = SD.achOb[id] ?? 0;
  const caption = ach.progress
    ? UT.replaceString(ach.progress, "@", UT.addNumCommas(num))
    : ach.unlock ? `Unlocks ${ach.unlock} mod` : "";
  const barW = ach.progress && ach.max
    ? Math.min((num / ach.max) * BAR_MAX, BAR_MAX) : 0;
  return {
    got,
    name: ach.name,
    desc: !got && ach.unlock ? "Secret Medal" : ach.desc,
    caption,
    barW,
    counter: !!ach.progress,
  };
}

export class MedalsPage extends MenuPage {
  build(_w: number, _h: number): void {
    const M = PAGES.medals;
    achOrder.forEach((id, i) => {
      const pos = M.tiles[`ach${i}`];
      if (!pos) return;
      const x = pos.x;
      const y = pos.y - PAGE_TOP;
      const ach = getAchievement(id);
      const row = medalRow(id);

      this.view.addChild(pageSprite(M.tile[row.got ? "earned" : "locked"], x, y));

      const f = M.fields;
      const icon = M.icon[ach.sprite];
      if (icon && f.icon) {
        this.view.addChild(pageSprite(icon, x + f.icon.x, y + f.icon.y));
      }

      this.text(f.txt_name, x, y, row.name);
      this.text(f.txt_desc, x, y, row.desc);
      if (row.caption) this.text(f.txt_unlock, x, y, row.caption);

      if (row.counter && f.mc_backbar && f.mc_bar) {
        const back = pageSprite(M.bar, x + f.mc_backbar.x, y + f.mc_backbar.y);
        back.width = M.bar.w * (f.mc_backbar.sx ?? 1);
        back.height = M.bar.h * (f.mc_backbar.sy ?? 1);
        this.view.addChild(back);

        const bar = pageSprite(M.bar, x + f.mc_bar.x, y + f.mc_bar.y);
        bar.width = row.barW;
        bar.height = M.bar.h * (f.mc_bar.sy ?? 1);
        this.view.addChild(bar);
      }
    });
  }

  update(): void {
    refreshTex(this.view);
  }

  private text(
    field: { x: number; y: number; spec?: PageTextSpec } | undefined,
    x: number, y: number, value: string,
  ): void {
    if (!field?.spec) return;
    this.view.addChild(pageField(field.spec, { x: x + field.x, y: y + field.y }, value));
  }
}


