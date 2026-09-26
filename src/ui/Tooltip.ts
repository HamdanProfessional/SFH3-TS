import { Container, Graphics, Text } from "pixi.js";
import { COLOR, label, textStyle, getHitOrigin } from "./kit";
import { itemOb as INFO } from "../data/StatsInfo";
import { GAME_WIDTH, GAME_HEIGHT } from "../core/Config";

const LINE_HEIGHT = 17;
const MAX_WIDTH = 240;
const PAD = 8;

export class Tooltip extends Container {
  private bg = new Graphics();
  private titleTxt: Text;
  private descTxt: Text;
  private fade = 0;
  private shownId = "";
  private hoveredThisFrame = false;

  constructor() {
    super();
    this.addChild(this.bg);
    this.titleTxt = label("", PAD, PAD, { fontSize: 12, fontWeight: "bold", fill: COLOR.active });
    this.descTxt = new Text({
      text: "",
      style: textStyle({ fontSize: 12, fill: COLOR.text, wordWrap: true, wordWrapWidth: MAX_WIDTH }),
    });
    this.descTxt.position.set(PAD, PAD);
    this.addChild(this.titleTxt);
    this.addChild(this.descTxt);
    this.visible = false;
    this.eventMode = "none";
  }

  show(
    id: string,
    tx: number, ty: number, tw: number, th: number,
    titleOverride?: string,
    descOverride?: string,
  ): void {
    const info = INFO[id];
    if (!info) return;
    this.hoveredThisFrame = true;

    const title = titleOverride ?? info.title;
    const desc = descOverride ?? info.desc;

    const key = `${id}|${title}|${desc}`;
    if (this.shownId !== key) {
      this.shownId = key;
      this.titleTxt.text = title;
      this.titleTxt.visible = title.length > 0;
      this.descTxt.text = desc;
      this.descTxt.y = title ? PAD + LINE_HEIGHT : PAD;
      this.redraw();
    }

    const [ox, oy] = getHitOrigin();
    this.position.set(ox + tx + tw * info.x, oy + ty + th * info.y);
    this.clampToStage();
  }

  update(): void {
    if (this.hoveredThisFrame) {
      if (this.fade < 1) this.fade += 0.1;
    } else if (this.fade > -1.3) {
      this.fade -= 0.3;
    }
    this.hoveredThisFrame = false;

    this.alpha = Math.max(0, Math.min(1, this.fade));
    this.visible = this.alpha > 0;
  }

  private redraw(): void {
    const lines = this.descTxt.text ? countLines(this.descTxt) : 0;
    const bodyH = lines * LINE_HEIGHT + 6;
    const h = (this.titleTxt.visible ? LINE_HEIGHT : 0) + bodyH + PAD;
    const w = Math.max(
      this.titleTxt.visible ? this.titleTxt.width : 0,
      this.descTxt.width,
    ) + PAD * 2;

    this.bg.clear();
    this.bg.roundRect(0, 0, w, h, 3).fill({ color: 0x000000, alpha: 0.88 });
    this.bg.roundRect(0, 0, w, h, 3).stroke({ color: COLOR.panelEdge, width: 1 });
  }

  private clampToStage(): void {
    const w = this.bg.width;
    const h = this.bg.height;
    if (this.x + w > GAME_WIDTH) this.x = GAME_WIDTH - w - 4;
    if (this.y + h > GAME_HEIGHT) this.y = GAME_HEIGHT - h - 4;
    if (this.x < 4) this.x = 4;
    if (this.y < 4) this.y = 4;
  }
}

function countLines(t: Text): number {
  const lh = t.style.lineHeight || t.style.fontSize * 1.2;
  return Math.max(1, Math.round(t.height / lh));
}
