import test from 'node:test';
import assert from 'node:assert/strict';

import { part } from '../../../src/v2/atlas/index.js';
import { at, command, lines, makeState, placeNamed, query, replay } from './helpers/fake-ctx.js';

const PACK = {
    places: [
        { name: 'Bluewatch Village', region: 'Lakeshore', kind: 'village', x: 10.5, y: 20, aliases: ['Bluewatch'] },
        { name: 'Old Weir', region: 'Lakeshore', kind: 'weir', x: 14, y: 26 },
        { name: 'Hollin’s Reach', region: 'Fenmarch', kind: 'town', x: 40, y: 22 },
    ],
    routes: [{ from: 'Bluewatch Village', to: 'Old Weir', km: 12, kind: 'road' }],
};
const placeCount = state => Object.keys(state.domains.atlas.places).length;

test('atlas.visit puts the place on the map once: by name key, alias, case, spaces and apostrophes', () => {
    let state = makeState();
    const first = command(state, 'atlas.visit', { name: 'Bluewatch Village', kind: 'settlement', region: 'Lakeshore' });
    assert.ok(first.ok, first.message);
    assert.equal(first.result.summary, 'Bluewatch Village is on the map.');
    assert.equal(first.result.narrate, false);
    state = first.state;
    const place = placeNamed(state, 'bluewatch village');
    assert.deepEqual({ ...place, id: undefined }, { id: undefined, name: 'Bluewatch Village', region: 'Lakeshore', kind: 'settlement', layer: '', discovered: true, rev: 1 });
    for (const name of ['bluewatch  village', 'BLUEWATCH VILLAGE', '**Bluewatch Village**']) {
        const again = command(state, 'atlas.visit', { name });
        assert.ok(again.ok);
        assert.equal(again.result.summary, '', name);
        assert.equal(placeCount(again.state), 1, name);
        assert.deepEqual(again.ops.filter(op => op.path.startsWith('/domains')), [], name);
    }
    // A renamed place is still found by its old name (an alias).
    state = command(state, 'atlas.edit', { place: place.id, name: 'Bluewatch' }).state;
    assert.equal(placeCount(command(state, 'atlas.visit', { name: 'Bluewatch Village' }).state), 1);
    // v1's key: apostrophes dropped.
    state = command(state, 'atlas.visit', { name: "Hollin's Reach" }).state;
    assert.equal(placeCount(command(state, 'atlas.visit', { name: 'Hollins Reach' }).state), 2);
});

test('atlas.visit reads v1 locations: the place before the spot, and its coordinates', () => {
    const run = command(makeState(), 'atlas.visit', { name: 'Auvoth | Seventh Seal Terrace | [59.0, 110.4]' });
    const place = placeNamed(run.state, 'auvoth');
    assert.equal(place.name, 'Auvoth');
    assert.deepEqual([place.x, place.y], [59, 110]);
});

test('a place known only from a route line is discovered by a visit, with the scene filling its kind', () => {
    let { state } = lines(makeState(), '+ route Bluewatch Village — Old Weir | hours: 2');
    assert.equal(placeNamed(state, 'old weir').discovered, false);
    state = command(state, 'atlas.visit', { name: 'Old Weir', kind: 'wild' }).state;
    assert.equal(placeNamed(state, 'old weir').discovered, true);
    assert.equal(placeNamed(state, 'old weir').kind, 'wild');
    assert.equal(placeCount(state), 2);
});

test('with packs: a visited pack place takes the pack spelling and data; its coordinates stay the pack\'s', () => {
    const run = command(makeState(), 'atlas.visit', { name: 'bluewatch' }, { pack: PACK });
    assert.ok(run.ok, run.message);
    const place = placeNamed(run.state, 'bluewatch village');
    assert.equal(place.name, 'Bluewatch Village');
    assert.equal(place.region, 'Lakeshore');
    assert.equal(place.kind, 'village');
    assert.equal(place.x, undefined);
    assert.equal(run.state.domains.atlas.keys.bluewatch, place.id);
    // A second visit by the other name is the same place.
    assert.equal(placeCount(command(run.state, 'atlas.visit', { name: 'Bluewatch Village' }, { pack: PACK }).state), 1);
    const listed = query(run.state, 'atlas.places', {}, { pack: PACK });
    assert.deepEqual(listed.map(entry => [entry.name, entry.discovered, entry.source, entry.x]), [
        ['Bluewatch Village', true, 'atlas', 10.5], ['Old Weir', false, 'pack', 14], ['Hollin’s Reach', false, 'pack', 40],
    ]);
});

