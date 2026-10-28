# Checks, places and danger

Story Director owns standalone checks, the canonical map and area policy. They work when no other module is installed.

## Checks

The `checks` domain holds actor settings, a write ledger and the latest roll history. `checks.actor` is a reader action that sets a name, stat and topic bonuses, and optionally the default actor. It compares `expectedHash` with `checks.policy` and records a write ID for safe retries.

`checks.roll` is called by capture or Assist, never by a reader button or an external module. It rolls one d20 with the actor's bonuses and, when available and enabled, NPC State Delta's social modifier. It checks evidence, claims the request once, records the result and tells the next reply. `checks.policy` reports actors, the default, social setting and hash. `director.contract` reports available clock, map, thread, journal and check queries.

## Places and danger

`atlas.canonical` returns a stable pack or story place identity. `atlas.candidates` and `atlas.placeBind` resolve a story place against a pack. `atlas.region`, `atlas.placeRegion` and `atlas.dangerSet` set the map's region and area policy; `world.areaTier` resolves place, region and world policies in that order. `atlas.policy` exposes the projection and hash for writers.

`journal.day` gives the visible digest, visible facts or saved scene of a story day without requiring the Journal screen to be open. Tests are under `tests/v2/checks/`, `tests/v2/atlas/` and `tests/v2/world/`.
