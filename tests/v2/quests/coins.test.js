// Story Block's coins (terms2, MODULES §F108): a quest's "reward: 5 silver" is 50 of the smallest coin
// when silver is worth 10; without coins a reward is its number, as before. Story Director alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { coinWorth, parseReward } from '../../../src/v2/quests/parse.js';

const COPPER = { name: 'copper', coins: [{ name: 'copper', plural: 'copper', value: 1 }, { name: 'silver', plural: 'silver', value: 10 }, { name: 'gold', plural: 'gold', value: 100 }] };
const reply = (text, lines) => `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>`;

test('a reward in a coin is counted in the smallest one; no coins: the number, as before', () => {
    assert.equal(parseReward({ reward: '5 silver' }, '', { currency: COPPER }).amount, 50);
    assert.equal(parseReward({ reward: '2 gold coins' }, '', { currency: COPPER }).amount, 200);
    assert.equal(parseReward({ reward: '50 copper' }, '', { currency: COPPER }).amount, 50);
    assert.equal(parseReward({ reward: '1 silver each wolf' }, '', { currency: COPPER }).amount, 10);
    assert.equal(parseReward({ reward: '5 silver' }, '', { currency: { name: 'gold' } }).amount, 5);
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
