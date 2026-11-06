// Story Director v2, chronicle part: day-digest state, receipt walking and settings. Pure.

import { slotValue } from '../../slot.js';
import {
    DIGEST_DEFAULTS, ENTRY_KEY, FULL_MAX, KEEP_MAX, QUEST_LOG_KEPT, SETTLE,
    clockSet, dayOf, isInt, isRecord, receiptOf,
} from './shared.js';
import { factsOf } from './facts.js';
import { makeDigest } from './summary.js';

/**
 * The day digests a chronicle keeps, by day number, as the day's facts stand now. A digest written
 * from the day's kept entries (`src`: their revisions) follows them: when a reply of that day is
 * deleted later (its entry goes with it), the digest is worked out again from the entries left
 * (followDigest), and a day none is left of is not there (the next digest drops it). Nothing of
 * this is stored: it is read from the state. `state` (the threads' stamps, for the quests) and
 * `currency` (the money's words in the line) are for a digest worked out again; without `state`
 * its quests stay as written.
 */
export function daysOf(chronicle, { state = null, currency = null } = {}) {
    const out = {};
    let byDay = null;
    let dayOfRev = null;
    for (const [key, stored] of Object.entries(isRecord(chronicle?.days) ? chronicle.days : {})) {
        const digest = slotValue(stored);
        if (!digest || !isInt(digest.day) || String(digest.day) !== key) continue;
        if (digest.brief || !Array.isArray(digest.src) || !digest.src.length) {
            out[key] = digest;
            continue;
        }
        byDay ??= entriesByDay(chronicle);
        const src = new Set(digest.src);
        const left = (byDay.get(digest.day) ?? []).filter(item => src.has(item.rev));
        if (!left.length) continue;
        if (left.length === src.size) {
            out[key] = digest;
            continue;
        }
        dayOfRev ??= rangeDays(byDay);
        out[key] = followDigest(digest, left, { state, currency, dayOfRev });
    }
    return out;
}

/**
 * `digest` worked out again from `left` (the day's entries still kept, `[{ rev, entry }]` in order):
 * its facts and line from them, its date and `made` as written, its quests from `state` when given.
 */
export function followDigest(digest, left, { state = null, currency = null, dayOfRev = () => null } = {}) {
    const facts = factsOf(left.map(item => item.entry), { state, day: digest.day, dayOfRev });
    const quests = state ? facts.quests : digest.quests;
    return makeDigest(digest.day, { ...facts, quests }, { date: digest.date, currency, made: digest.made, revs: facts.revs, src: left.map(item => item.rev) });
}

/** The days kept, oldest first (daysOf's options). */
export const orderedDays = (chronicle, options) => Object.values(daysOf(chronicle, options)).sort((a, b) => a.day - b.day);

/** `chronicle.written` (where digests were last written), or null. */
export const writtenOf = chronicle => slotValue(chronicle?.written);


// ---- the digest settings ---------------------------------------------------------------------

/** The digest settings out of the chronicle part's settings (a function, an object, or nothing). */
export function digestSettings(source) {
    let value = source;
    if (typeof source === 'function') {
        try { value = source(); } catch { value = null; }
    }
    const own = isRecord(value) ? value : {};
    const whole = (raw, min, max, fallback) => {
        const n = Number(raw);
        return isInt(n) ? Math.min(max, Math.max(min, n)) : fallback;
    };
    const full = whole(own.digestDays, 1, FULL_MAX, DIGEST_DEFAULTS.digestDays);
    const keep = Math.max(full, whole(own.digestKeep, 1, KEEP_MAX, DIGEST_DEFAULTS.digestKeep));
    const hours = Number(own.recapHours);
    return {
        full,
        keep,
        tail: typeof own.digestTail === 'boolean' ? own.digestTail : DIGEST_DEFAULTS.digestTail,
        // The time part's While away threshold (read through `settings.reads`): a jump this long is a skip.
        skipMinutes: (isInt(hours) && hours >= 1 ? hours : 6) * 60,
    };
}

// ---- which day each receipt belongs to --------------------------------------------------------


/**
 * The receipts (`[{ index, receipt }]` in chat order, as `tools.receipts()` gives them) by story
 * day (only those after revision `after` when given, with the clock at `minutes` before them): `{ days: Map(day → [receipt]), revs: Map(rev → day), settle: { from, to } | null }`.
 * `settle` is the last time settle's jump (the time part's receipt: the clock before and after it).
 */
export function walkDays(entries, { after = null, minutes: start = null } = {}) {
    const list = (Array.isArray(entries) ? entries : []).map(receiptOf).filter(Boolean)
        .filter(receipt => after === null || (isInt(receipt.rev) && receipt.rev > after));
    const days = new Map();
    const revs = new Map();
    let minutes = isInt(start) ? start : null;
    let waiting = [];
    let settle = null;
    const put = (day, receipt) => {
        if (!days.has(day)) days.set(day, []);
        days.get(day).push(receipt);
        if (isInt(receipt.rev)) revs.set(receipt.rev, day);
    };
    for (const receipt of list) {
        if (clockSet(receipt)) {
            minutes = receipt.data.minutes;
            if (receipt.type === SETTLE) settle = { from: isInt(receipt.data.from) ? receipt.data.from : null, to: minutes };
        }
        if (minutes === null) {
            waiting.push(receipt);
            continue;
        }
        const day = dayOf(minutes);
        // What came before the clock was first set belongs to its first day.
        if (waiting.length) {
            for (const early of waiting) put(day, early);
            waiting = [];
        }
        put(day, receipt);
    }
    return { days, revs, settle, minutes };
}

/** A thread's kept history, oldest first: `[{ rev, text }]` (the last QUEST_LOG_KEPT). */
export function questLogOf(chronicle, id) {
    if (typeof id !== 'string' || !id) return [];
    return Object.entries(isRecord(chronicle?.questLog) ? chronicle.questLog : {})
        .filter(([key, entry]) => /^\d+$/.test(key) && isRecord(entry) && entry.thread === id)
        .map(([key, entry]) => ({ rev: Number(key), text: entry.text }))
        .sort((a, b) => a.rev - b.rev)
        .slice(-QUEST_LOG_KEPT);
}

/** `chronicle.noted` (where the notes got to), or null. */
export const notedOf = chronicle => slotValue(chronicle?.noted);

/** The day-facts entries kept, by day: `Map(day → [{ key, entry }])`, each day's in revision order. */
export function entriesByDay(chronicle) {
    const out = new Map();
    for (const [key, entry] of Object.entries(isRecord(chronicle?.dayFacts) ? chronicle.dayFacts : {})) {
        const match = ENTRY_KEY.exec(key);
        if (!match || !isRecord(entry) || entry.day !== Number(match[1])) continue;
        if (!out.has(entry.day)) out.set(entry.day, []);
        out.get(entry.day).push({ key, rev: Number(match[2]), entry });
    }
    for (const list of out.values()) list.sort((a, b) => a.rev - b.rev);
    return out;
}

/** `dayOfRev(rev)`: the day whose entries' revision ranges hold `rev`, else null. */
export function rangeDays(byDay) {
    const ranges = [];
    for (const [day, list] of byDay) for (const { entry } of list) if (entry.revs.length === 2) ranges.push([entry.revs[0], entry.revs[1], day]);
    return rev => ranges.find(([lo, hi]) => rev >= lo && rev <= hi)?.[2] ?? null;
}
