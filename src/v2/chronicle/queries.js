// Story Director v2, chronicle part: its queries (pure), for the Chronicle screen and for other
// modules (NPC State Delta may link its NPCs to factions by name later).
//
// Times are written on the chat's calendar: the tracker's `director.calendar` query through
// `tools.query` (the reader's, else the enabled pack's, else Gregorian), Gregorian without it.
// "How long ago" is counted from the Director's clock (`director.time`, else the `director`
// domain). Every answer is a plain copy.

import { PRESETS, makeCalendar } from '../../calendar.js';
import { findIn, isOpen, keyOf, orderedEvents, orderedFactions } from './domain.js';

const isInt = value => Number.isSafeInteger(value);
const toolsQuery = tools => (typeof tools?.query === 'function' ? (name, args) => tools.query(name, args) : typeof tools === 'function' ? tools : null);

function ask(query, name, args) {
    if (typeof query !== 'function') return null;
    try {
        return query(name, args) ?? null;
    } catch {
        return null;
    }
}

/** The chat's calendar (makeCalendar) through `director.calendar`, else Gregorian. */
export function calendarFrom(query) {
    const config = ask(query, 'director.calendar', {});
    try {
        return makeCalendar(config && typeof config === 'object' ? config : PRESETS.gregorian);
    } catch {
        return makeCalendar(PRESETS.gregorian);
    }
}

/** The Director's clock in story minutes (null while unset): `director.time`, else the state. */
export function nowFrom(query, state) {
    const asked = ask(query, 'director.time', {});
    if (isInt(asked?.minutes)) return asked.minutes;
    const minutes = state?.domains?.director?.time?.minutes;
    return isInt(minutes) ? minutes : null;
}

/** "this hour", "5 h ago", "3 days ago", "2 weeks ago", "4 months ago"; '' for an unknown span. */
export function agoText(minutes) {
    if (!isInt(minutes) || minutes < 0) return '';
    if (minutes < 60) return 'this hour';
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    const days = Math.floor(minutes / 1440);
    if (days < 14) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
    if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
    const months = Math.floor(days / 30);
    return months < 24 ? `${months} months ago` : `${Math.floor(days / 365)} years ago`;
}

function dateText(calendar, minutes) {
    if (!isInt(minutes)) return '';
    try {
        return calendar.format(minutes);
    } catch {
        return '';
    }
}

/** An event as the queries give it. */
export function eventOut(event, { chronicle, calendar, now }) {
    const factions = (event.factions ?? []).map(name => ({ name, id: findIn(chronicle?.factions, name)?.id ?? null }));
    return {
        id: event.id,
        name: event.name,
        summary: event.summary,
        state: event.state,
        open: isOpen(event),
        place: event.place,
        factions,
        factionsText: factions.map(entry => entry.name).join(', '),
        since: event.since,
        updated: event.updated,
        sinceText: dateText(calendar, event.since),
        updatedText: dateText(calendar, event.updated),
        updatedAgo: isInt(now) && isInt(event.updated) ? agoText(now - event.updated) : '',
        aka: [...(event.aka ?? [])],
        rev: event.rev,
    };
}

/** A faction as the queries give it, with the open events that name it. */
export function factionOut(faction, { chronicle }) {
    const names = [faction.name, ...(faction.aka ?? [])].map(keyOf);
    const events = orderedEvents(chronicle).filter(event => isOpen(event) && (event.factions ?? []).some(name => names.includes(keyOf(name))))
        .map(event => ({ id: event.id, name: event.name, state: event.state }));
    return {
        id: faction.id,
        name: faction.name,
        summary: faction.summary,
        area: faction.area,
        stance: faction.stance,
        events,
        eventsText: events.map(event => event.name).join(', '),
        aka: [...(faction.aka ?? [])],
        rev: faction.rev,
    };
}

function setup(state, tools) {
    const query = toolsQuery(tools);
    const chronicle = state?.domains?.chronicle ?? { events: {}, factions: {} };
    return { chronicle, calendar: calendarFrom(query), now: nowFrom(query, state) };
}

/** `chronicle.board`: what the Chronicle screen shows, worked out ahead (a template cannot sort or count). */
export function chronicleBoard(state, _args, tools) {
    const env = setup(state, tools);
    const events = orderedEvents(env.chronicle).map(event => eventOut(event, env));
    const open = events.filter(event => event.open);
    const resolved = events.filter(event => !event.open);
    const factions = orderedFactions(env.chronicle).map(faction => factionOut(faction, env));
    return {
        open, resolved, factions,
        hasOpen: open.length > 0, hasResolved: resolved.length > 0, hasFactions: factions.length > 0,
        openCount: open.length, resolvedCount: resolved.length, factionCount: factions.length,
        now: dateText(env.calendar, env.now),
    };
}

export const queries = {
    /**
     * The world events, open first (newest news first), then resolved: `[{ id, name, summary, state,
     * open, place, factions: [{ name, id|null }], factionsText, since, updated, sinceText,
     * updatedText, updatedAgo, aka, rev }]`. `state` keeps one state; `open: true|false` open or resolved ones.
     */
    'chronicle.events': (state, { state: only = null, open = null } = {}, tools) => {
        const env = setup(state, tools);
        return orderedEvents(env.chronicle)
            .filter(event => (!only || event.state === only) && (open === null || isOpen(event) === open))
            .map(event => eventOut(event, env));
    },
    /** One world event by `id` or `name` (or a name it had), or null. */
    'chronicle.event': (state, { id = null, name = null } = {}, tools) => {
        const env = setup(state, tools);
        const found = findIn(env.chronicle.events, id ?? name);
        return found ? eventOut(found, env) : null;
    },
    /** The factions by name: `[{ id, name, summary, area, stance, events: [{ id, name, state }], eventsText, aka, rev }]`. */
    'chronicle.factions': (state, _args, tools) => {
        const env = setup(state, tools);
        return orderedFactions(env.chronicle).map(faction => factionOut(faction, env));
    },
    /** One faction by `id` or `name` (or a name it had), or null. */
    'chronicle.faction': (state, { id = null, name = null } = {}, tools) => {
        const env = setup(state, tools);
        const found = findIn(env.chronicle.factions, id ?? name);
        return found ? factionOut(found, env) : null;
    },
    'chronicle.board': chronicleBoard,
};
