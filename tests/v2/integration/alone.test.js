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

test('SD alone follows a story-told quest through progress, completion and replay', async t => {
    const h = await createHost({ modules: [withD1(createModule())] });
    t.after(() => h.close());
    await h.send('I will help.', '<Changes>\n+ quest Lost ring — Find the ring | goal: find the ring | giver: Mara\n</Changes>');
    const quest = h.sdk.query('director.threads', { kind: 'quest' })[0];
    assert.ok(quest);
    assert.equal(h.sdk.query('director.goal').key, 'Lost ring');
    assert.deepEqual(h.sdk.query('quest.board').active.map(row => row.key), ['Lost ring']);
    await h.send('I search.', '<Changes>\n~ quest Lost ring | step: found a clue\n</Changes>');
    assert.equal(h.sdk.query('director.thread', { id: quest.id }).fields.step, 'found a clue');
    await h.send('I return it.', '<Changes>\n- quest Lost ring — returned to Mara\n</Changes>');
    assert.equal(h.sdk.query('director.thread', { id: quest.id }).status, 'resolved');
    assert.equal(h.sdk.query('director.goal'), null);
    assert.equal(h.head().domains.inventory.wallets.party?.coin ?? 0, 0);
    assert.deepEqual(h.turn.problems(), []);
    const before = structuredClone(h.head());
    h.store.rebuild();
    assert.deepEqual(h.head(), before);
});
