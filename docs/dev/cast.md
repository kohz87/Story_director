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
         rumored: undefined | [{ on, where, at, rev }]                       (a slot, written whole: an unmet person the reader sought who is elsewhere, heard of once)
notes:   { [id]: { at, kind: 'met' | 'moved' | 'updated' | 'heard', head, tag, rest, line, rev } }   what a reply tells its card; the newest 6 messages'
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
   wait), never while a fight is on (a `combat.session` that has not ended, or a Lean RPG Foes block with a foe in it while the RPG feature is on), never someone in the scene or pinned as a key person.

4. `cast.withdraw { at, keys }` (from `afterCapture`, stored on the reply): a planned meeting counts only if the reply shows the person. After the
   reply's change lines, a person the meeting brought in (`why` place or goal) whose name or alias (whole word, any case; a title alone is not
   a name) is not in the reply's shown words (hidden comments and the change block out) and is in no `+ present` line is unmet again: a goal
   arrival goes back to where they were (`met.was`), the "Paths crossed" card line goes, the pace is not used up, they may come again. `why:
   'story'` is never withdrawn. It runs before NPC State Delta's step after the reply (its `npc.tick` follows the `turn` event), so no dossier is
   made for a withdrawn meeting; a swipe or Re-read decides again. The hook opts in (`hook.always`, Story Block's afterCapture) to run for a
   reply with no change lines too; module.js then runs only the parts that opted in. Needs a Story Block with that option (the vendored testkit has it).

5. **Sought** (`sought.js`, hooks.js, part of the same feature): the reader's latest message (or the story's last reply) may look for a kind of
   person ("a healer or sister around"). The cheap gate (`kindTouches`): a telling word of an unmet, living, placed person's calling
   (pack `fields.Calling`) or the name-free lead of their `about` is in those texts. Then the planner is asked once per message pair (mode
   `sought`, plan key `sought|<print>|<hash of both texts>`, after the reply in `afterReceive`; on a named planner connection also in `beforeGenerate`
   and waited for): it may answer one `? cast ref | "the words"`; `readCast` accepts it only if the ref was offered and `citedIn` finds the words as
   whole words in the message or reply (a made-up phrase is refused). On the chat's own connection the answer is used by the next reply (a
   swipe of that reply finds the same answer in memory). `chooseMeetings` then takes the sought person after a goal arrival and before a place
   meeting: at the party's place (routine holding) a meeting with `why: 'sought'` and `reason` the cited words (the pace and one a reply
   apply; `applyWithdraw` takes it back like any planned meeting); they do not move. Elsewhere, `chooseRumor` (no meeting, no pace used, never
   in a fight, never when a meeting is made in the same reply, never someone present, pinned, met or dead, never a person with no place) makes
   `cast.rumor { at, who: [{ key, where, text }] }`: `person.rumored = [{ on, where, at, rev }]` (a slot, written whole, `ctx.ifThere`) and a
   note of kind `heard` ("Heard of: <description>"). `rumorText` builds the description from calling, the `about` lead and the routine/place
   and never carries the name, an alias or a name-like word (parts that do are dropped; with nothing left there is no rumor). The tail's `[Cast]
   People here know of ...` line is rebuilt from the entry and `rumored.where` for the reply at `rumored.at` only. A rumor is told once per
   place: again only after `where` changes (the planner's move), until they are met.

The cue: the reply of a meeting gets one tail line, `[Cast] <Name> comes into the scene in this reply...` with who they are, how they look,
how they speak, what they want and why now (`note.js`). A swipe rewrites the scene, not who you meet: the steps stay, the planner's
answer is kept in memory per key.

A cast member's `start.place` is the name of a pack place (Story Studio writes it so); it is matched by name, slug or alias, in any case
(`placeMatcher`, `entries.js`). A place the pack does not have leaves them unplaced (`where` empty: not met anywhere, "unknown" to the planner)
until the planner places them; a planner's place that is one of the pack's goes by its name. With no places listed, it stays as written.

## The planner (`plan.js`)

Off-screen moves are one model call (Story Block's `sdk.callModel`, setting `cast.profile`, "Same as chat" by default), asked in the
background after the reply that moved the clock (`afterReceive`) and used before the next one (`beforeGenerate` waits at most 15 s). On
the chat's own connection a call can only run once the reply is over, so a plan not asked after the last reply (a reload) is asked now and
used by the next reply; a named connection is waited for. It answers one short line per person and only where something changed:

```
~ cast ref | place | what they are doing now
> cast ref | what in the story pulls them to {{user}}      (only people with `drawnTo`)
! cast ref | how they died                                 (only people marked "may die")
? cast ref | "the words that ask for them"                 (mode `sought` only: see Steps, 5)
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
- Keeping the card of the newest reply in view is Story Block's (its "This reply" card mount scrolls the chat when the reader was at the bottom);
  the cast does not scroll the page.
- World -> Now -> Around here: "Cast whose paths may cross yours here: n, not yet met" (only when some are at this place), the met people's
  last news, "Met n of N from the <pack> cast" always. The heading after the words is one line: the place (`director.cast.view` `place`, cut with "…", the full
  place as its tooltip), then the time of day (`dayText`, "· morning"), which goes first when the two do not fit; `heading` is the same in one string.
- Settings -> Modules -> Story Director -> The cast: on/off, new faces at most, unmet can die, planner connection.
- Key people: the Pin chooser lists the people met from the cast.
