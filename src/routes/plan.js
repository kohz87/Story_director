// Story Director: paces, day maths and the route planner (pure).
//
// Turns km into days with a pack's round-up rule, picks the pace for a road code and mode,
// and finds shortest routes (shortestPath, planRoute). Split out of routes.js, which still
// re-exports every name it exported before.

import { addDays, nonNegative, positive, tidy, toAbs } from './util.js';
import { DEFAULT_COURIER_MULTIPLIER, DEFAULT_RULES, EPSILON, LAND_MODES, MODERN_CODES, MODERN_DEFAULT_MODE, MODERN_RULES, ROUTE_CODES, SELF_MODES, TRANSFER_KM, TRANSFER_MODES, WATER_MODES, indexOf, normalizeMode, normalizeName, resolvePlace } from './pack.js';

// ---------------------------------------------------------------------------------------
// Paces


/** What a road code is called ("bastion road", "railway"). */
export function codeName(pack, code) {
    if (pack?.era === 'modern') return MODERN_CODES[code]?.name ?? 'road';
    return ROUTE_CODES[code] ?? 'road';
}

// The mode a leg most likely means when it names only a road code.
export function inferMode(code, pack = null) {
    if (pack?.era === 'modern') {
        return MODERN_DEFAULT_MODE[code] ?? Object.keys(pack.paces?.[code] ?? {})[0] ?? 'foot';
    }
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
    const name = normalizeMode(mode, pack);
    if (!pack || !name) return null;
    const key = String(code ?? '').trim().toUpperCase();
    // Modern: the code's own table, km an hour; a mode it leaves out cannot use it.
    if (pack.era === 'modern') return toPace(pack.paces?.[key]?.[name]);

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

/** Days spent boarding on a modern code: check-in for a flight, the wait for a train. */
export function boardDays(pack, code) {
    if (pack?.era !== 'modern') return 0;
    return tidy((nonNegative(pack.paces?.[code]?.boardHours) ?? 0) / 24);
}

// The mode a hop goes by: the trip's own, or for public transport in a modern pack a short
// transfer (a taxi to the airport). Null when nothing can.
function hopMode(pack, edge, mode, transfer) {
    if (edgePace(pack, edge, mode)) return mode;
    if (!transfer || edge.km > TRANSFER_KM) return null;
    return TRANSFER_MODES.find(other => edgePace(pack, edge, other)) ?? null;
}

// One hop's time in days: the road at the mode's pace, plus boarding when the mode rides it.
export function hopDays(pack, edge, mode, rate = null) {
    const pace = rate ?? edgePace(pack, edge, mode)?.rate;
    const days = legDays(edge.km, pace, pack.rules);
    return days === null ? null : tidy(days + boardDays(pack, edge.code));
}

// The rates a stated pace may use: the pace's range, and on a river also the upstream and
// downstream ranges (direction is not in the data).
export function acceptedRange(pack, edge, mode) {
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
    // Modern: km an hour, rounded up to the quarter hour (or the pack's step), in days.
    if (rules?.unit === 'hour') {
        const step = rules.roundUpTo ?? MODERN_RULES.roundUpTo;
        const hours = step > 0 ? Math.ceil(km / rate / step - EPSILON) * step : km / rate;
        return tidy(hours / 24);
    }
    const step = rules?.roundUpTo ?? DEFAULT_RULES.roundUpTo;
    if (!(step > 0)) return km / rate;
    return tidy(Math.ceil(km / rate / step - EPSILON) * step);
}

export function restDaysFor(mode, activeDays, rules = DEFAULT_RULES) {
    // Modern: whoever drives, rides or walks stops for the night after driveHoursPerDay; trains,
    // buses, ferries and planes go on. Returned in days, like a rest day.
    if (rules?.unit === 'hour') return tidy(overnights(mode, activeDays, rules) * (24 - driveHours(rules)) / 24);
    const every = rules?.restDayEvery ?? DEFAULT_RULES.restDayEvery;
    if (mode === 'courier' || !(every > 0) || !(activeDays > 0)) return 0;
    if (WATER_MODES.includes(mode) && !rules?.crewedWaterRest) return 0;
    // Flight rests like land travel: the beasts tire.
    return Math.floor((activeDays - EPSILON) / every);
}

function driveHours(rules) {
    return Math.min(24, positive(rules?.driveHoursPerDay) ?? MODERN_RULES.driveHoursPerDay);
}

/** Nights a modern trip stops for: 0 for public transport and trips within a day's driving. */
export function overnights(mode, activeDays, rules = MODERN_RULES) {
    if (rules?.unit !== 'hour' || !SELF_MODES.includes(mode) || !(activeDays > 0)) return 0;
    const hours = driveHours(rules);
    if (hours >= 24) return 0;
    return Math.max(0, Math.ceil(activeDays * 24 / hours - EPSILON) - 1);
}

// ---------------------------------------------------------------------------------------
// Routes

// Per neighbour, the edge this mode can use with the fewest days (shorter km on a tie).
function usableEdges(pack, place, mode, accept, transfer = false) {
    const best = new Map();
    for (const edge of indexOf(pack).adjacency.get(place) ?? []) {
        if (accept && !accept(edge)) continue;
        const by = hopMode(pack, edge, mode, transfer);
        if (!by) continue;
        const next = edge.a === place ? edge.b : edge.a;
        // A transfer weighs three times its time, so a train trip takes the train where there is one.
        const days = hopDays(pack, edge, by) * (by === mode ? 1 : 3);
        const current = best.get(next);
        const own = current && current.mode === mode;
        if (own && by !== mode) continue;
        if (!current || (by === mode && !own) || days < current.days || (days === current.days && edge.km < current.edge.km)) {
            best.set(next, { edge, days, mode: by });
        }
    }
    return best;
}

export function bestEdge(pack, edges, mode) {
    let best = null;
    for (const edge of edges) {
        const pace = edgePace(pack, edge, mode);
        if (!pace) continue;
        const days = legDays(edge.km, pace.rate, pack.rules);
        if (!best || days < best.days || (days === best.days && edge.km < best.edge.km)) best = { edge, days };
    }
    return best?.edge ?? null;
}

// Dijkstra by km; in a modern pack by time, as a motorway's detour or a flight is quicker.
// `accept` narrows the edges (validateLeg uses it to stay on one road code); `transfer` lets
// public transport reach its stations (planRoute and shortestPath only).
export function search(pack, start, goal, mode, accept = null, transfer = false) {
    const byTime = pack.era === 'modern';
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
        for (const [next, { edge, days, mode: by }] of usableEdges(pack, place, mode, accept, transfer)) {
            const cost = dist.get(place) + (byTime ? days : edge.km);
            if (cost < (dist.get(next) ?? Infinity)) {
                dist.set(next, cost);
                prev.set(next, { place, edge, mode: by });
                queue.push(next);
            }
        }
    }
    if (!prev.has(goal)) return null;
    const hops = [];
    for (let place = goal; place !== start; place = prev.get(place).place) {
        const { place: from, edge, mode: by } = prev.get(place);
        const hop = { from, to: place, km: edge.km, code: edge.code, corridor: edge.corridor };
        if (by !== mode) hop.mode = by;
        hops.unshift(hop);
    }
    return { from: start, to: goal, km: tidy(hops.reduce((sum, hop) => sum + hop.km, 0)), hops };
}

