// The tracker: agendas, events, hooks, clocks, beats and secrets, built only from change
// lines. Because every change lives in the reply that made it, the tracker for any point in
// the chat is a replay of the entries up to it. Pure: every function returns new objects and
// never mutates its inputs (records are copied on write, unchanged ones are shared).

import { FIELDS, formatOp, lineKey, questDifficulty } from './changes.js';

const HISTORY_LIMIT = 20;
const SUPERSEDED = /supersed|replac|merged/i;
// A quest closed with one of these was not done: it ended without the work being finished.
const FAILED = /\b(?:fail|abandon|gave up|give up|given up|forfeit|expired|missed|too late|cancel|refused|declined|botched)/i;
const MIN_PERSON_LENGTH = 3;

export function emptyTracker() {
    return { version: 1, records: [], message: -1, time: null };
}

function blankFields() {
    return Object.fromEntries(FIELDS.map(name => [name, '']));
}

function cloneRecord(record) {
    return {
        ...record,
        fields: { ...record.fields },
        extra: { ...record.extra },
        created: { ...record.created },
        changed: { ...record.changed },
        seen: { ...record.seen },
        resolved: record.resolved ? { ...record.resolved } : null,
        legSince: record.legSince ? { ...record.legSince } : null,
        // History entries are never edited, only appended, so they can be shared.
        history: [...record.history],
    };
}

function finding(kind, severity, op, message) {
    return { kind, severity, key: op.key ?? null, message };
}

// Records whose leg changed in the op being applied; `touch` stamps when the leg was set, so
// an arrival can be checked against the pace from that moment (a copied leg keeps its time).
const legChanged = new WeakSet();

function applyFields(record, op) {
    const legBefore = record.fields.leg;
    for (const [name, value] of Object.entries(op.fields ?? {})) {
        if (FIELDS.includes(name)) record.fields[name] = String(value ?? '');
    }
    for (const [label, value] of Object.entries(op.extra ?? {})) {
        // The arc a planned record belongs to is identity, not a part to show.
        if (label === 'arc') record.arc = String(value ?? '') || null;
        else record.extra[label] = String(value ?? '');
    }
    if (record.fields.leg !== legBefore) legChanged.add(record);
}

// Every applied op counts as the record being seen, and leaves a trace of the line itself.
function touch(record, op, at) {
    if (legChanged.has(record)) {
        legChanged.delete(record);
        record.legSince = record.fields.leg ? { ...at } : null;
    } else if (!record.fields.leg) {
        record.legSince = null;
    }
    record.changed = { ...at };
    record.seen = { ...at };
    const text = op.raw || formatOp(op);
    record.history = [...record.history, { message: at.message, op: op.op, text }].slice(-HISTORY_LIMIT);
}

function newRecord(op, at) {
    const record = {
        key: op.key,
        id: op.id || lineKey(op.key),
        // parseChanges always infers a kind for `+`; this covers hand-built ops.
        kind: op.kind || 'event',
        status: 'active',
        fields: blankFields(),
        extra: {},
        created: { ...at },
        changed: { ...at },
        seen: { ...at },
        resolved: null,
        legSince: null,
        pinned: false,
        arc: null,
        history: [],
    };
    applyFields(record, op);
    touch(record, op, at);
    return record;
}

/**
 * Applies ops for one reply. Unknown keys are reported, never invented.
 * Returns `{ tracker, problems }`; `tracker.message`/`time` move to this reply.
 */
