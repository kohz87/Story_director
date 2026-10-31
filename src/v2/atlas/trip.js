// Story Director v2, atlas part: trips (pure).
//
// A trip is planned once, when the story starts it (`~ trip Wolfmere Outpost | by: riding | via: …`): from where
// {{user}} is to the destination along **known routes only** (the atlas's: the packs' routes and the story's
// `+ route` lines), through each `via`, the shortest by km. The legs are kept as they were planned, with their
// story times, so a replay is exact whatever the routes or the mounts become later. Nothing about *where* the
// party is now is stored: it is worked out from the story time against the legs (`positionOf`).
//
// Kept in the atlas domain's `trips`, a record per line, keyed `<rev>.<n>` (per-reply bookkeeping, SPEC §2.2):
//   go    { kind: 'go', at, rev, to, by, mode, pace, unit, mount, short, setOut, legs: [Leg] }
//   delay { kind: 'delay', at, rev, minutes, because }
// `Leg` = { from, to, km, kind, days, start, arrive, skip? }: names in the direction of travel, the road's length
// `km`, `skip` km of it already behind the traveller when the leg starts (a trip begun mid-road), `days` what the
// planner counted for the part still to go, `start` and `arrive` story minutes. A new trip or a stop takes every
// earlier record away; a delay is its own record, applied when the trip is read, so deleting the reply that made
// the trip leaves later delays harmless (they have nothing to move).

import { DEFAULT_PACES, MODERN_PACES, parseLocation } from '../../places.js';
import { DEFAULT_RULES, MODERN_RULES, legDays } from '../../routes.js';
import { PRESETS, makeCalendar } from '../../calendar.js';
import { hopMode } from './travel.js';
import { cleanName, cleanWord, isRecord, keyOf } from './domain.js';
import { KEY, MAX_DELAYS, MAX_DELAY_DAYS, MAX_LEGS } from './trip-shape.js';

export const TRIP_FEATURE = 'story-director.trip';
export { MAX_DELAYS, MAX_DELAY_DAYS, MAX_LEGS };
const DAY = 1440;
// How long after the arrival the story may leave the destination unwritten before the trip counts as over (see isOver).
const ARRIVED_GRACE = 3 * DAY;
const tidy = value => Math.round(value * 1e6) / 1e6;
const isInt = value => Number.isSafeInteger(value);

// ---- how a trip travels --------------------------------------------------------------------------------------

// The words the story writes for a mode of travel (by: riding), as v1's routes.js reads them.
const ALIASES = Object.freeze({
    riding: 'ride', rides: 'ride', rider: 'ride', riders: 'ride', horse: 'ride', horseback: 'ride', mounted: 'ride', mounts: 'ride',
    walk: 'foot', walking: 'foot', walks: 'foot', hike: 'foot', hiking: 'foot', 'on foot': 'foot',
    wagons: 'wagon', cart: 'wagon', carts: 'wagon', dray: 'wagon',
    boats: 'boat', barge: 'boat', ferry: 'boat', riverboat: 'boat', keelboat: 'boat',
    ships: 'ship', sail: 'ship', sailing: 'ship',
    fly: 'flight', flying: 'flight', flies: 'flight', air: 'flight',
    couriers: 'courier', messenger: 'courier',
});
const MODERN_ALIASES = Object.freeze({
    walk: 'foot', walking: 'foot', hike: 'foot', 'on foot': 'foot', cycling: 'bike', bicycle: 'bike', drive: 'car', driving: 'car',
    taxi: 'car', coach: 'bus', rail: 'train', subway: 'metro', tram: 'metro', boat: 'ferry', fly: 'plane', flying: 'plane', flight: 'plane',
});

/** The mode a `by:` word names on this map (`ride`, `foot`, …; `car`, `train`, … on a modern map), or '' when none. */
export function modeOf(word, { modern = false } = {}) {
    const text = String(word ?? '').replace(/^\s*by\s+/i, '').trim().toLowerCase();
    if (!text) return '';
    const paces = modern ? MODERN_PACES : DEFAULT_PACES;
    if (Object.hasOwn(paces, text)) return text;
    const alias = (modern ? MODERN_ALIASES : ALIASES)[text];
    return alias && Object.hasOwn(paces, alias) ? alias : '';
}

/** "riding", "on foot", "by wagon": the mode in words. */
export function modeWords(mode) {
    return { foot: 'on foot', ride: 'riding', flight: 'by air', courier: 'by courier' }[mode] ?? `by ${mode}`;
}

