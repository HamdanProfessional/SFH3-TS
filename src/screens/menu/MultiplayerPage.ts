import { Graphics, type Container } from "pixi.js";
import { MenuPage } from "./MenuPage";
import type { PageHost } from "./MenuPage";
import { ScrollBox, focusable, hitTest } from "../../ui/kit";
import { SD } from "../../state/SD";
import { SH } from "../../audio/SH";
import { getMap } from "../../data/StatsMaps";
import { getGameMode } from "../../data/StatsMisc";
import * as Classes from "../../data/StatsClasses";
import * as Guns from "../../data/StatsGuns";
import { NetClient, netSession, setNetSession } from "../../net/NetClient";
import { heroToWire } from "../../net/hero";
import { loadServers, probeServer, type ServerRow } from "../../net/servers";
import {
  MAX_SQUAD, type ClanRow, type PlayerView, type ProfileReply, type RankedMe, type RankedTopReply,
  type RoomView, type ServerInfo,
} from "../../net/protocol";
import { TIER_COLOURS, rankLabel, seasonLabel } from "../../net/ranks";
import * as Acct from "../../net/account";
import { closeForm, formOpen, openForm } from "../../ui/DomForm";
import {
  BOLD, BOOK, CAPS, SFH, SfhButton, paintRow, sHeading, sInfo, sPanel, sText, sTitle,
} from "./sfhStyle";

const ROW_H = 44;
const ROW_GAP = 4;
const DIFFS = ["NORMAL", "HARD", "INSANE"];

type View = "browser" | "squad" | "clan" | "friends" | "ranked" | "profile";

const CUSTOM_MODES: [string, string][] = [["tdm", "TDM"], ["dm", "DM"], ["ctf", "CTF"], ["dom", "DOM"]];
const FRIENDS_POLL_MS = 20_000;

export class MultiplayerPage extends MenuPage {
  private static rows: ServerRow[] = [];
  private static listed = false;
  private static loading = false;
  private static status = "";
  private static handedOff = false;
  private static version = 0;
  private static view: View = "browser";
  private static pick: number[] = [];
  private static acctBusy = false;
  private static acctNote = "";
  private static fetched = false;
  private static watchOnly = false;
  private static top: ClanRow[] | null = null;
  private static rankedMe: RankedMe | null = null;
  private static rankedTop: RankedTopReply | null = null;
  private static friendsAt = 0;
  private static profileName = "";
  private static profile: ProfileReply | null = null;
  private static profileBack: View = "browser";

  private static touch(): void {
    MultiplayerPage.version++;
  }

  private seen = MultiplayerPage.version;
  private seenAcct = Acct.accountVersion();

  private box: ScrollBox | null = null;
  private boxRect = { x: 0, y: 0, w: 0, h: 0 };
  private buttons: { btn: SfhButton; go: () => void }[] = [];
  private rowHits: { top: number; h: number; row: ServerRow }[] = [];
  private rowSlabs: Graphics[] = [];
  private links: { x: number; y: number; w: number; h: number; go: () => void }[] = [];
  private rowW = 0;
  private hovered = -1;

  constructor(host: PageHost) {
    super(host);
    if (!MultiplayerPage.listed) void MultiplayerPage.refreshList();
    if (!MultiplayerPage.fetched && Acct.account()) {
      MultiplayerPage.fetched = true;
      void MultiplayerPage.acctTask(async () => {
        await Acct.refresh();
        await Acct.refreshClan().catch(() => null);
      });
    }
  }

  private static async refreshList(): Promise<void> {
    if (MultiplayerPage.loading) return;
    MultiplayerPage.loading = true;
    MultiplayerPage.listed = true;
    MultiplayerPage.status = "";
    MultiplayerPage.touch();

    const entries = await loadServers();
    MultiplayerPage.rows = entries.map((entry) => ({
      entry, info: null, ping: -1, error: "checking...",
    }));
    MultiplayerPage.touch();

    await Promise.all(entries.map(async (entry, i) => {
      MultiplayerPage.rows[i] = await probeServer(entry);
      MultiplayerPage.touch();
    }));
    MultiplayerPage.loading = false;
    if (!MultiplayerPage.rows.some((r) => r.info)) {
      MultiplayerPage.status = "Nothing answered. The servers may be offline.";
    }
    MultiplayerPage.touch();
  }

  private get client(): NetClient | null {
    return netSession();
  }

  private join(row: ServerRow, code = ""): void {
    if (!row.info || row.error) return;
    if (row.info.private && !code) {
      openForm({
        title: "Private room",
        note: "This room needs its 6-character code. Ask whoever is in it.",
        fields: [{ key: "code", label: "Room code" }],
        submit: "Join",
        onSubmit: async (v) => {
          const k = v.code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
          if (k.length !== 6) return "Codes are 6 letters and numbers";
          this.join(row, k);
          return null;
        },
      });
      return;
    }
    const hero = SD.selectedHero;
    const acct = Acct.account();
    const full = row.info.players >= row.info.maxPlayers;
    const client = new NetClient(
      row.entry.url,
      hero?.name || "Player",
      acct?.token ?? null,
      guestSquad(),
      MultiplayerPage.watchOnly || full,
      code,
    );
    const touch = MultiplayerPage.touch;
    client.on({
      onRoom: touch, onChat: touch, onEnd: touch,
      onClosed: touch, onStart: touch, onSquad: touch, onEarned: touch, onRating: touch,
    });
    MultiplayerPage.handedOff = false;
    setNetSession(client);
    client.connect();
    MultiplayerPage.touch();
  }

  private joinByName(name: string, code: string): void {
    const row = MultiplayerPage.rows.find((r) => r.info?.name === name && !r.error);
    if (!row) {
      MultiplayerPage.acctNote = `${name} is not in the server list (refresh?)`;
      MultiplayerPage.touch();
      return;
    }
    this.join(row, code);
  }

  private findRanked(): void {
    const mine = MultiplayerPage.rankedMe?.rating ?? 1000;
    const open = MultiplayerPage.rows.filter((r) => r.info && !r.error
      && r.info.kind === "ranked" && r.info.players < r.info.maxPlayers);
    if (!open.length) {
      MultiplayerPage.acctNote = "No ranked room has a free place right now.";
      MultiplayerPage.touch();
      return;
    }
    const cost = (i: ServerInfo): number =>
      i.players && i.rating !== undefined ? Math.abs(i.rating - mine) : 300;
    open.sort((a, b) => cost(a.info as ServerInfo) - cost(b.info as ServerInfo));
    this.join(open[0]);
  }

  private leave(): void {
    setNetSession(null);
    MultiplayerPage.handedOff = false;
    MultiplayerPage.touch();
  }

  build(w: number, h: number): void {
    this.buttons = [];
    this.links = [];
    this.rowHits = [];
    this.rowSlabs = [];
    this.box = null;
    this.seen = MultiplayerPage.version;
    this.seenAcct = Acct.accountVersion();

    const c = this.client;
    const signedIn = !!Acct.account();
    if (c && c.state !== "closed" && c.state !== "idle") this.buildLobby(w, h, c);
    else if (MultiplayerPage.view === "squad" && Acct.account()?.profile?.seeded) this.buildSquad(w, h);
    else if (MultiplayerPage.view === "clan" && signedIn) this.buildClan(w, h);
    else if (MultiplayerPage.view === "friends" && signedIn) this.buildFriends(w, h);
    else if (MultiplayerPage.view === "ranked" && signedIn) this.buildRanked(w, h);
    else if (MultiplayerPage.view === "profile") this.buildProfile(w, h);
    else this.buildBrowser(w, h);
  }

  private add<T extends Container>(o: T): T {
    this.view.addChild(o);
    return o;
  }

  private addButton(b: SfhButton, go: () => void): SfhButton {
    this.view.addChild(b);
    this.buttons.push({ btn: b, go });
    return b;
  }

  private setView(v: View): void {
    MultiplayerPage.view = v;
    MultiplayerPage.acctNote = "";
    MultiplayerPage.touch();
  }

  private static apiBase(): string | null {
    const row = MultiplayerPage.rows.find((r) => r.info && !r.error);
    return row ? Acct.accountBase(row.entry.url) : null;
  }

