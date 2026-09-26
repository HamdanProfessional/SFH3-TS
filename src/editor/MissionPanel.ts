import {
  MAX_BRIEF, MAX_NAME, MAX_PROMPT, MISSION_MAX_ALLIES, MISSION_MAX_ENEMIES, MISSION_MAX_LVL,
  MISSION_MAX_ROWS, MISSION_MAX_SCORE, MISSION_MODES, MISSION_ROSTER, MISSION_RULES, MISSION_WINS,
  cleanText, isDev, type CustomMap, type EdMission, type EdMissionUnit, type MissionText,
} from "./format";
import type { BuildIssue, NavGraph } from "./build";
import {
  CLASS_LABELS, DEV_PHASE_SCORES, MODE_LABELS, RULE_LABELS, WIN_LABELS, checkMission, clock,
  defaultMission, missionTitle, missionUnit, type MissionResult,
} from "./mission";
import { BTN, BTN_GO, HEAD, HINT, INPUT, button, el, row, select } from "./dom";
import { getGameMode } from "../game/MatchSettings";

export interface MissionPanelHost {
  map(): CustomMap;
  changed(): void;
  play(): void;
}

const TIMES = [0, 60, 120, 180, 300, 480, 600, 900, 1200, 1800] as const;
const STAT_MODS = [0, 0.2, 0.4, 0.5, 1, 1.5, 2, 3] as const;
const SCALES = [-0.3, 0, 0.25, 0.5, 0.75, 1] as const;

const SMALL = INPUT + "width:auto;flex:1;min-width:0;padding:3px 4px;font-size:11px;";
const TITLE = "font-family:Xoireqe,QTypeSquare-Bold,Verdana,sans-serif;text-transform:uppercase;"
  + "letter-spacing:1px;";
const LABEL = "font-size:11px;color:#b4b0b6;margin-top:6px;";

function range(lo: number, hi: number): [string, string][] {
  const out: [string, string][] = [];
  for (let i = lo; i <= hi; i++) out.push([String(i), String(i)]);
  return out;
}

function pct(v: number): string {
  return `+${Math.round(v * 100)}%`;
}

function issueList(box: HTMLElement, list: readonly BuildIssue[]): void {
  box.innerHTML = "";
  for (const i of list) {
    box.appendChild(el("div", `color:${i.level === "error" ? "#ff6666" : "#ffcc33"};`,
      `${i.level === "error" ? "✖" : "!"} ${i.text}`));
  }
  if (!list.length) box.appendChild(el("div", "color:#66dd88;", "✔ Ready to play"));
}

export class MissionPanel {
  readonly root = el("div", "display:none;");
  private readonly body = el("div");
  private readonly enable = el("input");
  private readonly issues = el("div", "font-size:11px;line-height:1.4;margin-top:4px;");
  private stash: EdMission | null = null;

  constructor(private readonly host: MissionPanelHost) {
    this.enable.type = "checkbox";
    this.enable.addEventListener("change", () => {
      const m = this.host.map();
      if (this.enable.checked) {
        m.mission = this.stash ?? defaultMission();
      } else {
        this.stash = m.mission ?? null;
        m.mission = null;
      }
      this.render();
      this.host.changed();
    });
    const lab = el("label", "display:block;margin-top:10px;cursor:pointer;");
    lab.append(this.enable, document.createTextNode(" This map has a mission"));
    this.root.append(
      el("div", "font-size:11px;color:#b4b0b6;line-height:1.35;margin-top:8px;",
        "A single-player mission on this map: your heroes against a roster you set, "
        + "with its own goal and lines. It is saved and shared with the map. Missions "
        + "pay nothing and never count towards the campaign."),
      lab, this.body,
    );
  }

  private get mis(): EdMission | null {
    return this.host.map().mission ?? null;
  }

  sync(): void {
    this.stash = null;
    this.render();
  }

  refresh(nav: NavGraph): void {
    const mis = this.mis;
    if (!mis) return;
    issueList(this.issues, checkMission(this.host.map(), mis, nav));
  }

