import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_PACES, MODERN_PACES, estimateTrip } from '../../../src/places.js';
import { DEFAULT_RULES, MODERN_RULES, durationText, legDays, loadWorldPack, planRoute, restDaysFor } from '../../../src/routes.js';
import { travelTime } from '../../../src/v2/atlas/travel.js';
import { packWorld, worldOf } from '../../../src/v2/atlas/world.js';
import { command, lines, makeState, placeNamed, query } from './helpers/fake-ctx.js';

const tidy = value => Math.round(value * 1e9) / 1e9;
const EMPTY = { places: {}, routes: {}, keys: {}, focus: null };

// The same roads as Story Director packs give them and as a v1 world pack holds them.
const PLACES = [
    { name: 'Shorn', region: 'North', kind: 'town', x: 0, y: 0 },
    { name: 'Varnhold Watch', region: 'North', kind: 'fort', x: 100, y: 0 },
    { name: 'Auvoth', region: 'North', kind: 'city', x: 180, y: 40 },
    { name: 'Ninebarge Crossing', region: 'Delta', kind: 'town', x: 180, y: 120 },
];
const ROADS = [
    { from: 'Shorn', to: 'Varnhold Watch', km: 130, kind: 'road' },
    { from: 'Varnhold Watch', to: 'Auvoth', km: 90, kind: 'road' },
    { from: 'Shorn', to: 'Auvoth', km: 300, kind: 'road' },
];
const RIVER = [{ from: 'Auvoth', to: 'Ninebarge Crossing', km: 140, kind: 'river' }];

const packQuery = content => (name, { kind } = {}) => (name === 'packs.content' ? structuredClone(content[kind] ?? []) : undefined);
const worldFor = (content, atlas = EMPTY) => worldOf(atlas, packWorld(packQuery(content)));

function v1Pack(routes) {
    const code = kind => (kind === 'river' ? 'W' : 'R');
    const { pack, errors } = loadWorldPack({
        places: Object.fromEntries(PLACES.map(place => [place.name, { x: place.x, y: place.y, region: place.region }])),
        edges: routes.map(route => ({ a: route.from, b: route.to, km: route.km, code: code(route.kind) })),
        // v1's paces without a world pack (places.js DEFAULT_PACES), as a pack's table.
        paces: { R: { foot: DEFAULT_PACES.foot, ride: DEFAULT_PACES.ride, wagon: DEFAULT_PACES.wagon }, W: { boat: DEFAULT_PACES.boat } },
    });
    assert.deepEqual(errors, []);
    return pack;
}

test('along pack roads by km: the same days as v1\'s planRoute (per-leg round-up, rest days)', () => {
    const world = worldFor({ places: PLACES, routes: ROADS });
    const pack = v1Pack(ROADS);
    for (const mode of ['foot', 'ride', 'wagon']) {
        for (const [from, to] of [['Shorn', 'Varnhold Watch'], ['Shorn', 'Auvoth'], ['Auvoth', 'Shorn'], ['Varnhold Watch', 'Auvoth']]) {
            const mine = travelTime(world, from, to, { mode });
            const v1 = planRoute(pack, from, to, { mode });
            assert.equal(mine.days, v1.days, `${mode} ${from} → ${to}`);
            assert.equal(mine.restDays, v1.restDays, `${mode} ${from} → ${to}`);
            assert.equal(mine.km, v1.km, `${mode} ${from} → ${to}`);
            assert.equal(mine.source, 'routes');
            assert.equal(mine.text, durationText(v1.days, 'day'));
        }
    }
    // Shorn → Auvoth on foot: 6.5 + 4.5 days by the watch, a rest day after six.
    assert.deepEqual(travelTime(world, 'Shorn', 'Auvoth'), {
        ...travelTime(world, 'Shorn', 'Auvoth'), days: 12, activeDays: 11, restDays: 1, unit: 'day', mode: 'foot', km: 220,
    });
});

test('a river goes by boat whatever the trip: v1\'s boat days and no rest days', () => {
    const world = worldFor({ places: PLACES, routes: RIVER });
    const mine = travelTime(world, 'Auvoth', 'Ninebarge Crossing', { mode: 'boat' });
    assert.equal(mine.days, planRoute(v1Pack(RIVER), 'Auvoth', 'Ninebarge Crossing', { mode: 'boat' }).days);
    assert.equal(travelTime(world, 'Auvoth', 'Ninebarge Crossing', { mode: 'foot' }).activeDays, legDays(140, DEFAULT_PACES.boat, DEFAULT_RULES));
});

