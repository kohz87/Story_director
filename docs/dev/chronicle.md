# Chronicle: world events and a pack's lasting changes

The chronicle keeps the wider world's lasting situations (a war, a plague, a calamity) and the factions that shape
them. Detail: the header comments of `src/v2/chronicle/domain.js` (the shape and caps), `capture.js` (the change
lines and commands), `pick.js` (which events the next reply is reminded of) and `days.js` (the day digest).

## Rules

- A world event is `{ id, name, summary, state, since, updated, place, factions, aka, rev }`; `state` is looming,
  ongoing or resolved. `since` and `updated` are story minutes from the Director's clock, never the model's.
- The story writes events with `world` lines; the reader edits them (`chronicle.edit`, `chronicle.remove`).
- Swipe, delete, rebuild and reload give the same chronicle: everything is written by commands whose ops replay.

## A pack's lasting changes: `chronicle.lasting`

A pack event's `then` step may call `chronicle.lasting` (Story Block runs steps with `ctx.cause === 'system'` and
`ctx.caller === 'event:<id>'`; nothing else may call it: a button, a change line or another command is REFUSED):

```json
{ "command": "chronicle.lasting", "payload": { "name": "Seventh seal failed", "state": "ongoing",
  "summary": "The seal over Auvoth has failed.", "place": "Auvoth", "factions": ["Adventurer Guild", "Sealwardens"], "keep": true } }
```

- Payload: `name` (at most 80 characters) and `state` (looming, ongoing or resolved) are required; `summary` (at most
  240), `place` (80), `factions` (at most 4 names of 80) and `keep` (true or false) are optional, and what is left out
  stays as it is. Anything else is INVALID.
- It adds the world event, or updates the one with that name (any case) or a name it had (`aka`); a rename by the
  reader is kept. `since` is stamped when it is added, `updated` on every change, from the Director's clock.
  **While the clock is not set the command fails** (`NOT_YET`: "The story has no date yet; this world event waits for
  one."). The pack event is then not claimed and is tried again on the next reply, so it happens once the story has a
  date (its `since` is that time) and a delay counted from it can come due. A pack that starts without a calendar
  start therefore fires its lasting events on the first reply after the story gets a date.
- It is an ordinary world event otherwise: News on the World screen, the Chronicle screen, the Journal's world line
  on the story day of the event that wrote it, the same hidden-names rules, taken back by a swipe or delete of the
  reply that carries the event's receipt.

### The lock

The entry records the event that wrote it (`by: "event:<id>"`, only on entries a pack event wrote). A `world` line
naming it keeps whatever it adds to the summary (after the words that are there), the place and the factions, but
not a state: the change card says "Seventh seal failed stays ongoing (set by the world's timeline)". The reader's
`chronicle.edit` and another `chronicle.lasting` may change anything; the reader can clear the lock with
`chronicle.edit { id, locked: false }` (only a pack event sets it).

### Keep in mind

`keep: true` holds an open entry in every reply's tail. At most two entries are held (`MAX_KEPT`; the two most recently
updated, id breaking ties); they take their seats first in the tail's pick of three and the other seats go by the
existing score. A resolved entry is not held (its flag stays and counts again if it reopens). The reader sets or clears
it with `chronicle.edit { id, keep }`. The static prompt does not change.

### "N days after"

The condition language has no sums (`since + 86400` does not parse), so a pack event asks the chronicle:
`query('chronicle.passed', { name: 'Cracks in the seventh seal', minutes: 86400 })` is true once the clock is that many
story minutes past the event's `since`, and false when there is no such event or either time is missing (an entry
saved by an older version, or written by a `world` line before the story had a date, can have no `since`: it never
comes due).

### Older chats

`by`, `keep` and `fire` are written only by `chronicle.lasting`. An entry without them validates and behaves exactly as
before, and the queries add `locked` / `keep` to an answer only when the entry has them.

### The Journal

The day's world line for a lasting change is found by the receipt of the event that fired, not by the entry's current
revision: the entry keeps `fire: { rev, by }` (the last pack event that changed it), written with its other fields, so a
`world` line of the story or an edit of the reader after the fire does not hide the change on the day it happened.

## Tests

`tests/v2/chronicle/lasting.test.js` (the command, the lock, keep, replay, the Journal) and `lasting-host.test.js` (on the
Story Block host: a pack's two events, `chronicle.passed`, an event that waits for a date, the `chronicle-lasting`
capability, swipe, delete, rebuild and a fresh load). The delete fuzzes (`tests/v2/break/fuzz-delete*.test.js`) run a
pack of lasting events from `tests/v2/chronicle/helpers/lasting-pack.js`.
