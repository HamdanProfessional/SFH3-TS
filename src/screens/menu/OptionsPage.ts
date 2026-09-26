import { Container } from "pixi.js";
import { MenuPage } from "./MenuPage";
import { ArtButton, fieldText, itemOf } from "../../ui/art";
import { Button, focusable, hitTest } from "../../ui/kit";
import { ControlsPanel } from "../../ui/ControlsPanel";
import { TouchControls } from "../../ui/TouchControls";
import { SD, type Options } from "../../state/SD";
import { Quality } from "../../state/Quality";
import { SH } from "../../audio/SH";

const PAGE_TOP = 64;

export interface OptionSetting {
  readonly key: string;
  readonly field: keyof Options;
  readonly choices?: readonly string[];
}

export const OPTION_SETTINGS: readonly OptionSetting[] = [
  { key: "qual", field: "graphQual", choices: ["Low", "Medium", "High"] },
  { key: "eff", field: "graphPart", choices: ["Low", "Medium", "High"] },
  { key: "glow", field: "graphLights" },
  { key: "music", field: "music" },
  { key: "sound", field: "sound" },
  { key: "voice", field: "voices" },
  { key: "shake", field: "screenShake" },
  { key: "bloody", field: "screenBlood" },
  { key: "gore", field: "blood", choices: ["Low", "Medium", "High"] },
  { key: "right", field: "rightclick", choices: ["Reload", "Killstreak", "Swap Gun"] },
];

export function optionLabel(setting: OptionSetting): string {
  const v = SD.options[setting.field] as number | boolean;
  if (setting.choices) return setting.choices[v as number] ?? "";
  return v ? "On" : "Off";
}

export function cycleOption(setting: OptionSetting): void {
  const o = SD.options as unknown as Record<string, number | boolean>;
  if (setting.choices) {
    o[setting.field] = ((o[setting.field] as number) + 1) % setting.choices.length;
  } else {
    o[setting.field] = !(o[setting.field] as boolean);
  }
}

export class OptionsPage extends MenuPage {
  protected readonly frame: string = "options";
  protected back: ArtButton | null = null;
  private toggles: { setting: OptionSetting; btn: ArtButton }[] = [];
  private valueTexts = new Map<string, ReturnType<typeof fieldText>>();
  private deleteBtn: ArtButton | null = null;
  private delYes: ArtButton | null = null;
  private delNo: ArtButton | null = null;
  private delTexts: ReturnType<typeof fieldText>[] = [];
  private confirming = false;
  private controlsBtn: Button | null = null;
  protected body = new Container();

  build(_w: number, _h: number): void {
    this.body.removeChildren();
    this.view.addChild(this.body);

    this.valueTexts.clear();
    const fieldOf = (name: string, value: string): void => {
      const it = itemOf(this.frame, name);
      if (!it) return;
      const t = fieldText(it.cid, this.place(it), value);
      this.valueTexts.set(name, t);
    };
    for (const s of OPTION_SETTINGS) {
      fieldOf(`txt_${s.key}`, optionLabel(s));
    }

    this.toggles = [];
    for (const s of OPTION_SETTINGS) {
      const it = itemOf(this.frame, `bt_${s.key}`);
      if (!it) continue;
      const b = new ArtButton(it.cid, it.x, it.y - PAGE_TOP, it.sx, it.sy);
      this.toggles.push({ setting: s, btn: b });
      this.body.addChild(b);
      const t = this.valueTexts.get(`txt_${s.key}`);
      if (t) this.body.addChild(t);
    }

    if (this.showBack) {
      const it = itemOf("optionsTut", "bt_back");
      if (it) {
        this.back = new ArtButton(it.cid, it.x, it.y - PAGE_TOP, it.sx, it.sy);
        this.body.addChild(this.back);
      }
    }

    const deleteCopy: Record<string, string> = {
      txt_delete: "DELETE Data", txt_deleteyes: "DELETE", txt_deleteno: "Cancel",
    };
    this.delTexts = [];
    for (const name of ["txt_delete", "txt_deleteyes", "txt_deleteno"]) {
      const it = itemOf(this.frame, name);
      if (!it) continue;
      this.delTexts.push(fieldText(it.cid, this.place(it), deleteCopy[name]));
      this.body.addChild(this.delTexts[this.delTexts.length - 1]);
    }
    this.deleteBtn = this.makeHit("bt_delete");
    this.delYes = this.makeHit("bt_deleteyes");
    this.delNo = this.makeHit("bt_deleteno");
    this.applyConfirmState();

    this.controlsBtn = new Button(TouchControls.available ? "CONTROLS: TOUCH & GAMEPAD"
      : "CONTROLS: GAMEPAD", 126, 298 - PAGE_TOP, 250, 22, 12);
    this.body.addChild(this.controlsBtn);
  }

