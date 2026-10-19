// (0.9.19) The Journal: what {{user}}'s character saw or heard, for a reader coming back to a
// chat after a break. Unlike the Director tab nothing here may be behind the scenes, so it is
// built from what the story already told, never from what is planned:
//
// - Beats, events, hooks and clocks by their `!` lines (it happened), each with the line's
//   own words (its reason), never a field: a `then:` or `on:` on a `!` is still a plan.
// - Events and hooks by how they were closed, and by a sign the story showed (`shown:`). A
//   beat's close only once it fired (closing one that never happened drops a plan the reader
//   never saw); a clock only by firing (its `-` is the same dropped plan, its `shown:` would
//   name the consequence still to come).
// - Quests taken on, done, failed or abandoned, and their `!` lines once taken on. Jobs only
//   offered, or turned down, stay out: the Quests tab keeps those.
// - Places, on the day of the first visit.
// - Never agendas (their now/then/leg are an NPC's private plans, and a `!` on one is what
//   the NPC did off-screen), secrets or arcs.
//
// Pure: plain data in, plain data out, no DOM and no globals.

import { parseChanges } from './changes.js';
import { isOffer, questOutcome } from './tracker.js';

// Kinds the story can show happening; the rest is behind the scenes.
const STORY_KINDS = new Set(['beat', 'event', 'hook', 'clock']);
// Kinds whose `-` without a `!` before it is a plan dropped, not something that happened.
const PLANNED_KINDS = new Set(['beat', 'clock']);
// Kinds whose `shown:` is a sign the reader saw. A clock's sign stays out (see above).
const SIGN_KINDS = new Set(['event', 'hook']);
const NO_SIGN = /^\s*(?:none|no|hidden|not yet|-)?\s*$/i;
// A sign written as only the word says nothing beyond "a sign was shown".
const BARE_SIGN = /^\s*(?:a\s+)?(?:sign|signs|warning|warnings)\s*$/i;
// Within one reply: where {{user}} went, what happened, then the work it touched.
const TYPE_RANK = { place: 0, event: 1, quest: 2 };
const QUEST_ENDINGS = new Set(['done', 'failed', 'abandoned']);

const text = value => String(value ?? '').trim();
const finite = value => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const isMessage = value => Number.isInteger(value) && value >= 0;

// The words of a history line: the `!` or `-` line's reason, never its fields.
function reasonOf(entry) {
    const op = parseChanges(entry?.text ?? '').ops[0];
    return text(op?.reason);
}

function fieldsOf(entry) {
    return parseChanges(entry?.text ?? '').ops[0]?.fields ?? {};
}

// A job (a giver, a reward, a quest type) on a hook or event, offered or turned down.
const isJob = record => isOffer({ ...record, status: 'active' });

/** The latest tracker in `trackers` (per message, chat order; holes allowed). */
function latest(trackers) {
    for (let index = trackers.length - 1; index >= 0; index--) if (trackers[index]) return trackers[index];
    return null;
}

/**
 * The message at which each quest was taken on and the record as it was then: the first
 * tracker in which it is a quest. A hook offered earlier becomes a quest only when taken on.
 */
function questsTakenOn(trackers) {
    const taken = new Map();
    let previous = null;
    trackers.forEach((tracker, message) => {
        const records = tracker?.records;
        if (!records || records === previous) return;
        previous = records;
        for (const record of records) {
            if (record.kind === 'quest' && !taken.has(record.id)) taken.set(record.id, { message, record });
        }
    });
    return taken;
}

function eventItems(record, push) {
    const fired = (record.history ?? []).filter(entry => entry.op === '!' && isMessage(entry.message));
    for (const entry of fired) push({ type: 'event', how: 'fired', kind: record.kind, key: record.key, text: reasonOf(entry), message: entry.message });

    if (SIGN_KINDS.has(record.kind)) {
        // The first line that set a sign is when the reader saw it.
        const sign = (record.history ?? []).find(entry => isMessage(entry.message) && !NO_SIGN.test(text(fieldsOf(entry).shown)));
        if (sign) {
            const shown = text(fieldsOf(sign).shown);
            push({ type: 'event', how: 'sign', kind: record.kind, key: record.key, text: BARE_SIGN.test(shown) ? '' : shown, message: sign.message });
        }
    }

    // Superseded (merged into another, replaced) is bookkeeping, not an ending.
    if (record.status !== 'resolved' || !isMessage(record.resolved?.message) || record.kind === 'clock') return;
    const at = record.resolved.message;
    if (PLANNED_KINDS.has(record.kind) && !fired.some(entry => entry.message <= at)) return;
    const reason = text(record.resolved.reason);
    // A `!` that also closed it already said what happened.
    if (!reason && fired.some(entry => entry.message === at)) return;
    push({ type: 'event', how: 'closed', kind: record.kind, key: record.key, text: reason, message: at, time: finite(record.resolved.time) });
}

