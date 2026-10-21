// Quests part: the rank ladder (F86) and rewards held inside a rank's range (F87).
import test from 'node:test';
import assert from 'node:assert/strict';
import { part } from '../../../src/v2/quests/index.js';
import { DEFAULT_RANKS, holdReward, ladderFrom, rankNamed, rankOf, ranksOf, rewardByPlace } from '../../../src/v2/quests/ranks.js';
import { fakeQueries, makeHost, makeState, quest } from './helpers/fake-ctx.js';

const ranks = part.queries['quest.ranks'];
const finish = part.commands['quest.finish'];
const take = part.commands['quest.take'];
const settlement = { place: { name: 'Bluewatch', kind: 'settlement' } };

// Ersveil's shape (Story_block#72): records one pack after another, tagged `pack`, lowest first.
const ERSVEIL = [
    { id: 'F', title: 'Registered', levels: [1, 5], reward: [50, 400], pack: 'ersveil' },
    { id: 'E', title: 'Journeyman', levels: [6, 12], reward: [800, 3000], pack: 'ersveil' },
    { id: 'S', title: 'Legend', pack: 'ersveil' },
    { id: 'X', title: 'Other pack', levels: [1, 99], reward: [1, 2], pack: 'other' },
];
// RPG Battle's level tiers (`party.ranks`): no rewards of their own.
const SOUL = [
    { id: 'soul-1', title: 'Soul Class I', levels: [1, 10] },
    { id: 'soul-2', title: 'Soul Class II', levels: [11, 20] },
    { id: 'soul-3', title: 'Soul Class III', levels: [21, 30] },
];

test('F86: the built-in ladder F to S, level bands to about 60, rewards about ×4.5 a rank from 10–50', () => {
    const ladder = ranks(makeState(), {}, { query: () => { throw new Error('no packs'); } });
    assert.deepEqual(ladder.map(rank => rank.id), ['F', 'E', 'D', 'C', 'B', 'A', 'S']);
    assert.deepEqual(ladder[0], { id: 'F', title: 'F-rank', levels: [1, 5], reward: [10, 50] });
    assert.deepEqual(ladder.at(-1).levels, [51, 60]);
    for (let i = 1; i < ladder.length; i += 1) {
        assert.equal(ladder[i].levels[0], ladder[i - 1].levels[1] + 1, 'bands touch');
        assert.equal(ladder[i].reward[0], ladder[i - 1].reward[1], 'reward ranges touch');
        const step = ladder[i].reward[1] / ladder[i - 1].reward[1];
        assert.ok(step >= 4 && step <= 5, `×${step}`);
    }
    // A plain copy each time.
    ladder[0].reward[0] = 999;
    assert.equal(DEFAULT_RANKS[0].reward[0], 10);
    assert.equal(ranks(makeState(), {}, null)[0].reward[0], 10, 'no tools at all');
});

test('F86: the first enabled pack\'s ranks win, complete; a missing reward or band is filled by place', () => {
    const query = name => (name === 'packs.content' ? ERSVEIL : name === 'party.ranks' ? SOUL : null);
    const ladder = ranksOf(query);
    assert.deepEqual(ladder.map(rank => [rank.id, rank.title]), [['F', 'Registered'], ['E', 'Journeyman'], ['S', 'Legend']]);
    assert.deepEqual(ladder[1].reward, [800, 3000]);
    assert.deepEqual(ladder[2].reward, rewardByPlace(2), 'no reward: by place');
    assert.deepEqual(ladder[2].levels, [13, 20], 'no levels: the built-in band at that place');
    // Pack-prefixed ids are read as their slug.
    assert.deepEqual(ladderFrom([{ id: 'pack.mini/d', slug: 'd', levels: [1, 2], reward: [3, 4] }]).map(rank => rank.id), ['D']);
});

