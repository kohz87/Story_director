import test from 'node:test';
import assert from 'node:assert/strict';

import { part } from '../../../src/v2/atlas/index.js';
import { atlasView, mapProps, viewLayerOf } from '../../../src/v2/atlas/map.js';
import { packWorld, worldOf } from '../../../src/v2/atlas/world.js';
import { at, command, lines, makeState, placeNamed, query, queryFor } from './helpers/fake-ctx.js';

// The Ersveil shape in small: a village whose streets are pack places of their own region, inside
// a wider area the scene names ("River Confederacy"), plus a hidden cellar and a secret shrine.
const PACK = {
    places: [
        { name: 'Bluewatch Village', region: 'River Confederacy: core cities', kind: 'settlement', x: 64, y: 110 },
        { name: 'Inspection Quay', region: 'Bluewatch Village', kind: 'quay', x: 64.0, y: 109.99, aliases: ['river-gate', 'the quay'] },
        { name: 'Watch Granary', region: 'Bluewatch Village', kind: 'storehouse', x: 64.02, y: 109.99, aliases: ['the granary'] },
        { name: 'Reedmere', region: 'River Confederacy: locks/connectors', kind: 'town', x: 50, y: 90 },
        { name: 'Smugglers\' Cellar', region: 'Bluewatch Village', kind: 'cellar', x: 64.01, y: 110.01, hidden: true },
        { name: 'Drowned Shrine', region: 'Mirelands', kind: 'shrine', x: 30, y: 30, secret: true },
        { name: 'Deep Vault', region: 'Bluewatch Village', layer: 'underground', kind: 'vault', x: 64, y: 110 },
    ],
    routes: [
        { from: 'Bluewatch Village', to: 'Inspection Quay', kind: 'street', km: 0.2, hours: 0.1 },
        { from: 'Bluewatch Village', to: 'Reedmere', kind: 'river', km: 90 },
        { from: 'Bluewatch Village', to: 'Smugglers\' Cellar', kind: 'stair', km: 0.1 },
        { from: 'Reedmere', to: 'Drowned Shrine', kind: 'trail', km: 40 },
    ],
};
const SCENE = { kind: 'settlement', region: 'River Confederacy' };

function arrive(state, name, { kind = '', region = SCENE.region } = {}) {
    const moved = at(state, name, { kind, region });
    const out = part.hooks.beforeGenerate({ state: moved, query: (q, args) => queryFor(PACK)(moved, q, args) });
    let next = moved;
    for (const step of out?.commands ?? []) next = command(next, step.type, step.payload, { pack: PACK }).state;
    return next;
}

function story() {
    let state = makeState({ place: 'Bluewatch Village', ...SCENE });
    state = arrive(state, 'Bluewatch Village', { kind: 'settlement' });
    state = arrive(state, 'Inspection Quay');
    state = arrive(state, 'Bluewatch Village', { kind: 'settlement' });
    return state;
}

test('packWorld reads aliases as written and the hidden or secret mark; worldOf keeps them on each place', () => {
    const pack = packWorld((name, { kind }) => structuredClone(PACK[kind]));
    const quay = pack.places.find(place => place.name === 'Inspection Quay');
    assert.deepEqual(quay.aliasNames, ['river-gate', 'the quay']);
    assert.deepEqual(quay.aliases, ['river-gate', 'the quay']);
    assert.equal(quay.hidden, false);
    assert.equal(pack.places.find(place => place.name === 'Smugglers\' Cellar').hidden, true);
    assert.equal(pack.places.find(place => place.name === 'Drowned Shrine').hidden, true);
    // Odd records: no name, a duplicate, aliases not a list, a non-boolean mark.
    const odd = packWorld((name, { kind }) => (kind === 'places' ? [null, { name: '' }, { name: 'A', aliases: 'nope', hidden: 'yes' }, { name: 'a' }] : 'nope'));
    assert.deepEqual(odd.places.map(place => [place.name, place.aliases, place.hidden]), [['A', [], false]]);
    assert.deepEqual(odd.routes, []);
    const world = worldOf(story().domains.atlas, pack);
    const quayHere = world.find('the quay');
    assert.equal(quayHere.source, 'atlas');
    assert.deepEqual(quayHere.aliases, ['river-gate', 'the quay']);
    assert.equal(world.find('Smugglers\' Cellar').hidden, true);
});

