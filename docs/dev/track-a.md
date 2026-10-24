# Track A handoff

SD owns director.threads/keys/writes, threads.hash and the five P23 writers. Retry precedes
stale checks; acceptance+rpg and terminal closure/journal are atomic. Neutral reader acceptance,
progress and closure work with SB alone, using story.evidence and no RPG lookup.

Quest mechanics/capture/board ownership and payouts moved to RB. Old ready/owed records are
readable history and never paid. Refusals, uncertainty and positive waiting/hesitation idioms
are covered by acceptance tests. The dead questBoard export and payout comments are removed.

E1 replayQueries declares only director.thread. Both testkits use SB
78fd75e11b7bd3aa96d51ccf11a993bf102bd0d9. The optional forged-quest integration fixture skips
when the sibling RB checkout is absent. Full single-repo checks pass without sibling repos.

Contract addition: threads.intent({thread}) is the SD-owned typed-intent bridge; its authority,
result and refusal behavior are documented in track-a-threads.md for lead review.
Host cursor()/epoch remain an explicit D1 fixture shim. B3/E6 and shared matrix integration
remain with their owners. No NSD or SB working-tree source was edited.

Final checks: 885 tests, 884 passed, zero failures, one skipped. A single-repo copy without
siblings or .git passes: 882 passed, three skipped. Syntax and
git diff --check origin/main HEAD pass. Focused regression checks fail when only the replay
declaration, negation fix or optional sibling import is reverted; all fixes restored.

Lead-owned commits: 2644394 (replay declaration); earlier branch commits 6c812f3 and e3745a6.
Authorized screen changes only remove questBoard from screens/index.js and its dead
implementation in screens/queries.js. Resume file lists are in track-a-files.md.
