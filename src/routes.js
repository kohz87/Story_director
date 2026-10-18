// Story Director: world packs and travel maths (pure).
//
// A world pack is a route graph (places, undirected edges with km and a road code) plus
// paces per code and mode and a few travel rules. From it this module finds shortest routes,
// turns km into days with the pack's round-up rule, and checks the one-hop `leg:` lines the
// model writes, offering a corrected leg in the same grammar when one is wrong.
//
// Nothing here knows the calendar module: story time is abs minutes, and the functions that
// read or print dates take an optional `calendar` object (parse, format, addDays, dayIndex).
// Packs are treated as immutable; a lookup index is cached per pack object.

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

// Words the model writes for a mode.
const MODE_ALIASES = {
    walk: 'foot', walking: 'foot', walks: 'foot', hike: 'foot', hiking: 'foot',
    rides: 'ride', riding: 'ride', rider: 'ride', riders: 'ride', horse: 'ride', horseback: 'ride', mounted: 'ride',
    wagons: 'wagon', cart: 'wagon', carts: 'wagon', dray: 'wagon',
    boats: 'boat', barge: 'boat', ferry: 'boat', riverboat: 'boat', keelboat: 'boat',
    ships: 'ship', sail: 'ship', sailing: 'ship',
    fly: 'flight', flying: 'flight', flies: 'flight',
    couriers: 'courier', messenger: 'courier',
};

const LAND_MODES = ['foot', 'ride', 'wagon'];
const WATER_MODES = ['boat', 'ship'];
// Pace keys of the normalized shape; the reference format writes `downstream_favorable`.
const PACE_KEYS = ['foot', 'ride', 'wagon', 'boat', 'upstream', 'downstream', 'ship', 'vessel', 'flight'];
const PACE_ALIASES = { downstream_favorable: 'downstream' };

export const DEFAULT_RULES = Object.freeze({
    roundUpTo: 0.5, restDayEvery: 6, crewedWaterRest: false, leveeRoads: [], noLevee: [],
});
const DEFAULT_COURIER_MULTIPLIER = 2;

const DAY_MINUTES = 1440;
const KM_TOLERANCE = 0.05;
const DAYS_TOLERANCE = 0.5;
// Float sums like 2.0000000001 must not round up to the next half day.
const EPSILON = 1e-9;
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
    for (const code of codes) {
        if (!Object.hasOwn(ROUTE_CODES, code)) warnings.push(`Unknown road code "${code}" (R pace used).`);
    }

    warnings.push(...mapWarnings(places, edges, positive(data.scaleKmPerUnit ?? data.scale_km_per_unit)));

    const rules = data.rules ?? data.travel_rules ?? {};
    const pack = {
        name: String(data.name ?? data.source ?? ''),
        calendar: isObject(data.calendar) ? data.calendar : null,
        scaleKmPerUnit: positive(data.scaleKmPerUnit ?? data.scale_km_per_unit),
        places,
        edges,
        paces: readPaces(data.paces ?? data.pace_km_per_day, warnings),
        courierMultiplier: positive(data.courierMultiplier ?? data.courier_multiplier) ?? DEFAULT_COURIER_MULTIPLIER,
        rules: {
            roundUpTo: nonNegative(rules.roundUpTo ?? rules.round_edge_up_to_days) ?? DEFAULT_RULES.roundUpTo,
            restDayEvery: nonNegative(rules.restDayEvery ?? rules.rest_day_every_active_days) ?? DEFAULT_RULES.restDayEvery,
            crewedWaterRest: Boolean(rules.crewedWaterRest ?? rules.crewed_water_rest_days ?? false),
            leveeRoads: names(rules.leveeRoads ?? rules.levee_roads),
            noLevee: names(rules.noLevee ?? rules.no_levee),
        },
    };
    return { pack, errors, warnings };
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
    return `${places} ${places === 1 ? 'place' : 'places'} · ${routes} ${routes === 1 ? 'route' : 'routes'}`;
}

// ---------------------------------------------------------------------------------------
// Places

const INDEXES = new WeakMap();

