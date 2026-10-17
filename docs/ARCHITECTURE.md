# Story Director: module contract (v0.1)

The binding interfaces between modules. The why is in [DESIGN.md](DESIGN.md).

Plain ES modules, no dependencies, Node 24 (`npm test`, `npm run check`). Every module under
`src/` except `src/ui/*` is **pure**: no DOM, no SillyTavern globals, deterministic. Story
time is a number, **abs** = absolute minutes from the calendar's epoch.

Style: careful human-written code, short "why" comments, 4-space indent, single quotes, a
top-of-file comment per module; `textContent` only in the UI (never `innerHTML` with data).

---

## Data shapes

```js
Record = {
  key: 'Senior Listener Geva',          // display key, markdown stripped
  id: 'senior listener geva',           // lineKey(key): identity
  kind: 'agenda' | 'event' | 'hook' | 'quest' | 'clock' | 'beat' | 'secret',
  status: 'active' | 'resolved' | 'superseded',
  fields: { desc, now, then, on, due, shown, leg, arrive, place, people, encounter, type, giver, goal, reward, step, difficulty },  // strings, '' when unset
  extra: { [label]: value },            // labelled parts that are not a known field
  created: { message, time },           // message index; story abs or null
  changed: { message, time },
  seen:    { message, time },           // last change or mention
  resolved: { message, time, reason } | null,
  legSince: { message, time } | null,   // when the current leg was set (v0.3)
  pinned: false,
  arc: null,
  history: [{ message, op, text }],     // newest last, at most 20
}

Tracker = { version: 1, records: [Record], message: -1, time: null }
            // message: last message index applied; time: story abs at that point

Op = { op: '+' | '~' | '-' | '!', kind: string | null, key, id,
       fields: { [field]: value }, extra: { [label]: value }, reason: '', raw }

Finding = { kind, severity: 'error' | 'warn' | 'info', key: string | null, message }
```

Dormant is **derived** (relevance.js), never stored.

---

## `src/calendar.js`

```js
export const PRESETS;               // { gregorian, custom30 }: CalendarConfig
export const DEFAULT_PARTS_OF_DAY;  // { dawn: 360, morning: 540, noon: 720, afternoon: 900,
                                    //   dusk: 1140, evening: 1140, night: 1320, midnight: 0 }
export function normalizeCalendar(config) → CalendarConfig
export function makeCalendar(config) → Calendar
export function sharedCalendar(config) → { era, months: [{ name, days }] }   // v0.8: StoryDirector.calendar()
```

`sharedCalendar` normalizes the config and returns fresh plain copies of its era and months
(nothing else), so a caller's edit never reaches the settings.

`CalendarConfig`: `{ preset: 'gregorian' | 'custom', era: '', months: [{ name, days }], daysPerMonth: 30, leapYears: false, partsOfDay }`.
Also accepts bare month names plus `daysPerMonth`, and a world pack's
`{ era, days_per_month, months: [names] }`. Gregorian preset: real month lengths and leap
years.

`Calendar`:

```js
cal.config
cal.daysInYear(year)
cal.toAbs({ year, month, day, minutes = 0 }) → abs       // month 0-based, day 1-based
cal.fromAbs(abs) → { year, month, day, minutes }
cal.dayIndex(abs) → integer                              // Math.floor(abs / 1440)
cal.addDays(abs, days) → abs                             // fractional days allowed
cal.daysBetween(a, b) → number                           // (b - a) / 1440
cal.format(abs, { time = true, era = true } = {}) → 'CY 611, Goldwane 13, 05:50 am'
cal.parse(text, { reference = null } = {}) → ParsedDate | null
```

`ParsedDate = { abs, year, month, day, minutes /* null when no time */, hasTime, partOfDay, yearInferred, text }`.

Parsing (markdown stripped first, lenient): `[ERA] YEAR, Month D[, time]`, `Month D[, time]`,
`D Month [YEAR]`; month names case-insensitive, unambiguous 3+ letter prefixes allowed; time
`05:50 am`, `5:50pm`, `17:50`, `5 pm` or a part of day. A bare time or part of day means the
reference's day. No year: the year that puts the date **nearest** the reference
(`Dawnwane 2` seen on `Yearsend 28` is next year; `Haywane 10` seen on `Haywane 12` is this
year, in the past). No reference and no year: year 0. `parse` finds the first date anywhere in
the text.

## `src/changes.js`: change lines

```js
export const KINDS = ['agenda', 'event', 'hook', 'quest', 'clock', 'beat', 'secret', 'arc'];
export const KIND_ALIASES;    // offscreen/off-screen/npc → agenda, world → event,
                              // thread/hooks → hook, timer/clocks → clock, plan → beat, off-limits → secret
export const QUEST_FIELDS = ['type', 'giver', 'goal', 'reward', 'step', 'difficulty'];
export const FIELDS = ['desc', 'now', 'then', 'on', 'due', 'shown', 'leg', 'arrive', 'place', 'people', 'encounter', ...QUEST_FIELDS];
// A quest never goes dormant (relevance.js); its `due` is a deadline; `giver` counts as a mention.
export const QUEST_DIFFICULTIES = ['easy', 'normal', 'hard', 'nightmare'];
export function questDifficulty(value) → 'easy' | 'normal' | 'hard' | 'nightmare'
// (v0.8.2) The first word of `value` it knows (the four, or a synonym: trivial/simple/minor →
// easy, medium/moderate/average → normal, difficult/tough/dangerous → hard,
// deadly/impossible/extreme/lethal → nightmare), else normal; missing → normal. parseChanges
// stores a non-empty `difficulty:` this way, so the tracker only holds the four words (an
// empty one clears the field, which reads as normal).
// `encounter` (v0.8): the foes of a planned fight, free text in RPG Battle's shape
// (`3 bandit, bandit captain (boss)`, `2 x dire wolf rank D`), stored as written, never parsed.
export function lineKey(key) → id     // lowercase, markdown and punctuation squashed, spaces single
export function parseChanges(text) → { ops: [Op], errors: [{ line, message }] }
export function formatOp(op) → string // one change line; parseChanges(formatOp(op)) round-trips
```

