# The living cast

A pack lists a hand-written cast. Each person starts somewhere with a goal and a routine and lives off-screen; the party meets them
by place and routine, or because their goal pulls them to the party. No dice, no backdrops; nameless people stay as generative as
before (the narrator invents them, NPC State Delta keeps a dossier if they matter). Code: `src/v2/cast/`. Tests: `tests/v2/cast/`, and
the cast stream of `tests/v2/break/fuzz-delete.test.js`. Mockup and decisions: the 1 Nov entries "Encounters redesign" to "Mockup v8"
of the suite notes' V2_LOG.

## Rules

- **Feature `story-director.cast`** ("The cast"): on by default, **no `presets`** (Lean keeps it). Off means fully off: no step, hook,
  query or screen, nothing in the prompt; what is stored stays. The Settings -> Modules -> Story Director -> The cast checkbox
  (`cast.on`) switches it off in the same way.
- **Prompts are byte for byte what they were while no pack has a cast**: the part has no fixed text and no change-line kind (the
  narrator writes no cast lines); its one tail cue exists only in the reply of a meeting. The module's tail budget gains the cue's
  (`TAIL_BUDGET`, 220 tokens).
- **The pack entry is read, never copied**: `packs.content({ kind: 'cast' })` (Story Block) gives `{ pack, packVersion, id, name,
  aliases?, about, look, voice?, personality?, history?, portrait?, start: { place, goal, routine? }, drawnTo?[], meters?, stages?,
  fields?, secrets?, canDieUnmet? }`. The state keeps only what the world needs to move a person (name, aliases, version, where,
  what they do, met or not).
- **Unmet cast is hidden** from every screen, from the narrator's text and from other modules. The reader sees counts; the planner
  prompt (a separate model call) is the only place unmet people are described.

## State: the `cast` domain

```
people:  { [pack:id]: { pack, eid, name, aliases?, ver, joined, where, doing, since, alive, met, heard, rev } }
         met:   null | { on, where, why: 'place' | 'goal', reason, rev }     (the entry's id is `eid`: a field called `id` must be a host id)
         heard: null | [{ on, text }]                                        (a slot, written whole: the last news of a met person)
notes:   { [id]: { at, kind: 'met' | 'moved' | 'updated', head, tag, rest, line, rev } }   what a reply tells its card; the newest 6 messages'
day:     null | [{ at, rev }]       the story minute the cast was last moved to (a slot)
meeting: null | [{ at, keys, rev }] who comes into the scene in the reply being written (`at`: the chat's length; a slot)
```

Replay-safe like every domain: a person is added whole under its key; a change inside a person is marked `ctx.ifThere`; a note is a new
key each time; anything rewritten later is a slot. A step is stored on the reply before the one it is for (the head when the hook
runs), so a note names the message its card goes under (`at`) rather than the reply that holds it.

## Steps (all cause `system`, from `beforeGenerate`; `hooks.js`)

1. `cast.sync { add?, update?, drop?, updated?, init?, names?, at? }`: new entries join the world at the current story minute at their
   start; an unmet person whose entry changed takes the new words (name, aliases) and keeps where they are; a met person keeps what they
   were met with (only the version moves); an entry that left takes an unmet person quietly (while its pack is enabled) and leaves a met
   one; a pack that is switched off keeps everyone. A pack the chat already had people from, now with new people, leaves one card line:
   "Ersveil pack updated: n new people now live in the world" (no names). `init` starts the cast's day.
2. `cast.advance { from, to, moves?, died?, at? }`: the planner's batch (below) after a day change or a time skip (the story day changed,
   or six story hours passed). A clock that went back only moves the cast's minute.
3. `cast.meet { at, who: [{ key, why, reason }], names? }`: the first meeting. By place: the party's place (`atlas.here`, else
   `scene.place`) is the person's `where` while their entry's routine has them there (a routine that names a time of day: dawn, morning,
   noon, afternoon, dusk, evening, night, daytime; one that names none holds at any hour; someone who has moved on from their start has
   no routine to keep). By goal: the planner judged a phrase of their `drawnTo` touched by the story and cited the reason (goal arrivals
   come first). At most one a reply, within the pace (setting `cast.faces`: `day1` 1 a day, `day2` 2 a day, `week1` 1 a week; the rest
   wait), never while a fight is on (`combat.session` that has not ended), never someone in the scene or pinned as a key person.

The cue: the reply of a meeting gets one tail line, `[Cast] <Name> comes into the scene in this reply...` with who they are, how they look,
how they speak, what they want and why now (`note.js`). A swipe rewrites the scene, not who you meet: the steps stay, the planner's
answer is kept in memory per key.

## The planner (`plan.js`)

Off-screen moves are one model call (Story Block's `sdk.callModel`, setting `cast.profile`, "Same as chat" by default), asked in the
background after the reply that moved the clock (`afterReceive`) and used before the next one (`beforeGenerate` waits at most 15 s). On
the chat's own connection a call can only run once the reply is over, so a plan not asked after the last reply (a reload) is asked now and
used by the next reply; a named connection is waited for. It answers one short line per person and only where something changed:

```
~ cast ref | place | what they are doing now
> cast ref | what in the story pulls them to {{user}}      (only people with `drawnTo`)
! cast ref | how they died                                 (only people marked "may die")
```

Read strictly (`readCast`): only those labels, only refs it named, each part cut and cleaned, a person once per label, at most 16/3/2 lines.
A death only where the setting "Unmet cast can die off-screen" is on or the entry has `canDieUnmet` (default off), and never for a met person.
People in the scene and pinned key people are not asked about. Between two moves, a cheap check in code (`touches`: the telling words of a
`drawnTo` phrase are in the last messages) asks the same planner for the `>` lines alone, once a story day. Failure (or no model) moves no
one, but the day is counted; meetings by place still happen.

## Query for other modules

`director.cast` -> `[{ key, pack, id, name, aliases, met: { on, where }, where, doing, lastHeard: { on, text } | null, alive, entry? }]`:
**only people who have been met**. `entry` is the pack's whole entry (portrait, secrets, meters, stages...), present while the pack is
enabled. An unmet person never leaves Story Director, not even a name: `director.cast.counts` gives `{ met, total, unmet }`.
`director.cast.view` (World -> Around here) is Story Director's own. All answer `null` while the feature is off.

Order: a meeting is a step stored before the reply it brings the person into, so `director.cast` lists them while that reply's prompt is
built and when it arrives; a module that ticks on that reply sees them at once (tests/v2/cast/query.test.js). To pin a met person,
NPC State Delta's dossier runs the existing reader command `keypeople.pin { name, aliases?, nsd? }` (cause `ui`, as `sdk.command` gives).

## Screens

- The reply's card: the status card leads with the notes whose `at` is the card's index (paths crossed with the reason, "While time
  passed", "pack updated") and its closed line.
- World -> Now -> Around here: "Cast whose paths may cross yours here: n, not yet met" (only when some are at this place), the met people's
  last news, "Met n of N from the <pack> cast" always.
- Settings -> Modules -> Story Director -> The cast: on/off, new faces at most, unmet can die, planner connection.
- Key people: the Pin chooser lists the people met from the cast.
