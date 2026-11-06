// Story Director v2, chronicle part: the change lines and the reader's commands that write the
// chronicle (pure).
//
// Kinds (run by Story Block as story commands, SPEC §4.2):
// - `world`: `+ world Dragon Calamity — awakens near Dragonfang | state: ongoing | place: Dragonfang
//   | factions: Ashen Court`; `~ world Dragon Calamity | state: resolved — slain at the pass`;
//   `- world Dragon Calamity — how it ended` resolves it (the entry stays, under Resolved).
//   `! world …` is news, read as `~`. The kind is `world`, not `event`: `event` is the tracker
//   part's (MODULES §C1, a dated happening with `then:` and `on:`), and a kind has one owner.
// - `faction`: `+ faction Ashen Court — the old nobility | area: the north | stance: wary of {{user}}`;
//   `~ faction …` changes it; `- faction Name` takes it out of the chronicle.
// A `~` on a name the chronicle does not have yet adds it. Times are the Director's clock when
// the line is read (`ctx.time()`, else the `director.time` query, else the `director` domain),
// never the model's. A line the rules cannot use fails with a plain sentence, which Story Block
// keeps in its problems list; nothing is saved for it.
//
// Commands (cause `ui`, from the Chronicle screen): `chronicle.edit { id, …fields }` and
// `chronicle.remove { id }`, for an event (`ev_…`) or a faction (`fa_…`).
//
// `chronicle.lasting { name, state, summary?, place?, factions?, keep? }` (cause `system`, only as a step
// of a pack event: `ctx.caller` is `event:<id>`) is a world's lasting change: it adds the world event or
// updates the one with that name (or a name it had). The entry records the event (`by`), which locks it:
// a `world` line may add to its summary, place and factions but not move its state ("stays ongoing (set
// by the world's timeline)"); the reader's `chronicle.edit` and another `chronicle.lasting` may change
// anything. `keep: true` holds an open entry in every reply's tail (pick.js). `since` and `updated` are
// the Director's clock. While the clock is not set the command fails (NOT_YET), so the pack event waits and is
// tried again on the next reply; an entry therefore always has a date, and a delay counted from `since` can come due.
//
// The code lives in capture/ (text.js, world.js, faction.js, commands.js); this file re-exports every
// name it exported before, so the old import path keeps working.

export { lineText, clockOf, readState, readNames } from './capture/text.js';
export { worldLineText, applyWorldLine, lasting } from './capture/world.js';
export { applyFactionLine } from './capture/faction.js';
export { edit, remove } from './capture/commands.js';