/** The pace a land mode goes at on this map, per day (per hour on a modern map). */
export const basePace = (mode, modern) => (modern ? MODERN_PACES : DEFAULT_PACES)[mode] ?? null;

// A hop's pace: its kind's own for water and air; the trip's for land, and Story Block's mount pace (when it answered) for a ride.
function hopPace(kind, mode, { modern, pace }) {
    const by = hopMode(kind, mode, { modern });
    if (!by) return null;
    return pace && !modern && mode === 'ride' && by.mode === 'ride' ? pace : by.pace;
}

// One route as an edge for the planner: its km, and the days it takes (the route's own hours, else km at the pace).
function edgeOf(route, mode, options) {
    const pace = hopPace(route.kind, mode, options);
    if (!pace) return null;
    const hours = route.hours !== null && route.hours !== undefined ? route.hours : null;
    const km = route.km > 0 ? route.km : hours !== null ? Math.max(1, Math.round((hours / 24) * pace)) : null;
    if (km === null) return null;
    const days = hours !== null ? tidy(hours / 24) : legDays(km, pace, options.modern ? MODERN_RULES : DEFAULT_RULES);
    return days === null ? null : { km, days, pace, hours };
}

// The days for `km` of a road of `kind` (the part of a road still to go).
function partDays(route, km, mode, options) {
    const pace = hopPace(route.kind, mode, options);
    if (!pace) return null;
    return legDays(km, pace, options.modern ? MODERN_RULES : DEFAULT_RULES);
}

// The shortest way by km between two places along known routes: [{ route, from, to, edge }] or null (v1's travel.js order breaks ties).
function shortestKm(world, start, goal, mode, options) {
    if (start === goal) return [];
    const order = new Map(world.places.map((place, index) => [place.id, index]));
    const edges = new Map();
    for (const route of world.routes) {
        const edge = edgeOf(route, mode, options);
        if (!edge) continue;
        for (const [a, b] of [[route.from, route.to], [route.to, route.from]]) {
            if (!edges.has(a)) edges.set(a, []);
            edges.get(a).push({ from: a, to: b, route, edge });
        }
    }
    const dist = new Map([[start, 0]]);
    const prev = new Map();
    const done = new Set();
    const queue = [start];
    while (queue.length) {
        let pick = 0;
        for (let i = 1; i < queue.length; i += 1) {
            const a = dist.get(queue[i]);
            const b = dist.get(queue[pick]);
            if (a < b || (a === b && (order.get(queue[i]) ?? 0) < (order.get(queue[pick]) ?? 0))) pick = i;
        }
        const here = queue.splice(pick, 1)[0];
        if (done.has(here)) continue;
        done.add(here);
        if (here === goal) break;
        for (const hop of edges.get(here) ?? []) {
            const cost = dist.get(here) + hop.edge.km;
            if (cost < (dist.get(hop.to) ?? Infinity)) {
                dist.set(hop.to, cost);
                prev.set(hop.to, hop);
                queue.push(hop.to);
            }
        }
    }
    if (!prev.has(goal)) return null;
    const hops = [];
    for (let at = goal; at !== start; at = prev.get(at).from) hops.unshift(prev.get(at));
    return hops;
}

/**
 * Plans a trip. `from`: `{ node }` (a place id) or `{ road: { from, to, km, kind, along } }` ({{user}} is `along` km down the road
 * between two places, `from` and `to` as names, in the direction they are going: `along` counted from `from`); `via`: place ids to
 * pass through, in order; `to`: a place id. `world` is the joined world (world.js). Starting on a road the party goes on to the road's end or back to its start,
 * whichever gets there with the fewer km ("no turnings mid-leg"). Returns `{ legs, km, days }` (legs with `start` and `arrive`
 * in story minutes from `at`), or `{ error }` naming the gap (the two places no known route joins).
 */
