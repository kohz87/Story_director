// Story Director v2, part **atlas**: the `atlas` domain's shape, validator and name index (pure).
//
// atlas = {
//   places: { [id]: { id, name, region, kind, layer, x?, y?, discovered, rev } },
//   routes: { [id]: { id, from, to, kind, days?, hours? } },
//   keys:   { [keyOf(name or alias)]: placeId },
//   focus:  null | placeId | 'pack:<key>',        // the place the reader picked on the map
// }
// Places and routes from enabled packs (`packs.content`) are not copied in: they are read live
// (world.js) and show as known but undiscovered until the story goes there, when `atlas.visit`
// adds the place here.
// A place is known by its name and every name it was reached by (a rename keeps the old one as
// an alias). `discovered` is false for a place only a route line named, until the story goes
// there or describes it. `layer` is the place's plane ("underground"), '' on the surface.
// Numbers are whole (SPEC §2.1, and the host keeps a whole number whole): coordinates in map
// units, a route's time in whole days and hours.

export const PLACE_ID = /^pl_[0-9a-z]{8}$/;
export const ROUTE_ID = /^rt_[0-9a-z]{8}$/;
export const MAX_NAME = 80;
/** A pack place the atlas has not got yet is node `pack:<key>` on the map. */
export const PACK_NODE = 'pack:';
const ID_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';

export function initialAtlas() {
    return { places: {}, routes: {}, keys: {}, focus: null };
}

