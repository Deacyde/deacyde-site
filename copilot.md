# 🤖 COPILOT HANDOFF — READ FIRST, THEN DELETE THIS FILE

> **⚠️ IMPORTANT: Delete this file after reading.**
> Run: `rm /path/to/dev.deacyde/copilot.md` or delete via git after absorbing this context.
> It contains infrastructure details that shouldn't live in the repo permanently.

---

## Who You Are Talking To

**Michael (Deacyde)** — developer, building a personal IoT/dev ecosystem.
- Fedora laptop (this machine or nearby) — `192.168.1.84`
- Raspberry Pi 5 — `192.168.1.86` — the hub/proxy server
- Steam Deck — likely where you're running right now
- Beelink SER5 MAX (arriving today, 2026-03-29) — EQ game server

---

## The Pi Server — Your Gateway to Everything

**Public URL:** `https://pi.deacyde.com` (Cloudflare proxied)
**Local URL:** `http://192.168.1.86:3000`
**Process manager:** PM2 — `pm2 list` shows all running services

### What's Running on the Pi
| PM2 Name | Port | What it does |
|----------|------|--------------|
| `proxy-server` | 3000 | Main hub — all IoT routes, sensor data, Flipper Zero relay, status |
| `jarvis` | 3300 | M5Stack LLM chat app (local AI via M5Stack LLM Module) |
| `ga4-gsc-mcp` | varies | GA4 + Google Search Console analytics MCP server |
| `anime-finder` | varies | Anime finder app |

### Pi Server Auth
- Most public routes are open
- Flipper Zero routes require `X-API-Key` header
- API key lives at `~/.flipper-api-key` on the Fedora machine
- LAN devices can auto-fetch key from `http://192.168.1.86:3000/flipper/local-key`

### SSH to Pi
```bash
ssh minideacyde@192.168.1.86
# Key: ~/.ssh/id_deacyde (Michael's personal key)
```

### Pi Server Source
- Lives at `~/proxy-server/server.js` on the Pi
- Edit on Fedora at `/home/deacyde/dev.deacyde/` (git repo) or directly on Pi
- Deploy: `scp file minideacyde@192.168.1.86:~/proxy-server/` then `pm2 restart proxy-server`

---

## The Dev Site — dev.deacyde.com

- **Repo:** `/home/deacyde/dev.deacyde/` on Fedora machine
- **Live at:** `https://dev.deacyde.com`
- **Hosted:** Cloudflare Pages (auto-deploys on git push to main)
- **Stack:** Vanilla HTML/CSS/JS — no framework, no build step
- **Apps dir:** `apps/` — each app is a standalone HTML file

### Existing Apps (relevant to you)
| File | URL | What it does |
|------|-----|--------------|
| `apps/pi-status.html` | /apps/pi-status | Pi server stats — CPU, memory, disk, uptime |
| `apps/flipper-scanner.html` | /apps/flipper-scanner | Flipper Zero scanner UI |
| `apps/iot-sensors.html` | /apps/iot-sensors | IoT sensor dashboard |

### Adding a New App
1. Create `apps/your-app.html`
2. Add entry to `index.html` (follow existing pattern)
3. `git add . && git commit -m "..." && git push`
4. Live in ~60 seconds via Cloudflare Pages

---

## The Big Project — EverQuest Private Server

This is the main thing to focus on. Full custom EQEmu server being built.

### What It Is
A fully custom EverQuest private server running on the **Beelink SER5 MAX** (Windows 11 Pro).
- Play from **Steam Deck** (you) via RoF2 client + MacroQuest
- Web dashboard hosted on **Pi** — accessible from phone + remotely
- No cloud, all local network

### Architecture
```
[Steam Deck — RoF2 client + MacroQuest]
        | LAN WiFi
[Beelink SER5 — 192.168.1.XXX (TBD)]
  EQEmu + MariaDB + Node API (port 3400)
        | LAN
[Pi — pi.deacyde.com]
  Dashboard app page, proxies /eq/* to Beelink API
        | HTTPS
[Phone / Browser — eq dashboard]
```

