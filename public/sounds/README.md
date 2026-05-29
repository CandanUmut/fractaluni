# Sound files (optional)

Drop audio files here to replace the built-in synthesized sounds. Each is
optional — anything missing falls back to the procedural synth. The first
matching extension wins: **.mp3**, then **.ogg**, then **.wav**.

Put the files directly in this folder (`public/sounds/`). They are served at
`/<base>/sounds/<name>.<ext>` and loaded automatically on first click.

| Filename (any ext) | Used for | Notes |
|---|---|---|
| `gunshot`   | Pulse Rifle firing            | short, punchy (fires repeatedly) |
| `impact`    | bullet hitting terrain        | short tick |
| `explosion` | Frag Charge detonation        | a satisfying boom |
| `throw`     | lobbing a bomb                | short whoosh |
| `equip`     | switching weapon (1/2/3)      | click/clack |
| `drill`     | Mining Drill while active     | **seamless ~1s LOOP** (it loops while held) |
| `extract`   | a resource node being mined   | (used from Phase C) |
| `pickup`    | collecting resource to cargo  | (used from Phase C) |

Example: `public/sounds/gunshot.mp3`, `public/sounds/drill.ogg`, …

Keep files small (a few hundred KB each) so the game loads fast. Freesound.org
(CC0) is a good source.
