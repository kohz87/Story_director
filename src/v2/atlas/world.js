// Story Director v2, atlas part: the world as the map and the travel maths see it (pure).
//
// Two sources, joined by name key: the chat's own atlas (places the story went to or named,
// routes it wrote, the reader's corrections) and the enabled packs' `places` and `routes`
// (Story Block's query `packs.content`, optional: without it the atlas is the story's alone).
// A pack place the atlas lacks is known but undiscovered; once the story goes there it is the
// atlas's, with the pack's data filling what the story left out. Coordinates: the atlas's own
// (a reader's correction, or the story's for a place no pack knows) win, then the pack's; coordinates the map placed itself (`auto`,
// parent.js) give way to the pack's, and a child's follow its live parent (the parent's point plus the child's fixed offset).

import { PACK_NODE, childOffset, cleanName, cleanWord, isRecord, keyOf, orderedPlaces, orderedRoutes, round3 } from './domain.js';

const finite = value => (typeof value === 'number' && Number.isFinite(value) ? value : null);
// Names once each by key, without `own` (the place's own name key).
const byKeyOnce = (names, own) => {
    const seen = new Set([own]);
    return names.filter(name => {
        const key = keyOf(name);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};
/** A pack place's content definition id as Story Block normalizes it: `pack.<id>/<slug>`. */
export const DEFINITION_ID = /^pack\.[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const positive = value => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null);

/**
 * The enabled packs' places and routes through `query` (ctx.query, tools.query or view.query):
 * `{ places: [{ key, name, definition, region, kind, layer, x, y, aliases, aliasNames, hidden }], routes: [{ from, to, kind, km, hours }], candidates }`.
 * `definition`: Story Block's content id of the place (`pack.<id>/<slug>`), null when the pack gave none; `candidates`: every pack place that
 * has one, before names are made unique (`[{ id, key, name, region, aliases: [keys] }]`), which canonical resolution reads.
 * `aliases` are name keys, `aliasNames` the same names as written (for search). `hidden`: the pack
 * marks the place `hidden: true` or `secret: true`, so the map keeps it off until the story goes
 * there (Story Block's pack format has no such field yet; a pack that gives one is respected).
 * A missing query, or one that throws, gives an empty pack world.
 */
export function packWorld(query) {
    // `readable`: whether the packs could be asked at all (a missing or throwing query is no answer; an installed-pack list that is empty is one).
    let readable = typeof query === 'function';
    const read = kind => {
        if (typeof query !== 'function') return [];
        try {
            const out = query('packs.content', { kind });
            return Array.isArray(out) ? out : [];
        } catch {
            readable = false;
            return [];
        }
    };
    const places = [];
    const candidates = [];
    const seen = new Set();
    for (const entry of read('places')) {
        if (!isRecord(entry) || typeof entry.name !== 'string') continue;
        const name = cleanName(entry.name);
        const key = keyOf(name);
        // Every pack's place is a canonical candidate before names are made unique (contract P24: two packs sharing a name are two places).
        if (key && typeof entry.id === 'string' && DEFINITION_ID.test(entry.id)) {
            candidates.push({ id: entry.id, key, name, region: cleanWord(entry.region), aliases: (Array.isArray(entry.aliases) ? entry.aliases : []).map(cleanName).map(keyOf).filter(alias => alias && alias !== key) });
        }
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const x = finite(entry.x);
        const y = finite(entry.y);
        const aliasNames = (Array.isArray(entry.aliases) ? entry.aliases : []).map(cleanName).filter(alias => keyOf(alias) && keyOf(alias) !== key);
        places.push({
            key,
            name,
            definition: typeof entry.id === 'string' && DEFINITION_ID.test(entry.id) ? entry.id : null,
            region: cleanWord(entry.region),
            kind: cleanWord(entry.kind, { lower: true }),
            layer: cleanWord(entry.layer ?? entry.plane),
            x: x !== null && y !== null ? x : null,
            y: x !== null && y !== null ? y : null,
            aliases: aliasNames.map(keyOf),
            aliasNames,
            hidden: entry.hidden === true || entry.secret === true,
        });
    }
    const routes = [];
    for (const entry of read('routes')) {
        if (!isRecord(entry)) continue;
        const from = cleanName(entry.from);
        const to = cleanName(entry.to);
        if (!keyOf(from) || !keyOf(to) || keyOf(from) === keyOf(to)) continue;
        routes.push({ from, to, kind: cleanWord(entry.kind, { lower: true }), km: positive(entry.km), hours: positive(entry.hours) });
    }
    return { places, routes, candidates, readable };
}

/**
 * The joined world: `{ places, routes, find(ref) }`. A place:
 * `{ id, key, name, region, kind, layer, x, y, parent (the atlas id it sits in, or null), discovered, source: 'atlas' | 'pack', atlasId, aliases, hidden }`
 * (`id` is the atlas id, or `pack:<key>` for a pack place the atlas lacks). A route:
 * `{ id, from, to, kind, hours, km, source }` between place ids (`hours` from the story or the
 * pack, `km` from the pack; null when not given). `find` takes an id, a node id, a name or an alias.
 * `aliases`: the other names the place goes by (the pack's as written, the atlas's as keys).
 * `hidden`: a pack's hidden or secret place the story has not reached; maps and search leave it out.
 */
export function worldOf(atlas, pack = { places: [], routes: [] }) {
    const packByKey = new Map();
    for (const place of pack.places ?? []) {
        packByKey.set(place.key, place);
        for (const alias of place.aliases ?? []) if (!packByKey.has(alias)) packByKey.set(alias, place);
    }
    const places = [];
    const packed = new Set();
    const byId = new Map();
    const byKey = new Map();
    const usedPack = new Set();
    for (const own of orderedPlaces(atlas)) {
        const key = keyOf(own.name);
        const from = packByKey.get(key) ?? Object.entries(atlas.keys ?? {}).filter(([, id]) => id === own.id).map(([alias]) => packByKey.get(alias)).find(Boolean) ?? null;
        if (from) usedPack.add(from.key);
        // Placed by the map (`auto`) and the pack has a point: the pack's wins.
        if (own.auto && from?.x !== null && from?.x !== undefined && own.x !== undefined) packed.add(own.id);
        const hasOwn = own.x !== undefined && own.y !== undefined && !(own.auto && from?.x !== null && from?.x !== undefined);
        const place = {
            id: own.id,
            key,
            name: own.name,
            region: own.region || from?.region || '',
            kind: own.kind || from?.kind || '',
            layer: own.layer || from?.layer || '',
            x: hasOwn ? own.x : from?.x ?? null,
            y: hasOwn ? own.y : from?.y ?? null,
            parent: own.parent ?? null,
            discovered: own.discovered,
            source: 'atlas',
            atlasId: own.id,
            aliases: byKeyOnce([...(from?.aliasNames ?? []), from?.name ?? '', ...Object.entries(atlas.keys ?? {}).filter(([, id]) => id === own.id).map(([alias]) => alias)], key),
            hidden: Boolean(from?.hidden) && !own.discovered,
        };
        places.push(place);
        byId.set(place.id, place);
    }
    // An auto-placed child sits by its live parent (the parent's point may be a pack's): parents first, a chain of three at most.
    const done = new Set();
    const firstKey = new Map();
    for (const [alias, id] of Object.entries(atlas?.keys ?? {})) if (!firstKey.has(id)) firstKey.set(id, alias);
    const follow = (place, depth = 0) => {
        const own = atlas.places[place.id];
        const up = own?.auto && own.parent ? byId.get(own.parent) : null;
        if (!up || up.id === place.id || depth > 3 || packed.has(place.id) || done.has(place.id)) return;
        done.add(place.id);
        follow(up, depth + 1);
        if (up.x === null || up.y === null) return;
        // The offset comes from the name the place was first saved under (a rename keeps it as an alias), so a rename never moves the point.
        const { dx, dy } = childOffset(firstKey.get(place.id) ?? place.key);
        Object.assign(place, { x: round3(up.x + dx), y: round3(up.y + dy) });
    };
    for (const place of places) follow(place);
    for (const [alias, id] of Object.entries(atlas?.keys ?? {})) if (byId.has(id)) byKey.set(alias, byId.get(id));
    // The pack's other names find the atlas's place too ("the quay" for Inspection Quay).
    for (const place of places) for (const alias of place.aliases) if (!byKey.has(keyOf(alias))) byKey.set(keyOf(alias), place);
    for (const from of pack.places ?? []) {
        if (usedPack.has(from.key) || byKey.has(from.key)) continue;
        const place = { id: `${PACK_NODE}${from.key}`, key: from.key, name: from.name, region: from.region, kind: from.kind, layer: from.layer, x: from.x, y: from.y, discovered: false, parent: null, source: 'pack', atlasId: null, aliases: [...(from.aliasNames ?? [])], hidden: Boolean(from.hidden) };
        places.push(place);
        byId.set(place.id, place);
        byKey.set(from.key, place);
        for (const alias of from.aliases) if (!byKey.has(alias)) byKey.set(alias, place);
    }
    const find = ref => {
        if (ref === null || ref === undefined) return null;
        const text = String(ref);
        return byId.get(text) ?? byKey.get(keyOf(text)) ?? null;
    };

    const routes = [];
    const seen = new Set();
    const add = (route, a, b) => {
        if (!a || !b || a.id === b.id) return;
        const pair = [a.id, b.id].sort().join('\u0000');
        if (seen.has(`${pair}\u0000${route.kind}`)) return;
        seen.add(`${pair}\u0000${route.kind}`);
        routes.push({ ...route, from: a.id, to: b.id });
    };
    // A pack's route wins over the story's of the same kind between the same places (v1: the
    // pack is the reader's map, the story's figures drift).
    (pack.routes ?? []).forEach((route, index) => {
        add({ id: `pack:route:${index}`, kind: route.kind, hours: route.hours, km: route.km, source: 'pack' }, find(route.from), find(route.to));
    });
    for (const own of orderedRoutes(atlas)) {
        const hours = own.days === undefined && own.hours === undefined ? null : (own.days ?? 0) * 24 + (own.hours ?? 0);
        add({ id: own.id, kind: own.kind, hours, km: null, source: 'atlas' }, byId.get(own.from), byId.get(own.to));
    }
    return { places, routes, find };
}

/** The pack's place for a name (by key or alias), or null: what a new atlas place copies. */
export function packPlace(pack, name) {
    const key = keyOf(name);
    if (!key) return null;
    return (pack?.places ?? []).find(place => place.key === key) ?? (pack?.places ?? []).find(place => place.aliases.includes(key)) ?? null;
}
