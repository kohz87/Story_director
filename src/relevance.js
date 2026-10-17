// Story Director: relevance (pure).
//
// Decides, for one point in the story, which tracked records the next reply needs to know
// about: what is due or arriving, what is relevant (and in which order, so the note can drop
// the least important first), what sits on the dormant shelf, and which secrets to guard.
// Dormancy is derived here every time and never stored on the record.

export const DEFAULTS = { budgetTokens: 1000, dormantReplies: 15, dormantDays: 30, dueSoonDays: 3 };

// Fields that hold a date the story can reach.
const DATE_FIELDS = ['on', 'due', 'arrive'];
const FIRE_FIELDS = ['on', 'due'];

// Records resolved this recently (in messages) are still worth showing in the tab.
const RESOLVED_RECENT_MESSAGES = 5;
// Records changed this recently (in messages) are relevant (priority 5).
const CHANGED_RECENT_MESSAGES = 3;
// Shorter names than this match too much by accident ("Al" inside every "also").
const MIN_NAME_LENGTH = 3;

const DAY_MINUTES = 1440;

export function estimateTokens(text) {
    return Math.ceil(String(text ?? '').length / 4);
}

export function dateOf(record, field, { calendar, reference = null } = {}) {
    const text = record?.fields?.[field];
    if (!calendar || typeof text !== 'string' || !text.trim()) return null;
    return calendar.parse(text, { reference }) ?? null;
}

// A date without a time counts for its whole day, so "Haywane 12" is reached as soon as it
// is Haywane 12 at any hour; a date with a time is reached at that minute.
function reachedBy(parsed, limit, calendar) {
    if (!parsed) return false;
    if (!parsed.hasTime) return calendar.dayIndex(parsed.abs) <= calendar.dayIndex(limit);
    return parsed.abs <= limit;
}

function anyReached(record, fields, limit, { calendar, now }) {
    if (!calendar || !isNumber(limit) || !isNumber(now)) return false;
    return fields.some(field => reachedBy(dateOf(record, field, { calendar, reference: now }), limit, calendar));
}

export function isDue(record, { calendar, now }) {
    if (!isActive(record)) return false;
    return anyReached(record, FIRE_FIELDS, now, { calendar, now });
}

export function isArriving(record, { calendar, now }) {
    if (!isActive(record)) return false;
    return anyReached(record, ['arrive'], now, { calendar, now });
}

// Something due (or overdue) within dueSoonDays keeps a record awake.
function dueSoon(record, { calendar, now, days }) {
    if (!calendar || !isNumber(now)) return false;
    return anyReached(record, DATE_FIELDS, calendar.addDays(now, days), { calendar, now });
}

export function isDormant(record, { calendar, now = null, message = null, settings = DEFAULTS } = {}) {
    if (!isActive(record) || record.pinned) return false;
    const { dormantReplies, dormantDays, dueSoonDays } = { ...DEFAULTS, ...settings };
    if (dueSoon(record, { calendar, now, days: dueSoonDays })) return false;

    const seen = record.seen ?? {};
    const quietReplies = isNumber(message) && isNumber(seen.message) && message - seen.message >= dormantReplies;
    const quietDays = isNumber(now) && isNumber(seen.time) && (now - seen.time) / DAY_MINUTES >= dormantDays;
    return quietReplies || quietDays;
}

export function classify(tracker, {
    calendar,
    now = null,
    message,
    place = '',
    sceneText = '',
    recentText = '',
    settings = DEFAULTS,
} = {}) {
    const records = tracker?.records ?? [];
    const current = isNumber(message) ? message : tracker?.message ?? -1;
    const options = { calendar, now, message: current, settings: { ...DEFAULTS, ...settings } };
    const text = `${sceneText ?? ''}\n${recentText ?? ''}`;

    // The current arc: the newest active one. Its beats come first; it is shown on its own.
    const arc = records
        .filter(record => isActive(record) && record.kind === 'arc')
        .sort((a, b) => (b.created?.message ?? -1) - (a.created?.message ?? -1))[0] ?? null;

    const selection = {
        now,
        place,
        arc,
        due: [],
        arriving: [],
        relevant: [],
        dormant: [],
        secrets: [],
        resolvedRecently: [],
    };

    records.forEach((record, index) => {
        if (!isActive(record)) {
            const resolved = record.resolved;
            if (resolved && isNumber(resolved.message) && current - resolved.message < RESOLVED_RECENT_MESSAGES) {
                selection.resolvedRecently.push(record);
            }
            return;
        }
        if (record.kind === 'arc') return;
        // Secrets are guarded, never listed as facts.
        if (record.kind === 'secret') {
            selection.secrets.push(record);
            return;
        }

        const due = isDue(record, options);
        const arriving = isArriving(record, options);
        if (due) selection.due.push(record);
        if (arriving) selection.arriving.push(record);
        if (due || arriving) return;

        // Priorities 1-5 also wake a dormant record (the scene mentions it, it is at this
        // place, ...); only "everything else" stays on the shelf.
        const match = matchPriority(record, { place, text, message: current, arc });
        if (match) {
            selection.relevant.push({ record, ...match, index });
        } else if (isDormant(record, options)) {
            selection.dormant.push(record);
        } else {
            selection.relevant.push({ record, reason: 'active', priority: 6, index });
        }
    });

    // Within a priority, the most recently seen first, so the budget drops stale ones first.
    selection.relevant.sort((a, b) =>
        a.priority - b.priority
        || seenMessage(b.record) - seenMessage(a.record)
        || a.index - b.index);
    selection.relevant = selection.relevant.map(({ record, reason, priority }) => ({ record, reason, priority }));
    return selection;
}

function matchPriority(record, { place, text, message, arc = null }) {
    const fields = record.fields ?? {};
    if (record.kind === 'clock' && /sign|warning/i.test(fields.shown ?? '')) {
        return { reason: 'shown', priority: 1 };
    }
    // The current arc's beats; with no planned arc, every active beat counts as current.
    if (record.kind === 'beat' && (!arc || !record.arc || record.arc === arc.arc)) return { reason: 'beat', priority: 2 };
    if (placeMatches(record, place)) return { reason: 'place', priority: 3 };
    if (mentioned(record, text)) return { reason: 'mentioned', priority: 4 };
    const changed = record.changed?.message;
    if (isNumber(changed) && message - changed < CHANGED_RECENT_MESSAGES) {
        return { reason: 'changed', priority: 5 };
    }
    return null;
}

// "Auvoth" matches a record placed at "Auvoth, Canal Street", and the other way round; the
// place may also only be written inside now or leg.
function placeMatches(record, place) {
    const here = normalize(place);
    if (here.length < MIN_NAME_LENGTH) return false;
    const fields = record.fields ?? {};
    return [fields.place, fields.now, fields.leg].some(value => {
        const there = normalize(value);
        return there.length >= MIN_NAME_LENGTH && (there.includes(here) || here.includes(there));
    });
}

function mentioned(record, text) {
    if (!text.trim()) return false;
    const names = [record.key, ...String(record.fields?.people ?? '').split(',')]
        .map(name => String(name ?? '').trim())
        .filter(name => name.length >= MIN_NAME_LENGTH);
    return names.some(name => wordPattern(name).test(text));
}

// Word boundaries that work for accented names too (\b is ASCII-only).
function wordPattern(name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu');
}

function normalize(value) {
    return String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function seenMessage(record) {
    const value = record.seen?.message;
    return isNumber(value) ? value : -Infinity;
}

function isActive(record) {
    return record?.status === 'active';
}

function isNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}
