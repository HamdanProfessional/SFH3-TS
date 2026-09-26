import { MenuPage } from "./MenuPage";
import { COLOR, label, panel } from "../../ui/kit";

export interface StubSpec {
  readonly title: string;
  readonly summary: string;
  readonly blockedOn: string;
  readonly source: string;
}

export class StubPage extends MenuPage {
  constructor(host: ConstructorParameters<typeof MenuPage>[0], private spec: StubSpec) {
    super(host);
  }

  build(w: number, h: number): void {
    const pw = Math.min(560, w - 40);
    const px = (w - pw) / 2;
    const py = Math.max(20, h / 2 - 110);

    this.view.addChild(panel(px, py, pw, 200));
    this.view.addChild(label(this.spec.title, px + 20, py + 22, {
      fontSize: 20, fontWeight: "bold",
    }));
    this.view.addChild(label("NOT BUILT YET", px + 20, py + 50, {
      fontSize: 10, fill: COLOR.active,
    }));

    this.view.addChild(label(this.spec.summary, px + 20, py + 76, {
      fontSize: 12, fill: COLOR.text,
      wordWrap: true, wordWrapWidth: pw - 40,
    }));

    this.view.addChild(label(`Blocked on:  ${this.spec.blockedOn}`, px + 20, py + 142, {
      fontSize: 11, fill: COLOR.dim,
    }));
    this.view.addChild(label(`Source:  ${this.spec.source}`, px + 20, py + 160, {
      fontSize: 11, fill: COLOR.dim,
    }));
  }
}

export const STUBS: Readonly<Record<string, StubSpec>> = {};

export const UNKNOWN_FRAME: StubSpec = {
  title: "Unknown screen",
  summary:
    "Navigation reached a frame name with no page behind it. The original had "
    + "75 labelled frames; this port builds the ones that are reachable.",
  blockedOn: "nothing — this is a wiring bug, not a missing subsystem",
  source: "MenuScreen.makePage",
};
