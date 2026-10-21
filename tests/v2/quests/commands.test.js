// Quests part: quest.take / decline / abandon / finish against a fake transaction.
import test from 'node:test';
import assert from 'node:assert/strict';
import { part } from '../../../src/v2/quests/index.js';
import { fakeCommands, fakeQueries, makeHost, makeState, quest, xpCommand } from './helpers/fake-ctx.js';

const { 'quest.take': take, 'quest.decline': decline, 'quest.abandon': abandon, 'quest.finish': finish } = part.commands;

const wolvesOffer = () => quest('th_wolves01', 'EastBluffWolves', { goal: 'Clear at least 3 wolves from East Bluff', reward: '1 silver each wolf', giver: 'Captain Orsa' }, { offer: true });
const herbs = () => quest('th_herbs001', 'Herb Run', { goal: 'Bring 5 moonleaf to Fenna', reward: '10 copper', giver: 'Fenna' }, { offer: true });
const settlement = { place: { name: 'Bluewatch Village', kind: 'settlement' } };
const fight = (rev, foes, won = true) => ({ rev, foes, won });

function takenWolves(beaten, scene = settlement, more = {}) {
    const host = makeHost(makeState({ threads: [wolvesOffer()], scene, rev: 10, ...more }));
    const taken = host.run(take, { id: 'th_wolves01' });
    assert.equal(taken.ok, true, taken.message);
    host.state.domains.combat.beaten = beaten;
    return host;
}

test('take on an offer: taken at this receipt rev, target and reward settled by code, narrated', () => {
    const host = makeHost(makeState({ threads: [wolvesOffer()], rev: 10 }));
    const result = host.run(take, { key: 'eastbluffwolves' });
    assert.equal(result.ok, true);
    const thread = host.state.domains.director.threads.th_wolves01;
    assert.equal(thread.offer, false);
    assert.deepEqual(thread.taken, { rev: 11 });
    assert.equal(thread.rev, 11);
    assert.deepEqual(thread.target, { noun: 'wolves', count: 3, kind: 'foes' });
    assert.deepEqual(thread.reward, { amount: 1, each: true, unit: 'silver', text: '1 silver each wolf' });
    assert.equal(result.receipt.summary, 'Astra takes on EastBluffWolves: beat 3 wolves; 1 silver per wolf.');
    assert.equal(result.receipt.narrate, true);
});

test('a target label without a verb is items when the inventory knows the name, else foes', () => {
    const host = makeHost(makeState({
        threads: [quest('th_pelts001', 'Pelts', { target: '4 wolf pelts' }, { offer: true }), quest('th_rats0001', 'Rats', { target: 'at least 6 rats' }, { offer: true })],
        defs: [{ id: 'story/wolf-pelt', name: 'Wolf Pelt' }],
    }));
    host.run(take, { id: 'th_pelts001' });
    host.run(take, { id: 'th_rats0001' });
    assert.equal(host.state.domains.director.threads.th_pelts001.target.kind, 'items');
    assert.equal(host.state.domains.director.threads.th_rats0001.target.kind, 'foes');
});

test('take refusals save nothing', () => {
    const state = makeState({ threads: [
        quest('th_done0001', 'Done', {}, { status: 'resolved', ended: { rev: 3, reason: 'x', outcome: 'done' } }),
        quest('th_taken001', 'Taken', {}, { taken: { rev: 4 } }),
        { ...quest('th_hook0001', 'Hook'), kind: 'hook' },
    ] });
    const host = makeHost(state);
    const before = structuredClone(host.state);
    assert.equal(host.run(take, { id: 'th_nope0001' }).code, 'NOT_FOUND');
    assert.equal(host.run(take, { id: 'th_hook0001' }).code, 'NOT_FOUND');
    assert.equal(host.run(take, { id: 'th_done0001' }).code, 'INVALID');
    const again = host.run(take, { id: 'th_taken001' });
    assert.equal(again.code, 'INVALID');
    assert.match(again.message, /already taken on/);
    assert.deepEqual(host.state, before);
});

