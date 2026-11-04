// Story Director: world-pack loading and place lookup for the route files (pure).
//
// Route constants (codes, modes, rules), loadWorldPack and its readers, the per-pack lookup
// index, place matching (findPlace, placesIn, exitsFrom, edgesBetween) and normalizeMode.
// Split out of routes.js; routes.js still re-exports every name it exported before.

import { finite, isObject, names, nonNegative, num, positive } from './util.js';

export const ROUTE_CODES = Object.freeze({
    W: 'river or canal',
    R: 'maintained road',
    L: 'local',
    B: 'bastion road',
    F: 'frontier road',
    C: 'caravan',
    A: 'aerial',
    G: 'dungeon approach',
    S: 'sea',
    T: 'trail',
    M: 'mountain',
    U: 'tunnel',
    H: 'hidden',
    X: 'seasonal or expedition',
    D: 'deep sea',
});

export const MODES = Object.freeze(['foot', 'ride', 'wagon', 'boat', 'ship', 'flight', 'courier']);

// Modern travel (0.9.0): a pack with `"era": "modern"` (or `pace_km_per_hour`) uses these road
// codes and modes, paces in km an hour, and times in hours. Each code says which modes may use
// it and how fast; a mode a code leaves out cannot use it. A pack's own paces are merged over
// these, and may add codes of its own (one to three capital letters).
export const MODERN_MODES = Object.freeze(['foot', 'bike', 'car', 'motorbike', 'bus', 'train', 'metro', 'ferry', 'ship', 'plane']);
export const MODERN_CODES = Object.freeze({
    MW: { name: 'motorway or highway', paces: { car: 100, motorbike: 100, bus: 80 } },
    RD: { name: 'road', paces: { car: 60, motorbike: 60, bus: 45, bike: 18, foot: 5 } },
    ST: { name: 'city streets', paces: { car: 25, motorbike: 25, bus: 18, bike: 15, foot: 5 } },
    OR: { name: 'off-road or dirt track', paces: { car: 30, motorbike: 30, bike: 10, foot: 4 } },
    TR: { name: 'trail or footpath', paces: { bike: 12, foot: 4 } },
    RL: { name: 'railway', paces: { train: 90 }, board: 0.25 },
    HS: { name: 'high-speed rail', paces: { train: 250 }, board: 0.5 },
    MT: { name: 'metro, subway or tram', paces: { metro: 30 } },
    FY: { name: 'ferry', paces: { ferry: 30, car: 30, motorbike: 30, bike: 30, foot: 30 }, board: 0.5 },
    SL: { name: 'sea lane', paces: { ship: 35 }, board: 1 },
    AR: { name: 'air route', paces: { plane: 750 }, board: 2 },
});
// Trains, planes and boats are reached by a short ride or walk: a hop the mode cannot take,
// up to this long, goes by the first of these that can (a taxi, else on foot).
export const TRANSFER_MODES = ['car', 'foot'];
export const TRANSFER_KM = 60;
// The mode a modern leg most likely means when it names only a road code.
export const MODERN_DEFAULT_MODE = { MW: 'car', RD: 'car', ST: 'foot', OR: 'car', TR: 'foot', RL: 'train', HS: 'train', MT: 'metro', FY: 'ferry', SL: 'ship', AR: 'plane' };
// Modes someone drives, rides or walks themselves: they stop for the night on long trips.
export const SELF_MODES = ['foot', 'bike', 'car', 'motorbike'];
export const MODERN_ALIASES = {
    walk: 'foot', walking: 'foot', walks: 'foot', hike: 'foot', hiking: 'foot', 'on foot': 'foot',
    bicycle: 'bike', cycle: 'bike', cycling: 'bike', biking: 'bike', bikes: 'bike',
    drive: 'car', driving: 'car', drives: 'car', cars: 'car', taxi: 'car', cab: 'car', van: 'car', truck: 'car',
    motorcycle: 'motorbike', scooter: 'motorbike', moped: 'motorbike',
    coach: 'bus', buses: 'bus',
    rail: 'train', trains: 'train',
    subway: 'metro', underground: 'metro', tube: 'metro', tram: 'metro',
    boat: 'ferry', ferries: 'ferry',
    ships: 'ship', cruise: 'ship',
    fly: 'plane', flying: 'plane', flies: 'plane', flight: 'plane', planes: 'plane', airplane: 'plane', aeroplane: 'plane', jet: 'plane',
};
export const MODERN_RULES = Object.freeze({ unit: 'hour', roundUpTo: 0.25, driveHoursPerDay: 10 });

