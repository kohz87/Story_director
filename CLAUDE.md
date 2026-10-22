# Story Director: notes for coding agents

Story Director 2 is a **module** of Story Suite v2 (module id `story-director`). Story Block (kohz87/Story_block,
the host) keeps the state, reads the replies' `<Changes>` lines, builds the prompt and hosts tabs and
settings; this repo registers one module definition through Story Block's sdk: the story clock and
calendar, threads (agendas, events, hooks, quests, clocks, beats, secrets), quests and rewards, deadlines
and the While away recap, the map and travel (atlas), the chronicle and day digest, the World screen
(what the player character knows), arc planning, and the Director / Quests / World screens. The other
modules are RPG Battle (kohz87/rpg_battle) and NPC State Delta (kohz87/npc_state_delta).

Story Director must work **without RPG Battle** (a dating sim or mystery: no fights, stats or levels)
and without NSD: read other modules only through guarded queries with a fallback (`tryQuery` in
`src/v2/world/known.js`; no level → lowest rank, no fights → asks for no encounters) and test every
change with each other module absent. Work is on the `v2` branch (`main` is v1).

## Directory map

- `index.js`: SillyTavern entry; registers `src/v2/module.js` once `StoryBlock.ready` resolves. `index.v1.js` is v1.
- `src/v2/module.js`: merges the parts (tracker, quests, time, atlas, chronicle, world, arc, screens); settings
  namespaced per part; `fights` (whether a module runs fights) told to every part.
- `src/v2/tracker/`: the `director` domain, its change-line kinds and grammar, the clock (`time.js`), calendar
  settings, the note (static + tail, `note.js`), seed.
- `src/v2/quests/`: taking, progress, goals, finishing, rewards and ranks.
- `src/v2/time/`: settle (lapses, overdue, due now), advance, recap, records.
- `src/v2/atlas/`: places, routes, map widget, travel. `src/v2/chronicle/`: world events, factions, day digest.
- `src/v2/world/`: the World screen (Now / Journal), PC-known views, people widget; nothing stored.
- `src/v2/arc/`: arc planning through `sdk.callModel`, review, Reveal/Hide (feature `story-director.arc`).
- `src/v2/screens/`: Director, Quests, Reveal, Behind, HUD, status card.
- `src/*.js`: v1's pure rules reused by v2 (`tracker.js`, `lapses.js`, `calendar.js`, `places.js`, `routes.js`, ...).
- `tests/*.test.js`: v1 rule tests. `tests/v2/<part>/`: per-part tests; `tests/v2/integration/` (incl.
  `alone.test.js`), `tests/v2/break/` (one file per break finding, `fuzz-delete*.test.js`).
- `tests/vendor/story-block/`: Story Block's testkit + runtime, vendored (VERSION names the commit).
  `tests/v2/screens/vendor/` is an older pinned copy of Story Block's screens registry (or `STORY_BLOCK_DIR`).
- `docs/`: `ARCHITECTURE.md`, `DESIGN.md`, `STORY_SUITE.md`; `docs/dev/`: short area notes.

## Commands

Node 24 in CI (node ≥ 22 works locally). No dependencies.

```sh
npm test                                         # what CI runs (with npm run check and git diff --check)
npm run test:dot                                 # same files, one dot per test, failures listed at the end
npm run check                                    # syntax check of index.js and src/
node --test --test-reporter=dot tests/v2/tracker/time.test.js   # one file
node ../Story_block/scripts/sync-testkit.mjs --to .             # re-vendor the testkit (no npm script here)
git diff --check origin/v2                       # CI fails on trailing whitespace in what the PR adds
```

Full suite: about 980 tests, about 1–2 minutes. Skills: `.claude/skills/run-tests`, `sync-testkit`.

## Non-negotiables (every PR keeps them)

1. **Code sets numbers; the story proposes.** Rewards priced and capped by code (story-written rewards held to
   the per-reply story budget, at most one story-vouched turn-in per reply); the clock moves at most
   `tracker.maxJump` days (30) per reply; invalid times refused.
