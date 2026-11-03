// Story Director v2, part **cast**: the three steps that write the `cast` domain. All are cause `system` (Story Director's own hook
// asks for them before a reply): the story's change lines never write the cast, and the reader has no button for it.
//
// - `cast.sync { add?, update?, drop?, updated?, init? }`: the packs' cast joined, changed or left (apply.js).
// - `cast.advance { from, to, moves?, died? }`: the planner's batch after a day change or a time skip.
// - `cast.meet { at, who: [{ key, why, reason }] }`: the party meets someone for the first time (no dice).
// - `cast.withdraw { at, keys }`: the reply did not show a person it was told to bring in, so their meeting is taken back (after the reply).
//
// Replay: a person is added whole under its key; a change inside a person is marked `ctx.ifThere` (passed over when the reply that
// made the person was deleted); a note is a new key each time, never changed after, the oldest replies' dropped. A step's summary
// and data never name or count an unmet person beyond what the reader's card says.

import { idFrom } from '../writes.js';
import { applyAdvance, applyMeet, applySync, applyWithdraw } from './apply.js';
import { MAX_DOING, MAX_KEY, MAX_NAME, MAX_NOTE_REPLIES, MAX_PEOPLE, MAX_PLACE, MAX_REASON, WHYS, cutPoints, isInt, isRecord } from './domain.js';

const revOf = ctx => (isInt(ctx?.rev) ? ctx.rev : 0);
const nowOf = ctx => {
    try {
        const minutes = typeof ctx?.time === 'function' ? ctx.time() : null;
        return isInt(minutes) ? minutes : null;
    } catch {
        return null;
    }
};

// The JSON pointer of one person, inside the domain.
const personPath = key => `/people/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`;

// One note for the reply's card: a new key each time, never changed after. A step is stored on the reply before the one it is for (the
// head when the hook runs), so a note names the message its card goes under (`at`: the chat's length when it was decided, which is the
// new reply's index), not the reply that holds the step.
function addNote(ctx, cast, at, { kind, head, tag, rest, line }) {
    const rev = revOf(ctx);
    const id = idFrom(ctx, 'cn', cast.notes);
    cast.notes[id] = { at: isInt(at) && at >= 0 ? at : 0, kind, head: cutPoints(head, 200), tag: cutPoints(tag, 120), rest: cutPoints(rest, 600), line: cutPoints(line, 200), rev };
    // The newest replies' notes only: all the notes of a reply go together, the oldest replies first.
    const places = [...new Set(Object.values(cast.notes).map(note => note.at))].sort((a, b) => a - b);
    const keep = new Set(places.slice(Math.max(0, places.length - MAX_NOTE_REPLIES)));
    for (const [other, note] of Object.entries(cast.notes)) if (!keep.has(note.at)) delete cast.notes[other];
}

const textOk = (value, max) => typeof value === 'string' && Array.from(value).length <= max;
const keyOk = value => typeof value === 'string' && value.length > 0 && value.length <= MAX_KEY;

function envOf(ctx, cast, packNames = {}, at = null) {
    return {
        now: nowOf(ctx), rev: revOf(ctx),
        touch: key => { if (typeof ctx.ifThere === 'function') ctx.ifThere('cast', personPath(key)); },
        touchNote: id => { if (typeof ctx.ifThere === 'function') ctx.ifThere('cast', `/notes/${String(id).replace(/~/g, '~0').replace(/\//g, '~1')}`); },
        note: entry => addNote(ctx, cast, at, entry),
        packName: pack => packNames[pack] || pack,
    };
}

function only(ctx, what) {
    if (ctx.cause !== 'system') ctx.fail('REFUSED', `${what} is decided by Story Director itself, before a reply.`);
}

// ---- cast.sync ---------------------------------------------------------------------------------------------------------------

const SYNC_FIELDS = ['add', 'update', 'drop', 'updated', 'init', 'names', 'at'];