test('item 4: a visited pack place takes the pack\'s region, not the scene\'s wider one', () => {
    const state = story();
    assert.equal(placeNamed(state, 'bluewatch village').region, 'River Confederacy: core cities');
    assert.equal(placeNamed(state, 'inspection quay').region, 'Bluewatch Village');
    // A place no pack knows takes the scene's region.
    const wild = arrive(state, 'Lonely Hut');
    assert.equal(placeNamed(wild, 'lonely hut').region, 'River Confederacy');
    // A place saved before this rule (the scene's region stored) is mended on the next visit.
    const old = command(story(), 'atlas.edit', { place: 'Inspection Quay', region: 'River Confederacy' }, { pack: PACK }).state;
    assert.equal(placeNamed(old, 'inspection quay').region, 'River Confederacy');
    assert.equal(placeNamed(arrive(old, 'Inspection Quay'), 'inspection quay').region, 'Bluewatch Village');
    // A reader's own region (not the scene's word) stays.
    const mine = command(story(), 'atlas.edit', { place: 'Inspection Quay', region: 'Docks' }, { pack: PACK }).state;
    assert.equal(placeNamed(arrive(mine, 'Inspection Quay'), 'inspection quay').region, 'Docks');
    // A landmark line that names a region on purpose wins over the pack.
    const said = lines(story(), '~ landmark Watch Granary | region: Old Town', { pack: PACK }).state;
    assert.equal(placeNamed(said, 'watch granary').region, 'Old Town');
});

test('item 5: a label left out keeps the kind (scene moves, landmark lines); only an explicit empty one clears it', () => {
    let state = story();
    // The scene moves to the quay with no kind (Story Block's scene clears its own kind on a move):
    // the atlas keeps the pack's kind, and coming back without a kind keeps the village's.
    state = arrive(state, 'Inspection Quay', { kind: '' });
    assert.equal(placeNamed(state, 'inspection quay').kind, 'quay');
    state = arrive(state, 'Bluewatch Village', { kind: '' });
    assert.equal(placeNamed(state, 'bluewatch village').kind, 'settlement');
    // A landmark line without kind: kept; with `kind:` empty: cleared; region and plane the same.
    state = lines(state, '~ landmark Bluewatch Village | region: Lakeshore', { pack: PACK }).state;
    assert.equal(placeNamed(state, 'bluewatch village').kind, 'settlement');
    state = lines(state, '~ landmark Bluewatch Village | plane: Sky', { pack: PACK }).state;
    assert.deepEqual([placeNamed(state, 'bluewatch village').kind, placeNamed(state, 'bluewatch village').region, placeNamed(state, 'bluewatch village').layer], ['settlement', 'Lakeshore', 'Sky']);
    state = lines(state, '~ landmark Bluewatch Village | kind: | plane:', { pack: PACK }).state;
    assert.deepEqual([placeNamed(state, 'bluewatch village').kind, placeNamed(state, 'bluewatch village').region, placeNamed(state, 'bluewatch village').layer], ['', 'Lakeshore', '']);
    // A new landmark the packs don't know is a "landmark" unless told; a pack place keeps the pack's kind.
    state = lines(state, '+ landmark Old Mill\n+ landmark Reedmere', { pack: PACK }).state;
    assert.equal(placeNamed(state, 'old mill').kind, 'landmark');
    assert.equal(placeNamed(state, 'reedmere').kind, 'town');
    // atlas.here: the scene's place with the atlas's kind and the pack's region when the scene has none.
    const moved = at(story(), 'Inspection Quay', { kind: '', region: 'River Confederacy' });
    assert.deepEqual(query(moved, 'atlas.here', {}, { pack: PACK }), { id: placeNamed(moved, 'inspection quay').id, name: 'Inspection Quay', kind: 'quay', placeKind: 'quay', region: 'Bluewatch Village' });
    assert.equal(query(at(story(), 'Nowhere Known'), 'atlas.here', {}, { pack: PACK }), null);
    assert.equal(query(at(story(), ''), 'atlas.here', {}, { pack: PACK }), null);
});

