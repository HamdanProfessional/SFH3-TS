import { Container, Graphics, type Text } from "pixi.js";
import * as Config from "../core/Config";
import type { ScoreRow } from "../game/MatchSettings";
import type { PlayerView } from "../net/protocol";
import { BOLD, CAPS, SFH, sText } from "../screens/menu/sfhStyle";

const W = 560;
const ROW = 22;
const COL = { name: 18, score: 330, kills: 390, deaths: 444, ping: 500 };

export class TabBoard {
  readonly root = new Container();
  private readonly bg = new Graphics();
  private readonly body = new Container();
  private last = "";

  constructor() {
    this.root.visible = false;
    this.root.addChild(this.bg, this.body);
  }

  update(rows: readonly ScoreRow[], players: readonly PlayerView[] | null): void {
    const byName = new Map<string, PlayerView>();
    for (const p of players ?? []) if (!p.spec) byName.set(p.name, p);
    const lines = rows.filter((r) => r.frame !== "top").map((r) => {
      const p = r.text ? undefined : byName.get(r.name);
      return {
        head: !!r.text,
        team: r.frame.startsWith("team1") ? 1 : r.frame.startsWith("team2") ? 2 : 0,
        name: r.text || (p?.clan ? `[${p.clan}] ${r.name}` : r.name),
        human: r.frame.endsWith("_player"),
        score: r.score,
        kills: r.kills,
        deaths: r.deaths,
        ping: r.text || !players ? "" : p ? (p.away ? "AWAY" : String(p.ping)) : "BOT",
        dead: r.status === "dm",
      };
    });
    const watchers = (players ?? []).filter((p) => p.spec).map((p) => p.name);
    const key = JSON.stringify([lines, watchers]);
    if (key === this.last) return;
    this.last = key;

    this.body.removeChildren().forEach((c) => c.destroy());
    const h = 46 + lines.length * ROW + (watchers.length ? 26 : 0) + 10;
    this.bg.clear()
      .rect(0, 0, W, h).fill({ color: 0x000000, alpha: 0.78 })
      .rect(0, 0, W, h).stroke({ color: SFH.cyan, width: 1, alpha: 0.6 });
    this.root.position.set(Math.round((Config.GAME_WIDTH - W) / 2),
      Math.round(Math.max(20, (Config.GAME_HEIGHT - h) / 2 - 20)));

    const put = (t: Text): Text => { this.body.addChild(t); return t; };
    const heads: [keyof typeof COL, string][] = [
      ["name", "PLAYER"], ["score", "SCORE"], ["kills", "K"], ["deaths", "D"],
    ];
    if (players) heads.push(["ping", "PING"]);
    for (const [c, s] of heads) put(sText(s, COL[c], 14, 10, SFH.grey, CAPS));

    let y = 38;
    for (const l of lines) {
      if (l.head) {
        const tint = l.team === 1 ? SFH.team1 : SFH.team2;
        this.body.addChild(new Graphics().rect(8, y, W - 16, ROW - 2).fill({ color: tint, alpha: 0.18 }));
        put(sText(l.name.toUpperCase(), COL.name, y + 3, 11, tint, CAPS));
        put(sText(l.score, COL.score, y + 3, 11, tint, BOLD));
      } else {
        const fill = l.dead ? SFH.dim : l.human ? SFH.white : SFH.grey;
        if (l.human && !players) {
          this.body.addChild(new Graphics().rect(8, y, W - 16, ROW - 2).fill({ color: SFH.gold, alpha: 0.08 }));
        }
        put(sText(l.name, COL.name + (l.team ? 10 : 0), y + 3, 12, fill));
        put(sText(l.score, COL.score, y + 3, 12, fill, BOLD));
        put(sText(l.kills, COL.kills, y + 3, 12, fill));
        put(sText(l.deaths, COL.deaths, y + 3, 12, fill));
        if (l.ping) {
          const n = Number(l.ping);
          const tint = !Number.isFinite(n) ? SFH.dim : n < 80 ? SFH.green : n < 160 ? SFH.gold : SFH.red;
          put(sText(l.ping, COL.ping, y + 3, 12, tint));
        }
      }
      y += ROW;
    }
    if (watchers.length) {
      put(sText(`WATCHING: ${watchers.join(", ")}`, COL.name, y + 8, 10, SFH.grey, CAPS));
    }
  }
}
