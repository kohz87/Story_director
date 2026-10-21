import test from 'node:test';
import assert from 'node:assert/strict';

import { part } from '../../../src/v2/atlas/index.js';
import { routeTime } from '../../../src/v2/atlas/capture.js';
import { line, lines, makeState, placeNamed, replay } from './helpers/fake-ctx.js';

const routesOf = state => Object.values(state.domains.atlas.routes);

test('+ route makes both places (known by name, not yet visited) and the route with its time', () => {
    const { state, runs } = lines(makeState(), '+ route Bluewatch Village — Old Weir | hours: 2 | kind: road');
    const a = placeNamed(state, 'bluewatch village');
    const b = placeNamed(state, 'old weir');
    assert.ok(a && b);
    assert.match(a.id, /^pl_[0-9a-z]{8}$/);
    assert.equal(a.discovered, false);
    assert.equal(b.discovered, false);
    const [route] = routesOf(state);
    assert.match(route.id, /^rt_[0-9a-z]{8}$/);
    assert.deepEqual({ ...route, id: undefined }, { id: undefined, from: a.id, to: b.id, kind: 'road', hours: 2 });
    assert.equal(runs[0].result.summary, 'A road joins Bluewatch Village and Old Weir (2 h).');
    assert.equal(runs[0].result.narrate, false);
    assert.deepEqual(part.domains.atlas.validate(state.domains.atlas), []);
});

test('a route between the same places is one route: either way round, a new time replaces the old', () => {
    const { state } = lines(makeState(), [
        '+ route Bluewatch Village — Old Weir | hours: 2 | kind: road',
        '~ route Old Weir — bluewatch village | days: 1',
        '+ route Old Weir → Bluewatch Village | kind: river | hours: 1',
    ].join('\n'));
    const routes = routesOf(state);
    assert.equal(routes.length, 2);
    const road = routes.find(route => route.kind === 'road');
    assert.equal(road.days, 1);
    assert.equal(road.hours, undefined);
    assert.equal(routes.find(route => route.kind === 'river').hours, 1);
    assert.equal(Object.keys(state.domains.atlas.places).length, 2);
});

test('route times: whole days and hours as written, fractions as whole hours', () => {
    assert.deepEqual(routeTime({ hours: '2' }), { time: { hours: 2 } });
    assert.deepEqual(routeTime({ days: '1', hours: '6' }), { time: { days: 1, hours: 6 } });
    assert.deepEqual(routeTime({ days: '1.5' }), { time: { hours: 36 } });
    assert.deepEqual(routeTime({ hours: '0.5' }), { time: { hours: 1 } });
    assert.deepEqual(routeTime({ hours: '3 days' }), { time: { hours: 72 } });
    assert.deepEqual(routeTime({ days: '12 h' }), { time: { hours: 12 } });
    assert.deepEqual(routeTime({}), { time: {} });
    assert.match(routeTime({ hours: 'soon' }).error, /not a number/);
    assert.match(routeTime({ days: '0' }).error, /above 0/);
});

test('a route time changed from whole to a fraction stays whole numbers (the host keeps them whole)', () => {
    const first = lines(makeState(), '+ route A Town — B Town | hours: 2');
    const run = line(first.state, '~ route A Town — B Town | hours: 2.5');
    assert.ok(run.ok, run.message);
    assert.equal(routesOf(run.state)[0].hours, 3);
});

test('- route takes the way off the map; a route that is not there is NOT_FOUND', () => {
    const { state } = lines(makeState(), '+ route A Town — B Town | kind: road\n+ route A Town — B Town | kind: river');
    const gone = line(state, '- route B Town — A Town | kind: river');
    assert.ok(gone.ok);
    assert.deepEqual(routesOf(gone.state).map(route => route.kind), ['road']);
    const missing = line(gone.state, '- route A Town — C Town');
    assert.equal(missing.ok, false);
    assert.equal(missing.code, 'NOT_FOUND');
    assert.equal(missing.state, gone.state);
});

test('route lines that cannot be used are rejected and nothing is saved', () => {
    const state = makeState();
    for (const [raw, code] of [
        ['+ route Bluewatch Village', 'INVALID'],
        ['+ route Bluewatch Village — bluewatch village', 'INVALID'],
        ['+ route A Town — B Town | hours: later', 'INVALID'],
        ['+ route A Town — B Town | days: 0', 'INVALID'],
        ['! route A Town — B Town', 'INVALID'],
        ['? route A Town — B Town', 'INVALID'],
    ]) {
        const run = line(state, raw);
        assert.equal(run.ok, false, raw);
        assert.equal(run.code, code, raw);
        assert.equal(run.state, state, raw);
        assert.deepEqual(state.domains.atlas, part.domains.atlas.initial());
    }
});

