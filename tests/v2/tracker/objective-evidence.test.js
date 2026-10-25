// B3 on the real host: objective evidence is append-only and each row stands on one surviving proof bound to this thread, instance and objective.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../vendor/story-block/testkit/host.js';
import { createModule } from '../../../src/v2/module.js';
import { withD1 } from '../helpers/d1.js';

const id = 'th_00000001';
const other = 'th_00000002';
const quest = (thread, more = {}) => ({ id: thread, template: 'pack.fixture/job', instance: 1, title: 'Mill job', category: 'side', giver: null, turnInPlace: null,
    requirements: [], objectives: [{ id: 'ob_00000001', kind: 'story', text: 'Greet the miller' }, { id: 'ob_00000002', kind: 'story', text: 'Weigh the grain' }],
    evidence: {}, reward: { coin: 3, xp: 2, items: [] }, storyCredit: { coin: 0, claims: [] }, acceptedAt: null, acceptedCursor: null, deadline: null,
    repeat: null, chain: null, state: 'active', settlement: null, ...more });
// A stand-in for the one module allowed to write quest extensions: it links, proves and writes, as RPG Battle's adapters do.
const rpg = {
    id: 'rpg-battle', name: 'RPG Battle (test)', version: '0.0.0-test',
    commands: {
        'rbtest.link'(ctx, { thread, evidence = {} }) {
            const t = ctx.query('director.thread', { id: thread });
            const q = quest(thread, { acceptedAt: t.acceptance.minute, acceptedCursor: t.acceptance.cursor, evidence });
            return ctx.call('threads.link', { write: ctx.id('wr'), thread, quest: q, expectedHash: ctx.query('threads.hash', { thread }) });
        },
        'rbtest.proof'(ctx, payload) { return { summary: 'Proof.', narrate: false, data: { proof: ctx.proof({ kind: 'story', payload }).id } }; },
        'rbtest.write'(ctx, { thread, evidence, state, settlement }) {
            const t = ctx.query('director.thread', { id: thread });
            const q = { ...structuredClone(t.rpg), evidence, ...(state ? { state } : {}), ...(settlement !== undefined ? { settlement } : {}) };
            return ctx.call('threads.questWrite', { write: ctx.id('wr'), thread, quest: q, expectedHash: ctx.query('threads.hash', { thread }) });
        },
        'rbtest.both'(ctx, { thread, payload, objective }) {
            const proof = ctx.proof({ kind: 'story', payload }).id;
            const t = ctx.query('director.thread', { id: thread });
            return ctx.call('threads.questWrite', { write: ctx.id('wr'), thread, quest: { ...structuredClone(t.rpg), evidence: { ...t.rpg.evidence, [proof]: { objective, proof, amount: 1 } } },
                expectedHash: ctx.query('threads.hash', { thread }) });
        },
    },
};
const bind = (thread, objective, more = {}) => ({ thread, instance: 1, objective, note: 'a line', ...more });
const row = (objective, proof) => ({ objective, proof, amount: 1 });

async function setup(t) {
    const host = await createHost({ modules: [withD1(createModule()), withD1(rpg)] });
    t.after(() => host.close());
    await host.send('Tell me about the mill.', 'There is a job at the mill.');
    for (const [thread, n] of [[id, 1], [other, 3]]) {
        const key = thread === id ? 'The mill' : 'The cellar';
        assert.equal((await host.sdk.command('threads.offer', { write: `wr_0000000${n}`, thread, kind: 'hook', key, summary: 'Work', fields: {}, expectedHash: null })).ok, true);
        assert.equal((await host.sdk.command('threads.accept', { write: `wr_0000000${n + 1}`, thread, expectedHash: host.sdk.query('threads.hash', { thread }) })).ok, true);
        assert.equal((await host.sdk.command('rbtest.link', { thread })).ok, true, thread);
    }
    const prove = async payload => (await host.sdk.command('rbtest.proof', payload)).receipt.data.proof;
    const write = (thread, evidence, extra = {}) => host.sdk.command('rbtest.write', { thread, evidence, ...extra });
    const refused = async (promise, code, message) => {
        const before = structuredClone(host.head());
        const out = await promise;
        assert.equal(out.code, code, JSON.stringify(out));
        if (message) assert.match(out.message, message);
        assert.deepEqual(host.head(), before, 'a refused write changes nothing');
    };
    return { host, prove, write, refused };
}