// Words the model writes for a mode.
export const MODE_ALIASES = {
    walk: 'foot', walking: 'foot', walks: 'foot', hike: 'foot', hiking: 'foot',
    rides: 'ride', riding: 'ride', rider: 'ride', riders: 'ride', horse: 'ride', horseback: 'ride', mounted: 'ride',
    wagons: 'wagon', cart: 'wagon', carts: 'wagon', dray: 'wagon',
    boats: 'boat', barge: 'boat', ferry: 'boat', riverboat: 'boat', keelboat: 'boat',
    ships: 'ship', sail: 'ship', sailing: 'ship',
    fly: 'flight', flying: 'flight', flies: 'flight',
    couriers: 'courier', messenger: 'courier',
};

export const LAND_MODES = ['foot', 'ride', 'wagon'];
export const WATER_MODES = ['boat', 'ship'];
// Pace keys of the normalized shape; the reference format writes `downstream_favorable`.
const PACE_KEYS = ['foot', 'ride', 'wagon', 'boat', 'upstream', 'downstream', 'ship', 'vessel', 'flight'];
const PACE_ALIASES = { downstream_favorable: 'downstream' };

export const DEFAULT_RULES = Object.freeze({
    roundUpTo: 0.5, restDayEvery: 6, crewedWaterRest: false, leveeRoads: [], noLevee: [],
});
export const DEFAULT_COURIER_MULTIPLIER = 2;

export const KM_TOLERANCE = 0.05;
export const DAYS_TOLERANCE = 0.5;
// Float sums like 2.0000000001 must not round up to the next half day.
export const EPSILON = 1e-9;
// "Blue" alone is too little to stand for "Bluewatch Village".
const MIN_PREFIX = 4;

// ---------------------------------------------------------------------------------------
// Loading

/**
 * Reads a world pack (JSON text or an object) in the reference format or the normalized
 * shape. Bad edges are skipped with a warning; an edge endpoint missing from `places` is a
 * warning (once per name) and the edge is kept, so the graph stays whole.
 */
export function loadWorldPack(json) {
    const errors = [];
    const warnings = [];
    const fail = message => ({ pack: null, errors: [...errors, message], warnings });

    let data = json;
    if (typeof json === 'string') {
        try {
            data = JSON.parse(json);
        } catch (error) {
            return fail(`Not valid JSON: ${error.message}`);
        }
    }
    if (!isObject(data)) return fail('A world pack must be a JSON object.');

    const places = readPlaces(data.places, errors);
    if (!places) return fail('The pack has no `places` object.');
    if (!Array.isArray(data.edges)) return fail('The pack has no `edges` list.');

    const edges = [];
    data.edges.forEach((raw, index) => {
        const edge = readEdge(raw);
        if (typeof edge === 'string') warnings.push(`Edge ${index + 1} skipped: ${edge}.`);
        else edges.push(edge);
    });
    if (!edges.length) return fail('The pack has no usable edges.');

    const missing = new Map();
    for (const edge of edges) {
        for (const name of [edge.a, edge.b]) {
            if (!Object.hasOwn(places, name)) missing.set(name, (missing.get(name) ?? 0) + 1);
        }
    }
    for (const [name, count] of missing) {
        warnings.push(`"${name}" is on ${count} ${count === 1 ? 'edge' : 'edges'} but not in places.`);
    }
    const codes = new Set(edges.map(edge => edge.code));
    const modern = isModernPack(data);
    const ownPaces = data.paces ?? data.pace_km_per_hour;
    for (const code of codes) {
        if (modern) {
            if (!Object.hasOwn(MODERN_CODES, code) && !(isObject(ownPaces) && Object.keys(ownPaces).some(key => key.trim().toUpperCase() === code))) {
                warnings.push(`Unknown road code "${code}" with no paces in pace_km_per_hour (nothing can use it).`);
            }
        } else if (!Object.hasOwn(ROUTE_CODES, code)) warnings.push(`Unknown road code "${code}" (R pace used).`);
    }

    warnings.push(...mapWarnings(places, edges, positive(data.scaleKmPerUnit ?? data.scale_km_per_unit)));

    const rules = data.rules ?? data.travel_rules ?? {};
    const pack = {
        name: String(data.name ?? data.source ?? ''),
        era: modern ? 'modern' : 'pre-modern',
        calendar: isObject(data.calendar) ? data.calendar : null,
        scaleKmPerUnit: positive(data.scaleKmPerUnit ?? data.scale_km_per_unit),
        places,
        edges,
        paces: modern ? modernPaces(data.paces ?? data.pace_km_per_hour, warnings) : readPaces(data.paces ?? data.pace_km_per_day, warnings),
        courierMultiplier: positive(data.courierMultiplier ?? data.courier_multiplier) ?? DEFAULT_COURIER_MULTIPLIER,
        rules: modern ? {
            unit: 'hour',
            roundUpTo: nonNegative(rules.roundUpTo ?? rules.round_edge_up_to_hours) ?? MODERN_RULES.roundUpTo,
            driveHoursPerDay: positive(rules.driveHoursPerDay ?? rules.drive_hours_per_day) ?? MODERN_RULES.driveHoursPerDay,
            restDayEvery: 0, crewedWaterRest: false, leveeRoads: [], noLevee: [],
        } : {
            roundUpTo: nonNegative(rules.roundUpTo ?? rules.round_edge_up_to_days) ?? DEFAULT_RULES.roundUpTo,
            restDayEvery: nonNegative(rules.restDayEvery ?? rules.rest_day_every_active_days) ?? DEFAULT_RULES.restDayEvery,
            crewedWaterRest: Boolean(rules.crewedWaterRest ?? rules.crewed_water_rest_days ?? false),
            leveeRoads: names(rules.leveeRoads ?? rules.levee_roads),
            noLevee: names(rules.noLevee ?? rules.no_levee),
        },
    };
    return { pack, errors, warnings };
}