  private static async acctTask(run: () => Promise<unknown>): Promise<void> {
    MultiplayerPage.acctBusy = true;
    MultiplayerPage.acctNote = "";
    MultiplayerPage.touch();
    try {
      await run();
    } catch (e) {
      MultiplayerPage.acctNote = e instanceof Error ? e.message : "Something went wrong";
    }
    MultiplayerPage.acctBusy = false;
    MultiplayerPage.touch();
  }

  private openSignIn(create: boolean): void {
    const base = MultiplayerPage.apiBase();
    if (!base) {
      MultiplayerPage.acctNote = "No server is answering right now.";
      MultiplayerPage.touch();
      return;
    }
    const fields = [
      { key: "name", label: "Name", auto: "username" },
      {
        key: "password", label: "Password", type: "password" as const,
        auto: create ? "new-password" : "current-password",
      },
    ];
    if (create) {
      fields.push({
        key: "again", label: "Password again", type: "password" as const,
        auto: "new-password",
      });
    }
    openForm({
      title: create ? "Create an account" : "Sign in",
      note: create
        ? "3-16 letters, numbers, _ or -. At least 8 characters of password. "
          + "Your heroes level up online; the campaign save is never touched."
        : "Signed-in players earn EXP for their online heroes.",
      fields,
      submit: create ? "Create" : "Sign in",
      alt: {
        label: create ? "I already have an account" : "Create an account instead",
        run: () => this.openSignIn(!create),
      },
      onSubmit: async (v) => {
        if (create && v.password !== v.again) return "The passwords don't match";
        try {
          if (create) await Acct.register(base, v.name.trim(), v.password);
          else await Acct.signIn(base, v.name.trim(), v.password);
          await Acct.refreshClan().catch(() => null);
        } catch (e) {
          return e instanceof Error ? e.message : "Something went wrong";
        }
        MultiplayerPage.fetched = true;
        MultiplayerPage.acctNote = "";
        MultiplayerPage.touch();
        return null;
      },
    });
  }

  private goOnline(): void {
    const heroes = SD.heroes.slice(0, 15);
    if (!heroes.length) return;
    const squad = guestOrder().filter((i) => i < heroes.length);
    openForm({
      title: "Bring your heroes online?",
      note: `Copies all ${heroes.length} of your heroes to your account, once. `
        + "After this they level up online, separately: nothing online changes "
        + "the campaign, and nothing in the campaign changes them.",
      fields: [],
      submit: "Bring them online",
      onSubmit: async () => {
        try {
          await Acct.seed(heroes.map((u) => heroToWire(u)), squad);
        } catch (e) {
          return e instanceof Error ? e.message : "Something went wrong";
        }
        MultiplayerPage.touch();
        return null;
      },
    });
  }

  private buildSquad(w: number, h: number): void {
    const prof = Acct.account()?.profile;
    if (!prof) return;
    this.add(sTitle("Your online squad", 16, 2));
    this.add(sText(
      `Pick up to ${MAX_SQUAD}. The first is who you start as; `
      + "while dead, click a head to choose who comes back.",
      16, 30, 12, SFH.grey));

    const pick = MultiplayerPage.pick;
    const cols = 3;
    const cw = Math.floor((w - 48 - (cols - 1) * 8) / cols);
    const ch = 46;
    this.add(sPanel(16, 50, w - 32, h - 50 - 48));
    prof.heroes.forEach((hero, i) => {
      const x = 24 + (i % cols) * (cw + 8);
      const y = 58 + Math.floor(i / cols) * (ch + 6);
      const at = pick.indexOf(i);
      const b = new SfhButton("", x, y, cw, ch);
      b.setActive(at >= 0);
      this.addButton(b, () => {
        const k = pick.indexOf(i);
        if (k >= 0) pick.splice(k, 1);
        else if (pick.length < MAX_SQUAD) pick.push(i);
        MultiplayerPage.touch();
      });
      const cls = Classes.itemOb[String(hero.cls)]?.name ?? String(hero.cls);
      this.add(sText(String(hero.name ?? "?").toUpperCase(), x + 12, y + 7, 13, SFH.white, CAPS));
      this.add(sText(`LV ${Number(hero.level) || 1}  ${cls.toUpperCase()}`, x + 12, y + 26, 11,
        at >= 0 ? 0x000000 : SFH.grey, BOLD));
      if (at >= 0) this.add(sText(String(at + 1), x + cw - 24, y + 13, 16, 0x000000, CAPS));
    });

    const by = h - 36;
    const save = new SfhButton(MultiplayerPage.acctBusy ? "Saving" : "Save", w - 252, by, 110, 26);
    save.setEnabled(pick.length > 0 && !MultiplayerPage.acctBusy);
    this.addButton(save, () => void MultiplayerPage.acctTask(async () => {
      await Acct.setSquad([...pick]);
      MultiplayerPage.view = "browser";
    }));
    this.addButton(new SfhButton("Back", w - 126, by, 110, 26), () => this.setView("browser"));
    if (MultiplayerPage.acctNote) {
      this.add(sText(MultiplayerPage.acctNote, 16, by + 6, 12, SFH.red));
    }
  }

  private buildClan(w: number, h: number): void {
    const mine = Acct.clan();
    const me = Acct.account();
    const busy = MultiplayerPage.acctBusy;
    this.add(sTitle(mine ? `[${mine.tag}] ${mine.name}` : "Clans", 16, 2));

    const leftW = Math.floor((w - 40) * 0.54);
    const panelY = 36;
    const panelH = h - panelY - 48;
    this.add(sInfo(16, panelY, leftW, panelH));
    const lx = 28;
    const lw = leftW - 24;

    if (mine === undefined) {
      this.add(sText(busy ? "Loading your clan..." : "Could not load your clan.",
        lx, panelY + 14, 12, SFH.grey));
    } else if (!mine) {
      sHeading(this.view, "No clan yet", lx, panelY + 12, lw);
      const note = sText(
        "A clan is a tag worn in every lobby and in chat, a leaderboard of its "
        + "members' combined wins, and a team that fights as one: clanmates left "
        + "on AUTO are put on the same side.\n\n"
        + "Make one and hand out its invite code, or join with somebody's code.",
        lx, panelY + 40, 12, SFH.white);
      note.style.wordWrap = true;
      note.style.wordWrapWidth = lw;
      note.style.lineHeight = 17;
      this.add(note);
      const make = this.addButton(new SfhButton("Create clan", lx, panelY + 170, 150, 28),
        () => this.clanForm(true));
      const join = this.addButton(new SfhButton("Join with code", lx + 160, panelY + 170, 150, 28),
        () => this.clanForm(false));
      make.setEnabled(!busy);
      join.setEnabled(!busy);
    } else {
      const owner = mine.owner === me?.name;
      const t = mine.totals;
      sHeading(this.view, `Members ${mine.members.length}/20`, lx, panelY + 10, lw);
      this.add(sText(`${t.wins} WINS   ${t.kills} KILLS   ${t.rounds} ROUNDS`,
        lx + lw, panelY + 12, 10, SFH.gold, BOLD)).anchor.set(1, 0);
      const cols: [string, number][] = [["NAME", 0], ["WINS", lw - 150], ["K/D", lw - 96]];
      for (const [n, x] of cols) this.add(sText(n, lx + x, panelY + 34, 9, SFH.dim, CAPS));
      const rowsFit = Math.floor((panelH - 150) / 18);
      mine.members.slice(0, rowsFit).forEach((m, i) => {
        const y = panelY + 50 + i * 18;
        const self = m.name === me?.name;
        this.add(sText(m.name + (m.owner ? "  *" : ""), lx, y, 12,
          self ? SFH.orange : SFH.white, self ? BOLD : BOOK));
        this.add(sText(String(m.wins), lx + lw - 150, y, 12, SFH.grey));
        this.add(sText(`${m.kills}/${m.deaths}`, lx + lw - 96, y, 12, SFH.grey));
        if (owner && !self) {
          this.addButton(new SfhButton("Kick", lx + lw - 40, y - 1, 40, 16, 9),
            () => void MultiplayerPage.acctTask(() => Acct.kickFromClan(m.name)));
        }
      });
      if (mine.members.length > rowsFit) {
        this.add(sText(`+${mine.members.length - rowsFit} more`, lx, panelY + 50 + rowsFit * 18,
          11, SFH.dim));
      }

      const iy = panelY + panelH - 92;
      sHeading(this.view, "Invite code", lx, iy, lw);
      this.add(sText(mine.code.replace(/(.{4})/, "$1 "), lx, iy + 26, 20, SFH.cyan, CAPS));
      this.add(sText("Anybody with this code can join.", lx, iy + 52, 11, SFH.grey));
      if (owner) {
        this.addButton(new SfhButton("New code", lx + lw - 110, iy + 26, 110, 24),
          () => void MultiplayerPage.acctTask(() => Acct.newClanCode()));
      }
      this.addButton(new SfhButton(owner && mine.members.length === 1 ? "Disband" : "Leave clan",
        lx + lw - 110, iy + 58 - 4, 110, 24), () => this.confirmLeave(owner, mine.members.length));
    }

    const rx = 16 + leftW + 8;
    const rw = w - 16 - rx;
    this.add(sPanel(rx, panelY, rw, panelH));
    sHeading(this.view, "Top clans", rx + 12, panelY + 10, rw - 24);
    const top = MultiplayerPage.top;
    if (!top) {
      this.add(sText("Loading...", rx + 12, panelY + 40, 12, SFH.grey));
    } else if (!top.length) {
      this.add(sText("No clans yet. Be the first.", rx + 12, panelY + 40, 12, SFH.grey));
    } else {
      this.add(sText("WINS", rx + rw - 110, panelY + 34, 9, SFH.dim, CAPS));
      this.add(sText("KILLS", rx + rw - 60, panelY + 34, 9, SFH.dim, CAPS));
      const fit = Math.floor((panelH - 60) / 20);
      top.slice(0, fit).forEach((r, i) => {
        const y = panelY + 50 + i * 20;
        const ours = mine && r.tag === mine.tag;
        this.add(sText(String(i + 1), rx + 12, y, 12, i < 3 ? SFH.gold : SFH.grey, CAPS));
        this.add(sText(`[${r.tag}]`, rx + 34, y, 12, ours ? SFH.orange : SFH.gold, BOLD));
        this.add(sText(clip(r.name, 16), rx + 84, y, 12, SFH.white));
        this.add(sText(String(r.wins), rx + rw - 110, y, 12, SFH.white));
        this.add(sText(String(r.kills), rx + rw - 60, y, 12, SFH.grey));
      });
    }

    const by = h - 36;
    this.addButton(new SfhButton("Back", w - 126, by, 110, 26), () => this.setView("browser"));
    if (MultiplayerPage.acctNote) {
      this.add(sText(MultiplayerPage.acctNote, 16, by + 6, 12, SFH.red));
    }
  }