Grammar, one op per line (blank lines ignored; bullets `*`/`-`/`•` *followed by the op* and
`**bold**` stripped; a line that is not an op is an error, not a crash):

```
+ [kind] Key — summary | label: value | …
~ Key — label: value | …
- Key — reason
! Key — what happened [| label: value …]
```

- Key ends at the first ` — `, ` – `, ` - ` (spaced hyphen) or, failing those, the first `:`
  when the text before it is ≤ 8 words.
- `Key — now: X` form: a key ending in a one-word field label (`Geva — now:`) gives that label
  to the first part.
- Parts split on ` | `. `label: value` with a label in `FIELDS` → `fields[label]`; another
  label of ≤ 3 words → `extra[label]`; an unlabeled first part → `fields.desc` for `+`/`~`,
  `reason` for `-`/`!`.
- `+` without a kind infers one: a quest field → quest, `leg`/`now` → agenda, `due` → clock,
  `encounter` → beat, else event.

## `src/tracker.js`

```js
export function emptyTracker() → Tracker
export function applyOps(tracker, ops, { message, time = null }) → { tracker, problems: [Finding] }
export function markSeen(tracker, text, { message, time = null }) → Tracker
export function replay(entries, { seed = null } = {}) → { tracker, problems: [Finding & { message }] }
export function findRecord(tracker, keyOrId) → Record | null
export function activeRecords(tracker, { kind = null } = {}) → [Record]
export function questsDoneIn(tracker, message) → [{ id, name, type, difficulty, reward, giver }]
export function keyWords(key) → [word]                       // v0.8.3
export function nearMatches(records, key) → [{ record, index }]
export function untrackedCorrections(problems, { message, limit = 3 } = {}) → [string]
```

All return new objects; inputs are never mutated.

- `+` new id → new record. `+` on an active id → applied as `~`, finding `duplicate-add`
  (info). `+` on a resolved id → reopened, finding `reopened` (info).
- `~` → only the given fields/extra change.
- `-` → status `resolved` (`superseded` when the reason matches /supersed|replac|merged/i);
  `resolved` filled.
- `!` (fired) → given fields applied; with none given, `then` becomes `now` and `then`/`on`
  clear; a `clock` becomes `resolved` (reason `fired`).
- Unknown id on `~`, `-` or `!` (v0.8.3), in this order:
  1. **Near match.** `nearMatches(records, op.key)` over **active** records only, by
     `keyWords` (lineKey's words less leading `the`/`a`/`an` and every `in at of on to for from
     the and`). Tier 1: the same word list. Only when tier 1 is empty, tier 2: one word set
     contains the other and the smaller has ≥ 2 words, or Jaccard ≥ 0.75. Exactly one hit in
     the first non-empty tier → the op is applied to it as if written with its key (history
     keeps op.raw), finding `near-key` (info): `"Footing in Bluewatch" read as "Footing at
     Bluewatch".` Two or more → no guess.
  2. **`~` with content** (some field or extra with a non-empty value) and no near match at all
     → a new record as `+` would make it, id `lineKey(op.key)`, kind `hook` unless `type:`
     names a kind (`kindOf`; the `type` field is then dropped, except a quest category such as
     `bounty`), finding `untracked-added` (info): `"Key" was not tracked; added as a hook
     (write "+ kind Key" to set its kind).`
  3. Otherwise → finding `unknown-key` (warn for `~`/`!`, info for `-`), `{ op, candidates? }`
     added (`candidates`: the ambiguous keys, also named in the message), nothing changes.
- `untrackedCorrections(problems, { message })`: one line per key (at most 3) for `unknown-key`
  problems of a `~` or `!` (with `message`, only replay problems from that message):
  `"Key" is not tracked: add it with "+ kind Key — …" before changing it.`, or with
  candidates `"Key" is not tracked: use its exact key ("A" or "B") or add it with "+ kind Key —
  …".` index.js passes the newest assistant reply at or before the note's `upTo` and appends
  the lines after the travel corrections (not while capture is on *always*), so a reply is
  corrected once, in the next note.
- Every applied op updates `changed`, `seen` and `history` (`text` = op.raw).
- `markSeen`: records whose key or any `people` name (comma separated, each ≥ 3 chars) appears
  in `text` (case-insensitive, word boundaries) get `seen = { message, time }`.
- `replay(entries)`: `entries` = `[{ message, ops: [Op] | null, text, time }]` in chat order;
  for each, `markSeen(text)` then `applyOps(ops)`; sets `tracker.message`/`tracker.time`.
  `seed` is a starting Tracker (default empty).
- `questsDoneIn` (v0.8.2): quest records with status `resolved` whose `resolved.message` is
  `message` and whose reason is not a failure (/fail|abandon|give up|forfeit|expired|missed|too
  late|cancel|refused|declined|botched/i), as plain objects (`name` = key, `type`/`reward`/
  `giver` trimmed, `difficulty` through `questDifficulty`). A quest closed in an earlier reply
  keeps that reply's message, so it is not listed again; reopened and closed later, it is
  listed at the later one.

## `src/seed.js`

```js
export function seedFromWorldState(text) → { ops: [Op], counts: { agenda, event, hook, clock } }
```

Reads the list sections of a World_State block: `Off-Screen` / `Elsewhere` → agenda;
`World` / `World events` → event; `Hooks` / `Unresolved Threads` / `Threads` / `Planted Seeds`
→ hook; `Clocks` / `Consequence Timers` / `Timers` → clock. Headings like `**📡 Off-Screen:**`
(emoji, bold optional; inline text after the colon is one item). Items are bullet lines in the
ledger format (`* **Geva — now:** Court | then: … | on: …`, `* Key — desc | then: …`,
`* Key: desc`); each becomes a `+` op of that kind (reuse `parseChanges`). Other sections (PC,
NPCs Present, Arc/Scene Phase) are ignored. `None`/`none` items are skipped.

## `src/mirror.js`

```js
export function mirrorOffscreen(worldStateText, agendas, { heading = '**📡 Off-Screen:**' } = {}) → string
```

Replaces the block's Off-Screen section (its heading line up to the next heading, `---` or the
end) with `heading` and one line per active agenda:
`* Key — now: X | then: Y | on: Z[ | leg: … | arrive: …]` (empty parts left out), or `* None`.
With no Off-Screen section, inserts it before the first of World/Hooks/Clocks/Arc Phase/Scene
Phase headings, else appends it. Text outside the section is untouched.

