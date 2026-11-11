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
    assert.deepEqual(out, { commands: [{ type: 'atlas.visit', payload: { name: 'Bluewatch Village', kind: 'settlement', region: 'Lakeshore', parents: true } }] });
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

// ---- parents and saved coordinates (parent.js) --------------------------------------------------------------------------------------
const TOWNS = {
    places: [
        { name: 'Auvoth', region: 'Gate Coast', kind: 'city', x: 59, y: 110 },
        { name: 'Bluewatch Village', region: 'River', kind: 'village', x: 64, y: 110, aliases: ['Bluewatch'] },
        { name: 'Old Weir', region: 'River', kind: 'weir', x: 70, y: 100 },
    ],
    routes: [{ from: 'Auvoth', to: 'Old Weir', hours: 6, kind: 'road' }],
};
const visit = (state, name, extra = {}) => command(state, 'atlas.visit', { name, parents: true, ...extra }, { pack: TOWNS });
const near = (place, parent) => Math.hypot(place.x - parent.x, place.y - parent.y);

test('parent rules: "X / Y", "X (Y)", "Y in X" and a known-name prefix (alias too) set the parent and coordinates from it', () => {
    let state = makeState();
    for (const name of ['Auvoth (Southern Gatehouse)', 'Auvoth / Pale Alley', 'Iron Lantern in Auvoth', 'Bluewatch Watchhouse']) {
        const run = visit(state, name);
        assert.ok(run.ok, run.message);
        state = run.state;
    }
    const atlas = state.domains.atlas;
    const auvoth = placeNamed(state, 'auvoth');
    const blue = placeNamed(state, 'bluewatch village');
    for (const [name, parent] of [['auvoth (southern gatehouse)', auvoth], ['auvoth / pale alley', auvoth], ['iron lantern in auvoth', auvoth], ['bluewatch watchhouse', blue]]) {
        const place = placeNamed(state, name);
        assert.equal(place.parent, parent.id, name);
        const base = parent === auvoth ? { x: 59, y: 110 } : { x: 64, y: 110 };
        const d = near(place, base);
        assert.ok(d >= 0.29 && d <= 0.51, `${name} ${d}`);
    }
    // The pack's parents became atlas places (not visited), the children are not.
    assert.equal(auvoth.discovered, false);
    assert.deepEqual(part.domains.atlas.validate(atlas), []);
    // A pack place keeps its own coordinates and gets no parent; a name no rule splits gets none.
    const pack = visit(makeState(), 'Bluewatch').state;
    assert.equal(placeNamed(pack, 'bluewatch village').parent, undefined);
    assert.equal(placeNamed(pack, 'bluewatch village').x, undefined);
});

test('a missing parent is made as an atlas place with coordinates, then the child under it; the offset is fixed and replays the same', () => {
    const first = visit(makeState(), 'Auvoth (Old Dock)');
    const again = visit(first.state, 'Frontier Road (Halfway Brook)');
    // "Frontier Road" is nowhere: made, placed next to the previous visited place (Old Dock), and Halfway Brook sits by it.
    const road = placeNamed(again.state, 'frontier road');
    const brook = placeNamed(again.state, 'frontier road (halfway brook)');
    assert.ok(road, 'the parent was made');
    assert.equal(brook.parent, road.id);
    assert.ok(Number.isFinite(road.x) && Number.isFinite(brook.x));
    const dock = placeNamed(again.state, 'auvoth (old dock)');
    assert.ok(near(road, dock) <= 0.51);
    // Same offset on a second chat that visits the same name under the same parent.
    const other = visit(visit(makeState(), 'Auvoth (Old Dock)').state, 'Auvoth (Old Dock)').state;
    assert.equal(placeNamed(other, 'auvoth (old dock)').x, dock.x);
    assert.equal(placeNamed(other, 'auvoth (old dock)').y, dock.y);
    // Replay of the recorded ops gives the same atlas.
    const fresh = makeState();
    assert.deepEqual(replay(fresh, [first, again]), again.state);
});

test('with no parent a place goes to the middle of its region, else beside the previous place, else gets no coordinates', () => {
    let state = visit(makeState(), 'Bluewatch Village').state;
    state = command(state, 'atlas.edit', { place: placeNamed(state, 'bluewatch village').id, x: 20, y: 30 }, { pack: TOWNS }).state;
    // Same region: the pack's Old Weir is unvisited but placed in "River"; the centroid of Bluewatch (20,30) and Old Weir (70,100).
    const loose = visit(state, 'Outside the Stray Oar', { region: 'River' }).state;
    const oar = placeNamed(loose, 'outside the stray oar');
    assert.equal(oar.parent, undefined);
    assert.ok(Math.hypot(oar.x - 45, oar.y - 65) <= 0.51, `${oar.x},${oar.y}`);
    // No region: next to the previous visited place that has a point.
    const next = visit(state, 'Northern Watch-Horn').state;
    assert.ok(near(placeNamed(next, 'northern watch-horn'), { x: 20, y: 30 }) <= 0.51);
    // Nothing placed at all: an old-style row (no coordinates).
    const none = visit(makeState(), 'Nowhere Special').state;
    assert.equal(placeNamed(none, 'nowhere special').x, undefined);
});

