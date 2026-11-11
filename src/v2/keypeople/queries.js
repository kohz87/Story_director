// Story Director v2, part **keypeople**: its queries (pure apart from the queries they ask).
//
// - `director.keyPeople` → `[{ name, aliases?, here, away: { doing, since, back, steps: [{ date, text }] } | null,
//   removed?: { reason, on } }]`: the contract other modules read (NPC State Delta's dossier). Read-only, frozen copies:
//   the pinned people (in the order they were pinned), then those taken off the list (`removed`: `reason` is died |
//   archived | unpinned, `on` the story minute or null). `here`: the scene lists them as present (Story Block's
//   `scene.present`, NPC State Delta's `npc.present`; by name or alias). `since`, `back` and a step's `date` are story
//   minutes (null when not known; `back` is the start of the day they are due).
// - `director.keyPeople.view`: what the World screen's Key people section draws (rows, the Pin chooser, the token note).
// - `director.keyPeople.on`: `{ on: true }` (null while the feature is off): the World screen shows the section on it.
//
// Nothing is stored for these: every answer is worked out from the state and the other queries.

import { DEFAULT_CAP, FEATURE, MAX_CAP, awayOf, cutPoints, findPin, flat, isInt, isRecord, keyOf, keysOfPin, tables } from './domain.js';
import { awayEntries, keyTail, tokensOf } from './note.js';
import { suiteApi } from './nsd.js';
import { calendarFrom, dateText } from './time.js';

const ask = (query, name, args = {}) => {
    if (typeof query !== 'function') return null;
    try {
        return query(name, args) ?? null;
    } catch {
        return null;
    }
};
const queryOf = tools => (typeof tools?.query === 'function' ? (name, args) => tools.query(name, args) : null);
const settingsOf = tools => {
    try {
        const values = typeof tools?.settings === 'function' ? tools.settings() : null;
        return isRecord(values) ? values : {};
    } catch {
        return {};
    }
};
const capOf = settings => (isInt(settings?.cap) && settings.cap >= 0 ? Math.min(MAX_CAP, settings.cap) : DEFAULT_CAP);

/** The keys of the people the scene lists as present (Story Block's list, NPC State Delta's). */
function presentKeys(query) {
    const out = new Set();
    for (const name of ['scene.present', 'npc.present']) {
        const list = ask(query, name, {});
        for (const entry of Array.isArray(list) ? list : []) {
            const key = keyOf(typeof entry === 'string' ? entry : entry?.name);
            if (key) out.add(key);
        }
    }
    return out;
}

// Story Block's present list drops a leading article ("the scout" is listed as "scout"), so an alias is matched with it too.
const bare = key => key.replace(/^(?:the|a|an)\s+/, '');
const hereOf = (pin, here) => keysOfPin(pin).some(key => here.has(key) || here.has(bare(key)));

function deepFreeze(value) {
    if (value && typeof value === 'object') {
        for (const inner of Object.values(value)) deepFreeze(inner);
        Object.freeze(value);
    }
    return value;
}

/** `director.keyPeople` (see the header). */
export function keyPeopleQuery(state, _args, tools) {
    const slice = state?.domains?.keypeople;
    const { pins, away, gone } = tables(slice);
    const here = presentKeys(queryOf(tools));
    const out = [];
    for (const [key, pin] of Object.entries(pins)) {
        const record = Object.hasOwn(away, key) && isRecord(away[key]) ? away[key] : null;
        out.push({
            name: pin.name,
            ...(Array.isArray(pin.aliases) && pin.aliases.length ? { aliases: [...pin.aliases] } : {}),
            here: hereOf(pin, here),
            away: record ? {
                doing: record.doing, since: isInt(record.since) ? record.since : null, back: isInt(record.back) ? record.back : null,
                steps: (Array.isArray(record.steps) ? record.steps : []).filter(isRecord).map(step => ({ date: isInt(step.date) ? step.date : null, text: String(step.text ?? '') })),
            } : null,
        });
    }
    for (const gonePerson of Object.values(gone)) {
        if (!isRecord(gonePerson)) continue;
        out.push({ name: gonePerson.name, here: false, away: null, removed: { reason: gonePerson.reason, on: isInt(gonePerson.on) ? gonePerson.on : null } });
    }
    return deepFreeze(out);
}

// ---- the World screen's section ---------------------------------------------------------------------------------------

