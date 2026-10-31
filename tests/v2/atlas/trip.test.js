// Trips (feature `story-director.trip`): the `trip` change line plans the way along the known routes and records the legs; where the
// party is now is worked out from the story time; delays, stops and a new trip mid-road; the narrator's lines; the movers {{user}} knows of.

import test from 'node:test';
import assert from 'node:assert/strict';

import { PRESETS, makeCalendar } from '../../../src/calendar.js';
import { part } from '../../../src/v2/atlas/index.js';
import { validateAtlas } from '../../../src/v2/atlas/domain.js';
import { modeOf, positionOf, tripLines, tripOf, tripView } from '../../../src/v2/atlas/trip.js';
import { tripsProblems } from '../../../src/v2/atlas/trip-shape.js';
import { tripTail } from '../../../src/v2/atlas/note.js';
import { deepFreeze, line, makeState, query, replay } from './helpers/fake-ctx.js';

const calendar = makeCalendar(PRESETS.gregorian);
const DAY = 1440;
// March 3, 8:00 am on the Gregorian calendar.
const T0 = calendar.toAbs({ year: 1200, month: 2, day: 3, minutes: 8 * 60 });

// Ersveil's Bluewatch road: 100 km to Hollin's Reach and 60 on to Wolfmere Outpost (160), or 70 + 130 (200) by Auvoth.
const PACK = {
    places: [
        { name: 'Bluewatch Village', region: 'Bluewatch', kind: 'village', x: 64, y: 110 },
        { name: "Hollin's Reach", region: 'Frontier', kind: 'town', x: 40, y: 90 },
        { name: 'Wolfmere Outpost', region: 'Frontier', kind: 'fort', x: 20, y: 70 },
        { name: 'Auvoth', region: 'Frontier', kind: 'fort', x: 59, y: 130 },
        { name: 'Nowhere Keep', region: 'Frontier', kind: 'fort', x: 5, y: 5 },
        { name: 'Glassdock', region: 'Frontier', kind: 'port', x: 62, y: 72 },
    ],
    routes: [
        { from: 'Bluewatch Village', to: "Hollin's Reach", kind: 'frontier road', km: 100 },
        { from: "Hollin's Reach", to: 'Wolfmere Outpost', kind: 'frontier road', km: 60 },
        { from: 'Auvoth', to: 'Bluewatch Village', kind: 'frontier road', km: 70 },
        { from: 'Wolfmere Outpost', to: 'Auvoth', kind: 'bastion road', km: 130 },
        { from: 'Glassdock', to: 'Bluewatch Village', kind: 'river', km: 440 },
    ],
};

/** A state at story minute `minutes`, with the scene at `place` and (optionally) the Director's threads. */
function stateAt(minutes, { place = 'Bluewatch Village', base = null, threads = {} } = {}) {
    const state = base ?? makeState({ place });
    return deepFreeze({
        ...state,
        domains: {
            ...state.domains,
            scene: { place: { name: place, kind: '', region: '' }, present: [] },
            director: { time: { minutes }, threads },
        },
    });
}

const trips = state => state.domains.atlas.trips;
const goRecord = state => Object.values(trips(state)).find(record => record.kind === 'go');
const run = (state, raw, { time = T0, pack = PACK, ...options } = {}) => line(state, raw, { time, pack, ...options });
const view = (state, minutes, place = 'Bluewatch Village') => query(stateAt(minutes, { place, base: state }), 'atlas.trip', {}, { pack: PACK });

function setOut(raw = '~ trip Wolfmere Outpost | by: foot', options = {}) {
    const out = run(stateAt(T0), raw, options);
    assert.ok(out.ok, out.message);
    return out;
}

