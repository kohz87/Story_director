// rx-economy RX-E-1: a quest the story writes with a countable but trivial goal ("bring 1 Torch", a
// 2-mark shop item, or "Kill 1 cellar rat") is paid the top of the rank one above the party's (E: 3000
// at level 1), and nothing limits how many such quests one reply may write and the reader finish. One
// reply writing four "bring 1 Torch | rank: E | reward: 3000 marks" quests, and four torches, turns
// 8 marks of goods into 12,000 marks at level 1 (30× the party rank's top). Only the story-vouched
// (uncountable) case is held to the party's own rank and to one turn-in a reply (#86, #89).
// Fixed: every rank the story writes is held to the party's own, and every reward but a pack quest's
// own is the story's money, held to what one reply may pay (the party rank's top), clicks included.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { fakeRpgBattle } from '../integration/helpers/fake-rpg.js';
import { part as quests } from '../../../src/v2/quests/index.js';
import { fakeQueries, makeHost, makeState, quest } from '../quests/helpers/fake-ctx.js';
import { replyTurn } from '../../../src/v2/tracker/domain.js';

const PACK = readFileSync(new URL('../../fixtures/ersveil-bluewatch.pack.json', import.meta.url), 'utf8');
const reply = (text, lines = []) => `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const wallet = host => host.sdk.query('inventory.wallet', { owner: 'party' }).coin ?? 0;

async function ersveil() {
    const probe = await createHost({ modules: [fakeRpgBattle(), createModule()] });
    assert.equal((await probe.packs.packs.install(PACK)).ok, true);
    const settings = structuredClone(probe.ctx.extensionSettings.storySuite);
    probe.close();
    return createHost({ modules: [fakeRpgBattle(), createModule()], settings });
}

test('four story-written "bring 1 Torch" quests from one reply pay no more than the party rank\'s top in all', async () => {
    const host = await ersveil();
    try {
        await host.send('We arrive.', reply('Bluewatch.', ['~ place Bluewatch Village | kind: settlement', '+ item Torch | qty: 4']));
        const top = host.sdk.query('quest.ranks')[0].reward[1];
        const names = ['Torch Run A', 'Torch Run B', 'Torch Run C', 'Torch Run D'];
        await host.send('Any work?', reply('Fenna needs torches.', names.map(name => `+ quest ${name} — torches | giver: Fenna | goal: bring 1 Torch to Fenna | rank: E | reward: 3000 marks`)));
        for (const name of names) {
            if (!host.sdk.query('director.thread', { key: name }).taken) assert.equal((await host.sdk.command('quest.take', { key: name })).ok, true);
        }
        const before = wallet(host);
        for (const name of names) await host.sdk.command('quest.finish', { key: name });
        const paid = wallet(host) - before;
        assert.ok(paid <= top, `four quests one reply wrote, each for 1 Torch (2 marks), paid ${paid} (one reply's coin budget, the party rank's top, is ${top})`);
        assert.equal(paid, top, 'the first is paid, held to the party\'s rank; the rest wait for the next reply');
        assert.deepEqual(names.map(name => host.sdk.query('director.thread', { key: name }).status), ['resolved', 'active', 'active', 'active']);
        assert.match(host.sdk.query('quest.progress', { key: 'Torch Run B' }).finish.reason, /^One reply pays at most 50 marks in quest rewards the story wrote \(50 marks so far\); it is ready for the next reply\.$/);
    } finally { host.close(); }
});

test('four cheap quests turned in across four replies pay at most four budgets; difficulty: nightmare pays the same', async () => {
    const host = await ersveil();
    try {
        await host.send('We arrive.', reply('Bluewatch.', ['~ place Bluewatch Village | kind: settlement', '+ item Torch | qty: 4']));
        const top = host.sdk.query('quest.ranks')[0].reward[1];
        const names = ['Torch Run A', 'Torch Run B', 'Torch Run C', 'Torch Run D'];
        await host.send('Any work?', reply('Fenna needs torches.', names.map(name => `+ quest ${name} — torches | giver: Fenna | goal: bring 1 Torch to Fenna | difficulty: nightmare | reward: 99999 marks`)));
        for (const name of names) {
            if (!host.sdk.query('director.thread', { key: name }).taken) assert.equal((await host.sdk.command('quest.take', { key: name })).ok, true);
        }
        const start = wallet(host);
        for (const [i, name] of names.entries()) {
            // A reply with a Director line starts the next reply's tally.
            if (i > 0) await host.send('Next torch.', reply('Fenna waits.', [`~ quest ${name} | progress: one more torch`]));
            const before = wallet(host);
            for (const each of names) await host.sdk.command('quest.finish', { key: each });
            assert.ok(wallet(host) - before <= top, `reply ${i + 1} paid ${wallet(host) - before} (budget ${top})`);
        }
        const paid = wallet(host) - start;
        assert.ok(paid <= 4 * top, `four replies paid ${paid}`);
        assert.equal(paid, 4 * top, 'one each reply, held to the party\'s F (nightmare reaches no higher)');
    } finally { host.close(); }
});

// ---- the same rules on a fake host --------------------------------------------------------------------

const finish = quests.commands['quest.finish'];
const progress = quests.queries['quest.progress'];
const settlement = { place: { name: 'Bluewatch', kind: 'settlement' } };

// Taken kill quests of 1 small foe each (a rat, a bat, a toad), a party at level 1 (F: 10–50, the
// reply's budget 50), one trivial fight each, in a reply's turn.
const PESTS = ['rat', 'bat', 'toad'];
function rats(n, fields = {}, queries = fakeQueries) {
    const threads = Array.from({ length: n }, (_, i) => quest(`th_rat0000${i}`, `Rat ${i}`, { goal: `Kill 1 ${PESTS[i]}`, giver: 'Fenna', reward: '3000 gold', rank: 'E', ...fields }, { taken: { rev: 4 }, target: { noun: PESTS[i], count: 1, kind: 'foes' } }));
    const state = makeState({ threads, scene: settlement, beaten: threads.map((_, i) => ({ rev: 5 + i, foes: [{ name: PESTS[i], count: 1 }], won: true })) });
    state.domains.party.actors.ac_astra001.level = 1;
    state.domains.director.turn = { n: 3, reply: 'r3', index: 2, from: null, quests: [], lone: null };
    return makeHost(state, { queries });
}

test('a kill quest for 1 rat written rank: E pays the party rank\'s top, as story money, once a reply', () => {
    const host = rats(2);
    const first = host.run(finish, { id: 'th_rat00000' });
    assert.equal(first.ok, true, first.message);
    assert.deepEqual(first.receipt.data.paid, { amount: 50, said: 3000, rank: 'F', range: [10, 50] });
    assert.equal(host.calls.find(call => call.type === 'wallet.receive').payload.story, true);
    assert.equal(replyTurn(host.state.domains.director).paid, 50);
    const before = structuredClone(host.state);
    const second = host.run(finish, { id: 'th_rat00001' });
    assert.equal(second.code, 'REFUSED');
    assert.equal(second.message, 'Rat 1 cannot be turned in yet. One reply pays at most 50 gold in quest rewards the story wrote (50 gold so far); it is ready for the next reply.');
    assert.deepEqual(host.state, before, 'nothing saved, nothing claimed');
    const check = progress(host.state, { id: 'th_rat00001', closing: true });
    assert.equal(check.finish.budget, true);
    assert.equal(check.refusal, 'one reply pays at most 50 gold in quest rewards the story wrote (50 gold so far); it is ready for the next reply');
    // The next reply (a fresh turn) pays it.
    host.state.domains.director.turn = { n: 4, now: [{ reply: 'r4', index: 0, from: null, quests: [], lone: null, added: 0, vouched: null, paid: 0 }] };
    assert.equal(host.run(finish, { id: 'th_rat00001' }).ok, true);
    assert.deepEqual(host.state.domains.inventory.wallets.party, { coin: 100 });
});

test('small rewards share a reply\'s budget; one that does not fit waits', () => {
    const host = rats(3, { reward: '20 gold', rank: '' });
    assert.equal(host.run(finish, { id: 'th_rat00000' }).ok, true);
    assert.equal(host.run(finish, { id: 'th_rat00001' }).ok, true, '20 + 20 fits in 50');
    assert.equal(host.run(finish, { id: 'th_rat00002' }).code, 'REFUSED', '60 does not');
    assert.deepEqual(host.state.domains.inventory.wallets.party, { coin: 40 });
});

test('a pack kill quest still pays its pack reward, outside the reply\'s budget', () => {
    const queries = { ...fakeQueries, 'packs.content': (_state, args) => (args?.kind === 'quests' ? [0, 1].map(i => ({ pack: 'p', name: `Rat ${i}`, letter: 'E', reward: '200 gold' })) : []) };
    const host = rats(2, {}, queries);
    for (const id of ['th_rat00000', 'th_rat00001']) {
        const done = host.run(finish, { id });
        assert.equal(done.ok, true, done.message);
        assert.deepEqual(done.receipt.data.paid, { amount: 200 }, 'the pack\'s rank (E: 50–230) and reward, as written');
    }
    assert.ok(host.calls.filter(call => call.type === 'wallet.receive').every(call => call.payload.story === undefined), 'not the story\'s money');
    assert.equal(replyTurn(host.state.domains.director).paid, 0);
    assert.deepEqual(host.state.domains.inventory.wallets.party, { coin: 400 });
});

test('the story closing two torch quests in one reply turns in one; the other stays open with a Problem', async () => {
    const host = await ersveil();
    try {
        await host.send('We arrive.', reply('Bluewatch.', ['~ place Bluewatch Village | kind: settlement', '+ item Torch | qty: 2']));
        const top = host.sdk.query('quest.ranks')[0].reward[1];
        const names = ['Torch Run A', 'Torch Run B'];
        await host.send('Any work?', reply('Fenna needs torches.', names.map(name => `+ quest ${name} — torches | giver: Fenna | goal: bring 1 Torch to Fenna | rank: E | reward: 3000 marks`)));
        for (const name of names) {
            if (!host.sdk.query('director.thread', { key: name }).taken) assert.equal((await host.sdk.command('quest.take', { key: name })).ok, true);
        }
        const before = wallet(host);
        await host.send('Here are the torches.', reply('Fenna takes them.', names.map(name => `- quest ${name} — turned in`)));
        assert.equal(wallet(host) - before, top);
        assert.deepEqual(names.map(name => host.sdk.query('director.thread', { key: name }).status), ['resolved', 'active']);
        const problem = host.sdk.query('director.problems').filter(entry => entry.kind === 'turn-in').at(-1);
        assert.equal(problem.text, `The story says Torch Run B was turned in, but one reply pays at most ${top} marks in quest rewards the story wrote (${top} marks so far); it is ready for the next reply; it stays open.`);
        // The next reply turns it in.
        await host.send('And the other?', reply('Fenna nods.', ['- quest Torch Run B — turned in']));
        assert.equal(host.sdk.query('director.thread', { key: 'Torch Run B' }).status, 'resolved');
        assert.equal(wallet(host) - before, 2 * top);
    } finally { host.close(); }
});
