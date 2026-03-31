# EQEmu Server — Full Debug Journal
**Project:** Deacyde Private EverQuest Server  
**EQEmu:** v23.10.3 | **Expansion:** 9 — Dragons of Norrath | **Client:** RoF2 via Steam Deck (Proton)  
**Last updated: 2026-03-30**

---

## The Goal

Run a private EverQuest server on a Fedora Chromebook and connect to it from a Steam Deck using a RoF2 (Rain of Fear 2) client via Proton. Get a player character fully into the game world. Eventually migrate the server to a Beelink SER5 MAX mini PC for a permanent home lab setup.

---

## Environment

| Component | Details |
|-----------|---------|
| Server hardware | Acer Chromebook — Fedora installed as primary OS (no ChromeOS) |
| Server IP | `192.168.1.84` |
| Server RAM | ~3.7 GB usable |
| EQEmu version | v23.10.3 (October 2023 pre-built release) |
| Expansion set | 9 — Dragons of Norrath |
| PEQ database | Project EQ database, 222 tables, Sept 2025 snapshot |
| Client hardware | Steam Deck (192.168.1.238) |
| EQ client | Rain of Fear 2 (RoF2) via Proton ULWGL-8.0-5-3 |
| Proton launch flags | `PROTON_NO_ESYNC=1 PROTON_NO_FSYNC=1 PROTON_USE_WINED3D=1` |
| EQ zone ports | UDP 7000–7100 |

---

## Phase 1 — Installing the Server

### What was supposed to happen vs. what actually happened

The plan was to run the official EQEmu installer script. This failed almost immediately.

**Problem 1: The EQEmu installer is broken.**  
The installer (`install.sh`) relies on a Perl script called `eqemu_server.pl` that was removed from the EQEmu GitHub repository in commit `b280f50c`. It no longer exists. Any documentation pointing to the installer is outdated.

**Problem 2: The PEQ database source is dead.**  
`db.projecteq.net` — the canonical source for the Project EQ database — is completely gone. DNS doesn't resolve. This is where the installer would have downloaded the database from.

### How we got around it

**Binaries:** Downloaded the pre-built EQEmu v23.10.3 release directly from GitHub releases (`eqemu-server-linux-x64.zip`, 159MB). `wget` kept dying mid-download around 27–38MB. Switched to `curl -L --continue-at -` which resumed reliably.

**Database:** Found a Wayback Machine snapshot of the PEQ database from September 28, 2025:  
`http://web.archive.org/web/20250928111529/https://db.projecteq.net/api/v1/dump/latest`  
This 31MB zip contained 12 SQL files totaling 267MB uncompressed. Imported in order: system tables → player tables → state tables → login tables → content tables (261MB — items, NPCs, zones, spells). Result: 222 tables, 618 zones, 117,944 items, 67,530 NPC types.

**Configuration:**  
Manually wrote `eqemu_config.json`. Critical discovery: the fields `longname`, `shortname`, and `loginserver1` must all live under `server.world`, **not** directly under `server`. This is not obvious and caused world registration to fail until corrected.

**Opcode patch files:**  
World started but logged "Unable to open opcodes file" for all clients (Titanium, SoF, SoD, UF, RoF, RoF2). Downloaded all patch `.conf` files from `EQEmu/EQEmu/utils/patches/` on GitHub. Had to use `sudo bash -c "chown eqemu:eqemu /home/eqemu/server/*.conf"` because standard `sudo chown` with wildcards fails — the shell expands the glob before sudo, and the non-root user can't see inside `/home/eqemu`.

**Result:** Server started. World UP, 30 zones UP, Queryserv UP.

---

## Phase 2 — Getting the Steam Deck Connected

### Login server discovery

The loginserver binary wasn't starting — it needs its **own separate config file** called `login.json`, not anything inside `eqemu_config.json`. Once created with the database credentials and `listen_port: 5998`, the loginserver came up and the world server registered successfully as "Deacyde Test Server."