test('a trip is planned along the known routes, shortest by km, with each leg rounded up to the half day', () => {
    const out = setOut();
    const record = goRecord(out.state);
    assert.deepEqual(record.legs, [
        { from: 'Bluewatch Village', to: "Hollin's Reach", km: 100, kind: 'frontier road', days: 5, start: T0, arrive: T0 + 5 * DAY },
        { from: "Hollin's Reach", to: 'Wolfmere Outpost', km: 60, kind: 'frontier road', days: 3, start: T0 + 5 * DAY, arrive: T0 + 8 * DAY },
    ]);
    assert.deepEqual({ to: record.to, by: record.by, mode: record.mode, pace: record.pace, unit: record.unit, mount: record.mount, short: record.short, setOut: record.setOut },
        { to: 'Wolfmere Outpost', by: 'foot', mode: 'foot', pace: 20, unit: 'day', mount: '', short: false, setOut: T0 });
    assert.equal(out.result.narrate, false);
    assert.match(out.result.summary, /On the road to Wolfmere Outpost on foot: 2 legs, 160 km, 8 days\./);
    assert.deepEqual(validateAtlas(out.state.domains.atlas), []);
});

test('via passes through each stop in order: the way by Auvoth is 200 km; a stop that is the start adds no leg, and a round trip can go out and back', () => {
    const out = setOut('~ trip Wolfmere Outpost | by: foot | via: Auvoth');
    assert.deepEqual(goRecord(out.state).legs.map(leg => [leg.from, leg.to, leg.km]), [['Bluewatch Village', 'Auvoth', 70], ['Auvoth', 'Wolfmere Outpost', 130]]);
    const same = setOut('~ trip Wolfmere Outpost | by: foot | via: Bluewatch Village');
    assert.equal(goRecord(same.state).legs.length, 2, 'a stop that is the start adds no leg');
    const twice = setOut('~ trip Bluewatch Village | by: foot | via: Hollin\'s Reach');
    assert.deepEqual(goRecord(twice.state).legs.map(leg => [leg.from, leg.to]), [['Bluewatch Village', "Hollin's Reach"], ["Hollin's Reach", 'Bluewatch Village']]);
});

test('a ride goes at Story Block\'s mount pace when mounts.pace answers (the walking pace when short), else the default ride pace', () => {
    const pace = answer => ({ extra: { 'mounts.pace': () => answer } });
    const burr = setOut('~ trip Wolfmere Outpost | by: riding', pace({ pace: 25, mounts: 2, riders: 1, short: 0, slowest: 'Burr' }));
    const record = goRecord(burr.state);
    assert.deepEqual([record.mode, record.pace, record.mount, record.short], ['ride', 25, 'Burr', false]);
    assert.deepEqual(record.legs.map(leg => leg.days), [4, 2.5]);
    assert.match(view(burr.state, T0).pace, /^riding, 25 km\/day \(Burr sets the pace\)$/);

    const walk = setOut('~ trip Wolfmere Outpost | by: riding', pace({ pace: 20, mounts: 1, riders: 2, short: 1, slowest: 'Burr' }));
    assert.deepEqual([goRecord(walk.state).pace, goRecord(walk.state).mount, goRecord(walk.state).short], [20, '', true]);
    assert.match(view(walk.state, T0).pace, /not enough mounts/);

    // No mounts (null), no such query (it throws) and a foot trip: the default paces.
    for (const options of [pace(null), {}]) {
        const plain = setOut('~ trip Wolfmere Outpost | by: riding', options);
        assert.deepEqual([goRecord(plain.state).pace, goRecord(plain.state).mount], [35, '']);
        assert.deepEqual(goRecord(plain.state).legs.map(leg => leg.days), [3, 2]);
    }
    const foot = setOut('~ trip Wolfmere Outpost | by: foot', pace({ pace: 25, mounts: 2, riders: 1, short: 0, slowest: 'Burr' }));
    assert.equal(goRecord(foot.state).pace, 20, 'the mounts do not speed up a walk');
    // A river goes by boat whatever the trip rides.
    const river = setOut('~ trip Glassdock | by: riding', pace({ pace: 25, mounts: 1, riders: 1, short: 0, slowest: 'Burr' }));
    assert.deepEqual(goRecord(river.state).legs.map(leg => [leg.km, leg.days]), [[440, 13]]);
});