export function applyOps(tracker, ops, { message, time = null } = {}) {
    const records = [...tracker.records];
    const indexById = new Map(records.map((record, index) => [record.id, index]));
    const copied = new Set();
    const problems = [];
    const at = { message, time };

    // Copy a record the first time this call changes it, so the input stays untouched.
    const edit = index => {
        if (!copied.has(index)) {
            records[index] = cloneRecord(records[index]);
            copied.add(index);
        }
        return records[index];
    };

    for (const op of ops ?? []) {
        const id = op.id || lineKey(op.key);
        if (!id) continue;
        const index = indexById.get(id);

        if (op.op === '+') {
            // One arc at a time: a new arc closes the one before it.
            if ((op.kind === 'arc') && (index === undefined || records[index].status !== 'active')) {
                records.forEach((other, otherIndex) => {
                    if (other.kind !== 'arc' || other.status !== 'active' || otherIndex === index) return;
                    const closed = edit(otherIndex);
                    closed.status = 'superseded';
                    closed.resolved = { ...at, reason: 'a new arc began' };
                    touch(closed, { ...op, op: '-', raw: `- ${closed.key} — a new arc began` }, at);
                });
            }
            if (index === undefined) {
                indexById.set(id, records.length);
                copied.add(records.length);
                records.push(newRecord({ ...op, id }, at));
                continue;
            }
            const record = edit(index);
            if (record.status === 'active') {
                problems.push(finding('duplicate-add', 'info', op,
                    `"${op.key}" is already tracked; the + was applied as a change.`));
                applyFields(record, op);
            } else {
                problems.push(finding('reopened', 'info', op,
                    `"${op.key}" was ${record.status}; it is active again.`));
                // A reopened record is described afresh, so stale dates from before it was
                // closed cannot make it due at once. Identity, history and pin are kept.
                record.kind = op.kind || record.kind;
                record.status = 'active';
                record.resolved = null;
                record.fields = blankFields();
                record.extra = {};
                applyFields(record, op);
            }
            touch(record, op, at);
            continue;
        }

        if (index === undefined) {
            // A `-` of something never tracked does no harm, so it is only worth a note.
            const severity = op.op === '-' ? 'info' : 'warn';
            problems.push(finding('unknown-key', severity, op,
                `"${op.key}" is not tracked; the ${op.op} line was ignored.`));
            continue;
        }

        const record = edit(index);
        if (op.op === '~') {
            applyFields(record, op);
        } else if (op.op === '-') {
            applyFields(record, op);
            record.status = SUPERSEDED.test(op.reason ?? '') ? 'superseded' : 'resolved';
            record.resolved = { ...at, reason: op.reason ?? '' };
        } else if (op.op === '!') {
            const given = Object.keys(op.fields ?? {}).length > 0;
            applyFields(record, op);
            if (!given) {
                // What was next has happened. With no `then`, `now` is still the best we know.
                if (record.fields.then) record.fields.now = record.fields.then;
                record.fields.then = '';
                record.fields.on = '';
            }
            if (record.kind === 'clock') {
                record.status = 'resolved';
                record.resolved = { ...at, reason: 'fired' };
            }
        } else {
            continue;
        }
        touch(record, op, at);
    }

    return {
        tracker: { ...tracker, records, message: message ?? tracker.message, time: time ?? tracker.time },
        problems,
    };
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeQuotes(text) {
    return text.replace(/[’‘]/g, '\'');
}

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
        if (entry.ops?.length) {
            const result = applyOps(tracker, entry.ops, at);
            tracker = result.tracker;
            for (const problem of result.problems) {
                problems.push({ ...problem, text: problem.message, message: entry.message });
            }
        }
        tracker = { ...tracker, message: entry.message, time };
    }
    return { tracker, problems };
}

/** The record with this key or id (markdown and punctuation ignored), or null. */
export function findRecord(tracker, keyOrId) {
    const id = lineKey(keyOrId);
    if (!id) return null;
    return tracker.records.find(record => record.id === id) ?? null;
}

export function activeRecords(tracker, { kind = null } = {}) {
    return tracker.records.filter(record => record.status === 'active' && (!kind || record.kind === kind));
}

/**
 * The quests finished in the reply at `message`: closed there with a `-` line that is not a
 * failure (failed, abandoned, expired…) or a supersession, as `[{ id, name, type, difficulty,
 * reward, giver }]` plain copies; quests finished earlier are not listed.
 */
export function questsDoneIn(tracker, message) {
    const at = Number(message);
    if (!Number.isInteger(at)) return [];
    const text = value => String(value ?? '').trim();
    return (tracker?.records ?? [])
        .filter(record => record.kind === 'quest' && record.status === 'resolved'
            && record.resolved?.message === at && !FAILED.test(record.resolved?.reason ?? ''))
        .map(record => ({
            id: record.id,
            name: record.key,
            type: text(record.fields?.type),
            difficulty: questDifficulty(record.fields?.difficulty),
            reward: text(record.fields?.reward),
            giver: text(record.fields?.giver),
        }));
}