test('a quest the story already accepted is adopted for counting, quietly', () => {
    const host = makeHost(makeState({ threads: [quest('th_wolves01', 'Wolves', { goal: 'kill 3 wolves' })] }));
    const result = host.run(take, { id: 'th_wolves01' });
    assert.equal(result.ok, true);
    assert.equal(result.receipt.narrate, false);
    assert.match(result.receipt.summary, /keeps count for Wolves/);
});

test('decline closes an offer as declined; only open offers', () => {
    const host = makeHost(makeState({ threads: [wolvesOffer(), quest('th_active01', 'Active', {}, { taken: { rev: 2 } })] }));
    const result = host.run(decline, { id: 'th_wolves01' });
    assert.equal(result.ok, true);
    assert.equal(result.receipt.summary, 'Astra turns down EastBluffWolves.');
    const thread = host.state.domains.director.threads.th_wolves01;
    assert.equal(thread.status, 'resolved');
    assert.equal(thread.offer, false);
    assert.deepEqual(thread.ended, { rev: 11, reason: 'turned down', outcome: 'declined' });
    const before = structuredClone(host.state);
    assert.equal(host.run(decline, { id: 'th_wolves01' }).code, 'INVALID');
    assert.equal(host.run(decline, { id: 'th_active01' }).code, 'INVALID');
    assert.equal(host.run(decline, { id: 'th_missing1' }).code, 'NOT_FOUND');
    assert.deepEqual(host.state, before);
});

test('abandon gives up a taken quest; not an offer, not twice', () => {
    const host = makeHost(makeState({ threads: [wolvesOffer()] }));
    assert.equal(host.run(abandon, { id: 'th_wolves01' }).code, 'INVALID');
    host.run(take, { id: 'th_wolves01' });
    const result = host.run(abandon, { id: 'th_wolves01', reason: 'too far' });
    assert.equal(result.ok, true);
    assert.equal(result.receipt.summary, 'Astra gives up EastBluffWolves.');
    assert.deepEqual(host.state.domains.director.threads.th_wolves01.ended, { rev: 12, reason: 'too far', outcome: 'abandoned' });
    const before = structuredClone(host.state);
    assert.equal(host.run(abandon, { id: 'th_wolves01' }).code, 'INVALID');
    assert.equal(host.run(finish, { id: 'th_wolves01' }).code, 'INVALID');
    assert.deepEqual(host.state, before);
});

test('finish, foes: counts whole-word matches since taken, pays 8 × 1 silver once, tells it with code numbers', () => {
    const host = takenWolves([
        fight(5, [{ name: 'Wolf', count: 4 }]),                         // before it was taken on
        fight(12, [{ name: 'Grey Wolf', count: 5 }, { name: 'Wolfhound Handler', count: 1 }]),
        fight(13, [{ name: 'Wolves', count: 9 }], false),                // a lost fight beats nobody
        fight(14, [{ name: 'Wolf', count: 3 }]),
    ]);
    const result = host.run(finish, { id: 'th_wolves01' });
    assert.equal(result.ok, true, result.message);
    assert.equal(result.receipt.summary, 'Astra turns in EastBluffWolves: 8 wolves beaten (target 3), 8 silver paid.');
    assert.equal(result.receipt.narrate, true);
    assert.deepEqual(host.state.domains.inventory.wallets.party, { silver: 8 });
    assert.equal(host.state.meta.claims['quest:th_wolves01:paid'], true);
    const thread = host.state.domains.director.threads.th_wolves01;
    assert.equal(thread.status, 'resolved');
    assert.deepEqual(thread.ended, { rev: 12, reason: 'turned in', outcome: 'done' });
    assert.deepEqual(result.receipt.data.paid, { amount: 8, currency: 'silver' });
    assert.equal(result.receipt.data.xp, null);           // no party.grantXp: none, and no failure
    assert.ok(host.calls.some(call => call.type === 'party.grantXp'));
    assert.deepEqual(host.calls.find(call => call.type === 'wallet.receive').payload, { owner: 'party', currency: 'silver', amount: 8, note: 'EastBluffWolves reward' });
});