## `src/relevance.js`

```js
export const DEFAULTS = { budgetTokens: 1000, dormantReplies: 15, dormantDays: 30, dueSoonDays: 3 };
export function estimateTokens(text) → number          // Math.ceil(chars / 4)
export function dateOf(record, field, { calendar, reference }) → ParsedDate | null
export function isDue(record, { calendar, now }) → boolean       // on/due ≤ now; day level when no time
export function isArriving(record, { calendar, now }) → boolean  // arrive ≤ now
export function isDormant(record, { calendar, now, message, settings }) → boolean
export function classify(tracker, { calendar, now = null, message, place = '', sceneText = '', recentText = '', settings = DEFAULTS }) → Selection
export function encountersIn(selection, { calendar = null, now = null, dueSoonDays = 3 } = {}) → [Encounter]   // v0.8
```

`Encounter = { key, id, kind, encounter, place, on, status: 'due' | 'soon' }`: records of the
Selection with an `encounter`; due ones, then arriving ones (both `'due'`), then relevant ones
whose fire date (a clock's `due`, otherwise `on`; never a quest's deadline) falls within
`dueSoonDays`, soonest first (`'soon'`).

```js
Selection = {
  now, place,
  due: [Record], arriving: [Record],
  relevant: [{ record, reason, priority }],   // highest priority first; due/arriving not repeated here
  dormant: [Record], secrets: [Record],
  resolvedRecently: [Record],                 // resolved in the last 5 messages
}
```

- Only `active` records are due, arriving, relevant or dormant; `secret`s go to `secrets` only.
- Dormant: not pinned, nothing due/arriving within `dueSoonDays`, and
  (`message - seen.message ≥ dormantReplies` or `now - seen.time ≥ dormantDays` days).
- Priority (lower = first): 1 clock with `shown` sign/warning; 2 beat of the current arc
  (any active beat in v0.1); 3 place matches `place` (case-insensitive containment either
  way, also inside `now`/`leg`); 4 key or people in `sceneText`/`recentText`; 5 changed in the
  last 3 messages; 6 everything else that is not dormant.

## `src/note.js`

```js
export const CHANGE_INSTRUCTION;  // ≈140 tokens: how to write <Director> change lines
export const PACING, PACING_NO_CHANGES;  // the Pacing line, when something is scheduled
export const ENCOUNTER_CUE;       // v0.8: appended to Pacing while a due/arriving record has an encounter
export const NPC_PLANS_ONLY;      // v0.8: 'NPC State Delta keeps who each NPC is: agenda lines give only what they plan and when.'
export function buildNote(selection, { calendar, budgetTokens = 1000, corrections = [], instruction = CHANGE_INSTRUCTION, npcPlansOnly = false } = {}) → string
export function noteParts(selection, sameOptions) → [{ label, text, join }]   // v0.8.2
export const DIRECTOR_OUTPUT_TOKENS = 60;                                    // v0.8.2
export function noteTokens(parts, { outputTokens = DIRECTOR_OUTPUT_TOKENS } = {}) → { input, output, parts: [{ label, input, output }] }
export const NOTE_PART_WORDS;     // v0.8.4: { now, then, on, due, arrive: 12; desc, goal, step, reward, giver, encounter, type, shown: 16 }
export function notePart(text, field) → string                              // v0.8.4
```

(v0.8.4) Every record part the note writes (the Arc's desc, Due now, Arriving, the kind lines,
quests, the `fight:` foes) goes through `notePart`: trimmed, and when it has more words
(whitespace-separated) than `NOTE_PART_WORDS[field]` (16 for a field not listed), cut after that
many with `…`; a cut that leaves a `(` or `[` open goes back to before that word when words are
left, and trailing `,;:` and dashes are dropped. Keys are never cut; a `leg` is read whole (only
its destination is shown). The records are not changed, so the tabs, `encountersAt`,
`questsDoneAt`, `summarizeTracker` (planner and capture) keep the full text, and `noteParts` /
`noteTokens` (`api.manage.tokens()`) count the trimmed note.

