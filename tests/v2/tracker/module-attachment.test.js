import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../vendor/story-block/testkit/host.js';
import { createModule } from '../../../src/v2/module.js';
const thread = 'th_00000001';
const quest = { id: thread, template: 'pack.fixture/hunt', instance: 1, title: 'Hunt', category: 'bounty', giver: null, turnInPlace: null,
    requirements: [], objectives: [{ id: 'ob_00000001', kind: 'kill', foe: 'pack.fixture/wolf~ash-wolf', count: 1, allowVariants: true }],
    evidence: {}, reward: { coin: 20, xp: 20, items: [] }, storyCredit: { coin: 0, claims: [] }, acceptedAt: null, acceptedCursor: null,
    deadline: null, repeat: null, chain: null, state: 'offered', settlement: null };
const rpg = { id: 'rpg-battle', version: '2.0.0', commands: { 'test.attach'(ctx, { more = {} } = {}) {
    return ctx.call('threads.link', { write: ctx.id('wr'), thread, quest: { ...structuredClone(quest), ...more }, expectedHash: ctx.query('threads.hash', { thread }) });
} } };
async function setup(t) {
    const h = await createHost({ modules: [createModule(), rpg] }); t.after(() => h.close());
    await h.send('A job.', 'The miller asks for help.');
    const out = await h.sdk.command('threads.offer', { write: 'wr_00000001', thread, kind: 'hook', key: 'Hunt', summary: 'A neutral goal', fields: {}, expectedHash: null });
    assert.equal(out.ok, true, JSON.stringify(out)); return h;
}
test('the owning module can attach an offered extension without accepting the neutral thread; replay preserves transport', async t => {
    const h = await setup(t); const out = await h.sdk.command('test.attach'); assert.equal(out.ok, true, JSON.stringify(out));
    const check = () => { const goal = h.sdk.query('director.thread', { id: thread }); assert.equal(goal.offer, true); assert.equal(goal.acceptance, null); assert.equal(goal.taken, null); assert.deepEqual(goal.rpg, quest); assert.deepEqual(h.store.problems(), []); };
    check(); await h.st.loadChat(structuredClone(h.ctx.chat)); check(); h.store.rebuild(); check();
});
for (const more of [{ state: 'active' }, { acceptedAt: 5 }, { deadline: 20 }, { evidence: { pf_00000001: { objective: 'ob_00000001', proof: 'pf_00000001', amount: 1 } } }]) test(`an offered attachment cannot forge acceptance, deadline or objective evidence: ${JSON.stringify(more)}`, async t => {
    const h = await setup(t); const before = structuredClone(h.head()); const out = await h.sdk.command('test.attach', { more });
    assert.equal(out.ok, false); assert.ok(out.message); assert.deepEqual(h.head(), before);
});
