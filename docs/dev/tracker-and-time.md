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
- **Per-reply bookkeeping:** `turn.now` is a slot written whole (one entry keyed by the reply `sid`):
  quests added, the one lone quest, threads added, at most one story-vouched turn-in, story reward paid,
  and the story turn-ins waiting for where the reply ends up (`pending`). Later replies never write inside
  what an earlier reply wrote.
- **Turn-ins are checked where the reply ends up:** lines run in reply order, and the story often writes
  `- quest … — turned in` before the `~ place` / `+ present` lines. A turn-in the place rule alone refuses
  waits (`turn.now.pending`, `quest-lines.js storyTurnIn`); a later Director line of the same reply pays it
  once the place holds (`settleTurnIns`, merged into that line's receipt as `settled`), and Story Block's
  `afterCapture` step right after the reply's last line (`quest.settle`, cause `system`, kept on that reply)
  pays or refuses it on the final scene, in that reply. The beforeGenerate `quest.settle` (`replan`) is the
  fallback for an older Story Block without `afterCapture`; with it, nothing is left waiting for it.
  A place-only refusal at the end of a reply stays retriable in `turn.now.refused` for that reply's
  Continue (`quest.settle { id, retry: true }`, `director.retriable`); paying it takes the refusal's Problem back.
- **Safeguard:** the afterCapture step also turns a ready quest in from where things stand when the reply shows
  it was (`turn.now.intent` from `~`/`!` quest lines in `TURN_IN_WORDS`, the story's coin equal to the reward, the
  reward item given; `quest.autoTurnIns`, `quest.settle { id, auto: true }`), and takes back a `+ coin` that
  repeats a reward already paid (`quest.repeatedCoin`, `{ repeated: true }`). The story's own coin this reply is
  counted as a turn-in's reward (claim `storycoin:<sid>`). A delivery goal ("bring / deliver / take / return
  … to …", `deliveredThing`) the story said was met in this reply (`turn.now.met`, from `met: yes` that set
  `ready`) is handed in the same way when the thing delivered is held, given this reply, or said brought or
  delivered in the progress note. `quests.wordTurnIns` (1–5) is the story's-word
  turn-ins per reply (`turn.now.words` past 1).
- **Quests:** a job accepted is `taken`; goals counted by code where it can (foes beaten from RPG Battle's
  `combat.foesBeaten` when present), `met:` when the story says a goal code cannot count is met; rewards priced
  by code (coin forms through Story Block's currency), story-written pay within the per-reply story budget.
  Ranks follow RPG Battle's ladder when present, else the lowest rank.
- **Time settle** (`time/settle.js`): beats slip after two story days, unaccepted offers lapse, accepted quests
  go overdue then fail after the same grace; each closing is claimed (`lapse:<thread id>`) and its writes are
  `ctx.ifThere` the thread, so deleting the reply that made the thread passes over the closing on replay.
- **Weather by rule** (`time/weather.js`, feature `story-director.weather`, Story Block MODULES §F122): the
  time part's afterCapture asks for Story Block's `scene.weather { text, key }` when the key (`day <n>|<region>`)
  differs from the scene weather's; the season from `director.calendar` (a pack's `weather.seasons` first), the
  table from `packs.weather` else `TEMPERATE`, the pick `hashOf(key) % length`. A story `~ weather` (no key) is
  only marked with the day's key (`scene.weather { key }`), so it stands for the rest of that day and place.
- **Reward coins:** without Coins, a reward in a coin word that is not the chat's own is amount null with a
  `problem` (`parse.js foreignWord`), never that many of the chat's money; a second amount after the first too.
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
  (`staticText`, `directorTail`, `GRAMMAR`, `TAIL_BUDGET`), `quest-lines.js`, `calendar-settings.js`, `seed.js`.
- `src/v2/quests/` (`parse.js`, `progress.js`, `ranks.js`), `src/v2/time/` (`settle.js`, `advance.js`, `recap.js`).
- v1 rules: `src/tracker.js`, `src/lapses.js`, `src/calendar.js`, `src/quest-completion.js`.

## Tests that guard it

- `tests/v2/tracker/scene-tail.test.js`, `initiative.test.js`, `tests/v2/integration/initiative.test.js`.
- `tests/v2/tracker/`, `tests/v2/quests/`, `tests/v2/time/`, `tests/v2/integration/` (`alone.test.js`:
  without RPG Battle).
- Break findings: `tests/v2/break/a1-time-jump-continue`, `c1-time-after-middle-delete`, `c2-time-jump-per-reply`,
  `b4-kill-quest-overpay`, `r2-b3-quest-story-pay`, `rx-econ-*`, `fixcand-continue-reward`, `sd-r2fix*`, `quests-direct`.
- Fuzz: `tests/v2/break/fuzz-delete.test.js`, `fuzz-delete-days.test.js` (add new kinds to the generator).

## When you change it

- A new kind or label: grammar line (static, module-set only), validator, refusal tests, fuzz generator,
  README "The change lines" and CHANGELOG.
- Run with RPG Battle absent too (`integration/alone.test.js` style).
