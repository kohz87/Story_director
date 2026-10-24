import test from 'node:test';
import assert from 'node:assert/strict';

import {
    FIT_PAD, KNOWN_LABEL_ZOOM, LONE_SPAN, MAX_ZOOM_SPAN, NEAR_PX, SLOTS, ZOOM_IN, ZOOM_OUT,
    between, boundsOf, centreOn, clampView, clipSegment, fitView, fold, labelSize, mapPoint, nearestGap,
    panBy, placeLabels, placeUnplaced, searchPlaces, shorten, toMap, toScreen, zoomAt, zoomLevel, zoomLimits,
} from '../../../src/v2/atlas/view.js';

const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-6, `${message ?? ''} ${actual} ≈ ${expected}`);

test('map space: north up puts a larger y higher (negated), north down and east left as the settings say', () => {
    assert.deepEqual(mapPoint({ x: 3, y: 4 }), { x: 3, y: -4 });
    assert.deepEqual(mapPoint({ x: 3, y: 4 }, { north: 'up', east: 'right' }), { x: 3, y: -4 });
    assert.deepEqual(mapPoint({ x: 3, y: 4 }, { north: 'down' }), { x: 3, y: 4 });
    assert.deepEqual(mapPoint({ x: 3, y: 4 }, { east: 'left' }), { x: -3, y: -4 });
    // No coordinates, or odd ones: no point.
    for (const odd of [{}, { x: 1 }, { x: null, y: null }, { x: NaN, y: 1 }, { x: '1', y: '2' }, { x: Infinity, y: 0 }, null]) assert.equal(mapPoint(odd), null);
});

test('bounds and fit: a lone place or none gets a span around it; fit keeps FIT_PAD free and centres', () => {
    assert.deepEqual(boundsOf([]), { minX: -LONE_SPAN / 2, minY: -LONE_SPAN / 2, maxX: LONE_SPAN / 2, maxY: LONE_SPAN / 2 });
    assert.deepEqual(boundsOf([null, { x: 5, y: 5 }]), { minX: 5 - LONE_SPAN / 2, minY: 5 - LONE_SPAN / 2, maxX: 5 + LONE_SPAN / 2, maxY: 5 + LONE_SPAN / 2 });
    const box = boundsOf([{ x: 0, y: 0 }, { x: 100, y: 50 }, { x: 40, y: -10 }]);
    assert.deepEqual(box, { minX: 0, minY: -10, maxX: 100, maxY: 50 });
    const view = fitView(box, 800, 600);
    assert.equal(view.cx, 50);
    assert.equal(view.cy, 20);
    close(view.k, 800 / (100 + 2 * 100 * FIT_PAD));
    // A tall box fits by its height.
    close(fitView({ minX: 0, minY: 0, maxX: 10, maxY: 100 }, 800, 600).k, 600 / (100 + 30));
    // Everything on screen at "fit".
    for (const point of [{ x: 0, y: 0 }, { x: 100, y: 50 }, { x: 40, y: -10 }]) {
        const at = toScreen(view, 800, 600, point);
        assert.ok(at.x >= 0 && at.x <= 800 && at.y >= 0 && at.y <= 600);
    }
});

test('zoom limits: ½× to 8× fit, deeper when places sit close (a village in a country), never past the cap', () => {
    assert.deepEqual(zoomLimits(2), { min: 2 * ZOOM_OUT, max: 2 * ZOOM_IN });
    assert.deepEqual(zoomLimits(2, 50), { min: 1, max: 16 });                 // far apart: 8× is enough
    assert.deepEqual(zoomLimits(2, 0.01), { min: 1, max: NEAR_PX / 0.01 });   // tight: the nearest two NEAR_PX apart
    assert.deepEqual(zoomLimits(2, 1e-9), { min: 1, max: 2 * MAX_ZOOM_SPAN }); // capped
    assert.equal(nearestGap([]), null);
    assert.equal(nearestGap([{ x: 1, y: 1 }]), null);
    assert.equal(nearestGap([{ x: 1, y: 1 }, { x: 1, y: 1 }]), null, 'two places on one spot have no gap');
    close(nearestGap([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 0, y: 0 }, null, { x: 10, y: 0 }]), 5);
});

