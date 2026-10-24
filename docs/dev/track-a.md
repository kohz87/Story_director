# Track A handoff

SD owns director.threads/keys/writes, the canonical threads.hash projection and all five
P23 writers: offer, accept, link, questWrite and close. Same-write retries return their saved
result before stale checks; changed meaning conflicts. Acceptance+rpg is atomic. Close
requires the matching terminal extension, Source and root claim and appends one journal entry.

Neutral reader UI acceptance and validated complete reader sentences use story.evidence.
Refusal of the offer rejects; “Yes, I'll help, no problem” accepts. Standalone accepted hooks
retain generic progress, closure and journal without party/quest/rules lookups. Neutral
annotations on an RPG thread preserve its extension; terminal transitions use RB capture.
SD's typed-intent bridge accepts RB's nested request but still proves the reader's own words.

SD quest mechanics/parser files and registrations, quest.settle, payOwedHook and all old
beforeGenerate/afterCapture RPG payouts are removed. RB owns the retained quest APIs, capture,
board and retriable adapter. Old quest/owed records remain readable in Quests and the journal;
they are never converted, settled or paid. No names have two registered owners.

D1 host cursor()/epoch are still integration prerequisites; tests supply exactly those names.
Writer IDs derive from the caller's Source and writer key and live in director.writes.
The host currently gives reader capture context only to validated capture, not empty-reply
system hooks. Acceptance therefore uses actual capture context or the reader UI action;
empty narration never creates consent. B3 quest semantics and E6 epoch enforcement remain
their owners' integration work; see the sibling RB track-a.md.

Latest validation: 880 tests; 879 passed, zero failures, one skipped; syntax and
`git diff --check origin/main HEAD` pass. No baseline suite was run. The runtime/testkit pin
is SB d23ab1fd04e80b06d443cb79e3174c6ffc443c8e. RB's related suite has 1,758 tests,
zero failures, one skipped and six TODOs. Real-host forgery fixtures cover UI, SD capture
and third-module extensions with real RB ready and with RB absent.

Lead-owned commits: 6c812f3 (thread writers and quest retirement), e3745a6 (board ownership).
The file inventory is in track-a-files.md; thread and fixture details are in the adjacent notes.