  private openClan(): void {
    MultiplayerPage.top = null;
    this.setView("clan");
    void MultiplayerPage.acctTask(async () => {
      await Acct.refreshClan();
      const base = MultiplayerPage.apiBase() ?? Acct.account()?.base;
      MultiplayerPage.top = base ? await Acct.topClans(base) : [];
    });
  }

  private clanForm(create: boolean): void {
    openForm(create
      ? {
        title: "Create a clan",
        note: "A tag of 2-4 letters or numbers, shown as [TAG] beside every "
          + "member's name, and a name of 3-24 characters.",
        fields: [
          { key: "tag", label: "Tag" },
          { key: "name", label: "Clan name" },
        ],
        submit: "Create",
        onSubmit: async (v) => this.clanSubmit(() => Acct.createClan(v.tag, v.name)),
      }
      : {
        title: "Join a clan",
        note: "Ask a member for the clan's 8-character invite code.",
        fields: [{ key: "code", label: "Invite code" }],
        submit: "Join",
        onSubmit: async (v) => this.clanSubmit(() => Acct.joinClan(v.code)),
      });
  }

  private async clanSubmit(run: () => Promise<unknown>): Promise<string | null> {
    try {
      await run();
    } catch (e) {
      return e instanceof Error ? e.message : "Something went wrong";
    }
    this.refreshTop();
    return null;
  }

  private confirmLeave(owner: boolean, count: number): void {
    openForm({
      title: count === 1 ? "Disband the clan?" : "Leave the clan?",
      note: count === 1
        ? "You are its last member, so the clan and its tag go with you."
        : owner
          ? "Ownership passes to whoever has been in the clan longest."
          : "You can come back with an invite code.",
      fields: [],
      submit: count === 1 ? "Disband" : "Leave",
      onSubmit: async () => this.clanSubmit(() => Acct.leaveClan()),
    });
  }

  private refreshTop(): void {
    const base = MultiplayerPage.apiBase() ?? Acct.account()?.base;
    if (!base) return;
    void Acct.topClans(base).then((t) => {
      MultiplayerPage.top = t;
      MultiplayerPage.touch();
    }, () => {});
  }

  private buildFriends(w: number, h: number): void {
    const f = Acct.friends();
    const busy = MultiplayerPage.acctBusy;
    this.add(sTitle("Friends", 16, 2));
    this.addButton(new SfhButton("Add friend", w - 252, 4, 110, 24), () => this.friendForm())
      .setEnabled(!busy);
    this.addButton(new SfhButton("Refresh", w - 126, 4, 110, 24), () => this.pollFriends(true))
      .setEnabled(!busy);

    const panelY = 36;
    const panelH = h - panelY - 48;
    const leftW = Math.floor((w - 40) * 0.62);
    this.add(sPanel(16, panelY, leftW, panelH));
    const lx = 28;
    const lw = leftW - 24;
    if (!f) {
      this.add(sText(busy ? "Loading..." : "Could not load your friends.", lx, panelY + 14, 12, SFH.grey));
    } else {
      const on = f.friends.filter((x) => x.online).length;
      sHeading(this.view, `${f.friends.length} friends, ${on} online`, lx, panelY + 10, lw);
      if (!f.friends.length) {
        const t = sText("Nobody yet. ADD FRIEND sends a request by account name; "
          + "once they accept, you see when they are online and which room they "
          + "are in, and can join them.", lx, panelY + 40, 12, SFH.grey);
        t.style.wordWrap = true;
        t.style.wordWrapWidth = lw;
        this.add(t);
      }
      const rowH = 24;
      const fit = Math.floor((panelH - 44) / rowH);
      f.friends.slice(0, fit).forEach((fr, i) => {
        const y = panelY + 38 + i * rowH;
        const dot = new Graphics().circle(lx + 5, y + 8, 4).fill(fr.online ? SFH.green : 0x555555);
        this.add(dot);
        this.nameLink(this.add(sText(fr.name, lx + 16, y, 13, fr.online ? SFH.white : SFH.dim, BOLD)),
          fr.name);
        const where = !fr.online ? "offline" : fr.room ? `in ${fr.room}` : "online, in the menus";
        this.add(sText(clip(where, 30) + (fr.code ? "  (private)" : ""), lx + 150, y + 2, 11,
          fr.room ? SFH.cyan : SFH.grey));
        if (fr.online && fr.room) {
          this.addButton(new SfhButton("Join", lx + lw - 108, y - 2, 56, 20, 10),
            () => this.joinByName(fr.room, fr.code));
        }
        this.addButton(new SfhButton("X", lx + lw - 46, y - 2, 46, 20, 10),
          () => void MultiplayerPage.acctTask(() => Acct.removeFriend(fr.name)));
      });
    }

    const rx = 16 + leftW + 8;
    const rw = w - 16 - rx;
    this.add(sInfo(rx, panelY, rw, panelH));
    sHeading(this.view, "Requests", rx + 12, panelY + 10, rw - 24);
    let y = panelY + 38;
    const incoming = f?.incoming ?? [];
    const outgoing = f?.outgoing ?? [];
    if (!incoming.length && !outgoing.length) {
      this.add(sText("None waiting.", rx + 12, y, 12, SFH.grey));
    }
    for (const n of incoming.slice(0, 8)) {
      this.add(sText(clip(n, 14), rx + 12, y + 2, 12, SFH.white, BOLD));
      this.addButton(new SfhButton("OK", rx + rw - 100, y, 42, 20, 10),
        () => void MultiplayerPage.acctTask(() => Acct.acceptFriend(n)));
      this.addButton(new SfhButton("No", rx + rw - 54, y, 42, 20, 10),
        () => void MultiplayerPage.acctTask(() => Acct.declineFriend(n)));
      y += 24;
    }
    if (outgoing.length) {
      y += 6;
      this.add(sText("SENT", rx + 12, y, 9, SFH.dim, CAPS));
      y += 16;
      for (const n of outgoing.slice(0, 8)) {
        this.add(sText(clip(n, 14), rx + 12, y + 2, 12, SFH.grey));
        this.addButton(new SfhButton("Cancel", rx + rw - 76, y, 64, 20, 10),
          () => void MultiplayerPage.acctTask(() => Acct.declineFriend(n)));
        y += 24;
      }
    }

    const by = h - 36;
    this.addButton(new SfhButton("Back", w - 126, by, 110, 26), () => this.setView("browser"));
    if (MultiplayerPage.acctNote) this.add(sText(MultiplayerPage.acctNote, 16, by + 6, 12, SFH.red));
  }

