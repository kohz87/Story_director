// Story Director: replaying chat entries into a tracker (pure).
//
// Seen marks, replay and its mention helpers moved out of tracker.js; tracker.js re-exports
// their public names.
import { lineKey } from './changes.js';
import { escapeRegExp, normalizeQuotes } from './tracker-said.js';
import { emptyTracker } from './tracker-records.js';
import { applyOps } from './tracker-apply.js';

const MIN_PERSON_LENGTH = 3;

function namesOf(record) {
    const people = String(record.fields?.people ?? '')
        .split(',')
        .map(name => name.trim())
        .filter(name => name.length >= MIN_PERSON_LENGTH);
    return [record.key, ...people].filter(Boolean);
}

// Whole words only ("Ren" is not in "Renata"), any run of whitespace between words.
function mentionPattern(name) {
    const body = normalizeQuotes(name).trim().split(/\s+/).map(escapeRegExp).join('\\s+');
    return new RegExp(`(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`, 'iu');
}

/** Records whose key or a `people` name appears in `text` get `seen = { message, time }`. */
export function markSeen(tracker, text, { message, time = null } = {}) {
    const haystack = normalizeQuotes(String(text ?? ''));
    if (!haystack.trim()) return { ...tracker, records: [...tracker.records] };
    const records = tracker.records.map(record => {
        const mentioned = namesOf(record).some(name => mentionPattern(name).test(haystack));
        return mentioned ? { ...record, seen: { message, time } } : record;
    });
    return { ...tracker, records };
}

/**
 * Rebuilds the tracker from chat entries `[{ message, ops, text, time }]` in chat order.
 * Each problem carries the message index it came from in `message`; its description moves
 * to `text` (a Finding's own `message`).
 */
export function replay(entries, { seed = null } = {}) {
    let tracker = seed ?? emptyTracker();
    const problems = [];
    for (const entry of entries ?? []) {
        // A reply without a readable time keeps the last known one rather than forgetting it.
        const time = entry.time ?? tracker.time;
        const at = { message: entry.message, time };
        if (entry.text) tracker = markSeen(tracker, entry.text, at);
        // (0.9.27) A reply with no change lines still reads the reader's message (offers spoken of).
        if (entry.ops?.length || (typeof entry.said === 'string' && entry.said)) {
            const result = applyOps(tracker, entry.ops, {
                ...at, ...(entry.said === undefined ? {} : { said: entry.said }),
                chosen: entry.chosen ?? [], taken: entry.taken ?? [],
            });
            tracker = result.tracker;
            for (const problem of result.problems) {
                problems.push({ ...problem, text: problem.message, message: entry.message });
            }
        }
        tracker = { ...tracker, message: entry.message, time };
    }
    return { tracker, problems };
}
