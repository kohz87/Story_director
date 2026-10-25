// Real SD + SB evidence/ledger component tests. These do not claim full P23 writer integration.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hashJson } from '../../vendor/story-block/src/v2/replay.js';
import { neutralAcceptance, threadProjection } from '../../../src/v2/tracker/thread-writes.js';
import { createSdHost, seedNeutralHook, acceptanceReply, TEST_COMMAND } from './helpers/track-a-evidence.js';

async function open(t) {
    const host = await createSdHost();
    t.after(() => host.close());
    const thread = await seedNeutralHook(host);
    return { host, thread, evidence: () => host.sdk.query('story.evidence', {}) };
}

test('actual SD neutral hook needs no second quest store or RPG extension', async t => {
    const { host, thread } = await open(t);
    assert.equal(thread.kind, 'hook');
    assert.equal(thread.fields.goal, 'Talk to the miller');
    assert.equal(thread.target, null);
    assert.equal(thread.reward, null);
    assert.equal(thread.rpg, undefined);
    assert.equal(host.head().domains.quests, undefined);
    assert.deepEqual(host.sdk.modules().filter(module => module.id !== 'story-block').map(module => module.id), ['story-director']);
});

test('host selection proof verifies through pending evidence and commits on the reader action', async t => {
    const { host, thread, evidence } = await open(t);
    const result = host.bus.command(TEST_COMMAND, { threadId: thread.id, selection: 'Help the miller' });
    assert.equal(result.ok, true, result.message);
    assert.equal(result.receipt.data.v2.result.verified, true);
    const [proof] = evidence();
    assert.equal(proof.kind, 'acceptance');
    assert.equal(proof.owner, 'story-director');
    assert.equal(proof.payload.thread, thread.id);
    assert.equal(host.head().domains.director.threads[thread.id].rpg, undefined);
});

test('real reader words verify in capture; narration cannot supply reader intent', async t => {
    const { host, thread, evidence } = await open(t);
    await host.send('I will help the miller.', acceptanceReply(thread, 'I will help the miller'));
    assert.equal(evidence().length, 1);
    const accepted = evidence()[0];
    assert.equal(neutralAcceptance(thread, evidence(), accepted.id, { cause: 'story' }).ok, true);
    await host.send('Tell me more.', acceptanceReply(thread, 'I will take the mill job'));
    assert.deepEqual(evidence().map(proof => proof.id), [accepted.id]);
    const missing = neutralAcceptance(thread, evidence(), 'pf_00000000', { cause: 'story' });
    assert.equal(missing.code, 'REFUSED');
});

test('a host-quoted refusal cannot become neutral acceptance; fragments and single words fail too', async t => {
    const { host, thread, evidence } = await open(t);
    for (const [words, quoted] of [
        ['No. I refuse the mill job, and I will not take it.', 'I refuse the mill job, and I will not take it'],
        ['I will not take the mill job.', 'take the mill job'],
        ['Yes.', 'Yes'],
        ['I accept nothing from the miller.', 'I accept nothing from the miller'],
    ]) {
        await host.send(words, acceptanceReply(thread, quoted));
        assert.deepEqual(evidence(), [], quoted);
    }
});

test('failed root publishes no proof, pin, ledger entry or accepted state', async t => {
    const { host, thread, evidence } = await open(t);
    const before = structuredClone(host.head());
    const result = host.bus.command(TEST_COMMAND, { threadId: thread.id, selection: 'Help the miller',
        write: 'wr_00000001', expectedHash: hashJson(threadProjection(thread)), rollback: true });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'FAILED');
    assert.deepEqual(evidence(), []);
    assert.deepEqual(host.head(), before);
    assert.equal(host.head().domains.director.writes?.wr_00000001, undefined);
});

test('same write returns the saved result after stale checks would fail; changed meaning conflicts', async t => {
    const { host, thread } = await open(t);
    const payload = { threadId: thread.id, write: 'wr_00000001', expectedHash: hashJson(threadProjection(thread)) };
    const first = host.bus.command(TEST_COMMAND, payload);
    assert.equal(first.ok, true, first.message);
    await host.send('What happens next?', '<Changes>\n~ hook The Mill — More help is needed\n</Changes>');
    const current = host.sdk.query('director.thread', { id: thread.id });
    assert.notEqual(hashJson(threadProjection(current)), payload.expectedHash);
    const retried = host.bus.command(TEST_COMMAND, payload);
    assert.equal(retried.ok, true, retried.message);
    assert.deepEqual(retried.receipt.data.v2.result.saved, first.receipt.data.v2.result.saved);
    const changed = host.bus.command(TEST_COMMAND, { ...payload, expectedHash: hashJson(threadProjection(current)) });
    assert.equal(changed.code, 'CONFLICT');
});

test('proof retains identity through unchanged Re-read and reload; swipe removes and restores it', async t => {
    const { host, thread, evidence } = await open(t);
    await host.send('I will help the miller.', acceptanceReply(thread, 'I will help the miller'));
    const at = host.ctx.chat.length - 1;
    const [before] = evidence();
    assert.ok(before);
    const reread = await host.turn.reread(at);
    assert.equal(reread.ok, true, reread.message);
    assert.equal(evidence()[0].id, before.id);
    assert.equal(evidence()[0].payloadHash, before.payloadHash);
    const chat = structuredClone(host.ctx.chat);
    const reloaded = await createSdHost();
    t.after(() => reloaded.close());
    await reloaded.st.loadChat(chat);
    assert.deepEqual(reloaded.sdk.query('story.evidence', {}).map(proof => [proof.id, proof.payloadHash]), [[before.id, before.payloadHash]]);
    await host.swipe('The miller has no new news.');
    assert.deepEqual(evidence(), []);
    await host.st.swipeTo(at, 0);
    assert.equal(evidence()[0].id, before.id);
});

test('deleting the proof carrier hides its proof and neutral acceptance refuses', async t => {
    const { host, thread, evidence } = await open(t);
    await host.send('I will help the miller.', acceptanceReply(thread, 'I will help the miller'));
    const [proof] = evidence();
    assert.ok(proof);
    await host.st.deleteMessage(host.ctx.chat.length - 1);
    assert.deepEqual(evidence(), []);
    assert.equal(neutralAcceptance(thread, evidence(), proof.id, { cause: 'story' }).code, 'REFUSED');
});
