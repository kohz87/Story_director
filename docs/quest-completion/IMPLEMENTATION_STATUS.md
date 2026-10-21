# Implementation status

Release candidates: Director 0.9.43, RPG Battle 0.5.48 and Story Block 0.9.26.
PRs, CI and merges are authorized; Delta is unchanged. No paid model calls or data migrations.

## Cleanup

Director now validates receipts in its existing replay cache; the separate metadata
index/cache and its invalidation paths are removed. Pre-generation and pre-save checks
share one validator. Acceptance context is saved only on relevant changes/Take on, not
every subsequent reply. Block writes share one body validator and validate a detached
candidate before mutation. Delivery updates duplicate rows in one pass. Behavior and
failure/replay tests are retained; brief, contracts and API docs avoid repetition.

## Verification

After cleanup: 1,418 tests passed (Director 438, RPG 501, Block 479), none skipped,
plus 13 real Chromium/SillyTavern scenario checks. No browser or HTTP errors.
Run `bash /workspace/live-sillytavern/internal-ci.sh --browser` with the host running.
Logs/reports/screenshots: `/workspace/live-sillytavern/artifacts/`.
The browser uses production combat and persistence with synthetic story replies; external
and model routes are blocked. Delta is loaded but disabled to avoid branch-repair scans.
Its two Block compatibility tests run; its unchanged full suite is not rerun.

## Limits

Use the three updated extensions together. Old prose battles/acceptance history are not
backfilled. One supported target and coin reward only; see [CONTRACTS.md](CONTRACTS.md).
Managed quests retain their replay history instead of creating new compacted checkpoints.
Missing proof blocks settlement. Restore exact evidence or a trustworthy history boundary
for recovery; no automatic refund/rebuild of arbitrary edited suffixes. Uncertain saves
require reload/readback. Group-chat browser behavior, large-history performance, live model
quality and fresh-cloud restoration remain untested. The unrelated RPG enabled-setting
persistence finding is outside this feature.
