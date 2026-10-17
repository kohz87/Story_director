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
  fields: { desc, now, then, on, due, shown, leg, arrive, place, people, type, giver, goal, reward, step },  // strings, '' when unset
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
```

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
export const QUEST_FIELDS = ['type', 'giver', 'goal', 'reward', 'step'];
export const FIELDS = ['desc', 'now', 'then', 'on', 'due', 'shown', 'leg', 'arrive', 'place', 'people', ...QUEST_FIELDS];
// A quest never goes dormant (relevance.js); its `due` is a deadline; `giver` counts as a mention.
export function lineKey(key) → id     // lowercase, markdown and punctuation squashed, spaces single
export function parseChanges(text) → { ops: [Op], errors: [{ line, message }] }
export function formatOp(op) → string // one change line; parseChanges(formatOp(op)) round-trips
```

Grammar, one op per line (blank lines ignored; bullets `*`/`-`/`•` *followed by the op* and
`**bold**` stripped; a line that is not an op is an error, not a crash):

```
+ [kind] Key — part | label: value | …
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
- `+` without a kind infers one: `leg`/`now` → agenda, `due` → clock, else event.

## `src/tracker.js`

```js
export function emptyTracker() → Tracker
export function applyOps(tracker, ops, { message, time = null }) → { tracker, problems: [Finding] }
export function markSeen(tracker, text, { message, time = null }) → Tracker
export function replay(entries, { seed = null } = {}) → { tracker, problems: [Finding & { message }] }
export function findRecord(tracker, keyOrId) → Record | null
export function activeRecords(tracker, { kind = null } = {}) → [Record]
```

All return new objects; inputs are never mutated.

- `+` new id → new record. `+` on an active id → applied as `~`, finding `duplicate-add`
  (info). `+` on a resolved id → reopened, finding `reopened` (info).
- `~` → only the given fields/extra change. Unknown id → finding `unknown-key` (warn), nothing
  invented.
- `-` → status `resolved` (`superseded` when the reason matches /supersed|replac|merged/i);
  `resolved` filled. Unknown id → `unknown-key` (info).
- `!` (fired) → given fields applied; with none given, `then` becomes `now` and `then`/`on`
  clear; a `clock` becomes `resolved` (reason `fired`). Unknown id → `unknown-key` (warn).
- Every applied op updates `changed`, `seen` and `history` (`text` = op.raw).
- `markSeen`: records whose key or any `people` name (comma separated, each ≥ 3 chars) appears
  in `text` (case-insensitive, word boundaries) get `seen = { message, time }`.
- `replay(entries)`: `entries` = `[{ message, ops: [Op] | null, text, time }]` in chat order;
  for each, `markSeen(text)` then `applyOps(ops)`; sets `tracker.message`/`tracker.time`.
  `seed` is a starting Tracker (default empty).

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
```

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
export const CHANGE_INSTRUCTION;  // ≈120 tokens: how to write <Director> change lines
export function buildNote(selection, { calendar, budgetTokens = 1000, corrections = [], instruction = CHANGE_INSTRUCTION } = {}) → string
```

Format (lines left out when empty):

```
[Story Director · CY 611, Goldwane 16, 09:00 am · Auvoth]
Due now: Saartje's sale (Goldwane 16) · Courier arrives Varnhold Watch (Goldwane 16, morning)
Off-screen: Geva — Bailiff Court → files the warrant (Goldwane 17) · …
World: Canal Street fires — curfew in force
Hooks: River stranger — who pulled Ren from the sump
Clocks: Hollin's Reach graves — the dead rise (Goldwane 28) · shown: sign
Beats: Council session opens (Goldwane 18, 09:00 am)
Do not reveal: who sold the weir route; Chiyo's debt
Corrections: …
<instruction>
```

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
`long-part` (info: a field of a changed record over 12 words); `no-block` (info: `hadBlock`
false while something was due).

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
export function buildPlannerMessages({ template = DEFAULT_PLANNER_PROMPT, recent = '', trackerSummary = '', nowText = '', place = '', nearby = [], directorNote = '', genre = '', previousArc = '' } = {}) → [{ role, content }]
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
Dates may be absolute in the story's calendar or relative to now.

`summarizeTracker`: active records grouped by kind (`Off-screen:`, `World:`, `Hooks:`,
`Clocks:`, `Beats:`, `Secrets:`, `Arc:`), one line each (`Key — now/desc → then (on/due)`), then
up to 8 recently resolved (`Resolved: Key — reason`). `(nothing tracked yet)` when empty.

`buildPlannerMessages` → `[{ role: 'system', content: <template filled> }, { role: 'user',
content: 'Plan the next arc. Answer only with the <plan> block.' }]`. Unknown macros stay as
written.

`Plan = { arc: { key, desc } | null, items: [{ kind, key, fields, extra, raw }], errors: [{ line, message }] }`:

- Finds `<plan>…</plan>` (else uses the whole text); strips `<think>`/`<thinking>` blocks, code
  fences, bullets and `**bold**`; labels are case-insensitive (`NPC AGENDA:` = `AGENDA:`,
  `OFF-LIMITS:`/`SECRET:` = secret, `TIMER:` = clock, `EVENT:`/`SUB-EVENT:` = beat,
  `THREAD:` = hook).
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
export function buildCaptureMessages({ template, trackerSummary, nowText, place, userText, replyText }) → [{ role, content }]
export function parseCapture(text, tracker) → { ops, lines, dropped: [{ raw, reason }], errors }
```

