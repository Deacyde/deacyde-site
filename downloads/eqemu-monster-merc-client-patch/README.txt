EQEmu Monster Merc Client Patch
================================

What this package includes
--------------------------
- apply-patch.sh
  Linux / Steam Deck patch script. Backs up dbstr_us.txt and appends only missing merc lines.

- apply-patch.ps1
  Windows PowerShell patch script. Backs up dbstr_us.txt and appends only missing merc lines.

- Run EQEmu Merc Patch.bat
  Windows double-click launcher. Runs the PowerShell patcher for you.

- Run EQEmu Merc Patch.desktop
  Steam Deck / Linux double-click launcher. Opens a terminal and runs the patcher for you.

- dbstr_us.append.txt
  Add these lines to your client-side dbstr_us.txt so custom mercenary text stops showing
  "Unknown DB String" for the current Frozen Skeleton merc family.

- NOTES.txt
  Short notes about what this patch fixes and what still needs extra client work.

Install steps
-------------
Steam Deck / Linux:
1. Extract this zip somewhere.
2. Double-click: Run EQEmu Merc Patch.desktop
3. If needed, terminal form is: ./apply-patch.sh
4. If needed, explicit path form is: ./apply-patch.sh "/path/to/EverQuest"
5. Launch the client again and retest the custom merc hire window.

Windows:
1. Extract this zip somewhere.
2. Double-click: Run EQEmu Merc Patch.bat
3. If needed, PowerShell form is: .\apply-patch.ps1
4. If needed, explicit path form is: .\apply-patch.ps1 -EqPath "C:\Path\To\EverQuest"
5. Launch the client again and retest the custom merc hire window.

Manual fallback:
1. Back up your existing dbstr_us.txt in the EverQuest client folder.
2. Open your existing dbstr_us.txt in a text editor.
3. Append every line from dbstr_us.append.txt to the end of dbstr_us.txt.
4. Save the file.

Important
---------
- This patch is for client text only.
- It fixes the mercenary UI string side for the current custom Frozen Skeleton merc entries.
- True monster merc bodies may still require additional client race/model support beyond dbstr_us.txt.
- The scripts do not touch GlobalLoad.txt yet because that still needs client-specific model verification.
- By default, the scripts read the EQ path from `https://dev.deacyde.com/eqemu/patcher.txt`.
- Browsers do not auto-run downloaded scripts, so the package includes double-click launchers instead of auto-executing itself.