test('the words for how the party goes; a missing by is on foot; a modern map counts km an hour', () => {
    for (const [word, mode] of [['riding', 'ride'], ['Horseback', 'ride'], ['on foot', 'foot'], ['walking', 'foot'], ['by wagon', 'wagon'], ['cart', 'wagon'], ['barge', 'boat'], ['sailing', 'ship'], ['flying', 'flight']]) {
        assert.equal(modeOf(word), mode, word);
    }
    assert.equal(modeOf('teleport'), '');
    assert.equal(modeOf('driving', { modern: true }), 'car');
    const plain = setOut('~ trip Wolfmere Outpost');
    assert.equal(goRecord(plain.state).mode, 'foot');
    const modern = setOut('~ trip Wolfmere Outpost | by: foot', { settings: { map: { era: 'modern' } } });
    const record = goRecord(modern.state);
    assert.deepEqual([record.unit, record.pace], ['hour', 5]);
    assert.ok(Math.abs(record.legs[0].days - 20 / 24) < 1e-6, 'a hundred km at 5 km an hour is 20 hours, rounded up to the quarter hour');
});

test('a line that cannot be used is refused with a plain sentence and writes nothing', () => {
    const refuse = (raw, pattern, options = {}) => {
        const out = run(stateAt(T0), raw, options);
        assert.equal(out.ok, false, raw);
        assert.match(out.message, pattern, raw);
        assert.equal(out.state.domains.atlas.trips, undefined, raw);
    };
    refuse('~ trip Nowhere Keep | by: foot', /No known route from Bluewatch Village to Nowhere Keep\./);
    refuse('~ trip Wolfmere Outpost | via: Nowhere Keep', /No known route from Bluewatch Village to Nowhere Keep\./);
    refuse('~ trip Atlantis', /Atlantis is not on the map/);
    refuse('~ trip Wolfmere Outpost | via: Atlantis', /Atlantis is not on the map/);
    refuse('~ trip Wolfmere Outpost | by: teleport', /"teleport" is not a way of travelling here/);
    refuse('~ trip Bluewatch Village', /already there/);
    refuse('~ trip Wolfmere Outpost', /clock is not set/, { time: null });
    refuse('- trip Wolfmere Outpost', /use ~/);
    const nowhere = line(stateAt(T0, { place: '' }), '~ trip Wolfmere Outpost', { time: T0, pack: PACK });
    assert.match(nowhere.message, /no place yet/);
});

test('where the party is comes from the story time against the legs: km along, the leg, arrivals', () => {
    const { state } = setOut();
    const trip = tripOf(state.domains.atlas);
    const at = days => positionOf(trip, T0 + days * DAY);
    assert.deepEqual([at(0).along, at(0).node, at(0).mid], [0, 'Bluewatch Village', false]);
    assert.deepEqual([at(2).index, at(2).along, at(2).of, at(2).mid, at(2).node], [0, 40, 100, true, null]);
    assert.deepEqual([at(5).index, at(5).along, at(5).node], [1, 0, "Hollin's Reach"], 'at the first arrival the second leg is set out on');
    assert.deepEqual([at(6.5).index, at(6.5).along, at(6.5).of], [1, 30, 60]);
    const end = at(8);
    assert.deepEqual([end.arrived, end.node, end.along], [true, 'Wolfmere Outpost', 60]);
    assert.equal(at(30).arrived, true);

    const day2 = view(state, T0 + 2 * DAY);
    assert.deepEqual([day2.phase, day2.leg, day2.legCount, day2.along, day2.of], ['road', 1, 2, 40, 100]);
    assert.deepEqual(day2.legs.map(leg => leg.state), ['now', 'next']);
    assert.equal(day2.legs[0].arrive, 'March 8');
    assert.equal(day2.arrive, 'March 11');
    assert.equal(day2.setOut, 'March 3');
    assert.equal(day2.row, "Bluewatch Village → Hollin's Reach → Wolfmere Outpost · on foot, 20 km/day · leg 1 of 2 · arrive Wolfmere Outpost March 11");
    assert.deepEqual(day2.you, { fromId: 'pack:bluewatch village', toId: 'pack:hollins reach', t: 0.4, along: 40, of: 100 });
});

