// The fold rules (tracker/fold.js): which old finished threads fold, what each record keeps, the guard and the validator.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    FOLD_AFTER, foldCandidates, foldedErrors, foldedHidden, foldedItems, foldedQuests, foldGuardInputs, foldGuardOk, foldRecord, planFold,
} from '../../../src/v2/tracker/fold.js';
import { hashJson } from '../../../src/v2/tracker/hash.js';

const id = n => `th_${String(n).padStart(8, '0')}`;

// A resolved thread: `n` is its number (id, order and, unless `rev` is given, its ending receipt).
function thread(n, kind, { outcome = 'done', rev = n, turn = 1, time = 100, track = {}, fields = {}, summary = `sum ${n}`, ...rest } = {}) {
    return {
        id: id(n), kind, key: `Thing ${n}`, summary, status: 'resolved', offer: false, taken: null,
        ended: { rev, reason: 'r', outcome }, target: null, reward: null, acceptance: null, rev: n, fields,
        track: { order: n, closed: { turn, time }, ...track }, ...rest,
    };
}

function director(threads, { n = 300, keys = {}, writes = {} } = {}) {
    const byId = Object.fromEntries(threads.map(t => [t.id, t]));
    const names = Object.fromEntries(threads.map(t => [t.key.toLowerCase(), t.id]));
    return { threads: byId, keys: { ...names, ...keys }, writes, turn: { n }, time: { minutes: null } };
}

const OPEN = { on: true, gap: false, throughMinutes: 1000, ranges: [], fullMinutes: [] };
const ids = list => list.map(t => t.id);

test('an old resolved quest folds; one closed inside FOLD_AFTER replies stays', () => {
    const old = thread(1, 'quest', { outcome: 'failed', turn: 1 });
    const young = thread(2, 'quest', { outcome: 'failed', turn: 150 });
    const d = director([old, young], { n: 1 + FOLD_AFTER });
    assert.deepEqual(ids(foldCandidates(d, { gate: OPEN, keep: 0 })), [old.id]);
});

test('the newest 20 resolved per kind are kept; events keep 30', () => {
    const quests = Array.from({ length: 25 }, (_, i) => thread(i + 1, 'quest', { outcome: 'failed' }));
    const events = Array.from({ length: 33 }, (_, i) => thread(100 + i, 'event', { outcome: 'done' }));
    const d = director([...quests, ...events]);
    const candidates = foldCandidates(d, { gate: OPEN });
    assert.deepEqual(ids(candidates.filter(t => t.kind === 'quest')), quests.slice(0, 5).map(t => t.id));
    assert.deepEqual(ids(candidates.filter(t => t.kind === 'event')), events.slice(0, 3).map(t => t.id));
});

test('the newest done quest is kept, whatever its age', () => {
    const oldDone = thread(1, 'quest', { outcome: 'done', rev: 1 });
    const failed = Array.from({ length: 21 }, (_, i) => thread(i + 2, 'quest', { outcome: 'failed', rev: i + 2 }));
    const d = director([oldDone, ...failed]);
    const candidates = ids(foldCandidates(d, { gate: OPEN }));
    assert.equal(candidates.includes(oldDone.id), false);
    assert.deepEqual(candidates, [id(2)]);
});

test('the newest arc is never folded; a closed legacy quest is never folded', () => {
    const inArc = thread(1, 'quest', { outcome: 'failed', track: { arc: 'arc_now' } });
    const legacy = thread(2, 'quest', { outcome: 'failed', owed: { text: 'x', rev: 1 } });
    const plain = thread(3, 'quest', { outcome: 'failed' });
    const d = director([inArc, legacy, plain]);
    assert.deepEqual(ids(foldCandidates(d, { gate: OPEN, arc: 'arc_now', keep: 0 })), [plain.id]);
});

test('the chronicle gate: off, a gap, a held receipt or a full digest day each keep the thread', () => {
    const t = thread(1, 'quest', { outcome: 'failed', track: { closed: { turn: 1, time: 100 } } });
    const d = director([t]);
    assert.deepEqual(foldCandidates(d, { keep: 0, gate: { ...OPEN, on: false } }), []);
    assert.deepEqual(foldCandidates(d, { keep: 0, gate: { ...OPEN, gap: true } }), []);
    assert.deepEqual(foldCandidates(d, { keep: 0, gate: { ...OPEN, ranges: [[0, 5]] } }), []);
    assert.deepEqual(foldCandidates(d, { keep: 0, gate: { ...OPEN, fullMinutes: [[0, 200]] } }), []);
    assert.deepEqual(foldCandidates(d, { keep: 0, gate: { ...OPEN, throughMinutes: 100 } }), []);
    assert.deepEqual(ids(foldCandidates(d, { gate: OPEN, keep: 0 })), [t.id]);
});

