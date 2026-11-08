// Story Director v2, chronicle part: the day digest (feature `story-director.digest`, TRS idea 2). Pure.
//
// When the story clock has crossed into a new day, code writes what each finished day held, from
// the stored receipts and the state alone: no model call, no model prose. What a digest holds:
//   happened  the code-written summaries of the day's other receipts (what the story was told first),
//             at most 8, with how many more there were;
//   places    where the scene moved to (Story Block's `place` receipts);
//   quests    taken on, finished, failed or given up that day (the threads' own `taken` and `ended`
//             stamps, by the receipt that made them);
//   fights    how many ended, won, lost or fled;
//   money     what came in and went out, in the currency's smallest unit (the receipts' own amounts);
//   npcs      stage moves of NPC State Delta's meters (its receipts' `stages`);
//   world     the chronicle's own world lines of that day (their receipt summaries);
//   met       who came into the scene that day (Story Block's `present` receipts' `added` names), kept
//             only when there is someone (older digests have none), for the World screen's Journal.
// and one line made of those facts. Every number is one code wrote down; every text is a receipt's
// own summary, a name the state keeps, or a calendar date.
//
// Which day a receipt belongs to: receipts are walked in chat order and the clock is followed through
// the receipts that set it (the tracker's `time` line, the pack's start, the time part's settle and
// `director.advance`, each with `data.minutes`). A receipt belongs to the day the clock was on when it was committed; before the
// clock was first set, to the first day it was set to.
//
// chronicle.days    = { [day]: [Digest] }   each day a slot (../slot.js), written whole
//   a whole Digest made from the day's kept entries has `src` (their revisions) and follows them (daysOf);
// chronicle.written = null | [{ through, days: [day], at, skip }]
//   through: the day the clock was on when digests were last written (days before it are done);
//   days:    the days that had a digest then, so one a deleted reply took away is written again;
//   at:      the chat's length then (the reply that was about to be written);
//   skip:    the story had just jumped far ahead (a time skip), so that reply hears the last day.
// Older days are kept short (their line only) and the oldest dropped: see `capDays`.

export {
    DIGEST_FEATURE, DIGEST, DAY_MINUTES, DIGEST_DEFAULTS, FULL_MAX, KEEP_MAX,
    MAX_HAPPENED, MAX_PLACES, MAX_QUESTS, MAX_NPCS, MAX_WORLD, MAX_ITEM, MAX_LINE,
    MAX_DATE, MAX_NAME, MAX_MET, flat, cut, dayOf, QUEST_LOG_KEPT, QUEST_LOG_TEXT,
    FOLD_AT, FOLLOW_MAX,
} from './days/shared.js';
export {
    daysOf, followDigest, orderedDays, writtenOf, digestSettings, walkDays,
    questLogOf, notedOf, entriesByDay, rangeDays,
} from './days/state.js';
export { entryOf, eventsOf, foldEntries, factsOf, dayFacts, hasFacts } from './days/facts.js';
export { moneyText, fightText, dayLine, makeDigest, briefOf, capDays, digestOut } from './days/summary.js';
export { validateDays } from './days/validate.js';
