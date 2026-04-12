EQEmu Monster Merc Client Patch
================================

What this package includes
--------------------------
- dbstr_us.append.txt
  Add these lines to your client-side dbstr_us.txt so custom mercenary text stops showing
  "Unknown DB String" for the current Frozen Skeleton merc family.

- NOTES.txt
  Short notes about what this patch fixes and what still needs extra client work.

Install steps
-------------
1. Back up your existing dbstr_us.txt in the EverQuest client folder.
2. Open your existing dbstr_us.txt in a text editor.
3. Append every line from dbstr_us.append.txt to the end of dbstr_us.txt.
4. Save the file.
5. Launch the client again and retest the custom merc hire window.

Important
---------
- This patch is for client text only.
- It fixes the mercenary UI string side for the current custom Frozen Skeleton merc entries.
- True monster merc bodies may still require additional client race/model support beyond dbstr_us.txt.

