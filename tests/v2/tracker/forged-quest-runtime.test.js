// P23: SD capture, the reader UI and a third module cannot supply an RPG extension.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../vendor/story-block/testkit/host.js';
import { createModule } from '../../../src/v2/module.js';
import { withD1 } from '../helpers/d1.js';

test('forged quest extensions refuse from UI, capture and a third module', async t => {
    const id = 'th_00000001';
    let writer;
    let payload;
    const sd = createModule();
    sd.capture = { ...sd.capture, kinds: { ...sd.capture.kinds, forgery: { grammar: '+ forgery Name' } },
        apply: ((original) => (ctx, line) => line.kind === 'forgery' ? ctx.call(writer, payload) : original(ctx, line))(sd.capture.apply) };
    const third = { id: 'third', version: '1.0.0', commands: { 'third.forge': ctx => ctx.call(writer, payload) } };
    const h = await createHost({ modules: [withD1(sd), third] });
    t.after(() => h.close());
    await h.send('Tell me about the mill.', 'The mill needs help.');
    const base = { write: 'wr_00000001', thread: id, kind: 'hook', key: 'Mill job', summary: '', fields: {}, expectedHash: null };
    for (writer of ['threads.offer', 'threads.accept']) {
        if (writer === 'threads.accept') assert.equal((await h.sdk.command('threads.offer', base)).ok, true);
        payload = writer === 'threads.offer' ? { ...base, quest: {} } : { write: 'wr_00000002', thread: id,
            expectedHash: h.sdk.query('threads.hash', { thread: id }), quest: {} };
        const before = h.sdk.query('director.thread', { id });
        const writes = structuredClone(h.head().domains.director.writes);
        assert.equal((await h.sdk.command(writer, payload)).code, 'INVALID');
        assert.equal((await h.sdk.command('third.forge')).code, 'INVALID');
        await h.send('I will help the miller.', '<Changes>\n+ forgery Mill job\n</Changes>');
        assert.deepEqual(h.sdk.query('director.thread', { id }), before);
        assert.deepEqual(h.head().domains.director.writes, writes);
        assert.equal(h.sdk.query('story.evidence').length, 0);
        assert.equal(h.sdk.query('inventory.wallet').coin ?? 0, 0);
    }
});

test('old ready/owed quest cannot trigger beforeGenerate, afterCapture or direct retired payout', async t => {
    const sd = withD1(createModule());
    const initial = sd.domains.director.initial;
    const old = { id: 'th_00000001', kind: 'quest', key: 'Old job', summary: '', fields: { reward: '50 gold' },
        status: 'active', offer: false, taken: { rev: 0 }, ready: { rev: 0 }, ended: null, target: null, reward: null,
        rev: 0, owed: { text: '50 gold', rev: 0 } };
    sd.domains.director = { ...sd.domains.director, initial: () => ({ ...initial(), threads: { [old.id]: structuredClone(old) }, keys: { 'old job': old.id } }) };
    const h = await createHost({ modules: [sd] });
    t.after(() => h.close());
    for (let n = 0; n < 2; n++) {
        await h.send('Settle the old job.', '<Changes>\n~ time June 3, 1200, 08:00 am\n+ quest Old job | reward: 50 gold | met: yes\n- quest Old job — done\n</Changes>');
        for (const type of ['quest.payOwed', 'quest.settle', 'quest.finish']) assert.equal(h.bus.command(type, { id: old.id }, { cause: 'system' }).code, 'UNKNOWN_COMMAND');
        assert.equal(h.sdk.query('inventory.wallet').coin ?? 0, 0);
        assert.deepEqual(h.sdk.query('director.thread', { id: old.id }), old);
        assert.equal(h.sdk.query('story.evidence').length, 0);
    }
});