  private openFriends(): void {
    this.setView("friends");
    this.pollFriends(true);
  }

  private pollFriends(now = false): void {
    if (!Acct.account()) return;
    const t = Date.now();
    if (!now && t - MultiplayerPage.friendsAt < FRIENDS_POLL_MS) return;
    MultiplayerPage.friendsAt = t;
    if (!now) { void Acct.refreshFriends().catch(() => null); return; }
    void MultiplayerPage.acctTask(() => Acct.refreshFriends());
  }

  private friendForm(): void {
    openForm({
      title: "Add a friend",
      note: "Their account name. They get a request; once they accept, you see each other online.",
      fields: [{ key: "name", label: "Account name", auto: "off" }],
      submit: "Send request",
      onSubmit: async (v) => {
        try {
          await Acct.addFriend(v.name.trim());
        } catch (e) {
          return e instanceof Error ? e.message : "Something went wrong";
        }
        MultiplayerPage.touch();
        return null;
      },
    });
  }

  private buildRanked(w: number, h: number): void {
    const me = MultiplayerPage.rankedMe;
    const top = MultiplayerPage.rankedTop;
    const busy = MultiplayerPage.acctBusy;
    this.add(sTitle("Ranked", 16, 2));
    const season = me?.season ?? top?.season ?? "";
    if (season) this.add(sText(seasonLabel(season).toUpperCase(), 110, 9, 12, SFH.gold, CAPS));
    const rooms = MultiplayerPage.rows.filter((r) => r.info?.kind === "ranked" && !r.error);
    this.addButton(new SfhButton("Find match", w - 146, 4, 130, 26), () => this.findRanked())
      .setEnabled(!busy && rooms.length > 0);

    const panelY = 36;
    const panelH = h - panelY - 48;
    const leftW = Math.floor((w - 40) * 0.42);
    this.add(sInfo(16, panelY, leftW, panelH));
    const lx = 28;
    const lw = leftW - 24;
    sHeading(this.view, "Your season", lx, panelY + 10, lw);
    if (!me) {
      this.add(sText(busy ? "Loading..." : "Could not load your rating.", lx, panelY + 40, 12, SFH.grey));
    } else {
      this.add(sText(me.tier, lx, panelY + 38, 26, TIER_COLOURS[me.tier] ?? SFH.white, CAPS));
      this.add(sText(me.tier === "PLACEMENT" ? me.rank : `${me.rating} RATING`, lx, panelY + 72, 13,
        SFH.white, BOLD));
      const facts: [string, string][] = [
        ["ROUNDS", String(me.games)], ["WON", String(me.wins)], ["PEAK", String(me.peak)],
      ];
      facts.forEach(([k, v], i) => {
        this.add(sText(k, lx + i * 80, panelY + 98, 9, SFH.grey, CAPS));
        this.add(sText(v, lx + i * 80, panelY + 110, 14, SFH.white, BOLD));
      });
      const how = sText("Ranked rooms are for signed-in players. Sides are balanced by "
        + "rating; a win against a stronger side moves you further. Quitting a "
        + "round counts as a loss. Seasons are calendar quarters, and each starts "
        + "halfway back to 1000.", lx, panelY + 140, 11, SFH.grey);
      how.style.wordWrap = true;
      how.style.wordWrapWidth = lw;
      how.style.lineHeight = 15;
      this.add(how);
      let y = panelY + 140 + how.height + 12;
      if (me.history.length && y < panelY + panelH - 40) {
        sHeading(this.view, "Past seasons", lx, y, lw);
        y += 26;
        for (const past of me.history) {
          if (y > panelY + panelH - 18) break;
          this.add(sText(seasonLabel(past.season), lx, y, 11, SFH.grey));
          this.add(sText(`${past.tier} ${past.rating}`, lx + lw, y, 11,
            TIER_COLOURS[past.tier] ?? SFH.white, BOLD)).anchor.set(1, 0);
          y += 16;
        }
      }
    }

    const rx = 16 + leftW + 8;
    const rw = w - 16 - rx;
    this.add(sPanel(rx, panelY, rw, panelH));
    sHeading(this.view, "Leaderboard", rx + 12, panelY + 10, rw - 24);
    if (!top) {
      this.add(sText("Loading...", rx + 12, panelY + 40, 12, SFH.grey));
    } else if (!top.rows.length) {
      this.add(sText("Nobody has played ranked this season yet.", rx + 12, panelY + 40, 12, SFH.grey));
    } else {
      this.add(sText("RANK", rx + rw - 190, panelY + 34, 9, SFH.dim, CAPS));
      this.add(sText("W/R", rx + rw - 60, panelY + 34, 9, SFH.dim, CAPS));
      const fit = Math.floor((panelH - 60) / 19);
      top.rows.slice(0, fit).forEach((r, i) => {
        const y = panelY + 50 + i * 19;
        const mine = r.name === Acct.account()?.name;
        this.add(sText(String(i + 1), rx + 12, y, 12, i < 3 ? SFH.gold : SFH.grey, CAPS));
        this.nameLink(this.add(sText(clip(r.name, 16), rx + 40, y, 12, mine ? SFH.orange : SFH.white,
          mine ? BOLD : BOOK)), r.name);
        this.add(sText(rankLabel(r.rating, r.games), rx + rw - 190, y, 11,
          TIER_COLOURS[r.tier] ?? SFH.white, BOLD));
        this.add(sText(`${r.wins}/${r.games}`, rx + rw - 60, y, 11, SFH.grey));
      });
    }

    const by = h - 36;
    this.addButton(new SfhButton("Back", w - 126, by, 110, 26), () => this.setView("browser"));
    const note = MultiplayerPage.acctNote
      || (rooms.length ? "" : "No ranked room is answering right now.");
    if (note) this.add(sText(note, 16, by + 6, 12, SFH.red));
  }

  private openRanked(): void {
    MultiplayerPage.rankedTop = null;
    this.setView("ranked");
    void MultiplayerPage.acctTask(async () => {
      MultiplayerPage.rankedMe = await Acct.myRanked();
      const base = MultiplayerPage.apiBase() ?? Acct.account()?.base;
      MultiplayerPage.rankedTop = base ? await Acct.topRanked(base) : null;
    });
  }

  private nameLink(t: Container & { width: number; height: number; x: number; y: number },
    name: string): void {
    this.links.push({ x: t.x, y: t.y, w: t.width, h: t.height, go: () => this.openProfile(name) });
  }

  private openProfile(name: string): void {
    const base = MultiplayerPage.apiBase() ?? Acct.account()?.base;
    if (MultiplayerPage.view !== "profile") MultiplayerPage.profileBack = MultiplayerPage.view;
    MultiplayerPage.profileName = name;
    MultiplayerPage.profile = null;
    this.setView("profile");
    if (!base) {
      MultiplayerPage.acctNote = "No server is answering right now.";
      return;
    }
    void MultiplayerPage.acctTask(async () => {
      const got = await Acct.profileOf(base, name);
      if (MultiplayerPage.profileName === name) MultiplayerPage.profile = got;
    });
  }

  private lookUpForm(): void {
    openForm({
      title: "Look up a player",
      note: "Their account name.",
      fields: [{ key: "name", label: "Account name", auto: "off" }],
      submit: "Look up",
      onSubmit: async (v) => {
        const n = v.name.trim();
        if (!n) return "Type a name";
        this.openProfile(n);
        return null;
      },
    });
  }

