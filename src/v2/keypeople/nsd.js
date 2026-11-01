// Story Director v2, part **keypeople**: what NPC State Delta says about the people who are pinned (read only; nothing is
// ever written to it). A pinned person NPC State Delta has archived or lost (a death, confirmed or inferred) leaves the key
// list, and the hook before each reply says so in one `keypeople.sync` step (index.js). Pure apart from what it is handed.
//
// Two ways to ask, the first that answers wins:
// - its Story Suite api (`StorySuite.api('npc-state-delta')`, Delta's `npcs()` and `npcProfiles()`): `npcProfiles()` lists the
//   tracked people who are neither archived nor dead, so a pinned person `npcs()` knows who is archived is "archived", and
//   one it knows who is missing from the profiles is "died";
// - its queries (the way a Story Block 2 host reaches it): `npc.known` (the people not archived) and `npc.dossier` (whose
//   `lifeState` says `deceased`). A pinned person who was known to it (`nsd`, noted by the hook the first time it sees them
//   there) and is no longer among the known people is "archived".
// An empty answer (Delta off, or its dossiers not loaded yet) says nothing: nobody is released on silence.

import { isRecord, keyOf, keysOfPin, tables } from './domain.js';

const array = value => (Array.isArray(value) ? value : []);

/** Delta's Story Suite api when it is there and offers both lists, else null. */
export function suiteApi() {
    try {
        const api = globalThis.StorySuite?.api?.('npc-state-delta');
        return api && typeof api.npcs === 'function' && typeof api.npcProfiles === 'function' ? api : null;
    } catch {
        return null;
    }
}

const safe = (fn, fallback) => {
    try {
        const value = fn();
        return value === undefined ? fallback : value;
    } catch {
        return fallback;
    }
};

// The names an entry of Delta's lists goes by, as keys.
const keysOfEntry = entry => [entry?.name, ...array(entry?.aliases)].map(keyOf).filter(Boolean);
const named = (list, keys) => list.find(entry => isRecord(entry) && keysOfEntry(entry).some(key => keys.includes(key)));

/**
 * What Delta says about each pinned person: `{ released: [{ name, reason }], known: [name] }`. `released`: archived or dead
 * there; `known`: pinned people Delta knows now (to remember, so a later disappearance reads as archived).
 */
export function nsdVerdicts(slice, { api = suiteApi(), query = null } = {}) {
    const { pins } = tables(slice);
    const released = [];
    const known = [];
    const pinned = Object.values(pins).filter(isRecord);
    if (!pinned.length) return { released, known };
    const npcs = api ? array(safe(() => api.npcs(), [])) : [];
    const profiles = api ? array(safe(() => api.npcProfiles(), [])) : [];
    if (api && npcs.length) {
        for (const pin of pinned) {
            const keys = keysOfPin(pin);
            const entry = named(npcs, keys);
            if (!entry) continue;
            if (entry.archived === true) released.push({ name: pin.name, reason: 'archived' });
            else if (!named(profiles, keys)) released.push({ name: pin.name, reason: 'died' });
            else if (pin.nsd !== true) known.push(pin.name);
        }
        return { released, known };
    }
    const names = typeof query === 'function' ? safe(() => query('npc.known', {}), null) : null;
    if (!Array.isArray(names) || !names.length) return { released, known };
    const here = names.map(keyOf).filter(Boolean);
    for (const pin of pinned) {
        const keys = keysOfPin(pin);
        const dossier = keys.some(key => here.includes(key)) ? safe(() => query('npc.dossier', { name: pin.name }), null) : null;
        if (dossier) {
            if (dossier.lifeState === 'deceased') released.push({ name: pin.name, reason: 'died' });
            else if (pin.nsd !== true) known.push(pin.name);
        } else if (pin.nsd === true && !keys.some(key => here.includes(key))) released.push({ name: pin.name, reason: 'archived' });
    }
    return { released, known };
}