test('atlas.visit rejects a payload without a place, and nothing is saved', () => {
    const state = makeState();
    for (const payload of [{}, { name: 3 }, { name: '  ' }, null]) {
        const run = command(state, 'atlas.visit', payload);
        assert.equal(run.ok, false);
        assert.equal(run.code, 'INVALID');
        assert.equal(run.state, state);
    }
});

test('atlas.edit: rename (the old name stays an alias), coordinates, layer, region, kind', () => {
    let state = command(makeState(), 'atlas.visit', { name: 'Old Weir' }).state;
    const id = placeNamed(state, 'old weir').id;
    const run = command(state, 'atlas.edit', { place: 'old weir', name: 'Weir Bridge', x: 12.6, y: -3, layer: 'Underground', region: 'Lakeshore', kind: 'Bridge' });
    assert.ok(run.ok, run.message);
    assert.equal(run.result.summary, 'Weir Bridge: now called Weir Bridge, layer Underground, region Lakeshore, kind bridge, at 13, -3.');
    assert.equal(run.result.narrate, false);
    state = run.state;
    const place = state.domains.atlas.places[id];
    assert.deepEqual([place.name, place.x, place.y, place.layer, place.region, place.kind], ['Weir Bridge', 13, -3, 'Underground', 'Lakeshore', 'bridge']);
    assert.equal(state.domains.atlas.keys['old weir'], id);
    assert.equal(state.domains.atlas.keys['weir bridge'], id);
    // Coordinates move again (whole units stay whole) and clear with null.
    state = command(state, 'atlas.edit', { place: id, x: 4.4, y: 5 }).state;
    assert.deepEqual([state.domains.atlas.places[id].x, state.domains.atlas.places[id].y], [4, 5]);
    state = command(state, 'atlas.edit', { place: id, x: null, y: null, layer: '' }).state;
    assert.equal(state.domains.atlas.places[id].x, undefined);
    assert.equal(state.domains.atlas.places[id].layer, '');
});

test('atlas.edit on a pack place makes it the atlas\'s, still undiscovered', () => {
    const run = command(makeState(), 'atlas.edit', { place: 'pack:old weir', x: 1, y: 2 }, { pack: PACK });
    assert.ok(run.ok, run.message);
    const place = placeNamed(run.state, 'old weir');
    assert.deepEqual([place.discovered, place.x, place.region], [false, 1, 'Lakeshore']);
    const map = query(run.state, 'atlas.map', {}, { pack: PACK });
    assert.deepEqual(map.nodes.find(node => node.id === place.id).x, 1);
});

test('atlas.edit rejections change nothing', () => {
    let state = command(makeState(), 'atlas.visit', { name: 'Old Weir' }).state;
    state = command(state, 'atlas.visit', { name: 'Thunder Ruins' }).state;
    const id = placeNamed(state, 'old weir').id;
    for (const [payload, code] of [
        [{ place: 'Nowhere', name: 'X' }, 'NOT_FOUND'],
        [{ place: id }, 'INVALID'],
        [{ place: id, name: '  ' }, 'INVALID'],
        [{ place: id, name: 'x'.repeat(81) }, 'INVALID'],
        [{ place: id, x: 3 }, 'INVALID'],
        [{ place: id, x: 'a', y: 2 }, 'INVALID'],
        [{ place: id, x: Infinity, y: 2 }, 'INVALID'],
        [{ place: id, layer: 3 }, 'INVALID'],
        [{ place: id, colour: 'red' }, 'INVALID'],
        [{ place: id, name: 'thunder ruins' }, 'REFUSED'],
        [null, 'INVALID'],
    ]) {
        const run = command(state, 'atlas.edit', payload);
        assert.equal(run.ok, false, JSON.stringify(payload));
        assert.equal(run.code, code, JSON.stringify(payload));
        assert.equal(run.state, state);
    }
    // A rename onto a pack place is refused too.
    const packed = command(state, 'atlas.edit', { place: id, name: 'Bluewatch' }, { pack: PACK });
    assert.equal(packed.code, 'REFUSED');
});

