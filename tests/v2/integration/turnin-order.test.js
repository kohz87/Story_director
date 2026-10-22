// The story's turn-in is checked where the reply ends up (live play, beta candidate): Story Block reads a
// reply's lines in order, and the story wrote `- quest … — turned in` before the `~ place` / `+ present`
// lines that brought the party to the giver, so the place rule saw the old scene and refused. A turn-in the
// place alone refuses now waits in the reply's bookkeeping: a later Director line of the same reply pays it
// once the place rule holds, and the step before the next reply (`quest.settle`) pays or refuses it on the
// scene after all the reply's lines. Paid once (claim), within the reply's budget; swipe, Re-read and a
// middle delete give the state a live run gives.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { fakeRpgBattle } from './helpers/fake-rpg.js';

const TAIL_KEY = 'story_suite_tail_1';

const newHost = ({ rpg = fakeRpgBattle() } = {}) => createHost({ modules: [rpg, createModule()] });
const reply = (text, lines = []) => (lines.length ? `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);
const quest = host => host.sdk.query('director.thread', { key: 'Sluice-Rat Bounty' });
const details = host => host.sdk.query('quest.details', { id: quest(host).id });
const wallet = host => host.sdk.query('inventory.wallet', { owner: 'party' });
const receipts = host => host.sdk.receipts().map(entry => entry.receipt);
const turnIns = host => receipts(host).filter(receipt => /turns in Sluice-Rat Bounty/.test(receipt.summary));
const tails = host => host.st.promptLog.filter(entry => entry.key === TAIL_KEY && entry.value).map(entry => entry.value);
const problems = host => host.sdk.query('director.problems').filter(problem => problem.kind === 'turn-in');
const claims = host => Object.keys(host.head().meta.claims).filter(key => key.startsWith('quest:'));

const BOUNTY = '+ quest Sluice-Rat Bounty — Elula pays for sluice-rats | giver: Elula | goal: beat 4 sluice-rats | reward: 30 gold';
// The block the reader's reply had: the turn-in first, the move to the giver after it.
const TURN_IN = '- quest Sluice-Rat Bounty — turned in';
const TO_ELULA = ['~ place Bluewatch Village, Guild Office | kind: settlement | region: Bluewatch | with: Elula', '+ present Elula', '- present Old Hob'];

async function ok(promise) {
    const result = await promise;
    assert.equal(result.ok, true, result.message);
    return result;
}

// Taken on in the sluice tunnels (wild, Elula not there), the four rats beaten.
async function bountyDone(host) {
    await host.send('Any work?', reply('Elula has a bounty; you take it and go down.', ['+ present Elula', BOUNTY, '~ place Sluice Tunnels | kind: wild', '- present Elula', '+ present Old Hob', '~ time March 3, 8:00 am']));
    assert.ok(quest(host).taken, 'taken on');
    await ok(host.sdk.command('combat.win', { foes: [{ name: 'Sluice-Rat', count: 4 }] }));
    assert.equal(host.head().domains.scene.place.kind, 'wild');
}

function sameRebuilt(host) {
    const head = structuredClone(host.head());
    host.store.rebuild();
    assert.deepEqual(host.head(), head, 'rebuilt from what is stored, the same state');
}

test('the reader\'s block: turn-in before the place and present lines, then a time line: paid in that reply', async () => {
    const host = await newHost();
    await bountyDone(host);
    await host.send('Back to the guild.', reply('Elula counts the tails and pays.', [TURN_IN, ...TO_ELULA, '! time +15m']));
    assert.deepEqual(wallet(host), { coin: 30 });
    assert.deepEqual([quest(host).status, quest(host).ended.outcome], ['resolved', 'done']);
    assert.deepEqual(problems(host), [], 'no refusal');
    assert.equal(turnIns(host).length, 1);
    assert.equal(turnIns(host)[0].cause, 'story');
    assert.match(turnIns(host)[0].summary, /^Astra turns in Sluice-Rat Bounty: 4 sluice-rats beaten \(target 4\), 30 gold paid\. Story time: /);
    // Told to the next reply, and nothing waits for it.
    await host.send('Thanks.', reply('Elula nods.'));
    assert.match(tails(host).at(-1), /\[Happened\][\s\S]*Astra turns in Sluice-Rat Bounty/);
    assert.deepEqual(wallet(host), { coin: 30 });
    assert.equal(turnIns(host).length, 1, 'paid once');
    sameRebuilt(host);
    host.close();
});

test('turn-in before the place lines with no Director line after them: waits, then paid before the next reply', async () => {
    const host = await newHost();
    await bountyDone(host);
    await host.send('Back to the guild.', reply('Elula pays.', [TURN_IN, ...TO_ELULA]));
    assert.deepEqual(wallet(host), {}, 'not paid yet');
    assert.equal(quest(host).status, 'active');
    assert.deepEqual(problems(host), [], 'not refused');
    const shown = details(host);
    assert.equal(shown.waiting, true);
    assert.match(shown.status.text, /^Turned in by the story — checked where this reply ends up/);
    await host.send('Thanks.', reply('Elula nods.'));
    assert.deepEqual(wallet(host), { coin: 30 });
    assert.equal(quest(host).ended.outcome, 'done');
    const paid = turnIns(host);
    assert.equal(paid.length, 1);
    assert.equal(paid[0].cause, 'system');
    assert.equal(paid[0].type, 'quest.settle');
    // Kept on the reply that turned it in (the step ran before the next reply was written).
    assert.match(tails(host).at(-1), /\[Happened\][\s\S]*Astra turns in Sluice-Rat Bounty: 4 sluice-rats beaten \(target 4\), 30 gold paid\./);
    assert.equal(details(host).waiting, false);
    sameRebuilt(host);
    host.close();
});

test('place and present lines before the turn-in: paid at once, as before', async () => {
    const host = await newHost();
    await bountyDone(host);
    await host.send('Back to the guild.', reply('Elula pays.', [...TO_ELULA, TURN_IN]));
    assert.deepEqual(wallet(host), { coin: 30 });
    assert.equal(turnIns(host)[0].cause, 'story');
    assert.equal(details(host).waiting, false);
    host.close();
});

test('the giver arriving in the same reply, after the turn-in, in the wild: paid', async () => {
    const host = await newHost();
    await bountyDone(host);
    await host.send('Elula comes down.', reply('Elula climbs down and pays you in the tunnel.', [TURN_IN, '+ present Elula']));
    await host.send('Thanks.', reply('Elula nods.'));
    assert.deepEqual(wallet(host), { coin: 30 });
    assert.equal(quest(host).ended.outcome, 'done');
    host.close();
});

test('a reply that leaves the giver and turns in is still refused, once, with the reason', async () => {
    const host = await newHost();
    await host.send('Any work?', reply('Elula has a bounty.', ['~ place Guild Office | kind: settlement', '+ present Elula', BOUNTY]));
    await ok(host.sdk.command('combat.win', { foes: [{ name: 'Sluice-Rat', count: 4 }] }));
    await host.send('Off we go.', reply('You walk out to the sluices and call it done.', ['~ place Sluice Tunnels | kind: wild', '- present Elula', TURN_IN, '! time +1h']));
    assert.deepEqual(wallet(host), {});
    assert.deepEqual(problems(host), [], 'it waits for the end of the reply');
    await host.send('Hm.', reply('Nothing happens.'));
    assert.deepEqual(wallet(host), {});
    assert.equal(quest(host).status, 'active');
    const text = 'The story says Sluice-Rat Bounty was turned in, but it can only be turned in at a settlement or where Elula is; it stays open.';
    assert.deepEqual(problems(host).map(problem => problem.text), [text]);
    assert.match(tails(host).at(-1), /The story says Sluice-Rat Bounty was turned in, but it can only be turned in at a settlement or where Elula is; it stays open\./);
    // Nothing waits any more: another reply changes nothing and tells nothing again.
    await host.send('Hm?', reply('Still nothing.'));
    assert.equal(problems(host).length, 1);
    assert.equal(details(host).waiting, false);
    // Turned in later at the guild, it pays once.
    await host.send('Back.', reply('Elula pays.', [...TO_ELULA, TURN_IN]));
    assert.deepEqual(wallet(host), { coin: 30 });
    sameRebuilt(host);
    host.close();
});

test('swipe: the swiped reply takes its waiting turn-in and the payment back; the next swipe pays once', async () => {
    const host = await newHost();
    await bountyDone(host);
    await host.send('Back to the guild.', reply('Elula pays.', [TURN_IN, ...TO_ELULA, '! time +15m']));
    assert.deepEqual(wallet(host), { coin: 30 });
    await host.swipe('Elula is out; you wait.');
    assert.deepEqual(wallet(host), {});
    assert.equal(quest(host).status, 'active');
    assert.deepEqual(claims(host), []);
    assert.equal(details(host).waiting, false);
    await host.swipe(reply('Elula pays after all.', [TURN_IN, ...TO_ELULA]));
    assert.deepEqual(wallet(host), {}, 'waits for the end of the reply');
    // A swipe of the next reply does not pay it again (the step ran before it, on the reply that turned it in).
    await host.send('Thanks.', reply('Elula nods.'));
    assert.deepEqual(wallet(host), { coin: 30 });
    await host.swipe(reply('Elula smiles.'));
    assert.deepEqual(wallet(host), { coin: 30 });
    assert.equal(turnIns(host).length, 1);
    sameRebuilt(host);
    host.close();
});

test('Re-read: the reply read again gives the state the live run gave, paid once', async () => {
    for (const lines of [[TURN_IN, ...TO_ELULA, '! time +15m'], [TURN_IN, ...TO_ELULA]]) {
        const host = await newHost();
        await bountyDone(host);
        await host.send('Back to the guild.', reply('Elula pays.', lines));
        await host.send('Thanks.', reply('Elula nods.'));
        const live = structuredClone(host.head());
        assert.deepEqual(wallet(host), { coin: 30 });
        const index = host.st.ctx.chat.length - 3;
        await ok(host.sdk.reread(index));
        assert.deepEqual(wallet(host), { coin: 30 });
        assert.equal(turnIns(host).length, 1, 'paid once');
        assert.deepEqual(host.head().domains.director.threads, live.domains.director.threads);
        assert.deepEqual(host.head().domains.inventory.wallets, live.domains.inventory.wallets);
        sameRebuilt(host);
        host.close();
    }
});

test('a middle delete: an earlier reply deleted, the turn-in still paid once on replay', async () => {
    for (const lines of [[TURN_IN, ...TO_ELULA, '! time +15m'], [TURN_IN, ...TO_ELULA]]) {
        const host = await newHost();
        await bountyDone(host);
        await host.send('Look around.', reply('A quiet tunnel.', ['+ hook Dripping Pipe — something drips', '! time +5m']));
        await host.send('Back to the guild.', reply('Elula pays.', lines));
        await host.send('Thanks.', reply('Elula nods.'));
        assert.deepEqual(wallet(host), { coin: 30 });
        const hook = host.st.ctx.chat.findIndex(message => /A quiet tunnel/.test(String(message?.mes ?? '')));
        await host.st.deleteMessage(hook);
        assert.deepEqual(wallet(host), { coin: 30 });
        assert.equal(quest(host).ended.outcome, 'done');
        assert.equal(turnIns(host).length, 1);
        assert.equal(host.sdk.query('director.thread', { key: 'Dripping Pipe' }), null);
        sameRebuilt(host);
        host.close();
    }
});

test('the reply\'s budget still holds a turn-in that waited, and a click cannot settle one', async () => {
    const host = await newHost();
    await bountyDone(host);
    await host.send('Back to the guild.', reply('Elula pays.', [TURN_IN, ...TO_ELULA]));
    const refused = await host.sdk.command('quest.settle', { id: quest(host).id });
    assert.equal(refused.ok, false);
    await host.send('Thanks.', reply('Elula nods.'));
    assert.deepEqual(wallet(host), { coin: 30 });
    // Asked again (no turn-in waits), it is refused and pays nothing.
    assert.equal((await host.sdk.command('quest.settle', { id: quest(host).id })).ok, false);
    assert.deepEqual(wallet(host), { coin: 30 });
    host.close();
});

test('Story Director alone (no fights module): the goal is the story\'s word; the waiting turn-in pays once', async () => {
    const host = await createHost({ modules: [createModule()] });
    await host.send('Any work?', reply('Elula has a bounty.', [BOUNTY, '~ place Sluice Tunnels | kind: wild']));
    await host.send('Back to the guild.', reply('Elula pays.', [TURN_IN, ...TO_ELULA]));
    assert.equal(details(host).waiting, true);
    await host.send('Thanks.', reply('Elula nods.'));
    assert.equal(quest(host).ended.outcome, 'done');
    assert.equal(turnIns(host).length, 1);
    assert.match(turnIns(host)[0].summary, /goal met/);
    sameRebuilt(host);
    host.close();
});
