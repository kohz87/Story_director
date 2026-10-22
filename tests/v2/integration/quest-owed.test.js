// A quest reward written in a coin word the chat cannot count yet ("30 copper bits" where the money is pennies
// and there is no Coins setting) is OWED (beta decision "A"): the quest closes as designed, the reward is kept
// on the quest (thread.owed, the story's words) and the Problem says so; once Story Block's coins count the
// word, the step `quest.payOwed` (system, after the reply's last story line, kept on that reply) pays it once,
// within the reply's story-money budget (what does not fit stays owed), and the next reply is told. Swipe,
// delete, Re-read and rebuild give what live gave; the story's own coin for the same reward is never paid on
// top of it; nothing is ever paid at a guessed rate.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { fakeRpgBattle } from './helpers/fake-rpg.js';

const TAIL_KEY = 'story_suite_tail_1';
const reply = (text, lines = []) => (lines.length ? `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);
const KEY = 'Sluice-Rat Bounty';
const PENNIES = { 'story-block': { currency: 'penny', currencyPlural: 'pennies' } };
const COPPER_BITS = [{ name: 'copper bit', plural: 'copper bits', value: 1 }, { name: 'silver bit', plural: 'silver bits', value: 10 }];
const quest = host => host.sdk.query('director.thread', { key: KEY });
const wallet = host => host.sdk.query('inventory.wallet', { owner: 'party' })?.coin ?? 0;
const receipts = host => host.sdk.receipts();
const payments = host => receipts(host).filter(entry => entry.receipt.type === 'quest.payOwed');
const prompts = (host, key) => host.st.promptLog.filter(entry => entry.key === key && entry.value).map(entry => entry.value);
const lastTail = host => prompts(host, TAIL_KEY).at(-1) ?? '';
const problems = host => Object.values(host.head().domains.director.problems ?? {});
const owedQuery = host => host.sdk.query('quest.owed', {});
const details = host => host.sdk.query('quest.details', { id: quest(host).id });
const HAPPENED = /\[Happened\][\s\S]*Elula's 30 copper bits for Sluice-Rat Bounty are paid/;

const TAKE = ['~ place Guild Office | kind: settlement', '+ present Elula',
    `+ quest ${KEY} — Elula pays for sluice-rats | giver: Elula | goal: clear the sluice | reward: 30 copper bits`];
const TURN_IN = `- quest ${KEY} — turned in`;

async function newHost({ modules = null, settings = PENNIES } = {}) {
    let host = null;
    const module = createModule({ host: { settings: id => host?.sdk.settings(id) ?? null, substitute: text => host?.sdk.substitute(text) } });
    host = await createHost({ modules: modules ? modules(module) : [module], settings: { modules: settings } });
    return host;
}

// The quest taken on and turned in, in a chat that cannot count "copper bits": closed, the reward owed.
async function owing(options) {
    const host = await newHost(options);
    await host.send('Any work?', reply('Elula has a bounty and you take it.', TAKE));
    await host.send('Done.', reply('Elula nods and counts out your pay.', [TURN_IN]));
    return host;
}

// A reply with one harmless story line: Story Block runs the afterCapture steps only after a reply that kept one.
let murmurs = 0;
const quiet = (text = 'Quiet.') => reply(text, [`+ hook Murmur ${(murmurs += 1)} — the town talks`]);
const addCoins = host => host.settings.set('story-block', 'coins', COPPER_BITS);

// The state without Story Block's click tally, which is keyed by the id of the receipt that paid: a Re-read runs
// the step again as a new receipt, so the key differs while what it counts is the same.
const withoutClickKeys = domains => {
    const copy = structuredClone(domains);
    if (copy.inventory?.storyClicks) copy.inventory.storyClicks = Object.fromEntries(Object.entries(copy.inventory.storyClicks).map(([sid, log]) => [sid, Object.values(log).reduce((a, b) => a + b, 0)]));
    return copy;
};

function sameRebuilt(host) {
    const head = structuredClone(host.head());
    host.store.rebuild();
    assert.deepEqual(host.head(), head, 'rebuilt from what is stored, the same state');
}

async function ok(promise) {
    const result = await promise;
    assert.equal(result.ok, true, result.message);
    return result;
}

test('closed with the reward owed: the quest card says so, the Problem is worded as owed, nothing is paid', async () => {
    const host = await owing();
    try {
        assert.equal(quest(host).ended?.outcome, 'done', 'the quest closes as it was designed');
        assert.equal(wallet(host), 0);
        assert.deepEqual(quest(host).owed, { text: '30 copper bits', rev: quest(host).ended.rev, units: 0 });
        assert.equal(details(host).owed.text, 'Reward owed: 30 copper bits (add copper bits in Settings → Coins)');
        const listed = owedQuery(host);
        assert.equal(listed.length, 1);
        assert.deepEqual([listed[0].key, listed[0].countable, listed[0].ask, listed[0].hint], [KEY, false, false, 'add copper bits in Settings → Coins']);
        const told = problems(host).filter(problem => problem.key === KEY);
        assert.deepEqual(told.map(problem => problem.kind), ['reward-owed'], 'one Problem for the quest, the take-on one became this');
        assert.match(told[0].text, /30 copper bits is owed, not paid by code/);
        const turnIn = receipts(host).map(entry => entry.receipt).find(item => item.summary.includes(`turns in ${KEY}`));
        assert.match(turnIn.summary, /30 copper bits is owed/);
        assert.deepEqual(turnIn.data.turnIn.owed, { text: '30 copper bits' });
        sameRebuilt(host);
    } finally {
        host.close();
    }
});

test('without Coins ever set it stays owed, reply after reply, and is never paid at a guessed rate', async () => {
    const host = await owing();
    try {
        for (const text of ['Days pass.', 'More days.', 'A last quiet one.']) await host.send('Go on.', quiet(text));
        assert.equal(wallet(host), 0);
        assert.equal(payments(host).length, 0);
        assert.equal(owedQuery(host).length, 1);
        assert.equal(details(host).owed.text, 'Reward owed: 30 copper bits (add copper bits in Settings → Coins)');
        // A coin the chat has, but not the word the story used: still owed.
        host.settings.set('story-block', 'coins', [{ name: 'penny', plural: 'pennies', value: 1 }, { name: 'shilling', plural: 'shillings', value: 12 }]);
        await host.send('Go on.', quiet('Another day.'));
        assert.equal(wallet(host), 0);
        assert.equal(details(host).owed.text, 'Reward owed: 30 copper bits (add copper bits in Settings → Coins)');
        sameRebuilt(host);
    } finally {
        host.close();
    }
});

test('Coins added later: paid once on the next reply, told to the one after, the Problem goes', async () => {
    const host = await owing();
    try {
        await host.send('Go on.', quiet('Nothing yet.'));
        assert.equal(wallet(host), 0);
        addCoins(host);
        await host.send('Next.', quiet('Elula calls after you.'));
        assert.equal(wallet(host), 30, 'paid in the reply written after the coins were added');
        const [paid] = payments(host);
        assert.deepEqual([payments(host).length, paid.receipt.cause, paid.receipt.afterCapture], [1, 'system', true]);
        assert.match(paid.receipt.summary, /^Elula's 30 copper bits for Sluice-Rat Bounty are paid \(/);
        assert.equal(details(host).owed, null, 'the card has nothing owed any more');
        assert.deepEqual(problems(host).filter(problem => problem.key === KEY), [], 'the Problem goes with the debt');
        assert.deepEqual(owedQuery(host), []);
        await host.send('And then?', quiet('The day goes on.'));
        assert.match(lastTail(host), HAPPENED, 'the next reply is told');
        await host.send('Again.', quiet('Quiet.'));
        assert.equal(wallet(host), 30, 'paid once');
        assert.equal(payments(host).length, 1);
        sameRebuilt(host);
        const live = JSON.stringify(host.head());
        await host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live);
    } finally {
        host.close();
    }
});

test('the reward is held to the story-money budget of one reply: the rest stays owed for the next', async () => {
    const host = await owing({ settings: { 'story-block': { ...PENNIES['story-block'], storyCoinPerReply: 20 } } });
    try {
        addCoins(host);
        await host.send('Next.', quiet('Elula calls after you.'));
        assert.equal(wallet(host), 20, 'what the reply may give');
        assert.equal(details(host).owed.text, 'Reward owed: 30 copper bits (1 silver bit of it still owed; paid as one reply allows)');
        assert.equal(owedQuery(host).length, 1);
        assert.match(payments(host)[0].receipt.summary, /2 silver bits paid now, 1 silver bit still owed/);
        await host.send('Then?', quiet('Quiet.'));
        assert.equal(wallet(host), 30, 'the rest, in the next reply');
        assert.equal(payments(host).length, 2);
        assert.equal(details(host).owed, null);
        assert.deepEqual(Object.values(quest(host).owed.paid), [20, 10]);
        await host.send('Again.', quiet('Quiet.'));
        assert.equal(wallet(host), 30, 'never more than the reward in all');
        assert.equal(payments(host).length, 2);
        sameRebuilt(host);
    } finally {
        host.close();
    }
});

test('the reply\'s own story coin uses the budget first: only what is left is paid', async () => {
    const host = await owing({ settings: { 'story-block': { ...PENNIES['story-block'], storyCoinPerReply: 25 } } });
    try {
        addCoins(host);
        await host.send('Next.', reply('A purse on the road.', ['+ coin 10 | from: a purse']));
        assert.equal(wallet(host), 25, 'the story\'s 10, and 15 of the 30 owed');
        assert.equal(details(host).owed.text, 'Reward owed: 30 copper bits (1 silver bit 5 copper bits of it still owed; paid as one reply allows)');
        await host.send('Then?', quiet('Quiet.'));
        assert.equal(wallet(host), 40);
        assert.equal(details(host).owed, null);
        sameRebuilt(host);
    } finally {
        host.close();
    }
});

test('a swipe of the paying reply pays again in the new one, never twice', async () => {
    const host = await owing();
    try {
        addCoins(host);
        await host.send('Next.', quiet('Elula calls after you.'));
        assert.equal(wallet(host), 30);
        await host.swipe(quiet('Elula waves from the door.'));
        assert.equal(wallet(host), 30, 'the swiped reply\'s payment went with it, the new reply paid it');
        assert.equal(payments(host).length, 1);
        await host.send('Then?', quiet('Quiet.'));
        assert.match(lastTail(host), HAPPENED);
        assert.equal(wallet(host), 30);
        sameRebuilt(host);
    } finally {
        host.close();
    }
});

test('a swipe to a reply that is cut off before the Coins existed pays nothing; the coins then pay in the next', async () => {
    const host = await owing();
    try {
        await host.send('Next.', quiet('Elula calls after you.'));
        assert.equal(wallet(host), 0);
        addCoins(host);
        await host.swipe(quiet('Elula waves from the door.'));
        assert.equal(wallet(host), 30, 'the swipe is a new reply: written after the coins were added');
        assert.equal(payments(host).length, 1);
        sameRebuilt(host);
    } finally {
        host.close();
    }
});

test('deleting the paying reply puts the reward back to owed, and the next reply pays it once', async () => {
    const host = await owing();
    try {
        addCoins(host);
        await host.send('Next.', quiet('Elula calls after you.'));
        assert.equal(wallet(host), 30);
        await host.st.deleteMessage(host.ctx.chat.length - 1);
        assert.equal(wallet(host), 0, 'the payment was kept on the deleted reply');
        assert.equal(details(host).owed.text, 'Reward owed: 30 copper bits (paid with the next reply)');
        assert.equal(owedQuery(host).length, 1);
        assert.equal(problems(host).filter(problem => problem.key === KEY && problem.kind === 'reward-owed').length, 1, 'the Problem is back');
        assert.deepEqual(host.store.problems(), []);
        sameRebuilt(host);
        await host.send('Again.', quiet('Elula calls after you.'));
        assert.equal(wallet(host), 30);
        assert.equal(payments(host).length, 1);
        sameRebuilt(host);
    } finally {
        host.close();
    }
});

test('deleting the exchange that turned the quest in, with the payment after it: the payment goes too, no crash', async () => {
    const host = await owing();
    try {
        addCoins(host);
        await host.send('Next.', quiet('Elula calls after you.'));
        assert.equal(wallet(host), 30);
        // The turn-in exchange is the third and fourth messages (greeting aside): delete it.
        const turnedIn = host.ctx.chat.findIndex(message => !message.is_user && message.mes.includes('counts out your pay'));
        await host.st.deleteMessage(turnedIn);
        await host.st.deleteMessage(turnedIn - 1);
        assert.equal(wallet(host), 0, 'no coin for a turn-in that was deleted');
        assert.equal(quest(host).ended, null, 'the quest is open again');
        assert.equal(quest(host).owed, undefined);
        sameRebuilt(host);
        const live = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live, 'rebuild == live');
        assert.deepEqual(owedQuery(host), []);
    } finally {
        host.close();
    }
});

test('Re-read of the paying reply gives what live gave', async () => {
    const host = await owing();
    try {
        addCoins(host);
        await host.send('Next.', quiet('Elula calls after you.'));
        const live = structuredClone(host.head().domains);
        await ok(host.sdk.reread(host.ctx.chat.length - 1));
        assert.deepEqual(withoutClickKeys(host.head().domains), withoutClickKeys(live), 'Re-read equals live');
        assert.equal(wallet(host), 30);
        assert.equal(payments(host).length, 1);
        await host.send('Then?', quiet('Quiet.'));
        assert.match(lastTail(host), HAPPENED);
        sameRebuilt(host);
    } finally {
        host.close();
    }
});

test('Re-read of the turn-in reply keeps the debt; once the coins pay it, that reply cannot be read again (it would pay twice)', async () => {
    const host = await owing();
    try {
        const turnedIn = host.ctx.chat.findIndex(message => !message.is_user && message.mes.includes('counts out your pay'));
        const before = structuredClone(host.head().domains);
        await ok(host.sdk.reread(turnedIn));
        assert.deepEqual(withoutClickKeys(host.head().domains), withoutClickKeys(before), 'the same debt');
        addCoins(host);
        await host.send('Next.', quiet('Elula calls after you.'));
        assert.equal(wallet(host), 30);
        const paid = structuredClone(host.head().domains);
        const refused = await host.sdk.reread(turnedIn);
        assert.equal(refused.ok, false, 'Story Block refuses a Re-read that a later payment depends on');
        assert.deepEqual(host.head().domains, paid, 'nothing changed');
        assert.equal(wallet(host), 30);
        sameRebuilt(host);
    } finally {
        host.close();
    }
});

test('the story\'s own coin with the turn-in counts as the reward: nothing is owed on top of it, either order', async () => {
    for (const lines of [[TURN_IN, '+ coin 30 | from: Elula'], ['+ coin 30 | from: Elula', TURN_IN]]) {
        const host = await newHost();
        try {
            await host.send('Any work?', reply('Elula has a bounty and you take it.', TAKE));
            await host.send('Done.', reply('Elula counts out your pay.', lines));
            assert.equal(wallet(host), 30, lines.join(' / '));
            addCoins(host);
            await host.send('Next.', quiet('Quiet.'));
            await host.send('Then?', quiet('Quiet.'));
            assert.equal(wallet(host), 30, `the 30 copper bits are not paid on top of the story's 30 (${lines.join(' / ')})`);
            assert.equal(details(host).owed, null);
            sameRebuilt(host);
            const live = structuredClone(host.head().domains);
            await ok(host.sdk.reread(host.ctx.chat.length - 3));
            assert.deepEqual(withoutClickKeys(host.head().domains), withoutClickKeys(live), 'Re-read equals live');
        } finally {
            host.close();
        }
    }
});