test('F86: without pack ranks, RPG Battle\'s party.ranks with rewards by place; without either, the default', () => {
    const calls = [];
    const query = (name, args) => {
        calls.push(name);
        if (name === 'packs.content') return [];
        if (name === 'party.ranks') return SOUL;
        throw new Error('unknown');
    };
    const ladder = ranksOf(query);
    assert.deepEqual(calls, ['packs.content', 'party.ranks']);
    assert.deepEqual(ladder, [
        { id: 'soul-1', title: 'Soul Class I', levels: [1, 10], reward: [10, 50] },
        { id: 'soul-2', title: 'Soul Class II', levels: [11, 20], reward: [50, 230] },
        { id: 'soul-3', title: 'Soul Class III', levels: [21, 30], reward: [230, 1000] },
    ]);
    // RPG Battle not running, or answering junk: the built-in ladder.
    assert.deepEqual(ranksOf(name => { if (name === 'party.ranks') throw new Error('UNKNOWN'); return null; }).map(rank => rank.id), DEFAULT_RANKS.map(rank => rank.id));
    assert.deepEqual(ranksOf(name => (name === 'party.ranks' ? [null, { title: '' }, 'x'] : [])).map(rank => rank.id), DEFAULT_RANKS.map(rank => rank.id));
});

test('F86: rank: or difficulty: names a rank by id or title, any case, with or without the word rank', () => {
    const ladder = ranksOf(() => null);
    for (const value of ['D', 'd', 'D-rank', 'rank D', 'D rank', 'Rank: D']) assert.equal(rankNamed(value, ladder)?.id, 'D', value);
    assert.equal(rankNamed('easy', ladder), null, 'easy/normal/hard are not ranks');
    assert.equal(rankNamed('', ladder), null);
    const soul = ranksOf(name => (name === 'party.ranks' ? SOUL : []));
    for (const value of ['II', 'ii', 'Soul Class II', 'soul-2']) assert.equal(rankNamed(value, soul)?.id, 'soul-2', value);
    assert.equal(rankNamed('I', soul)?.id, 'soul-1', 'a whole last word, not a letter of III');
    assert.equal(rankOf({ fields: { rank: 'C' } }, ladder).id, 'C');
    assert.equal(rankOf({ fields: { difficulty: 'B' } }, ladder).id, 'B');
    assert.equal(rankOf({ fields: { difficulty: 'hard' } }, ladder), null);
});

test('F87: holdReward keeps a total inside the range; nothing in money is never raised', () => {
    const rank = { id: 'D', title: 'D-rank', reward: [230, 1000] };
    assert.deepEqual(holdReward(5000, rank), { total: 1000, held: true });
    assert.deepEqual(holdReward(5, rank), { total: 230, held: true });
    assert.deepEqual(holdReward(500, rank), { total: 500, held: false });
    assert.deepEqual(holdReward(0, rank), { total: 0, held: false });
    assert.deepEqual(holdReward(null, rank), { total: null, held: false });
    assert.deepEqual(holdReward(5000, null), { total: 5000, held: false });
});

// The player character's level: a written rank is held to one above the party's own (D at 13–20 is the
// party's own, so a written D is paid as D).
const atLevel = (state, level) => {
    if (Number.isSafeInteger(level)) state.domains.party.actors.ac_astra001.level = level;
    return state;
};

function rankedHost(fields, { level = 13, ...more } = {}, queries = fakeQueries) {
    const host = makeHost(atLevel(makeState({ threads: [quest('th_wolves01', 'Wolves', { giver: 'Orsa', ...fields }, { offer: true })], scene: settlement, rev: 10, ...more }), level), { queries });
    assert.equal(host.run(take, { id: 'th_wolves01' }).ok, true);
    host.state.domains.combat.beaten = [{ rev: 12, foes: [{ name: 'Wolf', count: 3 }], won: true }];
    return host;
}