  private edit(structural = false): void {
    if (structural) this.render();
    this.host.changed();
  }

  private render(): void {
    const mis = this.mis;
    this.enable.checked = !!mis;
    this.body.innerHTML = "";
    if (!mis) return;
    const m = this.host.map();
    const b = this.body;

    b.appendChild(this.head("Mission"));
    const title = el("input", INPUT);
    title.maxLength = MAX_NAME;
    title.placeholder = m.name;
    title.value = mis.title;
    title.addEventListener("input", () => { mis.title = cleanText(title.value, MAX_NAME); this.edit(); });
    b.appendChild(title);

    b.appendChild(this.head("Goal"));
    const mode = select(el("select", INPUT), MISSION_MODES.map((k) => [k, MODE_LABELS[k] ?? k]),
      mis.mode, (v) => {
        mis.mode = v as EdMission["mode"];
        mis.score = Math.min(MISSION_MAX_SCORE, getGameMode(mis.mode).startscore);
        this.edit(true);
      });
    const win = select(el("select", INPUT + "margin-top:4px;"),
      MISSION_WINS.map((k) => [k, WIN_LABELS[k]]), mis.win, (v) => {
        mis.win = v as EdMission["win"];
        this.edit(true);
      });
    b.append(mode, win);

    const gm = getGameMode(mis.mode);
    const scoreLab = mis.win === "score"
      ? `${gm.scoretype.toLowerCase()} to win`
      : `enemy ${gm.scoretype.toLowerCase()} that lose the mission`;
    const score = el("input", INPUT + "width:70px;");
    score.type = "number";
    score.min = "1";
    score.max = String(MISSION_MAX_SCORE);
    score.value = String(mis.score);
    score.addEventListener("change", () => {
      const n = Math.round(Number(score.value));
      mis.score = Number.isFinite(n) ? Math.max(1, Math.min(MISSION_MAX_SCORE, n)) : mis.score;
      score.value = String(mis.score);
      this.edit();
    });
    const sr = row(score, el("span", "font-size:11px;color:#b4b0b6;align-self:center;", scoreLab));
    sr.style.flexWrap = "nowrap";
    b.appendChild(sr);

    const time = select(el("select", INPUT + "margin-top:4px;"),
      TIMES.map((t) => [String(t), t ? `Time limit ${clock(t)}` : "No time limit"]),
      String(TIMES.includes(mis.time as typeof TIMES[number]) ? mis.time : 0), (v) => {
        mis.time = Number(v);
        this.edit();
      });
    if (!TIMES.includes(mis.time as typeof TIMES[number])) {
      const o = el("option", "", `Time limit ${clock(mis.time)}`);
      o.value = String(mis.time);
      time.appendChild(o);
      time.value = String(mis.time);
    }
    const squad = select(el("select", INPUT + "margin-top:4px;"),
      [1, 2, 3, 4, 5].map((n) => [String(n), `Squad: ${n} hero${n > 1 ? "es" : ""}`]),
      String(mis.squad), (v) => { mis.squad = Number(v); this.edit(); });
    const rule = select(el("select", INPUT + "margin-top:4px;"),
      MISSION_RULES.map((k) => [k, `Rule: ${RULE_LABELS[k]}`]), mis.rule, (v) => {
        mis.rule = v as EdMission["rule"];
        this.edit();
      });
    b.append(time, squad, rule);
    b.appendChild(el("div", HINT, mis.win === "score"
      ? "The mode's own win: the first side to the score. A time limit loses when it runs out."
      : mis.win === "survive"
        ? "Hold out until the clock runs out. The enemy reaching the score still wins."
        : "The enemy reaching the score still wins. Lives: deaths before a unit stays down."));

    b.appendChild(this.head("Roster"));
    mis.units.forEach((u, i) => b.appendChild(this.unitRow(mis, u, i)));
    const enemies = mis.units.filter((u) => !u.ally).reduce((n, u) => n + u.count, 0);
    const allies = mis.units.filter((u) => u.ally).reduce((n, u) => n + u.count, 0);
    const full = mis.units.length >= MISSION_MAX_ROWS;
    const addE = button("+ Enemy", () => { mis.units.push(missionUnit()); this.fitCounts(mis); this.edit(true); });
    const addA = button("+ Ally", () => { mis.units.push(missionUnit(true)); this.fitCounts(mis); this.edit(true); },
      "Bots on your team (team modes only)");
    addE.disabled = full || enemies >= MISSION_MAX_ENEMIES;
    addA.disabled = full || allies >= MISSION_MAX_ALLIES || !gm.teams;
    b.appendChild(row(addE, addA));
    b.appendChild(el("div", HINT,
      `${enemies}/${MISSION_MAX_ENEMIES} enemies, ${allies}/${MISSION_MAX_ALLIES} allies.`));
    if (mis.devPhases || mis.units.some((x) => isDev(x.cls))) {
      const on = el("input");
      on.type = "checkbox";
      on.checked = mis.devPhases;
      on.addEventListener("change", () => { mis.devPhases = on.checked; this.edit(); });
      const lab = el("label", "display:block;margin-top:6px;font-size:11px;cursor:pointer;");
      lab.append(on, document.createTextNode(" Developer boss phases"));
      b.appendChild(lab);
      b.appendChild(el("div", HINT, `The last campaign mission's fight: as your side reaches `
        + `${DEV_PHASE_SCORES.join(", ")} points, Mike and Justin switch to reflect, stealth, `
        + "healing, wallhack, their true forms and double weapons, each with a full heal."));
    }

    b.appendChild(this.head("Lines"));
    b.appendChild(this.textField(mis.text, "brief", "Briefing (on the mission card)", MAX_BRIEF, true));
    b.appendChild(this.textField(mis.text, "start", "Said at the start", MAX_PROMPT));
    b.appendChild(this.textField(mis.text, "half", "Said halfway to the goal", MAX_PROMPT));
    b.appendChild(this.textField(mis.text, "win", "On victory", MAX_PROMPT));
    b.appendChild(this.textField(mis.text, "lose", "On defeat", MAX_PROMPT));
    b.appendChild(el("div", HINT, "Lines are spoken by the boss if there is one, else by your hero."));

    const go = button("▶  PLAY MISSION", () => this.host.play(), "Play this mission");
    go.style.cssText = BTN_GO;
    b.append(go, this.issues);
  }