test('evidence is added only on a surviving proof bound to this thread, instance and objective', async t => {
    const { host, prove, write, refused } = await setup(t);
    const good = await prove(bind(id, 'ob_00000001'));
    await refused(write(id, { pf_00000000: row('ob_00000001', 'pf_00000000') }), 'NOT_FOUND');
    await refused(write(id, { [good]: row('ob_00000002', good) }), 'REFUSED', /another objective/);
    await refused(write(other, { [good]: row('ob_00000001', good) }), 'REFUSED', /another thread/);
    const wrongInstance = await prove(bind(id, 'ob_00000002', { instance: 2 }));
    await refused(write(id, { [wrongInstance]: row('ob_00000002', wrongInstance) }), 'REFUSED', /another instance/);
    assert.equal((await write(id, { [good]: row('ob_00000001', good) })).ok, true);
    assert.deepEqual(host.sdk.query('director.thread', { id }).rpg.evidence, { [good]: row('ob_00000001', good) });
});

test('a proof counts once in the whole story; stored rows are never changed or removed; no evidence rides with a terminal write or a new link', async t => {
    const { host, prove, write, refused } = await setup(t);
    const good = await prove(bind(id, 'ob_00000001'));
    const second = await prove(bind(id, 'ob_00000002'));
    assert.equal((await write(id, { [good]: row('ob_00000001', good) })).ok, true);
    // The same proof under a second key, in this quest or the other thread's.
    await refused(write(id, { [good]: row('ob_00000001', good), pf_0000000a: row('ob_00000002', good) }), 'CLAIMED');
    await refused(write(other, { pf_0000000b: row('ob_00000001', good) }), 'CLAIMED');
    // Stored rows stay as they are.
    await refused(write(id, {}), 'REFUSED', /cannot be changed or removed/);
    await refused(write(id, { [good]: { ...row('ob_00000001', good), amount: 2 } }), 'REFUSED', /cannot be changed or removed/);
    await refused(write(id, { [good]: row('ob_00000001', good), [second]: row('ob_00000002', second) }, { state: 'done', settlement: {
        id: 'st_00000001', source: host.store.sourceAt?.(0) ?? { sid: 'sr_00000001', swipeKey: 'sw_00000001', evidence: 'ev_00000001', ordinal: 0 }, outcome: 'done', coinPaid: 0, xpPaid: 0, itemsPaid: [], claim: 'rb:ep_00000000:quest:th_00000001:1:settled' } }), 'REFUSED', /only to an active quest/);
    // A new link starts without evidence.
    assert.equal(host.sdk.query('director.thread', { id }).rpg.evidence[good].proof, good);
});

test('a proof given in the same root counts: the pending proof is visible to the writer, and a rolled-back root keeps nothing', async t => {
    const { host } = await setup(t);
    const before = structuredClone(host.head());
    const bad = await host.sdk.command('rbtest.both', { thread: id, payload: bind(other, 'ob_00000001'), objective: 'ob_00000001' });
    assert.equal(bad.code, 'REFUSED');
    assert.deepEqual(host.head(), before, 'the proof of a rolled-back root is not published');
    const out = await host.sdk.command('rbtest.both', { thread: id, payload: bind(id, 'ob_00000001'), objective: 'ob_00000001' });
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.equal(Object.keys(host.sdk.query('director.thread', { id }).rpg.evidence).length, 1);
    // A second click is a second proof with its own id: it is another row, never the first one counted twice.
    const again = await host.sdk.command('rbtest.both', { thread: id, payload: bind(id, 'ob_00000001'), objective: 'ob_00000001' });
    assert.equal(again.ok, true, JSON.stringify(again));
    assert.equal(Object.keys(host.sdk.query('director.thread', { id }).rpg.evidence).length, 2);
    assert.deepEqual(host.store.problems(), []);
});

test('a quest is linked without objective evidence', async t => {
    const host = await createHost({ modules: [withD1(createModule()), withD1(rpg)] });
    t.after(() => host.close());
    await host.send('Tell me about the mill.', 'There is a job at the mill.');
    assert.equal((await host.sdk.command('threads.offer', { write: 'wr_00000001', thread: id, kind: 'hook', key: 'The mill', summary: 'Work', fields: {}, expectedHash: null })).ok, true);
    assert.equal((await host.sdk.command('threads.accept', { write: 'wr_00000002', thread: id, expectedHash: host.sdk.query('threads.hash', { thread: id }) })).ok, true);
    const before = structuredClone(host.head());
    const out = await host.sdk.command('rbtest.link', { thread: id, evidence: { pf_00000001: row('ob_00000001', 'pf_00000001') } });
    assert.equal(out.code, 'REFUSED', JSON.stringify(out));
    assert.deepEqual(host.head(), before);
});
