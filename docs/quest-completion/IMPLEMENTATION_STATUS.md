# Implementation status

Release candidates: Director 0.9.45, RPG Battle 0.5.49 and Story Block 0.9.27.
PRs, CI and merges are authorized; Delta is unchanged. No paid model calls or server plugin.

## Shared persistence

Block's native chat-metadata journal keeps stable reply/swipe ancestry, deduplicated
Inventory/Party state and structured evidence. Director checkpoints accepted terms and
closed quests, then seeds its existing replay from proven archived ancestors. RPG queries
the same branch's archived evidence and prepares quest XP through its existing growth rules.
Turn-in saves coins/delivery, Party XP, completion, receipts and checkpoint together with
backend readback. Stable XP receipts prevent duplicate awards when indexes/offer flags change.
Reply callbacks run sequentially; scheduled awards wait until those callbacks finish.

## Verification

1,431 tests passed (Director 442, RPG 503, Block 486), none skipped, plus 26 real
Chromium/SillyTavern scenario checks. No browser, console or HTTP errors.
Coverage includes 350-reply pure history; 320-reply browser history; hiding and prefix
archival; backend reload; exact full-Party rollback across quest level-up; earlier battle
XP retained before hand-in and removed before the fight; old/new narration variants;
duplicate payments/XP; delivery/possession; rejected/lost/uncertain saves; metadata readback;
chat isolation; missing bodies/anchors; and recovery after an interior evidence edit.
Run `bash /workspace/live-sillytavern/internal-ci.sh --browser`, then
`python3 /workspace/live-sillytavern/durable-ci.py` with the host running.
Logs/reports/screenshots: `/workspace/live-sillytavern/artifacts/`.
The browser uses production combat and persistence with synthetic story replies; external
and model routes are blocked. Delta is loaded but disabled to avoid branch-repair scans.
Its two Block compatibility tests run; its unchanged full suite is not rerun.

## Limits

Use the three updated extensions together. Old prose battles/acceptance history are not
backfilled. One supported target and coin reward only; see [CONTRACTS.md](CONTRACTS.md).
Preserve native chat metadata and at least one recognized retained reply when archiving.
Deleting the metadata deletes the journal; it is not an independent backup. Missing proof
blocks settlement. Restore exact evidence or rewind the dependent suffix for recovery;
no automatic refund/rebuild of arbitrary edited suffixes. Uncertain saves require reload
and readback. Group-chat browser behavior, very large histories beyond this coverage,
live model quality and fresh-cloud restoration remain untested. The unrelated RPG
enabled-setting persistence finding is outside this feature.