test('view maths: zoom keeps the point under the pointer, pan follows the drag, both stay inside the world', () => {
    const box = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    const limits = { min: 1, max: 40 };
    const view = { cx: 50, cy: 50, k: 4 };
    // The map point under (600, 100) is still under it after zooming in or out.
    for (const factor of [1.5, 1 / 1.5, 3]) {
        const before = toMap(view, 800, 600, 600, 100);
        const after = zoomAt(view, factor, 600, 100, 800, 600, box, limits);
        const again = toMap(after, 800, 600, 600, 100);
        close(again.x, before.x, 'x');
        close(again.y, before.y, 'y');
    }
    // Clamped zoom.
    assert.equal(zoomAt(view, 1000, 400, 300, 800, 600, box, limits).k, 40);
    assert.equal(zoomAt(view, 0.0001, 400, 300, 800, 600, box, limits).k, 1);
    // A drag 40 px to the right shows what was 10 units to the left at 4 px a unit.
    assert.deepEqual(panBy(view, 40, 0, box, limits), { cx: 40, cy: 50, k: 4 });
    // Never off the world: the centre stays in the box.
    assert.deepEqual(panBy(view, 10000, -10000, box, limits), { cx: 0, cy: 100, k: 4 });
    assert.deepEqual(clampView({ cx: -5, cy: 500, k: 99 }, box, limits), { cx: 0, cy: 100, k: 40 });
    // Centre on a place: at least the asked zoom, never less than now.
    assert.deepEqual(centreOn(view, { x: 20, y: 30 }, box, limits, 10), { cx: 20, cy: 30, k: 10 });
    assert.deepEqual(centreOn({ ...view, k: 20 }, { x: 20, y: 30 }, box, limits, 10), { cx: 20, cy: 30, k: 20 });
    // toScreen and toMap are inverses.
    const p = toScreen(view, 800, 600, { x: 12, y: 34 });
    const back = toMap(view, 800, 600, p.x, p.y);
    close(back.x, 12);
    close(back.y, 34);
    assert.equal(zoomLevel({ k: 6 }, 2), 3);
    assert.equal(zoomLevel({ k: 6 }, 0), 1);
});

test('an eased move starts and ends exactly at its views, zooming evenly in log space', () => {
    const a = { cx: 0, cy: 0, k: 1 };
    const b = { cx: 10, cy: -10, k: 100 };
    assert.deepEqual(between(a, b, 0), a);
    const end = between(a, b, 1);
    close(end.cx, 10);
    close(end.cy, -10);
    close(end.k, 100);
    const mid = between(a, b, 0.5);
    assert.ok(mid.k > 1 && mid.k < 100);
});

test('routes are cut to the stage: inside, crossing, outside, along an edge, a point', () => {
    const rect = { x: 0, y: 0, w: 100, h: 100 };
    assert.deepEqual(clipSegment({ x: 10, y: 10 }, { x: 90, y: 90 }, rect), { a: { x: 10, y: 10 }, b: { x: 90, y: 90 } });
    assert.deepEqual(clipSegment({ x: -100, y: 50 }, { x: 200, y: 50 }, rect), { a: { x: 0, y: 50 }, b: { x: 100, y: 50 } });
    assert.equal(clipSegment({ x: -10, y: -10 }, { x: -5, y: 200 }, rect), null);
    assert.equal(clipSegment({ x: 200, y: 0 }, { x: 300, y: 100 }, rect), null);
    assert.deepEqual(clipSegment({ x: 0, y: -50 }, { x: 0, y: 150 }, rect), { a: { x: 0, y: 0 }, b: { x: 0, y: 100 } });
    assert.deepEqual(clipSegment({ x: 5, y: 5 }, { x: 5, y: 5 }, rect), { a: { x: 5, y: 5 }, b: { x: 5, y: 5 } });
    // A street seen at a country's zoom: a million pixels long, cut to the screen.
    const cut = clipSegment({ x: -1e6, y: -1e6 }, { x: 1e6, y: 1e6 }, rect);
    assert.deepEqual(cut, { a: { x: 0, y: 0 }, b: { x: 100, y: 100 } });
});

test('places without coordinates are laid out beside a joined place, else in a row, the same every time', () => {
    const places = [
        { id: 'a', point: { x: 0, y: 0 } }, { id: 'b', point: { x: 100, y: 0 } },
        { id: 'c', point: null }, { id: 'd', point: null }, { id: 'e', point: null }, { id: 'f', point: null },
    ];
    const links = [['a', 'c'], ['c', 'd'], ['a', 'e']];
    const at = placeUnplaced(places, links);
    assert.deepEqual([...at.keys()].sort(), ['a', 'b', 'c', 'd', 'e', 'f']);
    assert.deepEqual(at.get('a'), { x: 0, y: 0 });
    const near = (id, other) => Math.hypot(at.get(id).x - at.get(other).x, at.get(id).y - at.get(other).y);
    assert.ok(near('c', 'a') < 20, 'c sits by a');
    assert.ok(near('d', 'c') < 20, 'd sits by c (a chain)');
    assert.notDeepEqual(at.get('c'), at.get('e'), 'two newcomers by one place never stack');
    assert.ok(at.get('f').y > 0, 'f, joined to nothing, goes in the row under the rest');
    assert.deepEqual(placeUnplaced(places, links), at, 'deterministic');
    // Nothing placed at all: still points for everyone, none on the same spot.
    const none = placeUnplaced([{ id: 'x', point: null }, { id: 'y', point: null }], []);
    assert.notDeepEqual(none.get('x'), none.get('y'));
});

