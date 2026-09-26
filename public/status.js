(function () {
  "use strict";

  var REFRESH_MS = 10000;
  var TIMEOUT_MS = 5000;
  var rooms = document.getElementById("rooms");
  var summary = document.getElementById("summary");
  var updated = document.getElementById("updated");
  var openErrors = {};

  function httpBase(wsUrl) {
    return wsUrl.replace(/^ws/, "http").replace(/\/+$/, "");
  }

  function getJson(url) {
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, TIMEOUT_MS);
    return fetch(url, { cache: "no-store", signal: ctl.signal }).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }, function (e) {
      clearTimeout(timer);
      throw e;
    });
  }

  function loadServers() {
    return getJson("/servers.json").then(function (list) {
      return Array.isArray(list) ? list : [];
    }, function () { return []; }).then(function (list) {
      var h = location.hostname;
      if (h === "localhost" || h === "127.0.0.1") {
        list.unshift({ name: "Local", url: "ws://127.0.0.1:7801" });
      }
      return list;
    });
  }

  function probe(entry) {
    var base = httpBase(entry.url);
    return getJson(base + "/status").then(function (s) {
      return { entry: entry, status: s };
    }, function () {
      return getJson(base + "/info").then(function (i) {
        return { entry: entry, info: i };
      }, function (e) {
        return { entry: entry, error: e && e.name === "AbortError" ? "timed out" : String(e && e.message || e) };
      });
    });
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = String(text);
    return n;
  }

  function duration(sec) {
    sec = Math.max(0, Math.floor(sec));
    var d = Math.floor(sec / 86400), h = Math.floor(sec / 3600) % 24;
    var m = Math.floor(sec / 60) % 60, s = sec % 60;
    if (d) return d + "d " + h + "h";
    if (h) return h + "h " + m + "m";
    if (m) return m + "m " + s + "s";
    return s + "s";
  }

  function row(dl, label, value, cls) {
    dl.appendChild(el("dt", "", label));
    dl.appendChild(el("dd", cls || "", value));
  }

  var HEALTH = { green: ["ok", "healthy"], amber: ["warn", "strained"], red: ["bad", "overloaded"] };

  function card(r) {
    var s = r.status, i = r.info || s;
    var up = !!(i && i.ok);
    var c = el("section", "card " + (up ? "up" : "down"));
    var h = el("h2");
    h.appendChild(el("span", "", r.entry.name || (i && i.name) || r.entry.url));
    h.appendChild(el("span", "badge " + (up ? "ok" : "bad"), up ? "up" : "down"));
    c.appendChild(h);
    c.appendChild(el("div", "sub", r.entry.url + (i && i.name && i.name !== r.entry.name ? "  (" + i.name + ")" : "")));

    var dl = el("dl");
    if (!up) {
      row(dl, "error", r.error || "no answer", "bad");
      c.appendChild(dl);
      return c;
    }
    row(dl, "players", i.players + " / " + i.maxPlayers
      + (i.spectators ? "  +" + i.spectators + " watching" : "")
      + (i.bots ? "  (" + i.bots + " bots)" : ""));
    row(dl, "phase", i.phase + "  " + (i.kind || "") + " " + (i.mode || "") + " / " + (i.map || ""));
    row(dl, "protocol", i.protocol);
    if (!s) {
      row(dl, "status", "no /status on this build (showing /info)", "dim");
      c.appendChild(dl);
      return c;
    }
    row(dl, "uptime", duration(s.uptimeSec) + "  since " + new Date(s.startedAt).toLocaleString());
    row(dl, "peak today", s.peakToday.players + " players");
    row(dl, "rounds", s.rounds + (s.roundsAbandoned ? "  (" + s.roundsAbandoned + " abandoned)" : ""));
    var t = s.tick, hl = HEALTH[t.health] || HEALTH.red;
    row(dl, "tick", hl[1] + ": avg " + t.avgMs + " ms, worst " + t.worstMs + " ms of "
      + t.budgetMs + " (" + t.overruns + " over in 1 min"
      + (t.stalls ? ", " + t.stalls + " stalls" : "") + ")", hl[0]);
    row(dl, "memory", s.memory.rssMb + " MB rss, heap " + s.memory.heapUsedMb + " / " + s.memory.heapTotalMb + " MB",
      s.memory.rssMb > 450 ? "bad" : s.memory.rssMb > 350 ? "warn" : "");
    row(dl, "connections", s.connections);
    row(dl, "errors", s.errors.total, s.errors.total ? "warn" : "ok");
    c.appendChild(dl);

    if (s.errors.recent && s.errors.recent.length) {
      var det = el("details");
      det.open = !!openErrors[r.entry.url];
      det.addEventListener("toggle", function () { openErrors[r.entry.url] = det.open; });
      det.appendChild(el("summary", "", "last " + s.errors.recent.length + " error lines"));
      det.appendChild(el("pre", "", s.errors.recent.slice().reverse().map(function (e) {
        return e.at.replace("T", " ").slice(0, 19) + "  " + e.line;
      }).join("\n")));
      c.appendChild(det);
    }
    return c;
  }

  function refresh() {
    loadServers().then(function (list) {
      return Promise.all(list.map(probe));
    }).then(function (results) {
      rooms.textContent = "";
      var upCount = 0, players = 0;
      results.forEach(function (r) {
        var i = r.info || r.status;
        if (i && i.ok) { upCount++; players += i.players || 0; }
        rooms.appendChild(card(r));
      });
      summary.textContent = results.length
        ? upCount + " of " + results.length + " rooms up, " + players + " playing"
        : "no rooms listed in servers.json";
      summary.className = upCount === results.length ? "" : "bad";
      updated.textContent = "updated " + new Date().toLocaleTimeString() + ", every " + REFRESH_MS / 1000 + " s";
    }).catch(function (e) {
      summary.textContent = "could not load: " + e;
      summary.className = "bad";
    }).then(function () {
      setTimeout(refresh, REFRESH_MS);
    });
  }

  refresh();
})();
