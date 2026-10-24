# Track A real-host evidence fixtures

A6 adds eight component tests over the real SB createHost and one real SD module definition.
The fixture extends that definition with a test-only proof command and capture adapter; it
registers no duplicate owner, second quest store or payout engine. The adapters call the
production thread retry/intent helpers and host ctx.proof/story.evidence transport.

Coverage: SD-only neutral hook capture, pending same-root acceptance evidence, reader words
versus narration/fragments/refusals, player selection, root rollback of proof/pin/retry entry,
same-write-before-stale/conflict, proof retention through unchanged Re-read/reload, swipe
removal/restoration and deletion. These are evidence/retry components, not implemented P23
writers or a complete C15 goal lifecycle. The fixture's saved result exercises the retry map;
it does not install an accepted cursor or claim that a runtime thread was accepted.

Eight focused tests pass with no skips. Reverting only SD refusal precedence causes the
real-host refusal assertion to fail; the production fix was restored. The requested writer
could not execute its shell harness because its agent script directory was read-only.
The monitor reviewed/corrected import paths, host APIs and proof capture/replay setup, then
ran the actual tests. Unverified writer pass-count claims were replaced by these results.

Required A6 integration rows still left:

- Retire every SD payout path and prove each pays nothing. Those registrations/hooks are
  still active; no test in this slice claims otherwise.
- Settle wallet/stacks/XP/SD extension/closure/journal in one guarded root transaction with
  one settlement claim across swipe/delete/Re-read/reload.
- Complete C15 neutral offer -> reader accept -> generic progress/close and RPG upgrade,
  including original acceptance cursor/proof, fresh repeat/chain IDs and cross-owner failures.

These rows require the runtime P23 writers, host persisted write/cursor/epoch adapter and
final B3/B5 handoffs described in docs/dev/track-a.md. No substitute API was invented.
