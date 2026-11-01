// Story Director v2, part **keypeople**: the `keypeople` domain's shape, its validator and the pure helpers every
// other file of the part reads it with. Pure.
//
// keypeople = {
//   pins:  { [key]: { name, since, rev, aliases?, nsd?, npc? } },    // the key list: who is pinned (since: the story minute, or null; nsd: NPC State Delta knows them; npc: their np_ identity there)
//   away:  { [key]: { name, doing, since, back, steps: [{ date, text }], rev } }, // each pinned person who is away
//   gone:  { [key]: { name, reason, on, rev } },               // who was taken off the list and why (the newest MAX_GONE)
//   notes: { [id]: { sid, kind, name, head, rest, lead, rev } }, // what a reply changed (returned, no longer key), for its card
// }
// `key` is `lineKey(name)` (changes.js). Every thing is added whole under its key and one that goes is removed, so a
// reply deleted in the middle never breaks the replies after it (SPEC §2.2; slot.js says why). Times are the story
// clock in minutes, or null while it is not set. `back` is the day the person is due back (the day's start), or null.
// Nothing here reads a setting: the cap and the token budget are the writers' and the tail's (capture.js, note.js).

import { lineKey } from '../../changes.js';

export const FEATURE = 'story-director.key-people';

/** Defaults of the two settings (USER, 1 Nov): at most 10 key people; 300 tokens of away news per reply, no upper limit. */
export const DEFAULT_CAP = 10;
export const DEFAULT_TOKENS = 300;
/** The largest cap the setting takes; and the most pins, away records or notes any state may hold. */
export const MAX_CAP = 100;
export const MAX_STORED = 200;

export const MAX_NAME = 80;
export const MAX_DOING = 160;
export const MAX_STEP = 140;
export const MAX_STEPS = 12;
export const MAX_ALIASES = 6;
/** Taken-off entries kept (the newest). */
export const MAX_GONE = 30;
/** Replies whose notes are kept for their cards (the newest). */
export const MAX_NOTE_REPLIES = 6;

/** Why someone left the list: the story recorded a death, NPC State Delta archived them, or the reader unpinned them. */
export const REASONS = Object.freeze(['died', 'archived', 'unpinned']);
export const NOTE_KINDS = Object.freeze(['back', 'gone']);

export const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const isInt = value => Number.isSafeInteger(value);

/** The identity of a name (`lineKey`): lower case, punctuation squashed. '' for a name with no letters or digits. */
export const keyOf = name => lineKey(String(name ?? ''));

/** Text as one plain line: control and format characters out, spaces made one. */
export const flat = value => (typeof value === 'string' || typeof value === 'number' ? String(value) : '')
    .replace(/[\p{Cc}\p{Cf}]+/gu, ' ').replace(/\s+/g, ' ').trim();

/** `value` flattened and cut to `max` code points (never inside a character), with an ellipsis when it was longer. */
export function cutPoints(value, max) {
    const chars = Array.from(flat(value));
    return chars.length <= max ? chars.join('') : `${chars.slice(0, Math.max(0, max - 1)).join('').trimEnd()}…`;
}

/** A name as it is kept: flat, cut to MAX_NAME code points. */
export const cleanName = value => cutPoints(value, MAX_NAME);

export function initialKeyPeople() {
    return { pins: {}, away: {}, gone: {}, notes: {} };
}

/** The slice with every table there (an older or empty one reads as empty). */
export function tables(slice) {
    const own = isRecord(slice) ? slice : {};
    return {
        pins: isRecord(own.pins) ? own.pins : {},
        away: isRecord(own.away) ? own.away : {},
        gone: isRecord(own.gone) ? own.gone : {},
        notes: isRecord(own.notes) ? own.notes : {},
    };
}

/** The names a pin goes by: its own and its aliases, as keys. */
export const keysOfPin = pin => [keyOf(pin?.name), ...(Array.isArray(pin?.aliases) ? pin.aliases.map(keyOf) : [])].filter(Boolean);

/**
 * The pinned person `name` (or any of `names`) is: `{ key, pin }`, found by their key or by an alias, or null.
 * Exact, never guessed: "Ren" is not "Renata".
 */