test('the narrator is told where the party is, then to write ~ place when a stage has been reached', () => {
    const { state } = setOut();
    const lines = (days, place = 'Bluewatch Village') => tripLines(tripView(state.domains.atlas, { now: T0 + days * DAY, here: place, calendar }));
    assert.deepEqual(lines(2), ["On the road: Bluewatch Village → Hollin's Reach, 40 of 100 km, arrive March 8; then Wolfmere Outpost, March 11."]);
    assert.deepEqual(lines(5.5), [
        "{{user}} has reached Hollin's Reach (March 8): write ~ place Hollin's Reach.",
        "On the road: Hollin's Reach → Wolfmere Outpost, 10 of 60 km, arrive March 11.",
    ]);
    assert.deepEqual(lines(5.5, "Hollin's Reach"), ["On the road: Hollin's Reach → Wolfmere Outpost, 10 of 60 km, arrive March 11."], 'the place is written: no more cue');
    assert.deepEqual(lines(9), ['{{user}} has reached Wolfmere Outpost (March 11): write ~ place Wolfmere Outpost.']);
    assert.deepEqual(lines(9, 'Wolfmere Outpost'), []);
    // The same through the part's tail, on the state it is given; nothing while the feature is off.
    const head = stateAt(T0 + 2 * DAY, { base: state });
    const viewOf = feature => ({ state: head, query: (name, args) => query(head, name, args, { pack: PACK }), feature: () => feature });
    assert.deepEqual(tripTail(viewOf(true)).lines, lines(2));
    assert.deepEqual(tripTail(viewOf(false)).lines, []);
    assert.deepEqual(tripTail({ state: stateAt(T0), query: () => null, feature: () => true }).lines, []);
});

test('Arrived at X until the place changes or a new trip starts; after that the trip is gone from every screen', () => {
    const { state } = setOut();
    const after = minutes => view(state, minutes, 'Wolfmere Outpost');
    assert.equal(after(T0 + 9 * DAY).row, 'Arrived at Wolfmere Outpost, March 11');
    assert.equal(after(T0 + 9 * DAY).phase, 'arrived');
    assert.equal(after(T0 + 9 * DAY).you, null);
    assert.equal(view(state, T0 + 9 * DAY, 'Bluewatch Village').row, 'Arrived at Wolfmere Outpost, March 11', 'the story has not moved the place yet');
    assert.equal(view(state, T0 + 9 * DAY, "Hollin's Reach").phase, 'arrived');
    assert.equal(view(state, T0 + 9 * DAY, 'Auvoth'), null, 'the place changed to somewhere the trip never named');
    assert.equal(view(state, T0 + 2 * DAY, 'Auvoth').phase, 'road', 'on the road the trip stays');
    // A new trip from the arrival starts at the destination, even before the place is written.
    const next = run(stateAt(T0 + 9 * DAY, { place: 'Bluewatch Village', base: state }), '~ trip Auvoth | by: foot', { time: T0 + 9 * DAY });
    assert.ok(next.ok, next.message);
    assert.deepEqual(goRecord(next.state).legs.map(leg => [leg.from, leg.to]), [['Wolfmere Outpost', 'Auvoth']]);
    assert.equal(Object.keys(trips(next.state)).length, 1, 'the new trip takes the old one away');
});

