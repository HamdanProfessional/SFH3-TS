# Strike Force Heroes 3, in your browser

Strike Force Heroes 3 was one of the best Flash shooters out there. When Flash died it more or less died with it, so I rebuilt it to run in a normal browser. Same heroes, same campaign, same guns and killstreaks, now running on WebGL with PixiJS and TypeScript instead of the Flash Player.

On top of the original game there are a few things I always wanted in it: online multiplayer, a map editor, gamepad and touch controls, and a workshop where you can craft weapons.

**Play it right now:** https://sfh3.retris.io

It works in any recent version of Chrome, Firefox, Edge or Safari. On a phone you get on-screen controls.

## Running it yourself

You'll need:

- **Node.js 22.13 or newer.** The game on its own runs on Node 20, but the multiplayer server uses Node's built-in SQLite, which needs 22.13.
- **Python 3 with Pillow** (`pip install pillow`). It's only used once, to turn the images into WebP. If your system calls it `python3`, use that in the commands below.

Then:

```sh
git clone https://github.com/HamdanProfessional/SFH3-TS.git
cd SFH3-TS
npm install
python tools/webp.py
npm run dev
```

Open http://localhost:5173 and you're in.

About that `webp.py` step: the game loads a `.webp` copy of every image, and those copies aren't kept in the repo. The script makes them from the PNGs. The first run takes a minute or two. After that it only redoes images that changed, so you can run it again whenever you like.

### Making a build to host

```sh
npm run build
```

That drops a static site into `dist/`, which you can put on any web host. `npm run preview` serves it locally if you want to check it first.

## Multiplayer on your own machine

The game server is a separate Node program. Build it once, then start it:

```sh
npm run build:server
node server/dist/sfh3-server.cjs
```

That starts a Team Deathmatch room on port 7801, filled up with bots. With `npm run dev` running as well, open the **Multiplayer** tab and you'll see **Local server** at the top of the list. Open a second browser window if you want to join with another hero.

A few useful options:

| Option | What it does |
|---|---|
| `--port 7802` | which port to listen on |
| `--mode ctf` | the mode: `tdm`, `dm`, `ctf`, `dom`, `gg` and more |
| `--map street` | which campaign map to play |
| `--bots 4` | how many bots fill the empty slots |
| `--db accounts.db` | turns on sign-in, saved online squads and ranked |

Running real public servers (systemd, nginx and so on) is covered in `deploy/README.md`.

## How to play

You run a squad of heroes. Take them into missions, earn money and experience, then spend it on better guns, new heroes, perks and upgrades. Kill enough enemies without dying and your killstreak fills up. Fire it for turrets, a death ray, aimbot, wallhacks, squad healing and the rest.

### Keyboard and mouse

| Key | Action |
|---|---|
| A / D or ← / → | move |
| W, ↑ or Space | jump |
| S or ↓ | crouch |
| Mouse | aim |
| Left click | shoot |
| Right click | reload by default. You can switch it to killstreak or swap gun in Options |
| R | reload |
| Q or Shift | swap weapon |
| E or Ctrl | use your killstreak |
| Esc or P | pause |

### Gamepad

Plug one in and press any button. The left stick moves, the right stick aims, RT fires and A jumps. X reloads, Y or RB swaps guns, and B or LB fires your killstreak. Start pauses. You can change the aim distance under Options → Controls.

### Touch

On a phone or tablet the on-screen controls show up by themselves. You can pick a layout, resize the buttons and drag them where you want under Options → Controls.

## What's in it

- **The whole campaign.** All 60 missions, right up to the final fight against the two developers.
- **Heroes.** Eight classes plus the unique heroes. Hire them, level them up and choose their perks.
- **Store, slot machine and workshop.** Buy guns, gamble on the slots, build blueprints and upgrade weapons. You can also craft any weapon you've unlocked at the level you want. The rarity is down to luck.
- **Daily missions and quick matches.**
- **Map editor.** Draw your own maps, give them a mission, and share them with a link. You can also load any campaign map into it and remix it.
- **Online multiplayer.** Team Deathmatch, Capture the Flag, Free-For-All, a co-op campaign, ranked, clan wars and custom-map rooms.

### Cheats

Open your browser's developer console (F12) and type `sfh3.help()`. You can give yourself money, unlock every mission, hire any hero you like and more. Your save lives in your browser's local storage, so this only touches your own game.

Two handy keys during a match: **B** switches the bots on and off, and **M** shows hitboxes.

## Where things are

| Folder | What's inside |
|---|---|
| `src/` | the game itself |
| `server/` | the multiplayer server |
| `public/` | art, sounds, fonts and the server list |
| `tools/` | the scripts that pulled the art and data out of the original game. You don't need them to play: everything they make is already in the repo. |
| `deploy/` | config for running the public servers |

## Credits

Strike Force Heroes 3 was made by **Sky9 Games** (Justin Goncalves and Mike Sleva). The original game was sponsored by Armor Games and Not Doppler. All the art, music, sound effects, characters and names are theirs.

This is a fan project made out of love for the game, and it's free. It isn't affiliated with or endorsed by Sky9 Games. If you hold the rights and want something taken down, open an issue and I'll sort it out.