(v0.8.2) `buildNote` is `noteParts` joined (each part's `join`, `'\n'` or `' '` for the
Encounter cue on the Pacing line, goes before its text). Labels, in order: Header, Arc, Due
now, Arriving, Off-screen, World, Hooks, Quests, Clocks, Beats, Do not reveal, Corrections,
Pacing, Encounter cue, Change instruction, NPC plans only. `noteTokens`: each non-empty part's
`estimateTokens` (≈ 4 characters a token) as its `input`; the Change instruction part also
carries `output` = `DIRECTOR_OUTPUT_TOKENS`, a rough allowance for the `<Director>` block it
asks the model to write (two tags and about two change lines of 20–25 tokens); `input` and
`output` are the sums.

`npcPlansOnly` (Story Suite: NPC State Delta is the source of truth for `npc`) appends
`NPC_PLANS_ONLY` as a line after a non-empty instruction; with `instruction: ''` nothing is
added. Off by default, so the note alone is unchanged.

Format (lines left out when empty):

```
[Story Director · CY 611, Goldwane 16, 09:00 am · Auvoth]
Due now: Saartje's sale (Goldwane 16) · Courier arrives Varnhold Watch (Goldwane 16, morning)
Off-screen: Geva — Bailiff Court → files the warrant (Goldwane 17) · …
World: Canal Street fires — curfew in force
Hooks: River stranger — who pulled Ren from the sump
Clocks: Hollin's Reach graves — the dead rise (Goldwane 28) · shown: sign
Beats: Council session opens (Goldwane 18, 09:00 am) · Ambush at the weir (Goldwane 19) · fight: 3 bandit, bandit captain (boss)
Do not reveal: who sold the weir route; Chiyo's debt
Corrections: …
<instruction>
```

A due or arriving record with an `encounter` ends its item with `(fight: <encounter>)`
(`Due now: Ambush at the weir (Goldwane 19) (fight: 3 bandit, bandit captain (boss))`), and the
Pacing line then ends with `ENCOUNTER_CUE`: the foes appear and the reply stops at the first
blow, since the fight is resolved outside the story.

Fits `budgetTokens` by dropping the lowest-priority relevant records first; the header, Due
now, Arriving, Do not reveal and the instruction are never dropped. Returns the instruction
alone when there are no records (the model still needs to know how to add them).

## `src/checks.js`

```js
export function checkReply({ before, after, ops, applyProblems = [], parseErrors = [], calendar, now, hadBlock }) → [Finding]
```

Kinds: `unknown-key`, `duplicate-add`, `reopened` (passed through from `applyProblems`);
`parse` (one per parse error, warn); `unfired` (info: due in `before`, still due in `after`
and not touched by `ops`); `missed` (warn: due more than 1 day before `now` and untouched);
`date-in-text` (info: a calendar date inside `now`/`then`/`desc` of a record changed by `ops`);
`no-block` (info: `hadBlock` false while something was due). (`long-part` is gone in v0.8.4:
the note trims long parts itself.)

## `src/routes.js` (v0.3): world packs and travel maths

```js
export const ROUTE_CODES;          // { W: 'river or canal', R: 'maintained road', … }
export const MODES = ['foot', 'ride', 'wagon', 'boat', 'ship', 'flight', 'courier'];
export function loadWorldPack(json) → { pack: WorldPack | null, errors: [str], warnings: [str] }
export function packSummary(pack) → '224 places · 310 routes'
export function exitsFrom(pack, place) → [{ to, km, code, corridor }]
export function findPlace(pack, text) → name | null        // case-insensitive, longest match inside text
export function paceFor(pack, code, mode, { corridor = null } = {}) → { rate, low, high } | null   // null = not allowed
export function legDays(km, rate, rules) → number          // ceil(km / rate / roundUpTo) * roundUpTo
export function shortestPath(pack, from, to, { mode = 'foot' } = {}) → Route | null
export function planRoute(pack, from, to, { mode = 'foot', rate = null, depart = null, calendar = null } = {}) → RoutePlan | null
export function parseLeg(pack, text) → Leg | null
export function validateLeg(pack, leg, { from = null, depart = null, arrive = null, calendar = null } = {}) → [Finding]
export function formatRoute(plan, calendar = null) → string
export function formatLeg(hop, { mode, rate, days, arrive = null, calendar = null }) → string
```

`WorldPack` (normalized from the reference format: `places`, `edges`, `pace_km_per_day`,
`courier_multiplier`, `travel_rules`, `calendar`, `scale_km_per_unit`; also accepts the
normalized shape itself):

```js
{ name, calendar: object | null,
  places: { [name]: { x, y, region } },
  edges: [{ a, b, km, code, corridor, notes }],          // undirected
  paces: { [code]: { foot, ride, wagon, boat, upstream, downstream, ship, vessel, flight } },
        // number | [low, high] | 'foot' (use foot pace) | null (not allowed)
  courierMultiplier: 2,
  rules: { roundUpTo: 0.5, restDayEvery: 6, crewedWaterRest: false, leveeRoads: [corridor names], noLevee: [corridor names] } }
```

Rules:

- `ride: 'foot'` rides at foot pace on that code; `null` means not allowed (wagons on T/M/U/H).
- W (water) is boat only, except a corridor in `leveeRoads` is also walkable/rideable/wagonable at
  R pace; `noLevee` never is. S = ship, D = vessel, A = flight, X = foot pace range. L (local),
  G and any code without a pace use R pace.
- A range `[low, high]` uses the midpoint unless an explicit `rate` is given; `validateLeg`
  accepts a stated rate inside the range (courier: inside the range × multiplier).