// A modern pack says so, or gives its paces per hour.
function isModernPack(data) {
    const era = String(data?.era ?? '').trim().toLowerCase();
    if (era) return era === 'modern';
    if (data?.unit === 'hour' || data?.rules?.unit === 'hour') return true;
    return isObject(data?.pace_km_per_hour);
}

// The modern table with the pack's own paces merged over it: { CODE: { mode: pace } }. A pace
// of null takes a mode off a code.
function modernPaces(source, warnings) {
    const paces = Object.fromEntries(Object.entries(MODERN_CODES).map(([code, info]) => [code, { ...info.paces, ...(info.board ? { boardHours: info.board } : {}) }]));
    if (!isObject(source)) return paces;
    for (const [rawCode, table] of Object.entries(source)) {
        const code = rawCode.trim().toUpperCase();
        if (!isObject(table)) continue;
        paces[code] ??= {};
        for (const [rawKey, value] of Object.entries(table)) {
            if (rawKey === 'board_hours' || rawKey === 'boardHours') {
                if (nonNegative(value) === null) warnings.push(`Pace ${code}.${rawKey} is not a number of hours.`);
                else paces[code].boardHours = value;
                continue;
            }
            const key = normalizeMode(rawKey, { era: 'modern' });
            if (!key) {
                warnings.push(`Pace ${code}.${rawKey}: "${rawKey}" is not a modern mode (${MODERN_MODES.join(', ')}).`);
                continue;
            }
            const pace = readPace(value);
            if (pace === undefined || pace === 'foot') warnings.push(`Pace ${code}.${rawKey} is not a number, range or null.`);
            else if (pace === null) delete paces[code][key];
            else paces[code][key] = pace;
        }
    }
    return paces;
}

function readPlaces(source, errors) {
    const entries = Array.isArray(source)
        ? source.map(place => [place?.name, place])
        : isObject(source) ? Object.entries(source) : null;
    if (!entries) return null;
    const places = {};
    for (const [rawName, value] of entries) {
        const name = typeof rawName === 'string' ? rawName.trim() : '';
        if (!name) {
            errors.push('A place without a name was skipped.');
            continue;
        }
        const info = isObject(value) ? value : {};
        places[name] = {
            x: finite(info.x),
            y: finite(info.y),
            region: typeof info.region === 'string' ? info.region : null,
        };
    }
    return places;
}

