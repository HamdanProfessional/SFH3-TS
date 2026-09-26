# Deploying the dedicated servers

Everything in this directory is the server side of multiplayer. The game itself
deploys as static files into `/var/www/sfh3.retris.io`; this is the three node
processes behind it.

The original game has no multiplayer, so none of this is a port of anything.

## Shape

```
                     sfh3.retris.io (nginx, TLS)
   /                 ──► /var/www/sfh3.retris.io       (static, the game)
   /servers.json     ──► same, no-store                (the room list)
   /ws/1  /ws/1/info ──► 127.0.0.1:7801  sfh3-server@1 (Team Deathmatch)
   /ws/2  /ws/2/info ──► 127.0.0.1:7802  sfh3-server@2 (Capture the Flag)
   /ws/3  /ws/3/info ──► 127.0.0.1:7803  sfh3-server@3 (Free-For-All)
   /ws/4  /ws/4/info ──► 127.0.0.1:7804  sfh3-server@4 (Co-op Campaign)
   /ws/5  /ws/5/info ──► 127.0.0.1:7805  sfh3-server@5 (Ranked)
   /ws/6  /ws/6/info ──► 127.0.0.1:7806  sfh3-server@6 (Clan War)
   /ws/7  /ws/7/info ──► 127.0.0.1:7807  sfh3-server@7 (Custom Maps)
```

The instance number is the port's last digit is the path segment. One number,
three places, no lookup table — which is the only reason adding a room is three
one-line edits instead of a migration.

What a room *is* comes from `SFH3_KIND` in its conf: `normal`, `coop`,
`ranked`, `clanwar` or `custom`.

## Files

| Here | On the box |
|---|---|
| `sfh3-server@.service` | `/etc/systemd/system/sfh3-server@.service` |
| `instances/sfh3-server-N.conf` | `/etc/sfh3/sfh3-server-N.conf` |
| `nginx/sfh3.retris.io` | `/etc/nginx/sites-available/sfh3.retris.io` |
| `../server/dist/sfh3-server.cjs` | `/opt/sfh3/sfh3-server.cjs` |
| `../public/servers.json` | `/var/www/sfh3.retris.io/servers.json` (via `dist/`) |
| `../public/status.html`, `status.js` | `/var/www/sfh3.retris.io/status.html` (via `dist/`) |
| `sfh3-watch.mjs` | `/opt/sfh3/sfh3-watch.mjs` |
| `sfh3-watch.service`, `sfh3-watch.timer` | `/etc/systemd/system/` |
| `watch.env.example` | `/etc/sfh3/watch.env` (root, 600; holds the webhook URL) |

`servers.json` rides in the normal static deploy rather than being placed by
hand, and that is deliberate: the deploy prunes anything in the docroot that is
not in `dist/`, so a hand-placed file would survive exactly one redeploy.

## First install

```sh
# 1. an unprivileged owner with no home and no shell
sudo useradd --system --no-create-home --shell /usr/sbin/nologin sfh3

# 2. the bundle (one file; `ws` is bundled in, nothing to npm install)
sudo install -d -o root -g root -m 755 /opt/sfh3
sudo install -o root -g root -m 644 sfh3-server.cjs /opt/sfh3/sfh3-server.cjs

# 3. the unit and its per-room configs
sudo install -d -o root -g root -m 755 /etc/sfh3
sudo install -m 644 sfh3-server@.service /etc/systemd/system/
sudo install -m 644 instances/sfh3-server-1.conf /etc/sfh3/
sudo install -m 644 instances/sfh3-server-2.conf /etc/sfh3/
sudo install -m 644 instances/sfh3-server-3.conf /etc/sfh3/
sudo install -m 644 instances/sfh3-server-4.conf /etc/sfh3/
sudo install -m 644 instances/sfh3-server-5.conf /etc/sfh3/
sudo install -m 644 instances/sfh3-server-6.conf /etc/sfh3/
sudo install -m 644 instances/sfh3-server-7.conf /etc/sfh3/
sudo systemctl daemon-reload
sudo systemctl enable --now sfh3-server@{1..7}

# 4. nginx -- test BEFORE reloading; a bad file here takes down every vhost
#    on the box, not just this one
sudo cp /etc/nginx/sites-available/sfh3.retris.io{,.bak}
sudo install -m 644 nginx/sfh3.retris.io /etc/nginx/sites-available/
sudo nginx -t && sudo systemctl reload nginx
```

## Updating just the game code

```sh
npm run build && npm run build:server
# static half:
python deploy.py --apply
# server half:
#   scp server/dist/sfh3-server.cjs -> /opt/sfh3/, then
sudo systemctl restart sfh3-server@{1..7}
```

Restarting drops whoever is connected. There is no hot reload and there should
not be: the wire format is versioned (`PROTOCOL_VERSION`), and a client talking
to a half-updated room is the exact failure the version check exists to refuse.

## Accounts

The rooms share one SQLite database, `/var/lib/sfh3/accounts.db`. systemd creates the directory from `StateDirectory=sfh3` in the
unit, owned by `sfh3`, mode 0700 -- so a unit file older than the accounts
change has to be reinstalled once:

