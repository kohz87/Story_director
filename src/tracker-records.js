// Story Director: the tracker's record shape (pure).
//
// Empty tracker, blank fields, copy-on-write helpers, record building and the shared constants
// applyOps uses. Moved out of tracker.js; tracker.js re-exports its public name.

import { FIELDS, formatOp, kindOf, lineKey } from './changes.js';

const HISTORY_LIMIT = 20;
export const SUPERSEDED = /supersed|replac|merged/i;
// A step that has not started is not the story moving a job on.
export const NOT_STARTED = /^\s*(?:0\s*(?:\/|of)\s*\d+|0|none|not (?:yet )?started|pending|unstarted)\b/i;
// A `~` on a key that is not tracked, with something to say, becomes a record of this kind.
const UNTRACKED_KIND = 'hook';
// (0.9.14) Keys that only label a line, a block or a kind ("! Encounter — the wolves attack",
// "~ Quest — …"): they name no record, so a line under one is skipped quietly instead of being
// a warning, and the next note never asks the model to add them.
const LABEL_KEYS = new Set(['encounter', 'encounters', 'fight', 'combat', 'battle', 'scene', 'director', 'world state', 'note', 'notes', 'summary', 'status', 'update', 'updates', 'change', 'changes', 'event', 'events', 'record', 'records']);
export const isLabelKey = id => LABEL_KEYS.has(id) || Boolean(kindOf(id));
// (0.9.19) The other names a record was reached by, newest kept: enough for a model's drift.
export const MAX_ALIASES = 8;
export function emptyTracker() {
    return { version: 1, records: [], message: -1, time: null };
}

export function blankFields() {
    return Object.fromEntries(FIELDS.map(name => [name, '']));
}

export function cloneRecord(record) {
    return {
        ...record,
        fields: { ...record.fields },
        extra: { ...record.extra },
        created: { ...record.created },
        changed: { ...record.changed },
        seen: { ...record.seen },
        resolved: record.resolved ? { ...record.resolved } : null,
        legSince: record.legSince ? { ...record.legSince } : null,
        // (0.9.19) A tracker saved before aliases has none.
        aliases: [...(record.aliases ?? [])],
        // History entries are never edited, only appended, so they can be shared.
        history: [...record.history],
    };
}

export function finding(kind, severity, op, message, extra = {}) {
    return { kind, severity, key: op.key ?? null, message, ...extra };
}

// Whether an op has anything to write: a field, or a part, with a value.
export function hasContent(op) {
    return [...Object.values(op.fields ?? {}), ...Object.values(op.extra ?? {})].some(value => String(value ?? '').trim());
}

// The record a `~` on a key that is not tracked becomes: a hook, unless its `type:` names a
// kind (`type: clock`; a quest category such as `type: bounty` makes a quest of that type).
export function untrackedRecordOp(op, id) {
    const word = lineKey(op.fields?.type ?? '');
    const named = kindOf(word);
    const fields = { ...op.fields };
    // The type was the kind; only a quest's own category (bounty, contract…) stays its type.
    if (named && (named !== 'quest' || word === 'quest' || word === 'quests')) delete fields.type;
    // A job by its parts (0.9.4): who it is for or what it pays.
    const job = !named && ['giver', 'reward'].some(name => String(fields[name] ?? '').trim());
    return { ...op, id, kind: named || (job ? 'quest' : UNTRACKED_KIND), fields };
}

export function withArticle(word) {
    return `${/^[aeiou]/.test(word) ? 'an' : 'a'} ${word}`;
}

// Records whose leg changed in the op being applied; `touch` stamps when the leg was set, so
// an arrival can be checked against the pace from that moment (a copied leg keeps its time).
const legChanged = new WeakSet();

export function applyFields(record, op) {
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
export function touch(record, op, at) {
    if (legChanged.has(record)) {
        legChanged.delete(record);
        record.legSince = record.fields.leg ? { ...at } : null;
    } else if (!record.fields.leg) {
        record.legSince = null;
    }
    record.changed = { ...at };
    record.seen = { ...at };
    const text = op.raw || formatOp(op);
    // (0.9.30) With its time, so the Journal can date it once the message is behind a checkpoint.
    record.history = [...record.history, { message: at.message, op: op.op, text, time: at.time ?? null }].slice(-HISTORY_LIMIT);
}

export function newRecord(op, at) {
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
        aliases: [],
        history: [],
    };
    applyFields(record, op);
    touch(record, op, at);
    return record;
}

// (0.9.19) The names records were once reached by (their aliases), each to its record's
// index: a name that is a record's own id is that record's, and a name two records hold
// belongs to the first in tracker order, so a replay always reads it the same way.
export function aliasIndexOf(records, indexById) {
    const index = new Map();
    records.forEach((record, at) => {
        for (const alias of record.aliases ?? []) {
            if (!indexById.has(alias) && !index.has(alias)) index.set(alias, at);
        }
    });
    return index;
}