// Returns the edge, or why it cannot be used.
function readEdge(raw) {
    if (!isObject(raw)) return 'not an object';
    const a = typeof raw.a === 'string' ? raw.a.trim() : '';
    const b = typeof raw.b === 'string' ? raw.b.trim() : '';
    if (!a || !b) return 'an endpoint is missing';
    if (a === b) return `"${a}" links to itself`;
    const km = positive(Number(raw.km));
    if (km === null) return `${a} – ${b} has no km`;
    const code = typeof raw.code === 'string' ? raw.code.trim().toUpperCase() : '';
    if (!code) return `${a} – ${b} has no road code`;
    if (!/^[A-Z]{1,3}$/.test(code)) return `${a} – ${b} has the road code "${raw.code}" (one to three letters)`;
    return {
        a, b, km, code,
        corridor: typeof raw.corridor === 'string' && raw.corridor.trim() ? raw.corridor.trim() : null,
        notes: typeof raw.notes === 'string' && raw.notes.trim() ? raw.notes : null,
        bearing: typeof raw.bearing === 'string' && raw.bearing.trim() ? raw.bearing.trim().toUpperCase() : null,
    };
}

// A pack made by hand or by a model can contradict itself (0.8.8): a road shorter than the
// straight line between its places, or a road's stated bearing ("SW/NE": b lies SW of a) that
// its coordinates do not give. Coordinates are read with y growing north; when the bearings
// fit y growing south instead, one warning says to set North is to Down.
const COMPASS_16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const STRAIGHT_SLACK = 0.9;

function mapWarnings(places, edges, scale) {
    const warnings = [];
    const off = { up: [], down: [] };
    let stated = 0;
    for (const edge of edges) {
        const a = places[edge.a];
        const b = places[edge.b];
        if (![a?.x, a?.y, b?.x, b?.y].every(value => value !== null && value !== undefined)) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        if (scale) {
            const straight = Math.hypot(dx, dy) * scale;
            if (edge.km < straight * STRAIGHT_SLACK) warnings.push(`${edge.a} – ${edge.b} is ${num(edge.km)} km, but the places are ${Math.round(straight)} km apart in a straight line.`);
        }
        const want = COMPASS_16.indexOf(String(edge.bearing ?? '').split('/')[0].trim());
        if (want < 0 || (dx === 0 && dy === 0)) continue;
        stated += 1;
        for (const north of ['up', 'down']) {
            const degrees = (Math.atan2(dx, north === 'up' ? dy : -dy) * 180 / Math.PI + 360) % 360;
            const gap = Math.abs(((degrees - want * 22.5) % 360 + 540) % 360 - 180);
            // Within one 8-point step (45°) agrees; coordinates are rounded and roads bend.
            if (gap > 45 + 1e-9) off[north].push({ edge, given: COMPASS_16[want], got: COMPASS_16[Math.round(degrees / 22.5) % 16] });
        }
    }
    if (stated && off.down.length < off.up.length && off.up.length > stated / 2) {
        warnings.unshift('The roads\' bearings fit a map whose y grows southwards (an image): set Map & travel → North is to Down.');
    } else {
        for (const { edge, given, got } of off.up) warnings.push(`${edge.a} – ${edge.b} says ${edge.b} lies ${given} of ${edge.a}, but the coordinates put it ${got}.`);
    }
    return warnings;
}

function readPaces(source, warnings) {
    const paces = {};
    if (!isObject(source)) return paces;
    for (const [rawCode, table] of Object.entries(source)) {
        const code = rawCode.trim().toUpperCase();
        paces[code] = {};
        if (!isObject(table)) continue;
        for (const [rawKey, value] of Object.entries(table)) {
            const key = PACE_ALIASES[rawKey] ?? rawKey;
            if (!PACE_KEYS.includes(key)) continue;   // notes, units
            const pace = readPace(value);
            if (pace === undefined) warnings.push(`Pace ${code}.${rawKey} is not a number, range, "foot" or null.`);
            else paces[code][key] = pace;
        }
    }
    return paces;
}

// number | [low, high] | 'foot' | null; undefined when unreadable.
function readPace(value) {
    if (value === null || value === 'foot') return value;
    if (positive(value) !== null) return value;
    if (Array.isArray(value) && value.length === 2 && value.every(n => positive(n) !== null)) {
        return [Math.min(...value), Math.max(...value)];
    }
    return undefined;
}

