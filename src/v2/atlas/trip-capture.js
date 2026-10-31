// Story Director v2, atlas part: the `trip` change line (feature `story-director.trip`).
//
//   ~ trip Wolfmere Outpost | by: riding | via: Hollin's Reach     start a trip (by: foot, riding, wagon, boat, ship, …)
//   ~ trip stop                                                    end it where {{user}} is
//   ~ trip delay: 1 day | because: lame horse                      push every arrival still ahead
//
// The route is worked out here, once, from the known routes (trip.js `planTrip`) and kept as legs with their story times
// (`atlas.trips`), so a swipe, a Re-read or a delete takes it back exactly and a replay never plans again. Story Director never
// moves Story Block's place: when a leg's arrival passes, the narrator is asked to write the `~ place` line (trip.js `tripLines`).
// A line the rules cannot use fails with a plain sentence, which Story Block keeps in its problems list; nothing is saved for it.

import { DEFAULT_MAP, DEFAULT_PACES, mapSettings, parseLocation } from '../../places.js';
import { MAX_NAME, cleanName, revOf } from './domain.js';
import { MAX_DELAYS, MAX_DELAY_DAYS, MAX_LEGS, basePace, modeOf, modeWords, planTrip, positionOf, startOf, tripOf } from './trip.js';
import { packWorld, worldOf } from './world.js';

const DAY = 1440;
const AMOUNT = /^(\d+(?:\.\d+)?)\s*(m|min|mins|minutes?|h|hrs?|hours?|d|days?)?$/i;
const DELAY = /^delay\b\s*:?\s*(.*)$/i;

const asText = value => (typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value));
const queryOf = ctx => (typeof ctx?.query === 'function' ? (name, args) => ctx.query(name, args) : null);
const isInt = value => Number.isSafeInteger(value);

function sceneName(ctx) {
    try {
        const place = typeof ctx?.query === 'function' ? ctx.query('scene.place') : null;
        return asText(place?.name).trim();
    } catch {
        return '';
    }
}

// Story Block's mount pace for a ride: `mounts.pace` → { pace, mounts, riders, short, slowest } or null (no mount, or no such query).
function mountPace(ctx) {
    let out = null;
    try {
        out = typeof ctx?.query === 'function' ? ctx.query('mounts.pace', {}) : null;
    } catch {
        out = null;
    }
    const pace = Number(out?.pace);
    if (!(pace > 0) || !Number.isFinite(pace)) return { pace: DEFAULT_PACES.ride, mount: '', short: false };
    const short = Number(out.short) > 0;
    return { pace: Math.round(pace * 100) / 100, mount: short ? '' : asText(out.slowest).replace(/\s+/g, ' ').trim().slice(0, MAX_NAME), short };
}

// The story time the line is told at: the Director's minutes, or null while the clock is not set.
function storyNow(ctx) {
    try {
        const now = typeof ctx?.time === 'function' ? ctx.time() : null;
        return isInt(now) ? now : null;
    } catch {
        return null;
    }
}

// A free `<rev>.<n>` key in `trips`.
function freeKey(ctx, trips) {
    const rev = Math.max(0, revOf(ctx));
    for (let n = 0; n < 10000; n += 1) {
        const key = `${rev}.${n}`;
        if (!Object.hasOwn(trips, key)) return key;
    }
    throw new Error('No free trip key.');
}

const clear = trips => { for (const key of Object.keys(trips)) delete trips[key]; };

function stopTrip(ctx, line) {
    const atlas = ctx.draft('atlas');
    const trip = tripOf(atlas);
    if (!trip) return ctx.fail('NOT_FOUND', 'There is no trip to stop.');
    const now = storyNow(ctx);
    const pos = now === null ? null : positionOf(trip, now);
    clear(atlas.trips);
    delete atlas.trips;
    const where = pos?.mid ? `on the road between ${pos.leg.from} and ${pos.leg.to}, ${pos.along} of ${pos.of} km along` : pos?.node ? `at ${pos.node}` : '';
    return { summary: `The trip to ${trip.to} ends${where ? ` ${where}` : ''}.`, narrate: false, data: { stopped: true } };
}