test('~ trip delay pushes every arrival still ahead; the party stands still while it is held, and a delay is its own record', () => {
    const first = setOut();
    const { state } = first;
    const held = run(stateAt(T0 + 2 * DAY, { base: state }), '~ trip delay: 1 day | because: lame horse', { time: T0 + 2 * DAY });
    assert.ok(held.ok, held.message);
    assert.match(held.result.summary, /delayed 1 day \(lame horse\): every arrival ahead moves later\./);
    const records = Object.values(trips(held.state));
    assert.equal(records.length, 2);
    assert.deepEqual(records.find(record => record.kind === 'delay'), { kind: 'delay', at: T0 + 2 * DAY, rev: 2, minutes: DAY, because: 'lame horse' });
    assert.deepEqual(goRecord(held.state).legs.map(leg => leg.arrive), [T0 + 5 * DAY, T0 + 8 * DAY], 'the plan is kept as it was made');
    const trip = tripOf(held.state.domains.atlas);
    assert.deepEqual(trip.legs.map(leg => leg.arrive), [T0 + 6 * DAY, T0 + 9 * DAY]);
    assert.equal(trip.legs[1].start, T0 + 6 * DAY);
    assert.deepEqual(trip.delays, [{ minutes: DAY, because: 'lame horse' }]);
    const at = days => positionOf(trip, T0 + days * DAY).along;
    assert.deepEqual([at(2), at(2.5), at(3), at(4)], [40, 40, 40, 60], 'held a day at 40 km, then on: 20 km a day');
    assert.equal(view(held.state, T0 + 3 * DAY).arrive, 'March 12');
    assert.match(view(held.state, T0 + 3 * DAY).delays[0].text, /1 day: lame horse/);
    // Hours, and a delay at a stage's end that moves the later stages whole.
    const hours = run(stateAt(T0 + 6 * DAY, { base: held.state }), '~ trip delay: 6 hours', { time: T0 + 6 * DAY });
    assert.ok(hours.ok, hours.message);
    assert.equal(tripOf(hours.state.domains.atlas).legs[1].arrive, T0 + 9 * DAY + 360);
    assert.deepEqual(replay(stateAt(T0), [first, held]).domains.atlas.trips, held.state.domains.atlas.trips, 'replaying the ops gives the same records');
});

test('two delays that overlap hold the party once each, one after the other: the km along never drops, and the arrivals are those of the sum', () => {
    const { state } = setOut();
    const first = run(stateAt(T0 + 2 * DAY, { base: state }), '~ trip delay: 1 day', { time: T0 + 2 * DAY });
    const second = run(stateAt(T0 + 2.5 * DAY, { base: first.state }), '~ trip delay: 1 day', { time: T0 + 2.5 * DAY });
    assert.ok(first.ok && second.ok, second.message);
    const trip = tripOf(second.state.domains.atlas);
    assert.deepEqual(trip.legs[0].holds, [{ at: T0 + 2 * DAY, minutes: DAY }, { at: T0 + 3 * DAY, minutes: DAY }], 'the second hold starts where the first ends');
    assert.deepEqual(trip.legs.map(leg => leg.arrive), [T0 + 7 * DAY, T0 + 10 * DAY], 'the arrivals move by both days, as before');
    const along = days => positionOf(trip, T0 + days * DAY).along;
    assert.deepEqual([2, 2.5, 3, 3.5, 4].map(along), [40, 40, 40, 40, 40], 'held at 40 km until both holds end (it was 40, 40, 30, 30 before)');
    assert.deepEqual([4.5, 5, 6].map(along), [50, 60, 80], 'then on, 20 km a day');
    assert.equal(view(second.state, T0 + 3.5 * DAY).you.along, 40);
    // Two delays written in one reply (the same story time) hold one after the other too.
    const both = run(stateAt(T0 + 2 * DAY, { base: first.state }), '~ trip delay: 12 hours', { time: T0 + 2 * DAY });
    const holds = tripOf(both.state.domains.atlas).legs[0].holds;
    assert.deepEqual(holds, [{ at: T0 + 2 * DAY, minutes: DAY }, { at: T0 + 3 * DAY, minutes: 720 }]);
    // Replaying the records gives the same trip.
    assert.deepEqual(tripOf(replay(stateAt(T0), [setOut(), first, second]).domains.atlas), trip);
});