test('finish grants XP through party.grantXp when RPG Battle has it', () => {
    const host = takenWolves([fight(12, [{ name: 'Wolf', count: 3 }])]);
    host.state.domains.director.threads.th_wolves01.fields.difficulty = 'dangerous';
    const commands = { ...fakeCommands, ...xpCommand };
    const withXp = makeHost(host.state, { commands, queries: fakeQueries });
    const result = withXp.run(finish, { id: 'th_wolves01' });
    assert.equal(result.ok, true, result.message);
    assert.deepEqual(withXp.state.domains.party.xpLog, [{ quest: 'th_wolves01', name: 'EastBluffWolves', difficulty: 'hard' }]);
    assert.deepEqual(result.receipt.data.xp, { xp: 40 });
});

test('finish, fixed reward: paid once whatever the count', () => {
    const host = makeHost(makeState({ threads: [quest('th_rats0001', 'Granary Rats', { goal: 'Kill 6 cellar rats', reward: '5 silver' }, { taken: { rev: 2 } })], scene: settlement }));
    host.state.domains.combat.beaten = [fight(3, [{ name: 'Cellar Rat Swarm', count: 9 }])];
    const result = host.run(finish, { id: 'th_rats0001' });
    assert.equal(result.ok, true, result.message);
    assert.equal(result.receipt.summary, 'Astra turns in Granary Rats: 9 cellar rats beaten (target 6), 5 silver paid.');
    assert.deepEqual(host.state.domains.inventory.wallets.party, { silver: 5 });
});

test('finish, items: hands over exactly the target count across stacks, pays per unit', () => {
    const host = makeHost(makeState({
        threads: [quest('th_tails001', 'Tail Bounty', { goal: 'Collect 5 wolf tails', reward: '2 copper per tail', giver: 'Fenna' }, { taken: { rev: 2 } })],
        scene: { place: { kind: 'wild' }, present: ['Fenna the miller'] },
        defs: [{ id: 'story/wolf-tail', name: 'Wolf Tail' }, { id: 'story/wolfhound-collar', name: 'Wolfhound Collar' }],
        stacks: [
            { id: 'it_aaaaaaa1', def: 'story/wolf-tail', qty: 3 },
            { id: 'it_bbbbbbb2', def: 'story/wolf-tail', qty: 4, owner: 'ac_astra001' },
            { id: 'it_ccccccc3', def: 'story/wolfhound-collar', qty: 2 },
        ],
    }));
    const result = host.run(finish, { id: 'th_tails001' });
    assert.equal(result.ok, true, result.message);
    assert.equal(result.receipt.summary, 'Astra turns in Tail Bounty: 5 wolf tails handed over (target 5), 10 copper paid.');
    const stacks = host.state.domains.inventory.stacks;
    assert.equal(stacks.it_aaaaaaa1, undefined);
    assert.equal(stacks.it_bbbbbbb2.qty, 2);
    assert.equal(stacks.it_ccccccc3.qty, 2);
    assert.deepEqual(result.receipt.data.consumed, [{ stack: 'it_aaaaaaa1', qty: 3 }, { stack: 'it_bbbbbbb2', qty: 2 }]);
    assert.deepEqual(host.state.domains.inventory.wallets.party, { copper: 10 });
});

test('finish with a reward that is not money pays nothing and says so', () => {
    const host = makeHost(makeState({ threads: [quest('th_favour01', 'Favour', { goal: 'Kill 2 trolls', reward: 'a favour from the guild' }, { taken: { rev: 2 } })], scene: settlement }));
    host.state.domains.combat.beaten = [fight(3, [{ name: 'Troll', count: 2 }])];
    const result = host.run(finish, { id: 'th_favour01' });
    assert.equal(result.ok, true);
    assert.equal(result.receipt.summary, 'Astra turns in Favour: 2 trolls beaten (target 2), reward as the story tells it: a favour from the guild.');
    assert.equal(host.calls.some(call => call.type === 'wallet.receive'), false);
});

