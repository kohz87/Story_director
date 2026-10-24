# Checks, places and danger (RPG Battle contract §3 P09, P24, §5 P05)

What track B added to Story Director so that RPG Battle (and anything else) can ask for a check outside a fight, for the canonical
place, and for the danger of a place, without Story Director depending on RPG Battle. Contract: `RB_PHASE0.md` §3 (P09 independent checks,
P24 populate identities, the entry table), §5 P05. Code: `src/v2/checks/`, `src/v2/atlas/{canonical,policy}.js`, `src/v2/world/journal.js`
(`journalDay`), `src/v2/{hash,writes}.js`. Tests: `tests/v2/checks/`, `tests/v2/atlas/policy.test.js`, `tests/v2/world/journal-day.test.js`.

## Checks (`checks` part, domain `checks`)

`checks = { policy: { actors, defaultActor, rbActors }, writes, log }`. An actor is SD's own (`ca_` id, a name, standalone bonuses:
a stat or `topic:<name>` -> -30..30); `rbActors` is an explicit, one-to-one link from an actor to an RPG Battle character (never by name).

- `checks.actor`, `checks.link`: the player's settings (or RPG Battle's creation making a missing actor, linking a new character). Idempotent by
  `write` (the ledger is `checks.writes`, `atlas.writes` for the map; same write + same fingerprint answers again before any stale check, another
  meaning is `CONFLICT`); `expectedHash` is the hash of `checks.policy` / `atlas.policy`; the order of answers is INVALID, REFUSED, retry,
  NOT_FOUND, STALE, CONFLICT.
- `checks.roll { actor?, stat?, skill, targetNpc?, dc?, evidence }`: from capture, the pre-roll (Story Block's assist) and the system; never a
  click. One d20 (`ctx.roll`). Modifier: the stat is the written one, else `statForCheck(skill)` (unknown LUK). With a valid link and
  `rbModifiers` the whole standalone subtotal is replaced by `rules.modifier`'s parts (never two stat bases); otherwise `bonuses[stat]` plus each
  distinct matching `topic:` bonus. At most one NPC State Delta part (`npc.identity` -> `npc.socialModifier`, `social` setting). Clamped to
  -30..30 with a `cap` part, so the parts add up to `mod`. Natural 20 / 1, `total >= dc` success, within `costMargin` a cost, else fail.
  Settings: `defaultDc` 15, `costMargin` 2, `rbModifiers` true, `social` true (SD's own; no RPG Battle lookup).
- The result: `{ check, actor, die, modifiers, mod, total, dc, outcome }` plus `source` ('rb' | 'standalone') and `fallback` (why RB's
  projection was not used: `no-link`, `rb-modifiers-off`, `rb-unavailable`, `rb-no-answer`, `rb-malformed`). The newest 60 are in `checks.log`.
- `checks.policy({}) -> { actors, defaultActor, rbActors, rbModifiers, social, hash }`; `director.contract({}) -> { api: 2, enabled, clock,
  tiers, threads, journal, checks }` (booleans found by asking the queries each capability needs).

## Places and danger (`atlas` part)

`atlas` gained `regions`, `placeRegions`, `placeRefs`, `danger` and `writes` (an older save reads them as empty).

- `atlas.canonical({id?,name?})`: a pack place is its content id (`pack.<id>/<slug>`) before and after the story puts it on the map; a place no
  pack has is its `pl_` id, mapped to itself in `placeRefs`; omitted both means the scene's place. A name two packs answer to, or an own
  place that fits several, is ambiguous: null. `packWorld` now returns every candidate (`candidates`) before names are made unique, and keeps
  each place's `definition`. `ensurePlace` records the identity once it is certain and never changes one.
- `atlas.candidates({place})` -> `{ place, definitions }` (what `atlas.placeBind` can choose); `atlas.placeBind` binds a held place to one
  of them (unique, matching its names, never changing an established identity).
- `atlas.region`, `atlas.placeRegion`, `atlas.dangerSet`: regions (`rg_`, unique names and aliases), explicit membership, and AreaPolicy for
  the world, a region or a place. Nothing is read from a place's `region` text.
- `world.areaTier({place})`: canonical place -> place policy -> region policy -> world policy, first found wins; unknown holds generation
  (`tier: null`, `source: 'unknown'`, `sourceId: null`). A world policy has `sourceId: null` (as track C's fixtures have it).
- `atlas.policy({})`: the region-sorted projection with its hash (the ledger excluded).

## `journal.day({day, snapshot?})` (`world` part)

The visible digest, else the visible facts of the day, else the saved scene of a save point (`savepoint.list`); twelve lines of 240 characters at
most; secrets and arcs left out as the Journal leaves them; works with the digest and the World view off. A day with none is `missing: true` and its source is `snapshot` (track C's fixture has it so; the saved scene is the only source left).

## Differences from the contract, and gaps (written down, not decided)

- `evidence` of `checks.roll`: the contract says "NOT_FOUND unknown actor/evidence; REFUSED inactive/used evidence". The evidence is accepted
  when it is the block's own `Source.evidence` or a proof `story.evidence` shows (so a deleted or swiped reply's proof is not found, and
  "inactive" is NOT_FOUND). "Used" is one claim per evidence **and request** (`sd:check:<evidence>:<hash of actor, stat, skill, target, dc>`),
  because a reply may hold two checks (F32). Story Block gives Story Director no proof kind for a check yet; if the lead wants a `check`
  proof, that is an E5 owner-table change.
- The `? check` line: `src/v2/checks/capture.js` is the `check` kind as **one** `checks.roll` (the line's `dc` word to its number, `who` an SD
  actor by name, `vs` a person NSD knows, the model's `result:` never read). It is exported as `checkKind` and **not** in `part.kinds`:
  RPG Battle's checks part still keeps the `check` kind and only one module may. The lead flips them together (add `kinds: { check: checkKind }`
  here, drop RPG Battle's). Not moved: the check **table** (`checks.prepare`, the two d20s per reply, the table in the tail, the reply card)
  stays in RPG Battle's checks part until the lead retires it.
- E7b, Story Block's `src/v2/assist/` (not edited here): the patch file `e7b-assist-checks.patch` (handed to the lead with the PR; it has context lines with trailing blanks, so it is not kept in the tree), a `git apply`-able patch against
  `track-e/e5-evidence` (5e31419). `assist.precheck` keeps the claim and `capture.check` and drops the `check.roll` probe, `pendingCheckId`
  and `ROLL_COMMAND`; the roll's receipt is read from `data.v2.result`; a missing `check` kind fails the capture call, so the claim is not
  kept. Its tests are updated (a one-die stand-in; a legacy `check.roll` that must never be called).
- `rules.modifier` is RPG Battle's (slice 4 of track B); until a ready RPG Battle answers it SD uses the standalone bonuses and says why.
- `director.contract.threads` is true only when `director.threads` and `threads.hash` answer: track A's thread writers are theirs.
- `registration`: `src/v2/module.js` lists the parts (lead-owned); `checks` is added there in its own commit.
