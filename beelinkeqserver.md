# Beelink EQ Server — Server Of Deacyde

## Status: PARTIALLY WORKING — Needs Debug

Login server connects and auto-creates accounts, but client shows "server is down" when trying to play. Needs world address fix and restart.

---

## Hardware

- **Machine**: Beelink SER5 MAX
- **CPU**: AMD Ryzen 7 7735HS (8C/16T)
- **RAM**: ~20GB LPDDR5 (reported by systeminfo, 24GB physical)
- **Storage**: 1TB NVMe (~943GB free)
- **OS**: Windows 11 Pro
- **Hostname**: DESKTOP-2SDN8Q6
- **LAN IP**: 192.168.1.90
- **Windows User**: deacyde-minipc

## SSH Access (from Codespace/VM)

```bash
ssh -i ~/.ssh/id_beelink deacyde-minipc@192.168.1.90
```

- Key: `~/.ssh/id_beelink` (ed25519)
- Windows admin SSH keys live in `C:\ProgramData\ssh\administrators_authorized_keys`
- Permissions: `icacls ... /inheritance:r /grant "SYSTEM:F" /grant "Administrators:F"`

---

## EQEmu Installation

- **Installer**: Official Akkadius/Spire installer v4.24.2
- **EQEmu Version**: 23.10.3
- **Server Path**: `C:\Users\deacyde-minipc\server\`
- **Binaries**: `C:\Users\deacyde-minipc\server\bin\` (world, zone, loginserver, ucs, queryserv, eqlaunch, shared_memory)
- **Maps**: `C:\Users\deacyde-minipc\server\maps\base\` (513 .map files)
- **Quests**: `C:\Users\deacyde-minipc\server\quests\`
- **Logs**: `C:\Users\deacyde-minipc\server\logs\`

### MariaDB

- **Version**: MariaDB 10.11.4
- **Binary**: `C:\Program Files\MariaDB 10.11\bin\mysql.exe`
- **DB Name**: peq
- **DB User**: eqemu
- **DB Password**: l6oLB3frTgRaKZQ04bDcX97q2n81Pm5N
- **Port**: 3306 (localhost only)
- Running as a service (auto-starts with Windows)

### PEQ Database Stats

- 618 zones
- 117,944 items
- 40,722 spells
- 67K+ NPCs
- Bot tables updated to version 9054

### Spire Web Admin

- **Binary**: `C:\Users\deacyde-minipc\server\spire.exe`
- **Port**: 3007 (http://localhost:3007 on Beelink)
- **Encryption Key**: 303c17295b216b06598710a436bf5d72c3607a091e92f38ffe11e001db1955e7
- Spire has a built-in launcher but we're NOT using it (see "What Didn't Work")

---

## How to Start/Stop

### Start (Desktop shortcuts on Beelink)

**Right-click `StartEQ.bat` on Desktop → Run as Administrator**

The bat file does:
1. `shared_memory.exe` — loads items/spells into shared memory
2. `spire.exe` — web admin (minimized)
3. `world.exe` — world server (new window)
4. `loginserver.exe` — login server (new window)
5. `ucs.exe` — universal chat (new window)
6. `queryserv.exe` — query server (new window)
7. `eqlaunch.exe peq` — zone launcher (new window)

Each opens in its own CMD window so you can see errors.

### Stop

**Double-click `StopEQ.bat` on Desktop** — kills all EQ processes.

### Start/Stop via SSH

```bash
# Start (run shared_memory first, then use schtasks for persistence)
ssh -i ~/.ssh/id_beelink deacyde-minipc@192.168.1.90 "cd /d C:\Users\deacyde-minipc\server && bin\shared_memory.exe"

# Each process needs schtasks to survive SSH disconnect:
ssh -i ~/.ssh/id_beelink deacyde-minipc@192.168.1.90 "schtasks /create /tn \"EQWorld\" /tr \"cmd /c cd /d C:\Users\deacyde-minipc\server && bin\world.exe\" /sc once /st 00:00 /f && schtasks /run /tn \"EQWorld\""
# Repeat for loginserver.exe, ucs.exe, queryserv.exe
# For zones: bin\eqlaunch.exe peq (NOT "zones" — the launcher name in DB is "peq")

