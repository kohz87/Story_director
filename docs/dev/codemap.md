# Story Director Source Codemap

This map covers source files under `src/` that are not already named in the project's main documentation.
Files already mapped are named in `CLAUDE.md`, `AI-README.md`, `README.md`, and `docs/**/*.md`; this map does not repeat them.
Generated 2026-11-07.

## src/v2/
- `src/v2/fights.js`: Detects whether another ready module registers combat commands, so Story Director avoids encounters.
- `src/v2/hash.js`: Pure SHA-256 and canonical JSON helpers used for contract hashes and policy fingerprints.
- `src/v2/rare.js`: Decides which rare Chronicle, route and map grammar the story currently needs.
- `src/v2/slot.js`: Slot helpers that store rewrite-prone bookkeeping whole so deleting a reply cannot corrupt later replay.

## src/v2/arc/
- `src/v2/arc/commands.js`: Arc reader commands: accept a reviewed plan, update tracked threads, and end the current arc.
- `src/v2/arc/controller.js`: Browser-side arc planner using `callModel`, draft persistence, auto-accept and turn-triggered planning.

## src/v2/atlas/
- `src/v2/atlas/canonical.js`: Resolves pack and atlas places to stable canonical IDs; reports ambiguous or unbound identities.
- `src/v2/atlas/map.js`: Builds `ss.map` and atlas widget props: icons, nodes, routes, layers, current place and fog.
- `src/v2/atlas/policy.js`: Region, place-binding and danger policies plus canonical/candidate queries and policy hashes.

## src/v2/cast/
- `src/v2/cast/apply.js`: Applies cast sync, advance, meet, withdraw and rumor steps to the cast draft; notes why people moved.

## src/v2/checks/
- `src/v2/checks/commands.js`: Standalone check actor settings and evidence-backed d20 rolls with modifiers and outcome logging.
- `src/v2/checks/roll.js`: Builds and caps standalone and NPC social modifiers for checks.

## src/v2/chronicle/
- `src/v2/chronicle/digest.js`: Note and digest commands that turn fresh change receipts into daily Chronicle facts and tail lines.
- `src/v2/chronicle/thread-outcome.js`: Records a thread's outcome text in the Chronicle quest log for the committing reply.

## src/v2/screens/
- `src/v2/screens/behind.js`: Behind-the-scenes Director widget showing agendas, beats, clocks and name-only secrets after Reveal.
- `src/v2/screens/dom.js`: Shared text-only DOM helpers for Director widgets: elements, buttons, plurals and spacing.
- `src/v2/screens/quest-cards.js`: Read-only Quests widget drawing active, offered and finished threads as expandable cards.
- `src/v2/screens/status-card.js`: Inline reply card showing time, place, weather, travel, hero state and current goal from that reply's state.
- `src/v2/screens/style.js`: Shared `BASE_CSS` layout tokens and styles for Story Director screens, built on Story Block classes.

## src/v2/time/
- `src/v2/time/records.js`: Time-part settings, calendar defaults, and read-only v1 record adapters for lapse, relevance and note rules.

## src/v2/tracker/
- `src/v2/tracker/convert.js`: Converts director threads to and from v1 tracker records and compares/canonicalizes records for replay-safe writes.
- `src/v2/tracker/hash.js`: Synchronous canonical JSON/SHA-256 for public thread hashes, matching Story Block replay hashes.
- `src/v2/tracker/thread-shape.js`: Validators for thread IDs, metadata, text, hashes, source stamps and replay cursors.

## Pointer to add
- Source codemap for files not covered above: `docs/dev/codemap.md`.
