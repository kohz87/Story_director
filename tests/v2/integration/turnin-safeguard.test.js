// The turn-in safeguard (beta candidate, the user: "include the safeguard"):
// (a) while a quest is ready to turn in, the tail names it, its giver and where (at most two; the static
//     part stays byte-identical);
// (b) the afterCapture step turns a ready quest in from where things stand when the reply ends where it can
//     be turned in and shows it was (a quest line in turn-in words that does not close it, the story's own
//     `+ coin` equal to the reward, an item the reply gave named in the reward), paid at most once; the
//     story's own coin this reply is counted as the reward, never on top of it; a goal not met is never
//     closed;
// (c) the Quests setting "Story's-word turn-ins per reply" (1 by default, 1 to 5).
// Re-read gives what the live run gave; swipe and rebuild too.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { fakeRpgBattle } from './helpers/fake-rpg.js';

const STATIC_KEY = 'story_suite_static';
const TAIL_KEY = 'story_suite_tail_1';

const newHost = () => createHost({ modules: [fakeRpgBattle(), createModule()] });
const reply = (text, lines = []) => (lines.length ? `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);
const quest = (host, key = 'Sluice-Rat Bounty') => host.sdk.query('director.thread', { key });
const wallet = host => host.sdk.query('inventory.wallet', { owner: 'party' });
const receipts = host => host.sdk.receipts().map(entry => entry.receipt);
const turnIns = (host, key = 'Sluice-Rat Bounty') => receipts(host).filter(receipt => receipt.summary.includes(`turns in ${key}`));
const prompts = (host, key) => host.st.promptLog.filter(entry => entry.key === key && entry.value).map(entry => entry.value);
const lastTail = host => prompts(host, TAIL_KEY).at(-1) ?? '';

const BOUNTY = '+ quest Sluice-Rat Bounty — Elula pays for sluice-rats | giver: Elula | goal: beat 4 sluice-rats | reward: 30 gold';
const TO_ELULA = ['~ place Bluewatch Village Guild Office | kind: settlement | with: Elula', '+ present Elula', '- present Old Hob'];
const READY_LINE = 'Ready to turn in: Sluice-Rat Bounty (to Elula, at a settlement or where Elula is).';

async function ok(promise) {
    const result = await promise;
    assert.equal(result.ok, true, result.message);
    return result;
}

// Taken on in the sluice tunnels (wild, Elula not there), `beaten` of the four rats beaten.
async function bounty(host, beaten = 4) {
    await host.send('Any work?', reply('Elula has a bounty; you take it and go down.', ['+ present Elula', BOUNTY, '~ place Sluice Tunnels | kind: wild', '- present Elula', '+ present Old Hob']));
    await ok(host.sdk.command('combat.win', { foes: [{ name: 'Sluice-Rat', count: beaten }] }));
}

function sameRebuilt(host) {
    const head = structuredClone(host.head());
    host.store.rebuild();
    assert.deepEqual(host.head(), head, 'rebuilt from what is stored, the same state');
}

// ---- (a) the tail -------------------------------------------------------------------------------

test('(a) tail: a ready quest is named with its giver and where, only while ready; the static part does not change', async () => {
    const host = await newHost();
    await bounty(host, 3);
    await host.send('More?', reply('One rat left.'));
    assert.doesNotMatch(lastTail(host), /Ready to turn in/, 'not while the goal is not met');
    await ok(host.sdk.command('combat.win', { foes: [{ name: 'Sluice-Rat', count: 1 }] }));
    await host.send('Done?', reply('The last rat is gone.'));
    assert.ok(lastTail(host).includes(READY_LINE), lastTail(host));
    await host.send('Back to the guild.', reply('Elula pays.', [...TO_ELULA, '- quest Sluice-Rat Bounty — turned in']));
    assert.deepEqual(wallet(host), { coin: 30 });
    await host.send('Thanks.', reply('Elula nods.'));
    assert.doesNotMatch(lastTail(host), /Ready to turn in/, 'gone once turned in');
    assert.equal(new Set(prompts(host, STATIC_KEY)).size, 1, 'the static part is byte-identical reply to reply');
    host.close();
});

test('(a) tail: at most two ready quests, the latest, in one short line', async () => {
    const host = await createHost({ modules: [createModule()] });
    const quests = ['Lost Ring', 'Old Letter', 'Mill Ghost'].map((key, n) => `+ quest ${key} — a job | giver: Mara | goal: the job ${n} | reward: 5 gold`);
    await host.send('Work?', reply('Mara has three jobs.', ['~ place Old Well | kind: wild', ...quests]));
    await host.send('All done.', reply('Done.', ['~ quest Lost Ring | met: yes', '~ quest Old Letter | met: yes', '~ quest Mill Ghost | met: yes']));
    await host.send('Next.', reply('Night falls.'));
    const line = lastTail(host).split('\n').find(item => item.startsWith('Ready to turn in:'));
    assert.ok(line, lastTail(host));
    assert.equal((line.match(/\(to Mara, /g) ?? []).length, 2, line);
    assert.ok(line.length < 160, line);
    host.close();
});

// ---- (b) turned in from where things stand -------------------------------------------------------

test('(b) a quest line in turn-in words that does not close it, at the giver: turned in and paid once, in that reply', async () => {
    const host = await newHost();
    await bounty(host);
    await host.send('Back to the guild.', reply('Elula counts the tails.', [...TO_ELULA, '~ quest Sluice-Rat Bounty — Elula pays you']));
    assert.deepEqual(wallet(host), { coin: 30 });
    assert.equal(quest(host).ended?.outcome, 'done');
    const paid = turnIns(host);
    assert.equal(paid.length, 1);
    assert.deepEqual([paid[0].cause, paid[0].type, paid[0].afterCapture, paid[0].data.auto], ['system', 'quest.settle', true, true]);
    await host.send('Thanks.', reply('Elula nods.', ['~ quest Sluice-Rat Bounty — paid in full']));
    assert.deepEqual(wallet(host), { coin: 30 }, 'paid once');
    assert.equal(turnIns(host).length, 1);
    sameRebuilt(host);
    host.close();
});

test('(b) the story pays the reward itself with + coin and writes no turn-in: closed, the coin counted as the reward', async () => {
    const host = await newHost();
    await bounty(host);
    await host.send('Back to the guild.', reply('Elula pays you thirty gold.', [...TO_ELULA, '+ coin 30 | from: Elula']));
    assert.deepEqual(wallet(host), { coin: 30 }, 'the story\'s 30, nothing on top');
    assert.equal(quest(host).ended?.outcome, 'done');
    const [paid] = turnIns(host);
    assert.match(paid.summary, /30 gold paid \(30 gold of it the story's own coin this reply\)/);
    assert.deepEqual(paid.data.turnIn.paid, { amount: 0, story: 30 });
    sameRebuilt(host);
    host.close();
});

test('(b) no double pay: a turn-in line and the story\'s own + coin for it in one reply pay the reward once', async () => {
    for (const lines of [
        [...TO_ELULA, '- quest Sluice-Rat Bounty — turned in', '+ coin 30 | from: Elula'],
        [...TO_ELULA, '+ coin 30 | from: Elula', '- quest Sluice-Rat Bounty — turned in'],
        ['- quest Sluice-Rat Bounty — turned in', ...TO_ELULA, '+ coin 30 | from: Elula'],
    ]) {
        const host = await newHost();
        await bounty(host);
        await host.send('Back to the guild.', reply('Elula pays.', lines));
        assert.deepEqual(wallet(host), { coin: 30 }, lines.join(' / '));
        assert.equal(turnIns(host).length, 1);
        assert.equal(quest(host).ended?.outcome, 'done');
        sameRebuilt(host);
        const live = structuredClone(host.head().domains);
        await ok(host.sdk.reread(host.st.ctx.chat.length - 1));
        assert.deepEqual(host.head().domains, live, 'Re-read equals live');
        // The next reply is told one payment, and nothing more is paid.
        await host.send('Thanks.', reply('Elula nods.'));
        assert.deepEqual(wallet(host), { coin: 30 });
        sameRebuilt(host);
        host.close();
    }
});

test('(b) the story pays less than the reward with + coin: the rest is paid, never more than the reward in all', async () => {
    const host = await newHost();
    await bounty(host);
    await host.send('Back to the guild.', reply('Elula pays.', [...TO_ELULA, '+ coin 10', '- quest Sluice-Rat Bounty — turned in']));
    assert.deepEqual(wallet(host), { coin: 30 });
    host.close();
});

test('(b) the reward item handed over by the giver closes the quest', async () => {
    const host = await createHost({ modules: [createModule()] });
    await host.send('Work?', reply('Elula offers a draught for a ring.', ['+ present Elula', '+ quest Lost Ring — find Elula\'s ring | giver: Elula | goal: find the ring | reward: a Folk Bitter Draught', '~ place Old Well | kind: wild', '- present Elula']));
    await host.send('Found it.', reply('The ring glints in the mud.', ['~ quest Lost Ring | met: yes']));
    await host.send('Back.', reply('Elula hands you the draught.', [...TO_ELULA, '+ item Folk Bitter Draught | qty: 1']));
    assert.equal(quest(host, 'Lost Ring').ended?.outcome, 'done');
    assert.equal(turnIns(host, 'Lost Ring').length, 1);
    sameRebuilt(host);
    host.close();
});

test('(b) never closed: goal not met, away from the giver, or no sign it was turned in', async () => {
    // Three rats of four: turn-in words at the giver change nothing.
    let host = await newHost();
    await bounty(host, 3);
    await host.send('Back.', reply('Elula frowns.', [...TO_ELULA, '~ quest Sluice-Rat Bounty — Elula pays you', '+ coin 30']));
    assert.equal(quest(host).status, 'active');
    assert.equal(turnIns(host).length, 0);
    assert.deepEqual(wallet(host), { coin: 30 }, 'only the story\'s own coin');
    host.close();
    // Ready, but away from the giver and from a settlement.
    host = await newHost();
    await bounty(host);
    await host.send('Later.', reply('You rest in the tunnel.', ['~ quest Sluice-Rat Bounty — Elula pays you later', '+ coin 30']));
    assert.equal(quest(host).status, 'active');
    host.close();
    // Ready and at the giver, no turn-in words, no coin: it waits for the story.
    host = await newHost();
    await bounty(host);
    await host.send('Back.', reply('You greet Elula.', TO_ELULA));
    assert.equal(quest(host).status, 'active');
    assert.ok(host.sdk.query('quest.details', { id: quest(host).id }).status.text.startsWith('Ready to turn in'));
    host.close();
});

test('(b) Re-read gives what the live run gave; swipe takes the turn-in back; the next swipe pays once', async () => {
    const host = await newHost();
    await bounty(host);
    await host.send('Back to the guild.', reply('Elula pays you thirty gold.', [...TO_ELULA, '+ coin 30 | from: Elula']));
    const index = host.st.ctx.chat.length - 1;
    const live = structuredClone(host.head());
    await ok(host.sdk.reread(index));
    assert.deepEqual(host.head().domains, live.domains, 'Re-read equals live');
    assert.deepEqual(host.head().meta.claims, live.meta.claims);
    await host.swipe('Elula is out; you wait.');
    assert.deepEqual(wallet(host), {});
    assert.equal(quest(host).status, 'active');
    await host.swipe(reply('Elula pays after all.', [...TO_ELULA, '~ quest Sluice-Rat Bounty — handed in to Elula', '+ coin 30']));
    assert.deepEqual(wallet(host), { coin: 30 });
    assert.equal(turnIns(host).length, 1);
    await host.send('Thanks.', reply('Elula nods.'));
    assert.deepEqual(wallet(host), { coin: 30 });
    sameRebuilt(host);
    host.close();
});

// ---- (c) the setting ----------------------------------------------------------------------------

async function twoJudged(host) {
    await host.send('Work?', reply('Mara has two jobs.', [
        '~ place Old Well | kind: wild',
        '+ quest Lost Ring — find the ring | giver: Mara | goal: find the ring | reward: 5 gold',
        '+ quest Old Letter — find the letter | giver: Mara | goal: find the letter | reward: 5 gold',
    ]));
    await host.send('Back.', reply('Mara takes both.', ['~ place Mill Village | kind: settlement', '+ present Mara', '- quest Lost Ring — turned in', '- quest Old Letter — turned in']));
}

// Queries read the settings through the host (the live sdk in SillyTavern; here the testkit's).
async function alone() {
    let host = null;
    host = await createHost({ modules: [createModule({ host: { settings: id => host?.sdk.settings(id) ?? null, substitute: text => host?.sdk.substitute(text) } })] });
    return host;
}

test('(c) story\'s-word turn-ins per reply: 1 by default, the second waits; 2 lets both through; held to 1–5', async () => {
    let host = await alone();
    await twoJudged(host);
    assert.equal(quest(host, 'Lost Ring').ended?.outcome, 'done');
    assert.equal(quest(host, 'Old Letter').status, 'active');
    assert.ok(host.sdk.query('director.problems').some(problem => /only one quest on the story's word alone/.test(problem.text)));
    host.close();

    host = await alone();
    host.settings.set('story-director', 'quests.wordTurnIns', 2);
    await twoJudged(host);
    assert.equal(quest(host, 'Lost Ring').ended?.outcome, 'done');
    assert.equal(quest(host, 'Old Letter').ended?.outcome, 'done');
    assert.deepEqual(wallet(host), { coin: 10 });
    sameRebuilt(host);
    // Re-read gives the same.
    const live = structuredClone(host.head().domains);
    await ok(host.sdk.reread(host.st.ctx.chat.length - 1));
    assert.deepEqual(host.head().domains, live);
    host.close();

    host = await alone();
    host.settings.set('story-director', 'quests.wordTurnIns', 9);
    assert.ok(host.sdk.settings('story-director')['quests.wordTurnIns'] <= 5, 'held to at most 5');
    host.close();
});