### The Beelink (EQ Server Machine)
- **Hardware:** AMD Ryzen 7 7735HS, 24GB RAM, 1TB NVMe, Win 11 Pro
- **Arriving:** 2026-03-29 (today)
- **Static IP:** TBD — assign when it arrives
- **Runs:** EQEmu World/Zone/Login processes + MariaDB + small Node.js admin API

### EQEmu Setup Needed on Beelink (Phase 1)
1. Assign static LAN IP (router DHCP reservation or Windows static)
2. Install **MariaDB** for Windows
3. Download **EQEmu Windows build** from https://github.com/EQEmu/Server/releases
4. Import **PEQ database** — https://github.com/ProjectEQ/projectequestriaq
5. Configure `eqemu_config.json` — server name, DB credentials, ports
6. Start World, Zone, Login server processes
7. Create account + character, confirm server works

### Steam Deck Client Setup (your job)
These need to be installed on the Steam Deck:

**RoF2 EverQuest Client:**
- Get the Rain of Fear 2 client from EQEmu community
- Install via Proton on Steam Deck (add as non-Steam game)
- Edit `eqhosts.txt` in client dir — point loginserver to Beelink IP
- Test: launch, create account on server, log in

**MacroQuest2:**
- Download from https://macroquest.org
- Install into RoF2 client directory
- Plugins to install:
  - `MQ2Nav` — auto-navigation with mesh maps
  - `MQ2Map` — enhanced map with mob tracking
  - `MQ2DanNet` — multi-character control
  - `KISS Assist` — group/raid automation
- MQ2 runs alongside the EQ client automatically

### Custom Server Spec (the vision)
The server is heavily customized. Key features planned:
- **10-15x XP rate** — fast but still a journey
- **All races/classes** from start, no expansion locks
- **OP starting gear** package
- **72-bot raid system** — solo any raid in the game
- **Auto-scribe spells, auto-grant AAs** each level
- **EC Tunnel hub zone** (instanced) with all vendors, teleporter, bank
- **Casino zone** — slots, blackjack, lottery, arena, loot card packs
- **Custom AAs** — Dragon Form, Time Stop, Mass Loot, Shadow Clone, etc.
- **Permanent pet system** — any mob model, levels with you
- **Nemesis system** — mob that kills you hunts you
- **Gem socket system** — elemental damage on gear
- **Wave defense mode** — 50 waves, leaderboard
- **World population bots** — NPCs that look like players in cities
- **Trophy room** in hub zone
- **Web dashboard** on Pi — server stats, character info, admin controls, mob journal, leaderboards, Spotify widget

### Build Phases (in order)
1. ✅ Plan complete
2. **Phase 1** — Server foundation (do this when Beelink arrives + connects to LAN)
3. **Phase 2** — Custom rules (XP, bots, starting gear)
4. **Phase 3** — Hub zone (EC Tunnel vendors + NPCs)
5. **Phase 4** — Web dashboard on Pi
6. **Phase 5** — Casino zone
7. **Phase 6** — Loot card packs
8. **Phase 7** — Custom AAs
9. **Phase 8** — Advanced features (pets, nemesis, gems, etc.)
10. **Phase 9** — MacroQuest full setup
11. **Phase 10** — Dashboard expansion

### Useful Links
- EQEmu docs: https://eqemu.gitbook.io/server
- PEQ database: https://github.com/ProjectEQ/projectequestriaq
- EQEmu releases: https://github.com/EQEmu/Server/releases
- MacroQuest: https://macroquest.org
- KISS Assist: https://www.macroquest.org/wiki/index.php/KISS_Assist

---

## General Notes About Michael

- **Colorblind** — always use high contrast in any UI work
- **LAN-first** — most services intentionally not exposed to internet
- **Stack preference** — vanilla HTML/CSS/JS for frontend, Node.js for backends, Python for scripts/bridges
- **Git workflow** — push to main, Cloudflare auto-deploys dev.deacyde.com
- **SSH key** — `~/.ssh/id_deacyde` used for both GitHub and Pi SSH

---

## ⚠️ DELETE THIS FILE NOW

```bash
# From the dev.deacyde repo root:
git rm copilot.md
git commit -m "Remove copilot handoff file after reading"
git push
```