const MAX_CHOICES = 40;
const KNOWN_KINDS = new Set(['quest', 'hook', 'event']);

// NPC State Delta's profiles by name key: { role, aliases } (its Story Suite api when it is there).
function profilesOf() {
    const api = suiteApi();
    const out = [];
    try {
        for (const entry of Array.isArray(api?.npcProfiles?.()) ? api.npcProfiles() : []) if (isRecord(entry) && typeof entry.name === 'string') out.push(entry);
    } catch {
        // None.
    }
    return out;
}

/** The people the reader may pin, not pinned yet: `[{ name, aliases, source: 'here' | 'thread' | 'cast' | 'npc', nsd }]`. */
function choicesOf(slice, query, profiles) {
    const out = [];
    const seen = new Set();
    const add = (name, source, { aliases = [], nsd = false } = {}) => {
        const clean = cutPoints(name, 80);
        const key = keyOf(clean);
        if (!key || seen.has(key) || findPin(slice, clean, aliases)) return;
        seen.add(key);
        out.push({ name: clean, aliases: aliases.map(alias => cutPoints(alias, 80)).filter(Boolean).slice(0, 6), source, nsd });
    };
    // People present now (Story Block's scene list and NPC State Delta's present cast).
    const dossiers = new Map();
    const dossierOf = name => {
        if (!dossiers.has(name)) dossiers.set(name, ask(query, 'npc.dossier', { name }));
        return dossiers.get(name);
    };
    const known = ask(query, 'npc.known', {});
    const nsdOn = Array.isArray(known);
    for (const name of ['scene.present', 'npc.present'].flatMap(queryName => {
        const list = ask(query, queryName, {});
        return (Array.isArray(list) ? list : []).map(entry => (typeof entry === 'string' ? entry : entry?.name)).filter(item => typeof item === 'string');
    })) {
        const dossier = nsdOn ? dossierOf(name) : null;
        add(dossier?.name ?? name, 'here', { aliases: Array.isArray(dossier?.aliases) ? dossier.aliases : [], nsd: Boolean(dossier) });
    }
    // The people the story's own threads name that {{user}} knows of (a quest's giver, the people of a hook or an event), never behind the scenes.
    const threads = ask(query, 'director.threads', {});
    for (const thread of Array.isArray(threads) ? threads : []) {
        if (!isRecord(thread) || thread.status !== 'active' || !KNOWN_KINDS.has(thread.kind)) continue;
        const fields = isRecord(thread.fields) ? thread.fields : {};
        for (const value of [fields.giver, ...String(fields.people ?? '').split(',')]) {
            const name = flat(value);
            if (name && !/[|;]/.test(name)) {
                const dossier = nsdOn ? dossierOf(name) : null;
                add(dossier?.name ?? name, 'thread', { aliases: Array.isArray(dossier?.aliases) ? dossier.aliases : [], nsd: Boolean(dossier) });
            }
        }
    }
    // The people met from a pack's cast (Story Director's own cast, `director.cast`: only the met are listed), alive.
    const met = ask(query, 'director.cast', {});
    for (const person of Array.isArray(met) ? met : []) {
        if (isRecord(person) && person.alive !== false && typeof person.name === 'string') add(person.name, 'cast', { aliases: Array.isArray(person.aliases) ? person.aliases : [], nsd: nsdOn && Boolean(dossierOf(person.name)) });
    }
    // Everyone NPC State Delta tracks (not archived, not dead).
    for (const profile of profiles) add(profile.name, 'npc', { aliases: profile.aliases ?? [], nsd: true });
    if (!profiles.length && nsdOn) for (const name of known) if (typeof name === 'string') add(dossierOf(name)?.name ?? name, 'npc', { aliases: dossierOf(name)?.aliases ?? [], nsd: true });
    return out.slice(0, MAX_CHOICES);
}

// Where an away person is: their away record's own `place`, else the newest step that names one; shown as the map's place line when it knows the place.
function placeOf(slice, entry, query) {
    if (!entry) return '';
    const named = [awayOf(slice, entry.key)?.place, ...[...entry.steps].reverse().map(step => step.place)].find(value => typeof value === 'string' && value.trim());
    if (!named) return '';
    let line = '';
    try { line = query?.('atlas.line', { name: named }); } catch { /* no map: the name stands */ }
    return cutPoints(typeof line === 'string' && line.trim() ? line : named, 80);
}