function questItems(record, taken, push) {
    const start = taken.get(record.id) ?? { message: record.created?.message, record };
    const then = start.record ?? record;
    const goal = text(then.fields?.goal) || text(then.fields?.desc);
    const giver = text(then.fields?.giver);
    if (isMessage(start.message)) {
        push({ type: 'quest', how: 'taken', kind: 'quest', key: record.key, text: goal, giver, message: start.message });
    }
    const outcome = questOutcome(record);
    const ended = QUEST_ENDINGS.has(outcome) && isMessage(record.resolved?.message) ? record.resolved.message : null;
    // Its `!` lines once it was the reader's work; the one that ended it is the ending.
    for (const entry of record.history ?? []) {
        if (entry.op !== '!' || !isMessage(entry.message) || entry.message < (start.message ?? 0) || entry.message === ended) continue;
        push({ type: 'quest', how: 'progress', kind: 'quest', key: record.key, text: reasonOf(entry), message: entry.message });
    }
    if (ended !== null) {
        push({ type: 'quest', how: outcome, kind: 'quest', key: record.key, text: text(record.resolved.reason), message: ended, time: finite(record.resolved.time) });
    }
}

function dayOf(time, calendar) {
    if (time === null || typeof calendar?.dayIndex !== 'function') return null;
    try {
        return { key: String(calendar.dayIndex(time)), label: String(calendar.format(time, { time: false })), day: calendar.dayIndex(time) };
    } catch {
        return null;
    }
}

/**
 * The Journal from per-message trackers (`trackers[message]`, chat order, the last one the
 * tracker now), the place book's places, and the calendar (`makeCalendar`) that names days.
 * Returns `{ days: [{ key, label, day, items }], count }`, newest first; each item is
 * `{ type: 'event' | 'quest' | 'place', how, kind, key, text, message, time }` (`how`: fired,
 * closed or sign for an event; taken, progress, done, failed or abandoned for a quest; visited
 * for a place; a quest taken on also carries its `giver`). A day is the story day of the
 * tracker's time at the item's message; items before any time is known come last, in a day
 * with `key: 'undated'`.
 */
export function buildJournal({ trackers = [], places = [], calendar = null } = {}) {
    const list = Array.isArray(trackers) ? trackers : [];
    const current = latest(list);
    const items = [];
    let order = 0;
    const timeAt = (message, fallback = null) => finite(list[message]?.time) ?? finite(fallback);
    const push = item => items.push({ ...item, time: timeAt(item.message, item.time), order: order++ });

    // Places first (by the place book's own order), then records in the tracker's order.
    for (const place of Array.isArray(places) ? places : []) {
        if (!(place?.visits > 0) || !text(place.name)) continue;
        const message = isMessage(place.firstMessage) ? place.firstMessage : place.lastMessage;
        if (!isMessage(message)) continue;
        push({ type: 'place', how: 'visited', kind: 'place', key: text(place.name), text: '', message, time: finite(place.firstTime) });
    }
    const taken = questsTakenOn(list);
    for (const record of current?.records ?? []) {
        if (record.kind === 'quest') questItems(record, taken, push);
        else if (STORY_KINDS.has(record.kind) && !isJob(record)) eventItems(record, push);
    }

    items.sort((a, b) => b.message - a.message || TYPE_RANK[a.type] - TYPE_RANK[b.type] || a.order - b.order);
    const days = [];
    const byKey = new Map();
    for (const { order: _order, ...item } of items) {
        const day = dayOf(item.time, calendar) ?? { key: 'undated', label: 'Undated', day: null };
        let group = byKey.get(day.key);
        if (!group) {
            group = { ...day, items: [] };
            byKey.set(day.key, group);
            days.push(group);
        }
        group.items.push(item);
    }
    // Days in the order their newest item was written; what has no date at all goes last.
    const undated = days.findIndex(group => group.key === 'undated');
    if (undated >= 0) days.push(...days.splice(undated, 1));
    return { days, count: items.length };
}