// Boxes of placed labels and markers never overlap; every label stays on the stage.
function assertClean(placed, markers, width, height) {
    const boxes = placed.map(label => ({ id: label.id, x: label.x, y: label.y, w: label.w, h: label.h }));
    const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (const [i, a] of boxes.entries()) {
        assert.ok(a.x >= 0 && a.y >= 0 && a.x + a.w <= width && a.y + a.h <= height, `${a.id} on the stage`);
        for (const b of boxes.slice(i + 1)) assert.ok(!overlap(a, b), `${a.id} and ${b.id} overlap`);
        for (const marker of markers) {
            if (marker.id === a.id) continue;
            assert.ok(!overlap(a, { x: marker.x - marker.r, y: marker.y - marker.r, w: marker.r * 2, h: marker.r * 2 }), `${a.id} covers ${marker.id}`);
        }
    }
}

test('labels: the first that fits of eight places, never over another label or marker; lower priority shortened or left out', () => {
    // The screenshot's knot: three places a few pixels apart.
    const markers = [
        { id: 'quay', x: 300, y: 200, r: 12 }, { id: 'granary', x: 340, y: 200, r: 12 }, { id: 'village', x: 318, y: 228, r: 12 },
    ];
    const items = [
        { ...markers[2], text: 'Bluewatch Village' }, { ...markers[0], text: 'Inspection Quay' }, { ...markers[1], text: 'Watch Granary' },
    ];
    const placed = placeLabels(items, markers, 800, 600);
    assertClean(placed, markers, 800, 600);
    assert.equal(placed[0].id, 'village', 'the first in priority is placed first');
    assert.equal(placed[0].slot, 'e');
    assert.ok(placed.length >= 2);
    assert.deepEqual(placeLabels(items, markers, 800, 600), placed, 'deterministic');
    assert.deepEqual(SLOTS, ['e', 'w', 'ne', 'se', 'nw', 'sw', 'n', 's']);
    // Room only to one side: it takes the west.
    const edge = placeLabels([{ id: 'p', x: 790, y: 300, r: 10, text: 'Edge Town' }], [{ id: 'p', x: 790, y: 300, r: 10 }], 800, 600);
    assert.equal(edge[0].slot, 'w');
    // No room for the full name: the short one; no room at all: left out.
    const tight = [{ id: 'a', x: 20, y: 10, r: 8 }, { id: 'b', x: 130, y: 10, r: 8 }];
    const short = placeLabels([{ ...tight[0], text: 'Stormwatch Harbour' }], tight, 150, 20);
    assert.equal(short.length, 1);
    assert.equal(short[0].text, 'Stormwatch…');
    assert.deepEqual(placeLabels([{ ...tight[0], text: 'Stormwatch Harbour' }], tight, 30, 20), []);
    assert.deepEqual(placeLabels([], [], 100, 100), []);
});

test('labels for a dense cluster and a big world: none overlap, high priority always placed', () => {
    // 400 places on a 20×20 grid 18 px apart: far too tight for every name.
    const markers = [];
    for (let i = 0; i < 400; i += 1) markers.push({ id: `p${i}`, x: 20 + (i % 20) * 18, y: 20 + Math.floor(i / 20) * 18, r: 4 });
    // First in priority: where you are, below the crowd with room for its name.
    markers.unshift({ id: 'here', x: 200, y: 420, r: 12 });
    const items = markers.map((marker, i) => ({ ...marker, text: i ? `Place number ${i}` : 'You Are Here' }));
    const started = process.hrtime.bigint();
    const placed = placeLabels(items, markers, 400, 440);
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    assertClean(placed, markers, 400, 440);
    assert.ok(placed.length > 1 && placed.length < 400);
    assert.equal(placed[0].id, 'here');
    assert.ok(ms < 2000, `placing 400 labels took ${ms} ms`);
});