  private head(text: string): HTMLDivElement {
    return el("div", HEAD + "font-size:12px;margin:10px 0 4px;", text);
  }

  private textField(t: MissionText, key: keyof MissionText, label: string, max: number,
                    area = false): HTMLDivElement {
    const d = el("div");
    d.appendChild(el("div", LABEL, label));
    const f = area ? el("textarea", INPUT + "height:54px;resize:vertical;") : el("input", INPUT);
    f.maxLength = max;
    f.value = t[key];
    f.addEventListener("input", () => { t[key] = cleanText(f.value, max); this.edit(); });
    d.appendChild(f);
    return d;
  }

  private fitCounts(mis: EdMission): void {
    for (const ally of [false, true]) {
      const cap = ally ? MISSION_MAX_ALLIES : MISSION_MAX_ENEMIES;
      let total = 0;
      for (const u of mis.units) if (u.ally === ally) total += u.count;
      for (let i = mis.units.length - 1; i >= 0 && total > cap; i--) {
        const u = mis.units[i];
        if (u.ally !== ally) continue;
        const cut = Math.min(total - cap, u.count - 1);
        u.count -= cut;
        total -= cut;
        if (total > cap && u.count === 1) {
          mis.units.splice(i, 1);
          total -= 1;
        }
      }
    }
  }

