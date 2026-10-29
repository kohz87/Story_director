# Tracker and time

The `director` domain: threads written by the story's change lines, and the story clock. Detail: Story
Block MODULES.md §C1 (the domain), §C2 (quests), §F (F21 While away, F83 met goals, F88 held offers, the
maxJump and Continue decisions); SPEC §2.2 (counters, `ctx.absolute`, `ctx.ifThere`, rules a–d), §4.4;
this repo's README "The change lines", "The note".

## Rules

- Kinds: `agenda`, `event`, `hook`, `quest`, `clock`, `beat`, `secret` (v1's grammar under `<Changes>`,
  `—` reasons, `| label: value`), plus `time`. A kind's grammar may depend on the module set (no fights
  without a fight module), never on the state, so the static part stays byte-identical.
- One reply adds at most `NEW_THREADS_PER_REPLY` (16) threads; at most `MAX_OPEN_THREADS` (300) open.
  Problems are kept under `<rev>.<n>` keys, the newest `PROBLEM_ROOM` (100) kept, `PROBLEM_LIMIT` (50) shown.
- **Clock** (`director.time.minutes`, a counter): `~ time +2h` style moves keep `was`; `~ time <date>` is an
  absolute set (`ctx.absolute`). One reply moves the clock at most `maxJump` days (setting, default
  `MAX_JUMP_DAYS` 30), counted from the clock when the reply's first Director line was read; a Continue is the
  same reply (same `sid`), so the limit holds across it. Invalid times are refused as Problems.
- Calendar: the reader's, else the enabled pack's (`packs.calendar`), else Gregorian; read-only while "pack".
- **Per-reply bookkeeping:** `turn.now` is a slot written whole for each reply. Later replies do not write inside an earlier reply's slot.
- **Quests:** the story records quests as threads and tells their goals and rewards. Earlier quest extensions are read-only.
- **Time settle** (`time/settle.js`): beats slip after two story days, unaccepted offers lapse, accepted quests
  go overdue then fail after the same grace; each closing is claimed (`lapse:<thread id>`) and its writes are
  `ctx.ifThere` the thread, so deleting the reply that made the thread passes over the closing on replay.
- **Weather by rule** (`time/weather.js`, feature `story-director.weather`, Story Block MODULES §F122): the
  time part's afterCapture asks for Story Block's `scene.weather { text, key }` when the key (`day <n>|<region>`)
  differs from the scene weather's; the season from `director.calendar` (a pack's `weather.seasons` first), the
  table from `packs.weather` else `TEMPERATE`, the pick `hashOf(key) % length`. A story `~ weather` (no key) is
  only marked with the day's key (`scene.weather { key }`), so it stands for the rest of that day and place.
- While away recap (F21) after a big time jump; due-now items enter the tail where the scene allows.
- **Scene filter** (`tracker/scene.js`, used by `note.js directorTail`): the kind lines keep what fits the scene
  (place or region, people present by Story Block's and NSD's lists and NSD names/aliases, due within
  `dueSoonDays`, beats whose `after:` is over or whose `reach:` names the scene, ready quests, shown clocks,
  what the reader names); the rest only as one *Elsewhere* line of at most `tracker.elsewhere` (2) names of
  PC-known threads (quest, hook, event, never `track.arc`), added only while the budget has room. No scene
  known: everything, as before. Derived, nothing stored.
- **NPC initiative** (`tracker/initiative.js`, feature `story-director.initiative`): beforeGenerate commits
  `director.initiative { at }` (cause `system`) when someone present or nearby has an open thread naming them,
  or someone still cools down; the step draws with `ctx.rng()` (weights: urgency 4/3/2 × NSD trust 25–200 %,
  else 100 %), cooldown `tracker.initiativeCooldown` (≥ 2), and writes the slot `director.initiative` whole
  (`{ at, round, key, name, recent }`). The tail shows the pick while it is this reply's (`at`, as the
  chronicle's world pick), else picks from a hash of the head's rev (a host with no hooks). Its static line is
  a `context.parts` entry under the feature.

## Key files and functions

- `src/v2/tracker/scene.js` (`sceneOf`, `splitByScene`, `knownToUser`, `elsewhereCap`), `initiative.js`
  (`initiativeCandidates`, `nextPick`, `weightedPick`, `initiativeCommand`, `initiativeHook`, `initiativeTail`).
- `src/v2/tracker/index.js` (part, kinds), `capture.js` (`applyThreadLine`, `applyTimeLine`,
  `NEW_THREADS_PER_REPLY`, `MAX_OPEN_THREADS`), `domain.js` (`initialDirector`, `validateDirector`, queries,
  `PROBLEM_LIMIT`), `time.js` (`timeAfter`, `maxJumpMinutes`, `calendarOf`, `MAX_JUMP_DAYS`), `note.js`
  (`staticText`, `directorTail`, `GRAMMAR`, `TAIL_BUDGET`), `calendar-settings.js`, `seed.js`.
- `src/v2/time/` (`settle.js`, `advance.js`, `recap.js`).
- v1 rules: `src/tracker.js`, `src/lapses.js`, `src/calendar.js`.

## Tests that guard it

- `tests/v2/tracker/scene-tail.test.js`, `initiative.test.js`, `tests/v2/integration/initiative.test.js`.
- `tests/v2/tracker/`, `tests/v2/time/`, `tests/v2/integration/` (`alone.test.js`:
  standalone).
- Break findings in `tests/v2/break/` include time jumps, Continue, and deleting earlier replies.
- Fuzz: `tests/v2/break/fuzz-delete.test.js`, `fuzz-delete-days.test.js` (add new kinds to the generator).

## When you change it

- A new kind or label: grammar line (static, module-set only), validator, refusal tests, fuzz generator,
  README "The change lines" and CHANGELOG.
- Keep the standalone integration test green (`integration/alone.test.js`).