test('item 1 and 2: atlas.view draws every known place (visited or not), regions only with places, hidden ones kept off', () => {
    const state = story();
    const view = query(state, 'atlas.view', {}, { pack: PACK });
    const names = view.places.map(place => place.name);
    // The atlas's places by name, then the packs' it has not got, in pack order.
    assert.deepEqual(names, ['Bluewatch Village', 'Inspection Quay', 'Watch Granary', 'Reedmere', 'Deep Vault']);
    assert.deepEqual(view.places.filter(place => place.visited).map(place => place.name), ['Bluewatch Village', 'Inspection Quay']);
    assert.equal(view.places.find(place => place.here).name, 'Bluewatch Village');
    assert.equal(view.current, placeNamed(state, 'bluewatch village').id);
    // Regions with at least one drawable place, then planes; the hidden cellar's and the secret
    // shrine's ("Mirelands") are not offered.
    assert.deepEqual(view.layers.map(layer => [layer.name, layer.type]), [
        ['Bluewatch Village', 'region'], ['River Confederacy: core cities', 'region'], ['River Confederacy: locks/connectors', 'region'], ['underground', 'plane'],
    ]);
    assert.equal(view.layer, 'region:river confederacy: core cities');
    for (const layer of view.layers) assert.ok(view.places.some(place => place.layer === layer.id), `${layer.name} has a place`);
    // Routes between drawn places only; known when both ends were visited.
    assert.deepEqual(view.routes.map(route => [route.kind, route.known]), [['street', true], ['river', false]]);
    assert.deepEqual(view.orient, { north: 'up', east: 'right' });
    assert.deepEqual(view.kinds.street, { label: 'Street' });
    assert.equal(view.kinds.quay.icon, 'fa-anchor');
    assert.deepEqual(view.places.find(place => place.name === 'Inspection Quay').aliases, ['river-gate', 'the quay']);
    // ss.map's props leave the hidden ones out too.
    const ss = query(state, 'atlas.map', {}, { pack: PACK });
    assert.ok(!ss.nodes.some(node => /Cellar|Shrine/.test(node.name)));
    assert.ok(!query(state, 'atlas.places', {}, { pack: PACK }).some(place => /Cellar|Shrine/.test(place.name)));
});

test('a hidden place shows once the story has been there, or while the scene is there', () => {
    let state = story();
    const there = at(state, 'Smugglers\' Cellar', { kind: 'cellar' });
    assert.ok(query(there, 'atlas.view', {}, { pack: PACK }).places.some(place => place.name === 'Smugglers\' Cellar' && place.here));
    state = arrive(state, 'Smugglers\' Cellar');
    state = arrive(state, 'Bluewatch Village', { kind: 'settlement' });
    const view = query(state, 'atlas.view', {}, { pack: PACK });
    assert.ok(view.places.some(place => place.name === 'Smugglers\' Cellar' && place.visited));
    assert.ok(view.routes.some(route => route.kind === 'stair'));
    // A route line naming the shrine (heard of, not been) keeps it off the map.
    state = lines(state, '+ route Reedmere — Drowned Shrine | days: 2', { pack: PACK }).state;
    assert.ok(!query(state, 'atlas.view', {}, { pack: PACK }).places.some(place => place.name === 'Drowned Shrine'));
});

test('atlas.view: map settings turn the map; odd and empty worlds give empty, valid data', () => {
    const state = story();
    const tools = { query: (name, args) => queryFor(PACK)(state, name, args), settings: () => ({ map: { north: 'down', east: 'left' } }) };
    assert.deepEqual(part.queries['atlas.view'](state, {}, tools).orient, { north: 'down', east: 'left' });
    const broken = { query: tools.query, settings: () => { throw new Error('no settings'); } };
    assert.deepEqual(part.queries['atlas.view'](state, {}, broken).orient, { north: 'up', east: 'right' });
    // Nothing known, no packs.
    assert.deepEqual(query(makeState(), 'atlas.view'), { places: [], routes: [], layers: [], layer: '', current: '', kinds: {}, orient: { north: 'up', east: 'right' } });
    // An empty pack, a pack of junk.
    assert.deepEqual(query(makeState(), 'atlas.view', {}, { pack: { places: [], routes: [] } }).places, []);
    assert.deepEqual(query(makeState(), 'atlas.view', {}, { pack: { places: [1, 'x', null, { name: 7 }], routes: [{}] } }).places, []);
    // Places without coordinates or region: on no layer, x/y null.
    const bare = lines(makeState(), '+ landmark Lone Stone');
    const lone = query(bare.state, 'atlas.view').places[0];
    assert.deepEqual([lone.x, lone.y, lone.layer, lone.region], [null, null, '', '']);
    assert.equal(viewLayerOf({ layer: 'Sky', region: 'X' }), 'plane:sky');
    assert.equal(viewLayerOf({ layer: '', region: 'X' }), 'region:x');
    assert.equal(viewLayerOf({ layer: '', region: '' }), '');
});

