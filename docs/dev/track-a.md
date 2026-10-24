# Track A handoff and gaps

The frozen RB_PHASE0 §3/P23 and §6 govern thread ownership and acceptance. The current
checkout cannot complete that runtime transfer without the host cursor/write/epoch and
B3/B5 handoffs recorded in the sibling RB docs/dev/track-a.md.

A2's first slice adds pure production helpers in tracker/thread-writes.js:

- threadProjection excludes only private track, retaining rpg/rev for canonical hashing.
- prepareThreadWrite checks the SD-owned writes ledger before stale/transition checks;
  identical write/fingerprint returns its saved result, changed meaning returns CONFLICT.
- threadWriteEntry produces the retry entry to commit with the thread, never before it.
- neutralAcceptance consumes active story.evidence results and verifies selected player
  action or the retained reader-intent matcher, with explicit refusals taking precedence.
  It reads no party, rules or quest API and does not invent an acceptance cursor.

These helpers are not registered writers. The five P23 commands, director.writes initializer
and validator, host proof/cursor stamping, neutral capture/closure and C15 integration remain.
There is no new journal or second quest ledger.

The following old paths are still active and MUST be retired together with functional RB
replacement registration. This slice does not claim that any of them pays nothing yet:

- src/v2/module.js registers the quests part.
- quests/index.js registers quest.take/abandon/finish/payOwed and afterCapture payOwedHook.
- tracker/index.js registers quest.settle and beforeGenerate/afterCapture payout hooks.
- tracker/capture.js parses quest met/target/reward and calls takeOn/quest.take.
- tracker/quest-lines.js calls quest.finish and quest.payOwed.
- quests/index.js calls wallet.receive and party.grantXp during settlement.

The remaining A2 work cannot be described as complete by testing these pure helpers. Runtime
retirement and a real SB+SD neutral offer/reader-accept/progress/close trace still need tests.

Focused verification: six tests pass; reverting only refusal precedence fails the refusal
assertion. No baseline suite was run. Full check/suite results are recorded in the task report.
