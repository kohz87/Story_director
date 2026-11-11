// Story Director v2, chronicle part: the world events (moved out of capture.js unchanged; capture.js re-exports
// the public names): `world` lines, their summaries and locked (lasting) entries, and `chronicle.lasting`.

import {
    LASTING_BY, MAX_AKA, MAX_EVENTS, MAX_NAME, MAX_SUMMARY, STATES,
    cleanName, cleanSummary, findIn, forgetSeen, isLocked, isOpen, isRecord, keyOf, newId, prune, revOf,
} from '../domain.js';
import { tagFactions } from './faction.js';
import { CLEAR, asText, clockOf, labelOf, lineText, readNames, readState, sentence } from './text.js';

const sameList = (a, b) => a.length === b.length && a.every((name, i) => name === b[i]);

// Keeps the old name findable after a rename (newest last, at most MAX_AKA).
export function rememberName(entry, oldName) {
    const aka = (entry.aka ?? []).filter(name => keyOf(name) !== keyOf(oldName) && keyOf(name) !== keyOf(entry.name));
    entry.aka = [...aka, oldName].slice(-MAX_AKA);
}

/**
 * Applies `fields` (`summary`, `state`, `place`, `factions`, and for a lasting entry `by`: the writing
 * event or null to unlock, `keep`) to an event (on the draft): what changed, as words. `updated` and
 * `rev` move only when something did.
 */
export function changeEvent(chronicle, event, fields, { now, rev }) {
    const changes = [];
    if (fields.summary !== undefined && fields.summary !== event.summary) {
        event.summary = fields.summary;
        changes.push('summary');
    }
    if (fields.state !== undefined && fields.state !== event.state) {
        event.state = fields.state;
        changes.push(fields.state);
        if (!isOpen(event)) forgetSeen(chronicle, event.id);
    }
    if (fields.place !== undefined && fields.place !== event.place) {
        event.place = fields.place;
        changes.push(fields.place ? `at ${fields.place}` : 'no place');
    }
    if (fields.factions !== undefined && !sameList(fields.factions, event.factions)) {
        event.factions = fields.factions;
        changes.push(fields.factions.length ? `with ${fields.factions.join(', ')}` : 'no factions');
    }
    if (fields.by !== undefined && (fields.by ?? undefined) !== event.by) {
        if (fields.by === null) delete event.by;
        else event.by = fields.by;
        changes.push(fields.by === null ? 'no longer locked' : 'set by the world\'s timeline');
    }
    if (fields.keep !== undefined && fields.keep !== (event.keep === true)) {
        if (fields.keep) event.keep = true;
        else delete event.keep;
        changes.push(fields.keep ? 'kept in mind' : 'no longer kept in mind');
    }
    if (changes.length) {
        if (now !== null) event.updated = now;
        event.rev = rev;
    }
    return changes;
}

function eventSummary(event, created) {
    const where = event.place ? ` (${event.place})` : '';
    const about = event.summary ? ` — ${event.summary}` : '';
    if (event.state === 'resolved') return `World: ${event.name}${where} has ended${about}.`;
    return `World: ${event.name}${where} is ${created ? 'now ' : ''}${event.state}${about}.`;
}

/** An event as the Journal's world line tells it (the same words as the receipt of a `world` line). */
export const worldLineText = event => sentence(eventSummary(event, false));

// What a locked entry's summary becomes when a `world` line adds `more`: the new words after the old ones
// (the old ones cut at a word to make room when both do not fit).
function addToSummary(summary, more) {
    if (!more || summary.includes(more)) return summary;
    if (!summary) return more;
    const joined = `${summary} ${more}`;
    if (joined.length <= MAX_SUMMARY) return joined;
    const room = MAX_SUMMARY - more.length - 2;
    if (room < 40) return more;
    const cut = summary.slice(0, room);
    const space = cut.lastIndexOf(' ');
    return `${(space > room / 2 ? cut.slice(0, space) : cut).trim()}… ${more}`;
}

const HELD = 'set by the world\'s timeline';

// A `world` line on a lasting entry (written by a pack event): its summary gets the line's words added and
// its place and factions may change, but its state may not (`held` says the line asked for another one).
function guardLocked(event, fields) {
    if (!isLocked(event)) return { fields, held: false };
    const held = fields.state !== undefined && fields.state !== event.state;
    return { fields: { ...fields, state: undefined, summary: fields.summary === undefined ? undefined : addToSummary(event.summary, fields.summary) }, held };
}

// The change card of a line whose state was held back.
function heldSummary(event, changes) {
    const kept = `${event.name} stays ${event.state} (${HELD})`;
    return changes.length ? `World: ${kept}; changed: ${changes.join(', ')}.` : `World: ${kept}.`;
}

// The receipt's words for the factions a line made known.
const madeText = made => (made.length ? ` New ${made.length === 1 ? 'faction' : 'factions'}: ${made.join(', ')}.` : '');

