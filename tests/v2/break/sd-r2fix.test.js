// Re-break round 2 (b3-economy) fixes, by the coordinator's decisions:
// * r2-5: one reply turns in at most one quest on the story's word alone (a goal code cannot count);
//   the others stay open and ready, with a Problem. That reward is sent as the story's money
//   (`wallet.receive` with `story: true`, held to Story Block's per-reply coin budget where Story Block
//   has one), unless the pack wrote the reward.
// * r2-6: a reward the story wrote is only ever lowered to its rank's top, never raised to its floor;
//   only a pack quest's own reward is raised.
// * r2-7: a difficulty puts a quest no more than WRITTEN_RANKS_ABOVE above the party's rank.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { part as quests } from '../../../src/v2/quests/index.js';
import { DEFAULT_RANKS, WRITTEN_RANKS_ABOVE, defaultRank, holdReward, rewardHold } from '../../../src/v2/quests/ranks.js';
import { fakeQueries, makeHost, makeState, quest } from '../quests/helpers/fake-ctx.js';
import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { fakeRpgBattle } from '../integration/helpers/fake-rpg.js';
import { replyTurn } from '../../../src/v2/tracker/domain.js';

const finish = quests.commands['quest.finish'];
const progress = quests.queries['quest.progress'];
const settlement = { place: { name: 'Bluewatch', kind: 'settlement' } };

// Taken quests with goals code cannot count, ready (the story said `met: yes`), in a reply's turn.
function errands(names, { reward = '20 gold' } = {}) {
    const threads = names.map((name, i) => quest(`th_errand0${i}`, name, { goal: 'Carry the parcel to the mill', giver: 'Fenna', reward }, { taken: { rev: 4 }, ready: { rev: 9 } }));
    const state = makeState({ threads, scene: settlement });
    state.domains.director.turn = { n: 3, reply: 'r3', index: 2, from: null, quests: [], lone: null };
    return state;
}

// A host whose commands run as the story's (cause story), as the tracker's turn-in does.
function storyHost(state, options) {
    const host = makeHost(state, options);
    const run = host.run;
    host.run = (handler, payload) => run((ctx, p) => handler({ ...ctx, cause: 'story' }, p), payload);
    return host;
}

test('r2-5: one reply turns in one quest on the story\'s word; a second waits, refused with nothing saved', () => {
    const host = storyHost(errands(['Errand A', 'Errand B']));
    const first = host.run(finish, { id: 'th_errand00', by: 'story' });
    assert.equal(first.ok, true, first.message);
    assert.equal(replyTurn(host.state.domains.director).vouched, 'th_errand00');
    const before = structuredClone(host.state);
    const second = host.run(finish, { id: 'th_errand01', by: 'story' });
    assert.equal(second.code, 'REFUSED');
    assert.equal(second.message, 'Errand B cannot be turned in yet. One reply turns in only one quest on the story\'s word alone (Errand A was); it is ready for the next reply.');
    assert.deepEqual(host.state, before, 'nothing saved');
    assert.deepEqual(host.state.domains.inventory.wallets.party, { coin: 20 });
    // quest.progress says so before the tracker asks, in the words its Problem uses.
    const check = progress(host.state, { id: 'th_errand01', closing: true });
    assert.equal(check.finish.ok, false);
    assert.equal(check.refusal, 'one reply turns in only one quest on the story\'s word alone (Errand A was turned in), so it is ready for the next reply');
    // A click after the reply counts against the same reply.
    const click = makeHost(host.state).run(finish, { id: 'th_errand01' });
    assert.equal(click.code, 'REFUSED');
    // The next reply (a fresh turn) may turn in one more.
    host.state.domains.director.turn = { n: 4, reply: 'r4', index: 0, from: null, quests: [], lone: null };
    assert.equal(host.run(finish, { id: 'th_errand01', by: 'story' }).ok, true);
    assert.deepEqual(host.state.domains.inventory.wallets.party, { coin: 40 });
});

test('r2-5: quests code counts are not bounded by the one-a-reply rule', () => {
    const state = errands(['Errand A']);
    const wolves = quest('th_wolves01', 'Wolves', { goal: 'Kill 3 wolves', giver: 'Fenna', reward: '30 gold' }, { taken: { rev: 4 }, target: { noun: 'wolf', count: 3, kind: 'foes' } });
    state.domains.director.threads[wolves.id] = wolves;
    state.domains.director.keys.wolves = wolves.id;
    state.domains.combat.beaten = [{ rev: 6, foes: [{ name: 'Wolf', count: 3 }], won: true }];
    const host = storyHost(state);
    assert.equal(host.run(finish, { id: 'th_errand00', by: 'story' }).ok, true);
    const counted = host.run(finish, { id: 'th_wolves01', by: 'story' });
    assert.equal(counted.ok, true, counted.message);
    assert.equal(host.calls.filter(call => call.type === 'wallet.receive').at(-1).payload.story, undefined, 'code counted it: not the story\'s money');
});