export function planTrip(world, { from, via = [], to, mode, pace = null, modern = false, at }) {
    const options = { modern, pace };
    const name = id => world.find(id)?.name ?? id;
    const chain = (start, stops) => {
        const hops = [];
        let here = start;
        for (const stop of stops) {
            const way = shortestKm(world, here, stop, mode, options);
            if (!way) return { error: `No known route from ${name(here)} to ${name(stop)}.` };
            hops.push(...way);
            here = stop;
        }
        return { hops };
    };
    const legOf = (hop, extra = {}) => ({
        from: name(hop.from), to: name(hop.to), km: Math.max(1, Math.round(hop.edge.km)), kind: cleanWord(hop.route.kind, { lower: true }),
        days: hop.edge.days, ...extra,
    });
    const stops = [...via, to];
    let first = null;
    let hops = null;
    if (from.node !== undefined) {
        const planned = chain(from.node, stops);
        if (planned.error) return planned;
        hops = planned.hops;
    } else {
        const { road } = from;
        const [a, b] = [world.find(road.from), world.find(road.to)];
        if (!a || !b) return { error: `The road between ${road.from} and ${road.to} is no longer on the map.` };
        const total = (list, edgeKm) => list.reduce((sum, hop) => sum + hop.edge.km, edgeKm);
        const choices = [
            { forward: true, start: b.id, remaining: road.km - road.along },
            { forward: false, start: a.id, remaining: road.along },
        ].map(choice => ({ ...choice, ...chain(choice.start, stops) }));
        const usable = choices.filter(choice => !choice.error);
        if (!usable.length) return { error: `You are on the road between ${a.name} and ${b.name}, and it only goes on to ${b.name} or back to ${a.name}. ${choices[0].error} ${choices[1].error}` };
        usable.sort((a2, b2) => total(a2.hops, a2.remaining) - total(b2.hops, b2.remaining) || Number(b2.forward) - Number(a2.forward));
        const pick = usable[0];
        const days = partDays({ kind: road.kind }, pick.remaining, mode, options);
        if (days === null) return { error: `The road between ${a.name} and ${b.name} cannot be travelled ${modeWords(mode)}.` };
        // The first leg runs the road in the direction of travel, `skip` km of it already behind.
        first = pick.forward
            ? { from: a.name, to: b.name, km: road.km, kind: cleanWord(road.kind, { lower: true }), days, skip: road.along }
            : { from: b.name, to: a.name, km: road.km, kind: cleanWord(road.kind, { lower: true }), days, skip: road.km - road.along };
        hops = pick.hops;
    }
    const legs = [...(first ? [first] : []), ...hops.map(hop => legOf(hop))];
    if (!legs.length) return { error: 'You are already there.' };
    if (legs.length > MAX_LEGS) return { error: `That is ${legs.length} stages: ${MAX_LEGS} is as many as a trip keeps. Go by stages.` };
    let clock = at;
    for (const leg of legs) {
        leg.start = clock;
        clock += Math.max(1, Math.round(leg.days * DAY));
        leg.arrive = clock;
    }
    return { legs, km: legs.reduce((sum, leg) => sum + leg.km - (leg.skip ?? 0), 0), days: tidy((clock - at) / DAY) };
}

// ---- the record, and the trip as it stands --------------------------------------------------------------------

const order = (a, b) => a.record.at - b.record.at || a.record.rev - b.record.rev || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/**
 * The trip as it stands: the newest `go` record with the delays after it applied, or null. `{ to, by, mode, pace, unit, mount, short,
 * setOut, legs, delays }`; each leg has `holds` (`[{ at, minutes }]`, a delay that stopped it on the road) with its `arrive` moved. A
 * delay moves every arrival still ahead of it: the leg being travelled is held where it is, the later ones start later.
 */
export function tripOf(atlas) {
    const entries = Object.entries(isRecord(atlas?.trips) ? atlas.trips : {}).filter(([key, record]) => KEY.test(key) && isRecord(record))
        .map(([key, record]) => ({ key, record })).sort(order);
    const goes = entries.filter(entry => entry.record.kind === 'go' && Array.isArray(entry.record.legs) && entry.record.legs.length);
    const go = goes.at(-1);
    if (!go) return null;
    const trip = {
        ...structuredClone({ to: go.record.to, by: go.record.by, mode: go.record.mode, pace: go.record.pace, unit: go.record.unit, mount: go.record.mount, short: go.record.short, setOut: go.record.setOut }),
        legs: structuredClone(go.record.legs).map(leg => ({ ...leg, holds: [] })),
        delays: [],
    };
    // A delay written while an earlier hold still runs waits for it: its hold starts where that one ends, so the holds never overlap and
    // the party is held for the sum of the delays (the arrivals have always moved by that sum).
    let heldUntil = -Infinity;
    for (const entry of entries.filter(item => item.record.kind === 'delay' && order(go, item) < 0)) {
        const { minutes, because } = entry.record;
        if (!isInt(minutes) || minutes < 1 || entry.record.at >= trip.legs.at(-1).arrive) continue;
        const at = Math.max(entry.record.at, heldUntil);
        for (const leg of trip.legs) {
            if (leg.arrive <= at) continue;
            if (leg.start <= at) {
                leg.holds.push({ at, minutes });
                heldUntil = at + minutes;
            } else leg.start += minutes;
            leg.arrive += minutes;
        }
        trip.delays.push({ minutes, because: typeof because === 'string' ? because : '' });
    }
    return trip;
}

