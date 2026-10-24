---
name: run-tests
description: Run Story Director's tests with compact output (dot reporter), one file while working, and read the failures. Use before pushing and whenever a change touches src/ or tests/.
---

# Run Story Director's tests

Node 24 is what CI uses (node ≥ 22 works). No install step.

1. While working, run only the files that cover the change (`docs/dev/*.md` lists them):
   ```sh
   node --test --test-reporter=dot tests/v2/tracker/time.test.js tests/v2/world/world.test.js
   node --test --test-name-pattern="maxJump" tests/v2/break/a1-time-jump-continue.test.js   # by name
   ```
2. Once, after the fix, the whole suite (same files as `npm test`, about 980 tests, 1–2 minutes):
   ```sh
   npm run test:dot
   npm run check
   git diff --check origin/main
   ```
   Run it once; do not re-run old code to show a test failed before.
3. Reading the output:
   - one `.` per passing or skipped test, `X` per failure; no totals. The exit code is the verdict (0 green).
   - after the dots, `Failed tests:` lists each failure: name, assertion message, and a stack whose first
     `file:///…` line is the test file and line.
   - a line starting `⚠` is a failing `test.todo` (a known open problem); it prints `X` but does not fail the run.
   - for totals and skips run a file with the default reporter: `node --test tests/v2/tracker/time.test.js`.
4. Tests that need RPG Battle or Story Block checked out beside this repo (`../rpg_battle`,
   `RPG_BATTLE_DIR`, `STORY_BLOCK_DIR`) skip without them, in CI too. Run them locally with the four repos
   side by side (Story Block's `suite-check` skill).
5. Always keep `tests/v2/integration/alone.test.js` green: Story Director without RPG Battle.
6. Tests run against the vendored Story Block in `tests/vendor/story-block/` (VERSION names the commit). A
   failure that comes from the host side needs the `sync-testkit` skill, not a local workaround.