test('r2-5: the story-vouched reward is sent as the story\'s money and paid what Story Block allows', () => {
    const state = errands(['Errand A']);
    state.storyBudget = 5;
    const host = storyHost(state);
    const done = host.run(finish, { id: 'th_errand00', by: 'story' });
    assert.equal(done.ok, true, done.message);
    assert.deepEqual(host.calls.find(call => call.type === 'wallet.receive').payload, { owner: 'party', amount: 20, note: 'Errand A reward', story: true });
    assert.deepEqual(done.receipt.data.paid, { amount: 5, owed: 20 });
    assert.match(done.receipt.summary, /5 gold paid \(20 gold was owed; one reply may give no more\)/);
    // A Story Block without the budget pays it all.
    const plain = storyHost(errands(['Errand A'])).run(finish, { id: 'th_errand00', by: 'story' });
    assert.deepEqual(plain.receipt.data.paid, { amount: 20 });
});

test('r2-5: a pack quest\'s own reward is not the story\'s money (the pack wrote it)', () => {
    const queries = { ...fakeQueries, 'packs.content': (state, args) => (args?.kind === 'quests' ? [{ name: 'Errand A', reward: '20 gold' }] : []) };
    const state = errands(['Errand A', 'Errand B']);
    state.storyBudget = 5;
    const host = storyHost(state, { queries });
    const done = host.run(finish, { id: 'th_errand00', by: 'story' });
    assert.equal(done.ok, true, done.message);
    assert.equal(host.calls.find(call => call.type === 'wallet.receive').payload.story, undefined);
    assert.deepEqual(host.state.domains.inventory.wallets.party, { coin: 20 });
    // Still one a reply.
    assert.equal(host.run(finish, { id: 'th_errand01', by: 'story' }).code, 'REFUSED');
});

test('r2-5: six errands closed in one reply: one is turned in, five stay open and ready with a Problem; the next reply turns in one more', async () => {
    const reply = (text, lines = []) => `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>`;
    const host = await createHost({ modules: [fakeRpgBattle(), createModule()] });
    try {
        const names = ['A', 'B', 'C', 'D', 'E', 'F'].map(letter => `Errand ${letter}`);
        await host.send('We arrive.', reply('Bluewatch.', ['~ place Bluewatch Village | kind: settlement']));
        await host.send(`I take ${names.join(', ')}.`, reply('Fenna has errands.', names.map(name => `+ quest ${name} — an errand | giver: Fenna | goal: carry the parcel to the mill | reward: 20 gold`)));
        for (const name of names) {
            if (!host.sdk.query('director.thread', { key: name }).taken) assert.equal((await host.sdk.command('quest.take', { key: name })).ok, true);
        }
        const close = list => reply('The parcels are delivered.', list.map(name => `- quest ${name} — done`));
        await host.send('All done.', close(names));
        const threads = names.map(name => host.sdk.query('director.thread', { key: name }));
        assert.deepEqual(threads.map(thread => thread.status), ['resolved', 'active', 'active', 'active', 'active', 'active']);
        assert.ok(threads.slice(1).every(thread => thread.ready), 'the others are ready');
        assert.equal(host.sdk.query('inventory.wallet', { owner: 'party' }).coin, 20);
        const problems = host.sdk.query('director.problems').filter(problem => problem.kind === 'turn-in');
        assert.equal(problems.length, 5);
        assert.equal(problems[0].text, 'The story says Errand B was turned in, but one reply turns in only one quest on the story\'s word alone (Errand A was turned in), so it is ready for the next reply; it stays open.');
        await host.send('And the rest?', close(names.slice(1)));
        assert.deepEqual(names.map(name => host.sdk.query('director.thread', { key: name }).status), ['resolved', 'resolved', 'active', 'active', 'active', 'active']);
        assert.equal(host.sdk.query('inventory.wallet', { owner: 'party' }).coin, 40);
    } finally { host.close(); }
});

test('r2-6: a reward the story wrote is never raised to its rank\'s floor; a pack\'s is', () => {
    const E = DEFAULT_RANKS[1];
    assert.deepEqual(rewardHold(5, E, 'written'), { total: 5, held: false });
    assert.deepEqual(rewardHold(5, E, 'difficulty'), { total: 5, held: false });
    assert.deepEqual(rewardHold(5000, E, 'written'), { total: E.reward[1], held: true });
    assert.deepEqual(rewardHold(5, E, 'pack'), holdReward(5, E));
    assert.deepEqual(rewardHold(5, E, 'pack'), { total: E.reward[0], held: true });
});

test('r2-7: nightmare reaches no further above the party\'s rank than a written rank may', () => {
    assert.equal(WRITTEN_RANKS_ABOVE, 1);
    assert.equal(defaultRank(DEFAULT_RANKS, 'nightmare', 1).id, 'E');
    assert.equal(defaultRank(DEFAULT_RANKS, 'nightmare', 25).id, 'B');
    assert.equal(defaultRank(DEFAULT_RANKS, 'hard', 25).id, 'B');
    assert.equal(defaultRank(DEFAULT_RANKS, 'easy', 25).id, 'D');
});
