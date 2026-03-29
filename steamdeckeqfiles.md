# Steam Deck EQ Client — Setup Reference for Fedora Copilot

> Written by Steam Deck Copilot CLI. Read this to understand the current state of the EQ RoF2 client on the Steam Deck and what was done to get it working.

---

## Client Location

```
/home/deck/Games/EverQuest/Full_RoF2/
```

- Full RoF2 (Rain of Fear 2) client, extracted from Full_RoF2.zip
- On internal NVMe SSD (`/dev/nvme0n1p8`, ~14GB free as of setup)
- 1027 `.s3d` zone files + 1073 `.eqg` zone files — all zones present
- `spells_us.txt` ✅ present
- `dbstr_us.txt` ✅ present

---

## MacroQuest

- `MacroQuest2.exe` present in EQ directory
- `MacroQuest.ini` present
- `MQ2EmuAutoMacro.dll` + `MQ2EmuAutoMacro.ini` present
- `UseMQLogin=0` in MacroQuest.ini (not interfering with login)

---

## Steam Shortcut

- **App Name:** EverQuest (RoF2)
- **Exe:** `/home/deck/Games/EverQuest/Full_RoF2/eqgame.exe`
- **StartDir:** `/home/deck/Games/EverQuest/Full_RoF2`
- **AppID:** `-1940116720` (unsigned: `2354850576`)
- **Launch Options:** `PROTON_USE_WINED3D=1 %command% patchme`
- **Proton Version:** `ULWGL-Proton-8.0-5-3` (switched from Proton 7.0 to fix black screen)
- **Proton Prefix:** `~/.local/share/Steam/steamapps/compatdata/2354850576/`

---

## Key Config Files

### eqhost.txt
```
[LoginServer]
Host=192.168.1.84:5999
```

### eqclient.ini (relevant settings)
```
WindowedMode=TRUE
WindowedWidth=1280
WindowedHeight=785
WindowedModeXOffset=0
WindowedModeYOffset=0
Maximized=0
VideoMode=0
```

---

## Login Credentials

- **Username:** `deacyde`
- **Password:** `Password`
- **Server:** Deacyde Test Server (Fedora at 192.168.1.84)

---

## History of What Was Fixed

| Problem | Fix |
|---------|-----|
| Black screen at login (no UI visible) | Switched from Proton 7.0 → ULWGL-Proton-8.0-5-3, deleted old prefix, kept `PROTON_USE_WINED3D=1` |
| `EQLSUI.xml not found` popup | Copied UIFiles/default/ from Steam F2P EQ client |
| `EQLS_BlackFill.tga` never declared error | Added `Ui2DAnimation` wrappers to `EQLSUI_Animations.xml` |
| Stale CRC files causing silent XML rejection | Deleted all `EQLSUI*.xml:crc` files from `UIFiles/default/` |
| Windows off-screen (1728,1808) | Reset `eqlsUIConfig.ini` window positions to 200,100 |
| Login screen showed but "Logging into server" hung | Confirmed port 5998 open, switched eqhost.txt to port 5999 |

---

## Current Issue (as of 2026-03-29 ~22:20)

**Stuck on loading screen after logging in and selecting a character.**

- Login screen works ✅
- Server list shows ✅  
- Character select works ✅
- Stuck on zone loading screen ❌

### Diagnostics done:
- Port 9000 (world server TCP) = OPEN ✅
- Ports 7000-7100 (zone UDP) = confirmed open by Fedora Copilot (zone 7080 actively listening) ✅
- Zone files all present on client ✅
- `spells_us.txt` present ✅
- UIErrors.txt shows only non-fatal `MarketplaceWnd` and `SocialWnd` missing children (live UI vs RoF2 engine mismatch — harmless)
- `dbg.txt` has a crash from earlier session (18:18) — not current issue

### Suspected cause:
Zone server not spinning up the specific starting zone for the new character. Fedora Copilot should check:
1. Which zones are currently running
2. Whether the starting zone for the character is loaded
3. EQEmu zone server logs for connection attempts from `192.168.1.x`

---

## UIErrors Known Non-Fatal Issues

These appear in `UIErrors.txt` and can be ignored — they are caused by using live EQ UI files with the older RoF2 engine:

- `MarketplaceWnd` missing credit card children
- `ScreenPiece SocialWnd referenced but not found in XML`

---

## File Locations Reference

| File | Purpose |
|------|---------|
| `~/Games/EverQuest/Full_RoF2/eqhost.txt` | Points client at login server |
| `~/Games/EverQuest/Full_RoF2/eqclient.ini` | Game settings (windowed mode, resolution) |
| `~/Games/EverQuest/Full_RoF2/eqlsUIConfig.ini` | Login screen window positions |
| `~/Games/EverQuest/Full_RoF2/UIErrors.txt` | UI error log — check after launch |
| `~/Games/EverQuest/Full_RoF2/Logs/dbg.txt` | Main debug log — check for crashes |
| `~/.local/share/Steam/userdata/21649317/config/shortcuts.vdf` | Steam shortcut config |
| `~/.local/share/Steam/config/config.vdf` | Proton version assignment |

---

## Server Info (Fedora)

| Thing | Value |
|-------|-------|
| Server IP | `192.168.1.84` |
| Login server port | `5999` |
| World server port | `9000` TCP |
| Zone ports | `7000-7100` UDP |
| EQEmu version | v23.10.3 |
| Server binaries | `/home/eqemu/server/` |
| Start command | `sudo -u eqemu bash -c "cd /home/eqemu/server && ./server_start.sh"` |
| Status command | `sudo -u eqemu bash -c "cd /home/eqemu/server && ./server_status.sh"` |