  private unitRow(mis: EdMission, u: EdMissionUnit, i: number): HTMLDivElement {
    const card = el("div", "margin-top:4px;padding:4px;background:rgba(0,0,0,.6);border-left:3px solid "
      + (u.boss ? "#ffcc00" : "#7e7c80") + ";");
    const side = el("span", `font-size:11px;align-self:center;min-width:40px;color:${
      u.ally ? "#4aa3ff" : "#ff5a4a"};`, u.boss ? "BOSS" : u.ally ? "Ally" : "Enemy");
    const cls = select(el("select", SMALL), MISSION_ROSTER.map((c) => [c, CLASS_LABELS[c] ?? c]),
      u.cls, (v) => {
        u.cls = v;
        if (isDev(v)) {
          u.count = 1;
          u.name = "";
          if (!u.statMod) u.statMod = 1;
        }
        this.edit(true);
      });
    for (const o of Array.from(cls.options)) {
      o.disabled = isDev(o.value) && o.value !== u.cls && mis.units.some((x) => x.cls === o.value);
    }
    const del = button("✖", () => { mis.units.splice(i, 1); this.edit(true); }, "Remove this row");
    const r1 = row(side, cls, del);
    r1.style.flexWrap = "nowrap";

    const lvl = select(el("select", SMALL), range(1, MISSION_MAX_LVL).map(([v]) => [v, `Lv ${v}`]),
      String(u.lvl), (v) => { u.lvl = Number(v); this.edit(); });
    lvl.title = "Level, exactly";
    const r2 = row(lvl);
    r2.style.flexWrap = "nowrap";
    if (!u.boss && !isDev(u.cls)) {
      const count = select(el("select", SMALL),
        range(1, u.ally ? MISSION_MAX_ALLIES : MISSION_MAX_ENEMIES).map(([v]) => [v, `x${v}`]),
        String(u.count), (v) => { u.count = Number(v); this.fitCounts(mis); this.edit(true); });
      count.title = "How many";
      r2.appendChild(count);
    }
    if (!u.ally) {
      const lives = select(el("select", SMALL), range(1, 9).map(([v]) => [v, `${v} ${v === "1" ? "life" : "lives"}`]),
        String(u.lives), (v) => { u.lives = Number(v); this.edit(); });
      lives.title = "Deaths before it stays down (Eliminate / Defeat the boss)";
      r2.appendChild(lives);
    }
    card.append(r1, r2);

    const stats = select(el("select", SMALL), STAT_MODS.map((s) => [String(s), `Stats ${pct(s)}`]),
      String(STAT_MODS.includes(u.statMod as typeof STAT_MODS[number]) ? u.statMod : 0),
      (v) => { u.statMod = Number(v); this.edit(); });
    stats.title = "Added to every stat multiplier (the campaign's Hitman has +200%)";
    const scale = select(el("select", SMALL), SCALES.map((s) => [String(s), `Size ${s >= 0 ? "+" : ""}${Math.round(s * 100)}%`]),
      String(SCALES.includes(u.scale as typeof SCALES[number]) ? u.scale : 0),
      (v) => { u.scale = Number(v); this.edit(); });
    scale.title = "Body size";
    const r3 = row(stats, scale);
    r3.style.flexWrap = "nowrap";
    card.appendChild(r3);

    if (!u.ally) {
      const boss = el("input");
      boss.type = "checkbox";
      boss.checked = u.boss;
      boss.addEventListener("change", () => {
        for (const o of mis.units) o.boss = false;
        u.boss = boss.checked;
        if (u.boss) u.count = 1;
        this.edit(true);
      });
      const lab = el("label", "font-size:11px;cursor:pointer;align-self:center;white-space:nowrap;");
      lab.append(boss, document.createTextNode(" Boss"));
      const r4 = row(lab);
      r4.style.flexWrap = "nowrap";
      if (u.boss && !isDev(u.cls)) {
        const name = el("input", SMALL);
        name.maxLength = 20;
        name.placeholder = "Name (random)";
        name.value = u.name;
        name.addEventListener("input", () => { u.name = cleanText(name.value, 20); this.edit(); });
        r4.appendChild(name);
      }
      card.appendChild(r4);
    }
    return card;
  }
}

