// The place book from scene locations, and what coordinates say about distance and direction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadWorldPack } from '../src/routes.js';
import { bearing, buildPlaceBook, distanceKm, estimateTrip, findBookPlace, formatTrip, mapSettings, nearbyByCoords, parseLocation } from '../src/places.js';

const pack = loadWorldPack(JSON.parse(readFileSync(new URL('./fixtures/world-pack.json', import.meta.url), 'utf8'))).pack;

test('parseLocation: place, spot and coordinates', () => {
    assert.deepEqual(parseLocation('Auvoth | Seventh Seal Terrace | [59.0, 110.0]'), {
        name: 'Auvoth', spot: 'Seventh Seal Terrace', parts: ['Auvoth', 'Seventh Seal Terrace'], coords: { x: 59, y: 110 },
    });
    assert.deepEqual(parseLocation('Heron Ford | Willow camp').coords, null);
    assert.equal(parseLocation('Heron Ford · Willow camp (12.5, -3)').coords.y, -3);
    assert.equal(parseLocation('**Bluewatch Village**').name, 'Bluewatch Village');
    assert.equal(parseLocation('').name, '');
});

test('the book: visits counted per stay, latest coordinates and spots, most recent first', () => {
    const book = buildPlaceBook([
        { message: 1, time: 100, text: 'Shorn | Gate | [50, 95]' },
        { message: 3, time: 200, text: 'Shorn | Market | [50, 95]' },
        { message: 5, time: 900, text: 'Auvoth | Seventh Seal Terrace | [59.0, 110.0]' },
        { message: 7, time: 1000, text: 'Auvoth | Leased Mansion Courtyard' },
        { message: 9, time: 2000, text: 'Shorn | Gate' },
    ]);
    assert.deepEqual(book.places.map(place => place.name), ['Shorn', 'Auvoth']);
    const [shorn, auvoth] = book.places;
    assert.equal(shorn.visits, 2, 'two stays, not three replies');
    assert.deepEqual(shorn.spots, ['Gate', 'Market']);
    assert.equal(shorn.firstTime, 100);
    assert.equal(shorn.lastTime, 2000);
    assert.deepEqual(auvoth.coords, { x: 59, y: 110 });
    assert.equal(auvoth.coordsFrom, 'story');
    assert.equal(book.current, 'shorn');
});

test('a world pack fills in coordinates and adds unvisited places last', () => {
    const book = buildPlaceBook([{ message: 1, time: 0, text: 'Auvoth | Terrace' }], { pack });
    assert.equal(book.places[0].name, 'Auvoth');
    assert.equal(book.places[0].coordsFrom, 'pack');
    assert.ok(book.places.slice(1).every(place => place.visits === 0));
    assert.ok(book.places.some(place => place.name === 'Shorn'));
});

test('the world pack\'s coordinates win over the story\'s, and a disagreement is kept', () => {
    // The pack: Auvoth [59, 110], Hollin's Reach [58, 104], Bluewatch Village [64, 110].
    const book = buildPlaceBook([
        { message: 1, text: 'Bluewatch Village | Square | [64.4, 110]' },
        { message: 2, text: 'Hollins Reach | Branch office | [70, 104]' },
    ], { pack });
    const hollin = findBookPlace(book, "Hollin's Reach");
    assert.equal(hollin.visits, 1, 'no apostrophe is still the same place');
    assert.equal(hollin.name, "Hollin's Reach", 'spelled as the pack spells it');
    assert.deepEqual(hollin.coords, { x: 58, y: 104 });
    assert.equal(hollin.coordsFrom, 'pack');
    assert.deepEqual(hollin.storyCoords, { x: 70, y: 104 });
    const bluewatch = findBookPlace(book, 'Bluewatch Village');
    assert.equal(bluewatch.storyCoords, null, 'within a map unit is agreement');
    assert.equal(bearing(bluewatch, hollin), 'SW');
    assert.equal(bearing(findBookPlace(book, 'Auvoth'), hollin), 'S');
});

test('distance and direction follow the map settings', () => {
    const a = { coords: { x: 0, y: 0 } };
    const b = { coords: { x: 3, y: 4 } };
    assert.equal(distanceKm(a, b, { kmPerUnit: 10 }), 50);
    assert.equal(bearing(a, b, { north: 'up' }), 'NE');
    assert.equal(bearing(a, b, { north: 'down' }), 'SE', 'an image: y grows southwards');
    assert.equal(bearing(a, b, { north: 'up', east: 'left' }), 'NW');
    assert.equal(bearing(a, { coords: { x: 0, y: -2 } }, {}), 'S');
    assert.equal(bearing(a, a, {}), '');
    assert.equal(distanceKm(a, { coords: null }), null);
    assert.deepEqual(mapSettings({ kmPerUnit: -1, roadFactor: 0.5, north: 'x' }), { north: 'up', east: 'right', kmPerUnit: 1, roadFactor: 1.25, era: 'pre-modern' });
});

test('nearby by coordinates, and finding a place by a longer location', () => {
    const book = buildPlaceBook([
        { message: 1, text: 'Shorn [0, 0]' },
        { message: 2, text: 'Mill [3, 4]' },
        { message: 3, text: 'Far Keep [30, 40]' },
        { message: 4, text: 'Nowhere' },
    ]);
    assert.deepEqual(nearbyByCoords(book, 'Shorn', { map: { kmPerUnit: 10 }, maxKm: 100 }).map(place => place.name), ['Mill']);
    assert.equal(findBookPlace(book, 'Mill | Wheelhouse').name, 'Mill');
    assert.equal(findBookPlace(book, 'Atlantis'), null);
    assert.deepEqual(nearbyByCoords(book, 'Nowhere'), []);
});

test('a trip estimate: road factor, half-day round-up, rest days, couriers and boats', () => {
    const shorn = { name: 'Shorn', coords: { x: 0, y: 0 } };
    const keep = { name: 'Far Keep', coords: { x: 0, y: 14 } };
    const map = { kmPerUnit: 10, roadFactor: 1.25 };
    const foot = estimateTrip(shorn, keep, { map });
    assert.equal(foot.straightKm, 140);
    assert.equal(foot.roadKm, 175);
    assert.equal(foot.rate, 20);
    assert.equal(foot.days, 9 + 1, '175/20 = 8.75 → 9 days, plus a rest day');
    assert.equal(foot.direction, 'N');
    assert.equal(formatTrip(foot, { map }), 'Shorn → Far Keep ≈ 175 km N (≈ 140 km straight × 1.25) · foot 20/day · 10 days (1 rest)');

    const courier = estimateTrip(shorn, keep, { map, mode: 'courier' });
    assert.equal(courier.restDays, 0);
    assert.equal(courier.days, 2.5);
    const boat = estimateTrip(shorn, keep, { map, mode: 'boat' });
    assert.equal(boat.roadKm, 140, 'water goes straight');
    assert.equal(estimateTrip(shorn, { name: 'x', coords: null }, { map }), null);
    assert.equal(estimateTrip(shorn, keep, { map, rate: 35 }).rate, 35);
});