test('a delay needs a trip on the road: none, arrived, bad lengths and a ninth are refused', () => {
    const none = run(stateAt(T0), '~ trip delay: 1 day');
    assert.match(none.message, /no trip on the road to delay/);
    const { state } = setOut();
    const arrived = run(stateAt(T0 + 9 * DAY, { base: state }), '~ trip delay: 1 day', { time: T0 + 9 * DAY });
    assert.match(arrived.message, /no trip on the road to delay/);
    for (const raw of ['~ trip delay: soon', '~ trip delay: 0 days', '~ trip delay: 40 days']) assert.equal(run(stateAt(T0 + DAY, { base: state }), raw, { time: T0 + DAY }).ok, false, raw);
    assert.match(run(stateAt(T0 + DAY, { base: state }), '~ trip delay: 1 day', { time: null }).message, /clock is not set/);
    let current = state;
    for (let n = 0; n < 8; n += 1) {
        const out = run(stateAt(T0 + DAY, { base: current }), '~ trip delay: 1 hour', { time: T0 + DAY });
        assert.ok(out.ok, `${n}: ${out.message}`);
        current = out.state;
    }
    assert.match(run(stateAt(T0 + DAY, { base: current }), '~ trip delay: 1 hour', { time: T0 + DAY }).message, /already delayed 8 times/);
});

test('Arrived at X ends when the party is back at a place of the trip other than the destination three days after the arrival, not before', () => {
    const { state } = setOut();
    const at = (days, place) => view(state, T0 + days * DAY, place);
    assert.equal(at(8 + 2.9, 'Bluewatch Village').phase, 'arrived', 'the narrator has three days to write the arrival');
    assert.deepEqual(tripLines(tripView(state.domains.atlas, { now: T0 + 10.9 * DAY, here: 'Bluewatch Village', calendar })), ['{{user}} has reached Wolfmere Outpost (March 11): write ~ place Wolfmere Outpost.']);
    assert.equal(at(8 + 3, 'Bluewatch Village'), null, 'back at the start: the trip is over, and so is the cue');
    assert.deepEqual(tripLines(tripView(state.domains.atlas, { now: T0 + 11 * DAY, here: 'Bluewatch Village', calendar })), []);
    assert.equal(at(8 + 30, "Hollin's Reach"), null, 'an earlier stop too');
    assert.equal(at(8 + 30, 'Wolfmere Outpost').phase, 'arrived', 'at the destination the arrival stays until the story moves on');
    // A new trip from the start place, once over, sets out from the scene's place.
    const next = run(stateAt(T0 + 12 * DAY, { place: 'Bluewatch Village', base: state }), '~ trip Auvoth | by: foot', { time: T0 + 12 * DAY });
    assert.deepEqual(goRecord(next.state).legs.map(leg => [leg.from, leg.to]), [['Bluewatch Village', 'Auvoth']]);
});