- `courier` = ride pace × `courierMultiplier`, no rest days.
- **Round-up rule:** each edge's days = `ceil(km / rate / roundUpTo) * roundUpTo`, summed.
- **Rest days:** foot, ride and wagon add `floor((activeDays - 1e-9) / restDayEvery)`; water
  modes none unless `crewedWaterRest`; courier none.

`Route = { from, to, km, hops: [{ from, to, km, code, corridor }] }` (Dijkstra by km; edges a
mode cannot use are skipped; between two places with several edges, the one the mode can use
with the fewest days).

`RoutePlan = Route + { mode, hops: [{ …, rate, days }], activeDays, restDays, days, depart, arrive }`
(`depart`/`arrive` abs when `depart` is given, else null).

`Leg` from `leg:` text, e.g. `Shorn → Varnhold Watch 35 B, courier 70/day → 0.5` or
`Bluewatch Village → Auvoth 70 F, wagon 14/day → 5`, also `->`, `to`, and the legacy
`(Shorn → Auvoth, 130 km B)`: `{ text, from, to, km, code, mode, rate, days }` (unknown pieces
null; places resolved with `findPlace`).

`validateLeg` findings (`{ kind, severity, key: null, message, correction? }`):

| kind | when | severity |
|---|---|---|
| `leg-unknown-place` | from or to is not in the pack | warn |
| `leg-no-edge` | no road between from and to, and no path either (`exits` listed) | error |
| `leg-not-one-hop` | no direct road, but a path exists (`firstHop`, `path`) | error |
| `leg-wrong-start` | `from` given and leg.from differs | error |
| `leg-km` | km off by more than 5 % | warn |
| `leg-mode` | the mode cannot use that road | error |
| `leg-arrive` | `depart` and `arrive` given and they differ from the computed arrival by more than 0.5 day | warn |
| `leg-code` | the road code differs from the actual road's | warn |
| `leg-rate` | a stated rate outside the road's pace range for the mode | warn |
| `leg-days` | stated days off by more than 0.5 from the computed days | warn |

`leg-unknown-place` and `leg-wrong-start` are reported alone. Days, rate and arrival are
checked only when the leg states a mode or a rate. A boat's stated rate on W may be anywhere in
the boat, upstream and downstream ranges (the data does not say which way a hop runs).

Every error/warn finding with a fixable leg carries `correction`: the corrected leg in the line
grammar, e.g. `Shorn → Varnhold Watch 35 B, courier 70/day → 0.5 | arrive: Haywane 13, morning`.

## `src/travel.js` (v0.3)

```js
export function travelFindings(tracker, { pack, calendar, previous = null, onlyChanged = false }) → [Finding & { correction?, id }]
export function nearbyPlaces(pack, place) → [name]   // the scene place and its one-hop neighbours
```

For every active record with a `leg` (only those whose leg changed since `previous` when
`onlyChanged`): parse it, take `from` from the record's previous leg end or the place named in
`now`/`place`, `depart` from `record.legSince.time`, `arrive` from `fields.arrive`, and run
`validateLeg`. Findings carry the record's key and id. The note lists each `correction` as
`Key — leg …`.

The tracker records `legSince = { message, time }` whenever an op sets a new non-empty `leg`
(cleared with the leg).

## `src/planner.js` (v0.4): arc planning

```js
export const DEFAULT_PLANNER_PROMPT;   // system template; macros below
export function summarizeTracker(tracker, { calendar = null } = {}) → string
export function buildPlannerMessages({ template = DEFAULT_PLANNER_PROMPT, recent = '', trackerSummary = '', nowText = '', place = '', nearby = [], directorNote = '', genre = '', previousArc = '', npcPlansOnly = false } = {}) → [{ role, content }]
export function parsePlan(text, { calendar = null, now = null } = {}) → Plan
export function validatePlan(plan, { calendar = null, now = null, userName = '' } = {}) → [Finding]
export function planToOps(plan, { arcId }) → [Op]
```

`DEFAULT_PLANNER_PROMPT`: general for any story (no setting assumed). The planner is the
story's showrunner for the **next arc**: it decides (never asks), plans the world and the NPCs,
never {{user}}'s actions, thoughts or words, keeps NPC plans true to their personalities, pulls
dropped threads and mentioned-but-unseen characters forward, and protects every secret it
creates. Macros: `{{recent}}` (the last messages, `Name: text`), `{{tracker}}`
(`summarizeTracker`), `{{now}}`, `{{place}}`, `{{nearby}}`, `{{note}}` (the reader's Director's
note), `{{genre}}`, `{{previous_arc}}`, `{{user}}`, `{{char}}` (left for SillyTavern to fill).
It asks for **only** these lines, one per line, inside `<plan>…</plan>`:

```
ARC: Name — what the arc is about and where it is heading
BEAT: Key — what happens | on: DATE or "in 2 days" | place: Place | after: Other beat
AGENDA: Name — now: … | then: … | on: DATE
HOOK: Key — the tension; what would settle it | then: … | on: DATE
CLOCK: Key — cause → consequence | due: DATE | shown: none
SECRET: Key — what {{user}} must not learn yet
```

3–6 BEATs, an AGENDA per NPC the arc moves, 1–3 HOOKs, 0–2 CLOCKs, a SECRET for every secret.
A fight (v0.8) is a BEAT with `| encounter: 3 bandit, bandit captain (boss)`, only where the
story would really come to blows, at most 1 or 2 per arc.
Dates may be absolute in the story's calendar or relative to now.

`summarizeTracker`: active records grouped by kind (`Off-screen:`, `World:`, `Hooks:`,
`Clocks:`, `Beats:`, `Secrets:`, `Arc:`), one line each (`Key — now/desc → then (on/due)`), then
up to 8 recently resolved (`Resolved: Key — reason`). `(nothing tracked yet)` when empty.