export function packSummary(pack) {
    if (!pack) return 'no world pack';
    const places = Object.keys(pack.places ?? {}).length;
    const routes = (pack.edges ?? []).length;
    return `${places} ${places === 1 ? 'place' : 'places'} · ${routes} ${routes === 1 ? 'route' : 'routes'}${pack.era === 'modern' ? ' · modern' : ''}`;
}

// ---------------------------------------------------------------------------------------
// Places

const INDEXES = new WeakMap();

// Known places are those in `places` and every edge endpoint (some packs link districts
// they never list). Names are compared lowercased, with straight apostrophes.
export function indexOf(pack) {
    let index = INDEXES.get(pack);
    if (index) return index;
    const byKey = new Map();
    const adjacency = new Map();
    const add = name => {
        if (!byKey.has(normalizeName(name))) byKey.set(normalizeName(name), name);
        if (!adjacency.has(name)) adjacency.set(name, []);
    };
    Object.keys(pack.places ?? {}).forEach(add);
    for (const edge of pack.edges ?? []) {
        add(edge.a);
        add(edge.b);
        adjacency.get(edge.a).push(edge);
        adjacency.get(edge.b).push(edge);
    }
    const longestFirst = [...byKey].sort((x, y) => y[0].length - x[0].length);
    index = { byKey, adjacency, longestFirst };
    INDEXES.set(pack, index);
    return index;
}

export function normalizeName(text) {
    return String(text ?? '').replace(/[’‘ʼ`]/g, '\'').replace(/\s+/g, ' ').trim().toLowerCase();
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

function containsWord(haystack, needle) {
    for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1)) {
        const before = haystack[at - 1];
        const after = haystack[at + needle.length];
        if ((!before || !WORD_CHAR.test(before)) && (!after || !WORD_CHAR.test(after))) return true;
    }
    return false;
}

/**
 * The place named inside `text`: the longest name found as whole words, case-insensitive,
 * curly or straight apostrophes. Failing that, when the whole text is the first word(s) of
 * exactly one place ("Bluewatch" for "Bluewatch Village"), that place.
 */
export function findPlace(pack, text) {
    if (!pack || typeof text !== 'string') return null;
    const haystack = normalizeName(text);
    if (!haystack) return null;
    const { longestFirst } = indexOf(pack);
    for (const [key, name] of longestFirst) {
        if (containsWord(haystack, key)) return name;
    }
    if (haystack.length >= MIN_PREFIX) {
        const hits = longestFirst.filter(([key]) => key.startsWith(`${haystack} `));
        if (hits.length === 1) return hits[0][1];
    }
    return null;
}

/**
 * (0.9.22) Every place named inside `text`, in the order they first appear: whole words,
 * longest names first, so "Bluewatch Village" is found once and not again as a shorter name
 * inside it.
 */
export function placesIn(pack, text) {
    if (!pack || typeof text !== 'string') return [];
    const haystack = normalizeName(text);
    const found = [];
    for (const [key, name] of indexOf(pack).longestFirst) {
        if (found.some(entry => entry.key.includes(key)) || !containsWord(haystack, key)) continue;
        found.push({ key, name, at: haystack.indexOf(key) });
    }
    return found.sort((a, b) => a.at - b.at).map(entry => entry.name);
}

export function resolvePlace(pack, name) {
    if (!pack || typeof name !== 'string') return null;
    return indexOf(pack).byKey.get(normalizeName(name)) ?? findPlace(pack, name);
}

export function exitsFrom(pack, place) {
    const name = resolvePlace(pack, place);
    if (!name) return [];
    return indexOf(pack).adjacency.get(name).map(edge => ({
        to: edge.a === name ? edge.b : edge.a,
        km: edge.km,
        code: edge.code,
        corridor: edge.corridor,
    }));
}

export function edgesBetween(pack, a, b) {
    return (indexOf(pack).adjacency.get(a) ?? []).filter(edge =>
        (edge.a === a && edge.b === b) || (edge.a === b && edge.b === a));
}
export function normalizeMode(mode, pack = null) {
    if (typeof mode !== 'string') return null;
    const word = mode.trim().toLowerCase().replace(/\s+/g, ' ');
    if (pack?.era === 'modern') return MODERN_MODES.includes(word) ? word : MODERN_ALIASES[word] ?? null;
    if (MODES.includes(word)) return word;
    return MODE_ALIASES[word] ?? null;
}
