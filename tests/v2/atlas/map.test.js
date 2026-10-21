import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { map as mapWidget, visibleOnLayer, mapNodes, mapEdges } from './vendor/story-block/src/v2/view/widgets/map.js';
import { propProblems } from './vendor/story-block/src/v2/view/widgets/props.js';
import { DEFAULT_ICON, iconFor } from '../../../src/v2/atlas/map.js';
import { at, command, lines, makeState, placeNamed, query } from './helpers/fake-ctx.js';

const MAIN = '/home/user/_main/story_block/src/v2/';
const VENDOR = fileURLToPath(new URL('./vendor/story-block/src/v2/', import.meta.url));

const PACK = {
    places: [
        { name: 'Bluewatch Village', region: 'Lakeshore', kind: 'village', x: 10, y: 20 },
        { name: 'Old Weir', region: 'Lakeshore', kind: 'weir', x: 14, y: 26 },
        { name: 'Deepdelve', region: 'Lakeshore', kind: 'mine', x: 12, y: 24, layer: 'Underground' },
        { name: 'Fenwatch', region: 'Fenmarch', kind: 'castle', x: 60, y: 20 },
    ],
    routes: [
        { from: 'Bluewatch Village', to: 'Old Weir', km: 12, kind: 'road' },
        { from: 'Old Weir', to: 'Fenwatch', km: 90, kind: 'road' },
        { from: 'Bluewatch Village', to: 'Nowhere Known', km: 5, kind: 'road' },
    ],
};

function storyAtlas() {
    let state = makeState({ place: 'Bluewatch Village' });
    state = command(state, 'atlas.visit', { name: 'Bluewatch Village', kind: 'settlement', region: 'Lakeshore' }).state;
    state = lines(state, [
        '+ route Bluewatch Village — Old Weir | hours: 2 | kind: road',
        '+ landmark Thunder Ruins | region: The Marches | kind: ruin',
        '+ landmark Sunken Vault | kind: dungeon | plane: Underground',
        '+ route Old Weir — Thunder Ruins | days: 1 | kind: trail',
    ].join('\n')).state;
    return state;
}

const KEYS = ['nodes', 'edges', 'layers', 'current', 'discovered', 'kinds'];

function assertMapProps(props) {
    assert.deepEqual(Object.keys(props).sort(), [...KEYS].sort());
    for (const key of Object.keys(props)) assert.ok(Object.hasOwn(mapWidget.props, key), `${key} is an ss.map prop`);
    assert.deepEqual(mapWidget.validate(props), []);
    assert.deepEqual(propProblems(mapWidget.props, props), []);
    // Bound as a screen binds it (`props.value`), with the screen's own props beside it.
    assert.deepEqual(mapWidget.validate({ value: props, onSelect: 'atlas.focus', fog: 'unknown' }), []);
    // The widget keeps every node and every edge as given.
    const nodes = mapNodes(props.nodes);
    assert.equal(nodes.length, props.nodes.length);
    assert.equal(mapEdges(props.edges, new Set(nodes.map(node => node.id))).length, props.edges.length);
    for (const node of props.nodes) {
        assert.equal(typeof node.id, 'string');
        assert.equal(typeof node.icon, 'string');
        assert.ok(node.icon);
        assert.equal((node.x === undefined) === (node.y === undefined), true);
    }
}

test('atlas.map gives exactly ss.map\'s props, valid by its own validate (story only)', () => {
    const state = storyAtlas();
    const props = query(state, 'atlas.map');
    assertMapProps(props);
    const id = name => placeNamed(state, name).id;
    assert.deepEqual(props.nodes.map(node => node.name), ['Bluewatch Village', 'Old Weir', 'Sunken Vault', 'Thunder Ruins']);
    assert.deepEqual(props.nodes.map(node => node.icon), ['fa-house', 'fa-location-dot', 'fa-dungeon', 'fa-landmark']);
    assert.equal(props.current, id('bluewatch village'));
    assert.deepEqual(props.discovered, [id('bluewatch village'), id('sunken vault'), id('thunder ruins')]);
    assert.deepEqual(props.edges, [
        { from: id('bluewatch village'), to: id('old weir'), kind: 'road' },
        { from: id('old weir'), to: id('thunder ruins'), kind: 'trail' },
    ]);
    assert.deepEqual(props.kinds, {
        settlement: { label: 'Settlement', icon: 'fa-house' },
        ruin: { label: 'Ruin', icon: 'fa-landmark' },
        dungeon: { label: 'Dungeon', icon: 'fa-dungeon' },
        road: { label: 'Road' },
        trail: { label: 'Trail' },
    });
    // Nothing known yet: still valid, and empty.
    const empty = query(makeState(), 'atlas.map');
    assertMapProps(empty);
    assert.deepEqual(empty, { nodes: [], edges: [], layers: [], current: '', discovered: [], kinds: {} });
});

