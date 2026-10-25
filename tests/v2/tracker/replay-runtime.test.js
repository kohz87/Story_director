// The production neutral writers retain reader acceptance through unchanged prefix Re-reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../vendor/story-block/testkit/host.js';
import { createModule } from '../../../src/v2/module.js';

const ok = out => assert.equal(out.ok, true, JSON.stringify(out));

for (const acceptedBy of ['ui', 'reader']) test(`standalone ${acceptedBy} acceptance survives offer Re-read, reload and rebuild`, async t => {
    const h = await createHost({ modules: [createModule()] });
    t.after(() => h.close());
    await h.send('What needs doing?', '<Changes>\n+ hook The mill — Help the miller | goal: Talk to the miller\n</Changes>');
    const offerIndex = h.ctx.chat.length - 1;
    const thread = h.sdk.query('director.threads', { kind: 'hook' })[0];
    if (acceptedBy === 'reader') await h.send('I will help the miller.', '<Changes>\n~ hook The mill | progress: listening\n</Changes>');
    else {
        await h.send('Tell me the plan.', 'The miller explains.');
        ok(await h.sdk.command('threads.accept', { write: 'wr_00000001', thread: thread.id,
            expectedHash: h.sdk.query('threads.hash', { thread: thread.id }) }));
    }
    const acceptance = h.sdk.query('director.thread', { id: thread.id }).acceptance;
    assert.ok(acceptance);
    // Change only the number of neutral capture commands before the offer, not the offer's meaning.
    await h.st.editMessage(offerIndex, '<Changes>\n+ beat The bell — The bell rings\n+ hook The mill — Help the miller | goal: Talk to the miller\n</Changes>');
    ok(await h.turn.reread(offerIndex));
    const verify = host => {
        const current = host.sdk.query('director.thread', { id: thread.id });
        assert.equal(current.offer, false, JSON.stringify(host.store.problems()));
        assert.equal(current.acceptance.proof, acceptance.proof);
        assert.equal(host.sdk.query('story.evidence', { ids: [acceptance.proof] }).length, 1);
        assert.equal(current.rpg, undefined);
        assert.equal(current.reward, null);
        assert.deepEqual(host.store.problems(), []);
    };
    verify(h);
    const loaded = await createHost({ modules: [createModule()], st: {
        chat: structuredClone(h.ctx.chat), extensionSettings: structuredClone(h.ctx.extensionSettings),
    } });
    t.after(() => loaded.close());
    loaded.store.rebuild();
    verify(loaded);
    await loaded.send('We have finished talking.', '<Changes>\n- hook The mill — done\n</Changes>');
    assert.equal(loaded.sdk.query('director.thread', { id: thread.id }).status, 'resolved');
    assert.equal(loaded.head().domains.inventory.wallets.party?.coin ?? 0, 0);
});

test('a changed neutral offer retracts its dependent reader acceptance and proof', async t => {
    const h = await createHost({ modules: [createModule()] });
    t.after(() => h.close());
    await h.send('What needs doing?', '<Changes>\n+ hook The mill — Help the miller | goal: Talk to the miller\n</Changes>');
    const offerIndex = h.ctx.chat.length - 1;
    const thread = h.sdk.query('director.threads', { kind: 'hook' })[0];
    await h.send('Tell me the plan.', 'The miller explains.');
    ok(await h.sdk.command('threads.accept', { write: 'wr_00000001', thread: thread.id,
        expectedHash: h.sdk.query('threads.hash', { thread: thread.id }) }));
    const proof = h.sdk.query('director.thread', { id: thread.id }).acceptance.proof;
    await h.st.editMessage(offerIndex, '<Changes>\n+ hook The mill — Help the miller | goal: Repair the entire mill\n</Changes>');
    ok(await h.turn.reread(offerIndex));
    assert.equal(h.sdk.query('director.thread', { key: thread.key }).offer, true);
    assert.deepEqual(h.sdk.query('story.evidence', { ids: [proof] }), []);
    assert.ok(h.store.problems().some(problem => problem.code === 'REPLAY_PREREQUISITE'));
});