/** `apply(ctx, line)` for `world` lines. */
export function applyWorldLine(ctx, line) {
    const op = line?.op;
    if (!['+', '~', '-', '!'].includes(op)) return ctx.fail('INVALID', `"${lineText(line)}": world lines use +, ~, ! or -.`);
    const name = cleanName(line?.name);
    if (!keyOf(name)) return ctx.fail('INVALID', `"${lineText(line)}" names no world event.`);
    const labels = isRecord(line?.labels) ? line.labels : {};
    const stateLabel = labelOf(labels, ['state', 'status']);
    const read = stateLabel !== undefined ? readState(stateLabel) : null;
    if (read?.error) return ctx.fail('INVALID', `"${lineText(line)}": ${read.error}`);
    const text = cleanSummary([asText(line?.text).trim(), read?.rest ?? ''].filter(Boolean).join('; '));
    const placeLabel = labelOf(labels, ['place', 'where', 'at', 'near']);
    const place = placeLabel === undefined ? undefined : CLEAR.test(asText(placeLabel).trim()) ? '' : cleanName(placeLabel);
    const factionsLabel = labelOf(labels, ['factions', 'faction', 'who', 'sides']);
    const factions = factionsLabel === undefined ? undefined : readNames(factionsLabel);

    const chronicle = ctx.draft('chronicle');
    const now = clockOf(ctx);
    const rev = revOf(ctx);
    const found = findIn(chronicle.events, name);

    if (op === '-') {
        if (!found) return ctx.fail('NOT_FOUND', `There is no world event "${name}" in the chronicle to end.`);
        const event = chronicle.events[found.id];
        const { fields, held } = guardLocked(event, { summary: text || undefined, state: 'resolved', place, factions });
        const changes = changeEvent(chronicle, event, fields, { now, rev });
        const made = tagFactions(ctx, chronicle, factions, event);
        prune(chronicle);
        if (held) return { summary: heldSummary(event, changes), narrate: false, data: { event: event.id, state: event.state, held: true } };
        return { summary: (changes.length ? sentence(eventSummary(event, false)) : `World: ${event.name} had already ended.`) + madeText(made), narrate: false, data: { event: event.id, state: event.state } };
    }

    if (!found) {
        const events = Object.values(chronicle.events);
        if (events.length >= MAX_EVENTS && events.every(isOpen)) {
            return ctx.fail('REFUSED', `The chronicle already follows ${MAX_EVENTS} world events under way; resolve or remove one first.`);
        }
        const id = newId(ctx, 'ev', chronicle.events);
        const event = {
            id, name, summary: text, state: read?.state ?? 'ongoing', since: now, updated: now,
            place: place ?? '', factions: factions ?? [], aka: [], rev,
        };
        chronicle.events[id] = event;
        const made = tagFactions(ctx, chronicle, factions, event);
        const gone = prune(chronicle);
        if (!Object.hasOwn(chronicle.events, id)) return { summary: `World: ${name} has ended (too old to keep).`, narrate: false, data: { event: null, pruned: gone } };
        return { summary: sentence(eventSummary(event, true)) + madeText(made), narrate: false, data: { event: id, created: true, state: event.state, ...(gone.length ? { pruned: gone } : {}) } };
    }

    const event = chronicle.events[found.id];
    const { fields, held } = guardLocked(event, { summary: text || undefined, state: read?.state, place, factions });
    const changes = changeEvent(chronicle, event, fields, { now, rev });
    const made = tagFactions(ctx, chronicle, factions, event);
    const gone = prune(chronicle);
    if (held) return { summary: heldSummary(event, changes) + madeText(made), narrate: false, data: { event: event.id, state: event.state, held: true, ...(gone.length ? { pruned: gone } : {}) } };
    if (!changes.length) return { summary: `World: ${event.name} is unchanged.${madeText(made)}`, narrate: false, data: { event: event.id, state: event.state } };
    return { summary: sentence(eventSummary(event, false)) + madeText(made), narrate: false, data: { event: event.id, state: event.state, ...(gone.length ? { pruned: gone } : {}) } };
}

// ---- the world's lasting changes -------------------------------------------------------------------

const LASTING_FIELDS = ['name', 'state', 'summary', 'place', 'factions', 'keep'];
const MAX_LASTING_SUMMARY = 240;
const MAX_LASTING_FACTIONS = 4;

