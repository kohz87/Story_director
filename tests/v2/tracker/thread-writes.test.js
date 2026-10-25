// P23 retry and neutral intent fixtures use production helpers and the host's canonical hash.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hashJson } from '../../vendor/story-block/src/v2/replay.js';
import { neutralAcceptance, prepareThreadWrite, threadProjection, threadWriteEntry } from '../../../src/v2/tracker/thread-writes.js';

const thread = () => ({ id: 'th_00000001', kind: 'hook', key: 'The mill', summary: 'Help the miller',
    fields: { goal: 'Talk to the miller' }, status: 'active', offer: true, taken: null,
    ended: null, target: null, reward: null, acceptance: null, rev: 1, track: { order: 1 } });

test('same write returns its saved result before stale checks; changed meaning conflicts', () => {
    const current = thread();
    const director = { threads: { [current.id]: current }, writes: {} };
    const payload = { write: 'wr_00000001', thread: current.id, expectedHash: hashJson(threadProjection(current)) };
    const prepared = prepareThreadWrite(director, 'threads.accept', payload, hashJson);
    assert.equal(prepared.ok, true);
    const result = { thread: current.id, hash: 'a'.repeat(64), accepted: true, linked: false };
    director.writes[payload.write] = threadWriteEntry(prepared, result);
    current.rev++;
    assert.deepEqual(prepareThreadWrite(director, 'threads.accept', payload, hashJson), { ok: true, retry: true, result });
    assert.equal(prepareThreadWrite(director, 'threads.accept', { ...payload, acceptance: 'pf_00000002' }, hashJson).code, 'CONFLICT');
});

test('hash excludes only private track, including rpg/rev and preserving array order', () => {
    const current = thread();
    const before = hashJson(threadProjection(current));
    current.track.order++;
    assert.equal(hashJson(threadProjection(current)), before);
    current.rpg = { objectives: ['a', 'b'] };
    const rpg = hashJson(threadProjection(current));
    assert.notEqual(rpg, before);
    current.rpg.objectives.reverse();
    assert.notEqual(hashJson(threadProjection(current)), rpg);
});

test('fresh unknown/stale writes refuse without altering the ledger or thread', () => {
    const current = thread();
    const director = { threads: { [current.id]: current }, writes: {} };
    const before = structuredClone(director);
    assert.equal(prepareThreadWrite(director, 'threads.link', { write: 'wr_00000001', thread: current.id, expectedHash: '0'.repeat(64) }, hashJson).code, 'STALE');
    assert.equal(prepareThreadWrite(director, 'threads.link', { write: 'wr_00000002', thread: 'th_00000002', expectedHash: '0'.repeat(64) }, hashJson).code, 'NOT_FOUND');
    assert.deepEqual(director, before);
});

function proof(words) {
    return { id: 'pf_00000001', owner: 'story-director', kind: 'acceptance', payload: { thread: 'th_00000001', words }, parents: [] };
}

test('standalone hook acceptance checks only active reader proof and neutral intent', () => {
    const accepted = proof('I will help the miller.');
    assert.equal(neutralAcceptance(thread(), [accepted], accepted.id, { cause: 'story' }).ok, true);
    assert.equal(neutralAcceptance(thread(), [], accepted.id, { cause: 'story' }).code, 'REFUSED');
    assert.equal(neutralAcceptance(thread(), [{ ...accepted, owner: 'rpg-battle' }], accepted.id, { cause: 'story' }).code, 'REFUSED');
    assert.equal(neutralAcceptance({ ...thread(), id: 'th_00000002' }, [accepted], accepted.id, { cause: 'story' }).code, 'REFUSED');
});

test('a refusal sentence cannot accept even when it quotes acceptance words', () => {
    for (const words of ['No thanks, I refuse the mill job.', 'I will not take the mill job.', 'I never accept the mill job.', 'I accept nothing from the miller.']) {
        const given = proof(words);
        assert.equal(neutralAcceptance(thread(), [given], given.id, { cause: 'story' }).code, 'REFUSED', words);
    }
});

test('selection proof requires the reader action; narration cannot manufacture a selection', () => {
    const selected = proof('unused');
    selected.payload = { thread: thread().id, selection: 'Take the mill job' };
    assert.equal(neutralAcceptance(thread(), [selected], selected.id, { cause: 'ui' }).ok, true);
    assert.equal(neutralAcceptance(thread(), [selected], selected.id, { cause: 'story' }).code, 'REFUSED');
    assert.equal(neutralAcceptance(thread(), [selected], selected.id, { cause: 'ui', caller: 'third-module' }).code, 'REFUSED');
});

for (const [words, accepts] of [
    ["Yes, I'll help, no problem", true],
    ["I can't wait to take the mill job", true],
    ["I would not hesitate to take it", true],
    ["I'm not sure I can take the mill job", false],
    ["No, I won't take it", false],
]) test(`neutral intent scopes negation: ${words}`, () => {
    const given = proof(words);
    assert.equal(neutralAcceptance(thread(), [given], given.id, { cause: 'story' }).ok, accepts);
});