/**
 * Where the party is at story minute `now`: `{ index, leg, along, of, fraction, node, mid, arrived }`. `index` and `leg` the leg being
 * travelled (or, once arrived, the last); `along` the km down its road (`of` long) counted from the road's end behind the traveller,
 * `fraction` the share of the leg's own travel done, `node` the place name when the party stands at a place (before setting out
 * on a leg, between two, or arrived), `mid` whether it is somewhere between two places, `arrived` whether the last leg is over.
 */
export function positionOf(trip, now) {
    const legs = trip.legs;
    const last = legs.length - 1;
    if (now >= legs[last].arrive) return { index: last, leg: legs[last], along: legs[last].km, of: legs[last].km, fraction: 1, node: legs[last].to, mid: false, arrived: true };
    const index = legs.findIndex(leg => now < leg.arrive);
    const leg = legs[index];
    const skip = leg.skip ?? 0;
    if (now < leg.start) return { index, leg, along: skip, of: leg.km, fraction: 0, node: skip ? null : leg.from, mid: skip > 0, arrived: false };
    const holds = Array.isArray(leg.holds) ? leg.holds : [];
    let held = 0;
    for (const hold of holds) held += Math.max(0, Math.min(now, hold.at + hold.minutes) - Math.max(leg.start, hold.at));
    const heldAll = holds.reduce((sum, hold) => sum + hold.minutes, 0);
    const travel = leg.arrive - leg.start - heldAll;
    const fraction = travel > 0 ? Math.min(1, Math.max(0, (now - leg.start - held) / travel)) : 1;
    const along = Math.min(leg.km, Math.max(0, Math.round(skip + (leg.km - skip) * fraction)));
    const atEnd = along >= leg.km;
    const atStart = along <= 0;
    return { index, leg, along, of: leg.km, fraction, node: atStart ? leg.from : atEnd ? leg.to : null, mid: !atStart && !atEnd, arrived: false };
}

/** Every place the trip names: where it started, each stop, and where it ends. */
export const nodesOf = trip => [...new Set(trip.legs.flatMap(leg => [leg.from, leg.to]))];

/**
 * Whether the trip is over for the story: it has arrived and {{user}}'s place is no longer one the trip names (the story moved on), or it is
 * a place the trip names other than the destination ARRIVED_GRACE or more after the arrival (the party went back the way it came; the
 * narrator has had that long to write the arrival). At the destination the arrival stays until the story moves on.
 */
export function isOver(trip, now, here) {
    if (!positionOf(trip, now).arrived) return false;
    const key = keyOf(parseLocation(here).name);
    if (!key) return false;
    if (!nodesOf(trip).some(name => keyOf(name) === key)) return true;
    const final = trip.legs.at(-1);
    return keyOf(final.to) !== key && now >= final.arrive + ARRIVED_GRACE;
}

/** Where a new trip starts from, given the head state: `{ node: name }` or `{ road: { from, to, km, kind, along } }` (names), or null. */
export function startOf(atlas, now, here) {
    const trip = Number.isSafeInteger(now) ? tripOf(atlas) : null;
    if (trip && !isOver(trip, now, here)) {
        const pos = positionOf(trip, now);
        if (pos.mid) return { road: { from: pos.leg.from, to: pos.leg.to, km: pos.leg.km, kind: pos.leg.kind, along: pos.along } };
        if (pos.node) return { node: pos.node };
    }
    const name = cleanName(parseLocation(here).name);
    return name ? { node: name } : null;
}

// ---- words ---------------------------------------------------------------------------------------------------

/** The chat's calendar from the `director.calendar` query, else Gregorian. */
export function calendarOf(query) {
    let config = null;
    try {
        config = typeof query === 'function' ? query('director.calendar', {}) : null;
    } catch {
        config = null;
    }
    try {
        return makeCalendar(isRecord(config) ? config : PRESETS.gregorian);
    } catch {
        return makeCalendar(PRESETS.gregorian);
    }
}

/** A story minute as "Goldwane 16" (with the era and year when it is in another year than `now`), or ''. */
export function dateText(calendar, minutes, now = null) {
    if (!isInt(minutes)) return '';
    try {
        const other = isInt(now) && calendar.fromAbs(minutes).year !== calendar.fromAbs(now).year;
        return calendar.format(minutes, { time: false, era: other });
    } catch {
        return '';
    }
}

