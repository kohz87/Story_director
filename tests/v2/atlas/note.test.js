import test from 'node:test';
import assert from 'node:assert/strict';

import { part } from '../../../src/v2/atlas/index.js';
import { TAIL_BUDGET } from '../../../src/v2/atlas/note.js';
import { at, command, lines, makeState, queryFor } from './helpers/fake-ctx.js';

// What the host puts in the static prompt for this part: each kind's one line, then its static.
const staticOf = () => [...Object.values(part.kinds).map(kind => kind.grammar), part.context.static()].join('\n');
const view = (state, { settings = {}, pack = null } = {}) => ({ state, query: (name, args) => queryFor(pack)(state, name, args), settings: () => settings, chat: { length: 3, lastUser: 'we ride on' } });

function story() {
    let state = makeState({ place: 'Bluewatch Village' });
    state = command(state, 'atlas.visit', { name: 'Bluewatch Village' }).state;
    return lines(state, [
        '+ route Bluewatch Village — Old Weir | hours: 2 | kind: road',
        '+ route Bluewatch Village — Thunder Ruins | days: 1 | hours: 12 | kind: trail',
        '+ route Bluewatch Village — Grey Fen',
        '+ route Old Weir — Thunder Ruins | hours: 5',
    ].join('\n')).state;
}

test('the static part is the two kinds\' grammar only, byte-identical whatever the state', () => {
    assert.deepEqual(Object.keys(part.kinds), ['route', 'landmark']);
    assert.equal(part.context.static(), '');
    const before = staticOf();
    const changed = lines(story(), '+ landmark Sunken Vault | plane: Underground\n- route Bluewatch Village — Old Weir').state;
    part.context.tail(view(changed));
    assert.equal(staticOf(), before);
    assert.equal(Buffer.from(staticOf()).equals(Buffer.from(before)), true);
    for (const grammar of Object.values(part.kinds).map(kind => kind.grammar)) {
        assert.doesNotMatch(grammar, /\n/);
        assert.doesNotMatch(grammar, /Bluewatch|Weir|Ruins/);
    }
    assert.match(part.kinds.route.grammar, /^\+ route Place — Other Place \| hours: 2/);
    assert.match(part.kinds.landmark.grammar, /^\+ landmark Name \| region: .* \| kind: /);
});

test('the tail is one optional line: the known routes from the scene\'s place with their times', () => {
    const out = part.context.tail(view(story()));
    assert.deepEqual(out.lines, []);
    assert.deepEqual(out.optional, ['Routes from Bluewatch Village: Old Weir by road, 2 h · Thunder Ruins by trail, 1.5 days · Grey Fen.']);
    assert.equal(part.context.budget, TAIL_BUDGET);
    assert.equal(TAIL_BUDGET, 80);
});

test('the tail uses the packs\' roads (and the reader\'s map settings) when there are some', () => {
    const pack = {
        places: [{ name: 'Bluewatch Village', x: 0, y: 0 }, { name: 'Fenwatch', x: 30, y: 40 }],
        routes: [{ from: 'Bluewatch Village', to: 'Old Weir', km: 40, kind: 'road' }],
    };
    let state = story();
    const out = part.context.tail(view(state, { pack }));
    assert.equal(out.optional[0], 'Routes from Bluewatch Village: Thunder Ruins by trail, 1.5 days · Old Weir by road, 2 days · Grey Fen.');
    // A modern map counts the pack's road in hours by car.
    const modern = part.context.tail(view(state, { pack, settings: { map: { era: 'modern' } } }));
    assert.match(modern.optional[0], /^Routes from Bluewatch Village: Old Weir by road, 45 min · /);
    // Elsewhere: that place's routes; a place with none, or no place, or no atlas: nothing.
    assert.deepEqual(part.context.tail(view(at(state, 'Grey Fen'))).optional, ['Routes from Grey Fen: Bluewatch Village.']);
    assert.deepEqual(part.context.tail(view(at(state, 'Fenwatch'), { pack })), { lines: [], optional: [] });
    assert.deepEqual(part.context.tail(view(at(state, ''))), { lines: [], optional: [] });
    state = { ...state, domains: { scene: state.domains.scene } };
    assert.deepEqual(part.context.tail(view(state)), { lines: [], optional: [] });
});

test('the tail line keeps within its budget (characters / 4)', () => {
    let state = makeState({ place: 'Crossroads' });
    const block = Array.from({ length: 40 }, (_, i) => `+ route Crossroads — Hamlet Number ${i + 1} With A Long Name | hours: ${i + 1} | kind: road`).join('\n');
    state = lines(state, block).state;
    const [line] = part.context.tail(view(state)).optional;
    assert.ok(line.length / 4 <= TAIL_BUDGET, `${line.length} characters`);
    assert.match(line, /^Routes from Crossroads: Hamlet Number 1 With A Long Name by road, 1 h · /);
    assert.match(line, /\.$/);
});
