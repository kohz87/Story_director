// Places: the ones the story has been to, read from the scene block's location, and what a
// map's coordinates say about them.
//
// Every reply's World State names where the scene is ("Auvoth | Seventh Seal Terrace"), and
// many presets add map coordinates ("[59.0, 110.0]"). Replayed in order, those make a place
// book without anyone writing a world pack: each place (the first part of the location),
// the spots inside it (the rest), how often and when the story was there, and its latest
// coordinates. A world pack's places add coordinates for places the story has not reached,
// and win over the story's for places it knows (0.8.8): the pack is the reader's own map, while
// a reply's coordinates are the model's and drift; a disagreement is kept so it can be shown.
//
// The map settings say how to read coordinates: which way north and east run (a picture's
// y grows downwards, a chart's upwards) and how many km one unit is. From those come
// distances, compass directions, places "nearby", and a travel estimate by straight line
// times a road factor (roads wind), counted with the same round-up and rest-day rules as a
// world pack's roads. Pure.

import { DEFAULT_RULES, legDays, restDaysFor } from './routes.js';

export const DEFAULT_MAP = Object.freeze({ north: 'up', east: 'right', kmPerUnit: 1, roadFactor: 1.25 });

// Paces without a world pack, km per day.
export const DEFAULT_PACES = Object.freeze({ foot: 20, ride: 35, wagon: 18, boat: 35, ship: 110, flight: 130, courier: 70 });

const COORDS = /[[(]\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*[\])]/;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const EPSILON = 1e-9;

