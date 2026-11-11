// Story Director v2, atlas part: what the model is told (pure).
//
// static: nothing of its own. The atlas's two kinds give the change-line instruction one line
// each (GRAMMAR), which Story Block writes under its `<Changes>` header (SPEC §5): fixed text.
// tail: one optional line, the known routes from the scene's place with how long each takes
// (travel.js; not the street legs between parts of the town the scene is in), within about 80 tokens; nothing when the place has no known route.

import { mapSettings } from '../../places.js';
import { packWorld, worldOf } from './world.js';
import { parentOf } from './parent.js';
import { travelTime } from './travel.js';
import { TRIP_FEATURE, calendarOf, tripLines, tripView } from './trip.js';

export const TAIL_BUDGET = 80;
/** The trip's own room (feature `story-director.trip`): "On the road: …" with a few stages to come, and the reached-a-place cue. */
export const TRIP_TAIL_BUDGET = 90;
// Characters the line may take: Story Block estimates tokens as characters / 4.
const MAX_CHARS = TAIL_BUDGET * 4;

/**
 * The atlas kinds' grammar: the route line carries the landmark's (one line for the family; the landmark has none of its own),
 * and both are taught only while the story has a route or a landmark (the lean diet, 3 Nov). The trip line only while a route is known.
 */
export const GRAMMAR = Object.freeze({
    route: '+ route Place — Other Place | hours: 2 (or days: 1.5) | kind: road|river|trail|sea (- route Place — Other Place when it is gone); + landmark Name | region: where | kind: town|ruin|cave|… | plane: underground (only off the surface)',
    landmark: '',
    trip: '~ trip Place | by: riding|foot|wagon|boat|ship | via: Stop, Stop (the party sets out by the known routes; ~ trip stop; ~ trip delay: 1 day | because: lame horse)',
});

/** The atlas's part of the static prompt: none beyond its kinds' grammar. */
export const STATIC_TEXT = '';

const settingsOf = view => (typeof view?.settings === 'function' ? view.settings() : view?.settings) ?? {};

/** The scene's place `{ name, kind, region }` through the `scene.place` query, else the state. */
export function scenePlace(view) {
    let place = null;
    try {
        if (typeof view?.query === 'function') place = view.query('scene.place');
    } catch {
        place = null;
    }
    place ??= view?.state?.domains?.scene?.place ?? null;
    return { name: String(place?.name ?? ''), kind: String(place?.kind ?? ''), region: String(place?.region ?? '') };
}

/** "Routes from Bluewatch Village: Old Weir by road, 2 h · Thunder Ruins by trail, ≈ 1.5 days." or ''. */
export function routesLine(world, here, { map } = {}) {
    const at = world.find(here);
    if (!at) return '';
    // Street legs inside a city ("Highmark Capital / Crown Keep", 0.5 day) tell the narrator nothing: skip a leg whose two ends are the same
    // town's parts (one the other's parent, or both under one parent); legs leaving the town stay.
    const parentId = place => (place.parent ? world.find(place.parent) : parentOf(place.name, world)?.parent)?.id ?? null;
    const insideOf = place => {
        const upId = parentId(place);
        return other => other.id === upId || parentId(other) === place.id || (upId !== null && parentId(other) === upId);
    };
    const otherEnd = (route, id) => world.places.find(place => place.id === (route.from === id ? route.to : route.from));
    // A place with no way out of its own ("Auvoth · Southern Gatehouse"), or only street legs inside its town (a district whose one road
    // is to its city), goes by the town's routes and names it.
    const up = at.parent ? world.find(at.parent) : parentOf(at.name, world)?.parent ?? null;
    const insideAt = insideOf(at);
    const leaves = world.routes.some(route => {
        if (route.from !== at.id && route.to !== at.id) return false;
        const other = otherEnd(route, at.id);
        return other && !insideAt(other);
    });
    const from = !leaves && up && up.id !== at.id ? up : at;
    const inside = insideOf(from);
    const items = world.routes
        .filter(route => route.from === from.id || route.to === from.id)
        .map(route => {
            const other = otherEnd(route, from.id);
            const trip = travelTime({ places: world.places, routes: [route], find: world.find }, from.id, other.id, { map });
            return { other, route, trip };
        })
        .filter(entry => entry.other && !inside(entry.other))
        .sort((a, b) => (a.trip?.days ?? Infinity) - (b.trip?.days ?? Infinity) || a.other.name.localeCompare(b.other.name));
    const head = `Routes from ${from.name}: `;
    let text = '';
    const seen = new Set();
    for (const { other, route, trip } of items) {
        if (seen.has(other.id)) continue;
        seen.add(other.id);
        const item = `${other.name}${route.kind ? ` by ${route.kind}` : ''}${trip ? `, ${trip.text}` : ''}`;
        const next = text ? `${text} · ${item}` : item;
        if ((head + next + '.').length > MAX_CHARS) break;
        text = next;
    }
    return text ? `${head}${text}.` : '';
}

/** `context.tail(view)` → `{ lines, optional }` (SPEC §5). */
export function atlasTail(view) {
    const atlas = view?.state?.domains?.atlas;
    if (!atlas) return { lines: [], optional: [] };
    const here = scenePlace(view).name;
    if (!here.trim()) return { lines: [], optional: [] };
    const world = worldOf(atlas, packWorld(typeof view?.query === 'function' ? (name, args) => view.query(name, args) : null));
    const line = routesLine(world, here, { map: mapSettings(settingsOf(view).map) });
    return { lines: [], optional: line ? [line] : [] };
}

/**
 * The trip's tail lines (a context part under feature `story-director.trip`): while a trip is on, "On the road: …", and when a stage's
 * arrival has passed and the story has not moved the place, the cue to write `~ place` (trip.js `tripLines`). `{ lines, optional }`.
 */
export function tripTail(view) {
    const none = { lines: [], optional: [] };
    const atlas = view?.state?.domains?.atlas;
    if (!atlas?.trips || (typeof view?.feature === 'function' && view.feature(TRIP_FEATURE) === false)) return none;
    const query = typeof view?.query === 'function' ? (name, args) => view.query(name, args) : null;
    let asked = null;
    try { asked = query ? query('director.time', {}) : null; } catch { asked = null; }
    const minutes = Number.isSafeInteger(asked?.minutes) ? asked.minutes : view?.state?.domains?.director?.time?.minutes;
    if (!Number.isSafeInteger(minutes)) return none;
    const shown = tripView(atlas, { now: minutes, here: scenePlace(view).name, calendar: calendarOf(query) });
    return { lines: tripLines(shown), optional: [] };
}