test('a visit recorded without the rule keeps the old atlas: no parent, no coordinates, no parent place made (Re-read stays byte-identical)', () => {
    const old = command(makeState(), 'atlas.visit', { name: 'Auvoth (Southern Gatehouse)' }, { pack: TOWNS });
    const place = placeNamed(old.state, 'auvoth (southern gatehouse)');
    assert.deepEqual({ ...place, id: undefined }, { id: undefined, name: 'Auvoth (Southern Gatehouse)', region: '', kind: '', layer: '', discovered: true, rev: 1 });
    assert.equal(Object.keys(old.state.domains.atlas.places).length, 1);
    assert.equal(replay(makeState(), [old]).domains.atlas.checkpoint, old.state.domains.atlas.checkpoint);
    assert.deepEqual(replay(makeState(), [old]), old.state);
    // A checkpoint without `parent` validates as before; one with it is checked.
    assert.deepEqual(part.domains.atlas.validate(old.state.domains.atlas), []);
    const bad = structuredClone(visit(makeState(), 'Auvoth (Gate)').state.domains.atlas);
    Object.values(bad.places).find(item => item.parent).parent = 'nope';
    assert.match(part.domains.atlas.validate(bad).join(' '), /parent must be the id of another place/);
});

test('the place line reads "Town · Spot" (the town alone at the town); atlas.here carries it', () => {
    let state = visit(makeState(), 'Auvoth (Southern Gatehouse)').state;
    state = at(state, 'Auvoth (Southern Gatehouse)');
    assert.equal(query(state, 'atlas.here', {}, { pack: TOWNS }).line, 'Auvoth · Southern Gatehouse');
    assert.equal(query(at(state, 'Auvoth'), 'atlas.here', {}, { pack: TOWNS }).line, 'Auvoth');
    state = visit(state, 'Bluewatch Village / Guild Office').state;
    assert.equal(query(at(state, 'Bluewatch Village / Guild Office'), 'atlas.here', {}, { pack: TOWNS }).line, 'Bluewatch Village · Guild Office');
});

test('the routes line at a child place uses its parent\'s routes (and names the parent)', () => {
    const state = at(visit(makeState(), 'Auvoth (Southern Gatehouse)').state, 'Auvoth (Southern Gatehouse)');
    const tail = part.context.tail({ state, query: (name, args) => query(state, name, args, { pack: TOWNS }), settings: () => ({}) });
    assert.match(tail.optional[0], /^Routes from Auvoth: Old Weir by road, 6 h/);
});

test('"Tidy the map" gives saved coordinates to visited places without any, as one recorded reader action that replays the same', () => {
    const old = command(makeState(), 'atlas.visit', { name: 'Auvoth (Southern Gatehouse)' }, { pack: TOWNS });
    const old2 = command(old.state, 'atlas.visit', { name: 'Bluewatch Watchhouse' }, { pack: TOWNS });
    const run = command(old2.state, 'atlas.edit', { tidy: true }, { pack: TOWNS });
    assert.ok(run.ok, run.message);
    assert.match(run.result.summary, /^2 places placed on the map\.$/);
    const gate = placeNamed(run.state, 'auvoth (southern gatehouse)');
    assert.ok(Number.isFinite(gate.x) && gate.parent);
    assert.ok(near(gate, { x: 59, y: 110 }) <= 0.51);
    assert.deepEqual(replay(makeState(), [old, old2, run]), run.state);
    // Nothing left to tidy: a plain sentence, nothing saved.
    const again = command(run.state, 'atlas.edit', { tidy: true }, { pack: TOWNS });
    assert.equal(again.ok, false);
    assert.equal(again.state, run.state);
    // The map offers the action only while a place has none.
    assert.equal(query(old2.state, 'atlas.map', {}, { pack: TOWNS }) !== null, true);
    assert.equal(query(old2.state, 'atlas.view', {}, { pack: TOWNS }).tidy, 2);
    assert.equal(query(run.state, 'atlas.view', {}, { pack: TOWNS }).tidy, 0);
});

