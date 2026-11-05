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

test('SD alone: an offer with no deadline lapses three days after the story last spoke of it, and replays the same', async t => {
    const h = await createHost({ modules: [withD1(createModule())] });
    t.after(() => h.close());
    await h.send('Tell me about the letter.', '<Changes>\n~ time June 3, 1200, 08:00 am\n+ hook Lost letter | goal: find the letter | giver: Mara | reward: 3 gold\n</Changes>');
    const id = h.sdk.query('director.threads', { kind: 'hook' })[0].id;
    await h.send('Time passes.', '<Changes>\n! time +2d\n~ hook Lost letter | now: still wanted\n</Changes>');
    await h.send('Time passes.', '<Changes>\n! time +2d\n</Changes>');
    assert.equal(h.sdk.query('director.thread', { id }).status, 'active', 'four days from the offer, two from the mention');
    await h.send('Time passes.', '<Changes>\n! time +1d\n</Changes>');
    await h.send('And then?', 'Quiet.');
    const closed = h.sdk.query('director.thread', { id });
    assert.equal(closed.status, 'resolved');
    assert.deepEqual([closed.ended.reason, closed.ended.outcome], ['offer lapsed', 'failed']);
    assert.ok(h.head().meta.claims[`lapse:${id}`]);
    assert.ok(h.sdk.receipts().some(entry => entry.receipt.type === 'time.settle' && entry.receipt.data?.lapsed?.some(row => row.key === 'Lost letter')));
    const before = structuredClone(h.head());
    h.store.rebuild();
    assert.deepEqual(h.head(), before, 'rebuild == live');
    const again = await createHost({ modules: [withD1(createModule())] });
    t.after(() => again.close());
    await again.st.loadChat(structuredClone(h.ctx.chat));
    assert.equal(JSON.stringify(again.head().domains), JSON.stringify(h.head().domains), 'reload == live');
});

test('SD alone: an offer a line touched (read as a quest in kind) still lapses, dated at its deadline and undated by the span', async t => {
    const h = await createHost({ modules: [withD1(createModule())] });
    t.after(() => h.close());
    await h.send('Two jobs.', '<Changes>\n~ time June 3, 1200, 08:00 am\n+ hook Dated job | goal: haul | giver: Mara | reward: 3 gold | due: June 5, 1200\n+ hook Open job | goal: fetch | giver: Tam | reward: 2 gold\n</Changes>');
    await h.send('Time passes.', '<Changes>\n! time +1d\n~ hook Dated job | now: still wanted\n~ hook Open job | now: still wanted\n</Changes>');
    const byKey = key => h.sdk.query('director.threads', {}).find(thread => thread.key === key);
    assert.equal(byKey('Open job').kind, 'quest', 'a touch reads an offer as a quest in kind');
    await h.send('Time passes.', '<Changes>\n! time +2d\n</Changes>');
    await h.send('Time passes.', 'Quiet.');
    assert.equal(byKey('Dated job').status, 'resolved', 'passed its deadline (June 5 ends at midnight)');
    assert.equal(byKey('Open job').status, 'active');
    await h.send('Time passes.', '<Changes>\n! time +2d\n</Changes>');
    await h.send('Time passes.', 'Quiet.');
    assert.equal(byKey('Open job').status, 'resolved', 'three days after the touch');
    assert.deepEqual(h.turn.problems(), []);
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
