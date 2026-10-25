// P23 runs on the real host: ownership, atomic retry, intent evidence and standalone goals.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../vendor/story-block/testkit/host.js';
import { createModule } from '../../../src/v2/module.js';
import { withD1 } from '../helpers/d1.js';
import { initialDirector, validateDirector } from '../../../src/v2/tracker/domain.js';

const id = 'th_00000001';
const offer = (write = 'wr_00000001', more = {}) => ({ write, thread: id, kind: 'hook', key: 'The mill', summary: 'Help the miller', fields: { goal: 'Talk to the miller' }, expectedHash: null, ...more });
async function setup(t) {
    const host = await createHost({ modules: [withD1(createModule())] });
    t.after(() => host.close());
    await host.send('Tell me about the mill.', 'There is a job at the mill.');
    return host;
}
const command = (host, type, payload) => host.sdk.command(type, payload);
const hash = host => host.sdk.query('threads.hash', { thread: id });

test('director initializes and validates the retry ledger; hashes exclude only private track', () => {
    const state = initialDirector();
    assert.deepEqual(state.writes, {});
    assert.deepEqual(validateDirector(state), []);
    state.writes.bad = { fingerprint: 'x', result: {} };
    assert.match(validateDirector(state).join(), /writes/);
});

test('registered offer/accept retry returns saved results before stale checks; changed meaning conflicts', async t => {
    const h = await setup(t);
    assert.equal((await command(h, 'threads.offer', offer())).ok, true);
    const payload = { write: 'wr_00000002', thread: id, expectedHash: hash(h) };
    const a = await command(h, 'threads.accept', payload);
    assert.equal(a.ok, true, a.message);
    assert.equal(a.receipt.data.linked, false);
    const accepted = h.sdk.query('director.thread', { id });
    assert.equal(accepted.offer, false);
    assert.ok(accepted.acceptance.proof);
    assert.equal(h.sdk.query('story.evidence', { ids: [accepted.acceptance.proof] }).length, 1);
    const retry = await command(h, 'threads.accept', payload);
    const { v2: _metadata, ...saved } = a.receipt.data;
    assert.deepEqual(retry.receipt.data, saved);
    assert.equal((await command(h, 'threads.accept', { ...payload, expectedHash: hash(h) })).code, 'CONFLICT');
    assert.equal((await command(h, 'threads.accept', { ...payload, write: 'wr_00000003' })).code, 'STALE');
});

test('all writers refuse foreign extensions; invalid, limited and stale failures leave no ledger writes', async t => {
    const h = await setup(t);
    assert.equal((await command(h, 'threads.offer', offer('wr_00000001', { quest: {} }))).code, 'REFUSED');
    assert.equal((await command(h, 'threads.offer', offer('wr_00000001', { fields: { reward: '50' } }))).code, 'INVALID');
    assert.equal((await command(h, 'threads.offer', offer())).ok, true);
    assert.equal((await command(h, 'threads.offer', offer('wr_00000002'))).code, 'CONFLICT');
    for (const type of ['threads.link', 'threads.questWrite', 'threads.close']) assert.equal((await command(h, type, {})).code, 'REFUSED');
    assert.equal((await command(h, 'threads.accept', { write: 'wr_00000002', thread: 'th_00000002', expectedHash: hash(h) })).code, 'NOT_FOUND');
    assert.equal(Object.keys(h.head().domains.director.writes).length, 1);
});

for (const words of ["Yes, I'll help, no problem.", 'I will not take the mill job.']) {
    test(`neutral validated reader intent: ${words}`, async t => {
        const h = await setup(t);
        assert.equal((await command(h, 'threads.offer', offer())).ok, true);
        await h.send(words, '<Changes>\n~ hook The mill | progress: listening\n</Changes>');
        const thread = h.sdk.query('director.thread', { id });
        assert.equal(!!thread.acceptance, words.startsWith('Yes'), JSON.stringify(h.store.problems()));
        assert.equal(thread.rpg, undefined);
        assert.equal(thread.reward, null);
    });
}

test('retired quest registration and every automatic payout path pay nothing', async t => {
    const h = await setup(t);
    for (const type of ['quest.take', 'quest.finish', 'quest.payOwed', 'quest.settle']) {
        const result = await command(h, type, { id });
        assert.equal(result.code, 'UNKNOWN_COMMAND', type);
    }
    assert.equal(h.registry.getModule?.('story-director')?.capture?.kinds?.quest, undefined);
    await h.send('Continue.', '<Changes>\n+ quest Old reward | reward: 100 | target: 1 wolf | met: yes\n- quest Old reward — done\n</Changes>');
    assert.equal(h.head().domains.inventory.wallets.party?.coin ?? 0, 0);
    assert.ok(!Object.keys(h.head().domains.director.threads).length);
    assert.ok(h.store.receipts().every(r => !['quest.settle', 'quest.payOwed'].includes(r.type)));
});

test('C15 standalone offer, reader acceptance, generic progress and closure use no RPG lookups', async t => {
    const h = await setup(t);
    await command(h, 'threads.offer', offer());
    await h.send('I will help the miller.', '<Changes>\n~ hook The mill | progress: heard the plan\n</Changes>');
    const accepted = h.sdk.query('director.thread', { id });
    assert.ok(accepted.acceptance);
    await h.send('We have finished talking.', '<Changes>\n- hook The mill — done\n</Changes>');
    const done = h.sdk.query('director.thread', { id });
    assert.equal(done.status, 'resolved');
    assert.equal(done.kind, 'hook');
    assert.deepEqual(done.acceptance, accepted.acceptance);
    assert.equal(done.rpg, undefined);
    assert.equal(done.target, null);
    assert.equal(done.reward, null);
    assert.equal(done.owed, undefined);
    assert.equal(h.head().domains.inventory.wallets.party?.coin ?? 0, 0);
});

test('offer limit is LIMITED and leaves its write id free for a valid retry', async t => {
    const def = withD1(createModule());
    const initial = initialDirector();
    for (let n = 0; n < 300; n++) {
        const key = `Goal ${n}`;
        const id = `th_${n.toString(36).padStart(8, '0')}`;
        initial.threads[id] = { id, kind: 'hook', key, summary: '', fields: {}, status: 'active', offer: true,
            taken: null, ended: null, target: null, reward: null, acceptance: null, rev: 0 };
        initial.keys[key.toLowerCase()] = id;
    }
    def.domains.director = { ...def.domains.director, initial: () => structuredClone(initial) };
    const h = await createHost({ modules: [def] });
    t.after(() => h.close());
    await h.send('Hello.', 'Hello.');
    const result = await command(h, 'threads.offer', offer('wr_00000001', { thread: 'th_99999999' }));
    assert.equal(result.code, 'LIMITED');
    assert.equal(h.head().domains.director.writes.wr_00000001, undefined);
});
