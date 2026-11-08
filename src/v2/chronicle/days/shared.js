// Story Director v2, chronicle part: shared day-digest constants and text helpers. Pure.

export const DIGEST_FEATURE = 'story-director.digest';
export const DIGEST = 'chronicle.digest';
export const DAY_MINUTES = 1440;

/** Settings: full digests kept, days kept in all (older ones are dropped). */
export const DIGEST_DEFAULTS = Object.freeze({ digestDays: 14, digestKeep: 120, digestTail: true });
export const FULL_MAX = 60;
export const KEEP_MAX = 365;
// The validator's ceilings: twice the settings' tops, so a replay that brings back an entry a deleted
// reply had dropped is never refused for it (SPEC §2.2 rule a); the next digest drops it again.
export const FULL_CEILING = FULL_MAX * 2;
export const KEEP_CEILING = KEEP_MAX * 2;

// What a digest may hold.
export const MAX_HAPPENED = 8;
export const MAX_PLACES = 8;
export const MAX_QUESTS = 6;
export const MAX_NPCS = 6;
export const MAX_WORLD = 6;
export const MAX_ITEM = 160;
export const MAX_LINE = 200;
export const MAX_DATE = 80;
export const MAX_NAME = 80;
export const MAX_MET = 8;

// Receipts that set the clock (module story-director, `data.minutes`; `director.clock` is the reader's own edit of it).
// `director.advance` called by another module's command has no receipt of its own; the time part's settle before the
// next reply sets the clock right again.
const CLOCK_TYPES = new Set(['capture.time', 'director.seed', 'director.clock', 'time.settle', 'director.advance']);
// Receipts that are bookkeeping only: never a fact of the day.
const QUIET_TYPES = new Set([DIGEST, 'chronicle.note', 'chronicle.surface', 'director.seed']);
// The arc planner's commands (arc/commands.js): what was planned stays behind the scenes, so an arc's
// name and counts are never a fact of the day (the Journal shows only what {{user}} knows).
export const PLANNED_TYPES = new Set(['director.arc.accept', 'director.arc.update', 'director.arc.end']);
// The reader's progress is told although the code makes it (cause system): practice lines.
const SYSTEM_BUT_TOLD = new Set(['rpg.practice']);
export const quiet = receipt => QUIET_TYPES.has(receipt.type) || (receipt.cause === 'system' && receipt.narrate !== true && !SYSTEM_BUT_TOLD.has(receipt.type));
export const SETTLE = 'time.settle';
// Story Block's scene receipts that name who came into the scene (`data.added`).
export const PRESENT_TYPES = new Set(['capture.present', 'scene.present']);
// Receipts a section of the digest already tells (places, money, world), or the reader's own edits and
// a fight's blow-by-blow: never repeated under "happened".
export const TOLD_ELSEWHERE = new Set([
    'capture.place', 'capture.coin', 'capture.world', 'capture.faction', 'wallet.receive', 'wallet.pay',
    'atlas.visit', 'atlas.edit', 'atlas.focus', 'chronicle.edit', 'chronicle.remove', 'combat.act',
]);
// Receipts that are the code's own bookkeeping, never an event of the day (neither picked nor counted under "happened"): Story Block's
// fight board result (`rpg.resolve`, whose summary is the narrator's instruction), its no-roll step, field edits, timer ticks and
// reply-end settles (`dm.set`, `dm.tick`, `dm.settle`), the Director's own initiative pick, the story-time settle and the cast's
// "nothing changed". Practice lines and add-xp are the reader's progress and stay.
export const BOOKKEEPING_TYPES = new Set([
    'rpg.resolve', 'rpg.noroll', 'dm.set', 'dm.tick', 'dm.settle', 'director.initiative', 'time.settle', 'cast.advance',
]);
// A block's template result (`capture.dm` / `dm.act`, `data.v2.result.kind`) that is a plain meter set (set-health, set-mana,
// set-stamina, set-slot-N) or a foe slot clear (clear-N) is bookkeeping; every other kind (register, deed, add-xp ...) is a story event.
const METER_KIND = /^(set-[a-z]+(-\d+)?|clear-\d+)$/;
const DM_TYPES = new Set(['capture.dm', 'dm.act']);
/** Whether a receipt is the code's own bookkeeping: by type, by a block result's kind, a clock line "(not used)" or an empty summary (never by other text). */
export function isBookkeeping(receipt) {
    if (BOOKKEEPING_TYPES.has(receipt.type)) return true;
    if (typeof receipt.summary !== 'string' || !receipt.summary.trim()) return true;
    if (DM_TYPES.has(receipt.type)) return METER_KIND.test(receipt.data?.v2?.result?.kind ?? '');
    return receipt.type === 'capture.time' && /\(not used\)\.?\s*$/.test(receipt.summary);
}
// A tracker line's receipt repeats the line itself ("Director: + quest …"): the model's words, not code's.
export const ECHO = /^Director: /;

export const isInt = value => Number.isSafeInteger(value);
export const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const text = value => (typeof value === 'string' ? value : '');

// Invisible format marks and control characters go; whitespace folds to one space.
const INVISIBLE = /[\p{Cf}\p{Cc}]+/gu;

/** `value` as one flat line: invisible marks and line breaks gone, spaces folded. */
export function flat(value) {
    return text(value).replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim();
}

/** `value` cut to `max` code points (never inside a character), with "…" when it was longer. */
export function cut(value, max) {
    const chars = Array.from(flat(value));
    if (chars.length <= max) return chars.join('');
    return `${chars.slice(0, Math.max(0, max - 1)).join('').trimEnd()}…`;
}

export const codePoints = value => Array.from(text(value)).length;

/** The story day of `minutes` (whole days since the calendar's start). */
export const dayOf = minutes => Math.floor(minutes / DAY_MINUTES);

// ---- which day each receipt belongs to --------------------------------------------------------

export const receiptOf = entry => (isRecord(entry?.receipt) ? entry.receipt : isRecord(entry) && typeof entry.type === 'string' ? entry : null);
export const clockSet = receipt => CLOCK_TYPES.has(receipt.type) && (receipt.module === undefined || receipt.module === 'story-director') && isInt(receipt.data?.minutes);

// One entry's lists at most (an entry is one reply's part of a day, see entryOf).
export const ENTRY_HAPPENED = MAX_HAPPENED;

// The quest history (quest.details, F84) is read from receipts too: `chronicle.questLog["<rev>"] =
// { thread, text }` keeps, per receipt revision, the summary of each receipt that touched a quest or
// thread, written by the note on the reply it belongs to; the newest QUEST_LOG_KEPT per thread stay.
export const QUEST_LOG_KEPT = 8;
export const QUEST_LOG_TEXT = 200;

/** Entries a day may keep before a note folds them into its own one (a very long day). */
export const FOLD_AT = 200;
/** Entries the written days keep in all, so their digests follow them (newest days first, each day whole). */
export const FOLLOW_MAX = 800;
export const ENTRY_KEY = /^(-?\d{1,15})\.(\d{1,15})$/;