test('shorten and label sizes', () => {
    assert.equal(shorten('Inspection Quay'), 'Inspection…');
    assert.equal(shorten('Ox'), 'Ox');
    assert.equal(shorten('Rimeglassdelvehold'), 'Rimeglassd…');
    assert.equal(shorten('Ox Ford Crossing'), 'Ox Ford Cr…');
    assert.ok(labelSize('Bluewatch Village').w > labelSize('Ox').w);
    assert.deepEqual(labelSize('abc'), labelSize('xyz'), 'same length, same box');
    assert.ok(KNOWN_LABEL_ZOOM > 1);
});

const PLACES = [
    { id: '1', name: 'Bluewatch Village', aliases: [], region: 'River Confederacy: core cities', visited: true },
    { id: '2', name: 'Watch Granary', aliases: ['the granary', 'storehouses'], region: 'Bluewatch Village', visited: true },
    { id: '3', name: 'Watchhouse', aliases: ['signal tower', 'the Watch'], region: 'Bluewatch Village', visited: false },
    { id: '4', name: 'Varnhold Watch', aliases: [], region: 'Shornmarch', visited: false },
    { id: '5', name: 'Ærøskøbing Quay', aliases: ['Ærø'], region: 'Nordmark', visited: false },
    { id: '6', name: "Hollin's Reach", aliases: [], region: 'Shornmarch', visited: false },
    { id: '7', name: 'Gate Forge', aliases: ['the forge', 'smithy'], region: 'Bluewatch Village', visited: false },
];
const found = (text, options) => searchPlaces(PLACES, text, options).map(hit => PLACES.find(place => place.id === hit.id).name);

test('search: name first (exact, start, word start, inside), then aliases, then regions; visited win ties', () => {
    assert.deepEqual(found('watch granary'), ['Watch Granary']);
    assert.deepEqual(found('watch').slice(0, 3), ['Watch Granary', 'Watchhouse', 'Varnhold Watch']);
    // "watch" is inside "Bluewatch", so Bluewatch Village matches by name; the region "Bluewatch
    // Village" does not pull in every place there (a region counts from a word's start).
    assert.ok(found('watch').includes('Bluewatch Village'));
    assert.ok(!found('watch').includes('Gate Forge'));
    // By region, the visited place first, then by name.
    assert.deepEqual(found('bluewatch village'), ['Bluewatch Village', 'Watch Granary', 'Gate Forge', 'Watchhouse']);
    assert.deepEqual(found('smithy'), ['Gate Forge']);
    assert.deepEqual(searchPlaces(PLACES, 'smithy'), [{ id: '7', score: 90, by: 'alias' }]);
    assert.deepEqual(found('signal'), ['Watchhouse']);
    assert.deepEqual(found('shorn'), ['Hollin\'s Reach', 'Varnhold Watch']);
});

test('search is case-, accent- and apostrophe-blind and forgives one wrong letter in a longer word', () => {
    assert.deepEqual(found('AEROSKOBING'), []);   // Æ is its own letter, not "AE"
    assert.deepEqual(found('ærøskøbing'), ['Ærøskøbing Quay']);
    assert.deepEqual(found('ÆRØ'), ['Ærøskøbing Quay']);
    assert.deepEqual(found('hollins'), ['Hollin\'s Reach']);
    assert.deepEqual(found('Hollin’s'), ['Hollin\'s Reach']);
    assert.deepEqual(found('granery'), ['Watch Granary']);      // one letter wrong
    assert.deepEqual(found('gate forg'), ['Gate Forge']);
    assert.deepEqual(found('qq'), []);
    assert.deepEqual(fold('  Café  du   Pont-Neuf '), 'cafe du pont neuf');
});

test('search: empty or odd input gives nothing; odd places are skipped safely; the limit holds', () => {
    for (const text of ['', '   ', '!!!', null, undefined, 42]) assert.ok(Array.isArray(searchPlaces(PLACES, text)));
    assert.deepEqual(searchPlaces(PLACES, ''), []);
    assert.deepEqual(searchPlaces(PLACES, '!!!'), []);
    assert.deepEqual(searchPlaces([{ id: 'x', name: 'X' }, { id: 'y', name: '', aliases: null, region: undefined }], 'x').map(hit => hit.id), ['x']);
    const many = Array.from({ length: 3000 }, (_, i) => ({ id: `p${i}`, name: `Stone ${i}`, aliases: [], region: 'Moor', visited: i % 2 === 0 }));
    const started = process.hrtime.bigint();
    const hits = searchPlaces(many, 'stone', { limit: 5 });
    assert.ok(Number(process.hrtime.bigint() - started) / 1e6 < 2000);
    assert.equal(hits.length, 5);
    assert.ok(hits.every(hit => Number(hit.id.slice(1)) % 2 === 0), 'visited first');
});
