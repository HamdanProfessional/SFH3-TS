#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";

const CONF_DIR = "/etc/sfh3";
const argv = process.argv.slice(2);
const flag = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const STATE_FILE = flag("--state") ?? "/var/lib/sfh3/watch.json";
const DRY = argv.includes("--dry-run");
const NO_SYSTEMD = argv.includes("--no-systemd");
const WEBHOOK = (process.env.SFH3_ALERT_WEBHOOK ?? "").trim();
const FORMAT = (process.env.SFH3_ALERT_FORMAT ?? "auto").trim().toLowerCase();
const ERROR_SPIKE = Math.max(1, Number(process.env.SFH3_ALERT_ERRORS) || 5);
const MAX_PENDING = 30;

function rooms() {
  const listed = (process.env.SFH3_ROOMS ?? "").split(/[\s,]+/).filter((s) => /^\d+$/.test(s));
  if (listed.length) return listed;
  try {
    const found = readdirSync(CONF_DIR)
      .map((f) => /^sfh3-server-(\d+)\.conf$/.exec(f)?.[1])
      .filter(Boolean)
      .sort((a, b) => Number(a) - Number(b));
    if (found.length) return found;
  } catch {}
  return ["1", "2", "3", "4", "5", "6", "7"];
}

function systemctl(...args) {
  if (NO_SYSTEMD) return args[0] === "is-active" ? "active" : "0";
  try {
    return execFileSync("systemctl", args, { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch (e) {
    return String(e?.stdout ?? "").trim() || "unknown";
  }
}

async function fetchStatus(n) {
  try {
    const res = await fetch(`http://127.0.0.1:780${n}/status`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return { status: await res.json() };
  } catch (e) {
    return { error: e?.name === "TimeoutError" ? "timed out" : String(e?.cause?.code ?? e?.message ?? e) };
  }
}

function loadState() {
  try {
    const s = JSON.parse(readFileSync(STATE_FILE, "utf8"));
    return { rooms: s.rooms ?? {}, pending: Array.isArray(s.pending) ? s.pending : [] };
  } catch {
    return { rooms: {}, pending: [] };
  }
}

function saveState(state) {
  if (DRY) return;
  const tmp = `${STATE_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 1) + "\n", { mode: 0o600 });
  renameSync(tmp, STATE_FILE);
}

async function check(n, prev) {
  const unit = `sfh3-server@${n}`;
  const active = systemctl("is-active", unit);
  const restarts = Number(systemctl("show", "-p", "NRestarts", "--value", unit)) || 0;
  const { status, error } = await fetchStatus(n);
  const up = active === "active" && !!status?.ok;
  const name = status?.name ?? prev?.name ?? unit;
  const label = `room ${n} (${name})`;
  const cur = {
    name,
    up,
    active,
    restarts,
    startedAt: status?.startedAt ?? prev?.startedAt ?? null,
    errors: status?.errors?.total ?? prev?.errors ?? 0,
    health: status?.tick?.health ?? null,
    since: prev && prev.up === up ? prev.since : new Date().toISOString(),
  };
  const out = [];

  if (!up && (!prev || prev.up)) {
    const why = active !== "active" ? `unit is ${active}` : `/status: ${error ?? "bad reply"}`;
    out.push(`DOWN ${label}: ${why}`);
  } else if (up && prev && !prev.up) {
    out.push(`RECOVERED ${label} after ${ago(prev.since)}`);
  }

  if (prev && restarts > prev.restarts) {
    const k = restarts - prev.restarts;
    out.push(`RESTARTED ${label}: systemd restarted it ${k} time${k === 1 ? "" : "s"} (NRestarts ${restarts})`);
  }

  if (status) {
    const sameProcess = prev && prev.startedAt === status.startedAt;
    const delta = sameProcess ? cur.errors - prev.errors : cur.errors;
    if (prev && delta >= ERROR_SPIKE) {
      const last = status.errors.recent?.[status.errors.recent.length - 1]?.line ?? "";
      out.push(`ERRORS ${label}: ${delta} new errors in the last pass (${cur.errors} since start). Last: ${last.slice(0, 200)}`);
    }
    if (cur.health === "red" && prev?.health !== "red") {
      const t = status.tick;
      out.push(`OVERLOAD ${label}: tick avg ${t.avgMs} ms, worst ${t.worstMs} ms, ${t.overruns}/${t.samples} over the ${t.budgetMs} ms budget in the last minute`);
    } else if (prev?.health === "red" && cur.health && cur.health !== "red") {
      out.push(`OK ${label}: tick back to ${cur.health} (avg ${status.tick.avgMs} ms)`);
    }
  } else if (prev?.health === "red") {
    cur.health = "red";
  }
  return { cur, out };
}

function ago(iso) {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s >= 3600 ? `${Math.floor(s / 3600)}h${Math.floor(s / 60) % 60}m`
    : s >= 60 ? `${Math.floor(s / 60)}m${s % 60}s` : `${s}s`;
}

function payload(lines) {
  const text = `sfh3 @ ${hostname()}\n${lines.join("\n")}`;
  const fmt = FORMAT !== "auto" ? FORMAT
    : /discord(app)?\.com\/api\/webhooks/.test(WEBHOOK) ? "discord"
      : /hooks\.slack\.com/.test(WEBHOOK) ? "slack" : "json";
  if (fmt === "discord") return { content: text.slice(0, 1990) };
  if (fmt === "slack") return { text };
  return { source: "sfh3-watch", host: hostname(), at: new Date().toISOString(), alerts: lines, text };
}

async function send(lines) {
  if (!WEBHOOK || DRY) return true;
  try {
    const res = await fetch(WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload(lines)),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) { console.log(`[sfh3-watch] webhook answered HTTP ${res.status}`); return false; }
    return true;
  } catch (e) {
    console.log(`[sfh3-watch] webhook failed: ${e?.cause?.code ?? e?.message ?? e}`);
    return false;
  }
}

const state = loadState();
const lines = [];
const summary = [];
for (const n of rooms()) {
  const { cur, out } = await check(n, state.rooms[n]);
  state.rooms[n] = cur;
  lines.push(...out);
  summary.push(`${n}:${cur.up ? "up" : "DOWN"}${cur.health && cur.health !== "green" ? `/${cur.health}` : ""}`);
}

const batch = [...state.pending, ...lines];
if (batch.length) {
  for (const l of lines) console.log(`[sfh3-watch] ${l}`);
  if (DRY) console.log(JSON.stringify(payload(batch), null, 2));
  else if (!WEBHOOK) console.log("[sfh3-watch] no SFH3_ALERT_WEBHOOK set; logged only");
  state.pending = (await send(batch)) ? [] : batch.slice(-MAX_PENDING);
}
console.log(`[sfh3-watch] ${summary.join(" ")}`);
saveState(state);
