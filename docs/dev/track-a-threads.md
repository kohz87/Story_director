# Thread ownership and quest retirement

Story Director owns `director.threads`, `director.keys` and `director.writes`.
The five P23 writers and `threads.hash` are registered. Writer retries return their
saved result before stale checks; changed meaning conflicts. Quest extensions require
the host-authenticated RPG Battle caller. Neutral acceptance records a surviving
`story.evidence` proof and its Source, cursor and story minute.

`threads.accept` supports the reader's selected UI action. Validated capture also
accepts an existing offered hook from a complete sentence of the reader's message.
A refusal of the job cannot accept it; “I'll help, no problem” can. Generic accepted
hooks retain their kind, progress, closure, journal entry and World deadline view.
They need no party, quest or rules query. The journal remains independent of RPG rewards.

SD no longer registers quest commands, quest capture, the quest board or the old
settlement/payout hooks. Its quest mechanics and parser files have been removed.
The Quests view reads `director.threads` directly and retains old quests and owed text
as history. Legacy quests have no new acceptance stamp and cannot enter the writers.
Their old owed rewards are never paid.

The retired automatic-payout test suites were replaced by registered-writer,
neutral standalone and retirement fixtures. Pure parser and reader-rank fixtures
move with their implementation to RB. Tests for generic capture, time, map, arc,
World, journal, swipes, deletion and storage limits remain in SD with neutral fixtures.
The narrowed refusal fix was removed alone: its runtime fixture failed, then passed
again with the fix restored.

Integration gates:

- D1: the host supplies `ctx.cursor()` and `ctx.epoch`. Tests use a small explicit shim;
  production refuses acceptance when those facilities are absent.
- The current host invokes afterCapture only after a kept change line and gives its
  system steps no reader capture context. Acceptance therefore runs on the validated
  player-intent capture context, or the reader's UI action. An empty narration does
  not synthesize consent. Extending capture to replies without lines requires host work.
- RPG requirements, proof schemas and settlement guards remain their RB owners' work.