test('+ landmark puts a described place on the map, discovered, with its region, kind and plane', () => {
    const { state, runs } = lines(makeState(), '+ landmark Thunder Ruins — a broken tower on the ridge | region: The Marches | kind: Ruin');
    const place = placeNamed(state, 'thunder ruins');
    assert.deepEqual({ ...place, id: undefined }, { id: undefined, name: 'Thunder Ruins', region: 'The Marches', kind: 'ruin', layer: '', discovered: true, rev: 1 });
    assert.equal(runs[0].result.summary, 'Thunder Ruins (ruin, The Marches) is on the map.');
    const below = lines(state, '+ landmark Sunken Vault | kind: dungeon | plane: Underground | at: 12.4, 40 | aka: the Vault').state;
    const vault = placeNamed(below, 'sunken vault');
    assert.equal(vault.layer, 'Underground');
    assert.deepEqual([vault.x, vault.y], [12, 40]);
    assert.equal(below.domains.atlas.keys['the vault'], vault.id);
});

test('a landmark the atlas knows by hearsay becomes discovered, and its labels correct it', () => {
    let { state } = lines(makeState(), '+ route Bluewatch Village — Thunder Ruins | hours: 3');
    state = lines(state, '~ landmark thunder ruins | kind: ruin | region: The Marches').state;
    const place = placeNamed(state, 'thunder ruins');
    assert.equal(place.discovered, true);
    assert.equal(place.kind, 'ruin');
    assert.equal(Object.keys(state.domains.atlas.places).length, 2);
    // Without a kind label, a new landmark is a "landmark" and a known one keeps its kind.
    state = lines(state, '+ landmark Thunder Ruins | region: High Marches').state;
    assert.equal(placeNamed(state, 'thunder ruins').kind, 'ruin');
    assert.equal(placeNamed(state, 'thunder ruins').region, 'High Marches');
    assert.equal(placeNamed(lines(state, '+ landmark Grey Stone').state, 'grey stone').kind, 'landmark');
});

test('landmark lines that cannot be used are rejected and nothing is saved', () => {
    const { state } = lines(makeState(), '+ landmark Thunder Ruins | kind: ruin');
    for (const [raw, code] of [['- landmark Thunder Ruins', 'REFUSED'], ['! landmark Thunder Ruins', 'INVALID'], ['? landmark Thunder Ruins', 'INVALID'], ['+ landmark **', 'INVALID']]) {
        const run = line(state, raw);
        assert.equal(run.ok, false, raw);
        assert.equal(run.code, code, raw);
        assert.equal(run.state, state, raw);
    }
});

test('the same lines with the same seeds give the same ids (no Math.random), and replay equals rebuild', () => {
    const block = [
        '+ route Bluewatch Village — Old Weir | hours: 2 | kind: road',
        '+ landmark Thunder Ruins | region: The Marches | kind: ruin',
        '+ route Old Weir — Thunder Ruins | days: 1.5 | kind: trail',
        '~ landmark Old Weir | kind: weir',
        '- route Bluewatch Village — Old Weir',
    ].join('\n');
    const one = lines(makeState(), block);
    const two = lines(makeState(), block);
    assert.deepEqual(one.state, two.state);
    assert.deepEqual(replay(makeState(), one.runs), one.state);
});

test('the domain validator refuses broken atlases', () => {
    const validate = part.domains.atlas.validate;
    const { state } = lines(makeState(), '+ route A Town — B Town | hours: 2');
    const good = structuredClone(state.domains.atlas);
    const [a] = Object.keys(good.places);
    const broken = [
        atlas => { atlas.places[a].x = 1.5; atlas.places[a].y = 2; },
        atlas => { atlas.places[a].x = 1; },
        atlas => { atlas.places[a].discovered = 'yes'; },
        atlas => { delete atlas.keys['a town']; },
        atlas => { atlas.keys.nowhere = 'pl_00000000'; },
        atlas => { Object.values(atlas.routes)[0].to = 'pl_00000000'; },
        atlas => { Object.values(atlas.routes)[0].hours = -1; },
        atlas => { atlas.focus = 'pl_00000000'; },
        atlas => { atlas.extra = true; },
    ];
    assert.deepEqual(validate(good), []);
    for (const breakIt of broken) {
        const atlas = structuredClone(good);
        breakIt(atlas);
        assert.notDeepEqual(validate(atlas), [], breakIt.toString());
    }
    assert.notDeepEqual(validate(null), []);
});