  private buildProfile(w: number, h: number): void {
    const pr = MultiplayerPage.profile;
    const busy = MultiplayerPage.acctBusy;
    const me = Acct.account();
    this.add(sTitle("Profile", 16, 2));
    this.addButton(new SfhButton("Look up", w - 126, 4, 110, 24), () => this.lookUpForm())
      .setEnabled(!busy);
    const friendNames = Acct.friends();
    const known = !!friendNames && [...friendNames.friends.map((f) => f.name), ...friendNames.outgoing]
      .some((n) => n.toLowerCase() === (pr?.name ?? "").toLowerCase());
    if (pr && me && pr.name.toLowerCase() !== me.name.toLowerCase() && !known) {
      this.addButton(new SfhButton("Add friend", w - 252, 4, 120, 24),
        () => void MultiplayerPage.acctTask(() => Acct.addFriend(pr.name))).setEnabled(!busy);
    }

    const panelY = 36;
    const panelH = h - panelY - 48;
    const leftW = Math.floor((w - 40) * 0.4);
    this.add(sInfo(16, panelY, leftW, panelH));
    const lx = 28;
    const lw = leftW - 24;
    const rx = 16 + leftW + 8;
    const rw = w - 16 - rx;
    this.add(sPanel(rx, panelY, rw, panelH));
    if (!pr) {
      this.add(sText(busy ? "Loading..." : `Could not load ${MultiplayerPage.profileName}.`,
        lx, panelY + 14, 12, SFH.grey));
    } else {
      let y = panelY + 10;
      let x = lx;
      if (pr.clan) {
        const t = this.add(sText(`[${pr.clan}]`, x, y + 2, 16, SFH.gold, CAPS));
        x += t.width + 8;
      }
      this.add(sText(clip(pr.name.toUpperCase(), 18), x, y, 20, SFH.white, CAPS));
      y += 28;
      this.add(sText(`PLAYING SINCE ${ymd(pr.since)}`, lx, y, 9, SFH.grey, CAPS));
      y += 18;
      const st = pr.stats;
      const facts: [string, string][] = [
        ["ROUNDS", String(st.rounds)], ["WON", String(st.wins)],
        ["WIN RATE", st.rounds ? `${Math.round(100 * st.wins / st.rounds)}%` : "-"],
        ["KILLS", String(st.kills)], ["DEATHS", String(st.deaths)],
        ["K/D", st.deaths ? (st.kills / st.deaths).toFixed(2) : String(st.kills)],
      ];
      const cw = Math.floor(lw / 3);
      facts.forEach(([k, v], i) => {
        const fx = lx + (i % 3) * cw;
        const fy = y + Math.floor(i / 3) * 34;
        this.add(sText(k, fx, fy, 9, SFH.grey, CAPS));
        this.add(sText(v, fx, fy + 12, 14, SFH.white, BOLD));
      });
      y += 72;
      if (pr.ranked) {
        const r = pr.ranked;
        sHeading(this.view, `Ranked  ${seasonLabel(r.season)}`, lx, y, lw);
        y += 24;
        this.add(sText(r.rank, lx, y, 13, TIER_COLOURS[r.tier] ?? SFH.white, BOLD));
        this.add(sText(`PEAK ${r.peak}  -  ${r.wins}/${r.games} WON`, lx + lw, y + 2, 9, SFH.grey, CAPS))
          .anchor.set(1, 0);
        y += 22;
      }
      const bottom = panelY + panelH - 8;
      if (pr.weapons.length && y < bottom - 44) {
        sHeading(this.view, "Favourite guns", lx, y, lw);
        y += 24;
        for (const g of pr.weapons) {
          if (y > bottom - 16) break;
          this.add(sText(clip(Guns.itemOb[g.id]?.name ?? g.id, 26), lx, y, 11, SFH.white));
          this.add(sText(`${g.kills} kills`, lx + lw, y, 11, SFH.grey)).anchor.set(1, 0);
          y += 16;
        }
        y += 6;
      }
      if (pr.heroes.length && y < bottom - 44) {
        sHeading(this.view, "Squad", lx, y, lw);
        y += 24;
        for (const hh of pr.heroes) {
          if (y > bottom - 16) break;
          const cls = Classes.itemOb[hh.cls]?.name ?? hh.cls;
          this.add(sText(clip(hh.name, 18), lx, y, 11, SFH.white, BOLD));
          this.add(sText(`LV ${hh.level} ${cls}`, lx + lw, y, 11, SFH.grey)).anchor.set(1, 0);
          y += 16;
        }
      }

      sHeading(this.view, "Recent rounds", rx + 12, panelY + 10, rw - 24);
      const rcol = (f: number): number => rx + 12 + Math.round((rw - 24) * f);
      if (!pr.history.length) {
        this.add(sText("No rounds played while signed in yet.", rx + 12, panelY + 40, 12, SFH.grey));
      } else {
        const heads: [string, number][] = [
          ["WHEN", 0], ["RESULT", 0.14], ["MODE", 0.3], ["MAP", 0.53], ["K/D", 0.75], ["EXP", 0.87],
        ];
        for (const [n, f] of heads) this.add(sText(n, rcol(f), panelY + 34, 9, SFH.dim, CAPS));
        const fit = Math.floor((panelH - 60) / 19);
        pr.history.slice(0, fit).forEach((m, i) => {
          const y2 = panelY + 50 + i * 19;
          const res = m.won > 0 ? "WIN" : m.won < 0 ? "DRAW" : "LOSS";
          this.add(sText(md(m.at), rcol(0), y2, 11, SFH.grey));
          this.add(sText(res + (m.rating !== undefined ? ` ${m.rating >= 0 ? "+" : ""}${m.rating}` : ""),
            rcol(0.14), y2, 11, m.won > 0 ? SFH.green : m.won < 0 ? SFH.gold : SFH.red, BOLD));
          this.add(sText(clip(getGameMode(m.mode).name, 14), rcol(0.3), y2, 11, SFH.white));
          const map = m.map.startsWith("#") ? m.map.slice(1) : getMap(m.map).name;
          this.add(sText(clip(map, 14), rcol(0.53), y2, 11, m.map.startsWith("#") ? SFH.cyan : SFH.white));
          this.add(sText(`${m.kills}/${m.deaths}`, rcol(0.75), y2, 11, SFH.grey));
          this.add(sText(m.exp ? `+${m.exp}` : "-", rcol(0.87), y2, 11, SFH.grey));
        });
      }
    }

    const by = h - 36;
    this.addButton(new SfhButton("Back", w - 126, by, 110, 26),
      () => this.setView(MultiplayerPage.profileBack === "profile" ? "browser" : MultiplayerPage.profileBack));
    if (MultiplayerPage.acctNote) this.add(sText(MultiplayerPage.acctNote, 16, by + 6, 12, SFH.red));
  }