`buildPlannerMessages` → `[{ role: 'system', content: <template filled> }, { role: 'user',
content: 'Plan the next arc. Answer only with the <plan> block.' }]`. Unknown macros stay as
written. `npcPlansOnly` appends `NPC_PLANS_ONLY` (note.js) to the user turn, so a reader's own
template gets it too.

`Plan = { arc: { key, desc } | null, items: [{ kind, key, fields, extra, raw }], errors: [{ line, message }] }`:

- Finds `<plan>…</plan>` (else uses the whole text); strips `<think>`/`<thinking>` blocks, code
  fences, bullets and `**bold**`; labels are case-insensitive (`NPC AGENDA:` = `AGENDA:`,
  `OFF-LIMITS:`/`SECRET:` = secret, `TIMER:` = clock, `EVENT:`/`SUB-EVENT:` = beat,
  `THREAD:` = hook, `ENCOUNTER:`/`FIGHT:` = a beat with an `encounter`, taken from the
  `encounter:` part, else the description, else the key).
- After the label, the line is parsed like a change line (key, ` — `, parts split on ` | `,
  `label: value`); fields as in `FIELDS` of changes.js, plus `after` into `extra.after`.
- **Relative dates** in `on`, `due`, `arrive` become absolute when `calendar` and `now` are
  given, written with `calendar.format(abs, { era: false })`: `in N days|hours|weeks`,
  `tomorrow`, `the next day`, `next morning|evening|night`, `the day after tomorrow`, optionally
  `… at dawn|noon|dusk|… or HH:MM am`. Absolute dates stay as written.
- Lines it cannot read go to `errors`; nothing is invented.

`validatePlan` findings (`{ kind, severity, key, message }`): `plan-no-arc` (error, no ARC
line), `plan-empty` (error, no items), `plan-bad-date` (warn, an on/due that does not parse),
`plan-past-date` (warn, before now), `plan-user-action` (warn, an item whose key or `then`
starts with `userName`), `plan-unread` (info, per parse error).

`planToOps(plan, { arcId })` → `+ arc` op for the ARC (`key`, `desc`, `extra: { arc: arcId }`),
then a `+ <kind>` op per item with `extra.arc = arcId` (beats keep `extra.after`); ops have
`raw` set via `formatOp`.

Tracker support (v0.4): kind `arc` (one active arc at a time); an op whose `extra.arc` is set
stores it in `record.arc` (not in `extra`). Relevance: the current arc is the newest active
`arc` record; priority 2 = beats with `record.arc === currentArc.arc`; `Selection.arc` = the
current arc record or null.

## `src/capture.js` (v0.5)

```js
export const DEFAULT_CAPTURE_PROMPT;   // macros {{tracker}}, {{now}}, {{place}}, {{exchange}}, {{user}}, {{char}}
export function buildCaptureMessages({ template, trackerSummary, nowText, place, userText, replyText, npcPlansOnly = false }) → [{ role, content }]   // npcPlansOnly: as the planner's
export function parseCapture(text, tracker) → { ops, lines, dropped: [{ raw, reason }], errors }
```

The answer's `<Director>` block (else the whole text, minus thinking and fences) is parsed as
change lines; `~`/`-`/`!` of an untracked key (unless `nearMatches` finds exactly one record:
the tracker then reads it as that one; v0.8.3) and `+ arc` are dropped. `lines` is the kept ops
through `formatOp`, written into the reply's `<Director>` block. Settings `capture: { mode:
'off' | 'fallback' | 'always', model, maxTokens }`; `always` also drops the note's instruction.

## `src/wsa.js` (v0.5)

```js
export function importWorldStateAlpha(input) → { ops, counts: { facts, developments, skipped }, errors }
```

A `world_state_alpha_bundle`: each active record → `+ event` with key = the summary's first
clause (≤ 7 words, made unique), `desc` = the summary (unless it is the key), `people` = anchors,
`extra.trend` for developments, `extra.settled: yes` for facts, `extra.since` = timeAnchor.

## `src/places.js` (v0.6): the place book and map coordinates

```js
parseLocation(text) → { name, spot, parts, coords: { x, y } | null }   // "Auvoth | Terrace | [59.0, 110.0]"
buildPlaceBook(visits, { pack }) → { places, current }
    // visits: [{ message, time, text }] in chat order (the scene's Loc cell per reply).
    // place: { key, name, coords, coordsFrom: 'story'|'pack'|null, visits, firstTime, lastTime, lastMessage, spots }
    // A stay over consecutive replies is one visit; the latest coordinates win; a pack fills gaps.