test('a huge pack: 2000 places and 4000 routes join and give atlas.view in reasonable time', () => {
    const places = Array.from({ length: 2000 }, (_, i) => ({ name: `Place ${i}`, region: `Region ${i % 40}`, kind: i % 3 ? 'village' : 'town', x: (i % 50) * 3, y: Math.floor(i / 50) * 3 }));
    const routes = Array.from({ length: 4000 }, (_, i) => ({ from: `Place ${i % 2000}`, to: `Place ${(i * 7 + 1) % 2000}`, kind: 'road', km: 5 }));
    const big = { places, routes };
    const state = makeState({ place: 'Place 0' });
    const started = process.hrtime.bigint();
    const view = query(state, 'atlas.view', {}, { pack: big });
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    assert.equal(view.places.length, 2000);
    assert.equal(view.layers.length, 40);
    assert.ok(view.routes.length > 1900);
    assert.equal(view.places.find(place => place.here).name, 'Place 0');
    assert.ok(ms < 5000, `atlas.view of a huge pack took ${ms} ms`);
    // The map props for ss.map stay within its limits (2000 nodes).
    assert.equal(mapProps(worldOf(state.domains.atlas, packWorld((name, { kind }) => big[kind])), 'Place 0').nodes.length, 2000);
});

test('atlas.place: the trip from the current place by known routes (travel.js), or none', () => {
    const state = story();
    const reed = query(state, 'atlas.place', { name: 'Reedmere' }, { pack: PACK });
    assert.equal(reed.here, false);
    assert.deepEqual(reed.trip && { from: reed.trip.fromName, km: reed.trip.km, by: reed.trip.by, hops: reed.trip.hops }, { from: 'Bluewatch Village', km: 90, by: ['river'], hops: 1 });
    assert.equal(typeof reed.trip.text, 'string');
    assert.ok(reed.trip.text.length > 0);
    // Where you are: no trip. No route: no trip (no straight-line guess here).
    assert.equal(query(state, 'atlas.place', { name: 'Bluewatch Village' }, { pack: PACK }).here, true);
    assert.equal(query(state, 'atlas.place', { name: 'Bluewatch Village' }, { pack: PACK }).trip, null);
    assert.equal(query(state, 'atlas.place', { name: 'Watch Granary' }, { pack: PACK }).trip, null);
    assert.equal(query(state, 'atlas.place', { name: 'Nowhere' }, { pack: PACK }), null);
    // Two hops by known routes.
    const two = query(at(state, 'Inspection Quay'), 'atlas.place', { name: 'Reedmere' }, { pack: PACK });
    assert.deepEqual([two.trip.hops, two.trip.by, two.trip.km], [2, ['street', 'river'], 90.2]);
});

test('the shapes the chronicle part reads stay: atlas.place { region } by name, atlas.routes { otherName } by place', () => {
    const state = story();
    const place = query(state, 'atlas.place', { name: 'Inspection Quay' }, { pack: PACK });
    for (const key of ['id', 'name', 'region', 'kind', 'layer', 'x', 'y', 'discovered', 'source', 'routes']) assert.ok(Object.hasOwn(place, key), key);
    assert.equal(place.region, 'Bluewatch Village');
    const routes = query(state, 'atlas.routes', { place: 'Bluewatch Village' }, { pack: PACK });
    assert.deepEqual(routes.map(route => route.otherName).sort(), ['Inspection Quay', 'Reedmere', 'Smugglers\' Cellar']);
    assert.ok(routes.every(route => ['id', 'from', 'to', 'kind', 'other', 'otherName', 'days', 'text'].every(key => Object.hasOwn(route, key))));
});

test('atlasView is pure and the same for the same world', () => {
    const state = story();
    const world = worldOf(state.domains.atlas, packWorld((name, { kind }) => structuredClone(PACK[kind])));
    assert.deepEqual(atlasView(world, 'Bluewatch Village'), atlasView(world, 'Bluewatch Village'));
    assert.equal(atlasView(world, '').current, '');
    assert.equal(atlasView(world, 'Nowhere').layer, '');
});