/** "riding, 25 km/day (Burr sets the pace)" or "on foot, 20 km/day". */
export function paceText(trip) {
    const unit = trip.unit === 'hour' ? 'km/h' : 'km/day';
    const note = trip.mount ? ` (${trip.mount} sets the pace)` : trip.short ? ' (not enough mounts: the party walks)' : '';
    return `${modeWords(trip.mode)}, ${trip.pace} ${unit}${note}`;
}

const daysWord = days => (days === 1 ? '1 day' : `${tidy(days)} days`);

/** A leg's time in words: "4 days", "5 hours". */
export const legTime = (leg, unit) => (unit === 'hour' ? (() => { const hours = tidy(leg.days * 24); return hours === 1 ? '1 hour' : `${hours} hours`; })() : daysWord(leg.days));

/**
 * The trip for readers, at story minute `now` (`here`: {{user}}'s place name; `calendar`): null when there is none or it is over;
 * else `{ to, phase: 'road' | 'arrived', by, pace, mount, short, unit, setOut, legs, leg, legCount, along, of, fraction, from, next,
 * arrive, route, row, tail, reached, delays }` where each of `legs` is `{ index, from, to, km, kind, days, time, arrive, state:
 * 'done' | 'now' | 'next', along?, fraction? }`.
 */
export function tripView(atlas, { now, here = '', calendar }) {
    const trip = isInt(now) ? tripOf(atlas) : null;
    if (!trip || isOver(trip, now, here)) return null;
    const pos = positionOf(trip, now);
    const when = minutes => dateText(calendar, minutes, now);
    const legs = trip.legs.map((leg, index) => ({
        index: index + 1, from: leg.from, to: leg.to, km: leg.km, kind: leg.kind, days: leg.days, time: legTime(leg, trip.unit), arrive: when(leg.arrive),
        state: leg.arrive <= now ? 'done' : index === pos.index ? 'now' : 'next',
        ...(index === pos.index && !pos.arrived ? { along: pos.along, fraction: Math.round(pos.fraction * 1000) / 1000 } : {}),
    }));
    const final = trip.legs.at(-1);
    const route = [trip.legs[0].from, ...trip.legs.map(leg => leg.to)];
    const arrived = pos.arrived;
    const arriveText = when(final.arrive);
    const pace = paceText(trip);
    // The place {{user}} is at by the story's own word, to tell what has not been written yet.
    const placeKey = keyOf(parseLocation(here).name);
    const passed = trip.legs.filter(leg => leg.arrive <= now).at(-1) ?? null;
    const reached = passed && placeKey !== keyOf(passed.to) ? { place: passed.to, date: when(passed.arrive) } : null;
    const view = {
        to: trip.to, phase: arrived ? 'arrived' : 'road', by: trip.by, pace, mount: trip.mount, short: trip.short, unit: trip.unit,
        setOut: when(trip.setOut), legs, leg: pos.index + 1, legCount: legs.length, along: pos.along, of: pos.of, fraction: Math.round(pos.fraction * 1000) / 1000,
        from: pos.leg.from, next: pos.leg.to, arrive: arriveText, route, reached, delays: trip.delays.map(delay => ({ text: `${daysWord(tidy(delay.minutes / DAY))}${delay.because ? `: ${delay.because}` : ''}` })),
    };
    view.row = arrived
        ? `Arrived at ${final.to}${arriveText ? `, ${arriveText}` : ''}`
        : [route.join(' → '), pace, `leg ${view.leg} of ${view.legCount}`, `arrive ${final.to}${arriveText ? ` ${arriveText}` : ''}`].join(' · ');
    return view;
}

/**
 * What the narrator is told while a trip is on (`view` from tripView), as lines: "On the road: …" and, when a leg's arrival has passed
 * and the story has not moved the place, "{{user}} has reached …: write ~ place …".
 */
export function tripLines(view) {
    if (!view) return [];
    const lines = [];
    if (view.reached) lines.push(`{{user}} has reached ${view.reached.place}${view.reached.date ? ` (${view.reached.date})` : ''}: write ~ place ${view.reached.place}.`);
    if (view.phase === 'road') {
        const now = view.legs[view.leg - 1];
        const then = view.legs.slice(view.leg).slice(0, 3).map(leg => `${leg.to}${leg.arrive ? `, ${leg.arrive}` : ''}`);
        const more = view.legs.length - view.leg - then.length;
        lines.push(`On the road: ${now.from} → ${now.to}, ${view.along} of ${view.of} km${now.arrive ? `, arrive ${now.arrive}` : ''}${then.length ? `; then ${then.join('; then ')}` : ''}${more > 0 ? `; and ${more} more` : ''}.`);
    }
    return lines;
}