// Known places are those in `places` and every edge endpoint (some packs link districts
// they never list). Names are compared lowercased, with straight apostrophes.
function indexOf(pack) {
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

function normalizeName(text) {
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

function resolvePlace(pack, name) {
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

function edgesBetween(pack, a, b) {
    return (indexOf(pack).adjacency.get(a) ?? []).filter(edge =>
        (edge.a === a && edge.b === b) || (edge.a === b && edge.b === a));
}

// ---------------------------------------------------------------------------------------
// Paces

function normalizeMode(mode) {
    if (typeof mode !== 'string') return null;
    const word = mode.trim().toLowerCase();
    if (MODES.includes(word)) return word;
    return MODE_ALIASES[word] ?? null;
}

// The mode a leg most likely means when it names only a road code.
function inferMode(code) {
    if (code === 'W') return 'boat';
    if (code === 'S' || code === 'D') return 'ship';
    if (code === 'A') return 'flight';
    return 'foot';
}

function toPace(value) {
    if (typeof value === 'number') return { rate: value, low: value, high: value };
    if (Array.isArray(value)) return { rate: (value[0] + value[1]) / 2, low: value[0], high: value[1] };
    return null;
}

function hasLevee(pack, corridor) {
    if (!corridor) return false;
    const key = normalizeName(corridor);
    const listed = list => (list ?? []).some(name => normalizeName(name) === key);
    // A corridor in both lists has no levee: noLevee is the explicit exception.
    return listed(pack.rules?.leveeRoads) && !listed(pack.rules?.noLevee);
}

function landPace(pack, code, mode) {
    const table = pack.paces?.[code];
    const hasLand = table && LAND_MODES.some(name => table[name] !== undefined);
    // Codes with no land paces (L, G, unknown) go at R pace.
    if (!hasLand) return code === 'R' ? null : landPace(pack, 'R', mode);
    // A land mode the table leaves out goes at the code's foot pace.
    let value = table[mode] === undefined ? 'foot' : table[mode];
    if (value === 'foot') value = table.foot;
    return toPace(value);
}

/**
 * Km per day for `mode` on road `code`, `{ rate, low, high }` (rate = midpoint of a range),
 * or null when the mode cannot use the road. W is boat only, except along a levee road
 * (R pace); S is ship; D is ship or boat at vessel pace; A is flight.
 */
export function paceFor(pack, code, mode, { corridor = null } = {}) {
    const name = normalizeMode(mode);
    if (!pack || !name) return null;
    const key = String(code ?? '').trim().toUpperCase();

    if (name === 'courier') {
        const ride = paceFor(pack, key, 'ride', { corridor });
        const k = pack.courierMultiplier ?? DEFAULT_COURIER_MULTIPLIER;
        return ride && { rate: ride.rate * k, low: ride.low * k, high: ride.high * k };
    }
    const table = pack.paces?.[key] ?? {};
    if (key === 'W') {
        if (name === 'boat') return toPace(table.boat);
        return LAND_MODES.includes(name) && hasLevee(pack, corridor) ? landPace(pack, 'R', name) : null;
    }
    if (key === 'S') return name === 'ship' ? toPace(table.ship) : null;
    if (key === 'D') return WATER_MODES.includes(name) ? toPace(table.vessel) : null;
    if (key === 'A') return name === 'flight' ? toPace(table.flight) : null;
    return LAND_MODES.includes(name) ? landPace(pack, key, name) : null;
}

function edgePace(pack, edge, mode) {
    return paceFor(pack, edge.code, mode, { corridor: edge.corridor });
}

// The rates a stated pace may use: the pace's range, and on a river also the upstream and
// downstream ranges (direction is not in the data).
function acceptedRange(pack, edge, mode) {
    const pace = edgePace(pack, edge, mode);
    if (!pace) return null;
    if (mode !== 'boat' || edge.code !== 'W') return pace;
    const ranges = ['boat', 'upstream', 'downstream'].map(key => toPace(pack.paces?.W?.[key])).filter(Boolean);
    return {
        ...pace,
        low: Math.min(...ranges.map(range => range.low)),
        high: Math.max(...ranges.map(range => range.high)),
    };
}

/** Days for one edge: `ceil(km / rate / roundUpTo) * roundUpTo`; null for a bad rate. */
export function legDays(km, rate, rules = DEFAULT_RULES) {
    if (!(rate > 0) || !(km >= 0)) return null;
    const step = rules?.roundUpTo ?? DEFAULT_RULES.roundUpTo;
    if (!(step > 0)) return km / rate;
    return tidy(Math.ceil(km / rate / step - EPSILON) * step);
}

export function restDaysFor(mode, activeDays, rules = DEFAULT_RULES) {
    const every = rules?.restDayEvery ?? DEFAULT_RULES.restDayEvery;
    if (mode === 'courier' || !(every > 0) || !(activeDays > 0)) return 0;
    if (WATER_MODES.includes(mode) && !rules?.crewedWaterRest) return 0;
    // Flight rests like land travel: the beasts tire.
    return Math.floor((activeDays - EPSILON) / every);
}

// ---------------------------------------------------------------------------------------
// Routes

// Per neighbour, the edge this mode can use with the fewest days (shorter km on a tie).
function usableEdges(pack, place, mode, accept) {
    const best = new Map();
    for (const edge of indexOf(pack).adjacency.get(place) ?? []) {
        if (accept && !accept(edge)) continue;
        const pace = edgePace(pack, edge, mode);
        if (!pace) continue;
        const next = edge.a === place ? edge.b : edge.a;
        const days = legDays(edge.km, pace.rate, pack.rules);
        const current = best.get(next);
        if (!current || days < current.days || (days === current.days && edge.km < current.edge.km)) {
            best.set(next, { edge, days });
        }
    }
    return best;
}

function bestEdge(pack, edges, mode) {
    let best = null;
    for (const edge of edges) {
        const pace = edgePace(pack, edge, mode);
        if (!pace) continue;
        const days = legDays(edge.km, pace.rate, pack.rules);
        if (!best || days < best.days || (days === best.days && edge.km < best.edge.km)) best = { edge, days };
    }
    return best?.edge ?? null;
}

// Dijkstra by km. `accept` narrows the edges (validateLeg uses it to stay on one road code).
function search(pack, start, goal, mode, accept = null) {
    if (start === goal) return { from: start, to: goal, km: 0, hops: [] };
    const dist = new Map([[start, 0]]);
    const prev = new Map();
    const done = new Set();
    const queue = [start];
    while (queue.length) {
        let pick = 0;
        for (let i = 1; i < queue.length; i++) {
            if (dist.get(queue[i]) < dist.get(queue[pick])) pick = i;
        }
        const place = queue.splice(pick, 1)[0];
        if (done.has(place)) continue;
        done.add(place);
        if (place === goal) break;
        for (const [next, { edge }] of usableEdges(pack, place, mode, accept)) {
            const km = dist.get(place) + edge.km;
            if (km < (dist.get(next) ?? Infinity)) {
                dist.set(next, km);
                prev.set(next, { place, edge });
                queue.push(next);
            }
        }
    }
    if (!prev.has(goal)) return null;
    const hops = [];
    for (let place = goal; place !== start; place = prev.get(place).place) {
        const { place: from, edge } = prev.get(place);
        hops.unshift({ from, to: place, km: edge.km, code: edge.code, corridor: edge.corridor });
    }
    return { from: start, to: goal, km: tidy(dist.get(goal)), hops };
}

export function shortestPath(pack, from, to, { mode = 'foot' } = {}) {
    const name = normalizeMode(mode);
    const start = resolvePlace(pack, from);
    const goal = resolvePlace(pack, to);
    if (!name || !start || !goal) return null;
    return search(pack, start, goal, name);
}

/**
 * The shortest route with days per hop (an explicit `rate` replaces the pack's pace on every
 * hop), rest days for the mode, and the arrival when `depart` is given (abs, or a date text
 * read with `calendar`).
 */
export function planRoute(pack, from, to, { mode = 'foot', rate = null, depart = null, calendar = null } = {}) {
    const name = normalizeMode(mode);
    const route = shortestPath(pack, from, to, { mode: name });
    if (!route) return null;
    const explicit = positive(rate);
    const rules = pack.rules ?? DEFAULT_RULES;
    const hops = route.hops.map(hop => {
        const hopRate = explicit ?? paceFor(pack, hop.code, name, { corridor: hop.corridor }).rate;
        return { ...hop, rate: hopRate, days: legDays(hop.km, hopRate, rules) };
    });
    const activeDays = tidy(hops.reduce((sum, hop) => sum + hop.days, 0));
    const restDays = restDaysFor(name, activeDays, rules);
    const days = tidy(activeDays + restDays);
    const start = toAbs(depart, calendar);
    return {
        ...route, mode: name, hops, activeDays, restDays, days,
        depart: start,
        arrive: start === null ? null : addDays(start, days, calendar),
    };
}

// ---------------------------------------------------------------------------------------
// Legs

const ARROW = /\s*(?:→|⟶|➔|->|=>)\s*/u;
const BRACKETED = /\(([^()]*(?:→|⟶|➔|->|=>)[^()]*)\)/u;
const RATE = /(\d+(?:\.\d+)?)\s*(?:km\s*)?(?:\/\s*(?:day|d)\b|(?:a|per)\s+day\b)/i;
const KM_CODE = /(?<![\d.])(\d+(?:\.\d+)?)\s*(?:km\b\.?)?\s*(?:([A-Z])(?![\p{L}\p{N}]))?/u;
const MODE_WORD = new RegExp(`(?<![\\p{L}])(${[...MODES, ...Object.keys(MODE_ALIASES)].join('|')})(?![\\p{L}])`, 'iu');

/**
 * Reads a `leg:` value: `Shorn → Varnhold Watch 35 B, courier 70/day → 0.5`, also `->`,
 * `to`, and the legacy `(Shorn → Auvoth, 130 km B)`. Unknown pieces are null; the raw place
 * texts are kept in `fromText`/`toText` for messages. Null when there is no `from → to`.
 */
export function parseLeg(pack, text) {
    if (typeof text !== 'string' || !text.trim()) return null;
    let body = text.replace(/[*_`]+/g, '').replace(/[’‘]/g, '\'').split(' | ')[0];
    body = body.replace(/^\s*leg\s*:\s*/i, '');
    const bracketed = BRACKETED.exec(body);
    if (bracketed) body = bracketed[1];
    body = body.trim();

    let parts = body.split(ARROW);
    if (parts.length < 2) {
        const to = /\s+to\s+/i.exec(body);
        if (!to) return null;
        parts = [body.slice(0, to.index), body.slice(to.index + to[0].length)];
    }
    const [fromText, middle, ...tail] = parts.map(part => part.trim());

    // The destination is the text before the numbers ("Varnhold Watch 35 B, …").
    const toText = /^[^\d,]*/.exec(middle)[0].trim();
    let rest = middle.slice(toText.length);

    let rate = null;
    const rateMatch = RATE.exec(rest);
    if (rateMatch) {
        rate = Number(rateMatch[1]);
        rest = rest.slice(0, rateMatch.index) + rest.slice(rateMatch.index + rateMatch[0].length);
    }
    const modeMatch = MODE_WORD.exec(rest) ?? MODE_WORD.exec(tail.join(' '));
    const mode = modeMatch ? normalizeMode(modeMatch[1]) : null;

    const kmMatch = KM_CODE.exec(rest);
    const daysMatch = /^(\d+(?:\.\d+)?)/.exec(tail[0] ?? '');

    const place = (raw, whole) => {
        if (!pack) return raw || null;
        return resolvePlace(pack, raw) ?? (whole ? findPlace(pack, whole) : null);
    };
    return {
        text,
        from: place(fromText),
        to: place(toText, middle),
        km: kmMatch ? Number(kmMatch[1]) : null,
        code: kmMatch?.[2] ?? null,
        mode,
        rate,
        days: daysMatch ? Number(daysMatch[1]) : null,
        fromText,
        toText: toText || middle,
    };
}

/**
 * Checks one leg against the pack. Findings are `{ kind, severity, key: null, message }`,
 * with `correction` (the right leg in the line grammar) whenever one can be given.
 *
 * Without a direct road, whether the leg is `leg-not-one-hop` or `leg-no-edge` depends on
 * the leg's mode (stated, or inferred from its code: W boat, S/D ship, A flight, else foot)
 * and, when the leg names a road code, on that code: the leg described one road, so a path
 * counts only if every hop is that code. `Bluewatch Village → Siltbarrow 130 L` has no L road
 * out of Bluewatch, so it is no-edge (with the exits), though a long foot path exists; the
 * same leg with no code, on foot, is not-one-hop.
 *
 * Beyond the contract's kinds: `leg-code` (warn, the code differs from the road's),
 * `leg-rate` (warn, a stated rate outside the pace range) and `leg-days` (warn, stated days
 * off by more than half a day). Days, rate and arrival are only checked when the leg states
 * a mode or a rate; a bare `130 km B` says nothing about speed.
 */
export function validateLeg(pack, leg, { from = null, depart = null, arrive = null, calendar = null } = {}) {
    if (typeof leg === 'string') leg = parseLeg(pack, leg);
    if (!pack || !leg) return [];
    const findings = [];
    const start = toAbs(depart, calendar);
    const ctx = { pack, calendar, start, legRate: positive(leg.rate) };

    if (!leg.from || !leg.to) {
        const unknown = [!leg.from && (leg.fromText || 'the start'), !leg.to && (leg.toText || 'the destination')]
            .filter(Boolean).map(name => `"${name}"`);
        let message = `${unknown.join(' and ')} ${unknown.length > 1 ? 'are' : 'is'} not in the world pack.`;
        if (leg.from) message += ` ${exitsText(pack, leg.from)}`;
        findings.push(finding('leg-unknown-place', 'warn', message));
        return findings;
    }

    const origin = from ? resolvePlace(pack, from) : null;
    const statedMode = normalizeMode(leg.mode);
    if (origin && origin !== leg.from) {
        const mode = statedMode ?? inferMode(leg.code);
        const plan = planRoute(pack, origin, leg.to, { mode });
        const hop = plan?.hops[0];
        findings.push(finding('leg-wrong-start', 'error',
            `The leg starts at ${leg.from}, but the traveller is at ${origin}.`
            + (hop ? ` First leg from ${origin}: ${hopText(hop)}.` : ''),
            hop ? correctionFor({ ...ctx, hop, mode }).text : null));
        return findings;
    }
    if (leg.from === leg.to) return findings;

    const direct = edgesBetween(pack, leg.from, leg.to);
    const mode = statedMode ?? inferMode(leg.code ?? direct[0]?.code);

    if (!direct.length) {
        const onCode = leg.code ? edge => edge.code === leg.code : null;
        if (!search(pack, leg.from, leg.to, mode, onCode)) {
            const road = leg.code ? `${leg.code} road` : `road ${mode === 'foot' ? 'on foot' : `by ${mode}`}`;
            const result = finding('leg-no-edge', 'error',
                `No ${road} from ${leg.from} to ${leg.to}. ${exitsText(pack, leg.from)}`);
            result.exits = exitsFrom(pack, leg.from);
            findings.push(result);
            return findings;
        }
        const plan = planRoute(pack, leg.from, leg.to, { mode });
        const hop = plan.hops[0];
        const result = finding('leg-not-one-hop', 'error',
            `${leg.from} → ${leg.to} is not one hop: ${routeText(plan)} (${num(plan.km)} km). First leg: ${hopText(hop)}.`,
            correctionFor({ ...ctx, hop, mode }).text);
        result.firstHop = { from: hop.from, to: hop.to, km: hop.km, code: hop.code, corridor: hop.corridor };
        result.path = plan;
        findings.push(result);
        return findings;
    }

    const named = leg.code ? direct.filter(edge => edge.code === leg.code) : [];
    const edge = bestEdge(pack, named.length ? named : direct, mode);
    if (!edge) {
        // The road exists but not for this mode: another road between the two, or the
        // first hop of a path the mode can take.
        const other = bestEdge(pack, direct, mode);
        const plan = other ? null : planRoute(pack, leg.from, leg.to, { mode });
        const hop = other ? toHop(other, leg.from) : plan?.hops[0];
        const road = direct.find(candidate => !leg.code || candidate.code === leg.code);
        const result = finding('leg-mode', 'error',
            `${capitalize(mode)} cannot use ${roadName(road)} from ${leg.from} to ${leg.to}.`
            + (hop ? ` Instead: ${hopText(hop)}${plan ? ` (${num(plan.km)} km in all)` : ''}.` : ''),
            hop ? correctionFor({ ...ctx, hop, mode }).text : null);
        if (plan) result.path = plan;
        findings.push(result);
        return findings;
    }

    const hop = toHop(edge, leg.from);
    const fix = correctionFor({ ...ctx, hop, mode, rateOk: statedMode ? null : true });
    if (leg.code && !named.length) {
        findings.push(finding('leg-code', 'warn',
            `The road from ${leg.from} to ${leg.to} is ${edge.code} (${ROUTE_CODES[edge.code] ?? 'road'}), not ${leg.code}.`, fix.text));
    }
    if (leg.km !== null && leg.km !== undefined && Math.abs(leg.km - edge.km) > KM_TOLERANCE * edge.km) {
        findings.push(finding('leg-km', 'warn',
            `${leg.from} → ${leg.to} is ${num(edge.km)} km, not ${num(leg.km)}.`, fix.text));
    }
    if (!statedMode && !ctx.legRate) return findings;

    if (statedMode && ctx.legRate && !fix.rateInRange) {
        findings.push(finding('leg-rate', 'warn',
            `${capitalize(mode)} on ${edge.code} goes ${rangeText(fix.range)} km a day, not ${num(ctx.legRate)}.`, fix.text));
    }
    if (leg.days !== null && leg.days !== undefined
        && Math.abs(leg.days - fix.days) > DAYS_TOLERANCE && Math.abs(leg.days - fix.activeDays) > DAYS_TOLERANCE) {
        findings.push(finding('leg-days', 'warn',
            `${num(edge.km)} km at ${num(fix.rate)} a day is ${num(fix.days)} ${dayWord(fix.days)}, not ${num(leg.days)}.`, fix.text));
    }
    if (fix.arrive !== null) {
        const gap = arrivalGap(fix.arrive, arrive, calendar);
        if (gap !== null && gap > DAYS_TOLERANCE) {
            findings.push(finding('leg-arrive', 'warn',
                `Arrival ${dateText(arrive, calendar)} is ${num(gap)} ${dayWord(gap)} off: `
                + `${num(fix.days)} ${dayWord(fix.days)} from ${dateText(start, calendar)} is ${dateText(fix.arrive, calendar)}.`, fix.text));
        }
    }
    return findings;
}

function finding(kind, severity, message, correction = null) {
    const result = { kind, severity, key: null, message };
    if (correction) result.correction = correction;
    return result;
}

// The corrected leg for one hop: the stated rate when it fits the pace, else the pace.
function correctionFor({ pack, calendar, start, legRate, hop, mode, rateOk = null }) {
    const pace = paceFor(pack, hop.code, mode, { corridor: hop.corridor });
    const range = acceptedRange(pack, hop, mode) ?? pace;
    const rateInRange = Boolean(legRate && range && legRate >= range.low - EPSILON && legRate <= range.high + EPSILON);
    const rate = legRate && (rateInRange || rateOk) ? legRate : pace?.rate ?? legRate;
    const activeDays = legDays(hop.km, rate, pack.rules);
    const days = tidy(activeDays + restDaysFor(mode, activeDays, pack.rules));
    const arrive = start === null ? null : addDays(start, days, calendar);
    const text = formatLeg(hop, { mode, rate, days, arrive, calendar });
    return { text, rate, range, rateInRange, activeDays, days, arrive };
}

function toHop(edge, from) {
    return { from, to: edge.a === from ? edge.b : edge.a, km: edge.km, code: edge.code, corridor: edge.corridor };
}

// How far (in days) a stated arrival is from the computed one. A date without a time
// covers its whole day.
function arrivalGap(expected, arrive, calendar) {
    if (typeof arrive === 'number' && Number.isFinite(arrive)) return Math.abs(arrive - expected) / DAY_MINUTES;
    if (typeof arrive !== 'string' || !calendar) return null;
    const parsed = calendar.parse(arrive, { reference: expected });
    if (!parsed) return null;
    if (parsed.hasTime) return Math.abs(parsed.abs - expected) / DAY_MINUTES;
    const dayStart = Math.floor(parsed.abs / DAY_MINUTES) * DAY_MINUTES;
    if (expected < dayStart) return (dayStart - expected) / DAY_MINUTES;
    if (expected > dayStart + DAY_MINUTES) return (expected - dayStart - DAY_MINUTES) / DAY_MINUTES;
    return 0;
}

// ---------------------------------------------------------------------------------------
// Formatting

/** `Shorn → Varnhold Watch 35 B → … = 220 km · ride 35/day · 7 active days + 1 rest = 8 days · arrive …` */
export function formatRoute(plan, calendar = null) {
    if (!plan) return '';
    const path = [plan.from, ...plan.hops.map(hop => `${hop.to} ${num(hop.km)} ${hop.code}`)].join(' → ');
    const parts = [`${path} = ${num(plan.km)} km`];
    const rates = [...new Set(plan.hops.map(hop => hop.rate))].sort((a, b) => a - b);
    if (rates.length) {
        const rate = rates.length === 1 ? num(rates[0]) : `${num(rates[0])}–${num(rates[rates.length - 1])}`;
        parts.push(`${plan.mode} ${rate}/day`);
    }
    parts.push(plan.restDays > 0
        ? `${num(plan.activeDays)} active ${dayWord(plan.activeDays)} + ${num(plan.restDays)} rest = ${num(plan.days)} ${dayWord(plan.days)}`
        : `${num(plan.days)} ${dayWord(plan.days)}`);
    if (plan.arrive !== null && plan.arrive !== undefined && calendar) {
        parts.push(`arrive ${calendar.format(plan.arrive, { era: false })}`);
    }
    return parts.join(' · ');
}

/** One leg in the line grammar: `Shorn → Varnhold Watch 35 B, courier 70/day → 0.5 | arrive: …`. */
export function formatLeg(hop, { mode = null, rate = null, days = null, arrive = null, calendar = null } = {}) {
    if (!hop) return '';
    const m = normalizeMode(mode ?? hop.mode) ?? mode ?? null;
    const r = rate ?? hop.rate ?? null;
    const d = days ?? hop.days ?? null;
    let text = `${hop.from} → ${hop.to}`;
    if (hop.km !== null && hop.km !== undefined) text += ` ${num(hop.km)}`;
    if (hop.code) text += ` ${hop.code}`;
    const working = [m, r !== null ? `${num(r)}/day` : null].filter(Boolean).join(' ');
    if (working) text += `, ${working}`;
    if (d !== null) text += ` → ${num(d)}`;
    const when = typeof arrive === 'number' ? (calendar ? calendar.format(arrive, { era: false }) : null) : arrive;
    if (when) text += ` | arrive: ${when}`;
    return text;
}

function hopText(hop) {
    return `${hop.from} → ${hop.to} ${num(hop.km)} ${hop.code}`;
}

function routeText(route) {
    return [route.from, ...route.hops.map(hop => `${hop.to} ${num(hop.km)} ${hop.code}`)].join(' → ');
}

function exitsText(pack, place) {
    const exits = exitsFrom(pack, place);
    if (!exits.length) return `${place} has no exits.`;
    return `Exits from ${place}: ${exits.map(exit => `${exit.to} ${num(exit.km)} ${exit.code}`).join(', ')}.`;
}

function roadName(edge) {
    if (!edge) return 'the road';
    return edge.corridor ? `the ${edge.corridor} (${edge.code})` : `the ${edge.code} road`;
}

function rangeText(range) {
    if (!range) return '?';
    return range.low === range.high ? num(range.low) : `${num(range.low)}–${num(range.high)}`;
}

function dateText(value, calendar) {
    if (typeof value === 'number' && calendar) return calendar.format(value, { era: false });
    return String(value);
}

function dayWord(days) {
    return days <= 1 ? 'day' : 'days';
}

function capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

// ---------------------------------------------------------------------------------------
// Small helpers

function toAbs(value, calendar, reference = null) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && calendar) return calendar.parse(value, { reference })?.abs ?? null;
    return null;
}

function addDays(abs, days, calendar) {
    return calendar?.addDays ? calendar.addDays(abs, days) : abs + days * DAY_MINUTES;
}

// 6.500000000001 → 6.5, so sums and printed numbers stay clean.
function tidy(value) {
    return Math.round(value * 1e9) / 1e9;
}

function num(value) {
    return String(Number(Number(value).toFixed(2)));
}

function names(list) {
    return Array.isArray(list) ? list.filter(name => typeof name === 'string' && name.trim()).map(name => name.trim()) : [];
}

function positive(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function nonNegative(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function finite(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
