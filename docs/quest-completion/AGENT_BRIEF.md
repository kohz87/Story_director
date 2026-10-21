# Verified quest completion

Publish through pull requests and merge after CI passes; no paid model calls.
Keep Complete / Undo complete and Pending labels. Preserve narrative-only quests.

Current work: a shared per-chat metadata journal for durable quest evidence and
Inventory/Party checkpoints. Coordinate quest coins, delivery, XP and receipts in one
verified save. Preserve archived prefixes and explicit branch rollback; reject ambiguous
interior edits. See [PERSISTENCE.md](PERSISTENCE.md). No separate backend or paid calls.

## Ownership

- Director: accepted terms, eligibility, user intent, receipts and story instructions.
- RPG Battle: structured defeat evidence, existing Inventory/currency helpers and quest XP.
- Story Block: message/swipe identity and verified coordinated persistence.
- NPC State Delta: optional giver presence; no source changes.

Use [CONTRACTS.md](CONTRACTS.md) as the behavior contract. Reuse existing replay,
Inventory, combat and Suite APIs; avoid additional stores, caches or model requests.
Keep fixes limited to this feature and preserve unrelated work and real user data.
No compound/repeatable quests, strict kills, fuzzy matching or historical backfill.

## Verification

Run each changed repository's `npm run check`, `npm test` and `git diff --check`.
Story Block tests need `NPC_STATE_DELTA_PATH=/workspace/npc_state_delta`.
`bash /workspace/live-sillytavern/internal-ci.sh --browser` runs the full checks and
real local SillyTavern scenarios; the host must already be running. Use synthetic chats.
Preserve failure, duplicate payment, changed resources, swipe/delete and recovery coverage.
Record results and limitations in [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).