  protected get showBack(): boolean {
    return false;
  }

  private makeHit(name: string): ArtButton | null {
    const it = itemOf(this.frame, name) ?? itemOf("optionsTut", name);
    if (!it) return null;
    const b = new ArtButton(it.cid, it.x, it.y - PAGE_TOP, it.sx, it.sy);
    this.body.addChild(b);
    return b;
  }

  private place(it: { x: number; y: number }): { x: number; y: number } {
    return { x: it.x, y: it.y - PAGE_TOP };
  }

  update(_dt: number): void {
    for (const { btn } of this.toggles) btn.setState(btn.visible && hitTest(...btn.hitBox()) ? "over" : "up");
    this.controlsBtn?.update();
    for (const b of [this.back, this.deleteBtn, this.delYes, this.delNo]) {
      if (!b?.visible) continue;
      focusable(...b.hitBox(), { back: b === (this.confirming ? this.delNo : this.back) });
    }
  }

  onClick(): void {
    if (this.controlsBtn?.activate()) {
      ControlsPanel.open();
      return;
    }
    for (const { setting, btn } of this.toggles) {
      if (!this.hit(btn)) continue;
      SH.playSound("S_Click");
      cycleOption(setting);
      this.applySideEffects();
      this.host.refresh();
      return;
    }

    if (this.back && this.hit(this.back)) {
      SH.playSound("S_Click");
      this.host.goto("missions");
      return;
    }
    if (!this.confirming && this.deleteBtn && this.hit(this.deleteBtn)) {
      SH.playSound("S_Click");
      this.confirming = true;
      this.applyConfirmState();
      return;
    }
    if (this.confirming && this.delNo && this.hit(this.delNo)) {
      SH.playSound("S_Click");
      this.confirming = false;
      this.applyConfirmState();
      return;
    }
    if (this.confirming && this.delYes && this.hit(this.delYes)) {
      SH.playSound("S_Die1");
      SD.selHero = 0;
      SD.newGame();
      SD.save();
      this.host.goto("missions");
    }
  }

  private hit(b: ArtButton): boolean {
    return b.visible && hitTest(...b.hitBox());
  }

  protected applySideEffects(): void {
    const level = (["low", "medium", "high"] as const)[SD.options.graphQual] ?? "high";
    Quality.set(level, !SD.options.graphLights, true, SD.options.graphPart);
  }

  private applyConfirmState(): void {
    const setVis = (name: string, v: boolean): void => {
      const idx = name === "txt_delete" ? 0 : name === "txt_deleteyes" ? 1 : 2;
      const t = this.delTexts[idx];
      if (t) t.visible = v;
    };
    setVis("txt_delete", !this.confirming);
    setVis("txt_deleteyes", this.confirming);
    setVis("txt_deleteno", this.confirming);
    if (this.deleteBtn) this.deleteBtn.visible = !this.confirming;
    if (this.delYes) this.delYes.visible = this.confirming;
    if (this.delNo) this.delNo.visible = this.confirming;
  }

  layout(_w: number, _h: number): void {}
}
