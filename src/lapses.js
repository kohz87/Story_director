// Story Director: what time closes on its own (pure).
//
// (0.9.19) Two things the story can leave hanging for ever: a beat whose date went by without
// the story firing it, and an offer nobody took before its deadline. Neither is closed here:
// these only say which records are due to close, and index.js writes the `-` lines into the
// reply where the time passed, so deleting or swiping that reply takes the closing back.

import { isOffer } from './tracker.js';

// Story days a beat may run late before it slips: the story gets the rest of its day and two
// more to bring it in (on-screen, or as news), then it is closed for it.
export const SLIP_GRACE_DAYS = 2;
// Story days an offer with no deadline stays open after the later of its being offered and the
// story last mentioning it (its `seen` time); then it lapses like one whose deadline passed.
// A constant, not a setting (USER, 5 Nov: "without deadline, it should expire in 2-3 game days").
export const UNDATED_OFFER_DAYS = 3;
// The reasons written on the `-` lines, and read back for the next note.
export const SLIPPED_REASON = 'slipped';
export const LAPSED_REASON = 'offer lapsed';

const isNumber = value => typeof value === 'number' && Number.isFinite(value);

// The last minute a date counts for: a date without a time runs to the end of its day, the
// way deadlines are counted (calendar.withClock, the Quests tab).
function endOf(parsed, calendar) {
    return parsed.hasTime ? parsed.abs : calendar.addDays(parsed.abs, 1) - 1;
}

function dateEnd(record, field, { calendar, now }) {
    const text = String(record?.fields?.[field] ?? '').trim();
    if (!text) return null;
    const parsed = calendar.parse(text, { reference: now });
    return parsed && isNumber(parsed.abs) ? endOf(parsed, calendar) : null;
}

// A `!` since the date was last written is the beat played out: `! Key — …` alone clears the
// date, but one with parts (`! Key — the riders come | now: at the ford`) keeps it. A line that
// writes the date again (`~ Key — on: Goldwane 20`, `! Key — … | on: …`) puts it back on the
// schedule. Only the history the record keeps is read; with no line writing the date left in
// it, any `!` counts as fired.
const WRITES_DATE = /(?<![\p{L}\p{N}])(?:on|due)\s*:/iu;
function firedSinceDated(record) {
    for (const entry of [...(record.history ?? [])].reverse()) {
        const text = String(entry?.text ?? '');
        if (entry?.op === '+' || WRITES_DATE.test(text)) return false;
        if (entry?.op === '!') return true;
    }
    return false;
}

/**
 * The open beats whose date (`on`, else `due`) passed more than `graceDays` story days ago
 * without the story firing them, in tracker order: the records to close as slipped. A date
 * without a time counts to the end of its day. Nothing without a calendar, a time or a date.
 */
export function slippedBeats(tracker, { calendar, now, graceDays = SLIP_GRACE_DAYS } = {}) {
    if (!calendar || !isNumber(now)) return [];
    const grace = Number(graceDays) >= 0 ? Number(graceDays) : SLIP_GRACE_DAYS;
    return (tracker?.records ?? []).filter(record => {
        if (record?.kind !== 'beat' || record.status !== 'active') return false;
        const end = dateEnd(record, 'on', { calendar, now }) ?? dateEnd(record, 'due', { calendar, now });
        if (end === null || calendar.addDays(end, grace) >= now) return false;
        return !firedSinceDated(record);
    });
}

// An offer with no deadline written at all (a deadline that cannot be read stays as it was).
const isUndated = record => !String(record?.fields?.due ?? '').trim();

// An undated offer lapses `days` story days after the latest of when it was offered
// (`created.time`), when the story last mentioned it (`seen.time`: every line that touches
// the record sets it) and when the reader first spoke of it (`engaged.time`). No known time for
// any: it never lapses (nothing to count from).
function undatedLapse(record, { calendar, now, days }) {
    const span = Number(days) >= 0 ? Number(days) : UNDATED_OFFER_DAYS;
    const times = [record.created?.time, record.seen?.time, record.engaged?.time].filter(isNumber);
    if (!times.length) return false;
    return calendar.addDays(Math.max(...times), span) <= now;
}

/**
 * The offers (jobs not taken on, tracker.isOffer) whose deadline (`due`) has passed, in tracker
 * order: the records to close as lapsed. A deadline without a time runs to the end of its day,
 * and is passed at that minute, as the Quests tab marks it overdue. (0.9.27) An offer the reader
 * has spoken of (`engaged`) is often the job's own day ("the hunt sets out on Goldwane 15"), so
 * it gets a beat's grace, `graceDays` more, for the story to play it. An offer with no deadline
 * lapses `undatedDays` (UNDATED_OFFER_DAYS) story days after it was offered or last mentioned.
 */
export function lapsedOffers(tracker, { calendar, now, graceDays = SLIP_GRACE_DAYS, undatedDays = UNDATED_OFFER_DAYS } = {}) {
    if (!calendar || !isNumber(now)) return [];
    const grace = Number(graceDays) >= 0 ? Number(graceDays) : SLIP_GRACE_DAYS;
    return (tracker?.records ?? []).filter(record => {
        if (!isOffer(record)) return false;
        if (isUndated(record)) return undatedLapse(record, { calendar, now, days: undatedDays });
        const end = dateEnd(record, 'due', { calendar, now });
        if (end === null) return false;
        return (record.engaged ? calendar.addDays(end, grace) : end) <= now;
    });
}

/** The change lines that close them: "- Key — slipped", "- Key — offer lapsed". */
export function lapseLines({ slipped = [], lapsed = [] } = {}) {
    return [
        ...slipped.map(record => `- ${record.key} — ${SLIPPED_REASON}`),
        ...lapsed.map(record => `- ${record.key} — ${LAPSED_REASON}`),
    ];
}

/**
 * What the reply at `message` closed this way, for the next note: `{ slipped, lapsed }`, each
 * `[{ key, on, giver }]` plain copies (`on` the beat's date as written, `giver` the offer's).
 * Read by reason, so the story's own `- Key — slipped` counts too.
 */
export function lapsesIn(tracker, message) {
    const at = Number(message);
    const out = { slipped: [], lapsed: [] };
    if (!Number.isInteger(at)) return out;
    const reason = record => String(record.resolved?.reason ?? '').trim().toLowerCase();
    const text = value => String(value ?? '').trim();
    for (const record of tracker?.records ?? []) {
        if (record?.status !== 'resolved' || record.resolved?.message !== at) continue;
        if (record.kind === 'beat' && reason(record) === SLIPPED_REASON) {
            out.slipped.push({ key: record.key, on: text(record.fields?.on) || text(record.fields?.due), giver: '' });
        } else if (record.kind !== 'quest' && reason(record) === LAPSED_REASON) {
            out.lapsed.push({ key: record.key, on: '', giver: text(record.fields?.giver) });
        }
    }
    return out;
}