function delayTrip(ctx, line, text) {
    const amount = AMOUNT.exec(text.trim());
    if (!amount) return ctx.fail('INVALID', 'A delay is a length of time, like delay: 1 day or delay: 6 hours.');
    const unit = (amount[2] ?? 'd').toLowerCase();
    const minutes = Math.round(Number(amount[1]) * (unit.startsWith('m') ? 1 : unit.startsWith('h') ? 60 : DAY));
    if (!(minutes >= 1) || minutes > MAX_DELAY_DAYS * DAY) return ctx.fail('INVALID', `A delay is from a minute to ${MAX_DELAY_DAYS} days.`);
    const atlas = ctx.draft('atlas');
    const now = storyNow(ctx);
    if (now === null) return ctx.fail('REFUSED', 'The story\'s clock is not set (write ~ time first), so a delay has no date.');
    const trip = tripOf(atlas);
    if (!trip || positionOf(trip, now).arrived) return ctx.fail('NOT_FOUND', 'There is no trip on the road to delay.');
    if (trip.delays.length >= MAX_DELAYS) return ctx.fail('REFUSED', `This trip is already delayed ${MAX_DELAYS} times. Stop it with ~ trip stop and start again.`);
    const because = cleanName(line?.labels?.because ?? line?.labels?.why ?? '').slice(0, MAX_NAME);
    const trips = (atlas.trips ??= {});
    trips[freeKey(ctx, trips)] = { kind: 'delay', at: now, rev: Math.max(0, revOf(ctx)), minutes, because };
    const hours = minutes % DAY === 0 ? `${minutes / DAY} day${minutes === DAY ? '' : 's'}` : minutes % 60 === 0 ? `${minutes / 60} hour${minutes === 60 ? '' : 's'}` : `${minutes} minutes`;
    return { summary: `The trip to ${trip.to} is delayed ${hours}${because ? ` (${because})` : ''}: every arrival ahead moves later.`, narrate: false, data: { delayed: minutes } };
}

/** `trip` lines (`~`, or `+`): start a trip, `stop` it, or `delay: …` it. */
export function applyTripLine(ctx, line) {
    const op = line?.op;
    if (!['+', '~'].includes(op)) return ctx.fail('INVALID', 'Trip lines use ~ (or +).');
    const written = asText(line?.name).replace(/\s+/g, ' ').trim();
    if (/^stop$/i.test(written)) return stopTrip(ctx, line);
    const delay = DELAY.exec(written);
    if (delay) return delayTrip(ctx, line, delay[1] || asText(line?.text));

    const destination = cleanName(parseLocation(written).name);
    if (!destination) return ctx.fail('INVALID', 'A trip needs a destination: ~ trip Place | by: riding.');
    const now = storyNow(ctx);
    if (now === null) return ctx.fail('REFUSED', 'The story\'s clock is not set (write ~ time first), so the trip has no dates.');
    const settings = typeof ctx.settings === 'function' ? ctx.settings() : {};
    const map = mapSettings(settings?.map ?? DEFAULT_MAP);
    const modern = map.era === 'modern';
    const by = cleanName(line?.labels?.by ?? '').toLowerCase().slice(0, 40);
    const mode = by ? modeOf(by, { modern }) : modern ? 'car' : 'foot';
    if (!mode) return ctx.fail('INVALID', `"${by}" is not a way of travelling here. Use ${modern ? 'foot, car, bike, bus, train, ferry, ship or plane' : 'foot, riding, wagon, boat, ship, flight or courier'}.`);

    const atlas = ctx.draft('atlas');
    const world = worldOf(atlas, packWorld(queryOf(ctx)));
    const end = world.find(destination);
    if (!end || end.hidden) return ctx.fail('NOT_FOUND', `${destination} is not on the map. Add it with + landmark or + route.`);
    const vias = [];
    for (const piece of asText(line?.labels?.via).split(',').map(item => cleanName(parseLocation(item).name)).filter(Boolean)) {
        const stop = world.find(piece);
        if (!stop || stop.hidden) return ctx.fail('NOT_FOUND', `${piece} is not on the map, so the trip cannot pass through it.`);
        vias.push(stop.id);
    }
    const here = startOf(atlas, now, sceneName(ctx));
    if (!here) return ctx.fail('REFUSED', 'The scene has no place yet, so there is nowhere to set out from.');
    let from;
    if (here.road) from = { road: here.road };
    else {
        const start = world.find(here.node);
        if (!start) return ctx.fail('NOT_FOUND', `${here.node} is not on the map, so no known route starts there.`);
        from = { node: start.id };
    }
    // A ride goes at Story Block's mount pace (its slowest mount; the walking pace when there are too few), else the default ride pace.
    const ride = mode === 'ride' ? mountPace(ctx) : { pace: basePace(mode, modern), mount: '', short: false };
    const plan = planTrip(world, { from, via: vias, to: end.id, mode, pace: mode === 'ride' ? ride.pace : null, modern, at: now });
    if (plan.error) return ctx.fail('REFUSED', plan.error);
    if (plan.legs.length > MAX_LEGS) return ctx.fail('REFUSED', 'That trip has too many stages.');

    const trips = (atlas.trips ??= {});
    clear(trips);
    trips[freeKey(ctx, trips)] = {
        kind: 'go', at: now, rev: Math.max(0, revOf(ctx)), to: end.name, by: by || modeWords(mode).replace(/^by /, ''), mode,
        pace: ride.pace, unit: modern ? 'hour' : 'day', mount: ride.mount, short: ride.short, setOut: now, legs: plan.legs,
    };
    const days = plan.days === 1 ? '1 day' : `${plan.days} days`;
    return {
        summary: `On the road to ${end.name} ${modeWords(mode)}: ${plan.legs.length === 1 ? '1 leg' : `${plan.legs.length} legs`}, ${plan.km} km, ${modern ? `${Math.round(plan.days * 240) / 10} hours` : days}.`,
        narrate: false,
        data: { legs: plan.legs.length, km: plan.km },
    };
}