// Public transport in a modern pack may take a short transfer to its station.
const transfersFor = (pack, mode) => pack?.era === 'modern' && !SELF_MODES.includes(mode);

export function shortestPath(pack, from, to, { mode = 'foot' } = {}) {
    const name = normalizeMode(mode, pack);
    const start = resolvePlace(pack, from);
    const goal = resolvePlace(pack, to);
    if (!name || !start || !goal) return null;
    return search(pack, start, goal, name, null, transfersFor(pack, name));
}

/**
 * The shortest route with days per hop (an explicit `rate` replaces the pack's pace on every
 * hop), rest days for the mode, and the arrival when `depart` is given (abs, or a date text
 * read with `calendar`).
 */
export function planRoute(pack, from, to, { mode = 'foot', rate = null, depart = null, calendar = null } = {}) {
    const name = normalizeMode(mode, pack);
    const route = shortestPath(pack, from, to, { mode: name });
    if (!route) return null;
    const explicit = positive(rate);
    const rules = pack.rules ?? DEFAULT_RULES;
    const hops = route.hops.map(hop => {
        const by = hop.mode ?? name;
        // An explicit rate is the trip's own mode's; a transfer goes at its pace.
        const hopRate = (by === name ? explicit : null) ?? paceFor(pack, hop.code, by, { corridor: hop.corridor }).rate;
        return { ...hop, rate: hopRate, days: hopDays(pack, hop, by, hopRate) };
    });
    const activeDays = tidy(hops.reduce((sum, hop) => sum + hop.days, 0));
    const restDays = restDaysFor(name, activeDays, rules);
    const boardHours = tidy(hops.reduce((sum, hop) => sum + (hop.mode ? 0 : boardDays(pack, hop.code)), 0) * 24);
    const days = tidy(activeDays + restDays);
    const start = toAbs(depart, calendar);
    return {
        ...route, mode: name, hops, activeDays, restDays, days,
        unit: rules.unit === 'hour' ? 'hour' : 'day', boardHours,
        stops: overnights(name, activeDays, rules),
        depart: start,
        arrive: start === null ? null : addDays(start, days, calendar),
    };
}