Added `./loginserver &` to `server_start.sh` so it auto-starts.

### MySQL socket mismatch on Fedora

The EQEmu loginserver binary has `/run/mysqld/mysqld.sock` hardcoded, but Fedora puts its MariaDB socket at `/var/lib/mysql/mysql.sock`. Fixed with a symlink:

```bash
sudo mkdir -p /run/mysqld
sudo ln -sf /var/lib/mysql/mysql.sock /run/mysqld/mysqld.sock
```

This symlink disappears on reboot. Made it permanent via:  
`/etc/tmpfiles.d/mysqld-compat.conf` → `L /run/mysqld/mysqld.sock - - - - /var/lib/mysql/mysql.sock`

### Wrong login port for RoF2

Steam Deck connected to the server but login credentials never arrived. tcpdump showed the session handshake completing, then nothing. 

Root cause: EQEmu loginserver runs **two separate UDP listeners**:
- Port **5998** — Titanium-era clients
- Port **5999** — SoD+ clients (this is what RoF2 needs)

Each port sends a different version of `OP_ChatMessage` (opcode `0x0016` vs `0x0017`). When connected to the wrong port, the client never receives the correct handshake reply and never shows the login form. Changed `eqhost.txt` on the Steam Deck to port `5999`.

### Wrong password security mode

Login now reached the server but credentials were rejected. The loginserver was configured with `security.mode: 6` (Argon2), but the account was created with the CLI tool `./loginserver login-user:create` which always generates SCrypt hashes (`$7$...` prefix = mode 14) regardless of the mode setting. The stored hash format must match the verification mode. Changed `login.json` to `security.mode: 14`.

**Result:** Login succeeded. Server appeared in server list.

---

## Phase 3 — Server Shows as "DOWN"

After login, the server showed as "DOWN" in the server list even though everything appeared running.

Root cause: EQEmu world sends a status of `-2` to the loginserver when it has zero active zone processes. The world binary's status reporter (`SerializeForClientServerList()`) treats any negative value as DOWN.

Why were zones all down? They were crashing on startup. Two reasons:

### Problem 1: Missing lua_modules / plugins directories

Zone binary's `CheckForCompatibleQuestPlugins()` scans `{server_path}/lua_modules/` and `{server_path}/plugins/` for files containing the string "CheckHandin". But these directories live at `quests/lua_modules/` and `quests/plugins/`. Zone exited immediately with "incompatible quest plugins."

Fix:
```bash
ln -sf /home/eqemu/server/quests/lua_modules /home/eqemu/server/lua_modules
ln -sf /home/eqemu/server/quests/plugins /home/eqemu/server/plugins
```

### Problem 2: Missing `/opt/eqemu-perl` directory

Zone binary (release builds) checks `if (!fs::exists("/opt/eqemu-perl"))`, then calls `getchar()` and exits. With no stdin to read from, it hangs until the file descriptor returns EOF, then exits immediately. Creating the empty directory satisfies the check:

```bash
sudo mkdir -p /opt/eqemu-perl
```

**Result:** 30 zones connected to world, server shows UP.

---

## Phase 4 — Zone Crashes on Player Connection (Perl ABI Mismatch)

Player created a character, attempted to zone into freeporteast — zone crashed with a SIGSEGV in `Embperl::dosub` while loading `quests/freeporteast/Joffin_Sinclay.pl`.

Root cause: The zone binary's RUNPATH is `/opt/eqemu-perl/lib/5.32.1/x86_64-linux-thread-multi/CORE`. We had created that directory but left it empty. The dynamic linker fell back to the system `libperl.so` (Perl **5.42.1** on this Fedora). The binary was compiled against Perl **5.32.1**. These are ABI-incompatible — instant segfault when Perl is invoked.

Fix: Compiled Perl 5.32.1 from source, installed to `/opt/eqemu-perl`. On GCC 14 (current Fedora), two modules are incompatible: `SDBM_File` and `Math-BigInt-FastCalc`. Had to rename those directories before build, then `make install -k` to skip failures. The core `libperl.so` built successfully and EQEmu doesn't use those two modules anyway.

