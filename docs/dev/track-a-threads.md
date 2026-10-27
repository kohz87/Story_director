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

## Attaching a module to a thread

A thread is the story's neutral goal: its identity, name, text, giver, place, state and deadline
belong to Story Director. A game module adds its own extension to that same thread; it does
not create a second goal identity or take ownership of the thread. An attachment starts with
an explicit reader choice or an explicit binding in a narrator offer. Names that happen to
resemble a template are not a binding.

RPG Battle is the example. `+ quest Name | like: <open template slug> | text: <objective text>`
(and explicit `foe`, `place` or `item` targets) requests a checked RPG extension. The Quests tab's
“Make this a quest” form selects an open template explicitly and reports any refusal beside its
button. RB checks the frozen template's objective kinds, requirements and real target identities,
then fixes the reward from the recorded area tier. A refusal leaves the neutral SD goal usable.
SD stores only the complete numeric Quest transport; it never chooses a template, calculates a
reward, scales a monster or decides whether an RPG objective was met.

`threads.link` now accepts either an already accepted neutral thread with an active extension
inheriting its original acceptance, or a neutral offer with an offered extension and null
acceptance/deadline/settlement. The latter does not accept the goal. Both require the authenticated
ready RB caller, an expected thread hash, a retry write ID, matching thread identity and empty
objective evidence. Existing RPG extensions cannot be replaced by linking again.

Closing is the module's proof-based transaction: RB validates surviving sealed-fight, inventory,
scene or explicit story-objective evidence, settles once, and calls the SD writers for closure
and journal. Story Block owns evidence, claims and replay, so retracting a prerequisite removes
the dependent result, rewards and closure together. An unchanged replay uses recorded evidence
and code-owned numbers; it does not query live policy or infer replacement targets.

Other game modules should follow the same ownership pattern: define a closed extension transport
and an authorized owner seam, require explicit binding, validate opening before attachment, keep
neutral acceptance independent, and close only through surviving owner-validated proofs. The RPG
writer authorization is not permission for another module to write `rpg`.

Stage 5 transport addition: kill objective `foe` may be a canonical `<base-ref>~<variant-slug>`;
optional `allowVariants:boolean` is carried verbatim. Its meaning and eligibility are RB's.

Trainer offers in RPG Battle (2.2.0, planned) consume the canonical place rather than own it. RB reads `atlas.canonical({})` once, when an offer is made, and records the place's id and name on the offer, so the offer still names the same place after the story materializes a pack place as a `pl_` place. Story Director adds no code for this; the `pack.<id>/<slug>` and `pl_` identities in `src/v2/atlas/canonical.js` are what let a trainer stay where it was offered.