test('layers: a place\'s plane, else its region; places with neither show on every layer', () => {
    const state = lines(storyAtlas(), '+ landmark Lone Stone').state;
    const props = query(state, 'atlas.map');
    assert.deepEqual(props.layers, [{ id: 'lakeshore', name: 'Lakeshore' }, { id: 'the marches', name: 'The Marches' }, { id: 'underground', name: 'Underground' }]);
    assert.deepEqual(props.nodes.map(node => [node.name, node.layer]), [
        ['Bluewatch Village', 'lakeshore'], ['Lone Stone', ''], ['Old Weir', ''], ['Sunken Vault', 'underground'], ['Thunder Ruins', 'the marches'],
    ]);
    // What the widget shows on the Underground layer: the vault and the places on no layer.
    const shown = layer => visibleOnLayer({
        nodes: mapNodes(props.nodes), edges: mapEdges(props.edges, new Set(props.nodes.map(node => node.id))),
        layer, discovered: new Set(props.discovered), current: props.current, fog: 'unknown',
    }).nodes.map(node => node.name || '?');
    assert.deepEqual(shown('underground'), ['Lone Stone', 'Sunken Vault']);
    // On Lakeshore, Old Weir (heard of, on no layer) is a "?" beside Bluewatch Village.
    assert.deepEqual(shown('lakeshore'), ['Bluewatch Village', 'Lone Stone', '?']);
    // A reader's layer wins over the region.
    const moved = command(state, 'atlas.edit', { place: 'Bluewatch Village', layer: 'Sky' }).state;
    assert.equal(query(moved, 'atlas.map').nodes[0].layer, 'sky');
});

test('with packs: pack places are known but undiscovered nodes with the pack\'s x/y; visiting discovers them', () => {
    let state = storyAtlas();
    let props = query(state, 'atlas.map', {}, { pack: PACK });
    assertMapProps(props);
    const node = name => props.nodes.find(entry => entry.name === name);
    assert.deepEqual(props.nodes.map(entry => entry.name), ['Bluewatch Village', 'Old Weir', 'Sunken Vault', 'Thunder Ruins', 'Deepdelve', 'Fenwatch']);
    assert.deepEqual([node('Bluewatch Village').x, node('Bluewatch Village').y], [10, 20]);
    assert.equal(node('Old Weir').kind, 'weir');       // the pack fills what the story left out
    assert.equal(node('Fenwatch').id, 'pack:fenwatch');
    assert.equal(node('Deepdelve').layer, 'underground');
    assert.equal(props.discovered.includes('pack:fenwatch'), false);
    // The pack's road and the story's are one edge; the pack's road to Fenwatch is added; one to an unknown place is not.
    assert.equal(props.edges.length, 3);
    assert.ok(props.edges.some(edge => edge.to === 'pack:fenwatch'));
    // Visiting Fenwatch makes it the atlas's: a pl_ id, discovered, and the current place.
    state = command(at(state, 'Fenwatch'), 'atlas.visit', { name: 'Fenwatch' }, { pack: PACK }).state;
    props = query(state, 'atlas.map', {}, { pack: PACK });
    assertMapProps(props);
    const fen = placeNamed(state, 'fenwatch');
    assert.equal(props.current, fen.id);
    assert.ok(props.discovered.includes(fen.id));
    assert.equal(props.nodes.filter(entry => entry.name === 'Fenwatch').length, 1);
    assert.deepEqual([node('Fenwatch').x, props.nodes.find(entry => entry.id === fen.id).x], [60, 60]);
    // The current place a pack node, before any visit.
    assert.equal(query(at(storyAtlas(), 'Deepdelve'), 'atlas.map', {}, { pack: PACK }).current, 'pack:deepdelve');
});

test('a broken or missing packs query gives the story-only atlas', () => {
    const state = storyAtlas();
    const plain = query(state, 'atlas.map');
    assert.deepEqual(query(state, 'atlas.map', {}, { pack: { places: 'nope', routes: [null, 3, { from: 'A' }] } }), plain);
    assert.deepEqual(query(state, 'atlas.map', {}, { pack: { places: [{ name: '' }, null, { name: 'Bluewatch Village', x: 'a' }] } }), plain);
});

test('icons by kind', () => {
    assert.equal(iconFor('Market Town'), 'fa-house');
    assert.equal(iconFor('city'), 'fa-city');
    assert.equal(iconFor('ruin'), 'fa-landmark');
    assert.equal(iconFor('cave'), 'fa-mountain-sun');
    assert.equal(iconFor(''), DEFAULT_ICON);
    assert.equal(iconFor('strange'), DEFAULT_ICON);
});

test('the vendored Story Block files are the same as Story Block\'s own', { skip: existsSync(MAIN) ? false : 'no Story Block checkout at /home/user/_main/story_block' }, () => {
    const files = ['ops.js', 'check.js', 'view/screens.js', 'view/css.js', ...readdirSync(`${VENDOR}view/widgets`).map(name => `view/widgets/${name}`)];
    for (const file of files) assert.equal(readFileSync(`${VENDOR}${file}`, 'utf8'), readFileSync(`${MAIN}${file}`, 'utf8'), file);
});