```sh
sudo install -m 644 sfh3-server@.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl restart sfh3-server@{1..7}
```

Back it up like any SQLite file in WAL mode -- with `.backup`, not `cp`,
which can copy a half-checkpointed state:

```sh
sudo -u sfh3 sqlite3 /var/lib/sfh3/accounts.db ".backup /tmp/accounts.bak"
```

Nothing in it is secret on its own (scrypt hashes, no e-mail), but the `meta`
row `secret` signs every sign-in token: leaking it means anyone can mint one.
Deleting that row and restarting the rooms signs everybody out.

## Adding a room

1. `deploy/instances/sfh3-server-8.conf` — copy one, change the name, kind and mode.
2. Two lines in `deploy/nginx/sfh3.retris.io` for `/ws/8` → `127.0.0.1:7808`.
3. One row in `public/servers.json`.

Then install the conf, `systemctl enable --now sfh3-server@8`, `nginx -t &&
systemctl reload nginx`, and redeploy the static half so the new
`servers.json` ships.

## Checking it

```sh
systemctl status 'sfh3-server@*'
journalctl -u sfh3-server@1 -n 50 --no-pager
curl -s https://sfh3.retris.io/ws/1/info | jq .
curl -s https://sfh3.retris.io/servers.json
```

`/info` answering with `"ok": true` and a `protocol` matching the client's is
the whole health check: it proves the process is up, that nginx routes the path,
and that the two halves agree on the wire format.

## Status page and crash alerts

Every room answers `GET /status` (loopback
`http://127.0.0.1:780N/status`, public `https://sfh3.retris.io/ws/N/status`
through the existing `/ws/N/` location -- no nginx change). The page is
**https://sfh3.retris.io/status.html**; it ships with the static deploy like
`servers.json` and needs nothing on the box.

Reading a card: the top edge is cyan when the room answers and red when it
does not. `tick` is the time one `room.update()` takes against the 33 ms
budget over the last minute -- green is plenty of headroom, amber means some
tick overran (a round start inflating a map mask does this once, and is
normal), red means the mean is past half the budget or more than 1 in 20 ticks
overran, which players feel. `errors` counts every `console.error` since the
process started; the last 20 lines (addresses and tokens scrubbed) fold out
under it. `uptime` resetting on its own is a crash that systemd restarted.

The watchdog is one Node script run once a minute by a timer. It checks each
unit (`is-active`, `NRestarts`) and each loopback `/status`, keeps what it saw
in `/var/lib/sfh3/watch.json`, and posts only when something **changes**: a
room going down, coming back, being restarted by systemd, logging 5+ errors in
a minute, or its tick turning red (and back).

```sh
# the script and the two units
sudo install -m 644 sfh3-watch.mjs /opt/sfh3/sfh3-watch.mjs
sudo install -m 644 sfh3-watch.service sfh3-watch.timer /etc/systemd/system/

# the webhook -- root-only, it is a credential. Empty = log to the journal only.
sudo install -m 600 -o root -g root watch.env.example /etc/sfh3/watch.env
sudoedit /etc/sfh3/watch.env        # SFH3_ALERT_WEBHOOK=https://discord.com/api/webhooks/...

sudo systemctl daemon-reload
sudo systemctl enable --now sfh3-watch.timer

# check it
systemctl list-timers sfh3-watch.timer
sudo systemctl start sfh3-watch.service && journalctl -u sfh3-watch -n 20 --no-pager
sudo -u sfh3 node /opt/sfh3/sfh3-watch.mjs --dry-run   # prints the payload, sends and saves nothing
```

Discord (`{content}`) and Slack (`{text}`) URLs are recognised; anything else
gets generic JSON (`{source, host, at, alerts[], text}`), or force one with
`SFH3_ALERT_FORMAT`. A post that fails is kept and retried on the next pass.
A room seen down on the very first pass alerts; a room seen up does not.
Deleting `watch.json` resets the baseline.

The rooms' `Restart=always` / `RestartSec=3` is explicit in
`sfh3-server@.service`; five crashes inside a minute trips `StartLimitBurst`
and the unit stays `failed` (the watchdog says `DOWN ... unit is failed`) until
`sudo systemctl reset-failed sfh3-server@N && sudo systemctl start sfh3-server@N`.

## Removing it all

```sh
sudo systemctl disable --now sfh3-watch.timer sfh3-server@{1..7}
sudo rm -f /etc/systemd/system/sfh3-server@.service /etc/sfh3/sfh3-server-*.conf
sudo rm -f /etc/systemd/system/sfh3-watch.service /etc/systemd/system/sfh3-watch.timer
sudo rm -rf /opt/sfh3 /etc/sfh3 /var/lib/sfh3
sudo systemctl daemon-reload
sudo userdel sfh3
sudo mv /etc/nginx/sites-available/sfh3.retris.io{.bak,}
sudo nginx -t && sudo systemctl reload nginx
```
