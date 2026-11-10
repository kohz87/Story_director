// The arc counts a beat the story fired with `!` as played (read from the quest log; nothing stored), like a resolved one.
import test from 'node:test';
import assert from 'node:assert/strict';

import { arcQuery, threadsWithArc } from '../../../src/v2/arc/domain.js';
import { arcBeats, autoPlanReason } from '../../../src/v2/arc/plan.js';

const KEYS = ['Red-Cord Demand', 'Salt Impound', 'Ledger Check', 'Harbour Bell'];
const build = (statuses = {}) => {
    const threads = {};
    KEYS.forEach((key, i) => { threads[`t${i}`] = { id: `t${i}`, kind: 'beat', key, summary: '', status: statuses[i] ?? 'active', fields: {}, track: { order: i, arc: 'arc_a' } }; });
    return {
        domains: {
            director: { threads },
            arc: { arcs: { arc_a: { id: 'arc_a', rev: 1, key: 'The Demand', desc: '' } }, ends: {} },
            chronicle: { questLog: {} },
        },
    };
};
const log = (state, ...entries) => { entries.forEach(([rev, i, text]) => { state.domains.chronicle.questLog[String(rev)] = { thread: `t${i}`, text }; }); return state; };
const beatsOf = state => arcBeats(threadsWithArc(state.domains.director, state), 'arc_a');

test('the owner\'s shape: 4 beats, 3 fired with "!", reads 3 of 4 played', () => {
    const state = log(build(), [1, 0, '! beat Red-Cord Demand — it came'], [2, 1, '! beat Salt Impound — done'], [3, 2, '! beat Ledger Check — done']);
    const { done, total, active } = beatsOf(state);
    assert.deepEqual([done, total, active.length], [3, 4, 1]);
    assert.deepEqual(arcQuery(state).current.beats, { done: 3, total: 4 });
    assert.equal(state.domains.director.threads.t0.status, 'active', 'nothing stored or closed');
});

test('every beat fired or resolved: the arc ends by itself (arc-end)', () => {
    const state = log(build({ 3: 'resolved' }), [1, 0, '! beat Red-Cord Demand — it came'], [2, 1, '! beat Salt Impound'], [3, 2, '! beat Ledger Check']);
    assert.deepEqual(arcQuery(state).current.beats, { done: 4, total: 4 });
    const threads = threadsWithArc(state.domains.director, state);
    assert.equal(autoPlanReason({ threads, arc: { id: 'arc_a', active: true } }), 'arc-end');
});

test('a fired beat is not a stalled or open one', () => {
    const state = log(build({ 1: 'resolved', 2: 'resolved', 3: 'resolved' }), [1, 0, '! beat Red-Cord Demand']);
    const threads = threadsWithArc(state.domains.director, state);
    assert.equal(autoPlanReason({ threads, arc: { id: 'arc_a', active: true } }), 'arc-end');
});

test('a beat dated again after firing counts as not played again', () => {
    const state = log(build(), [1, 0, '! beat Red-Cord Demand'], [2, 0, '~ beat Red-Cord Demand — on: March 9, 2026']);
    assert.deepEqual([beatsOf(state).done, beatsOf(state).active.length], [0, 4]);
    log(state, [3, 0, '! beat Red-Cord Demand']);
    assert.equal(beatsOf(state).done, 1, 'fired again: played again');
});

test('a resolved beat still counts, with or without a log; no state means no fired', () => {
    const state = build({ 0: 'resolved' });
    assert.equal(beatsOf(state).done, 1);
    assert.equal(arcBeats(threadsWithArc(state.domains.director), 'arc_a').done, 1);
    assert.equal(arcBeats(threadsWithArc(log(build(), [1, 0, '! beat x']).domains.director), 'arc_a').done, 0);
});
