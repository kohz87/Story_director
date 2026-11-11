# Story Director Source Codemap

This map describes selected source files and the recent file splits. The project's main documentation
also maps the broader source directories.
Generated 2026-11-07.

## src/v2/
- `src/v2/fights.js`: Detects whether another module registers combat commands, requiring it to be ready when lifecycle status is available.
- `src/v2/hash.js`: Pure SHA-256 and canonical JSON helpers used for contract hashes and policy fingerprints.
- `src/v2/rare.js`: Decides which rare Chronicle, route and map grammar the story currently needs.
- `src/v2/slot.js`: Slot helpers that store rewrite-prone bookkeeping whole to avoid breaking later replay when a reply is deleted.

## src/v2/arc/
- `src/v2/arc/commands.js`: Arc reader commands: accept a reviewed plan, update tracked threads, and end the current arc.
- `src/v2/arc/controller.js`: Browser-side arc planner using `callModel`, draft persistence, auto-accept and turn-triggered planning.

## src/v2/atlas/
- `src/v2/atlas/canonical.js`: Resolves pack and atlas places to stable canonical IDs, holding ambiguous or unbound identities for binding.
- `src/v2/atlas/map.js`: Builds `ss.map` and atlas widget props: icons, places, routes, layers, current place and discovery status.
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
- `src/v2/screens/behind.js`: the Director screen's plan cards (widget `story-director.plan`: Beats, hooks with Next, Off-screen, Secrets, Problems, "+N more") and the older Reveal-locked Behind widget.
- `src/v2/screens/dom.js`: Shared text-only DOM helpers for Director widgets: elements, buttons, plurals and spacing.
- `src/v2/screens/quest-cards.js`: Read-only Quests widget drawing active, offered and finished threads as expandable cards.
- `src/v2/screens/status-card.js`: Inline reply card showing time, place, weather, travel, hero state and current goal from that reply's state.
- `src/v2/screens/style.js`: Shared `BASE_CSS` layout tokens and styles for Story Director screens, built on Story Block classes.

## src/v2/time/
- `src/v2/time/records.js`: Time-part settings, calendar defaults, and read-only v1 record adapters for lapse, relevance and note rules.

## src/v2/tracker/
- `src/v2/tracker/convert.js`: Converts director threads to and from v1 tracker records and compares/canonicalizes records for replay-safe writes.
- `src/v2/tracker/hash.js`: Synchronous canonical JSON/SHA-256 for public thread hashes, matching Story Block replay hashes.
- `src/v2/tracker/quiet.js`: Read-time set of threads that stop counting as open: a beat the Chronicle's quest log shows fired, and a dead person's own agenda (a beat that names them stays) (NPC State Delta `lifeState: deceased`, or the story's recorded death: a pinned person, or anyone on a reply with the `diedAny` rule mark).
- `src/v2/tracker/thread-shape.js`: Validators for thread IDs, metadata, text, hashes, source stamps and replay cursors.

## Split files (7 Nov: files over 450 lines split into small parts; each original keeps its path and public names)
- `src/planner.js` → `src/planner/`: `prompt.js` prompt, summary and messages; `parse.js` answer parsing; `relative.js` relative dates; `validate.js` findings and ops; `auto.js` automatic planning; `note.js` the accepted note; `shared.js` helpers.
- `src/tracker.js` → `src/tracker-records.js` record shape, copy-on-write helpers and constants; `src/tracker-apply.js` applying change lines (`applyOps`); `src/tracker-replay.js` mention marks and replay from chat entries; `src/tracker-queries.js` corrections, quest outcomes and record queries.
- `src/note.js` → `src/note-text.js` fixed note instructions, cues and Pacing text; `src/note-format.js` word limits, field trimming and parts; `src/note-items.js` Due now, Arriving, record and While-away lines; `src/note-extra.js` note header, no-weekday line and distance lines.
- `src/v2/module.js` → `src/v2/module/`: `parts.js` identity and parts; `shared.js` host access and helpers; `host.js` fight detection; `settings.js` namespacing and reads; `contexts.js` ctx, view and tools; `merge.js` merge rules; `create.js` the module builder.
- `src/v2/arc/plan.js` → `src/v2/arc/plan/`: `shared.js` constants and text; `prompt.js` prompt and summary; `read.js` plan read and write; `auto.js` auto-plan rules.
- `src/v2/atlas/widget.js` (render coordinator) → `widget-dom.js` the DOM, `widget-places.js` place details, search and moves, `widget-pointer.js` pointer input, for the Map widget.
- `src/v2/chronicle/capture.js` → `src/v2/chronicle/capture/`: `text.js`, `world.js`, `faction.js`, `commands.js`: chronicle change lines and reader commands.
- `src/v2/chronicle/days.js` → `src/v2/chronicle/days/`: `shared.js` constants and text; `state.js` state, settings and receipts; `facts.js` day facts; `summary.js` summary lines and output; `validate.js` validation.
- `src/v2/world/events-widget.js`: The Journal's "Show all N events" button (widget `story-director.journal-events`): loads one day's whole event list on tap, folds on the next.
- `src/v2/world/elsewhere.js`: the World screen's Leads data (heard hooks) and the shared section fold (widget `story-director.fold`: chevron, count, open state remembered per chat on this device).