test('F87: a ranked quest\'s reward above its range is held at turn-in, and the receipt says so', () => {
    const host = rankedHost({ goal: 'Kill 3 wolves', reward: '5000 gold', rank: 'D' });
    const take2 = makeHost(atLevel(makeState({ threads: [quest('th_x0000001', 'X', { goal: 'Kill 3 wolves', reward: '5000 gold', rank: 'D' }, { offer: true })] }), 13)).run(take, { id: 'th_x0000001' });
    assert.equal(take2.receipt.summary, 'Astra takes on X: beat 3 wolves; 5000 gold (reward clamped to D-rank range: 230–1000 gold (clamped from 5000 gold)); D-rank.', 'the terms line shows it');
    const done = host.run(finish, { id: 'th_wolves01' });
    assert.equal(done.ok, true, done.message);
    assert.equal(done.receipt.summary, 'Astra turns in Wolves: 3 wolves beaten (target 3), 1000 gold paid (reward clamped to D-rank range: 230–1000 gold (clamped from 5000 gold)).');
    assert.deepEqual(done.receipt.data.paid, { amount: 1000, said: 5000, rank: 'D', range: [230, 1000] });
    assert.deepEqual(host.state.domains.inventory.wallets.party, { coin: 1000 });
});

test('F87: a per-unit reward is held on its total; inside the range it is paid as written, unranked it is capped by its difficulty', () => {
    // 3 wolves × 100 = 300 is over F's 10–50; 3 × 10 = 30 is inside it.
    const each = rankedHost({ goal: 'Kill 3 wolves', reward: '100 gold each wolf', difficulty: 'F' });
    const paid = each.run(finish, { id: 'th_wolves01' });
    assert.equal(paid.receipt.data.paid.amount, 50);
    assert.match(paid.receipt.summary, /50 gold paid \(reward clamped to F-rank range: 10–50 gold \(clamped from 300 gold\)\)/);
    const inside = rankedHost({ goal: 'Kill 3 wolves', reward: '10 gold each wolf', rank: 'F' }).run(finish, { id: 'th_wolves01' });
    assert.deepEqual(inside.receipt.data.paid, { amount: 30 });
    assert.match(inside.receipt.summary, /30 gold paid\.$/);
    // B-b4-10: a quest with no rank takes one from its difficulty (hard: one above the party's F), and
    // only the top of that range holds: a small reward is paid as written, never raised.
    const unranked = rankedHost({ goal: 'Kill 3 wolves', reward: '5000 gold', difficulty: 'hard' }, { level: 1 }).run(finish, { id: 'th_wolves01' });
    assert.deepEqual(unranked.receipt.data.paid, { amount: 230, said: 5000, rank: 'E', range: [50, 230] });
    assert.match(unranked.receipt.summary, /230 gold paid \(reward clamped to E-rank range: 50–230 gold \(clamped from 5000 gold\)\)\.$/);
    const small = rankedHost({ goal: 'Kill 3 wolves', reward: '5 gold', difficulty: 'hard' }, { level: 1 }).run(finish, { id: 'th_wolves01' });
    assert.deepEqual(small.receipt.data.paid, { amount: 5 }, 'a rank from the difficulty is not a floor');
    const none = rankedHost({ goal: 'Kill 3 wolves', reward: 'none', rank: 'S' }).run(finish, { id: 'th_wolves01' });
    assert.equal(none.receipt.data.paid, null, 'reward: none stays none');
});

test('F87: the clamp follows the ladder in use: a pack\'s, or RPG Battle\'s tiers', () => {
    const packQueries = { ...fakeQueries, 'packs.content': () => ERSVEIL };
    const pack = rankedHost({ goal: 'Kill 3 wolves', reward: '20 gold', rank: 'Journeyman' }, {}, packQueries).run(finish, { id: 'th_wolves01' });
    assert.equal(pack.receipt.data.paid.amount, 800);
    assert.match(pack.receipt.summary, /reward clamped to Journeyman range: 800–3000 gold/);
    const rbQueries = { ...fakeQueries, 'party.ranks': () => SOUL };
    const rb = rankedHost({ goal: 'Kill 3 wolves', reward: '5000 gold', difficulty: 'II' }, {}, rbQueries).run(finish, { id: 'th_wolves01' });
    assert.equal(rb.receipt.data.paid.amount, 230);
    assert.match(rb.receipt.summary, /reward clamped to Soul Class II range: 50–230 gold/);
});
