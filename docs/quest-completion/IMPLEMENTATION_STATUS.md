# Implementation status

Release candidates: Director 0.9.46, RPG Battle 0.5.49 and Story Block 0.9.28.
PRs, CI and merges are authorized; Delta is unchanged. No paid model calls or server plugin.

## Shared persistence

Block's native chat-metadata journal keeps stable reply/swipe ancestry, deduplicated
Inventory/Party state and structured evidence. Director checkpoints accepted terms and
closed quests, then seeds its existing replay from proven archived ancestors. RPG queries
the same branch's archived evidence and prepares quest XP through its existing growth rules.
Turn-in saves coins/delivery, Party XP, completion, receipts and checkpoint together with
backend readback. Stable XP receipts prevent duplicate awards when indexes/offer flags change.
Reply callbacks run sequentially; scheduled awards wait until those callbacks finish.
Plain-HTTP hosts use compatible ID allocation when `crypto.randomUUID` is unavailable.
Existing message/journal IDs are preserved; no data reset or HTTPS migration is required.

## Verification

1,436 tests passed (Director 444, RPG 503, Block 489), none skipped, plus 43 real
Chromium/SillyTavern scenario checks: 16 loopback and 27 on a non-secure HTTP origin
where native `randomUUID` is absent. Existing native-ID quests, Quests/Director tabs,
new turn-ins, reload and long-history rollback pass. No application, page or HTTP errors;
Chromium's expected ignored-COOP-header warning on HTTP is recorded separately.
Coverage includes 350-reply pure history; 320-reply browser history; hiding and prefix
archival; backend reload; exact full-Party rollback across quest level-up; earlier battle
XP retained before hand-in and removed before the fight; old/new narration variants;
duplicate payments/XP; delivery/possession; rejected/lost/uncertain saves; metadata readback;
chat isolation; missing bodies/anchors; and recovery after an interior evidence edit.
Run `bash /workspace/live-sillytavern/internal-ci.sh --browser`, then
`python3 /workspace/live-sillytavern/durable-ci.py` with the host running.
HTTP regression: run `http-quest-ci.py` and `http-durable-ci.py` from that directory,
sequentially, against the isolated fixture. They use a local test hostname mapped to
loopback, with the browser's normal insecure-context restrictions intact.
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