### server_launcher.pl false duplicate detection

After the Perl install, restarting the server failed — `server_launcher.pl` reported "Launcher already running" and refused to start. The script uses `ps aux | grep server_launcher` to detect duplicates. When launched via `sudo bash -c 'perl server_launcher.pl ...'`, both the bash process and the sudo parent show `server_launcher.pl` in their command line → false count > 1.

Fix: Replaced the ps-grep check with a PID file approach using `/tmp/eqemu_launcher.pid`.

**Result:** Zones boot, Perl quests load, server launcher works correctly.

---

## Phase 5 — "Error Loading Inventory" — Can't Zone In

Every zone-in attempt now failed silently from the player's perspective — loading screen would briefly attempt and fail. Zone log showed: `Error loading inventory for char_id X from the database.`

This took several sessions to fully trace. Here's the full chain:

### Layer 1: Empty inventory table is a hard failure

Found in EQEmu source (`common/shareddb.cpp`, `SharedDatabase::GetInventory()`):
```cpp
if (results.empty()) {
    LogError("Error loading inventory for char_id {} from the database.", charid);
    return false;
}
```

Any character with **zero rows** in the `inventory` table cannot zone in. Full stop. This is not a "warning" — it returns false and the zone boots the client.

New characters were being created with zero inventory because the starting items for East Freeport are all "Tattered Note" items with `norent=1` and `slots=0`. The `SetStartingItems()` function calls `FindFreeSlot()` which fails for these items, so nothing gets inserted into the inventory table.

Fix: Manually inserted placeholder inventory rows for the character before each zone-in attempt.

### Layer 2: Missing `deleted_at` column

Zone binary also runs a query: `FROM inventory WHERE character_id = '{}' AND deleted_at IS NULL`. The inventory table didn't have a `deleted_at` column — this caused a different SQL failure.

Fix: `ALTER TABLE inventory ADD COLUMN deleted_at DATETIME DEFAULT NULL`

### Layer 3: Stale shared memory caused all items to appear invalid

After adding the `deleted_at` column, the zone started logging:  
`Warning: charid [4] has an invalid item_id [5001] in inventory slot [13]`  
...for every single item, including Short Sword (5001) which absolutely exists in the database.

Root cause: Adding the column triggered EQEmu to regenerate the shared memory file (`/home/eqemu/server/shared/items`) at 17:11. But the 30 zone processes had started at 16:04 and loaded the **old** shared memory. Now all `GetItem()` calls returned null. Every item looked invalid.

Fix: Kill all zone processes so they respawn and reload shared memory with the new schema.

**Important lesson:** Any time shared memory is regenerated — whether by a schema change, a `shared_memory` binary rerun, or an EQEmu migration — all zone processes must be restarted.

### Layer 4: Missing map files caused zone crashes

After restarting zones with valid shared memory, freeporteast crashed during boot with a signal handler ("Crash" log entry). Root cause: `/home/eqemu/server/maps/` was completely empty. Some zones require map files to boot successfully.

Fix: Downloaded map pack from GitHub (`eqemu-maps` repository releases). Extracted to `/home/eqemu/server/maps/`. Zones booted successfully after this.

### Layer 5: Char select crashing from corrupted character data

Each failed zone-in caused the client to go linkdead. The zone would save a corrupted character state back to the DB (zone_id changed to a wrong value, sometimes 189 for tutorialb). This corrupted `character_data` caused the RoF2 client to crash at the character select screen on the next login attempt.

Pattern: zone-in fails → character corrupted → char select crashes → must soft-delete the character and start over.

Went through char_ids 1 through 4 this way before finally stopping the cycle by fixing the root causes.

### Char select bug: tutorialb crashes

Char_id=1 was created with "Tutorial" checked, which put them in Mines of Gloomingdeep (zone 189, tutorialb). That zone crashed every time it tried to boot — consistently, after loading respawn timers. Never resolved — just moved that character to a working zone via direct SQL update and stopped using the tutorial.

