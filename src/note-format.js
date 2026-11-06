// Story Director: the note's word limits and field formatting (pure).
//
// NOTE_PART_WORDS, the item separator, notePart, fieldOf and the part builder moved out of
// note.js; note.js re-exports the public names.
export const ITEM_SEPARATOR = ' · ';

// The most words of one part the note writes (v0.8.4): what a record is doing and when in 12,
// what it is (desc, a quest's goal, step, giver and reward, the foes of a fight) in 16. A longer
// part ends in "…" in the note only; the tracker, the tabs and the API keep every word.
export const NOTE_PART_WORDS = Object.freeze({
    now: 12, then: 12, on: 12, due: 12, arrive: 12,
    desc: 16, goal: 16, step: 16, reward: 16, giver: 16, encounter: 16, type: 16, shown: 16,
    // (0.9.19) A beat's reach, on Due now only: enough for one consequence and who it falls on.
    reach: 16,
});
const DEFAULT_PART_WORDS = 16;
const ELLIPSIS = '…';

/**
 * `text` as the note writes it for `field`: trimmed, and cut after the field's word limit at a
 * word boundary with "…". A cut that would leave a bracket open goes back to before it, when
 * words are left; trailing commas, semicolons and dashes go.
 */
export function notePart(text, field) {
    const value = String(text ?? '').trim();
    const limit = NOTE_PART_WORDS[field] ?? DEFAULT_PART_WORDS;
    const words = value.split(/\s+/).filter(Boolean);
    if (words.length <= limit) return value;
    let kept = words.slice(0, limit);
    const open = kept.reduce((last, word, index) => {
        const opens = (word.match(/[([]/g) ?? []).length;
        const closes = (word.match(/[)\]]/g) ?? []).length;
        return opens > closes ? index : closes > opens ? -1 : last;
    }, -1);
    if (open > 0) kept = kept.slice(0, open);
    return `${kept.join(' ').replace(/[\s,;:—–-]+$/u, '')}${ELLIPSIS}`;
}

// A record's field as the note writes it.
export function fieldOf(record, field) {
    return notePart(record?.fields?.[field], field);
}

export function part(label, text, join = '\n') {
    return { label, text, join };
}