findBookPlace(book, text) → place | null
mapSettings(map) → { north: 'up'|'down', east: 'right'|'left', kmPerUnit, roadFactor }
distanceKm(a, b, map) → number | null            // straight line × kmPerUnit
bearing(a, b, map) → 'N'…'NW' | ''               // axes from the map settings
nearbyByCoords(book, place, { maxKm = 100, map }) → places, nearest first
estimateTrip(from, to, { map, mode, rate, rules }) → { straightKm, roadKm, rate, days, restDays, direction } | null
formatTrip(trip, { map }) → "Shorn → Auvoth ≈ 219 km SE (≈ 175 km straight × 1.25) · foot 20/day · 12 days (1 rest)"
```

Land trips take the straight line × `roadFactor`; boats, ships and flight go straight. Days use
`routes.js`'s `legDays` (half-day round-up) and `restDaysFor`. Pure.

## `src/suite.js` (v0.8): the Story Suite handshake

Shared byte for byte with Story Block, NPC State Delta and RPG Battle; the contract is
[STORY_SUITE.md](STORY_SUITE.md). Never edited here alone.

```js
export const SUITE_VERSION = 1;
export const AREAS;   // { scene, npc, calendar, timeline, stats, items, rolls }: owner ids, in order
export function storySuite() → Registry          // globalThis.StorySuite, created or upgraded on first use
export function isSourceOfTruth(myId, area, choice = 'auto', suite = storySuite()) → boolean
// Registry: announce({ id, name, version, owns, enabled?, api? }), withdraw(id), providers(),
//           has(id), api(id), owner(area), offering(area), onChange(listener) → unsubscribe
```

`isSourceOfTruth`: `'mine'` → true; `'theirs'` → true only when no other extension offers the
area; `'auto'` → the suite's owner is `myId`, or nobody owns it. Alone, every choice is true.

## `src/manage.js` (v0.8.1): Story Suite's overlay

What Story Director announces, and the handle Story Block's overlay uses to manage it
([STORY_SUITE.md](STORY_SUITE.md#one-place-to-manage-them-all)). Pure: index.js passes in how
to read, save and show the settings.

```js
export const SOURCE_CHOICES;                       // ['auto', 'mine', 'theirs']
export function sourceChoices(saved, areas) → { [area]: choice }   // unknown or missing → 'auto'
export function suiteAnnouncement({ id, name, version, areas, settings, storyBlock, api, panel })
  → { key, provider | null }
export function makeManage({ areas, read, save, panel = () => null, tokens = () => null })
  → { areas, sources(), setSource(area, choice) → boolean, enabled(), setEnabled(on), tokens() }
export function suiteOpener(suite) → (tab) => void | null
```

`suiteAnnouncement`: no Story Block → `{ key: '', provider: null }` (withdraw); tracking on →
`key 'on:<owns>'`, `owns` = `areas` less any whose choice is `'theirs'`; tracking off →
`key 'off'`, `enabled: false`, `owns: []`. Every provider carries `settings: panel` (the
panel's selector) and `api`. `makeManage`: `setSource` rejects an unknown area or choice
(false, nothing changed), otherwise tells `panel().setSource` and saves the settings with that
choice; `setEnabled` tells `panel().setEnabled` and saves `enabled`. (v0.8.2) `tokens()`
returns a clean copy of `tokens()`'s report (`{ input, output, parts: [{ label, input, output
}] }`, whole numbers ≥ 0), or `{ input: 0, output: 0, parts: [] }` when it has none or throws.
`suiteOpener` is non-null
while two or more providers are announced (on or off) and `suite.api('story-block').openSuite`
is a function.

## `src/ui/settings.js`

```js
export function renderSettings(container, { settings, blocks = [], onChange, onSeed, status = '', others = [], suiteLink = false, onOpenSuite = null, … })
  → { root, update(settings), setOthers(names), setSource(area, choice), setEnabled(on), setSuiteLink(shown) }
```

```js
Settings = {
  enabled: true, sceneTag: 'World_State', depth: 1,
  budgetTokens: 1000, dormantReplies: 15, dormantDays: 30, dueSoonDays: 3,
  mirrorOffscreen: true,
  calendar: { preset: 'custom', era: '', months: [{ name, days }], daysPerMonth: 30 },
  sourceOfTruth: { calendar: 'auto', timeline: 'auto', npc: 'auto' },   // v0.8: 'auto' | 'mine' | 'theirs'
}
```

Inside SillyTavern's `inline-drawer` markup (header "Story Director"), a status element
`#story_director_status`, sections **Tracking** (on/off switch; scene block select from
`blocks` = `[{ tag, name }]`, free text when empty; depth; budget), **Dormant** (replies, story
days, due-soon days), **Calendar** (preset; era; months textarea of `Name` or `Name | days`
lines; days per month), the Off-Screen mirror switch (for a World State that keeps an
Off-Screen list), **Source of truth** (v0.8: one select per Story Suite area, Automatic / This
extension / The other one, with a note naming the other extensions announced), and a **Seed
from World State** button calling `onSeed()`. `onChange(next)` on every edit with a full new
object; never mutates the input. `renderSettings(…, { others: [names] })` and
`setOthers(names)` set that note in place, without redrawing. (v0.8.1) `setSource(area,
choice)` and `setEnabled(on)` take a change made elsewhere (Story Suite's overlay): kept in the
panel's copy for its next edit and shown in the select or switch, without redrawing or calling
`onChange`. A *Manage all in Story Suite* line, first in the drawer's content and outside the
redrawn view, calls `onOpenSuite()`; hidden unless `suiteLink` / `setSuiteLink(true)`. Its
element carries `data-story-suite-link`, so the overlay can hide it while it holds the panel.

(v0.8.2) The markup is the Story Suite's shared panel (docs/STORY_SUITE.md, "One look for the
four settings panels"; styled by `src/suite.css`, identical in the four extensions, which
`index.js` links once per page as `<link id="story-suite-css">` unless an element with that id
exists). The drawer content is `.story-suite-panel`; the Manage all line is
`div.story-suite-manage[data-story-suite-link]` (a `menu_button` with `fa-layer-group`);
`.story-suite-quickbar` holds the two switches and `.story-suite-actions` (Plan arc, Seed from
World State); the sections are `details.story-suite-fold[data-fold]` (`tracking`, `calendar`,
`pack`, `arc`, `capture`, `chat`) in `.story-suite-folds`, each `summary` a `<b>` title and a
`<small>` summary of its main setting (refreshed on every edit), body `.story-suite-fold-body`;
all start closed and the open ones are kept in `localStorage`
(`story_director_settings_open_groups`, wrapped). Every setting is a `story-suite-row`
(`label[for]` when it has a control id): `<span><b>Label</b><small>hint · Now: …</small></span>`
and the control, a checkbox straight in the row (shown as a pill), a number in
`.story-suite-number` with its unit; Dormant shelf, World pack and Source of truth are
`.story-suite-subhead`s; the status line and the world pack message are `.story-suite-notice`s.
Ids are unchanged.

