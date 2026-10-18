// Modern travel (0.9.0): road codes, modes, km an hour, transfers, boarding and nights.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeCalendar } from '../src/calendar.js';
import { estimateTrip, formatTrip } from '../src/places.js';
import { durationText, formatRoute, loadWorldPack, packSummary, paceFor, parseLeg, planRoute, validateLeg } from '../src/routes.js';
import { travelFindings } from '../src/travel.js';
import { emptyTracker } from '../src/tracker.js';

const CITY = {
    source: 'A small modern region, for tests',
    era: 'modern',
    scale_km_per_unit: 1,
    places: {
        Home: { x: 0, y: 0 }, Downtown: { x: 10, y: 5 }, Airport: { x: 30, y: 0 },
        'North City': { x: 30, y: 900 }, Lakeside: { x: -8, y: -6 },
    },
    edges: [
        { a: 'Home', b: 'Downtown', km: 14, code: 'ST' },
        { a: 'Downtown', b: 'Airport', km: 25, code: 'MW' },
        { a: 'Downtown', b: 'Airport', km: 24, code: 'RL' },
        { a: 'Airport', b: 'North City', km: 920, code: 'AR' },
        { a: 'Downtown', b: 'North City', km: 1100, code: 'MW' },
        { a: 'Home', b: 'Lakeside', km: 12, code: 'TR' },
    ],
    pace_km_per_hour: { ST: { car: 30 } },
};
const { pack, warnings } = loadWorldPack(CITY);

test('a modern pack: its era, the built-in codes and its own paces over them', () => {
    assert.deepEqual(warnings, []);
    assert.equal(pack.era, 'modern');
    assert.equal(packSummary(pack), '5 places · 6 routes · modern');
    assert.deepEqual(paceFor(pack, 'ST', 'car'), { rate: 30, low: 30, high: 30 }, 'the pack\'s own pace');
    assert.equal(paceFor(pack, 'MW', 'car').rate, 100, 'the built-in pace');
    assert.equal(paceFor(pack, 'MW', 'bike'), null, 'no bikes on the motorway');
    assert.equal(paceFor(pack, 'AR', 'flight').rate, 750, '"flight" is a plane');
    // pace_km_per_hour alone makes a pack modern; an unknown code with no paces is noted.
    const own = loadWorldPack({ places: { A: {}, B: {} }, edges: [{ a: 'A', b: 'B', km: 5, code: 'QX' }, { a: 'A', b: 'B', km: 5, code: 'BX' }], pace_km_per_hour: { BX: { car: 40, hovercraft: 90 } } });
    assert.equal(own.pack.era, 'modern');
    assert.deepEqual(own.warnings, [
        'Unknown road code "QX" with no paces in pace_km_per_hour (nothing can use it).',
        'Pace BX.hovercraft: "hovercraft" is not a modern mode (foot, bike, car, motorbike, bus, train, metro, ferry, ship, plane).',
    ]);
    assert.equal(paceFor(own.pack, 'BX', 'car').rate, 40);
    assert.equal(loadWorldPack({ era: 'medieval', places: { A: {}, B: {} }, edges: [{ a: 'A', b: 'B', km: 5, code: 'R' }] }).pack.era, 'pre-modern');
});

test('routes count hours: quarter hours, the fastest roads, a night on a long drive', () => {
    assert.equal(formatRoute(planRoute(pack, 'Home', 'Lakeside', { mode: 'bike' })), 'Home → Lakeside 12 TR = 12 km · bike 12 km/h · 1 h');
    const drive = planRoute(pack, 'Home', 'North City', { mode: 'drive' });
    assert.equal(drive.stops, 1);
    assert.equal(formatRoute(drive),
        'Home → Downtown 14 ST → North City 1100 MW = 1114 km · car 30–100 km/h · 11 h 30 min on the way + 1 night = 1 day 1 h 30 min');
    assert.equal(planRoute(pack, 'Home', 'Lakeside', { mode: 'car' }), null, 'no road for cars');
});

