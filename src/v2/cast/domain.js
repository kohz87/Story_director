// Story Director v2, part **cast** (the living cast): the `cast` domain's shape, its validator and the pure helpers every
// other file of the part reads it with. Pure.
//
// cast = {
//   people: { [key]: person },          // key = `<pack>:<id>` (the pack's id and the entry's id)
//   notes:  { [id]: note },             // what a reply told its card (met someone, the cast moved on, the pack was updated); `at`: the message the card is under
//   day:     null | [{ at, rev }],      // a slot: the story minute the cast was last moved to (the planner's last batch)
//   meeting: null | [{ at, keys, rev }],// a slot: who comes into the scene in the reply being written (`at`: the chat's length)
// }
// person = { pack, eid (the entry's id; a field called `id` must be an ID like it_k3f9a2qz), name, aliases?, ver, joined, where, doing, since, alive, met, heard, rev }
//   ver:    the pack version of the entry as last seen (a string; '' when the pack gives none)
//   sig:    a short fingerprint of the entry's content (not its version), so an update is told apart from a version bump ('' when unknown)
//   joined: the story minute they joined the world (null while the clock is not set)
//   where / doing: where they are and what they do now (off-screen, kept by the planner's batches)
//   met:    null while unmet, else { on, where, why: 'place' | 'goal', reason, rev } (a meeting is recorded on the reply)
//   heard:  the last news of a met person: null | [{ on, text }] (a slot: written whole each time)
// The pack entry itself (look, voice, history, secrets...) is never copied here: it is read from the pack when needed,
// and only for a person who has been met. Nothing stored here is read by a reader before the person is met.
//
// Replay-safe like every domain: a person is added whole under its key; a change inside a person is marked `ctx.ifThere`
// (passed over when the reply that made the person was deleted); a note is a new key each time and never changed; the two
// slots are written whole (../slot.js).

import { lineKey } from '../../changes.js';

export const FEATURE = 'story-director.cast';

export const DAY = 1440;
/** The most people the world holds (all packs), and the most any table of the state holds. */
export const MAX_PEOPLE = 64;
export const MAX_STORED = 200;
export const MAX_NAME = 80;
export const MAX_PLACE = 80;
export const MAX_DOING = 120;
export const MAX_REASON = 240;
export const MAX_ALIASES = 6;
export const MAX_KEY = 160;
/** Replies whose notes are kept for their cards (the newest). */
export const MAX_NOTE_REPLIES = 6;
export const NOTE_KINDS = Object.freeze(['met', 'moved', 'updated']);
export const WHYS = Object.freeze(['place', 'goal', 'story']);

/** The settings' defaults. `faces`: how many new faces may cross the party's path (day1, day2, week1). */
export const FACES = Object.freeze({ day1: { label: '1 a day', count: 1, days: 1 }, day2: { label: '2 a day', count: 2, days: 1 }, week1: { label: '1 a week', count: 1, days: 7 } });
export const DEFAULT_FACES = 'day1';

export const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const isInt = value => Number.isSafeInteger(value);

/** Text as one plain line: control and format characters out, spaces made one. */
export const flat = value => (typeof value === 'string' || typeof value === 'number' ? String(value) : '')
    .replace(/[\p{Cc}\p{Cf}]+/gu, ' ').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();

/** `value` flattened and cut to `max` code points (never inside a character), with an ellipsis when it was longer. */
export function cutPoints(value, max) {
    const chars = Array.from(flat(value));
    return chars.length <= max ? chars.join('') : `${chars.slice(0, Math.max(0, max - 1)).join('').trimEnd()}…`;
}

/** `value` flattened and cut to `max` code points at a word boundary, with an ellipsis when it was longer. */
export function cutWords(value, max) {
    const chars = Array.from(flat(value));
    if (chars.length <= max) return chars.join('');
    const head = chars.slice(0, Math.max(0, max - 1)).join('');
    const space = head.lastIndexOf(' ');
    // At a space when one is past a third of the way; else the cut is where it is (a long word, no spaces).
    return `${(space >= head.length / 3 ? head.slice(0, space) : head).trimEnd().replace(/[,;:\-–—]+$/, '')}…`;
}

/** The identity of a name (`lineKey`): lower case, punctuation squashed. '' for a name with no letters or digits. */
export const keyOf = name => lineKey(String(name ?? ''));

/** The key of a person: `<pack>:<id>`. */
export const personKey = (pack, id) => `${pack}:${id}`;

export function initialCast() {
    return { people: {}, notes: {}, day: null, meeting: null };
}

/** The slice with every table there (an older or empty one reads as empty). */
export function tables(slice) {
    const own = isRecord(slice) ? slice : {};
    return {
        people: isRecord(own.people) ? own.people : {},
        notes: isRecord(own.notes) ? own.notes : {},
    };
}

/** The value in a slot (a one-entry list, or a bare object), or null. */
export const slotOf = stored => {
    if (Array.isArray(stored)) return isRecord(stored[0]) ? stored[0] : null;
    return isRecord(stored) ? stored : null;
};

/** The story minute the cast was last moved to, or null. */
export const dayAt = slice => {
    const value = slotOf(slice?.day);
    return value && isInt(value.at) ? value.at : null;
};