## `src/ui/quests.js` (v0.7.1)

```js
export function renderQuests(pane, { quests, finished, formatDate, status }) → void
// quests: active quest records; finished: resolved ones, most recent first;
// status(record) → 'overdue' | 'soon' | '' marks the deadline.
```

Groups by `fields.type` (main, side, bounty, contract, mission, favour, then others by name,
untyped last); plural spellings join their singular. Never hidden by the spoiler guard.
(v0.8.2) Every quest's head carries a `story-director-tag is-difficulty is-<difficulty>` tag
(`questDifficulty`, so `normal` when none was written).

## `src/ui/tab.js`

```js
export function renderTab(pane, { timeText = '', place = '', selection, findings = [], formatDate = null, canSeed = false, onSeed = null, onPin = null }) → void
```

For Story Block's sidebar pane: **Now** (time, place); **Due now** and **Arriving**; active
records by kind (Off-screen, World, Hooks, Clocks, Beats), each with its key and labelled rows
(now/then/on/due/leg/arrive/encounter/desc, like Story Block's scene facts; a record with an
`encounter` also has a `fight` tag in its head) and a pin toggle calling
`onPin(id, pinned)`; **Dormant** (folded `<details>` with a count); **Do not reveal** (folded,
content added only when opened); **Resolved recently** (folded); **Problems** (findings:
errors, then warnings, each in its own box under a "Problems" heading counting them; then
(v0.8.4) every `info` finding, and any severity the contract does not name, in one closed
**Notes** fold, `details.story-director-fold.is-notes` with its count, remembered open for the
session like the other folds; with only notes, the fold alone). The lock's counts name errors
and warnings only, as does the toast after a reply. Empty state: "Nothing tracked yet." plus a **Seed from World State**
button when `canSeed`.

## `index.js` (SillyTavern glue, written last)

Needs Story Block 0.6+ (`globalThis.StoryBlock.apiVersion >= 1`): registers the `<Director>`
transport block, reads the scene block, replays `<Director>` blocks from the chat, injects the
note at `depth` as a system message from its generate interceptor, checks each reply, writes
the Off-Screen mirror, registers the "Director" tab, and renders settings.

`globalThis.StoryDirector` (`apiVersion: 1`, read-only): `version`, `timeAt(index)`,
`formatTime(abs)`, and (v0.8) `encountersAt(index)`: `encountersIn` of the Selection the note
would build for the scene at message `index` (the tracker up to it, the newest scene block at
or before it), or `[]` on any failure. Story Director never resolves a fight: the caller (RPG
Battle) runs it, and the model closes the record with `!` or `-` when it narrates the outcome.
Also (v0.8) `calendar()`: `sharedCalendar(settings.calendar)`, the Gregorian default until the
reader sets one. (v0.8.2) `questsDoneAt(index)`: `questsDoneIn(trackerAt(index).tracker,
index)` for an assistant message inside the chat, `[]` for anything else, while tracking is
off, or on any failure. Like `encountersAt`, an addition keeps `apiVersion` 1; the suite's
`api` spreads the same object, so it has it too.

**Story Suite** (v0.8): `{ id: 'story-director', name: 'Story Director', version, owns,
enabled, settings: '#story_director_settings', api }` (`suiteAnnouncement`) is announced while
Story Block is there (at start, once Story Block links, and after every settings edit; an
unchanged state is not announced again, since every announcement wakes every listener), and
withdrawn while it is not. `owns` = `calendar`, `timeline`, `npc`, less any area whose
`sourceOfTruth` choice is `'theirs'`. (v0.8.1) With tracking off it is announced with
`enabled: false` and no `owns` rather than withdrawn, so Story Suite's overlay can switch it
back on; the registry's `owner`, `has` and `api` skip it as before. `api` is
`{ ...globalThis.StoryDirector, manage }`, built once (the global itself has no `manage`);
`manage` is `makeManage` over `settings()`, `applySettings` (the same function as the panel's
`onChange`: store, save, announce, clear the replay cache, refresh Story Block) and the
settings panel; (v0.8.2) its `tokens` is `noteTokens` of `noteParts` for the next ordinary
reply, built with the same options as the injected note (`noteOptions`) and with SillyTavern's
macros filled per part. Nothing (all zeros) while the note is not sent; planner and capture
calls are quiet calls and not counted, and with capture on *always* the output allowance is 0. `settings` names the wrapper `#story_director_settings` that
`addSettingsPanel` creates under `#extensions_settings2` (or `#extensions_settings`), which
the overlay moves into itself while open. One `onChange` listener only refreshes the settings'
list of the other extensions and the *Manage all in Story Suite* line (`suiteOpener`; a click
calls `openSuite('story-director')`). Where it matters, `isSourceOfTruth('story-director', area,
choice)` is asked at the moment of use: `npc` false → `npcPlansOnly` for the note, the
planner and capture; `timeline` false → no Off-Screen mirror. Any suite failure counts as
being the source of truth, so Story Director alone behaves exactly as before.