test('the story writes + coin for it in a later reply: the same amount as the reward is the reward, paid once', async () => {
    const host = await owing();
    try {
        addCoins(host);
        await host.send('Next.', reply('Elula presses a purse on you.', ['+ coin 30 | from: Elula']));
        assert.equal(wallet(host), 30, 'the story\'s coin, and no 30 on top');
        assert.equal(details(host).owed, null);
        await host.send('Then?', quiet('Quiet.'));
        assert.equal(wallet(host), 30);
        sameRebuilt(host);
    } finally {
        host.close();
    }
});

test('a reward the pack or the Coins setting counts at once is paid at the turn-in, nothing owed', async () => {
    const host = await newHost({ settings: { 'story-block': { ...PENNIES['story-block'], coins: COPPER_BITS } } });
    try {
        await host.send('Any work?', reply('Elula has a bounty and you take it.', TAKE));
        await host.send('Done.', reply('Elula counts out your pay.', [TURN_IN]));
        assert.equal(wallet(host), 30);
        assert.equal(quest(host).owed, undefined);
        assert.equal(payments(host).length, 0);
    } finally {
        host.close();
    }
});

test('a reward that is not money ("a horse") is not owed', async () => {
    const host = await newHost();
    try {
        await host.send('Any work?', reply('Elula has a bounty.', ['~ place Guild Office | kind: settlement', '+ present Elula', `+ quest ${KEY} — rats | giver: Elula | goal: clear the sluice | reward: a horse`]));
        await host.send('Done.', reply('Elula nods.', [TURN_IN]));
        assert.equal(quest(host).ended?.outcome, 'done');
        assert.equal(quest(host).owed, undefined);
        assert.deepEqual(owedQuery(host), []);
    } finally {
        host.close();
    }
});

