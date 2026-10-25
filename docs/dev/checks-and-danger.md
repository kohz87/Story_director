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
- The result: `{ check, actor, die, modifiers, mod, total, dc, outcome }` and nothing more. Where the modifier came from is on the log record
  (`source` 'rb' | 'standalone', and `fallback`, why RB's projection was not used: `no-link`, `rb-modifiers-off`, `rb-unavailable`,
  `rb-no-answer`, `rb-malformed`). The newest 60 are in `checks.log`.
- The pre-roll (Story Block's assist, cause `system`) stands on the previous reply's evidence; its one-use claim carries the receipt's rev,
  so it does not meet that reply's own check of the same meaning (once per message is the assist's own claim, `assist:precheck:<key>`).
- A `checks` slice RPG Battle's checks part wrote (`{ prepared, log, ... }`, no policy or ledger) is valid as it is; the first write of ours
  (`draftChecks`) makes it ours: the policy and ledger it lacks are filled, `prepared`, `last` and `pending` dropped, the log kept where it is ours in shape.
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
most; secrets and arcs left out as the Journal leaves them; works with the digest and the World view off. A day with none is `missing: true` and its source is `snapshot` (track C's fixture has it so; the saved scene is the only source left). The day is the
contract's `Day` (floor(minutes / 1440), the clock may be negative): a day before the first is a day.

## Differences from the contract, and gaps (written down, not decided)

- `evidence` of `checks.roll`: the contract says "NOT_FOUND unknown actor/evidence; REFUSED inactive/used evidence". The evidence is accepted
  when it is the block's own `Source.evidence` or a proof `story.evidence` shows (so a deleted or swiped reply's proof is not found, and
  "inactive" is NOT_FOUND). "Used" is one claim per evidence **and request** (`sd:check:<evidence>:<hash of actor, stat, skill, target, dc>`),
  because a reply may hold two checks (F32). Story Block gives Story Director no proof kind for a check yet; if the lead wants a `check`
  proof, that is an E5 owner-table change.
- **Stage 5 flip complete.** This module alone registers domain `checks`, `checks.roll` and `? check`. There is no prepared table. The narrator omits `result`; legacy labels are ignored with no flag or Problem. The receipt tells the next tail what happened. SB Assist captures once and reads `data.v2.result`, with no legacy roll probe.
- RB crafting may call `checks.roll` with `{ craft: { recipe, at?: 'campfire' } }`, actor, recipe DC and evidence. This extension accepts only RB as caller, never a supplied die or modifier. SD asks `rules.modifier` with that recipe context; missing or disabled RB modifiers refuse the whole craft. RB decides quality from the returned die and total.
- A linked RB character's held skill records a practice attempt through `rules.practiceCheck` in the same root transaction, on success or failure. A stat-only check records none. RB's settlement owns the existing caps and replay guard; SD never reads external settings from a guard. Re-read/swipe/delete retract the attempt with its roll.
- Real SB+SD+RB tests cover skill checks, practice caps, Assist, reload and rebuild with no Problems. The modifier projection remains available for legacy crafting without turning on rules-v2 state.