test('finish refusals: not met, wrong place, already paid, no target, not taken; nothing saved', () => {
    // Not met: 2 of 3 since taking it on (the Wolfhound Handler is not a wolf).
    let host = takenWolves([fight(12, [{ name: 'Wolf', count: 2 }, { name: 'Wolfhound Handler', count: 4 }])]);
    let before = structuredClone(host.state);
    let result = host.run(finish, { id: 'th_wolves01' });
    assert.equal(result.code, 'NOT_ENOUGH');
    assert.equal(result.message, 'EastBluffWolves is not done yet (Wolves 2/3). Need 1 more wolf.');
    assert.deepEqual(host.state, before);

    // Wrong place: in the wild, the giver not present.
    host = takenWolves([fight(12, [{ name: 'Wolf', count: 3 }])], { place: { kind: 'wild' }, present: ['Fenna'] });
    before = structuredClone(host.state);
    result = host.run(finish, { id: 'th_wolves01' });
    assert.equal(result.code, 'INVALID');
    assert.equal(result.message, 'EastBluffWolves cannot be turned in here. Turn it in at a settlement or where Captain Orsa is.');
    assert.deepEqual(host.state, before);
    assert.equal(host.calls.filter(call => !call.rejected && call.type === 'wallet.receive').length, 0);

    // The giver present makes the wild fine.
    host.state.domains.scene.present = ['Orsa'];
    assert.equal(host.run(finish, { id: 'th_wolves01' }).ok, true);

    // Already paid on this line of history.
    host = takenWolves([fight(12, [{ name: 'Wolf', count: 3 }])], settlement, { claims: { 'quest:th_wolves01:paid': true } });
    before = structuredClone(host.state);
    result = host.run(finish, { id: 'th_wolves01' });
    assert.equal(result.code, 'CLAIMED');
    assert.deepEqual(host.state, before);

    // No target code can count; an offer not taken on.
    host = makeHost(makeState({ threads: [quest('th_story001', 'Who Poisoned', { goal: 'Find out who poisoned the well' }, { taken: { rev: 2 } }), wolvesOffer()], scene: settlement }));
    assert.equal(host.run(finish, { id: 'th_story001' }).code, 'INVALID');
    assert.match(host.run(finish, { id: 'th_wolves01' }).message, /has not been taken on/);
    assert.equal(host.run(finish, { id: 'th_missing1' }).code, 'NOT_FOUND');
});

test('a second finish after a turn-in is refused and pays nothing more', () => {
    const host = takenWolves([fight(12, [{ name: 'Wolf', count: 3 }])]);
    assert.equal(host.run(finish, { id: 'th_wolves01' }).ok, true);
    const before = structuredClone(host.state);
    // Even if the thread were reopened by the story, the claim stops a second payout.
    host.state.domains.director.threads.th_wolves01.status = 'active';
    host.state.domains.director.threads.th_wolves01.ended = null;
    const result = host.run(finish, { id: 'th_wolves01' });
    assert.equal(result.code, 'CLAIMED');
    assert.deepEqual(host.state.domains.inventory, before.domains.inventory);
});

test('a refused sub-command (fewer items than counted) rejects the whole turn-in', () => {
    const host = makeHost(makeState({
        threads: [quest('th_herbs001', 'Herb Run', { goal: 'Bring 5 moonleaf', reward: '10 copper' }, { taken: { rev: 2 } })],
        scene: settlement, defs: [{ id: 'story/moonleaf', name: 'Moonleaf' }], stacks: [{ id: 'it_aaaaaaa1', def: 'story/moonleaf', qty: 5 }],
    }));
    const commands = { ...fakeCommands, 'inventory.consume': () => ({ ok: false, code: 'NOT_ENOUGH', message: 'There is no Moonleaf left.' }) };
    const strict = makeHost(host.state, { commands });
    const before = structuredClone(strict.state);
    const result = strict.run(finish, { id: 'th_herbs001' });
    assert.equal(result.code, 'NOT_ENOUGH');
    assert.deepEqual(strict.state, before);
});

test('without RPG Battle a foes quest cannot be finished, and says why', () => {
    const host = takenWolves([]);
    const queries = { 'inventory.items': fakeQueries['inventory.items'] };
    const bare = makeHost(host.state, { queries });
    const result = bare.run(finish, { id: 'th_wolves01' });
    assert.equal(result.code, 'NOT_ENOUGH');
    assert.match(result.message, /No battle record/);
});

test('the transaction refuses drafts of domains the module does not own', () => {
    const host = makeHost(makeState({ threads: [wolvesOffer()] }), { owns: [] });
    assert.equal(host.run(take, { id: 'th_wolves01' }).code, 'NOT_OWNER');
});