  private buildBrowser(w: number, h: number): void {
    this.add(sTitle("Public servers", 16, 2));

    const closed = this.client?.state === "closed" ? this.client : null;
    if (closed?.error) {
      this.add(sText(`Disconnected: ${closed.error}`, 250, 9, 12, SFH.red, BOLD));
    }

    const watch = this.addButton(new SfhButton("Watch only", w - 252, 4, 110, 24), () => {
      MultiplayerPage.watchOnly = !MultiplayerPage.watchOnly;
      MultiplayerPage.touch();
    });
    watch.setActive(MultiplayerPage.watchOnly);
    const refresh = this.addButton(new SfhButton(
      MultiplayerPage.loading ? "Checking" : "Refresh", w - 126, 4, 110, 24),
    () => void MultiplayerPage.refreshList());
    refresh.setEnabled(!MultiplayerPage.loading);

    const panelY = 36;
    const footH = 78;
    const panelH = h - panelY - footH - 12;
    this.add(sPanel(16, panelY, w - 32, panelH));

    const cols: [string, number][] = [
      ["SERVER", 38], ["MODE", 318], ["MAP", 502], ["PLAYERS", 614], ["PING", 718],
    ];
    const sx = (x: number): number => Math.round(x * (w - 32) / 768);
    for (const [name, x] of cols) this.add(sText(name, sx(x), panelY + 8, 10, SFH.grey, CAPS));

    const rows = MultiplayerPage.rows;
    const boxY = panelY + 26;
    const boxH = panelH - 32;
    this.rowW = w - 48;
    this.boxRect = { x: 24, y: boxY, w: this.rowW, h: boxH };
    const box = new ScrollBox(24, boxY, this.rowW, boxH);
    this.add(box);
    this.box = box;

    if (!rows.length) {
      box.content.addChild(sText(
        MultiplayerPage.loading ? "Looking for servers..." : "No servers listed.",
        14, 14, 13, SFH.grey));
    }

    const cx = (x: number): number => sx(x) - 24;
    rows.forEach((row, i) => {
      const top = i * (ROW_H + ROW_GAP);
      const live = !!row.info && !row.error;
      const g = paintRow(new Graphics(), this.rowW, ROW_H, false, live);
      g.y = top;
      box.content.addChild(g);
      this.rowSlabs.push(g);

      const name = row.info?.name ?? row.entry.name;
      box.content.addChild(sText(name.toUpperCase(), 14, top + 6, 13,
        live ? SFH.white : SFH.dim, CAPS));
      const sub = row.error || phaseWord(row.info?.phase);
      box.content.addChild(sText(sub, 14, top + 25, 10, row.error ? SFH.red : SFH.grey));

      if (row.info) {
        const coop = !!row.info.coop;
        const kind = kindWord(row.info);
        box.content.addChild(sText(kind || getGameMode(row.info.mode).name,
          cx(318), top + (kind && !coop ? 6 : 14), 12, kind ? SFH.gold : SFH.white, BOLD));
        if (kind && !coop) {
          box.content.addChild(sText(getGameMode(row.info.mode).name + (row.info.private ? "  -  PRIVATE" : ""),
            cx(318), top + 24, 10, row.info.private ? SFH.orange : SFH.grey));
        }
        const mapName = row.info.custom ?? getMap(row.info.map).name;
        box.content.addChild(sText(clip(mapName, 16), cx(502), top + 14, 12, SFH.white));
        const full = row.info.players >= row.info.maxPlayers;
        box.content.addChild(sText(`${row.info.players}/${row.info.maxPlayers}`,
          cx(614), top + 8, 13, full ? SFH.orange : SFH.white, BOLD));
        const extra = [
          row.info.bots && !coop ? `+${row.info.bots} bots` : "",
          row.info.spectators ? `${row.info.spectators} watching` : "",
          full ? "full: watch" : "",
        ].filter(Boolean).join(", ");
        if (extra) box.content.addChild(sText(extra, cx(614), top + 26, 9, SFH.grey));
      }
      if (row.ping >= 0) {
        box.content.addChild(sText(`${row.ping}ms`, cx(718), top + 14, 12, pingColour(row.ping), BOLD));
      }

      if (live) this.rowHits.push({ top, h: ROW_H, row });
    });

    const footY = h - footH;
    this.add(sInfo(16, footY, w - 32, footH - 8));
    const acct = Acct.account();
    const prof = acct?.profile ?? null;
    const busy = MultiplayerPage.acctBusy;
    let bx = w - 28;
    const by = footY + 10;
    const right = (label: string, bw: number, go: () => void, enabled = true): SfhButton => {
      bx -= bw;
      const b = this.addButton(new SfhButton(label, bx, by, bw, 24), go);
      b.setEnabled(enabled);
      bx -= 6;
      return b;
    };
    let line1: string;
    let line2: string;
    if (!acct) {
      const squad = guestOrder().map((i) => SD.heroes[i]).filter(Boolean);
      const lead = squad[0];
      line1 = lead
        ? `GUEST: ${lead.name} - LV ${Math.trunc(lead.level)} `
          + `${Classes.itemOb[lead.cls]?.name ?? lead.cls}`
          + (squad.length > 1 ? ` +${squad.length - 1}` : "")
        : "GUEST: no hero selected";
      line2 = "Guests play with their save's squad and earn nothing. "
        + "Sign in to level heroes up online.";
      const can = !!MultiplayerPage.apiBase();
      right("New account", 120, () => this.openSignIn(true), can);
      right("Sign in", 96, () => this.openSignIn(false), can);
    } else {
      right("Sign out", 96, () => {
        MultiplayerPage.view = "browser";
        void MultiplayerPage.acctTask(() => Acct.signOut());
      });
      right("Clan", 64, () => this.openClan(), !busy);
      const on = Acct.friends()?.friends.filter((f) => f.online).length ?? 0;
      right(on ? `Friends ${on}` : "Friends", 92, () => this.openFriends(), !busy);
      right("Ranked", 80, () => this.openRanked(), !busy);
      right("Profile", 80, () => this.openProfile(acct.name), !busy);
      const tag = Acct.clan()?.tag;
      const who = tag ? `[${tag}] ${acct.name}` : acct.name;
      if (!prof) {
        line1 = who;
        line2 = busy ? "Loading your heroes..." : "Could not load your heroes.";
      } else if (!prof.seeded) {
        line1 = `${who} - no heroes online yet`;
        line2 = "Bring your save's heroes online once; after that they level up online.";
        right("Go online", 106, () => this.goOnline(), !busy && SD.heroes.length > 0);
      } else {
        const names = prof.squad.map((i) => prof.heroes[i])
          .map((hh) => `${String(hh?.name ?? "?")} ${Number(hh?.level) || 1}`);
        line1 = `${who} - ${names.join(", ")}`;
        const st = prof.stats;
        line2 = `${st.rounds} rounds, ${st.wins} won, ${st.kills} kills, ${st.deaths} deaths`;
        right("Squad", 68, () => {
          MultiplayerPage.pick = [...prof.squad];
          this.setView("squad");
        }, !busy);
      }
    }
    const room = Math.max(20, Math.floor((bx - 30) / 7.2));
    this.add(sText(clip(line1, room), 28, footY + 10, 13, SFH.white, BOLD));
    this.add(sText(clip(line2, Math.floor(room * 1.2)), 28, footY + 30, 11, SFH.grey));
    const note = MultiplayerPage.acctNote || MultiplayerPage.status
      || "Nothing you win or lose online touches the campaign.";
    this.add(sText(note, 28, footY + 48, 11, MultiplayerPage.acctNote ? SFH.red : SFH.dim));
  }