The answer's `<Director>` block (else the whole text, minus thinking and fences) is parsed as
change lines; `~`/`-`/`!` of an untracked key and `+ arc` are dropped. `lines` is the kept ops
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

## `src/ui/settings.js`

```js
export function renderSettings(container, { settings, blocks = [], onChange, onSeed, status = '' }) → { root, update(settings) }
```

```js
Settings = {
  enabled: true, sceneTag: 'World_State', depth: 1,
  budgetTokens: 1000, dormantReplies: 15, dormantDays: 30, dueSoonDays: 3,
  mirrorOffscreen: true,
  calendar: { preset: 'custom', era: '', months: [{ name, days }], daysPerMonth: 30 },
}
```

Inside SillyTavern's `inline-drawer` markup (header "Story Director"), a status element
`#story_director_status`, sections **Tracking** (on/off switch; scene block select from
`blocks` = `[{ tag, name }]`, free text when empty; depth; budget), **Dormant** (replies, story
days, due-soon days), **Calendar** (preset; era; months textarea of `Name` or `Name | days`
lines; days per month), **NPC State Delta** (mirror switch), and a **Seed from World State**
button calling `onSeed()`. `onChange(next)` on every edit with a full new object; never
mutates the input.

## `src/ui/quests.js` (v0.7.1)

```js
export function renderQuests(pane, { quests, finished, formatDate, status }) → void
// quests: active quest records; finished: resolved ones, most recent first;
// status(record) → 'overdue' | 'soon' | '' marks the deadline.
```

Groups by `fields.type` (main, side, bounty, contract, mission, favour, then others by name,
untyped last); plural spellings join their singular. Never hidden by the spoiler guard.

## `src/ui/tab.js`

```js
export function renderTab(pane, { timeText = '', place = '', selection, findings = [], formatDate = null, canSeed = false, onSeed = null, onPin = null }) → void
```

For Story Block's sidebar pane: **Now** (time, place); **Due now** and **Arriving**; active
records by kind (Off-screen, World, Hooks, Clocks, Beats), each with its key and labelled rows
(now/then/on/due/leg/arrive/desc, like Story Block's scene facts) and a pin toggle calling
`onPin(id, pinned)`; **Dormant** (folded `<details>` with a count); **Do not reveal** (folded,
content added only when opened); **Resolved recently** (folded); **Problems** (findings,
grouped by severity). Empty state: "Nothing tracked yet." plus a **Seed from World State**
button when `canSeed`.

## `index.js` (SillyTavern glue, written last)

Needs Story Block 0.6+ (`globalThis.StoryBlock.apiVersion >= 1`): registers the `<Director>`
transport block, reads the scene block, replays `<Director>` blocks from the chat, injects the
note at `depth` as a system message from its generate interceptor, checks each reply, writes
the Off-Screen mirror, registers the "Director" tab, and renders settings.
