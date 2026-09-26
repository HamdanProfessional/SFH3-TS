import rig from "../assets/menuAnim.json";

interface MenuAnimRec {
  total: number;
  labels: Record<string, number>;
  scripts: Record<string, string>;
}

const R = rig as unknown as MenuAnimRec;

export class MenuClip {
  frame = 1;
  playing = false;
  label = "";

  gotoAndPlay(label: string): void {
    const first = R.labels[label];
    this.label = label;
    if (first === undefined) return;
    if (this.frame === first) {
      this.playing = true;
      return;
    }
    this.frame = first;
    this.playing = true;
    this.runScript();
  }

  tick(): void {
    if (!this.playing) return;
    this.frame = this.frame >= R.total ? 1 : this.frame + 1;
    this.runScript();
  }

  private runScript(): void {
    const to = R.scripts[String(this.frame)];
    if (to) this.gotoAndPlay(to);
  }
}
