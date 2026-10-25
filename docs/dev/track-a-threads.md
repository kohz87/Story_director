# Thread ownership and quest retirement

Story Director owns director.threads, director.keys and director.writes. All five P23 writers
and threads.hash are registered. Hashing includes every public field, including acceptance,
rpg and rev, excluding only private track. Retry results precede stale checks; reuse with
changed meaning is CONFLICT. Quest fields require the authenticated ready RB caller.

threads.accept supports the reader's selected UI action and validated complete reader
sentences. Its surviving story.evidence proof supplies Source/cursor/minute/proof. Refusal
of the job rejects; “I'll help, no problem” accepts. Generic accepted hooks keep their kind,
progress, closure and journal without party, quest or rules dependencies.

RB quest.take delegates to atomic accept or links an already accepted neutral thread while
retaining its original acceptance. Neutral annotations preserve an existing RPG extension;
terminal RPG transitions route through RB capture and its guarded settlement. Every failure
rolls back thread, proof, retry entry and nested owner changes together.

SD no longer registers quest capture/commands, the quest board, settlement or payout hooks.
The quest-only mechanics/parser files are removed. Quests reads director.threads directly,
showing legacy quests and owed text as history. Their old rewards are never paid.

The sole host seams for acceptance are cursor()/epoch, supplied explicitly by D1 tests until
host integration. Reader intent runs in validated capture context or UI, never from empty
narration or an afterCapture system context without reader words. Latest validation, file
inventory and integration gates are in track-a.md and track-a-files.md.

Contract addition: `threads.intent({thread:RecordId})` is SD's internal neutral acceptance
adapter, called only by SD/RB with story/system cause and the host-provided reader message.
It matches a complete accepting sentence, publishes acceptance proof, then calls neutral
threads.accept or RB quest.take. It returns `{thread}`; absent offer or reader acceptance
is REFUSED. This command is additional to the frozen P23 writer table for lead review.

Objective evidence (B3): `threads.questWrite` keeps `rpg.evidence` append-only. A new row needs an active proof (`story.evidence`, a pending
proof of the same root counts) whose payload names this thread, this instance and the row's objective; a proof counts once across every thread
(`CLAIMED`); a stored row is never changed or removed (`REFUSED`; taking its block back is how it goes); no row rides with a terminal write; a quest
is offered, accepted and linked with empty evidence. What the proof means for the objective stays RPG Battle's. The checks refuse the whole root.