// The payload of `chronicle.lasting` as the entry takes it, or fails with INVALID.
function readLasting(ctx, payload) {
    if (!isRecord(payload)) return ctx.fail('INVALID', 'chronicle.lasting takes { name, state, summary?, place?, factions?, keep? }.');
    const unknown = Object.keys(payload).filter(key => !LASTING_FIELDS.includes(key));
    if (unknown.length) return ctx.fail('INVALID', `chronicle.lasting has no ${unknown.join(', ')}.`);
    const short = (value, max, what) => {
        if (typeof value !== 'string') return ctx.fail('INVALID', `chronicle.lasting: ${what} must be text.`);
        if (Array.from(value.trim()).length > max) return ctx.fail('INVALID', `chronicle.lasting: ${what} has at most ${max} characters.`);
        return value;
    };
    const name = cleanName(short(payload.name, MAX_NAME, 'name'));
    if (!keyOf(name)) return ctx.fail('INVALID', 'chronicle.lasting needs a name.');
    if (!STATES.includes(payload.state)) return ctx.fail('INVALID', `chronicle.lasting: state must be one of ${STATES.join(', ')}.`);
    const out = { name, state: payload.state };
    if (payload.summary !== undefined) out.summary = cleanSummary(short(payload.summary, MAX_LASTING_SUMMARY, 'summary'));
    if (payload.place !== undefined) out.place = cleanName(short(payload.place, MAX_NAME, 'place'));
    if (payload.factions !== undefined) {
        if (!Array.isArray(payload.factions) || payload.factions.length > MAX_LASTING_FACTIONS) return ctx.fail('INVALID', `chronicle.lasting: factions is a list of at most ${MAX_LASTING_FACTIONS} names.`);
        const names = [];
        for (const given of payload.factions) {
            const faction = cleanName(short(given, MAX_NAME, 'a faction'));
            if (!keyOf(faction)) return ctx.fail('INVALID', 'chronicle.lasting: a faction needs a name.');
            if (!names.some(other => keyOf(other) === keyOf(faction))) names.push(faction);
        }
        out.factions = names;
    }
    if (payload.keep !== undefined) {
        if (typeof payload.keep !== 'boolean') return ctx.fail('INVALID', 'chronicle.lasting: keep is true or false.');
        out.keep = payload.keep;
    }
    return out;
}

/**
 * `chronicle.lasting { name, state, summary?, place?, factions?, keep? }`: a pack event's lasting change to the
 * world (see the header). Refused unless a pack event calls it (`ctx.caller` is `event:<id>`). What the payload
 * leaves out stays as it is; `since` is stamped on create, `updated` on every change. Fails (NOT_YET) while the
 * Director's clock is null.
 */
export function lasting(ctx, payload = {}) {
    const caller = typeof ctx.caller === 'string' ? ctx.caller : '';
    if (!LASTING_BY.test(caller)) return ctx.fail('REFUSED', 'A lasting change to the world is written only by an event of the story\'s pack, never by a button, a change line or another command.');
    const fields = readLasting(ctx, payload);
    // Until the story has a date there is nothing to stamp `since` with, and a delay counted from it would never come
    // due: the step fails, the pack event is not claimed and is tried again on the next reply.
    const now = clockOf(ctx);
    if (now === null) return ctx.fail('NOT_YET', 'The story has no date yet; this world event waits for one.');
    const chronicle = ctx.draft('chronicle');
    const rev = revOf(ctx);
    const found = findIn(chronicle.events, fields.name);

    if (!found) {
        const events = Object.values(chronicle.events);
        if (events.length >= MAX_EVENTS && events.every(isOpen)) {
            return ctx.fail('REFUSED', `The chronicle already follows ${MAX_EVENTS} world events under way; resolve or remove one first.`);
        }
        const id = newId(ctx, 'ev', chronicle.events);
        const event = {
            id, name: fields.name, summary: fields.summary ?? '', state: fields.state, since: now, updated: now,
            place: fields.place ?? '', factions: fields.factions ?? [], aka: [], rev, by: caller,
            ...(fields.keep === true ? { keep: true } : {}), fire: { rev, by: caller },
        };
        chronicle.events[id] = event;
        const gone = prune(chronicle);
        if (!Object.hasOwn(chronicle.events, id)) return { summary: `World: ${fields.name} has ended (too old to keep).`, narrate: false, data: { event: null, pruned: gone } };
        return { summary: sentence(eventSummary(event, true)), narrate: false, data: { event: id, created: true, state: event.state, ...(gone.length ? { pruned: gone } : {}) } };
    }

    const event = chronicle.events[found.id];
    const changes = changeEvent(chronicle, event, { summary: fields.summary, state: fields.state, place: fields.place, factions: fields.factions, by: caller, keep: fields.keep }, { now, rev });
    const gone = prune(chronicle);
    if (!changes.length) return { summary: `World: ${event.name} is unchanged.`, narrate: false, data: { event: event.id, state: event.state } };
    // This fire's receipt is kept on the entry, so the Journal can find the change whatever else touches the entry later.
    event.fire = { rev, by: caller };
    return { summary: sentence(eventSummary(event, false)), narrate: false, data: { event: event.id, state: event.state, ...(gone.length ? { pruned: gone } : {}) } };
}