test('public transport reaches its station by a short transfer and boards', () => {
    assert.equal(formatRoute(planRoute(pack, 'Downtown', 'North City', { mode: 'plane' })),
        'Downtown → Airport 25 MW (car) → North City 920 AR = 945 km · plane 750 km/h · 2 h boarding · 3 h 30 min');
    assert.equal(formatRoute(planRoute(pack, 'Downtown', 'Airport', { mode: 'train' })),
        'Downtown → Airport 24 RL = 24 km · train 90 km/h · 15 min boarding · 45 min', 'the train where there is one');
    // Nothing flies from Home and the only road out is 14 km of streets: a taxi, then the plane.
    const plan = planRoute(pack, 'Home', 'North City', { mode: 'plane' });
    assert.deepEqual(plan.hops.map(hop => hop.mode ?? 'plane'), ['car', 'car', 'plane']);
    assert.equal(plan.stops, 0, 'no nights on a flight');
});

test('legs in hours: read, checked, corrected', () => {
    const leg = parseLeg(pack, 'Home → Downtown 14 ST, drive 30/h → 30 min');
    assert.equal(leg.mode, 'car');
    assert.equal(leg.code, 'ST');
    assert.equal(leg.rate, 30);
    assert.equal(leg.days * 24, 0.5);
    assert.equal(parseLeg(pack, 'Home → Downtown 14 ST, car 30 km/h → 0.5').days * 24, 0.5, 'a bare number is hours');
    assert.deepEqual(validateLeg(pack, 'Home → Downtown 14 ST, car 30/h → 0.5 h'), []);
    assert.deepEqual(validateLeg(pack, 'Home → Downtown 14 ST, car 30/h → 2 h').map(f => [f.message, f.correction]), [
        ['14 km at 30 km/h is 30 min, not 2 h.', 'Home → Downtown 14 ST, car 30/h → 0.5 h'],
    ]);
    assert.equal(validateLeg(pack, 'Downtown → Airport 24 RL, train 300 km/h')[0].message, 'Train on RL goes 90 km/h, not 300.');
    assert.equal(validateLeg(pack, 'Home → Lakeside 12 TR, car')[0].kind, 'leg-mode');
    assert.equal(validateLeg(pack, 'Downtown → Airport 25 MW, plane')[0].kind, 'leg-mode', 'a leg is one hop by one mode');
    assert.equal(validateLeg(pack, 'Home → Airport, taxi')[0].kind, 'leg-not-one-hop');
});

test('a modern arrival is checked to the quarter hour or a tenth of the trip', () => {
    const cal = makeCalendar('gregorian');
    const depart = cal.parse('June 3, 2031, 09:00 am').abs;
    const tracker = emptyTracker();
    tracker.records.push({ id: 'r1', key: 'Courier van', kind: 'agenda', status: 'active', fields: { leg: 'Downtown → North City 1100 MW, car 100/h → 11 h', arrive: 'June 3, 2031, 08:00 pm' }, legSince: { time: depart } });
    const [late] = travelFindings(tracker, { pack, calendar: cal });
    assert.equal(late.kind, 'leg-arrive');
    assert.match(late.message, /^Courier van: Arrival June 3, 08:00 pm is 14 h off: 1 day 1 h from June 3, 09:00 am is June 4, 10:00 am\.$/);
    tracker.records[0].fields.arrive = 'June 4, 2031, 11:30 am';
    assert.deepEqual(travelFindings(tracker, { pack, calendar: cal }), [], 'within a tenth of a 25-hour trip');
});

test('without a pack, a modern map estimates in hours', () => {
    const a = { name: 'Home', coords: { x: 0, y: 0 } };
    const b = { name: 'Coast', coords: { x: 600, y: 800 } };
    const map = { kmPerUnit: 1, roadFactor: 1.25, era: 'modern' };
    const car = estimateTrip(a, b, { map, mode: 'car' });
    assert.equal(car.unit, 'hour');
    assert.equal(formatTrip(car, { map }), 'Home → Coast ≈ 1250 km NE (≈ 1000 km straight × 1.25) · car 70 km/h · 1 day 8 h (1 night on the way)');
    assert.equal(formatTrip(estimateTrip(a, b, { map, mode: 'plane' }), { map }), 'Home → Coast 1000 km NE · plane 750 km/h · 3 h 30 min');
    assert.equal(estimateTrip(a, b, { map: { ...map, era: 'pre-modern' }, mode: 'foot' }).unit, 'day');
});

test('durations read like a clock', () => {
    assert.equal(durationText(0.25 / 24, 'hour'), '15 min');
    assert.equal(durationText(2.25 / 24, 'hour'), '2 h 15 min');
    assert.equal(durationText(27 / 24, 'hour'), '1 day 3 h');
    assert.equal(durationText(1.5), '1.5 days');
});
