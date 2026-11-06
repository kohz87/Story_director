// Story Director v2, chronicle part: the reader's chronicle commands (moved out of capture.js unchanged;
// capture.js re-exports the public names): `chronicle.edit` and `chronicle.remove`.

import {
    EVENT_ID, FACTION_ID, MAX_NAME, cleanName, cleanSummary, findIn, forgetSeen, isRecord, keyOf, prune, revOf,
} from '../domain.js';
import { CLEAR, clockOf, readNames, readState } from './text.js';
import { changeEvent, rememberName } from './world.js';
import { changeFaction } from './faction.js';

const EVENT_FIELDS = ['id', 'name', 'summary', 'state', 'place', 'factions', 'keep', 'locked'];
// The text fields of an event edit (`keep` and `locked` are true/false).
const EVENT_TEXT = ['name', 'summary', 'state', 'place', 'factions'];
const FACTION_FIELDS = ['id', 'name', 'summary', 'area', 'stance'];

// A field of an edit: undefined (keep: missing or empty), '' (clear: null or "none"), or the text.
function editText(value, { clearable = true } = {}) {
    if (value === undefined) return undefined;
    if (value === null) return clearable ? '' : undefined;
    if (typeof value !== 'string') return { error: true };
    const text = value.trim();
    if (!text) return undefined;
    if (clearable && CLEAR.test(text)) return '';
    return text;
}

function rename(ctx, table, entry, given, what) {
    const name = cleanName(given);
    if (!keyOf(name)) return ctx.fail('INVALID', `A ${what} needs a name.`);
    if (given.trim().length > MAX_NAME) return ctx.fail('INVALID', `A name has at most ${MAX_NAME} characters.`);
    if (name === entry.name) return false;
    const owner = findIn(table, name);
    if (owner && owner.id !== entry.id) return ctx.fail('REFUSED', `There is already a ${what} called ${owner.name}.`);
    const old = entry.name;
    entry.name = name;
    if (keyOf(old) !== keyOf(name)) rememberName(entry, old);
    entry.aka = (entry.aka ?? []).filter(other => keyOf(other) !== keyOf(name));
    return true;
}

/**
 * `chronicle.edit { id, name?, summary?, state?, place?, factions? }` for an event, or
 * `{ id, name?, summary?, area?, stance? }` for a faction: the reader's corrections. An empty
 * field keeps what is there; `none` (or null) clears a place, the factions, an area or a stance.
 */
export function edit(ctx, payload = {}) {
    if (!isRecord(payload) || typeof payload.id !== 'string') return ctx.fail('INVALID', 'Say what to change: { id, … }.');
    const chronicle = ctx.draft('chronicle');
    const isEvent = EVENT_ID.test(payload.id);
    if (!isEvent && !FACTION_ID.test(payload.id)) return ctx.fail('INVALID', `"${payload.id}" is not a world event or a faction.`);
    const table = isEvent ? chronicle.events : chronicle.factions;
    if (!Object.hasOwn(table, payload.id)) return ctx.fail('NOT_FOUND', `There is no ${isEvent ? 'world event' : 'faction'} ${payload.id} in the chronicle.`);
    const allowed = isEvent ? EVENT_FIELDS : FACTION_FIELDS;
    const unknown = Object.keys(payload).filter(key => !allowed.includes(key));
    if (unknown.length) return ctx.fail('INVALID', `A ${isEvent ? 'world event' : 'faction'} has no ${unknown.join(', ')} to change.`);

    const read = {};
    for (const key of allowed.slice(1)) {
        if (isEvent && !EVENT_TEXT.includes(key)) continue;
        read[key] = editText(payload[key], { clearable: !['name', 'summary', 'state'].includes(key) });
        if (read[key]?.error) return ctx.fail('INVALID', `The ${key} must be text.`);
    }
    // `keep` (hold an open event in every tail) and `locked: false` (let the story's own lines move a lasting
    // event's state again) are the reader's to set; only a pack event locks an entry.
    let keep;
    let by;
    if (isEvent) {
        if (payload.keep !== undefined && payload.keep !== null) {
            if (typeof payload.keep !== 'boolean') return ctx.fail('INVALID', 'keep is true or false.');
            keep = payload.keep;
        }
        if (payload.locked !== undefined && payload.locked !== null) {
            if (payload.locked !== false) return ctx.fail('INVALID', 'Only an event of the story\'s pack locks a world event; locked can be set to false.');
            by = null;
        }
    }
    if (Object.values(read).every(value => value === undefined) && keep === undefined && by === undefined) return ctx.fail('INVALID', 'Nothing to change: every field is empty.');

    const entry = table[payload.id];
    const rev = revOf(ctx);
    const changes = [];
    if (read.name !== undefined && rename(ctx, table, entry, read.name, isEvent ? 'world event' : 'faction')) changes.push(`now called ${entry.name}`);
    if (isEvent) {
        let state;
        if (read.state !== undefined) {
            const parsed = readState(read.state);
            if (parsed.error) return ctx.fail('INVALID', parsed.error);
            state = parsed.state;
        }
        const fields = {
            summary: read.summary !== undefined ? cleanSummary(read.summary) : undefined,
            state,
            place: read.place !== undefined ? cleanName(read.place) : undefined,
            factions: read.factions !== undefined ? readNames(read.factions) : undefined,
            keep,
            by,
        };
        changes.push(...changeEvent(chronicle, entry, fields, { now: clockOf(ctx), rev }));
        prune(chronicle);
    } else {
        const fields = {
            summary: read.summary !== undefined ? cleanSummary(read.summary) : undefined,
            area: read.area !== undefined ? cleanName(read.area) : undefined,
            stance: read.stance !== undefined ? cleanName(read.stance) : undefined,
        };
        changes.push(...changeFaction(entry, fields, rev));
    }
    if (!changes.length) return { summary: '', narrate: false, data: { id: entry.id, changed: false } };
    entry.rev = rev;
    return { summary: `${entry.name}: ${changes.join(', ')}.`, narrate: false, data: { id: entry.id, changed: true } };
}

/** `chronicle.remove { id }`: the reader takes a world event or a faction out of the chronicle. */
export function remove(ctx, payload = {}) {
    if (!isRecord(payload) || typeof payload.id !== 'string') return ctx.fail('INVALID', 'Say what to remove: { id }.');
    const chronicle = ctx.draft('chronicle');
    if (EVENT_ID.test(payload.id) && Object.hasOwn(chronicle.events, payload.id)) {
        const { name } = chronicle.events[payload.id];
        delete chronicle.events[payload.id];
        forgetSeen(chronicle, payload.id);
        return { summary: `${name} is out of the chronicle.`, narrate: false, data: { id: payload.id, removed: 'event' } };
    }
    if (FACTION_ID.test(payload.id) && Object.hasOwn(chronicle.factions, payload.id)) {
        const { name } = chronicle.factions[payload.id];
        delete chronicle.factions[payload.id];
        return { summary: `${name} is out of the chronicle.`, narrate: false, data: { id: payload.id, removed: 'faction' } };
    }
    return ctx.fail('NOT_FOUND', `There is nothing called ${payload.id} in the chronicle.`);
}