2. **Per-reply bookkeeping** keyed by carrier `sid` / id (`turn.now` written whole as a slot, problems under
   their own `<rev>.<n>` key, pruned by key); never positional appends or a `replace` of another reply's
   fields (Story Block SPEC §2.2).
3. **Replay == live** after swipes, middle deletes, rewinds, reloads. `tests/v2/break/fuzz-delete.test.js` and
   `fuzz-delete-days.test.js` must pass; add new kinds and commands to their generator. A set of the clock
   (`~ time <date>`) uses `ctx.absolute`; writes inside a thread that may be gone use `ctx.ifThere`.
4. **Static prompt byte-identical** reply to reply (the grammar may depend on the module set, never on state).
   New static lines only via a Feature or a setting; tail within `TAIL_BUDGET` (500).
5. **Every optional mechanic is a Feature (F100):** `story-director.arc`, `.world`, `.map`, `.digest`,
   `.reveal`, `.behind`, `.people`; tag kinds, commands, queries, screens; check `ctx.feature(id)`.
6. **Story-driven:** no buttons for story actions; the reader's tools (Reveal, Plan arc, Finish) are fine.
7. **No markup from text:** templates and widgets only; names flattened; cut by code points.
8. **Tests for every rule,** run once after the fix. `npm test` + `npm run check` green; README/CHANGELOG updated.
9. **Deterministic:** no `Math.random`, no `Date.now()` in state or ordering.

## Conventions

- No model names anywhere in the repo. Commit trailers and PR attribution: the lines the session gives.
- Branch off `v2`, PR into `v2`; agents never merge their own PR. Rebase on `origin/v2` before pushing.
- Re-sync the Story Block testkit before the final push of a PR that needs host changes; name the commit.
- Parts never import each other; they talk through commands and queries (`ctx.call`, `ctx.query`).
- World / Journal views are derived on read: never store what can be worked out (so replay cannot drift).
- Kill processes by PID, never with a broad `pkill -f`.

## Specs

- Story Block `docs/v2/SPEC.md`: §2.2 storage and replay rules a–d (`ctx.absolute`, `ctx.ifThere`), §3 commands,
  §4.4 change lines (the Director's v1 grammar kept under `<Changes>`), §5 prompt, §6 modules / Features, §10, §13.
- Story Block `docs/v2/MODULES.md`: **§C Story Director** (C1 `director` …), **§F decisions** (override older
  text: F21 While away, F83 met goals, F88 held offers, F100 features, ...), §G `sdk.callModel` (arc).
- This repo: `docs/ARCHITECTURE.md`, `docs/DESIGN.md`, README ("The change lines", "Arc planning", ...), CHANGELOG.
- History and decisions: `suite-notes/` in kohz87/inventory-block, branch `claude/hopeful-babbage-tipaw8`
  (README.md, WAVE_BRIEF.md, V2_LOG.md newest at the end). Area notes: `docs/dev/tracker-and-time.md`,
  `docs/dev/world.md`.

## Known traps

- Cross-repo tests need sibling checkouts named exactly `Story_block`, `rpg_battle`, `Story_director`,
  `npc_state_delta` side by side (e.g. `tests/v2/break/rx-*` look for `../rpg_battle`, or `RPG_BATTLE_DIR`;
  `STORY_BLOCK_DIR` points the screens and map tests at a Story Block checkout). Without them they skip,
  and CI has only this repo. Run Story Block's `suite-check` skill for the full picture.
- There is no `sync-testkit` npm script here: call Story Block's script with `--to .`.
- Tests run against the **vendored** testkit, not Story Block's head; a host change can turn tests red on
  the next re-sync. Never edit the vendored files.
- A Continue is the same reply (by `sid`): `maxJump`, `turn.n` and tallies must hold across it.
- `tests/v2/integration/alone.test.js` is the Story-Director-without-RPG-Battle guard; keep it green.