export function findPin(slice, ...names) {
    const wanted = names.flat().map(keyOf).filter(Boolean);
    if (!wanted.length) return null;
    const { pins } = tables(slice);
    for (const key of wanted) if (Object.hasOwn(pins, key)) return { key, pin: pins[key] };
    for (const [key, pin] of Object.entries(pins)) if (keysOfPin(pin).some(own => wanted.includes(own))) return { key, pin };
    return null;
}

/** The away record of a pinned person (found by key), or null. */
export const awayOf = (slice, key) => {
    const { away } = tables(slice);
    return Object.hasOwn(away, key) && isRecord(away[key]) ? away[key] : null;
};

// ---- the validator (SPEC §2.5) -------------------------------------------------------------------------------------------

const textOk = (value, max) => typeof value === 'string' && Array.from(value).length <= max;
const timeOk = value => value === null || isInt(value);

function pinProblems(key, pin) {
    const at = `keypeople.pins.${key}`;
    if (!isRecord(pin) || !textOk(pin.name, MAX_NAME) || !keyOf(pin.name) || keyOf(pin.name) !== key || !timeOk(pin.since) || !isInt(pin.rev)) return [`${at} is not { name, since, rev }.`];
    if (pin.nsd !== undefined && typeof pin.nsd !== 'boolean') return [`${at}.nsd is true or false.`];
    if (pin.npc !== undefined && !/^np_[0-9a-z]{8}$/.test(pin.npc)) return [`${at}.npc is an NPC identity like np_k3f9a2qz.`];
    if (pin.aliases !== undefined && (!Array.isArray(pin.aliases) || pin.aliases.length > MAX_ALIASES || pin.aliases.some(alias => !textOk(alias, MAX_NAME)))) return [`${at}.aliases is a list of at most ${MAX_ALIASES} names.`];
    return [];
}

function awayProblems(key, away) {
    const at = `keypeople.away.${key}`;
    if (!isRecord(away) || !textOk(away.name, MAX_NAME) || keyOf(away.name) !== key || !textOk(away.doing, MAX_DOING) || !timeOk(away.since) || !timeOk(away.back) || !isInt(away.rev)) return [`${at} is not { name, doing, since, back, steps, rev }.`];
    if (!Array.isArray(away.steps) || away.steps.length > MAX_STEPS || away.steps.some(step => !isRecord(step) || !timeOk(step.date) || !textOk(step.text, MAX_STEP))) return [`${at}.steps is a list of at most ${MAX_STEPS} { date, text }.`];
    return [];
}

function goneProblems(key, gone) {
    const at = `keypeople.gone.${key}`;
    if (!isRecord(gone) || !textOk(gone.name, MAX_NAME) || keyOf(gone.name) !== key || !REASONS.includes(gone.reason) || !timeOk(gone.on) || !isInt(gone.rev)) return [`${at} is not { name, reason, on, rev }.`];
    return [];
}

function noteProblems(id, note) {
    const at = `keypeople.notes.${id}`;
    if (!isRecord(note) || !(note.sid === null || typeof note.sid === 'string') || !NOTE_KINDS.includes(note.kind) || !textOk(note.name, MAX_NAME)
        || !textOk(note.head, 200) || !textOk(note.rest, 300) || typeof note.lead !== 'boolean' || !isInt(note.rev)) return [`${at} is not { sid, kind, name, head, rest, lead, rev }.`];
    return [];
}

/** The validator: [] or sentences. */
export function validateKeyPeople(slice) {
    if (!isRecord(slice) || !['pins', 'away', 'gone', 'notes'].every(name => isRecord(slice[name]))) return ['keypeople is not { pins, away, gone, notes }.'];
    const errors = [];
    for (const [name, check] of [['pins', pinProblems], ['away', awayProblems], ['gone', goneProblems], ['notes', noteProblems]]) {
        const keys = Object.keys(slice[name]);
        if (keys.length > MAX_STORED) errors.push(`keypeople.${name} holds more than ${MAX_STORED} entries.`);
        for (const key of keys) errors.push(...check(key, slice[name][key]));
    }
    for (const key of Object.keys(slice)) if (!['pins', 'away', 'gone', 'notes'].includes(key)) errors.push(`keypeople has an unknown field "${key}".`);
    return errors.slice(0, 10);
}