**Result after all five layers fixed:** Character (char_id=4, Deacyde) could reach the zone server, zone loaded their data, inventory loaded. Progress.

---

## Phase 6 — UCS Missing (Chat Server Not Running)

Despite fixing inventory, zone-in still appeared to hang. Investigated UCS (Universal Chat Service). 

UCS binary existed at `/home/eqemu/server/ucs` but was crashing immediately on startup. Last line in its log: "Unable to open opcodes file." The file `mail_opcodes.conf` did not exist in the server directory.

Fix: Created `/home/eqemu/server/mail_opcodes.conf` with the mail opcode values from `patch_RoF2.conf` (all `0x0000` for RoF2, which is expected — the mail system uses different channels).

UCS came up: "Loaded [281] filtered channel name(s)." World confirmed: "New UCS Server connection from [127.0.0.1]."

Was this the cause of the hang? No. Zone-in still hung after UCS was online. But UCS was a real missing piece that would have caused issues later (chat, mail, etc.).

---

## Phase 7 — The Loading Bar Hang (Current State)

This is where we are stuck. The zone-in gets further than ever before:

1. Player logs in ✅
2. Char select loads ✅  
3. Player clicks Enter World → zone loading screen appears ✅
4. Loading bar fills to 100% ✅
5. **Loading bar stays full. Nothing happens. Game never starts.**
6. After 2–5 minutes the client disconnects / goes linkdead.

### What we confirmed is working

- Zone receives the player connection
- Zone successfully loads all character data from the DB (all MySQL queries complete in under 1 second)
- Zone sends packets to the client (confirmed via tcpdump: UDP traffic from server to Steam Deck)
- Client receives the packets (sends back 7-byte EQStream ACKs)
- Client's loading bar reaches 100% (meaning zone profile data IS reaching the client)
- UCS is online
- Shared memory is fresh
- Inventory has valid items
- Map files exist

### What's NOT happening

By enabling full packet trace logging (`logsys_categories` set to Trace level for categories 83, 84, 15, 102 — must be set **before** zone startup), we captured the complete packet exchange for a zone-in attempt.

**Client → Server packets received:**
```
OP_ZoneEntry           [0x5089]   ← zone-in begins
OP_AckPacket
OP_QueryUCSServerStatus
OP_CharInventory
OP_MercenaryTimerRequest
OP_Unknown             [0x4820]  Size: 6   ← CRITICAL: unrecognized
OP_SendAATable
OP_UpdateAA
OP_TargetMouse
OP_Unknown             [0x5bd5]  Size: 78  ← unrecognized
OP_Unknown             [0x5148]  Size: 2   ← unrecognized
OP_Unknown             [0x76c3]  Size: 2   ← unrecognized
OP_Unknown             [0x356f]  Size: 2   ← unrecognized
OP_Unknown             [0x754e]  Size: 2   ← unrecognized
```

**Server → Client packets sent:**
```
OP_PlayerProfile       ✅
OP_ZoneEntry (x3)      ✅  (player spawn + NPC spawns)
OP_TimeOfDay           ✅
OP_TributeUpdate       ✅
OP_TributeTimer        ✅
OP_CharInventory       ✅
OP_XTargetResponse     ✅
OP_Weather             ✅
OP_NewZone             ✅
OP_RespondAA           ✅

──── HANG POINT ────

OP_SpawnDoor           ❌ NEVER SENT  (freporte has 79 doors)
OP_GroundSpawn         ❌ NEVER SENT
OP_WorldObjectsSent    ❌ NEVER SENT
OP_ZoneServerReady     ❌ NEVER SENT
OP_SendExpZonein       ❌ NEVER SENT
OP_ClientReady         ❌ NEVER SENT  ← this is what makes the client enter the world
```

### The zone-in state machine (from EQEmu source)

Reading `zone/client_packet.cpp` from EQEmu GitHub, the zone-in follows a strict state machine:

