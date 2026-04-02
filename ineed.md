# Task for Server Copilot

## What I need

Run this MySQL query against the `peq` database on the EQEmu server and save the results to this repo as `eq_spawns.csv`.

## Query

```sql
SELECT 
  s.zone,
  n.name AS npc_name,
  s.x, s.y, s.z
FROM spawn2 s
JOIN spawngroup sg ON s.spawngroupID = sg.id
JOIN spawnentry se ON sg.id = se.spawngroupID
JOIN npc_types n ON se.npcID = n.id
ORDER BY s.zone, n.name;
```

## Output

Save result as `eq_spawns.csv` in the root of this repo with this header:

```
zone,npc_name,x,y,z
```

Then `git add eq_spawns.csv && git commit -m "Add EQ spawn data" && git push`

## Why

I'm generating EQ client map files (`maps/*.txt`) that show NPC spawn locations as named dots on the in-game map (M key). No server changes needed — client-side only map files.
