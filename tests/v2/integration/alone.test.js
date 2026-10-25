// SB+SD keeps neutral goals and the journal without a party or an RPG command owner.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../vendor/story-block/testkit/host.js';
import { createModule } from '../../../src/v2/module.js';
import { withD1 } from '../helpers/d1.js';
test('SD alone keeps generic threads, the story clock and the journal', async t => {
    const h = await createHost({ modules: [withD1(createModule())] });
    t.after(() => h.close());
    await h.send('Tell me about the letter.', '<Changes>\n~ time June 3, 1200, 08:00 am\n+ hook Lost letter | goal: find the letter\n</Changes>');
    const thread = h.sdk.query('director.threads', { kind: 'hook' })[0];
    assert.equal(thread.offer, true);
    await h.send('I will take the lost letter job.', '<Changes>\n~ hook Lost letter | progress: searching\n</Changes>');
    assert.ok(h.sdk.query('director.thread', { id: thread.id }).acceptance);
    await h.send('The letter is delivered.', '<Changes>\n- hook Lost letter — done\n</Changes>');
    assert.equal(h.sdk.query('director.thread', { id: thread.id }).status, 'resolved');
    assert.ok(Number.isSafeInteger(h.sdk.query('director.time').minutes));
    assert.ok(h.head().domains.chronicle);
    assert.equal(h.head().domains.party, undefined);
    assert.equal(h.head().domains.inventory.wallets.party?.coin ?? 0, 0);
});
