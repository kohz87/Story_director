# Key people

People the reader pins, whose off-screen story keeps going while they are away. Story Director owns the list; NPC State
Delta reads it (it never writes to it, and Story Director never writes to NPC State Delta). Code: `src/v2/keypeople/`.
Tests: `tests/v2/keypeople/`, and the key people stream of `tests/v2/break/fuzz-delete.test.js`.

## Rules

- **Feature `story-director.key-people`** ("Key people"): on by default, **no `presets`** (so Lean keeps it), and not part
  of `story-director.threads`. Off means fully off: no kind, line, command, query, widget or prompt text; what is stored stays.
- **Cap** (setting `keypeople.cap`, default 10, 0 to 100): the reader's Pin is refused with a sentence past it.
- **Narrator budget** (setting `keypeople.tokens`, default 300, no upper limit): the tokens the away people may take in the
  tail (four characters a token, the header counts). The module's `context.budget` is a getter that follows the setting
  (`context.budgetOf`, `module.js`), so the host does not cut it at the sum of the fixed budgets; the host's overall tail
  budget (Settings → Tabs & Packs) still caps everything.
- **Auto-removal**: a pinned person who dies in the story (`- key Name | died`), is archived or lost in NPC State Delta, or is
  unpinned by the reader leaves the list; `gone` records the reason (`died`, `archived`, `unpinned`).
- Only a **pinned** person may be away. A back date passing moves nobody: the tail says "due back" and the narrator brings them.

## State: the `keypeople` domain

```
pins:  { [key]: { name, since, rev, aliases?, nsd? } }   key = lineKey(name); since: story minute | null;
                                                          nsd: NPC State Delta has known them (set by the sync step)
away:  { [key]: { name, doing, since, back, steps: [{ date, text }], rev } }   back: start of the day they are due | null
gone:  { [key]: { name, reason, on, rev, owed? } }       the newest 30; owed: NPC State Delta's removal whose card line is not told yet
notes: { [id]: { sid, kind: 'back' | 'gone', name, head, rest, lead, rev, key?, goneRev? } }   what a reply told its card; the newest 6 replies'
                                                          (key + goneRev: a told removal names its `gone` record and that record's rev)
```

Replay-safe like every domain: each thing is added whole under its key; a change inside an away record is marked
`ctx.ifThere` (passed over when the reply that made the record was deleted); a note is a new key each time, never changed.
A chat saved before the domain existed has none: every reader treats a missing slice as empty.

## Change lines (the narrator)

```
+ away Ren — scouting the north road | back: Goldwane 18      goes away (~ changes what they do or the date)
! away Ren — reached Wolfmere Outpost                          a step on the timeline (same text twice is one)
- away Ren                                                     back
- key Ren | died                                               a death: the pin goes (a `- key` without a death word is refused)
```

`back:` is a date on the chat's calendar or a stretch from now ("in 6 days"); one that cannot be read is a Problem and the date
is left as it was. The tail (one line per away key person, soonest return first, then the latest step):

```
[Key people] Away from the scene:
Ren: away, scouting the north road, back Goldwane 18; latest: reached Wolfmere Outpost.
Odda: away, at the Seal council, due back (Goldwane 12).
```

Over budget, the rest are left out of that reply (still tracked). The static paragraph and the two grammar lines belong to the
feature (the same bytes every reply).

## Commands

- `keypeople.pin { name, aliases?, nsd? }`, `keypeople.unpin { name }`: cause `ui` only, on the latest reply (`data.edit`).
- `keypeople.sync { who?: [{ name, reason: 'died' | 'archived' }], known?: [name] }`: cause `system` only, from the
  `beforeGenerate` hook (`keypeople/nsd.js`); `who` takes people off the list, `known` notes on a pin that NPC State Delta
  has known them. At most one step before a reply, none when there is nothing to say. It is stored on the reply before the one being
  written and takes the pin off at once (the narrator is not told of them), but writes no card line: the `gone` record is marked `owed`.
- `keypeople.tell { who: [key] }`: cause `system` only, from the `afterCapture` hook (`index.js`) once the new reply's lines have run, for
  every `gone` record that is `owed`. It clears `owed` (marked `ctx.ifThere` on the record) and writes the card line on **the reply being
  written** when the removal was decided, so that reply's card says it. A swipe or a Re-read of that reply runs it again; deleting it
  leaves the record owed for the next reply. A reply with no change lines gets no `afterCapture`, so the line waits for the next reply that
  has some. A line whose `gone` record is not there any more (the reply holding the sync step was deleted) is not drawn (`goneRev`).

## Removal by NPC State Delta (read only)

Two ways to ask, the first that answers wins; silence (Delta off, dossiers not loaded) releases nobody:

1. Its Story Suite api (`StorySuite.api('npc-state-delta')`: `npcs()` and `npcProfiles()`; the profiles are the tracked people
   who are neither archived nor dead): in `npcs()` and archived is `archived`; in `npcs()` but not in the profiles is `died`.
   Delta does not announce itself to the registry on a Story Block 2 host, so this path is for hosts where it does.
2. Its queries (`npc.known`: not archived; `npc.dossier`: `lifeState`): `lifeState: 'deceased'` is `died`; a pinned person
   with `nsd` set who is no longer in `npc.known` is `archived`.

## Query for other modules

`director.keyPeople` → `[{ name, aliases?, here, away: { doing, since, back, steps: [{ date, text }] } | null, removed?: { reason, on } }]`.
Pinned people in the order they were pinned, then those taken off the list (`removed`). `since`, `back`, `date` and `on` are story
minutes (`back` is the start of the day), null when not known. `here`: the scene lists them as present (Story Block's
`scene.present` or Delta's `npc.present`; by name or alias). Read-only copies. While the feature is off the query answers `null`;
an older Story Director has no such query (callers ask through a try).

`director.keyPeople.view` (the World screen's section) and `director.keyPeople.on` are Story Director's own.

## Screens

World → Now: section "Key people · n of cap" (widget `story-director.key-people`, `keypeople/widget.js`; rows, Unpin, "+ Pin"
chooser listing who is here, who the threads {{user}} knows name, who was met from the cast, who Delta tracks; the token note). The per-reply status card:
"<name> is back" / "<name> is no longer a key person" lines in its body and at the head of its closed line, from `notes`
(`changed(n)`, and for a told removal also that its `gone` record is there with the rev the note names). Settings → Modules → Story Director → Key people: the two numbers.