  private buildLobby(w: number, h: number, c: NetClient): void {
    const room = c.room;
    if (!room) {
      this.add(sTitle(c.watch ? "Joining to watch..." : "Connecting...", 16, 2));
      this.add(sText(c.url, 16, 34, 12, SFH.grey));
      this.addButton(new SfhButton("Cancel", 16, 62, 110, 26), () => this.leave());
      return;
    }

    const coop = room.coop;
    const playing = room.players.filter((p) => !p.spec);
    const watching = room.players.filter((p) => p.spec);
    const me = c.me;
    const iWatch = !!me?.spec;

    this.add(sTitle(room.name, 16, 2));
    const waiting = room.phase === "lobby" && room.wait;
    const line = (waiting ? room.wait ?? "" : phaseLine(room, playing.length))
      + (iWatch ? "   -   YOU ARE WATCHING" : "")
      + (c.reconnecting ? "   -   RECONNECTING..." : "");
    this.add(sText(line.toUpperCase(), 18, 30, 10,
      c.reconnecting ? SFH.red : waiting ? SFH.orange : iWatch ? SFH.cyan : SFH.grey, CAPS));

    const top = 46;
    const listW = Math.round((w - 40) * 0.6);
    const listH = h - top - 172;
    this.add(sPanel(16, top, listW, listH));
    const lx = 28;
    const col = (f: number): number => lx + Math.round((listW - 24) * f);
    const heads: [string, number][] = [
      ["PLAYER", 0], ["TEAM", 0.58], ["K/D", 0.7], ["PING", 0.82], ["", 0.92],
    ];
    for (const [n, f] of heads) this.add(sText(n, col(f), top + 8, 9, SFH.grey, CAPS));

    const rowH = 19;
    const room_ = Math.floor((listH - 34) / rowH);
    const specRows = watching.length ? 1 + Math.min(watching.length, 3) : 0;
    const fit = Math.max(1, room_ - specRows);
    playing.slice(0, fit).forEach((p, i) => {
      const y = top + 26 + i * rowH;
      this.playerRow(p, p.id === c.id, y, col, room, coop?.host ?? room.custom?.host ?? "");
    });
    if (playing.length > fit) {
      this.add(sText(`+${playing.length - fit} more`, lx, top + 26 + fit * rowH, 11, SFH.dim));
    }
    if (watching.length) {
      const y0 = top + listH - 8 - specRows * rowH;
      this.add(sText(`WATCHING (${watching.length}/${room.maxSpectators})`, lx, y0 + 2, 9,
        SFH.cyan, CAPS));
      const names = watching.map((p) => (p.clan ? `[${p.clan}] ` : "") + p.name
        + (p.id === c.id ? " (you)" : ""));
      const perLine = 3;
      for (let k = 0; k * perLine < names.length && k < 3; k++) {
        this.add(sText(names.slice(k * perLine, k * perLine + perLine).join("   "),
          lx, y0 + (k + 1) * rowH, 11, SFH.grey));
      }
    }

    const infoX = 16 + listW + 8;
    const infoW = w - 16 - infoX;
    this.add(sInfo(infoX, top, infoW, listH));
    const ix = infoX + 12;
    const iw = infoW - 24;
    const cfg = room.cfg;
    const mode = getGameMode(cfg.mode);
    let iy = top + 8;
    if (coop) {
      sHeading(this.view, `Mission ${DIFFS[coop.diff - 1] ?? ""}`, ix, iy, iw);
      iy += 24;
      this.add(sText(coop.title.toUpperCase(), ix, iy, 14, SFH.gold, CAPS));
      iy += 20;
      this.add(sText(`${coop.open.length} OF ${coop.count} OPEN`, ix, iy + 1, 9, SFH.grey, CAPS));
      this.add(sText(coop.cleared ? "CLEARED" : `+${coop.bonus} EXP FIRST CLEAR`,
        ix + iw, iy, 10, coop.cleared ? SFH.green : SFH.gold, CAPS)).anchor.set(1, 0);
      iy += 16;
      if (coop.desc) {
        const d = sText(coop.desc, ix, iy, 11, SFH.white);
        d.style.wordWrap = true;
        d.style.wordWrapWidth = iw;
        this.add(d);
        iy += Math.min(34, d.height + 4);
      }
    } else if (room.kind === "clanwar") {
      sHeading(this.view, "Clan war", ix, iy, iw);
      iy += 24;
      const war = room.war;
      this.add(sText(war ? `[${war.a}]` : "[?]", ix, iy, 16, SFH.team1, CAPS));
      this.add(sText("VS", ix + iw / 2, iy + 3, 11, SFH.grey, CAPS)).anchor.set(0.5, 0);
      this.add(sText(war ? `[${war.b}]` : "[?]", ix + iw, iy, 16, SFH.team2, CAPS)).anchor.set(1, 0);
      iy += 24;
    } else if (room.kind === "ranked") {
      sHeading(this.view, `Ranked  ${seasonLabel(room.season ?? "")}`, ix, iy, iw);
      iy += 24;
      const r = c.rating;
      if (r) {
        const d = r.to - r.from;
        this.add(sText(`${r.rank}  (${d >= 0 ? "+" : ""}${d})`, ix, iy, 12,
          d >= 0 ? SFH.green : SFH.red, BOLD));
        iy += 18;
      } else if (me?.rank) {
        this.add(sText(me.rank, ix, iy, 12, TIER_COLOURS[me.tier ?? ""] ?? SFH.white, BOLD));
        iy += 18;
      }
    } else if (room.custom) {
      const cm = room.custom;
      sHeading(this.view, cm.private ? "Custom map  -  private" : "Custom map", ix, iy, iw);
      iy += 24;
      this.add(sText(clip((cm.name || "Stock maps").toUpperCase(), 22), ix, iy, 14, SFH.gold, CAPS));
      iy += 18;
      if (cm.author) { this.add(sText(`by ${cm.author}`, ix, iy, 11, SFH.grey)); iy += 16; }
      if (cm.private) {
        this.add(sText("CODE", ix, iy + 3, 9, SFH.grey, CAPS));
        this.add(sText(cm.code, ix + 64, iy, 15, SFH.cyan, CAPS));
        iy += 20;
      }
    } else {
      sHeading(this.view, "Match", ix, iy, iw);
      iy += 24;
    }
    const facts: [string, string][] = coop
      ? [
        ["MODE", mode.name], ["MAP", getMap(cfg.map).name],
        ["TARGET", String(cfg.score)],
      ]
      : [
        ["MODE", mode.name], ["MAP", cfg.cmap ? room.custom?.name || "Custom" : getMap(cfg.map).name],
        ["SCORE", String(cfg.score)],
        ["TIME", cfg.timeLimit > 0 ? `${Math.round(cfg.timeLimit / 60)} min` : "-"],
        ["BOTS", `${cfg.bots} (LV ${cfg.botLevel})`],
        ["SLOTS", `${playing.length}/${room.maxPlayers}`],
      ];
    facts.forEach(([k, v]) => {
      this.add(sText(k, ix, iy + 1, 9, SFH.grey, CAPS));
      this.add(sText(v, ix + 64, iy, 12, SFH.white, BOLD));
      iy += 18;
    });

    const sq = c.squad;
    const earned = c.earned;
    iy += 6;
    if (sq && sq.heroes.length && !iWatch) {
      const sum = earned ? earned.rows.reduce((t, r) => t + r.exp, 0) : 0;
      const bonus = earned?.bonus ? `  (${earned.first ? "first clear" : "clear"} +${earned.bonus})` : "";
      sHeading(this.view, earned ? `Squad  +${sum} exp${bonus}` : me?.acct ? "Your squad" : "Squad (guest)",
        ix, iy, iw);
      iy += 24;
      const left = top + listH - 6 - iy;
      const bh = Math.max(16, Math.min(22, Math.floor(left / sq.heroes.length) - 3));
      sq.heroes.forEach((hero, i) => {
        const cls = Classes.itemOb[String(hero.cls)]?.name ?? String(hero.cls);
        const lbl = `${String(hero.name ?? "?")}  LV ${Number(hero.level) || 1} ${cls}`;
        const b = new SfhButton(clip(lbl, 26), ix - 2, iy, iw + 4, bh, 10);
        b.setActive(i === sq.next);
        b.setEnabled(room.phase === "lobby");
        this.addButton(b, () => c.chooseHero(i));
        const r = earned?.rows[i];
        if (r && r.name === String(hero.name ?? "")) {
          const up = r.to > r.from;
          this.add(sText(up ? `+${r.exp} UP!` : `+${r.exp}`,
            ix + iw - 2, iy + bh / 2 - 6, 9, up ? SFH.green : SFH.grey, CAPS)).anchor.set(1, 0);
        }
        iy += bh + 3;
      });
    }

    const chatY = top + listH + 8;
    const chatH = h - chatY - 44;
    this.add(sInfo(16, chatY, w - 32, chatH));
    const lines = c.chat.slice(-Math.max(1, Math.floor((chatH - 10) / 16)));
    lines.forEach((m, i) => {
      const y = chatY + 6 + i * 16;
      const server = m.from === "server";
      const who = this.add(sText(`${m.from}:`, 28, y, 11, server ? SFH.gold : SFH.cyan, BOLD));
      this.add(sText(m.text, 28 + Math.max(90, who.width + 8), y, 11,
        server ? SFH.gold : SFH.white));
    });
    if (!lines.length) this.add(sText("No messages.", 28, chatY + 6, 11, SFH.dim));

    const by = h - 34;
    let bx = 16;
    const left = (label: string, bw: number, go: () => void): SfhButton => {
      const b = this.addButton(new SfhButton(label, bx, by, bw, 26), go);
      bx += bw + 6;
      return b;
    };
    if (room.phase === "lobby") {
      if (coop && !iWatch) {
        const host = coop.host === c.id;
        if (host) {
          left("<", 30, () => c.chooseMission(coop.mission - 1, coop.diff));
          left(">", 30, () => c.chooseMission(coop.mission + 1, coop.diff));
          DIFFS.forEach((d, k) => {
            left(d, 70, () => c.chooseMission(coop.mission, k + 1)).setActive(coop.diff === k + 1);
          });
        } else {
          const t = this.add(sText("THE HOST PICKS THE MISSION", bx, by + 8, 10, SFH.grey, CAPS));
          bx += t.width + 16;
        }
      } else if (room.custom && !iWatch && room.custom.host === c.id) {
        const cm = room.custom;
        left("Load map", 96, () => this.customMapForm(c));
        if (cm.id) {
          for (const [key, lbl] of CUSTOM_MODES) {
            left(lbl, 44, () => c.chooseCustomMap(cm.id, key)).setActive(cfg.mode === key);
          }
          left("Stock", 60, () => c.chooseCustomMap("", ""));
        }
        left(cm.private ? "Private" : "Public", 76, () => c.setPrivate(!cm.private)).setActive(cm.private);
      } else if (mode.teams && !iWatch && room.kind !== "ranked" && room.kind !== "clanwar") {
        const teams: [string, number][] = [["Auto", 0], ["Team 1", 1], ["Team 2", 2]];
        for (const [name, n] of teams) left(name, 76, () => c.setTeam(n)).setActive(me?.team === n);
      }
      if (!iWatch) {
        left(me?.ready ? "Not ready" : "Ready", 104, () => c.setReady(!me?.ready))
          .setActive(!!me?.ready);
      }
      left(iWatch ? "Play" : "Watch", 84, () => c.setSpectate(!iWatch)).setActive(iWatch);
    } else if (room.vote) {
      const v = room.vote;
      const t = this.add(sText(v.modes ? "NEXT ROUND" : "NEXT MAP", bx, by + 8, 10, SFH.grey, CAPS));
      bx += t.width + 10;
      const bw = Math.max(90, Math.min(v.modes ? 240 : 170, Math.floor((w - 142 - bx) / v.maps.length) - 6));
      v.maps.forEach((id, i) => {
        const n = v.votes[i] ?? 0;
        const mode = v.modes?.[i] ? ` - ${getGameMode(v.modes[i]).name}` : "";
        const label = clip(getMap(id).name + mode, v.modes ? 24 : 14);
        const b = left(`${label}${n ? `  ${n}` : ""}`, bw, () => c.vote(i));
        b.setActive(me?.vote === i);
        b.setEnabled(!iWatch);
      });
    } else {
      this.add(sText(
        room.phase === "live"
          ? iWatch ? "ROUND IN PROGRESS" : "ROUND IN PROGRESS - YOU ARE IN THE NEXT ONE"
          : "SCOREBOARD",
        16, by + 8, 10, SFH.grey, CAPS));
    }
    this.addButton(new SfhButton("Leave", w - 126, by, 110, 26), () => this.leave());
  }