test('one leg by km is v1\'s legDays plus restDaysFor, also on a modern map', () => {
    const world = worldFor({ places: PLACES, routes: [{ from: 'Shorn', to: 'Varnhold Watch', km: 260, kind: 'road' }] });
    const active = legDays(260, DEFAULT_PACES.ride, DEFAULT_RULES);
    assert.equal(travelTime(world, 'Shorn', 'Varnhold Watch', { mode: 'ride' }).days, active + restDaysFor('ride', active, DEFAULT_RULES));
    const modern = travelTime(world, 'Shorn', 'Varnhold Watch', { map: { era: 'modern' } });
    const hours = legDays(260, MODERN_PACES.car, MODERN_RULES);
    assert.equal(modern.mode, 'car');
    assert.equal(modern.unit, 'hour');
    assert.equal(modern.days, hours + restDaysFor('car', hours, MODERN_RULES));
    assert.equal(modern.text, durationText(modern.days, 'hour'));
});

test('without routes: v1\'s estimate from the coordinates (straight line × road factor)', () => {
    const world = worldFor({ places: PLACES, routes: [] });
    const coords = name => { const place = PLACES.find(entry => entry.name === name); return { name, coords: { x: place.x, y: place.y } }; };
    for (const map of [{}, { kmPerUnit: 2, roadFactor: 1.5 }, { kmPerUnit: '0.5' }, { era: 'modern', kmPerUnit: 3 }]) {
        for (const mode of [null, 'ride', 'ship']) {
            const mine = travelTime(world, 'Shorn', 'Ninebarge Crossing', { map, mode });
            const v1 = estimateTrip(coords('Shorn'), coords('Ninebarge Crossing'), { map, mode: mode ?? (map.era === 'modern' ? 'car' : 'foot') });
            assert.equal(mine.days, v1.days, JSON.stringify({ map, mode }));
            assert.equal(mine.unit, v1.unit);
            assert.equal(mine.source, 'map');
            assert.equal(mine.text, `≈ ${durationText(v1.days, v1.unit)}`);
        }
    }
});

test('the story\'s route times; a pack\'s road of the same kind wins over them; unknown is null', () => {
    let { state } = lines(makeState(), [
        '+ route Shorn — Varnhold Watch | hours: 2 | kind: road',
        '+ route Varnhold Watch — Auvoth | days: 1 | kind: trail',
        '+ route Auvoth — Lonely Tor',
    ].join('\n'));
    const story = worldOf(state.domains.atlas);
    const short = travelTime(story, 'Shorn', 'Varnhold Watch');
    assert.deepEqual([short.days, short.unit, short.text], [tidy(2 / 24), 'hour', '2 h']);
    assert.equal(travelTime(story, 'Shorn', 'Auvoth').days, tidy(1 + 2 / 24));
    assert.equal(travelTime(story, 'Auvoth', 'Lonely Tor'), null);
    assert.equal(travelTime(story, 'Shorn', 'Nowhere'), null);
    assert.equal(travelTime(story, 'Shorn', 'shorn'), null);
    const withPack = worldOf(state.domains.atlas, packWorld(packQuery({ places: PLACES, routes: ROADS })));
    assert.equal(travelTime(withPack, 'Shorn', 'Varnhold Watch').days, planRoute(v1Pack(ROADS), 'Shorn', 'Varnhold Watch').days);
    // The atlas.travel query gives the same, through Story Block's tools.query.
    const pack = { places: PLACES, routes: ROADS };
    state = command(state, 'atlas.visit', { name: 'Shorn' }, { pack }).state;
    assert.deepEqual(query(state, 'atlas.travel', { from: 'Shorn', to: 'Varnhold Watch' }, { pack }), travelTime(withPack, 'Shorn', 'Varnhold Watch'));
    assert.equal(query(state, 'atlas.travel', { from: placeNamed(state, 'shorn').id, to: 'pack:auvoth' }, { pack }), null);
    const routes = query(state, 'atlas.routes', { place: 'Shorn' }, { pack });
    assert.deepEqual(routes.map(route => [route.otherName, route.kind, route.source, route.text]), [
        ['Varnhold Watch', 'road', 'pack', '7.5 days'], ['Auvoth', 'road', 'pack', '17 days'],
    ]);
});