export function missionSummary(mis: EdMission): string[] {
  const gm = getGameMode(mis.mode);
  const out = [`${MODE_LABELS[mis.mode] ?? mis.mode} · ${WIN_LABELS[mis.win]}`];
  const unit = gm.scoretype.toLowerCase();
  out.push(mis.win === "score"
    ? `First to ${mis.score} ${unit} wins`
    : `Lost if the enemy reaches ${mis.score} ${unit}`);
  if (mis.time) out.push(`${mis.win === "survive" ? "Survive" : "Time limit"}: ${clock(mis.time)}`);
  const squad = gm.teams ? mis.squad : 1;
  out.push(`Your squad: ${squad} hero${squad > 1 ? "es" : ""}`);
  if (mis.rule !== "none") out.push(`Special rule: ${RULE_LABELS[mis.rule]}`);
  if (mis.devPhases && mis.units.some((u) => isDev(u.cls) && (gm.teams || !u.ally))) {
    out.push("The developers fight in phases, as in the last campaign mission");
  }
  for (const u of mis.units) {
    if (u.ally && !gm.teams) continue;
    const cls = CLASS_LABELS[u.cls] ?? u.cls;
    const tough = u.statMod ? `, stats ${pct(u.statMod)}` : "";
    if (u.boss) {
      out.push(`Boss${u.name ? ` ${u.name}` : ""}: ${cls}, level ${u.lvl}`
        + `${u.lives > 1 ? `, ${u.lives} lives` : ""}${tough}`);
    } else {
      out.push(`${u.ally ? "Allies" : "Enemies"}: ${u.count} x ${cls}, level ${u.lvl}${tough}`);
    }
  }
  return out;
}

export interface CardOptions {
  author: string;
  result?: MissionResult;
  buttons: [string, () => void, boolean][];
}

export function missionCard(m: CustomMap, mis: EdMission, o: CardOptions): HTMLDivElement {
  const veil = el("div", "position:absolute;inset:0;z-index:2;display:flex;align-items:center;"
    + "justify-content:center;background:rgba(0,0,0,.6);");
  const box = el("div", "width:min(460px,92%);max-height:90%;overflow-y:auto;box-sizing:border-box;"
    + "background:rgba(0,0,0,.88);border-top:3px solid #7e7c80;padding:16px 18px;"
    + "font-size:12px;line-height:1.45;user-select:text;");
  const r = o.result;
  if (r) {
    box.appendChild(el("div", TITLE + `font-size:22px;color:${r.won ? "#33ff66" : "#ff4444"};`,
      r.won ? "MISSION COMPLETE" : "MISSION FAILED"));
  } else {
    box.appendChild(el("div", "font-size:11px;color:#b4b0b6;letter-spacing:1px;", "MISSION"));
  }
  box.appendChild(el("div", TITLE + "font-size:18px;color:#ffcc00;", r ? r.title : missionTitle(m, mis)));
  if (o.author) box.appendChild(el("div", "font-size:11px;color:#b4b0b6;", `by ${o.author}`));
  const para = (text: string, css = ""): void => {
    box.appendChild(el("div", "margin-top:8px;white-space:pre-wrap;" + css, text));
  };
  if (r) {
    if (r.text) para(`“${r.text}”`, "font-style:italic;");
    para(r.reason);
    para(`Time ${clock(r.secs)} · Kills ${r.kills} · Deaths ${r.deaths}`, "color:#b4b0b6;");
  } else {
    if (mis.text.brief) para(mis.text.brief);
    const list = el("div", "margin-top:8px;color:#e0dde2;");
    for (const line of missionSummary(mis)) list.appendChild(el("div", "", `• ${line}`));
    box.appendChild(list);
  }
  box.appendChild(el("div", HINT + "margin-top:10px;",
    "Custom missions pay no funds or EXP and never count towards the campaign."));
  const btns = el("div", "display:flex;gap:6px;margin-top:10px;");
  for (const [label, run, primary] of o.buttons) {
    const b = button(label, run);
    b.style.cssText = primary ? BTN_GO + "margin-top:0;flex:1;" : BTN + "flex:1;text-align:center;";
    btns.appendChild(b);
  }
  box.appendChild(btns);
  veil.appendChild(box);
  return veil;
}