```
ReceivedZoneEntry
  → PlayerProfileLoaded
    → ZoneInfoSent          (server sends Weather, NewZone — then WAITS)
      → ClientSpawnRequested  (server receives OP_ReqClientSpawn from client)
        → ZoneContentsSent    (server sends doors, objects, ClientReady)
```

After sending `OP_NewZone`, the server sets state to `ZoneInfoSent` and waits for the client to send `OP_ReqClientSpawn`. Only after receiving that packet does it send doors, ground spawns, zone points, and critically — for **RoF2 clients specifically** — `OP_ClientReady` (S→C direction). This `OP_ClientReady` from the server to the client is what triggers the client to leave the loading screen and enter the 3D world.

The server was sitting in `ZoneInfoSent` state forever, waiting for a packet that never came.

### Root cause: opcode mismatch in patch_RoF2.conf

`/home/eqemu/server/patch_RoF2.conf` is the translation table between EQEmu's internal opcode names and the actual wire opcodes the RoF2 client uses. This file had:

```
OP_ReqClientSpawn=0x35fa
```

But looking at the packet log — the client sent `OP_Unknown [0x4820]` (6 bytes) at exactly the point in the sequence where `OP_ReqClientSpawn` should be sent (right after receiving `OP_NewZone`, before the AA table request). Opcode `0x4820` had **no mapping in the entire file**. The server received it, logged it as unknown, and ignored it.

The server was waiting for wire opcode `0x35fa`. The client was sending `0x4820`. Neither side ever moved past this point.

Checked GitHub's master branch `patch_RoF2.conf` — it also has `0x35fa`. This suggests the opcode table has been wrong for a long time in EQEmu, or at minimum doesn't match the specific RoF2 client build we're using on the Steam Deck.

### The fix applied

```bash
sudo -u eqemu sed -i 's/OP_ReqClientSpawn=0x35fa/OP_ReqClientSpawn=0x4820/' \
  /home/eqemu/server/patch_RoF2.conf
```

Then killed all zone processes (so they respawn and reload the updated opcode file — zones read `patch_RoF2.conf` at startup) and reset the `ingame` flag in the DB:

```sql
UPDATE character_data SET ingame=0 WHERE id=4;
```

### What should happen when the fix works

Once the server recognizes `0x4820` as `OP_ReqClientSpawn`, it calls `Handle_Connect_OP_ReqClientSpawn()` which:

1. Sends `OP_SpawnDoor` — all 79 doors in freporte
2. Sends `OP_GroundSpawn` — zone objects
3. Sends `OP_SendZonePoints` — zone connections
4. Sends `OP_SendAAStats`
5. Sends `OP_ZoneServerReady`
6. Sends `OP_SendExpZonein`
7. **Sends `OP_ClientReady` (RoF2+ only, S→C direction)** ← **client exits loading screen, enters world**
8. Sends `OP_WorldObjectsSent`

For RoF2 clients, `OP_ClientReady` goes from server **to** client (reversed from older clients where the client sends it). Receiving this packet is what makes the EQ client transition from the loading screen into the actual 3D game world.

### Other unrecognized client opcodes (will need investigation)

Even after fixing `OP_ReqClientSpawn`, there are other unknown C→S packets that may need fixing:

| Wire Opcode | Size | Probable identity | Current conf value |
|-------------|------|-------------------|--------------------|
| `0x5bd5` | 78 bytes | `OP_SetServerFilter` | `0x444d` — mismatch |
| `0x5148` | 2 bytes | Unknown | — not mapped |
| `0x76c3` | 2 bytes | Unknown | — not mapped |
| `0x356f` | 2 bytes | Unknown | — not mapped |
| `0x754e` | 2 bytes | Unknown | — not mapped |

One of the 2-byte packets may be the C→S `OP_WorldObjectsSent` acknowledgment. If that's also mismatched, `SendZoneInPackets()` won't be called by the server even after `OP_ClientReady` is received — which would mean the client enters the world visually but NPCs and zone content don't fully activate. We'll cross that bridge if the primary fix works.