function checkSync(payload) {
    if (!isRecord(payload) || Object.keys(payload).some(field => !SYNC_FIELDS.includes(field))) return 'cast.sync takes { add?, update?, drop?, updated?, init?, names?, at? }.';
    const list = (value, max) => value === undefined || (Array.isArray(value) && value.length <= max);
    if (![payload.add, payload.update, payload.drop, payload.updated].every(value => list(value, MAX_PEOPLE))) return 'cast.sync: add, update, drop and updated are lists.';
    if (payload.init !== undefined && payload.init !== true) return 'cast.sync: init is true.';
    if (payload.at !== undefined && !(isInt(payload.at) && payload.at >= 0)) return 'cast.sync: at is the chat\'s length.';
    if (payload.names !== undefined && !(isRecord(payload.names) && Object.keys(payload.names).length <= 8 && Object.values(payload.names).every(name => textOk(name, MAX_NAME)))) return 'cast.sync: names is { pack: name }.';
    for (const item of payload.add ?? []) {
        if (!isRecord(item) || !textOk(item.pack, MAX_NAME) || !textOk(item.id, MAX_NAME) || !item.pack || !item.id || !textOk(item.name, MAX_NAME) || !item.name
            || !textOk(item.ver, MAX_NAME) || !(item.sig === undefined || textOk(item.sig, 24)) || !textOk(item.place, MAX_PLACE) || !textOk(item.doing, MAX_DOING)
            || !(item.aliases === undefined || (Array.isArray(item.aliases) && item.aliases.length <= 6 && item.aliases.every(alias => textOk(alias, MAX_NAME))))) return 'cast.sync: each of add is { pack, id, name, aliases?, ver, place, doing }.';
    }
    for (const item of payload.update ?? []) {
        if (!isRecord(item) || !keyOk(item.key) || !textOk(item.ver, MAX_NAME) || !(item.sig === undefined || textOk(item.sig, 24)) || !textOk(item.name, MAX_NAME) || !(Array.isArray(item.aliases) && item.aliases.length <= 6 && item.aliases.every(alias => textOk(alias, MAX_NAME)))) return 'cast.sync: each of update is { key, ver, sig?, name, aliases }.';
    }
    if ((payload.drop ?? []).some(key => !keyOk(key))) return 'cast.sync: drop is a list of keys.';
    for (const item of payload.updated ?? []) {
        if (!isRecord(item) || !textOk(item.pack, MAX_NAME) || !isInt(item.n) || !isInt(item.changed) || !textOk(item.from, MAX_NAME) || !textOk(item.to, MAX_NAME)) return 'cast.sync: each of updated is { pack, n, changed, from, to }.';
    }
    return '';
}

/** `cast.sync` (cause `system`). `packNames` (the hook's) names a pack in the card's words. */
export function sync(ctx, payload = {}) {
    only(ctx, 'Who joins the world from the packs');
    const bad = checkSync(payload);
    if (bad) return ctx.fail('INVALID', bad);
    const cast = ctx.draft('cast');
    const names = isRecord(payload.names) ? payload.names : {};
    const done = applySync(cast, payload, envOf(ctx, cast, names, payload.at));
    const parts = [done.added ? `${done.added} joined the world` : '', done.updated ? `${done.updated} updated` : '', done.dropped ? `${done.dropped} left` : ''].filter(Boolean);
    return { summary: parts.length ? `The cast: ${parts.join(', ')}.` : 'The cast: nothing new.', narrate: false, data: { added: done.added, updated: done.updated, dropped: done.dropped } };
}

// ---- cast.advance ------------------------------------------------------------------------------------------------------------

function checkAdvance(payload) {
    if (!isRecord(payload) || Object.keys(payload).some(field => !['from', 'to', 'moves', 'died', 'at'].includes(field))) return 'cast.advance takes { from, to, moves?, died? }.';
    if (!isInt(payload.to) || !(payload.from === null || payload.from === undefined || isInt(payload.from)) || !(payload.at === undefined || (isInt(payload.at) && payload.at >= 0))) return 'cast.advance: from and to are story minutes, at the chat\'s length.';
    if (!(payload.moves === undefined || (Array.isArray(payload.moves) && payload.moves.length <= MAX_PEOPLE)) || !(payload.died === undefined || (Array.isArray(payload.died) && payload.died.length <= MAX_PEOPLE))) return 'cast.advance: moves and died are lists.';
    for (const item of payload.moves ?? []) {
        if (!isRecord(item) || !keyOk(item.key) || !textOk(item.where ?? '', MAX_PLACE) || !textOk(item.doing ?? '', MAX_DOING)) return 'cast.advance: each of moves is { key, where, doing }.';
    }
    for (const item of payload.died ?? []) {
        if (!isRecord(item) || !keyOk(item.key)) return 'cast.advance: each of died is { key }.';
    }
    return '';
}