test('a thread with no closing turn is not eligible', () => {
    const t = thread(1, 'quest', { outcome: 'failed' });
    delete t.track.closed;
    assert.deepEqual(foldCandidates(director([t]), { gate: OPEN, keep: 0 }), []);
});

test('a record keeps giver and people; summary and difficulty only for scored quests', () => {
    const quest = thread(1, 'quest', { outcome: 'done', fields: { giver: 'Mara', people: 'Mara, Tom', difficulty: 'hard' } });
    const declined = thread(2, 'quest', { outcome: 'declined', fields: { giver: 'Mara', difficulty: 'hard' } });
    const q = foldRecord(quest, ['thing 1']);
    assert.equal(q.giver, 'Mara');
    assert.equal(q.people, 'Mara, Tom');
    assert.equal(q.summary, 'sum 1');
    assert.equal(q.difficulty, 'hard');
    assert.equal('hide' in q, false);
    const d = foldRecord(declined, []);
    assert.equal(d.summary, undefined);
    assert.equal(d.difficulty, undefined);
    assert.equal(d.giver, 'Mara');
});

test('a folded secret keeps its names hidden (hide, secret) and its key as a word', () => {
    const secret = thread(1, 'secret', { outcome: 'done', summary: 'hidden' });
    const newer = thread(2, 'secret', { outcome: 'done' });
    const d = director([secret, newer], { keys: { 'the vault': secret.id } });
    const plan = planFold(d, { gate: OPEN, turn: 300, keep: 1 });
    assert.deepEqual(plan.ids, [secret.id]);
    const rec = plan.items[0];
    assert.equal(rec.secret, true);
    assert.deepEqual(rec.hide, ['thing 1', 'the vault']);
    const folded = { '7': { rev: 7, items: plan.items } };
    const hidden = foldedHidden({ folded });
    assert.equal(hidden.behind.has('thing 1'), true);
    assert.equal(hidden.behind.has('the vault'), true);
    assert.deepEqual([...hidden.words].sort(), ['the vault', 'thing 1']);
});

test('planFold names the keys and writes that point at the folded threads, and caps a run', () => {
    const a = thread(1, 'quest', { outcome: 'failed' });
    const b = thread(2, 'quest', { outcome: 'failed' });
    const d = director([a, b], { writes: { wr_aaaaaaaa: { fingerprint: 'f', result: { thread: a.id } } } });
    const plan = planFold(d, { gate: OPEN, turn: 300, keep: 1 });
    assert.deepEqual(plan.ids, [a.id]);
    assert.deepEqual(plan.keys, ['thing 1']);
    assert.deepEqual(plan.writes, ['wr_aaaaaaaa']);
});

test('foldedQuests reads Ripples rows; foldedItems orders records by tracker order', () => {
    const quest = thread(2, 'quest', { outcome: 'failed', fields: { giver: 'Mara', difficulty: 'easy' } });
    const hook = thread(1, 'hook', { outcome: 'abandoned' });
    const folded = { '9': { rev: 9, items: [foldRecord(quest), foldRecord(hook)] } };
    assert.deepEqual(foldedItems({ folded }).map(item => item.id), [hook.id, quest.id]);
    const rows = foldedQuests({ folded });
    assert.equal(rows[1].outcome, 'failed');
    assert.equal(rows[1].giver, 'Mara');
    assert.equal(rows[0].outcome, 'abandoned');
});

test('the guard holds until a folded thread changes or the newest arc moves', () => {
    const t = thread(1, 'quest', { outcome: 'failed' });
    const d = director([t]);
    const inputs = foldGuardInputs(d, [t.id], 'arc_now', hashJson);
    assert.equal(foldGuardOk(d, inputs, 'arc_now', hashJson), true);
    assert.equal(foldGuardOk(d, inputs, 'arc_other', hashJson), false);
    const changed = director([{ ...t, summary: 'changed' }]);
    assert.equal(foldGuardOk(changed, inputs, 'arc_now', hashJson), false);
    assert.equal(foldGuardOk(director([]), inputs, 'arc_now', hashJson), false);
});

test('the validator accepts a well-formed bucket and refuses a bad key, a rev mismatch or an oversized bucket', () => {
    const t = thread(1, 'quest', { outcome: 'failed' });
    const [item] = [foldRecord(t)];
    assert.deepEqual(foldedErrors({ folded: { '5': { rev: 5, items: [item] } } }), []);
    assert.deepEqual(foldedErrors({}), []);
    assert.equal(foldedErrors({ folded: { x: { rev: 5, items: [] } } }).length, 1);
    assert.equal(foldedErrors({ folded: { '5': { rev: 6, items: [] } } }).length, 1);
    const big = Array.from({ length: 121 }, () => item);
    assert.equal(foldedErrors({ folded: { '5': { rev: 5, items: big } } }).length, 1);
    assert.equal(foldedErrors({ folded: { '5': { rev: 5, items: [{ ...item, extra: 1 }] } } }).length, 1);
});