---

## Everything That Was Fixed — Summary

| # | Problem | Root Cause | Fix Applied |
|---|---------|------------|-------------|
| 1 | Official installer broken | `eqemu_server.pl` removed from repo | Manual install: direct binary download + Wayback Machine DB |
| 2 | PEQ database unavailable | `db.projecteq.net` DNS dead | Downloaded from Wayback Machine (Sept 2025 snapshot) |
| 3 | Opcode files wrong ownership | File chown requires `sudo bash -c` not plain sudo | `sudo bash -c "chown eqemu:eqemu /home/eqemu/server/*.conf"` |
| 4 | Loginserver not starting | Needs separate `login.json` (not eqemu_config.json) | Created `login.json` with DB creds + listen_port 5998 |
| 5 | MySQL socket wrong path on Fedora | Hardcoded `/run/mysqld/mysqld.sock`, Fedora uses `/var/lib/mysql/` | Symlink + tmpfiles.d for persistence |
| 6 | Server shows DOWN in list | Zones crashing: lua_modules/plugins path mismatch | Symlinks from server root to `quests/lua_modules` and `quests/plugins` |
| 7 | Zones exiting immediately | Release build checks `/opt/eqemu-perl` existence | `sudo mkdir -p /opt/eqemu-perl` |
| 8 | Zones crashing on Perl quest load | Perl ABI mismatch: system 5.42.1 vs compiled 5.32.1 | Compiled Perl 5.32.1 from source to `/opt/eqemu-perl` |
| 9 | server_launcher.pl false-positive on restart | `ps aux | grep` matches sudo parent process | Replaced with PID file check (`/tmp/eqemu_launcher.pid`) |
| 10 | Wrong login port for RoF2 client | RoF2 needs port 5999 (SoD+), not 5998 (Titanium) | Changed `eqhost.txt` on Steam Deck to port 5999 |
| 11 | Password rejected after login | `security.mode: 6` (Argon2) but hash is SCrypt (mode 14) | Changed `login.json` to `security.mode: 14` |
| 12 | Zone crashes on player connect | Perl 5.42.1 ABI crash loading quest .pl files | Perl 5.32.1 compiled (same as above) |
| 13 | tutorialb zone crashes every boot | Unknown — crash after LoadRespawnTimers | Moved character to non-tutorial zone via SQL, avoided tutorial |
| 14 | "Error loading inventory" on every zone-in | `GetInventory()` returns false for 0-row result | Manually inserted placeholder inventory items |
| 15 | starting_items not saving | freeporteast items are `norent=1 slots=0`, `FindFreeSlot()` fails | Manual inventory insert as workaround; underlying bug not fixed |
| 16 | `deleted_at IS NULL` SQL error | `inventory` table missing `deleted_at` column | `ALTER TABLE inventory ADD COLUMN deleted_at DATETIME DEFAULT NULL` |
| 17 | All items show as "invalid" in zone | Stale shared memory after schema change | Killed and restarted all zone processes to reload shared memory |
| 18 | Multiple zone crashes on boot | Empty `maps/` directory | Downloaded and extracted map pack to `/home/eqemu/server/maps/` |
| 19 | Char select crashes after failed zone-in | Failed zone-in corrupts character state in DB, bad CharInfo packet crashes RoF2 client | Soft-delete corrupted characters via SQL (`deleted_at = NOW()`) |
| 20 | UCS not running | `mail_opcodes.conf` missing, UCS crashed at startup | Created `mail_opcodes.conf` with RoF2 values |
| 21 | Loading bar fills, game never starts | `OP_ReqClientSpawn` mapped to wrong opcode in `patch_RoF2.conf` | Changed `OP_ReqClientSpawn=0x35fa` → `OP_ReqClientSpawn=0x4820` |

---

## Current State (as of 2026-03-30)

**Server is running:**
- loginserver ✅
- world ✅  
- 5 zone processes ✅ (reduced from 30 to save RAM on the ~3.7GB Chromebook)
- UCS ✅

