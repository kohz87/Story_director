// World State Alpha exports become tracked events.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatOp, parseChanges } from '../src/changes.js';
import { importWorldStateAlpha } from '../src/wsa.js';

const bundle = {
    format: 'world_state_alpha_bundle',
    version: 1,
    state: {
        records: [
            { id: 'wsr_1', kind: 'fact', summary: 'The Northglass bridge is destroyed and impassable.', status: 'active', trend: null, anchors: ['bridge', 'Northglass Pass'], timeAnchor: '14 Frostwane 842' },
            { id: 'wsr_2', kind: 'development', summary: 'Armed men claiming ditch-watch authority are demanding a raised ditch tax; villagers avoid the lane', status: 'active', trend: 'rising', anchors: ['Farwick'] },
            { id: 'wsr_3', kind: 'development', summary: 'The siege of Varn has ended.', status: 'resolved', trend: null, anchors: [] },
            { id: 'wsr_4', kind: 'fact', summary: 'The Northglass bridge is destroyed and the ferry runs | twice a day.', status: 'active', anchors: [] },
        ],
    },
};

test('active facts and developments become events, keyed by their first clause', () => {
    const { ops, counts, errors } = importWorldStateAlpha(JSON.stringify(bundle));
    assert.deepEqual(errors, []);
    assert.deepEqual(counts, { facts: 2, developments: 1, skipped: 1 });
    assert.deepEqual(ops.map(op => op.key), [
        'The Northglass bridge is destroyed and impassable',
        'Armed men claiming ditch-watch authority are demanding',
        'The Northglass bridge is destroyed and the',
    ]);
    assert.equal(ops[0].fields.people, 'bridge, Northglass Pass', 'anchors drive relevance');
    assert.equal(ops[0].extra.settled, 'yes');
    assert.equal(ops[0].extra.since, '14 Frostwane 842');
    assert.equal(ops[1].extra.trend, 'rising');
    assert.match(ops[2].fields.desc, /ferry runs \/ twice a day/, 'a pipe cannot split the line');
    const lines = ops.map(formatOp).join('\n');
    const back = parseChanges(lines);
    assert.deepEqual(back.errors, []);
    assert.deepEqual(back.ops.map(op => op.kind), ['event', 'event', 'event']);
});

test('keys stay unique, and anything that is not a bundle is refused', () => {
    const twin = { ...bundle, state: { records: [bundle.state.records[0], { ...bundle.state.records[0], id: 'wsr_9' }] } };
    assert.deepEqual(importWorldStateAlpha(twin).ops.map(op => op.key), ['The Northglass bridge is destroyed and impassable', 'The Northglass bridge is destroyed and impassable (2)']);
    assert.match(importWorldStateAlpha('not json').errors[0], /not valid JSON/);
    assert.match(importWorldStateAlpha({ format: 'other' }).errors[0], /not a World State Alpha export/);
});

test('a summary short enough to be its own key is not repeated as the description', () => {
    const short = { ...bundle, state: { records: [{ id: 'w', kind: 'fact', summary: 'The bridge is down.', status: 'active', anchors: [] }] } };
    const [op] = importWorldStateAlpha(short).ops;
    assert.equal(op.key, 'The bridge is down');
    assert.equal(op.fields.desc, undefined);
});