test('two rewards owed are both paid; only code can pay: a click cannot', async () => {
    const host = await newHost({ settings: { 'story-block': { ...PENNIES['story-block'], storyCoinPerReply: 1000 } } });
    try {
        await host.send('Any work?', reply('Two jobs.', ['~ place Guild Office | kind: settlement', '+ present Elula',
            `+ quest ${KEY} — rats | giver: Elula | goal: clear the sluice | reward: 30 copper bits`,
            '+ quest Lost Ring — a ring | giver: Elula | goal: find the ring | reward: 4 silver bits']));
        await host.send('Done.', reply('Elula nods.', [TURN_IN]));
        await host.send('And the ring.', reply('Elula smiles.', ['- quest Lost Ring — turned in']));
        assert.equal(owedQuery(host).length, 2);
        const click = await host.sdk.command('quest.payOwed', { id: quest(host).id });
        assert.equal(click.ok, false, 'a click pays nothing');
        addCoins(host);
        await host.send('Next.', quiet('Quiet.'));
        assert.equal(wallet(host), 70);
        assert.equal(payments(host).length, 2);
        sameRebuilt(host);
    } finally {
        host.close();
    }
});

for (const [name, modules] of [['with RPG Battle', module => [fakeRpgBattle(), module]], ['without RPG Battle', module => [module]]]) {
    test(`${name}: owed, then paid once, and rebuilt`, async () => {
        const host = await owing({ modules });
        try {
            addCoins(host);
            await host.send('Next.', quiet('Quiet.'));
            await host.send('Then?', quiet('Quiet.'));
            assert.equal(wallet(host), 30);
            assert.equal(payments(host).length, 1);
            sameRebuilt(host);
        } finally {
            host.close();
        }
    });
}