test('~ trip stop ends the trip where the party is; with none it is refused', () => {
    assert.match(run(stateAt(T0), '~ trip stop').message, /no trip to stop/);
    const { state } = setOut();
    const stopped = run(stateAt(T0 + 2 * DAY, { base: state }), '~ trip stop', { time: T0 + 2 * DAY });
    assert.ok(stopped.ok, stopped.message);
    assert.match(stopped.result.summary, /The trip to Wolfmere Outpost ends on the road between Bluewatch Village and Hollin's Reach, 40 of 100 km along\./);
    assert.equal(stopped.state.domains.atlas.trips, undefined);
    assert.equal(view(stopped.state, T0 + 2 * DAY), null);
    assert.deepEqual(validateAtlas(stopped.state.domains.atlas), []);
    const home = run(stateAt(T0, { base: state }), '~ trip stop', { time: T0 });
    assert.match(home.result.summary, /ends at Bluewatch Village\./);
});

test('a new trip mid-road continues along the current leg: back to its start or on to its end, whichever gets there sooner', () => {
    const { state } = setOut();
    const midway = days => stateAt(T0 + days * DAY, { base: state });
    // 40 km along: Auvoth is 40 back and 70 on, against 60 on and 190 round by Wolfmere.
    const back = run(midway(2), '~ trip Auvoth | by: foot', { time: T0 + 2 * DAY });
    assert.ok(back.ok, back.message);
    assert.deepEqual(goRecord(back.state).legs.map(leg => ({ from: leg.from, to: leg.to, km: leg.km, skip: leg.skip, days: leg.days })), [
        { from: "Hollin's Reach", to: 'Bluewatch Village', km: 100, skip: 60, days: 2 },
        { from: 'Bluewatch Village', to: 'Auvoth', km: 70, skip: undefined, days: 3.5 },
    ]);
    const at = days => positionOf(tripOf(back.state.domains.atlas), T0 + (2 + days) * DAY);
    assert.deepEqual([at(0).along, at(0).mid, at(1).along, at(2).node, at(2).index], [60, true, 80, 'Bluewatch Village', 1], 'the road is run the other way: 20 km a day from 60 of 100, and the stage ends at the start');
    assert.deepEqual(validateAtlas(back.state.domains.atlas), []);
    // On to the end: Wolfmere Outpost is past Hollin's Reach.
    const onward = run(midway(2), '~ trip Wolfmere Outpost | by: foot', { time: T0 + 2 * DAY });
    assert.deepEqual(goRecord(onward.state).legs.map(leg => [leg.from, leg.to, leg.km, leg.skip ?? 0, leg.days]), [['Bluewatch Village', "Hollin's Reach", 100, 40, 3], ["Hollin's Reach", 'Wolfmere Outpost', 60, 0, 3]]);
    // No known route on from either end: refused, and the old trip stands.
    const here = midway(2);
    const stuck = run(here, '~ trip Nowhere Keep | by: foot', { time: T0 + 2 * DAY });
    assert.equal(stuck.ok, false);
    assert.match(stuck.message, /You are on the road between Bluewatch Village and Hollin's Reach, and it only goes on to Hollin's Reach or back to Bluewatch Village\./);
    assert.match(stuck.message, /No known route from Hollin's Reach to Nowhere Keep\. No known route from Bluewatch Village to Nowhere Keep\./);
    assert.equal(stuck.state, here, 'nothing is written: the old trip stands');
    // Between stages, at a place, the new trip starts from that place.
    const between = run(midway(5), '~ trip Auvoth | by: foot', { time: T0 + 5 * DAY });
    assert.deepEqual(goRecord(between.state).legs.map(leg => [leg.from, leg.to]), [["Hollin's Reach", 'Bluewatch Village'], ['Bluewatch Village', 'Auvoth']], "from Hollin's Reach, 100 + 70 km back beats 60 + 130 on");
});

test('what the domain keeps is checked: a trip record, a delay record, and an atlas without trips', () => {
    const { state } = setOut();
    assert.deepEqual(tripsProblems(state.domains.atlas.trips), []);
    assert.deepEqual(validateAtlas(makeState().domains.atlas), []);
    const bad = patch => tripsProblems(patch(structuredClone(state.domains.atlas.trips)));
    assert.match(bad(t => { t['1.0'].legs[0].km = 0; return t; })[0], /km must be a whole number/);
    assert.match(bad(t => { t['1.0'].legs[0].skip = 100; return t; })[0], /skip/);
    assert.match(bad(t => { t['1.0'].legs = []; return t; })[0], /legs is a list/);
    assert.match(bad(t => { t['1.0'].unit = 'week'; return t; })[0], /unit/);
    assert.match(bad(t => { t['1.0'].extra = 1; return t; })[0], /unknown field "extra"/);
    assert.match(bad(t => { t.nonsense = { kind: 'go' }; return t; })[0], /not a trip record/);
    assert.match(bad(t => { t['2.0'] = { kind: 'delay', at: 1, rev: 2, minutes: 0, because: '' }; return t; })[0], /minutes must be/);
    assert.match(bad(t => { t['2.0'] = { kind: 'wait', at: 1, rev: 2 }; return t; })[0], /go or delay/);
    assert.match(validateAtlas({ ...state.domains.atlas, trips: [] })[0], /not an object/);
    assert.deepEqual(part.domains.atlas.scratch, ['trips']);
});

test('movers {{user}} knows of: open events with a leg between two places and an arrival ahead; never an agenda, a secret or a planned one', () => {
    const thread = (key, kind, fields, extra = {}) => ({ id: `th_${key.replace(/\W/g, '').toLowerCase().padEnd(8, 'x').slice(0, 8)}`, key, kind, status: 'active', summary: `${key} moves`, fields, track: { legSince: { turn: 1, time: T0 }, ...extra.track }, ...extra.thread });
    const threads = Object.fromEntries([
        thread('Guild courier', 'event', { leg: 'Auvoth → Bluewatch Village', arrive: 'March 9' }),
        thread('Salt barge', 'event', { leg: 'Glassdock → Bluewatch Village', arrive: 'March 20' }),
        thread('Grey caravan', 'agenda', { leg: 'Auvoth → Bluewatch Village', arrive: 'March 9' }),
        thread('Black seal', 'secret', { leg: 'Auvoth → Bluewatch Village', arrive: 'March 9' }),
        thread('Planned ambush', 'event', { leg: 'Auvoth → Bluewatch Village', arrive: 'March 9' }, { track: { arc: 'ar_aaaaaaaa' } }),
        thread('Already there', 'event', { leg: 'Auvoth → Bluewatch Village', arrive: 'March 4' }),
        thread('Lost cart', 'event', { leg: 'Atlantis → Bluewatch Village', arrive: 'March 9' }),
        thread('No date', 'event', { leg: 'Auvoth → Bluewatch Village' }),
        thread('Resolved rider', 'event', { leg: 'Auvoth → Bluewatch Village', arrive: 'March 9' }, { thread: { status: 'resolved', ended: { outcome: 'done' } } }),
        thread('Hook rider', 'hook', { leg: 'Auvoth → Bluewatch Village', arrive: 'March 9' }),
    ].map(entry => [entry.id, entry]));
    const out = query(stateAt(T0 + 2 * DAY, { threads }), 'atlas.trip', {}, { pack: PACK });
    assert.equal(out.on, false);
    assert.equal(out.hasMovers, true);
    assert.deepEqual(out.movers.map(mover => [mover.name, mover.from, mover.to, mover.arrive]), [
        ['Guild courier', 'Auvoth', 'Bluewatch Village', 'March 9'], ['Salt barge', 'Glassdock', 'Bluewatch Village', 'March 20'],
    ]);
    const courier = out.movers[0];
    assert.deepEqual([courier.fromId, courier.toId], ['pack:auvoth', 'pack:bluewatch village']);
    assert.ok(courier.t > 0.2 && courier.t < 0.5, `t = ${courier.t}`);
    assert.equal(query(stateAt(T0 + 2 * DAY), 'atlas.trip', {}, { pack: PACK }), null, 'no trip and no mover: nothing');
    // A hidden place never carries a mover.
    const hidden = query(stateAt(T0 + 2 * DAY, { threads }), 'atlas.trip', {}, { pack: { ...PACK, places: PACK.places.map(place => (place.name === 'Auvoth' ? { ...place, hidden: true } : place)) } });
    assert.deepEqual(hidden.movers.map(mover => mover.name), ['Salt barge']);
});

test('the query carries the trip and its movers together; the leg ids and the "You" point are what the map draws', () => {
    const { state } = setOut();
    const threads = { th_courier: { id: 'th_courier', key: 'Guild courier', kind: 'event', status: 'active', summary: 'news', fields: { leg: 'Auvoth → Bluewatch Village', arrive: 'March 9' }, track: { legSince: { turn: 1, time: T0 } } } };
    const out = query(stateAt(T0 + 2 * DAY, { base: state, threads }), 'atlas.trip', {}, { pack: PACK });
    assert.equal(out.on, true);
    assert.deepEqual(out.legs.map(leg => [leg.fromId, leg.toId]), [['pack:bluewatch village', 'pack:hollins reach'], ['pack:hollins reach', 'pack:wolfmere outpost']]);
    assert.equal(out.movers.length, 1);
    assert.equal(out.row.startsWith('Bluewatch Village → '), true);
    // No clock: no answer (a trip's position needs the time).
    assert.equal(query(deepFreeze({ ...state, domains: { ...state.domains, director: { time: { minutes: null }, threads: {} } } }), 'atlas.trip', {}, { pack: PACK }), null);
});
