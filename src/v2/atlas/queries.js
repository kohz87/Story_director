// Story Director v2, atlas part: queries and the beforeGenerate hook (pure).
//
// Queries read the head state and, through `tools.query` (MODULES §F3), the enabled packs'
// places and routes; they never see settings, so a trip estimated from coordinates uses v1's
// default map (one km a unit, roads winding ×1.25) unless `map` is given in the args. The tail
// (note.js) uses the reader's map settings.

import { mapSettings, parseLocation } from '../../places.js';
import { findPlace, keyOf } from './domain.js';
import { mapProps } from './map.js';
import { scenePlace } from './note.js';
import { travelTime } from './travel.js';
import { packWorld, worldOf } from './world.js';

const toolsQuery = tools => (typeof tools?.query === 'function' ? (name, args) => tools.query(name, args) : null);
const worldFrom = (state, tools) => worldOf(state?.domains?.atlas ?? { places: {}, routes: {}, keys: {}, focus: null }, packWorld(toolsQuery(tools)));
const hereOf = (state, tools) => scenePlace({ state, query: toolsQuery(tools) }).name;

const placeOut = place => ({
    id: place.id, name: place.name, region: place.region, kind: place.kind, layer: place.layer,
    x: place.x, y: place.y, discovered: place.discovered, source: place.source,
});

function routeOut(world, route, { map, from = null } = {}) {
    const name = id => world.find(id)?.name ?? '';
    const trip = travelTime({ places: world.places, routes: [route], find: world.find }, route.from, route.to, { map });
    const out = {
        id: route.id, from: route.from, to: route.to, fromName: name(route.from), toName: name(route.to),
        kind: route.kind, hours: route.hours, km: route.km, source: route.source,
        days: trip?.days ?? null, text: trip?.text ?? '',
    };
    if (from) {
        const other = route.from === from ? route.to : route.from;
        Object.assign(out, { other, otherName: name(other) });
    }
    return out;
}

function placeDetail(world, ref, map) {
    const place = world.find(ref);
    if (!place) return null;
    const routes = world.routes.filter(route => route.from === place.id || route.to === place.id).map(route => routeOut(world, route, { map, from: place.id }));
    return { ...placeOut(place), routes };
}

export const queries = {
    /** The places on the map (the atlas's, then the packs' it has not got): `[{ id, name, region, kind, layer, x, y, discovered, source }]`. */
    'atlas.places': (state, { discovered = null } = {}, tools) => worldFrom(state, tools).places
        .filter(place => discovered === null || place.discovered === discovered)
        .map(placeOut),
    /** The known routes, of one place when `place` is given, each with its time (`days`, `text`). */
    'atlas.routes': (state, { place = null, map = null } = {}, tools) => {
        const world = worldFrom(state, tools);
        const settings = mapSettings(map ?? {});
        if (place === null) return world.routes.map(route => routeOut(world, route, { map: settings }));
        const at = world.find(place);
        return at ? world.routes.filter(route => route.from === at.id || route.to === at.id).map(route => routeOut(world, route, { map: settings, from: at.id })) : [];
    },
    /** Exactly `ss.map`'s props: `{ nodes, edges, layers, current, discovered, kinds }`. */
    'atlas.map': (state, _args, tools) => mapProps(worldFrom(state, tools), hereOf(state, tools)),
    /** One place with its routes, by `id` (or node id) or `name`; null when unknown. */
    'atlas.place': (state, { id = null, name = null } = {}, tools) => placeDetail(worldFrom(state, tools), id ?? name, mapSettings({})),
    /** The place picked on the map (`atlas.focus`) with its routes, or null. */
    'atlas.selected': (state, _args, tools) => {
        const focus = state?.domains?.atlas?.focus ?? null;
        if (!focus) return null;
        const world = worldFrom(state, tools);
        return placeDetail(world, world.find(focus) ? focus : focus.replace(/^pack:/, ''), mapSettings({}));
    },
    /** The trip between two places (travel.js `travelTime`), or null. */
    'atlas.travel': (state, { from = null, to = null, mode = null, map = null } = {}, tools) => travelTime(worldFrom(state, tools), from, to, { map: mapSettings(map ?? {}), mode }),
};

/**
 * `beforeGenerate(view)` (SPEC §4.1 step 3): the scene's place goes on the map when the atlas
 * has not got it, has it only by hearsay, or lacks the kind or region the scene gives. Commits
 * through `{ commands: [{ type: 'atlas.visit', payload }] }`; nothing when there is nothing new.
 */
export function beforeGenerate(view) {
    const atlas = view?.state?.domains?.atlas;
    if (!atlas) return undefined;
    const scene = scenePlace(view);
    const name = parseLocation(scene.name).name.trim();
    if (!keyOf(name)) return undefined;
    const known = findPlace(atlas, name);
    const fresh = !known || !known.discovered || (scene.kind && !known.kind) || (scene.region && !known.region);
    if (!fresh) return undefined;
    const payload = { name: scene.name.trim() };
    if (scene.kind) payload.kind = scene.kind;
    if (scene.region) payload.region = scene.region;
    return { commands: [{ type: 'atlas.visit', payload }] };
}