/** `cast.advance` (cause `system`): the batch after a day change or a time skip, and the minute the cast was moved to. */
export function advance(ctx, payload = {}) {
    only(ctx, 'Where the cast has moved on to');
    const bad = checkAdvance(payload);
    if (bad) return ctx.fail('INVALID', bad);
    const cast = ctx.draft('cast');
    const done = applyAdvance(cast, payload, envOf(ctx, cast, {}, payload.at));
    return {
        summary: done.moved + done.died ? `The cast moved on (${done.moved + done.died}).` : 'The cast: nothing changed.',
        narrate: false,
        data: { moved: done.moved, died: done.died },
    };
}

// ---- cast.meet ---------------------------------------------------------------------------------------------------------------

/** `cast.meet` (cause `system`): the party meets someone for the first time. */
export function meet(ctx, payload = {}) {
    only(ctx, 'Who crosses your path');
    if (!isRecord(payload) || Object.keys(payload).some(field => !['at', 'who', 'names'].includes(field)) || !isInt(payload.at) || payload.at < 0 || !Array.isArray(payload.who) || !payload.who.length || payload.who.length > 4) {
        return ctx.fail('INVALID', 'cast.meet takes { at, who: [{ key, why, reason }] }.');
    }
    for (const item of payload.who) {
        if (!isRecord(item) || !keyOk(item.key) || !WHYS.includes(item.why) || !textOk(item.reason ?? '', MAX_REASON) || !textOk(item.place ?? '', MAX_PLACE)) return ctx.fail('INVALID', 'cast.meet: each of who is { key, why: place | goal | story, reason, place? }.');
    }
    if (payload.names !== undefined && !(isRecord(payload.names) && Object.keys(payload.names).length <= 8 && Object.values(payload.names).every(name => textOk(name, MAX_NAME)))) return ctx.fail('INVALID', 'cast.meet: names is { pack: name }.');
    const cast = ctx.draft('cast');
    const names = isRecord(payload.names) ? payload.names : {};
    const met = applyMeet(cast, payload, envOf(ctx, cast, names, payload.at));
    if (!met.length) return { summary: 'No one new crossed your path.', narrate: false, data: { met: 0 } };
    const who = met.map(key => cast.people[key].name);
    return { summary: `Paths crossed: ${who.join(', ')}.`, narrate: false, data: { met: met.length, keys: met } };
}

// ---- cast.withdraw -----------------------------------------------------------------------------------------------------------

/**
 * `cast.withdraw` (cause `system`, from the hook after the reply's lines): the reply did not name the people it was told to bring in. It is
 * stored on that reply, so a swipe, a Re-read or a delete of the reply takes it back or decides again.
 */
export function withdraw(ctx, payload = {}) {
    only(ctx, 'Whose meeting the reply did not show');
    if (!isRecord(payload) || Object.keys(payload).some(field => !['at', 'keys'].includes(field)) || !isInt(payload.at) || payload.at < 0
        || !Array.isArray(payload.keys) || !payload.keys.length || payload.keys.length > 4 || !payload.keys.every(keyOk)) {
        return ctx.fail('INVALID', 'cast.withdraw takes { at, keys: [key] }.');
    }
    const cast = ctx.draft('cast');
    const out = applyWithdraw(cast, payload, envOf(ctx, cast, {}, payload.at));
    return { summary: out.length ? 'The reply did not show the people it was to bring in; their meeting is taken back.' : 'No meeting to take back.', narrate: false, data: { withdrawn: out.length } };
}
