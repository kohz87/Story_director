// Story Block's coins (terms2, MODULES §F108): a quest's "reward: 5 silver" is 50 of the smallest coin
// when silver is worth 10; without coins a reward is its number, as before. Story Director alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { coinWorth, parseReward } from '../../../src/v2/quests/parse.js';

const COPPER = { name: 'copper', coins: [{ name: 'copper', plural: 'copper', value: 1 }, { name: 'silver', plural: 'silver', value: 10 }, { name: 'gold', plural: 'gold', value: 100 }] };
const reply = (text, lines) => `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>`;

test('a reward in a coin is counted in the smallest one; no coins: the chat\'s own word, never another coin', () => {
    assert.equal(parseReward({ reward: '5 silver' }, '', { currency: COPPER }).amount, 50);
    assert.equal(parseReward({ reward: '2 gold coins' }, '', { currency: COPPER }).amount, 200);
    assert.equal(parseReward({ reward: '50 copper' }, '', { currency: COPPER }).amount, 50);
    assert.equal(parseReward({ reward: '1 silver each wolf' }, '', { currency: COPPER }).amount, 10);
    // No coins (Story Block MODULES §F122): a coin the chat does not know is never read as its money.
    const unknown = parseReward({ reward: '5 silver' }, '', { currency: { name: 'gold' } });
    assert.equal(unknown.amount, null);
    assert.match(unknown.problem, /"silver" is not this chat's money, which counts in gold/);
    assert.equal(parseReward({ reward: '5 gold' }, '', { currency: { name: 'gold' } }).amount, 5);
    assert.equal(parseReward({ reward: '5 silver' }).amount, 5, 'a caller that gives no currency reads the number alone');
    assert.equal(coinWorth('silver', COPPER), 10);
    assert.equal(coinWorth('rope', COPPER), 1);
});

test('alone on the host with Story Block\'s coins: a quest paid in silver pays its worth in copper', async t => {
    t.mock.method(console, 'warn', () => {});
    let host = null;
    const module = createModule({ host: { settings: id => host?.sdk.settings(id) ?? null, substitute: text => host?.sdk.substitute(text) } });
    host = await createHost({ modules: [module], settings: { modules: { 'story-block': { currency: 'copper', coins: [{ name: 'copper', value: 1 }, { name: 'silver', value: 10 }] } } } });
    t.after(() => host.close());
    await host.send('Hello.', reply('The square.', ['~ place Harrow | kind: settlement', '+ present Orsa']));
    await host.send("I'll take it.", reply('Orsa nods.', ['+ quest Lost Letter — Orsa lost a letter | giver: Orsa | goal: Find the letter | reward: 3 silver']));
    await host.send('Here it is.', reply('Orsa pays.', ['~ quest Lost Letter | met: yes', '- quest Lost Letter — turned in']));
    assert.equal(host.sdk.query('inventory.wallet', {}).coin, 30);
});

test('the quest card names the reward as the wallet does: the row and the terms agree, in Story Block\'s coin words', async t => {
    t.mock.method(console, 'warn', () => {});
    let host = null;
    const module = createModule({ host: { settings: id => host?.sdk.settings(id) ?? null, substitute: text => host?.sdk.substitute(text) } });
    // The reader's setting names the currency "penny"; the coins are copper bits and silver marks.
    host = await createHost({ modules: [module], settings: { modules: { 'story-block': { currency: 'penny', currencyPlural: 'pennies', coins: [{ name: 'copper bit', value: 1 }, { name: 'silver mark', value: 100 }] } } } });
    t.after(() => host.close());
    await host.send('Work?', reply('Elula has a bounty.', ['~ place Bluewatch | kind: settlement', '+ present Elula', '+ quest Sluice-Rat Bounty — rats in the sluices | giver: Elula | goal: beat 4 sluice-rats | reward: 30 copper bits']));
    const board = host.sdk.query('quest.board');
    const row = board.active.find(entry => entry.key === 'Sluice-Rat Bounty');
    assert.equal(row.reward, '30 copper bits');
    assert.equal(row.details.terms, 'beat 4 sluice-rats; 30 copper bits');
    // Mixed coins, largest first, as Story Block writes the wallet ("1 silver mark 30 copper bits").
    await host.send('More?', reply('A bigger job.', ['+ quest Weir Bounty — the weir | giver: Elula | goal: clear the weir | reward: 130 copper bits']));
    const weir = host.sdk.query('quest.board').active.find(entry => entry.key === 'Weir Bounty');
    assert.equal(weir.reward, '1 silver mark 30 copper bits');
    assert.match(weir.details.terms, /^1 silver mark 30 copper bits \(reward clamped to F-rank range: 10 copper bits–50 copper bits /);
    // The receipt the wallet writes uses the same words.
    await host.send('Done.', reply('Elula pays.', ['~ quest Sluice-Rat Bounty | met: yes', '- quest Sluice-Rat Bounty — turned in']));
    assert.equal(host.sdk.query('inventory.wallet', {}).coin, 30);
    const paid = host.sdk.receipts().map(entry => entry.receipt).find(receipt => /turns in Sluice-Rat Bounty/.test(receipt.summary));
    assert.match(paid.summary, /30 copper bits paid/);
});