/** The key a name is found by: v1's place book key (apostrophes dropped, spaces folded, lowercase). */
export const keyOf = name => String(name ?? '').normalize('NFKC').replace(/['’‘`]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** A name as it is kept: markdown marks dropped, spaces folded, at most 80 characters. */
export function cleanName(name) {
    return String(name ?? '').replace(/\*\*|__|[*`]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME).trim();
}

/** A kind, region or layer word as it is kept: lowercase for kinds, as written for the rest. */
export const cleanWord = (value, { lower = false } = {}) => {
    const text = cleanName(value);
    return lower ? text.toLowerCase() : text;
};

const isInt = value => Number.isSafeInteger(value);
export const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The revision this command commits as (MODULES §F2 `ctx.rev`), 0 when the host does not say. */
export const revOf = ctx => (Number.isSafeInteger(ctx?.rev) ? ctx.rev : 0);

/** A fresh `<prefix>_xxxxxxxx` id from the command's seed (no Math.random), not in `taken`. */
export function newId(ctx, prefix, taken) {
    for (let tries = 0; tries < 64; tries += 1) {
        let id = '';
        for (let i = 0; i < 8; i += 1) id += ID_CHARS[Math.floor(ctx.rng() * ID_CHARS.length) % ID_CHARS.length];
        id = `${prefix}_${id}`;
        if (!Object.hasOwn(taken, id)) return id;
    }
    throw new Error(`No free ${prefix} id.`);
}

/** The place `ref` names: an id, or a name or alias. Null when none. */
export function findPlace(atlas, ref) {
    if (!atlas || ref === null || ref === undefined) return null;
    const text = String(ref);
    if (Object.hasOwn(atlas.places ?? {}, text)) return atlas.places[text];
    const id = atlas.keys?.[keyOf(text)];
    return id && Object.hasOwn(atlas.places ?? {}, id) ? atlas.places[id] : null;
}

/** Places in a fixed order (the same however and whenever they were touched): by name, then id. */
export function orderedPlaces(atlas) {
    return Object.values(atlas?.places ?? {}).sort((a, b) => keyOf(a.name).localeCompare(keyOf(b.name)) || (a.id < b.id ? -1 : 1));
}

/** Routes in a fixed order: by the places' order, then kind, then id. */
export function orderedRoutes(atlas) {
    const rank = new Map(orderedPlaces(atlas).map((place, index) => [place.id, index]));
    const at = id => rank.get(id) ?? Infinity;
    return Object.values(atlas?.routes ?? {}).sort((a, b) => Math.min(at(a.from), at(a.to)) - Math.min(at(b.from), at(b.to))
        || Math.max(at(a.from), at(a.to)) - Math.max(at(b.from), at(b.to)) || a.kind.localeCompare(b.kind) || (a.id < b.id ? -1 : 1));
}

/** The routes between two place ids, either way round. */
export const routesBetween = (atlas, a, b) => orderedRoutes(atlas).filter(route => (route.from === a && route.to === b) || (route.from === b && route.to === a));

/** A route's time in hours (days count 24), or null when the story gave none. */
export function routeHours(route) {
    if (!route || (route.days === undefined && route.hours === undefined)) return null;
    return (route.days ?? 0) * 24 + (route.hours ?? 0);
}

function placeErrors(id, place) {
    const at = `atlas.places.${id}`;
    if (!isRecord(place)) return [`${at} is not a place.`];
    const errors = [];
    if (!PLACE_ID.test(id) || place.id !== id) errors.push(`${at} has a bad id.`);
    if (typeof place.name !== 'string' || !keyOf(place.name) || place.name.length > MAX_NAME) errors.push(`${at} needs a name of at most ${MAX_NAME} characters.`);
    for (const field of ['region', 'kind', 'layer']) {
        if (typeof place[field] !== 'string' || place[field].length > MAX_NAME) errors.push(`${at}.${field} must be text of at most ${MAX_NAME} characters.`);
    }
    const hasX = place.x !== undefined;
    const hasY = place.y !== undefined;
    if (hasX !== hasY) errors.push(`${at} needs both x and y, or neither.`);
    else if (hasX && !(isInt(place.x) && isInt(place.y))) errors.push(`${at}: x and y must be whole map units.`);
    if (typeof place.discovered !== 'boolean') errors.push(`${at}.discovered must be true or false.`);
    if (!isInt(place.rev) || place.rev < 0) errors.push(`${at}.rev must be a whole number.`);
    for (const key of Object.keys(place)) {
        if (!['id', 'name', 'region', 'kind', 'layer', 'x', 'y', 'discovered', 'rev'].includes(key)) errors.push(`${at} has an unknown field "${key}".`);
    }
    return errors;
}

function routeErrors(id, route, places) {
    const at = `atlas.routes.${id}`;
    if (!isRecord(route)) return [`${at} is not a route.`];
    const errors = [];
    if (!ROUTE_ID.test(id) || route.id !== id) errors.push(`${at} has a bad id.`);
    if (!Object.hasOwn(places, route.from) || !Object.hasOwn(places, route.to)) errors.push(`${at} leads to a place the atlas does not have.`);
    if (route.from === route.to) errors.push(`${at} leads nowhere (both ends are the same place).`);
    if (typeof route.kind !== 'string' || route.kind.length > MAX_NAME) errors.push(`${at}.kind must be text.`);
    for (const field of ['days', 'hours']) {
        if (route[field] !== undefined && !(isInt(route[field]) && route[field] >= 0)) errors.push(`${at}.${field} must be a whole number.`);
    }
    if (routeHours(route) === 0) errors.push(`${at} takes no time at all.`);
    for (const key of Object.keys(route)) {
        if (!['id', 'from', 'to', 'kind', 'days', 'hours'].includes(key)) errors.push(`${at} has an unknown field "${key}".`);
    }
    return errors;
}

/** `validate(slice, state) → string[]` (SPEC §2.5). */
export function validateAtlas(slice) {
    if (!isRecord(slice)) return ['atlas is not an object.'];
    const errors = [];
    const places = isRecord(slice.places) ? slice.places : null;
    if (!places) errors.push('atlas.places is not an object.');
    else for (const [id, place] of Object.entries(places)) errors.push(...placeErrors(id, place));
    if (!isRecord(slice.routes)) errors.push('atlas.routes is not an object.');
    else if (places) for (const [id, route] of Object.entries(slice.routes)) errors.push(...routeErrors(id, route, places));
    if (!isRecord(slice.keys)) errors.push('atlas.keys is not an object.');
    else if (places) {
        for (const [key, id] of Object.entries(slice.keys)) {
            if (!Object.hasOwn(places, id)) errors.push(`atlas.keys["${key}"] points at no place.`);
            else if (key !== keyOf(key) || !key) errors.push(`atlas.keys["${key}"] is not a name key.`);
        }
        for (const place of Object.values(places)) {
            if (typeof place?.name === 'string' && slice.keys[keyOf(place.name)] !== place.id) errors.push(`"${place.name}" is missing from atlas.keys.`);
        }
    }
    const focus = slice.focus;
    const packFocus = typeof focus === 'string' && focus.startsWith(PACK_NODE) && keyOf(focus.slice(PACK_NODE.length)) === focus.slice(PACK_NODE.length) && focus.length > PACK_NODE.length;
    if (focus !== null && !packFocus && !(typeof focus === 'string' && places && Object.hasOwn(places, focus))) errors.push('atlas.focus must be null or a place on the map.');
    for (const key of Object.keys(slice)) {
        if (!['places', 'routes', 'keys', 'focus'].includes(key)) errors.push(`atlas has an unknown field "${key}".`);
    }
    return errors;
}
