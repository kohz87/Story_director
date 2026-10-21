# Quest completion contracts

These rules cover measurable quests; unsupported
explicit terms block completion, while unmeasurable quests keep narrative closure.

```text
+ quest Wolf bounty — protect the road | giver: Fenna | target: defeat 3 wolves | reward: 1 silver per wolf
+ quest Tail delivery — bring proof | giver: Fenna | target: deliver 5 Rat Tail | reward: 2 silver
+ quest Permit check — show your permit | target: possess 1 Travel Permit | reward: none
```

## C01–C03: authority, grammar and acceptance

- Director owns terms/receipts, RPG owns combat/currency, Story Block owns Inventory
  persistence. Narration, injections and model-written blocks cannot create combat proof.
- One positive safe-integer target: defeat, possess or deliver. Explicit `target` wins;
  fallback accepts only a whole unambiguous goal beginning with a supported action.
  Bare counts, strict kills, compound targets and unsupported aliases are not guessed.
- Rewards are exact configured fixed coins, matching per-unit coins, or explicit `none`.
  Missing/unsupported/mixed rewards block settlement; per-unit possession is unsupported.
- Freeze identity, terms, currency, giver/issuer and evidence cursor at actual acceptance,
  including when a hook becomes a quest. Later steps/reward wording cannot renegotiate it.
  Exclude earlier defeats, including those already recorded on the acceptance reply.
  Missing acceptance proof is unavailable. Reopening the same instance cannot pay again.

## C04–C06: evidence, resources and eligibility

- Persist each production fight/stage once, with active-swipe ownership and individual
  enemy IDs. Count actual downed foes even in lost/fled fights; exclude parley, escaped
  foes, unreached stages and duplicate aggregates. Downed does not establish death.
- Match canonical identities with bounded case/spacing/plural normalization, never
  substrings: wolf spiders and young wolves are not automatically wolves.
- Count valid current player Inventory, including earlier acquisitions. Exclude companion,
  shop and uncollected-order stock. Possess retains goods; deliver consumes exactly the
  required quantity across duplicate rows. Unknown/invalid quantities block completion.
- Claim defeat contributions per receipt: fixed rewards claim the minimum in order;
  per-unit rewards claim all eligible defeats. Paid bounties cannot share claims.
  Minimum 3 wolves at 1 silver each with 8 eligible defeats pays 8 silver; a fixed 5-silver
  bounty pays 5. Deliver 5 of 8 tails at 1 silver each leaves 3 and pays 5.
- Complete requires active supported terms, sufficient unclaimed resources, the giver
  present or the issuing settlement, and no conflicting generation, battle/plan or save.
  Incidental mentions/other settlements do not prove availability. Display unknown proof
  as unavailable, not zero; explain blocked actions. Preserve existing abandonment/failure.

## C07–C09: settlement and replay

- Complete queues intent without changing resources. Undo is available before generation.
  Only a normal story reply processes it. Revalidate the frozen resources before generation
  and before saving; quiet calls, changed stock/claims/currency and wrong branches cannot pay.
- Inject the exact payout/removal and completion instruction into that reply. Require a
  code-owned receipt for managed success, even if the model declares it complete itself.
- Reconcile omitted or echoed resource effects once; preserve unrelated changes and block
  ambiguous deltas. Save Inventory, completion and receipt in one serialized message update.
  Confirm actual saved state before success; a lost response may still be durable. Restore
  rejected candidates only if untouched; uncertain saves require reload/reconciliation.
- Replay saved effects without incrementing them. Repeated events/clicks/reloads cannot
  pay again. Use the existing quest-XP path. Same valid narration swipes may retell a turn-in.
- Deletion/swipe restores prior blocks/claims. Lost evidence or edited acceptance terms
  invalidate dependent success and block further settlement until trustworthy history is
  restored. Do not guess refunds across an edited suffix or inherit sibling-branch claims.

## C10–C11: integration and verification

Capability-check optional version-1 APIs; missing providers produce unavailable checks.
Item checks need RPG Inventory/currency helpers but no combat history; Delta is optional.
Reuse existing replay/change events, keep prompts compact and never inject the battle ledger.
No direct cross-checkout imports, additional polling, model calls or automatic migrations.
Preserve proof boundaries; missing/compacted history is incomplete. This does not promise
isolation from arbitrary external writers or automatic reconstruction of edited suffixes.

Keep pure/runtime coverage of these rules and real-browser checks for thresholds, location,
payment/delivery/possession, Undo, duplicates, reload, swipes, deletion and evidence recovery.
API shapes are in each owner's `docs/STORY_SUITE.md`; results/limits are in
[IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).
