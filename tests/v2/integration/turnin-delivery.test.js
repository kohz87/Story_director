// Beta live test 5: a quest stuck at "Ready to turn in — goal met" after the delivery was narrated. The goal
// "bring the pack-leader's pelt to the council" (giver Elula) became met (`met: yes`) in a reply that ended at
// the Guild Office with Elula present and the pelt in the bag, but the story wrote no turn-in line and no coin.
// A delivery goal ("bring / deliver / take / return / carry … to …") the story says is met in a reply that ends
// where it can be turned in (the giver here or a settlement), with the thing delivered held by the party, given
// this reply, or a progress note that says it was brought or delivered, is handed in there: the afterCapture
// step turns it in (quest.autoTurnIns), paid once, within the reply's limits. Other cases keep the tail's
// "Ready to turn in" hint. The reader's exact two replies, with and without RPG Battle, Re-read and rebuild.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { deliveredThing } from '../../../src/v2/quests/index.js';
import { fakeRpgBattle } from './helpers/fake-rpg.js';

const TAIL_KEY = 'story_suite_tail_1';
const reply = (text, lines = []) => (lines.length ? `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);
const COINS = { 'story-block': { currency: 'copper', coins: [{ name: 'copper', value: 1 }, { name: 'silver', value: 10 }, { name: 'gold', value: 100 }] } };
const KEY = 'The North Cut Wolf';
const quest = host => host.sdk.query('director.thread', { key: KEY });
const wallet = host => host.sdk.query('inventory.wallet', { owner: 'party' })?.coin ?? 0;
const turnIns = host => host.sdk.receipts().map(entry => entry.receipt).filter(receipt => receipt.summary.includes(`turns in ${KEY}`));
const lastTail = host => host.st.promptLog.filter(entry => entry.key === TAIL_KEY && entry.value).map(entry => entry.value).at(-1) ?? '';

const TAKE = ['~ place Bluewatch Guild Office | kind: settlement | region: the Lowmere', '+ present Elula',
    `+ quest ${KEY} — Elula wants the ridge pack's leader dead | giver: Elula | goal: bring the pack-leader's pelt to the council | reward: 40 silver`,
    '~ place North Cut | kind: wild | region: the Lowmere'];
// The reader's two replies, exactly.
const FIRST = [
    '? check AGI — pursuing the wounded wolf through the cut | dc: 10 | roll: 1 | result: success',
    `~ quest ${KEY} | progress: Ridge wolf slain in North Cut; pelt ready to harvest`,
    '? loot Ridge Wolf Pelt, Wolf Fangs x2 — carcass of the ridge beast',
];
const SECOND = [
    '? check DEX — dress and skin the ridge wolf | dc: 10 | roll: 1 | result: success',
    '+ item Wolf Pelt | qty: 1 | note: heavy, grey-bristled, taken from the ridge beast',
    `~ quest ${KEY} | progress: pack-leader slain and pelt brought to guild | met: yes`,
    '~ place Bluewatch Guild Office | kind: settlement | region: the Lowmere',
    '+ present Elula',
];

async function play(modules, settings = COINS) {
    const host = await createHost({ modules, settings: { modules: settings } });
    await host.send('Any work?', reply('Elula slides a notice across the counter.', TAKE));
    await host.send('After the wolf.', reply('The wolf breaks from cover and falls.', FIRST));
    return host;
}

function sameRebuilt(host) {
    const head = structuredClone(host.head());
    host.store.rebuild();
    assert.deepEqual(host.head(), head, 'rebuilt from what is stored, the same state');
}

for (const [name, modules] of [['with RPG Battle', () => [fakeRpgBattle(), createModule()]], ['without RPG Battle', () => [createModule()]]]) {
    test(`the reader's two replies (${name}): ready after the first, handed in and paid in the second, once`, async () => {
        const host = await play(modules());
        assert.equal(quest(host).ended, null, 'not over after the first reply');
        assert.equal(wallet(host), 0);
        await host.send('Skin it and bring it in.', reply('You slam the pelt on Elula\'s counter.', SECOND));
        assert.equal(quest(host).ended?.outcome, 'done', 'turned in in the second reply');
        const paid = turnIns(host);
        assert.equal(paid.length, 1);
        assert.deepEqual([paid[0].cause, paid[0].type, paid[0].afterCapture, paid[0].data.auto], ['system', 'quest.settle', true, true]);
        const coin = wallet(host);
        assert.ok(coin > 0 && coin <= 400, `paid in code's numbers, at most the 40 silver: ${coin}`);
        // The next reply says it again: paid once.
        await host.send('Thanks.', reply('Elula counts out the coin.', [`~ quest ${KEY} | progress: pelt delivered, paid | met: yes`, '+ present Elula']));
        assert.equal(wallet(host), coin, 'paid once');
        assert.equal(turnIns(host).length, 1);
        assert.doesNotMatch(lastTail(host), /Ready to turn in/);
        sameRebuilt(host);
        host.close();
    });
}