# Stop
ssh -i ~/.ssh/id_beelink deacyde-minipc@192.168.1.90 "taskkill /f /im zone.exe"
ssh -i ~/.ssh/id_beelink deacyde-minipc@192.168.1.90 "taskkill /f /im eqlaunch.exe"
# ... etc for each process
```

**IMPORTANT**: Normal SSH `start /b` and PowerShell `Start-Process` do NOT persist — processes die when SSH disconnects. Must use `schtasks` or run locally on the Beelink.

---

## Config Files

### eqemu_config.json (main server config)

Path: `C:\Users\deacyde-minipc\server\eqemu_config.json`

Key settings:
- `server.world.shortname`: "Server Of Deacyde"
- `server.world.longname`: "Server Of Deacyde"
- `server.world.localaddress`: "192.168.1.90" (was 127.0.0.1, changed to fix "server down")
- `server.zones.ports.low`: 7000
- `server.zones.ports.high`: 7400
- `server.database.host`: 127.0.0.1
- `server.database.username`: eqemu
- `server.database.password`: l6oLB3frTgRaKZQ04bDcX97q2n81Pm5N
- `web-admin.launcher.runLoginserver`: true (was false, we enabled it)
- `web-admin.launcher.runQueryServ`: true (was false, we enabled it)
- `web-admin.launcher.minZoneProcesses`: 10
- `web-admin.launcher.staticZones`: butcher,erudnext,freporte,qeynos,freeporte,oot,iceclad,nro,oasis,nedaria,abysmal,natimbi,timorous,firiona,overthere

### login.json (login server config)

Path: `C:\Users\deacyde-minipc\server\login.json`

- `account.auto_create_accounts`: true
- `security.mode`: 14 (SCrypt)
- `security.allow_password_login`: true
- `client_configuration.titanium_port`: 5998
- `client_configuration.sod_port`: 5999 (Steam Deck RoF2 uses this)
- `worldservers.unregistered_allowed`: true

### Launcher Database Config

The `launcher` table in peq DB:
- Launcher "peq": 40 dynamic zones, 117 static zones assigned
- Launcher "zone": 5 dynamic zones
- 82 zones assigned to "disabled" launcher

**eqlaunch.exe must be started with `peq` argument** (matches DB launcher name).

---

## Ports

| Port | Protocol | Service |
|------|----------|---------|
| 3306 | TCP | MariaDB |
| 5998 | TCP/UDP | Login (Titanium clients) |
| 5999 | UDP | Login (SoD+ / RoF2 clients) |
| 7000-7400 | UDP | Zone processes |
| 7778 | UDP | UCS (chat) |
| 9000 | TCP | World telnet console |
| 9001 | TCP | World server (zone<->world) |
| 3007 | TCP | Spire web admin |
| 6000 | TCP | Login web API |

**Windows Firewall**: User allowed loginserver.exe through firewall during setup. May need to allow world.exe and zone.exe too if client can't connect.

---

## EQ Login Account

- **Username**: deacyde
- **Password**: Password
- Auto-created on first login attempt (confirmed working in login log)
- Account ID: 1

---

## Steam Deck Client

- **RoF2 Path**: `/home/deck/Games/EverQuest/Full_RoF2/`
- **eqhost.txt**: Should contain:
  ```
  [LoginServer]
  Host=192.168.1.90:5999
  ```
- **Steam Deck IP**: 192.168.1.238 (as seen in login log)
- **Proton**: ULWGL-Proton-8.0-5-3 with PROTON_USE_WINED3D=1

---

## What Works

- ✅ EQEmu installed with all binaries, maps, quests, PEQ database
- ✅ MariaDB running and healthy
- ✅ All server processes start via StartEQ.bat (world, login, ucs, queryserv, eqlaunch, spire)
- ✅ Login server accepts connections from Steam Deck (192.168.1.238)
- ✅ Account "deacyde" auto-created and authenticated successfully
- ✅ Server list returned to client after login
- ✅ SSH access from Codespace/VM working
- ✅ Bot database tables updated (v9054)

## What Doesn't Work Yet

### 🔴 Client shows "Server is Down"

**Root cause**: When world registers with the login server, it sends `local_address [127.0.0.1]` and empty `remote_address []`. The login server tells the client to connect to that address, which doesn't work from another machine.

**Fix applied but NOT tested yet**: Changed `localaddress` in eqemu_config.json from `127.0.0.1` to `192.168.1.90`. Need to restart world and test.

**Next steps to try**:
1. Run StopEQ.bat then StartEQ.bat on Beelink
2. Check login log for: `local_address [192.168.1.90]` in the world registration line
3. If still "down", check Windows Firewall — may need to allow world.exe and zone.exe through
4. Check if port 9001 is reachable from Steam Deck

### 🟡 Zone processes not spawning from eqlaunch

eqlaunch.exe runs and registers with world (confirmed in world log: "Adding [peq] to active list"), but no zone.exe processes spawn. Zones DO work when started manually (`bin\zone.exe tutorialb 7000` booted fine, loaded 117K items).

This might resolve itself once a player actually connects — zones may spawn on-demand. But if not:
- Check if `launcher` table in DB needs different config
- Check if eqlaunch needs specific permissions on Windows
- Consider starting static zones manually

### 🟡 Spire launcher doesn't work

`spire.exe eqemu-server:launcher start` always says "Launcher process already running" even after killing all processes. The Spire web server auto-sets `isRunning: true` and gets confused. We bypassed this by starting processes individually.

---

## What Didn't Work (So We Know Not to Try Again)

1. **SSH `start /b`** — processes die when SSH session closes
2. **PowerShell `Start-Process`** — same issue, processes don't persist
3. **Spire's built-in launcher** — claims launcher is already running, won't start
4. **`eqlaunch.exe zones`** — wrong launcher name, DB has "peq" not "zones"
5. **`wmic process call create`** — wmic not available on this Win 11 install

**What DOES work**: `schtasks` for SSH-based process start, or running bat files locally on the Beelink.

---

## Scheduled Tasks Created (cleanup later)

These one-shot scheduled tasks were created during debugging:
- EQStartWorld, EQStartLogin, EQUCS, EQZones, EQSpireLaunch, EQSpireStart, EQSpireWeb

Clean them up with:
```cmd
schtasks /delete /tn "EQStartWorld" /f
schtasks /delete /tn "EQStartLogin" /f
schtasks /delete /tn "EQUCS" /f
schtasks /delete /tn "EQZones" /f
schtasks /delete /tn "EQSpireLaunch" /f
schtasks /delete /tn "EQSpireStart" /f
schtasks /delete /tn "EQSpireWeb" /f
schtasks /delete /tn "EQSpireStart" /f
schtasks /delete /tn "EQLogin" /f
schtasks /delete /tn "EQWorld" /f
```

---

## Custom Server Plans (from Ideas.txt on Pi)

Full custom server spec saved in `~/Desktop/Ideas.txt` on the Pi (192.168.1.86). Highlights:
- Server name: Server Of Deacyde
- 10-15x XP, OP starting gear, level cap 150+
- Full bot group + 72-bot raid system
- All races/classes unlocked from start
- Auto-scribe spells/skills/AAs
- Custom EC Tunnel hub zone
- Casino zone (slots, blackjack, dice, gacha packs)
- Custom pet system, nemesis system, gem sockets
- Web admin dashboard with Spotify widget
- MQ2/MacroQuest on Steam Deck

None of this is implemented yet — get the basic server connecting first!

---

## Quick Resume Checklist

1. SSH into Beelink: `ssh -i ~/.ssh/id_beelink deacyde-minipc@192.168.1.90`
2. On Beelink desktop: Run StopEQ.bat (clean slate)
3. Run StartEQ.bat as Admin
4. Watch the World window — should say "Server (TCP) listener started on port [9001]"
5. Check login log: `type C:\Users\deacyde-minipc\server\logs\login_<PID>.log`
   - Look for `local_address [192.168.1.90]` (not 127.0.0.1)
6. On Steam Deck, verify eqhost.txt: `Host=192.168.1.90:5999`
7. Launch EQ, login with deacyde / Password
8. If "server down" still: open Windows Firewall → allow world.exe and zone.exe
9. If server shows but can't zone in: check if zone.exe processes are running
