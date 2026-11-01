// Story Director v2, part **cast**: its queries (pure apart from the queries they ask).
//
// - `director.cast` → `[{ key, pack, id, name, aliases, met: { on, where }, where, doing, lastHeard: { on, text } | null, alive,
//   entry? }]`: the contract other modules read (NPC State Delta makes a dossier from it at the first meeting). Only people who have
//   been met: an unmet person never leaves Story Director, not even their name (`director.cast.counts` gives the numbers).
//   `entry` is the pack's full entry for the person, present only when their pack is enabled now. Frozen copies. `null` while the
//   feature is off.
// - `director.cast.counts` → `{ met, total, unmet }` (the numbers, no names).
// - `director.cast.view` → what the World screen's "Around here" section draws (null while the feature is off or the world has no cast).
//
// Nothing is stored for these: every answer is worked out from the state and the other queries.

import { cutPoints, isInt, isMet, isRecord, keysOfPerson, peopleOf, slotOf, timeOfDay, counts } from './domain.js';
import { castOf, ask, partyPlace, presentKeys } from './entries.js';
import { FEATURE } from './settings.js';
import { nearCount } from './world.js';

const queryOf = tools => (typeof tools?.query === 'function' ? (name, args) => tools.query(name, args) : null);
const featureOf = tools => (typeof tools?.feature === 'function' ? tools.feature(FEATURE) !== false : true);
const settingsOf = tools => {
    try {
        const values = typeof tools?.settings === 'function' ? tools.settings() : null;
        return isRecord(values) ? values : {};
    } catch {
        return {};
    }
};
const onFor = tools => featureOf(tools) && settingsOf(tools).on !== false;

function deepFreeze(value) {
    if (value && typeof value === 'object') {
        for (const inner of Object.values(value)) deepFreeze(inner);
        Object.freeze(value);
    }
    return value;
}

/** `director.cast` (see the header). */
export function castQuery(state, _args, tools) {
    if (!onFor(tools)) return null;
    const cast = castOf(queryOf(tools));
    const out = [];
    for (const person of peopleOf(state?.domains?.cast)) {
        if (!isMet(person)) continue;
        const entry = cast.byKey.get(person.key)?.raw;
        out.push({
            key: person.key, pack: person.pack, id: person.eid, name: person.name,
            aliases: Array.isArray(person.aliases) ? [...person.aliases] : [],
            met: { on: isInt(person.met.on) ? person.met.on : null, where: person.met.where },
            where: person.where, doing: person.doing,
            lastHeard: slotOf(person.heard) ? { on: isInt(slotOf(person.heard).on) ? slotOf(person.heard).on : null, text: slotOf(person.heard).text } : null,
            alive: person.alive !== false,
            ...(isRecord(entry) ? { entry: structuredClone(entry) } : {}),
        });
    }
    return deepFreeze(out);
}

/** `director.cast.counts`: how many people the packs put in the world and how many have been met. */
export function countsQuery(state, _args, tools) {
    if (!onFor(tools)) return null;
    const { total, met } = counts(state?.domains?.cast);
    return deepFreeze({ met, total, unmet: total - met });
}

/**
 * `director.cast.view` → `{ on, total, met, near, heading, packLabel, metList: [{ key, name, news }], note }`: the World screen's
 * "Around here". `near` counts unmet people at the party's place now (a number only, no names); `metList` the met people's last news.
 */
export function viewQuery(state, _args, tools) {
    if (!onFor(tools)) return null;
    const slice = state?.domains?.cast;
    const { total, met } = counts(slice);
    if (!total) return null;
    const query = queryOf(tools);
    const cast = castOf(query);
    const party = partyPlace(query, state);
    const present = presentKeys(query, state);
    const pinned = new Set();
    const keyPeople = ask(query, 'director.keyPeople', {}, null);
    for (const entry of Array.isArray(keyPeople) ? keyPeople : []) {
        if (isRecord(entry) && !entry.removed) for (const key of keysOfPerson(entry)) pinned.add(key);
    }
    const near = nearCount(slice, cast, { party, present, pinned });
    const minutes = state?.domains?.director?.time?.minutes;
    const day = timeOfDay(isInt(minutes) ? minutes : null);
    const packs = [...new Set(peopleOf(slice).map(person => person.pack))];
    const packLabel = packs.length === 1 ? `${cast.packs?.[packs[0]]?.name || packs[0]} cast` : 'cast';
    const metList = peopleOf(slice).filter(person => isMet(person) && person.alive !== false).slice(0, 6).map(person => ({
        key: person.key, name: person.name, news: slotOf(person.heard)?.text ? cutPoints(slotOf(person.heard).text, 120) : '',
    }));
    return deepFreeze({
        on: true, total, met, near, heading: [party.place, day].filter(Boolean).join(' · '), packLabel,
        hasNear: near > 0, hasMet: metList.length > 0, metList,
        note: 'Unmet cast stays hidden. Anyone else you meet is made up by the story as today; if they matter, NPC State Delta keeps a dossier. No meetings during a fight.',
    });
}

const tagged = fn => Object.assign(fn, { feature: FEATURE });

export const queries = {
    'director.cast': tagged(castQuery),
    'director.cast.counts': tagged(countsQuery),
    'director.cast.view': tagged(viewQuery),
};