test('Re-read of the second reply gives the live state; a swipe without the delivery takes the turn-in back', async () => {
    const host = await play([fakeRpgBattle(), createModule()]);
    await host.send('Skin it and bring it in.', reply('You slam the pelt on Elula\'s counter.', SECOND));
    const live = structuredClone(host.head());
    const at = host.ctx.chat.length - 1;
    assert.equal((await host.turn.reread(at)).ok, true);
    // Receipt ids are new on a Re-read; what the rules hold is the same.
    for (const domain of ['director', 'scene', 'party']) assert.deepEqual(host.head().domains[domain], live.domains[domain], `Re-read of the unchanged reply: ${domain}`);
    assert.deepEqual(host.head().domains.inventory.wallets, live.domains.inventory.wallets);
    assert.equal(turnIns(host).length, 1);
    await host.swipe(reply('You are still skinning the wolf.', SECOND.slice(0, 2)));
    assert.equal(quest(host).ended, null, 'the swipe without it: still open');
    assert.equal(wallet(host), 0);
    sameRebuilt(host);
    host.close();
});

test('not handed in: met away from the giver, nothing delivered in sight, a goal that is not a delivery', async () => {
    // Met in the wild, then at the giver a reply later: the tail's hint, no turn-in on its own.
    let host = await play([createModule()]);
    await host.send('Skin it.', reply('The pelt is yours.', [SECOND[1], SECOND[2]]));
    await host.send('Back to town.', reply('The guild office is warm.', SECOND.slice(3)));
    assert.equal(quest(host).ended, null, 'met in an earlier reply: not on arriving alone');
    assert.match(lastTail(host) + (await host.send('Wait.', reply('Elula is busy.')), lastTail(host)), /Ready to turn in: The North Cut Wolf/);
    host.close();
    // At the giver, met this reply, but no pelt held or given and the note says nothing of bringing it.
    host = await play([createModule()]);
    await host.send('Report.', reply('You tell Elula the wolf is dead.', [`~ quest ${KEY} | progress: the pack-leader is dead | met: yes`, ...SECOND.slice(3)]));
    assert.equal(quest(host).ended, null, 'nothing delivered in sight');
    host.close();
    // Not a delivery goal.
    host = await createHost({ modules: [createModule()], settings: { modules: COINS } });
    await host.send('Work?', reply('Elula has a job.', [...TAKE.slice(0, 2), '+ quest Quiet Ridge — clear the ridge | giver: Elula | goal: drive the wolves off the ridge | reward: 5 silver', TAKE[3]]));
    await host.send('Done.', reply('Back at the guild.', ['+ item Wolf Pelt', '~ quest Quiet Ridge | progress: wolves gone, pelt brought back | met: yes', ...SECOND.slice(3)]));
    assert.equal(host.sdk.query('director.thread', { key: 'Quiet Ridge' }).ended, null, 'not a delivery: the hint stays');
    host.close();
});

test('a reward in a coin the chat does not know: handed in, nothing paid by code, the reader told', async () => {
    const host = await play([createModule()], { 'story-block': { currency: 'penny', currencyPlural: 'pennies' } });
    const board = host.sdk.query('quest.board').active.find(row => row.key === KEY);
    assert.equal(board.reward, '40 silver', 'the story\'s words, never "40 pennies"');
    assert.match(board.details.terms, /^40 silver; not paid by code: "silver" is not this chat's money, which counts in pennies/);
    await host.send('Skin it and bring it in.', reply('You slam the pelt on Elula\'s counter.', SECOND));
    assert.equal(quest(host).ended?.outcome, 'done');
    assert.equal(wallet(host), 0, 'never 40 pennies');
    const problems = Object.values(host.head().domains.director.problems).map(problem => problem.text);
    // The take-on Problem became the owed one when the quest closed: the reward is owed, not lost (quest-owed.test.js).
    assert.ok(problems.some(line => /40 silver is owed, not paid by code: "silver" is not a coin this chat counts/.test(line)), JSON.stringify(problems));
    assert.ok(!problems.some(line => /the reward is not counted/.test(line)), 'one Problem for the quest, worded as owed');
    host.close();
});

test('deliveredThing: the head word of what a delivery goal brings', () => {
    const of = goal => deliveredThing({ fields: { goal } });
    assert.equal(of('bring the pack-leader\'s pelt to the council'), 'pelt');
    assert.equal(of('Deliver the sealed letters to Captain Orsa'), 'letter');
    assert.equal(of('return the ring back to Mara'), 'ring');
    assert.equal(of('take 5 moonleaf to Fenna'), 'moonleaf');
    assert.equal(of('beat 3 wolves'), '');
    assert.equal(of('drive the wolves off the ridge'), '');
});
