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
  kind: 'agenda' | 'event' | 'hook' | 'clock' | 'beat' | 'secret',
  status: 'active' | 'resolved' | 'superseded',
  fields: { desc, now, then, on, due, shown, leg, arrive, place, people },  // strings, '' when unset
  extra: { [label]: value },            // labelled parts that are not a known field
  created: { message, time },           // message index; story abs or null
  changed: { message, time },
  seen:    { message, time },           // last change or mention
  resolved: { message, time, reason } | null,
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
export const KINDS = ['agenda', 'event', 'hook', 'clock', 'beat', 'secret'];
export const KIND_ALIASES;    // offscreen/off-screen/npc → agenda, world → event,
                              // thread/hooks → hook, timer/clocks → clock, plan → beat, off-limits → secret
export const FIELDS = ['desc', 'now', 'then', 'on', 'due', 'shown', 'leg', 'arrive', 'place', 'people'];
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
