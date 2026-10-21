# Durable quest checkpoints

The shared journal lives in chat metadata, saved by SillyTavern in its existing JSONL.
Story Block owns persistence and branch identity; RPG Battle owns Party/XP calculation;
Director owns quest terms, replay state and settlement. No separate server plugin.

- Each retained assistant variant has a stable owner ID. Journal nodes record parent,
  logical position, source revision, block state and extension-owned evidence. Message
  indexes are display coordinates, never transaction identity. Chat copies remain isolated.
- Preserve past nodes and inactive variants. An active head selects one branch; sibling
  fights and future payouts never contribute. Hiding is inert. Removing an old prefix is
  archival: retain its proven ancestors. Truncating the tail selects its earlier state.
  Interior removal/edit with a retained dependent suffix requires explicit recovery.
- Snapshot full Inventory and Party state, including level, points and companion growth.
  Reuse their existing block readers/writers and carry forward unchanged kept state.
  Deduplicate stored block bodies. Quest replay checkpoints retain frozen contracts,
  claims and completed state independently of their original prose messages.
- Director seeds replay only from proven archived ancestors. RPG queries their structured
  battle records plus the live branch. Never backfill defeats or acceptance from prose.
- A quest turn-in prepares XP using RPG's existing rules, then commits Inventory, Party,
  Director closure, quest/XP receipts and journal together with saved-state readback.
  The existing auto-awarder must recognize that receipt rather than award XP again.
- Keep battle XP earned before hand-in. A rewind before hand-in removes only that
  settlement; an earlier rewind also removes the fights after that boundary. Restore
  recorded state rather than subtracting an XP number after a possible level-up.
- Failed or uncertain saves cannot advance the durable journal or publish success.
  Duplicate events and reloads must not add payments or XP. Partial concurrent edits
  must not be overwritten by rollback.
- Persist on relevant host writes; no polling or new model requests. Keep the event
  history needed for deep rollback; checkpoints accelerate reads rather than limiting
  the rollback horizon to a handful of snapshots.

Verify 300+ message gaps; hidden and archived prefixes; reload; both sides of hand-in
and battle rollback; exact old/new swipe restoration; duplicate rewards; full Party
level/points restoration; inventory/delivery changes; failed/lost/uncertain saves;
chat isolation; and rejected ambiguous interior edits. Use synthetic chat data only.

Archived state is authoritative for removed prose. Editing old text while retaining
its later effects is not automatic historical reconstruction. Chat metadata must be
preserved by archive/export operations; deleting that metadata deletes the journal.