// ---- review fixes: parent direction, pack wins over auto coordinates, Tidy, place line (the owner's own names) -----------------------------
const visitAll = (state, names, pack = TOWNS) => names.reduce((now, name) => command(now, 'atlas.visit', { name, parents: true }, { pack }).state, state);
const findAtlas = (state, key) => placeNamed(state, key.toLowerCase());

test('parent direction: the part that resolves is the parent, a bracket of kind or region words names none, and a made parent only when neither resolves', () => {
    // "Lime-Shed (Salt-and-Ash Yard)" with the Yard known: the Yard is the parent, no "Lime-Shed" place is made.
    let state = visitAll(makeState(), ['Salt-and-Ash Yard', 'Lime-Shed (Salt-and-Ash Yard)']);
    const yard = findAtlas(state, 'Salt-and-Ash Yard');
    const shed = findAtlas(state, 'Lime-Shed (Salt-and-Ash Yard)');
    assert.equal(shed.parent, yard.id);
    assert.equal(placeNamed(state, 'lime-shed'), null);
    assert.equal(query(at(state, 'Lime-Shed (Salt-and-Ash Yard)'), 'atlas.here', {}, { pack: TOWNS }).line, 'Salt-and-Ash Yard · Lime-Shed');
    // "(settlement, Bluewatch)" describes the place: the prefix rule gives Bluewatch Village, and the line drops the bracket.
    state = visitAll(makeState(), ['Bluewatch Storehouse Three (settlement, Bluewatch)']);
    const storehouse = findAtlas(state, 'Bluewatch Storehouse Three (settlement, Bluewatch)');
    assert.equal(storehouse.parent, findAtlas(state, 'Bluewatch Village').id);
    assert.equal(placeNamed(state, 'bluewatch storehouse three'), null);
    assert.equal(query(at(state, storehouse.name), 'atlas.here', {}, { pack: TOWNS }).line, 'Bluewatch Village · Storehouse Three');
    // "Guild Office / Bluewatch Village": the second part resolves, the first does not.
    state = visitAll(makeState(), ['Guild Office / Bluewatch Village']);
    assert.equal(findAtlas(state, 'Guild Office / Bluewatch Village').parent, findAtlas(state, 'Bluewatch Village').id);
    assert.equal(placeNamed(state, 'guild office'), null);
    assert.equal(query(at(state, 'Guild Office / Bluewatch Village'), 'atlas.here', {}, { pack: TOWNS }).line, 'Bluewatch Village · Guild Office');
    // Neither part known: the first is made (the story-made parent).
    state = visitAll(makeState(), ['Frontier Road (Halfway Brook)']);
    assert.equal(findAtlas(state, 'Frontier Road (Halfway Brook)').parent, findAtlas(state, 'Frontier Road').id);
    assert.deepEqual(part.domains.atlas.validate(state.domains.atlas), []);
});

test('a pack update after a story-made parent: the pack\'s coordinates win and the child follows; a reader\'s edit keeps its own', () => {
    const early = { places: [{ name: 'Bluewatch Village', region: 'River', kind: 'village', x: 64, y: 110 }] };
    let state = visitAll(makeState(), ['Bluewatch Village', 'Auvoth (Gate)'], early);
    const auvoth = findAtlas(state, 'Auvoth');
    assert.equal(auvoth.auto, true);
    assert.ok(near(auvoth, { x: 64, y: 110 }) <= 0.51, 'made beside the previous place');
    const gate = findAtlas(state, 'Auvoth (Gate)');
    assert.equal(gate.parent, auvoth.id);
    assert.deepEqual(part.domains.atlas.validate(state.domains.atlas), []);
    // The pack gains Auvoth at 59, 110: it wins, and the child is drawn by the live parent.
    const seen = id => query(state, 'atlas.place', { id }, { pack: TOWNS });
    assert.deepEqual([seen(auvoth.id).x, seen(auvoth.id).y], [59, 110]);
    assert.ok(near(seen(gate.id), { x: 59, y: 110 }) <= 0.51);
    const view = query(state, 'atlas.view', {}, { pack: TOWNS }).places.find(place => place.id === gate.id);
    assert.ok(near(view, { x: 59, y: 110 }) <= 0.51);
    // The reader sets Auvoth's point: the mark goes, and the pack no longer wins; the child follows.
    state = command(state, 'atlas.edit', { place: auvoth.id, x: 70, y: 70 }, { pack: TOWNS }).state;
    assert.equal(findAtlas(state, 'Auvoth').auto, undefined);
    assert.deepEqual([seen(auvoth.id).x, seen(auvoth.id).y], [70, 70]);
    assert.ok(near(seen(gate.id), { x: 70, y: 70 }) <= 0.51);
    // A pack that gains the child itself: its point wins over the parent's offset.
    const withChild = { places: [...TOWNS.places, { name: 'Auvoth (Gate)', x: 58, y: 112 }] };
    const packed = query(state, 'atlas.place', { id: gate.id }, { pack: withChild });
    assert.deepEqual([packed.x, packed.y], [58, 112]);
});

