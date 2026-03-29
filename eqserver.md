# EQEmu Server — Status & Notes
**Last updated: 2026-03-29**

---

## What's Been Done ✅

### Test Server — Fedora Laptop (192.168.1.84)
The EQEmu test server is **fully running** on the Fedora laptop while we wait for the Beelink to arrive.

**Server status:** World: UP | Zones: UP | UCS: UP | Queryserv: UP

### What Was Installed
1. **Dependencies** — cmake, gcc, perl, mariadb, etc. via DNF
2. **MariaDB** — secured, running, enabled on boot
3. **PEQ Database** — 222 tables imported (items, NPCs, zones, spells, rules)
   - Source: Wayback Machine archive (db.projecteq.net is dead)
   - 618 zones, 117,944 items, 67,530 NPC types
4. **EQEmu Binaries** — v23.10.3 pre-built release, at `/home/eqemu/server/`
   - world, zone, loginserver, eqlaunch, shared_memory, queryserv, ucs
5. **eqemu_config.json** — configured with server name, DB creds, world IP
6. **Opcode patch files** — Titanium, SoF, SoD, UF, RoF, RoF2 (all loading)
7. **PEQ Quests** — full quest scripts deployed to `quests/`
8. **Firewall** — ports 5998, 5999, 7000-7100 UDP + 9000 TCP open
9. **database:updates** — DB version matches binary (9328) — fully in sync

---

## Credentials

| Thing | Value |
|-------|-------|
| Server IP | `192.168.1.84` |
| Login server port | `5999` |
| World TCP port | `9000` |
| MariaDB root | `EQrootpass123!` |
| MariaDB eqemu user | `eqemupass` |
| DB name | `peq` |
| EQEmu system user | `eqemu` |

---

## What's Still Needed

### To Connect from Steam Deck
1. **Create an EQEmu account** at: http://www.eqemulator.org/account/?CreateLS
2. **Update eqhost.txt** in your RoF2 client directory:
   ```
   [LoginServer]
   Host=192.168.1.84:5999
   ```
3. Launch EQ — use your eqemulator.org account to log in

### Server Side (optional but recommended)
- **Download maps** — `/home/eqemu/server/maps/` is empty; zones work but look bare
  - Try: https://github.com/Akkadius/eqemu-maps/releases or EQEmu Discord
- **Restart command**: `sudo -u eqemu bash -c "cd /home/eqemu/server && ./server_stop.sh && ./server_start.sh"`
- **Status command**: `sudo -u eqemu bash -c "cd /home/eqemu/server && ./server_status.sh"`

---

## Migration Plan — Move to Beelink SER5 MAX

When the Beelink arrives:
1. Assign static IP (router DHCP reservation)
2. Install MariaDB for Windows + EQEmu Windows binaries
3. Import the PEQ dump from the Fedora server:
   ```bash
   sudo bash -c "mysqldump -u root -p'EQrootpass123!' peq | gzip > /tmp/peq-backup.sql.gz"
   # scp to Beelink, import into Windows MariaDB
   ```
4. Copy `eqemu_config.json`, quests, patch files
5. Update `world.address` to Beelink IP
6. Update Steam Deck `eqhost.txt` to Beelink IP
7. Shut down Fedora test server

---

## Architecture (Long-Term Vision)

```
[Steam Deck — RoF2 client + MacroQuest]
        | LAN WiFi
[Beelink SER5 MAX — EQ Server]
  EQEmu World/Zone/Login + MariaDB + Node API (port 3400)
        | LAN
[Pi — pi.deacyde.com]
  Web dashboard — server stats, character info, admin panel
```

### Custom Server Features Planned
- 10-15x XP rate, all races/classes unlocked from start
- 72-bot raid system (solo any raid)
- Auto-scribe spells + auto-grant AAs per level
- EC Tunnel hub zone with vendors, teleporter, bank
- Casino zone, wave defense mode, leaderboards
- Custom AAs: Dragon Form, Time Stop, Mass Loot
- Permanent pet system, Nemesis system, gem socket system
- Pi web dashboard with Spotify widget

---

## Useful Links
- EQEmu docs: https://eqemu.gitbook.io/server
- EQEmu releases: https://github.com/EQEmu/EQEmu/releases
- MacroQuest: https://macroquest.org
- Create login account: http://www.eqemulator.org/account/?CreateLS