const agoOf = days => (days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`);

/** The role NPC State Delta gives a person, from its profiles or its dossier ('' when none). */
function roleOf(pin, profiles, query) {
    const keys = keysOfPin(pin);
    const profile = profiles.find(entry => [entry.name, ...(Array.isArray(entry.aliases) ? entry.aliases : [])].map(keyOf).some(key => keys.includes(key)));
    if (profile?.role) return cutPoints(profile.role, 60);
    const dossier = ask(query, 'npc.dossier', { name: pin.name });
    return cutPoints(dossier?.role, 60);
}

/**
 * `director.keyPeople.view` → `{ on, cap, count, full, hasPeople, people: [{ key, name, here, away, due, doing, status, last,
 * newsAgo, place, back }], elsewhere (how many are not in the scene), choices, tokens, budget, note }` for the World screen. `tokens`: what the away people cost the narrator now.
 */
export function keyPeopleView(state, _args, tools) {
    const slice = state?.domains?.keypeople;
    const query = queryOf(tools);
    const settings = settingsOf(tools);
    const cap = capOf(settings);
    const budget = tokensOf(settings);
    const { pins } = tables(slice);
    const calendar = calendarFrom(query);
    const minutes = state?.domains?.director?.time?.minutes;
    const now = isInt(minutes) ? minutes : null;
    const here = presentKeys(query);
    const awayBy = new Map(awayEntries(slice, now).map(entry => [entry.key, entry]));
    const profiles = profilesOf();
    const people = Object.entries(pins).map(([key, pin]) => {
        const entry = awayBy.get(key) ?? null;
        const present = hereOf(pin, here);
        const back = entry ? dateText(calendar, entry.back) : '';
        const role = !entry ? roleOf(pin, profiles, query) : '';
        const step = entry?.last?.text ? cutPoints(entry.last.text, 140) : '';
        const lastDate = entry?.last ? dateText(calendar, entry.last.date) : '';
        return {
            key, name: pin.name, here: present, away: Boolean(entry), due: Boolean(entry?.due),
            status: entry ? (entry.due ? 'Away · due back' : back ? `Away · back ${back}` : 'Away') : present ? 'Here' : 'Not here',
            doing: entry ? (entry.doing ? cutPoints(entry.doing, 160) : 'Away.') : role || (present ? 'In the scene.' : ''),
            last: step ? `Last news${lastDate ? ` ${lastDate}` : ''}: ${step}` : '',
            // How old the newest news is, in story days ("today", "yesterday", "3 days ago"): Elsewhere's line.
            newsAgo: isInt(now) && isInt(entry?.last?.date) && now >= entry.last.date ? agoOf(Math.floor(now / 1440) - Math.floor(entry.last.date / 1440)) : '',
            // Elsewhere's place line for an away person ('' when no place is known: the status line stands).
            place: placeOf(slice, entry, query),
            back,
        };
    });
    const told = keyTail(slice, { now, calendar, budget });
    const left = told.left > 0 ? ` ${told.left} more ${told.left === 1 ? 'is' : 'are'} away than fit, so ${told.left === 1 ? 'it is' : 'they are'} left out of a reply.` : '';
    return {
        on: true, cap, count: people.length, elsewhere: people.filter(person => !person.here).length, full: people.length >= cap, hasPeople: people.length > 0, people,
        // The heading's count: "3 of 10", or "2 pinned · limit 1" when the limit was lowered under the number pinned.
        countText: people.length > cap ? `${people.length} pinned · limit ${cap}` : `${people.length} of ${cap}`,
        limitText: `You can have ${cap} key ${cap === 1 ? 'person' : 'people'}; unpin someone first.`,
        choices: choicesOf(slice, query, profiles),
        tokens: told.tokens, budget,
        note: `Key people who are away are told to the narrator each reply: about ${told.tokens} tokens now, of a ${budget}-token budget.${left} Pin someone with + Pin; their death, or archiving their dossier, unpins them.`,
    };
}

const tagged = fn => Object.assign(fn, { feature: FEATURE });

export const queries = {
    'director.keyPeople': tagged(keyPeopleQuery),
    'director.keyPeople.view': tagged(keyPeopleView),
    'director.keyPeople.on': tagged(() => ({ on: true })),
};