// Apostrophes are dropped, so "Hollins Reach" in a reply is the pack's "Hollin's Reach".
const keyOf = name => String(name ?? '').normalize('NFKC').replace(/['’‘`]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
// How far (map units) a reply's coordinates may sit from the pack's before it counts as a disagreement.
const COORDS_SLACK = 1;
const finite = value => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** The map settings, completed and bounded. */
export function mapSettings(map = {}) {
    const given = map && typeof map === 'object' ? map : {};
    const km = Number(given.kmPerUnit);
    const factor = Number(given.roadFactor);
    return {
        north: given.north === 'down' ? 'down' : 'up',
        east: given.east === 'left' ? 'left' : 'right',
        kmPerUnit: km > 0 ? km : DEFAULT_MAP.kmPerUnit,
        roadFactor: factor >= 1 ? factor : DEFAULT_MAP.roadFactor,
    };
}

/**
 * "Auvoth | Seventh Seal Terrace | [59.0, 110.0]" →
 * { name: 'Auvoth', spot: 'Seventh Seal Terrace', parts, coords: { x: 59, y: 110 } }.
 */
export function parseLocation(text) {
    const source = String(text ?? '').replace(/\*\*/g, '');
    const match = COORDS.exec(source);
    const coords = match ? { x: Number(match[1]), y: Number(match[2]) } : null;
    const parts = (match ? source.replace(match[0], '') : source)
        .split(/\s*(?:\||·|—|–)\s*/)
        .map(part => part.replace(/\[[^\]]*\]/g, '').trim())
        .filter(Boolean);
    return { name: parts[0] ?? '', spot: parts.slice(1).join(' · '), parts, coords };
}

/**
 * The place book from the scene's locations, in chat order:
 * visits = [{ message, time, text }] → { places, current }.
 * A place: { key, name, coords, coordsFrom: 'story' | 'pack' | null, storyCoords, visits,
 * firstTime, lastTime, lastMessage, spots: [latest first] }. The pack's coordinates win;
 * `storyCoords` is the reply's latest when it is more than a map unit away from them, else null. `places` is most recently visited first;
 * places only a world pack knows (`visits: 0`) come last.
 */
export function buildPlaceBook(visits, { pack = null } = {}) {
    const byKey = new Map();
    let previous = null;
    let current = null;
    for (const visit of Array.isArray(visits) ? visits : []) {
        const location = parseLocation(visit?.text);
        if (!location.name) continue;
        const key = keyOf(location.name);
        let place = byKey.get(key);
        if (!place) {
            place = { key, name: location.name, coords: null, coordsFrom: null, storyCoords: null, visits: 0, firstTime: null, lastTime: null, lastMessage: null, spots: [] };
            byKey.set(key, place);
        }
        // A stay over several replies is one visit.
        if (previous !== key) place.visits += 1;
        previous = key;
        current = key;
        if (location.coords) {
            place.coords = location.coords;
            place.coordsFrom = 'story';
        }
        const time = finite(visit?.time);
        if (time !== null) {
            place.firstTime ??= time;
            place.lastTime = time;
        }
        place.lastMessage = visit?.message ?? place.lastMessage;
        if (location.spot) {
            place.spots = [location.spot, ...place.spots.filter(spot => keyOf(spot) !== keyOf(location.spot))];
        }
    }
    // A world pack's coordinates win over the story's, fill in the ones it never wrote, and add
    // the rest of the map.
    for (const [name, info] of Object.entries(pack?.places ?? {})) {
        const x = finite(info?.x);
        const y = finite(info?.y);
        if (x === null || y === null) continue;
        const key = keyOf(name);
        const place = byKey.get(key);
        if (place) {
            const story = place.coords;
            place.name = name;   // the pack's spelling
            place.coords = { x, y };
            place.coordsFrom = 'pack';
            place.storyCoords = story && Math.hypot(story.x - x, story.y - y) > COORDS_SLACK ? story : null;
        } else {
            byKey.set(key, { key, name, coords: { x, y }, coordsFrom: 'pack', storyCoords: null, visits: 0, firstTime: null, lastTime: null, lastMessage: null, spots: [] });
        }
    }
    const places = [...byKey.values()].sort((a, b) => {
        if (!a.visits !== !b.visits) return a.visits ? -1 : 1;
        return (b.lastMessage ?? -1) - (a.lastMessage ?? -1) || a.name.localeCompare(b.name);
    });
    return { places, current };
}

/** The place for a name: exact first, then one whose name the text starts with. */
export function findBookPlace(book, text) {
    const key = keyOf(parseLocation(text).name || text);
    if (!key) return null;
    const places = book?.places ?? [];
    return places.find(place => place.key === key)
        ?? places.filter(place => key.startsWith(place.key) || place.key.startsWith(key))
            .sort((a, b) => b.key.length - a.key.length)[0]
        ?? null;
}

/** Straight-line km between two places with coordinates, or null. */
export function distanceKm(a, b, map = DEFAULT_MAP) {
    if (!a?.coords || !b?.coords) return null;
    const { kmPerUnit } = mapSettings(map);
    return Math.hypot(b.coords.x - a.coords.x, b.coords.y - a.coords.y) * kmPerUnit;
}

/** The compass direction from `a` to `b` ("NE"), or '' when they share a spot or lack coordinates. */
export function bearing(a, b, map = DEFAULT_MAP) {
    if (!a?.coords || !b?.coords) return '';
    const settings = mapSettings(map);
    const east = (b.coords.x - a.coords.x) * (settings.east === 'left' ? -1 : 1);
    const north = (b.coords.y - a.coords.y) * (settings.north === 'down' ? -1 : 1);
    if (Math.abs(east) < EPSILON && Math.abs(north) < EPSILON) return '';
    const degrees = (Math.atan2(east, north) * 180 / Math.PI + 360) % 360;
    return COMPASS[Math.round(degrees / 45) % 8];
}

/** Places with coordinates within `maxKm` in a straight line of `place` (nearest first), itself excluded. */
export function nearbyByCoords(book, place, { maxKm = 100, map = DEFAULT_MAP } = {}) {
    const here = typeof place === 'string' ? findBookPlace(book, place) : place;
    if (!here?.coords) return [];
    return (book?.places ?? [])
        .filter(other => other.key !== here.key && other.coords)
        .map(other => ({ place: other, km: distanceKm(here, other, map) }))
        .filter(entry => entry.km <= maxKm)
        .sort((a, b) => a.km - b.km)
        .map(entry => entry.place);
}

/**
 * A trip estimated from coordinates: { from, to, straightKm, roadKm, mode, rate, days,
 * restDays, direction } or null without coordinates. Road km is the straight line times the
 * road factor; days round up like a road (to the half day) and add a rest day after every
 * six days on land, except for couriers.
 */
export function estimateTrip(from, to, { map = DEFAULT_MAP, mode = 'foot', rate = null, rules = DEFAULT_RULES } = {}) {
    const straightKm = distanceKm(from, to, map);
    if (straightKm === null) return null;
    const settings = mapSettings(map);
    const travel = Object.hasOwn(DEFAULT_PACES, mode) ? mode : 'foot';
    const pace = rate > 0 ? rate : DEFAULT_PACES[travel];
    // Water and air go straight; roads wind.
    const winding = ['boat', 'ship', 'flight'].includes(travel) ? 1 : settings.roadFactor;
    const roadKm = straightKm * winding;
    const active = legDays(roadKm, pace, rules) ?? 0;
    const restDays = restDaysFor(travel, active, rules);
    return { from, to, straightKm, roadKm, mode: travel, rate: pace, days: active + restDays, restDays, direction: bearing(from, to, map) };
}

const round = (value, digits = 0) => {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
};

/** "Shorn → Auvoth ≈ 176 km NE (≈ 141 km straight × 1.25) · foot 20/day · 9.5 days (1 rest)". */
export function formatTrip(trip, { map = DEFAULT_MAP } = {}) {
    if (!trip) return '';
    const settings = mapSettings(map);
    const straight = ['boat', 'ship', 'flight'].includes(trip.mode);
    const distance = straight
        ? `${round(trip.straightKm)} km ${trip.direction}`.trim()
        : `≈ ${round(trip.roadKm)} km ${trip.direction} (≈ ${round(trip.straightKm)} km straight × ${settings.roadFactor})`.replace(/ {2,}/g, ' ');
    const rest = trip.restDays ? ` (${trip.restDays} rest)` : '';
    return `${trip.from.name} → ${trip.to.name} ${distance} · ${trip.mode} ${round(trip.rate, 1)}/day · ${trip.days} ${trip.days === 1 ? 'day' : 'days'}${rest}`;
}