**Character:**
- Deacyde (Human Paladin, char_id=4), East Freeport (freporte), level 1
- Has 3 inventory items (slots 13, 22, 23)
- GM status granted (`account.status=200`)
- `ingame=0` (reset before each test)

**The fix has been applied:**
- `patch_RoF2.conf` now has `OP_ReqClientSpawn=0x4820`
- Zones have been restarted to pick up the new opcode table
- **Zone-in test is currently underway**

---

## What Needs to Happen Next

### If the opcode fix works (player enters the world)

1. **Enable GM mode in-game:** `/gm on` or the server already has `status=200` — can use `#commands`
2. **Fix starting_items:** New characters get no inventory (starting items fail to save). Either fix the DB entries or add a working default item set
3. **Disable MySQL general query log:** It's currently enabled (`/var/lib/mysql/general.log`) and is high I/O. Turn off: `SET GLOBAL general_log = OFF`
4. **Add UCS to server_start.sh:** Currently has to be started manually. Add `./ucs &` before zone launch
5. **Investigate remaining unknown opcodes** (0x5bd5, 0x5148, etc.) if they cause gameplay issues
6. **Add server to eqhost.txt permanently** and document the Steam Deck setup cleanly
7. **Begin Phase 2 customization:** XP rates, bots, custom zones, etc.

### If the fix doesn't work

- Check whether one of the 2-byte unknown packets is `OP_WorldObjectsSent` — its current conf value `0x5ae2` may also be wrong
- Check `OP_ZoneServerReady=0x0000` — this is null in all patch files and may need a real value
- Try removing `PROTON_USE_WINED3D=1` from Steam Deck launch options to test native D3D path
- Enable more verbose debug logging in the zone for the connection state machine

---

## Migration Plan — Beelink SER5 MAX

When the Beelink arrives, the full setup needs to migrate:

1. Assign static IP via router DHCP reservation
2. Install MariaDB + EQEmu on Windows (or Linux if dual-booted)
3. Export PEQ database from Fedora: `mysqldump -u root -p'EQrootpass123!' peq | gzip > peq-backup.sql.gz`
4. Import on Beelink
5. Copy `eqemu_config.json`, `login.json`, `patch_*.conf`, `quests/`, `maps/`, all fixes
6. Note: **all the hacks above still apply** (Perl 5.32.1, symlinks, socket path, etc.) unless running Windows binaries which may have different deps
7. Update `world.address` to Beelink IP
8. Update Steam Deck `eqhost.txt` to new IP
9. Shut down Fedora test server

Full migration details: see `eqbeelink.md` in this repo.

---

## Key Credentials

| Thing | Value |
|-------|-------|
| Server IP | `192.168.1.84` |
| EQ login port | `5999` (SoD+/RoF2) |
| MariaDB root | `EQrootpass123!` |
| MariaDB eqemu user | `eqemupass` |
| DB name | `peq` |
| EQ username | `deacyde` |
| EQ password | `Password` |

---

## Long-Term Vision

```
[Steam Deck — RoF2 client + MacroQuest]
        | LAN WiFi
[Beelink SER5 MAX — EQ Server]
  EQEmu World/Zone/Login + MariaDB + Node API (port 3400)
        | LAN
[Pi — pi.deacyde.com]
  Web dashboard — server stats, character info, admin panel
```

### Custom server features planned
- 10–15× XP rate, all races/classes unlocked from start
- 72-bot raid system (solo any raid content)
- Auto-scribe spells + auto-grant AAs per level up
- EC Tunnel hub zone: custom vendors, teleporter, bank
- Casino zone, wave defense mode, leaderboards
- Custom AAs: Dragon Form, Time Stop, Mass Loot
- Permanent pet system, Nemesis system, gem socket crafting
- Pi web dashboard with Spotify widget, server stats, character tracker

---

*All debugging done live over multiple sessions with GitHub Copilot CLI on the Fedora Chromebook itself.*