test('atlas.focus marks a place on the map, null clears it, anything else changes nothing', () => {
    let state = command(makeState(), 'atlas.visit', { name: 'Old Weir' }).state;
    const id = placeNamed(state, 'old weir').id;
    let run = command(state, 'atlas.focus', { node: id });
    assert.ok(run.ok);
    assert.equal(run.state.domains.atlas.focus, id);
    assert.equal(query(run.state, 'atlas.selected').name, 'Old Weir');
    state = run.state;
    for (const payload of [{ node: 'pl_zzzzzzzz' }, { node: 'Old Weir' }, {}, { node: 5 }, undefined]) {
        run = command(state, 'atlas.focus', payload);
        assert.ok(run.ok, JSON.stringify(payload));
        assert.deepEqual(run.state.domains.atlas, state.domains.atlas);
        assert.equal(run.result.narrate, false);
    }
    run = command(state, 'atlas.focus', { node: null });
    assert.equal(run.state.domains.atlas.focus, null);
    assert.equal(query(run.state, 'atlas.selected'), null);
    // A pack node can be picked; once visited it is the atlas place that is shown.
    run = command(state, 'atlas.focus', { node: 'pack:hollins reach' }, { pack: PACK });
    assert.equal(run.state.domains.atlas.focus, 'pack:hollins reach');
    assert.equal(query(run.state, 'atlas.selected', {}, { pack: PACK }).name, 'Hollin’s Reach');
    const visited = command(run.state, 'atlas.visit', { name: 'Hollins Reach' }, { pack: PACK }).state;
    const selected = query(visited, 'atlas.selected', {}, { pack: PACK });
    assert.equal(selected.id, placeNamed(visited, 'hollins reach').id);
});

test('beforeGenerate sends the scene\'s place when it is new, and nothing once it is on the map', () => {
    const hook = part.hooks.beforeGenerate;
    const view = state => ({ state, query: name => (name === 'scene.place' ? { ...state.domains.scene.place } : undefined) });
    assert.equal(hook(view(makeState())), undefined);
    let state = makeState({ place: 'Bluewatch Village', kind: 'settlement', region: 'Lakeshore' });
    const out = hook(view(state));
    assert.deepEqual(out, { commands: [{ type: 'atlas.visit', payload: { name: 'Bluewatch Village', kind: 'settlement', region: 'Lakeshore' } }] });
    const runs = [];
    for (const { type, payload } of out.commands) {
        const run = command(state, type, payload);
        runs.push(run);
        state = run.state;
    }
    assert.equal(hook(view(state)), undefined);
    // By another spelling, still nothing; a new place sends again; a place known only by hearsay too.
    assert.equal(hook(view(at(state, 'bluewatch village', { kind: 'settlement' }))), undefined);
    assert.equal(hook(view(at(state, 'Old Weir'))).commands[0].payload.name, 'Old Weir');
    const heard = lines(state, '+ route Bluewatch Village — Old Weir').state;
    assert.equal(hook(view(at(heard, 'Old Weir'))).commands[0].type, 'atlas.visit');
    // The scene from the state when the view has no query.
    assert.equal(hook({ state: at(state, 'Thunder Ruins') }).commands[0].payload.name, 'Thunder Ruins');
    // A v1 location with a spot visits the place.
    assert.equal(hook(view(at(state, 'Bluewatch Village | Market'))), undefined);
    assert.deepEqual(replay(makeState({ place: 'Bluewatch Village', kind: 'settlement', region: 'Lakeshore' }), runs), state);
});