/** The people in key order, each `{ key, ...person }`. */
export function peopleOf(slice) {
    const { people } = tables(slice);
    return Object.keys(people).sort().filter(key => isRecord(people[key])).map(key => ({ key, ...people[key] }));
}

export const isMet = person => isRecord(person?.met);
/** Alive and in the world (a dead person is neither moved nor met). */
export const isAlive = person => person?.alive !== false;

/** How many people there are, and how many have been met (the dead count in the total: they were in the world). */
export function counts(slice) {
    const all = peopleOf(slice);
    return { total: all.length, met: all.filter(isMet).length };
}

/** The names a person goes by, as keys: their own and their aliases. */
export const keysOfPerson = person => [keyOf(person?.name), ...(Array.isArray(person?.aliases) ? person.aliases.map(keyOf) : [])].filter(Boolean);

// ---- time ------------------------------------------------------------------------------------------------------------

/** The story day a minute falls on. */
export const dayOf = minutes => Math.floor(minutes / DAY);

/** The part of the day a minute falls in, in words ('night', 'dawn', 'morning', 'midday', 'afternoon', 'evening'). */
export function timeOfDay(minutes) {
    if (!isInt(minutes)) return '';
    const hour = Math.floor((((minutes % DAY) + DAY) % DAY) / 60);
    if (hour < 5 || hour >= 22) return 'night';
    if (hour < 8) return 'dawn';
    if (hour < 12) return 'morning';
    if (hour < 14) return 'midday';
    if (hour < 17) return 'afternoon';
    return 'evening';
}

// ---- the validator (SPEC §2.5) -------------------------------------------------------------------------------------------

const textOk = (value, max) => typeof value === 'string' && Array.from(value).length <= max;
const timeOk = value => value === null || isInt(value);

function personProblems(key, person) {
    const at = `cast.people.${key}`;
    if (!isRecord(person) || !textOk(person.pack, MAX_NAME) || !textOk(person.eid, MAX_NAME) || personKey(person.pack, person.eid) !== key || !textOk(person.name, MAX_NAME) || !keyOf(person.name)
        || !textOk(person.ver, MAX_NAME) || !(person.sig === undefined || textOk(person.sig, 24)) || !timeOk(person.joined) || !textOk(person.where, MAX_PLACE) || !textOk(person.doing, MAX_DOING) || !timeOk(person.since)
        || typeof person.alive !== 'boolean' || !isInt(person.rev)) return [`${at} is not { pack, eid, name, ver, joined, where, doing, since, alive, met, heard, rev }.`];
    if (person.aliases !== undefined && (!Array.isArray(person.aliases) || person.aliases.length > MAX_ALIASES || person.aliases.some(alias => !textOk(alias, MAX_NAME)))) return [`${at}.aliases is a list of at most ${MAX_ALIASES} names.`];
    const { met, heard } = person;
    if (met !== null && !(isRecord(met) && timeOk(met.on) && textOk(met.where, MAX_PLACE) && WHYS.includes(met.why) && textOk(met.reason, MAX_REASON) && isInt(met.rev))) return [`${at}.met is null or { on, where, why, reason, rev }.`];
    const news = slotOf(heard);
    if (heard !== null && !(news && Array.isArray(heard) && timeOk(news.on) && textOk(news.text, MAX_DOING))) return [`${at}.heard is null or [{ on, text }].`];
    return [];
}

function noteProblems(id, note) {
    const at = `cast.notes.${id}`;
    if (!isRecord(note) || !isInt(note.at) || note.at < 0 || !NOTE_KINDS.includes(note.kind) || !textOk(note.head, 200) || !textOk(note.tag, 120)
        || !textOk(note.rest, 600) || !textOk(note.line, 200) || !isInt(note.rev)) return [`${at} is not { at, kind, head, tag, rest, line, rev }.`];
    return [];
}

/** The validator: [] or sentences. */
export function validateCast(slice) {
    if (!isRecord(slice) || !isRecord(slice.people) || !isRecord(slice.notes)) return ['cast is not { people, notes, day, meeting }.'];
    const errors = [];
    for (const [name, check] of [['people', personProblems], ['notes', noteProblems]]) {
        const keys = Object.keys(slice[name]);
        if (keys.length > MAX_STORED) errors.push(`cast.${name} holds more than ${MAX_STORED} entries.`);
        for (const key of keys) errors.push(...check(key, slice[name][key]));
    }
    const day = slotOf(slice.day);
    if (slice.day !== null && slice.day !== undefined && !(day && isInt(day.at) && isInt(day.rev))) errors.push('cast.day is null or [{ at, rev }].');
    const meeting = slotOf(slice.meeting);
    if (slice.meeting !== null && slice.meeting !== undefined && !(meeting && isInt(meeting.at) && isInt(meeting.rev) && Array.isArray(meeting.keys) && meeting.keys.length <= 4 && meeting.keys.every(key => typeof key === 'string' && key.length <= MAX_KEY))) {
        errors.push('cast.meeting is null or [{ at, keys, rev }].');
    }
    for (const key of Object.keys(slice)) if (!['people', 'notes', 'day', 'meeting'].includes(key)) errors.push(`cast has an unknown field "${key}".`);
    return errors.slice(0, 10);
}