  private customMapForm(c: NetClient): void {
    openForm({
      title: "Load a shared map",
      note: "Paste the link the map editor's SHARE gives you (or just its id). "
        + "Everybody in the room loads it for the next round.",
      fields: [{ key: "link", label: "Map link", auto: "off" }],
      submit: "Load",
      onSubmit: async (v) => {
        const raw = v.link.trim();
        const m = /cmap=([A-Za-z0-9_-]{6,16})/.exec(raw) ?? /^([A-Za-z0-9_-]{6,16})$/.exec(raw);
        if (!m) return "That is not a map link";
        c.chooseCustomMap(m[1], c.room?.cfg.cmap ? c.room.cfg.mode : "tdm");
        return null;
      },
    });
  }

  private playerRow(
    p: PlayerView, mine: boolean, y: number, col: (f: number) => number,
    room: RoomView, host: string,
  ): void {
    const fill = mine ? SFH.orange : SFH.white;
    let x = col(0);
    if (p.clan) {
      const t = this.add(sText(`[${p.clan}]`, x, y, 12, SFH.gold, BOLD));
      x += t.width + 5;
    }
    const n = this.add(sText(p.name, x, y, 12, fill, mine ? BOLD : BOOK));
    x += n.width + 6;
    if (p.away) {
      const a = this.add(sText("AWAY", x, y + 2, 8, SFH.red, CAPS));
      x += a.width + 6;
    }
    if (p.id === host) this.add(sText("HOST", x, y + 2, 8, SFH.gold, CAPS));
    else if (p.rank) this.add(sText(p.rank, x, y + 2, 8, TIER_COLOURS[p.tier ?? ""] ?? SFH.grey, CAPS));
    else if (!p.acct) this.add(sText("guest", x, y + 1, 10, SFH.dim));
    if (!room.coop) this.add(sText(teamWord(p.team), col(0.58), y, 12, teamColour(p.team), BOLD));
    this.add(sText(`${p.kills}/${p.deaths}`, col(0.7), y, 12, SFH.grey));
    this.add(sText(String(p.ping), col(0.82), y, 12, pingColour(p.ping)));
    if (room.phase === "lobby" && p.ready) this.add(sText("READY", col(0.92), y + 1, 9, SFH.green, CAPS));
  }

  update(_dt: number): void {
    const c = this.client;

    if (c && c.state === "playing" && c.round && !MultiplayerPage.handedOff) {
      MultiplayerPage.handedOff = true;
      closeForm();
      this.host.startNetMatch();
      return;
    }

    this.box?.update();
    if (!c || c.state === "closed") this.pollFriends();

    const over = this.rowAt();
    if (over !== this.hovered) {
      this.litRow(this.hovered, false);
      this.litRow(over, true);
      this.hovered = over;
    }

    for (const b of this.buttons) b.btn.update();
    for (const r of this.rowHits) this.box?.focusRow(r.top, r.h);
    for (const l of this.links) focusable(l.x, l.y, l.w, l.h);

    if (this.seen !== MultiplayerPage.version
      || this.seenAcct !== Acct.accountVersion()) this.host.refresh();
  }

  onClick(): void {
    if (formOpen()) return;
    for (const { btn, go } of this.buttons) {
      if (btn.activate()) { go(); return; }
    }
    for (const l of this.links) {
      if (hitTest(l.x, l.y, l.w, l.h)) { SH.playSound("S_Click"); l.go(); return; }
    }
    const i = this.rowAt();
    if (i >= 0) {
      SH.playSound("S_Click");
      this.join(this.rowHits[i].row);
    }
  }

  private rowAt(): number {
    const box = this.box;
    if (!box || !this.rowHits.length) return -1;
    const { x, y, w, h } = this.boxRect;
    if (!hitTest(x, y, w, h)) return -1;
    for (let i = 0; i < this.rowHits.length; i++) {
      const r = this.rowHits[i];
      if (hitTest(x, y + r.top + box.content.y, w, r.h)) return i;
    }
    return -1;
  }

  private litRow(i: number, lit: boolean): void {
    if (i < 0) return;
    const hit = this.rowHits[i];
    if (!hit) return;
    const g = this.rowSlabs[MultiplayerPage.rows.indexOf(hit.row)];
    if (g) paintRow(g, this.rowW, ROW_H, lit, true);
  }
}

function guestOrder(): number[] {
  const out: number[] = [];
  const add = (i: number): void => {
    if (i >= 0 && i < SD.heroes.length && !out.includes(i) && out.length < MAX_SQUAD) out.push(i);
  };
  add(SD.selHero);
  for (const i of SD.squad) add(i);
  if (!out.length && SD.heroes.length) out.push(0);
  return out;
}

function guestSquad(): Record<string, unknown>[] {
  return guestOrder().map((i) => heroToWire(SD.heroes[i]));
}

function ymd(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function md(ms: number): string {
  return ymd(ms).slice(5);
}

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}...` : s;
}

function phaseWord(phase: string | undefined): string {
  switch (phase) {
    case "lobby": return "In lobby";
    case "loading": return "Loading";
    case "live": return "Round in progress";
    case "over": return "Scoreboard";
    default: return "Unknown";
  }
}

function kindWord(info: ServerInfo): string {
  switch (info.kind) {
    case "coop": return "Co-op Campaign";
    case "ranked": return "Ranked";
    case "clanwar": return "Clan War";
    case "custom": return "Custom Maps";
    default: return info.coop ? "Co-op Campaign" : "";
  }
}

function phaseLine(room: RoomView, playing: number): string {
  const kind = room.coop ? "Co-op campaign - "
    : room.kind === "ranked" ? "Ranked - "
      : room.kind === "clanwar" ? "Clan war - "
        : room.kind === "custom" ? "Custom - " : "";
  switch (room.phase) {
    case "lobby":
      return kind + (playing ? `Starting in ${room.countdown}s` : "Waiting for players");
    case "live": return `${kind}Round in progress`;
    case "over": return `${kind}Next round in ${room.countdown}s`;
    default: return phaseWord(room.phase);
  }
}

function teamWord(team: number): string {
  return team === 1 ? "1" : team === 2 ? "2" : "AUTO";
}

function teamColour(team: number): number {
  return team === 1 ? SFH.team1 : team === 2 ? SFH.team2 : SFH.dim;
}

function pingColour(ms: number): number {
  if (ms < 0) return SFH.dim;
  if (ms < 80) return SFH.green;
  if (ms < 160) return SFH.gold;
  return ms < 300 ? SFH.orange : SFH.red;
}
