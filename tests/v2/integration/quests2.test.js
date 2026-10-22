// Quests that follow the story, on the real Story Block v2 host (tests/vendor/story-block): the story's
// turn-in checked and paid by code (F94/F95), goals the story judges (F83), details with the receipts that
// touched a quest (F84), the rank ladder from RPG Battle's tiers (F86/F87), held offers (F88), and the
// Director screen's clock line and stale offer Problems.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { fakeRpgBattle } from './helpers/fake-rpg.js';

const TAIL_KEY = 'story_suite_tail_1';

const SOUL = [
    { id: 'soul-1', title: 'Soul Class I', levels: [1, 10] },
    { id: 'soul-2', title: 'Soul Class II', levels: [11, 20] },
];

function rpgWithRanks() {
    const rpg = fakeRpgBattle();
    return { ...rpg, queries: { ...rpg.queries, 'party.ranks': () => SOUL } };
}

const newHost = ({ rpg = fakeRpgBattle(), ...options } = {}) => createHost({ modules: [rpg, createModule()], ...options });
const reply = (text, lines = []) => (lines.length ? `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);
const quest = (host, key) => host.sdk.query('director.thread', { key });
const wallet = host => host.sdk.query('inventory.wallet', { owner: 'party' });
const tails = host => host.st.promptLog.filter(entry => entry.key === TAIL_KEY && entry.value).map(entry => entry.value);
const receipts = host => host.sdk.receipts().map(entry => entry.receipt);

async function ok(promise) {
    const result = await promise;
    assert.equal(result.ok, true, result.message);
    return result;
}

const RATS = '+ quest Granary Rats — Fenna wants the cellar cleared | giver: Fenna | goal: Kill 3 cellar rats | reward: 2 gold each';

async function ratsTaken(host) {
    await host.send('Any work in Bluewatch?', reply('Fenna looks up. "Rats," she says.', ['~ place Bluewatch | kind: settlement', '+ present Fenna', RATS]));
    assert.equal(quest(host, 'Granary Rats').offer, true);
    await host.send('I\'ll take the rat job.', reply('Fenna hands you a lantern.', [RATS]));
    const rats = quest(host, 'Granary Rats');
    assert.ok(rats.taken, 'taken in the reader\'s own words');
    return rats;
}

test('F94/F95: the story turns a quest in; code checks the fights and the place, pays once, and the next reply hears it', async () => {
    const host = await newHost();
    const rats = await ratsTaken(host);
    await ok(host.sdk.command('combat.win', { foes: [{ name: 'Cellar Rat', count: 3 }] }));
    await host.send('I bring Fenna the tails.', reply('Fenna counts the tails and pays.', ['- quest Granary Rats — turned in to Fenna']));
    assert.deepEqual(wallet(host), { coin: 6 });
    const done = quest(host, 'Granary Rats');
    assert.deepEqual([done.status, done.ended.outcome], ['resolved', 'done']);
    const turnIns = receipts(host).filter(receipt => /turns in Granary Rats/.test(receipt.summary));
    assert.equal(turnIns.length, 1, 'one receipt');
    assert.equal(turnIns[0].summary, 'Astra turns in Granary Rats: 3 cellar rats beaten (target 3), 6 gold paid.');
    assert.equal(turnIns[0].cause, 'story');
    // XP once, through RPG Battle.
    assert.equal(host.head().domains.party.xpLog.filter(entry => entry.quest === rats.id).length, 1);
    // No double pay: Finish later is refused, and so is the story saying it again.
    assert.equal((await host.sdk.command('quest.finish', { key: 'Granary Rats' })).code, 'REFUSED');
    await host.send('Thanks.', reply('Fenna nods again.', ['- quest Granary Rats — turned in']));
    assert.deepEqual(wallet(host), { coin: 6 });
    assert.match(tails(host).at(-1), /\[Happened\][\s\S]*Astra turns in Granary Rats: 3 cellar rats beaten \(target 3\), 6 gold paid\./);
    // The details pop-up's history holds the receipts that touched the quest (F84).
    const details = host.sdk.query('quest.details', { key: 'Granary Rats' });
    assert.ok(details.history.some(entry => /turns in Granary Rats/.test(entry.text)));
    assert.ok(details.history.some(entry => /\+ quest Granary Rats/.test(entry.text)));
    // Rebuilt from what is stored, the same state.
    const head = structuredClone(host.head());
    host.store.rebuild();
    assert.deepEqual(host.head(), head);
    host.close();
});

test('F94: a turn-in the checks refuse keeps the quest open and unpaid, and tells the next reply why', async () => {
    const host = await newHost();
    await ratsTaken(host);
    await ok(host.sdk.command('combat.win', { foes: [{ name: 'Cellar Rat', count: 2 }] }));
    await host.send('Done, Fenna.', reply('Fenna pays you.', ['- quest Granary Rats — turned in']));
    const text = 'The story says Granary Rats was turned in, but only 2 of 3 cellar rats are beaten; it stays open.';
    assert.deepEqual(wallet(host), {});
    assert.equal(quest(host, 'Granary Rats').status, 'active');
    assert.ok(host.sdk.query('director.problems').some(problem => problem.kind === 'turn-in' && problem.text === text));
    await host.send('Hm?', 'Fenna frowns.');
    assert.ok(tails(host).at(-1).includes(text), 'told to the next reply');
    // The rest of the rats, and the story tries again: now it pays.
    await ok(host.sdk.command('combat.win', { foes: [{ name: 'Cellar Rat', count: 1 }] }));
    await host.send('Now?', reply('Fenna pays.', ['- quest Granary Rats — turned in']));
    assert.deepEqual(wallet(host), { coin: 6 });
    host.close();
});

test('F83/F94: a goal the story judges: met: yes makes it Ready on the board; the story\'s turn-in pays its reward', async () => {
    const host = await newHost();
    await host.send('Work?', reply('Mara is crying.', ['~ place Bluewatch | kind: settlement', '+ present Mara',
        '+ quest Lost Ring — Mara lost her ring | giver: Mara | goal: Find Mara\'s ring | reward: 20 gold']));
    await host.send('I\'ll take it, I\'ll find your ring.', reply('Mara thanks you.', ['+ quest Lost Ring — Mara lost her ring']));
    let row = host.sdk.query('quest.board').active.find(entry => entry.key === 'Lost Ring');
    assert.deepEqual(row.status, { state: 'notyet', text: 'Not yet: the story has not said its goal is met yet.' });
    await host.send('I search the well.', reply('A glint in the mud: the ring.', ['~ quest Lost Ring | met: yes | progress: found it in the well']));
    row = host.sdk.query('quest.board').active.find(entry => entry.key === 'Lost Ring');
    assert.deepEqual(row.status, { state: 'here', text: 'Ready to turn in — goal met' });
    assert.equal(row.note, 'found it in the well');
    assert.equal(host.sdk.query('quest.progress', { key: 'Lost Ring' }).ready, true);
    await host.send('Here, Mara.', reply('She slips it on.', ['- quest Lost Ring — returned to Mara']));
    assert.deepEqual(wallet(host), { coin: 20 });
    assert.equal(host.sdk.query('quest.board').finished[0].key, 'Lost Ring', 'kept in Finished');
    host.close();
});

test('F86/F87: with RPG Battle\'s tiers, quest.ranks is its ladder and a ranked reward is held at turn-in', async () => {
    const host = await newHost({ rpg: rpgWithRanks() });
    assert.deepEqual(host.sdk.query('quest.ranks').map(rank => [rank.id, rank.reward]), [['soul-1', [10, 50]], ['soul-2', [50, 230]]]);
    await host.send('Work?', reply('A notice.', ['~ place Bluewatch | kind: settlement',
        '+ quest Bandit Camp — clear the camp | giver: Reeve | goal: Kill 2 bandits | reward: 5000 gold | rank: II']));
    await host.send('I\'ll take the bandit job.', reply('The reeve nods.', ['+ quest Bandit Camp — clear the camp']));
    await ok(host.sdk.command('combat.win', { foes: [{ name: 'Bandit', count: 2 }] }));
    await host.send('Done.', reply('The reeve pays.', ['- quest Bandit Camp — turned in']));
    // RX-E-1: a level-1 party's written Soul Class II is held to its own Soul Class I.
    assert.deepEqual(wallet(host), { coin: 50 });
    const turnIn = receipts(host).find(receipt => /turns in Bandit Camp/.test(receipt.summary));
    assert.match(turnIn.summary, /50 gold paid \(reward clamped to Soul Class I range: 10–50 gold \(clamped from 5000 gold\)\) \(the story said Soul Class II; held to Soul Class I for a level-1 party\)/);
    host.close();
});

test('F88: a second offer soon after the first is held off the board until the cooldown passes', async () => {
    const host = await newHost();
    await host.send('Work?', reply('Two notices.', ['+ quest First Job — wolves | giver: Orsa | goal: Kill 2 wolves']));
    await host.send('More?', reply('Another.', ['+ quest Second Job — rats | giver: Hobb | goal: Kill 2 rats']));
    let board = host.sdk.query('quest.board');
    assert.deepEqual(board.offers.map(offer => offer.key), ['First Job']);
    assert.equal(board.heldCount, 1);
    assert.equal(quest(host, 'Second Job').offer, true, 'kept: the story\'s line is not lost');
    for (let i = 0; i < 5; i += 1) await host.send('Wait.', reply('Time passes.', ['! time +1h']));
    board = host.sdk.query('quest.board');
    assert.deepEqual(board.offers.map(offer => offer.key), ['First Job', 'Second Job']);
    host.close();
});

test('the Director screen: its clock line, and an offer Problem gone once the quest is taken on', async () => {
    const host = await newHost();
    await host.send('Work?', reply('Fenna has a job.', ['~ time March 3, 8:00 am', RATS]));
    assert.ok(host.sdk.query('director.problems').some(problem => problem.kind === 'offered'));
    await ok(host.sdk.command('quest.take', { key: 'Granary Rats' }));
    assert.equal(host.sdk.query('director.problems').some(problem => problem.kind === 'offered'), false);
    const director = host.registry.screens().find(screen => screen.id === 'story-director/director');
    assert.deepEqual(director.data.time, { query: 'director.time' });
    assert.match(host.sdk.query('director.time').text, /March 3/);
    host.close();
});

test('F94: a swipe of the reply that turned a quest in takes the payment back; the turn-in again pays once', async () => {
    const host = await newHost();
    await ratsTaken(host);
    await ok(host.sdk.command('combat.win', { foes: [{ name: 'Cellar Rat', count: 3 }] }));
    await host.send('Here are the tails.', reply('Fenna pays.', ['- quest Granary Rats — turned in']));
    assert.deepEqual(wallet(host), { coin: 6 });
    await host.swipe('Fenna is busy; come back later.');
    assert.deepEqual(wallet(host), {});
    assert.equal(quest(host, 'Granary Rats').status, 'active');
    assert.equal(Object.keys(host.head().meta.claims).some(key => key.startsWith('quest:')), false);
    await host.swipe(reply('Fenna pays after all.', ['- quest Granary Rats — turned in']));
    assert.deepEqual(wallet(host), { coin: 6 });
    host.close();
});
