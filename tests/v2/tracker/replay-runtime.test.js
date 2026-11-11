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

// ---- director.fold (src/v2/tracker/fold.js): replay equals live, the guard, hidden names, sway, legend -----------------------------
import { hiddenNames } from '../../../src/v2/world/index.js';
import { validateDirector } from '../../../src/v2/tracker/domain.js';

const FOLD = { after: 3, keep: 2 };
const wrap = (text, lines) => `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const fold = (h, payload = FOLD) => h.bus.command('director.fold', payload, { cause: 'system' });
const dir = h => h.head().domains.director;
const foldProblems = h => h.store.problems().filter(problem => /guard|folded/i.test(problem.why ?? problem.message ?? ''));

// `count` replies, each opening quest `Q n` (a giver and a difficulty) and finishing the one before; days move on so the digest writes.
async function story(h, count, { from = 1, extra = () => [] } = {}) {
    for (let n = from; n < from + count; n++) {
        const lines = [`~ time June ${Math.min(28, n)}, 1200, 08:00 am`, `+ quest Q${n} — job ${n} | giver: Sir Lothar | goal: bring ${n} | difficulty: ${n % 2 ? 'hard' : 'easy'}`, ...extra(n)];
        if (n > 1) lines.push(`- quest Q${n - 1} — done`);
        await h.send(`Go ${n}`, wrap(`Reply ${n}.`, lines));
    }
}

test('a fold replays as live: rebuild and a fresh host give the same head, old keys and writes go with the threads', async t => {
    const h = await createHost({ modules: [createModule()] });
    t.after(() => h.close());
    await story(h, 30);
    const before = Object.keys(dir(h).threads).length;
    ok(await fold(h));
    const state = dir(h);
    const folded = Object.values(state.folded);
    assert.equal(folded.length, 1);
    assert.ok(folded[0].items.length >= 10);
    assert.equal(Object.keys(state.threads).length, before - folded[0].items.length);
    for (const item of folded[0].items) {
        assert.equal(state.threads[item.id], undefined);
        assert.equal(Object.values(state.keys).includes(item.id), false);
        assert.equal(Object.values(h.head().domains.chronicle.questLog ?? {}).some(line => line.thread === item.id), false);
    }
    assert.deepEqual(validateDirector(state), []);
    const live = JSON.stringify(h.head());
    h.store.rebuild();
    assert.equal(JSON.stringify(h.head()), live);
    assert.deepEqual(h.store.problems(), []);
    const loaded = await createHost({ modules: [createModule()], st: { chat: structuredClone(h.ctx.chat), extensionSettings: structuredClone(h.ctx.extensionSettings) } });
    t.after(() => loaded.close());
    loaded.store.rebuild();
    assert.equal(JSON.stringify(loaded.head()), live);
});

test('a click cannot fold; the default horizon (200 replies) folds nothing in a short chat', async t => {
    const h = await createHost({ modules: [createModule()] });
    t.after(() => h.close());
    await story(h, 14);
    assert.equal((await h.sdk.command('director.fold', FOLD)).ok, false);
    assert.equal((await h.bus.command('director.fold', {}, { cause: 'system' })).ok, false);
    assert.equal(dir(h).folded, undefined);
});

test('the guard: a delete of the reply that finished a folded thread skips the fold, nothing is lost, the next fold takes it again', async t => {
    const h = await createHost({ modules: [createModule()] });
    t.after(() => h.close());
    await story(h, 30);
    ok(await fold(h));
    const folded = Object.values(dir(h).folded)[0].items;
    const victim = folded.find(item => item.key === 'Q4');
    assert.ok(victim, 'Q4 was folded');
    const at = h.ctx.chat.findIndex(message => !message.is_user && message.mes.includes('- quest Q4 —'));
    await h.st.deleteMessage(at);
    await h.st.deleteMessage(at - 1);
    const back = Object.values(dir(h).threads).find(thread => thread.key === 'Q4');
    assert.equal(back?.status, 'active', 'the quest is open again and still there');
    assert.equal(dir(h).folded, undefined, 'the fold block was skipped whole');
    assert.equal(foldProblems(h).length, 1);
    assert.equal(foldProblems(h)[0].code, 'REPLAY_PREREQUISITE');
    const live = JSON.stringify(h.head());
    h.store.rebuild();
    assert.equal(JSON.stringify(h.head()), live);
    assert.deepEqual(validateDirector(dir(h)), []);
    await story(h, 1, { from: 31 });
    ok(await fold(h));
    assert.ok(Object.values(dir(h).folded).length >= 1);
});

test('a fold after a deleted first fold still applies (the folded scratch parent is made on the way)', async t => {
    const h = await createHost({ modules: [createModule()] });
    t.after(() => h.close());
    await story(h, 20);
    ok(await fold(h));
    const first = Object.keys(dir(h).folded)[0];
    await story(h, 20, { from: 21 });
    ok(await fold(h));
    assert.equal(Object.keys(dir(h).folded).length, 2);
    const at = h.ctx.chat.findIndex(message => !message.is_user && message.mes.includes('Reply 20.'));
    await h.st.deleteMessage(at);
    await h.st.deleteMessage(at - 1);
    const left = Object.keys(dir(h).folded);
    assert.equal(left.length, 1, 'the first fold went with its reply; the later one applied');
    assert.equal(left.includes(first), false);
    assert.equal(h.store.problems().filter(problem => /folded/.test(problem.why ?? '')).length, 0);
    const live = JSON.stringify(h.head());
    h.store.rebuild();
    assert.equal(JSON.stringify(h.head()), live);
    assert.deepEqual(validateDirector(dir(h)), []);
});

test('hidden names stay hidden after a fold (secrets, agendas: names and aliases)', async t => {
    const h = await createHost({ modules: [createModule()] });
    t.after(() => h.close());
    // Four secrets, each finished the next reply (early days: the digest has long written them).
    await story(h, 30, { extra: n => [...(n <= 4 ? [`+ secret Vault ${n} — the vault ${n} | aka: Cellar ${n}`] : []), ...(n >= 2 && n <= 5 ? [`- secret Vault ${n - 1} — done`] : [])] });
    const hidden = () => ({ behind: [...hiddenNames(h.head()).behind].sort(), words: [...hiddenNames(h.head()).words].sort() });
    const before = hidden();
    assert.ok(before.behind.includes('vault 1'));
    ok(await fold(h));
    const folded = Object.values(dir(h).folded)[0].items.filter(item => item.kind === 'secret');
    assert.ok(folded.length >= 1, 'a secret was folded');
    assert.deepEqual(hidden(), before);
});

test('Ripples: the sway is the same before and after a fold; a done quest is kept (legendEarned still true)', async t => {
    t.mock.method(console, 'warn', () => {});
    const h = await createHost({ modules: [createModule()] });
    t.after(() => h.close());
    const table = { powers: [{ id: 'wendhild', name: 'Princess Wendhild', base: 40, givers: ['Sir Lothar'] }, { id: 'corvin', name: 'Prince Corvin', base: 35, givers: ['Corvin'] }] };
    t.mock.method(h.packs.packs, 'packs', () => [{ id: 'fake-pack', ripples: table }]);
    await story(h, 30);
    const rows = () => JSON.stringify(h.sdk.query('ripples.sway', {}).map(row => [row.id, row.sway, row.reasons.length]));
    const before = rows();
    assert.notEqual(h.sdk.query('ripples.sway', {})[0].sway, 40, 'finished quests moved the sway');
    ok(await fold(h));
    assert.ok(Object.values(dir(h).folded)[0].items.length >= 10);
    assert.equal(rows(), before);
    h.store.rebuild();
    assert.equal(rows(), before);
    // What Story Block's `inventory.legendEarned` reads: a quest of the Director's threads that ended done.
    assert.ok(h.sdk.query('director.threads', { kind: 'quest' }).some(thread => thread.ended?.outcome === 'done'));
});

test('with the digest off the gate is shut: nothing folds', async t => {
    const h = await createHost({ modules: [createModule()] });
    t.after(() => h.close());
    await story(h, 25);
    h.features.set?.('story-director.digest', false);
    const out = await fold(h);
    assert.equal(out.ok, false, 'digest off: the gate is shut');
    assert.equal(dir(h).folded, undefined);
});