test('Tidy counts only what it can place; a child under a coordinate-less parent is placed after Tidy, parent first', () => {
    // Nothing placeable (no pack, no coordinates, no region): no button and a true sentence.
    const old = command(makeState(), 'atlas.visit', { name: 'Nowhere Special' });
    assert.equal(query(old.state, 'atlas.view', {}, { pack: { places: [] } }).tidy, 0);
    const refused = command(old.state, 'atlas.edit', { tidy: true });
    assert.equal(refused.ok, false);
    assert.match(refused.message, /None of the places without coordinates can be placed yet/);
    // "Zeth" was visited with no point; "Zeth Gatehouse" learns its parent but cannot be placed yet.
    let state = command(makeState(), 'atlas.visit', { name: 'Zeth' }).state;
    state = visitAll(state, ['Zeth Gatehouse', 'Bluewatch Village']);
    const gatehouse = () => findAtlas(state, 'Zeth Gatehouse');
    assert.equal(gatehouse().parent, findAtlas(state, 'Zeth').id);
    assert.equal(gatehouse().x, undefined);
    assert.equal(query(state, 'atlas.view', {}, { pack: TOWNS }).tidy, 2);
    const run = command(state, 'atlas.edit', { tidy: true }, { pack: TOWNS });
    assert.ok(run.ok, run.message);
    assert.match(run.result.summary, /^2 places placed/);
    state = run.state;
    assert.ok(Number.isFinite(gatehouse().x));
    assert.ok(near(gatehouse(), findAtlas(state, 'Zeth')) <= 0.51);
    assert.equal(query(state, 'atlas.view', {}, { pack: TOWNS }).tidy, 0);
});

test('a child that cannot be placed is not settled again and again; a rename keeps the drawn point', () => {
    const state = visitAll(visitAll(makeState(), ['Zeth']), ['Zeth Gatehouse']);
    const again = command(state, 'atlas.visit', { name: 'Zeth Gatehouse', parents: true });
    assert.equal(JSON.stringify(again.state.domains.atlas), JSON.stringify(state.domains.atlas), 'nothing changed, no rev bump');
    const placed = visitAll(makeState(), ['Auvoth (Southern Gatehouse)']);
    const gate = findAtlas(placed, 'Auvoth (Southern Gatehouse)');
    const drawn = id => query(placed, 'atlas.place', { id }, { pack: TOWNS });
    const before = [drawn(gate.id).x, drawn(gate.id).y];
    const renamed = command(placed, 'atlas.edit', { place: gate.id, name: 'Southern Gatehouse' }, { pack: TOWNS }).state;
    const after = query(renamed, 'atlas.place', { id: gate.id }, { pack: TOWNS });
    assert.deepEqual([after.x, after.y], before);
});

test('the place line keeps the spot of "Bluewatch — Guild Office", works before the atlas has the place, uses the saved parent, and a town counts as visited through a child', () => {
    const state = visitAll(makeState(), ['Auvoth (Southern Gatehouse)']);
    assert.equal(query(at(makeState(), 'Bluewatch — Guild Office'), 'atlas.here', {}, { pack: TOWNS }).line, 'Bluewatch Village · Guild Office');
    assert.equal(query(makeState(), 'atlas.line', { name: 'Bluewatch Village / Guild Office' }, { pack: TOWNS }), 'Bluewatch Village · Guild Office');
    assert.equal(query(makeState(), 'atlas.line', { name: '' }, { pack: TOWNS }), '');
    // The reader renames the child: the line still names its saved parent.
    const gate = findAtlas(state, 'Auvoth (Southern Gatehouse)');
    const renamed = command(state, 'atlas.edit', { place: gate.id, name: 'Southern Gatehouse' }, { pack: TOWNS }).state;
    assert.equal(query(at(renamed, 'Southern Gatehouse'), 'atlas.here', {}, { pack: TOWNS }).line, 'Auvoth · Southern Gatehouse');
    // Auvoth was only named as a parent (not discovered), yet the map shows it visited with its count.
    const places = query(state, 'atlas.view', {}, { pack: TOWNS }).places;
    assert.equal(findAtlas(state, 'Auvoth').discovered, false);
    assert.deepEqual([places.find(place => place.name === 'Auvoth').visited, places.find(place => place.name === 'Auvoth').inside], [true, 1]);
});
