// Beta-candidate fixes, Story Director alone (no RPG Battle, WAVE rule 11):
// B-a1-6: a Continue is the same reply (Story Block keeps its record ID, ctx.carrier.sid), so the reply's
// turn count and its tallies (`added`, the clock's `from` for maxJump) go on, and a Re-read after a
// Continue gives the turn live gave. B-a1-16: a reward in a coin the chat does not have pays nothing
// code counts, and a Problem says why.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { replyTurn, turnNumber } from '../../../src/v2/tracker/domain.js';

const reply = (text, lines = []) => `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const director = host => host.head().domains.director;
const turnOf = host => ({ n: turnNumber(director(host)), ...replyTurn(director(host)) });

test('a Continue keeps the reply\'s turn: one turn count, the tallies go on, Re-read gives the same', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ modules: [createModule()] });
    t.after(() => host.close());
    await host.send('Morning.', reply('Dawn.', ['~ time March 3, 8:00 am']));
    await host.send('Go on.', reply('A rumour.', ['+ hook Sheepfold Wolves — wolves take sheep', '! time +20d']));
    const before = turnOf(host);
    assert.equal(before.added, 1, 'setup: the reply added one thread');
    await host.cont(reply(' Another.', ['+ hook Missing Miller — the miller is gone', '! time +20d']));
    const live = turnOf(host);
    assert.equal(live.n, before.n, 'a Continue is not another turn');
    assert.equal(live.reply, before.reply, 'the same reply');
    assert.equal(live.added, 2, 'the Continue\'s thread counts with the reply\'s');
    assert.equal(live.from, before.from, 'the clock\'s cap counts from where the reply began');
    const start = director(host).time.minutes;
    assert.ok(start - before.from <= 30 * 1440, 'maxJump holds for the reply and its Continue');
    await host.turn.reread(host.ctx.chat.length - 1);
    assert.deepEqual(turnOf(host), live, 'Re-read after a Continue gives the turn live gave');
    // The next reply is a new turn with fresh tallies.
    await host.send('Next.', reply('Night.', ['+ hook Old Well — something below']));
    assert.equal(turnOf(host).n, live.n + 1);
    assert.equal(turnOf(host).added, 1);
});

test('a reward in a coin the chat lacks pays nothing code counts and is told; mixed coins add up', async t => {
    t.mock.method(console, 'warn', () => {});
    let host = null;
    const module = createModule({ host: { settings: id => host?.sdk.settings(id) ?? null, substitute: text => host?.sdk.substitute(text) } });
    host = await createHost({ modules: [module], settings: { modules: { 'story-block': { currency: 'copper', coins: [{ name: 'copper', value: 1 }, { name: 'silver', value: 10 }, { name: 'gold', value: 100 }] } } } });
    t.after(() => host.close());
    await host.send('Hello.', reply('The square.', ['~ place Harrow | kind: settlement', '+ present Orsa']));
    await host.send("I'll take both.", reply('Orsa nods.', [
        '+ quest Lost Letter — Orsa lost a letter | giver: Orsa | goal: Find the letter | reward: 2 platinum',
        '+ quest Lost Ring — Orsa lost a ring | giver: Orsa | goal: Find the ring | reward: 1 gold and 5 silver',
    ]));
    const threads = Object.values(director(host).threads ?? {});
    const letter = threads.find(thread => thread.key === 'Lost Letter');
    const ring = threads.find(thread => thread.key === 'Lost Ring');
    assert.equal(letter.reward?.amount ?? null, null, 'an unknown coin is not read as copper');
    assert.equal(ring.reward?.amount, 150, '1 gold and 5 silver is 150 copper');
    const told = Object.values(director(host).problems ?? {}).filter(problem => problem.kind === 'reward-coin');
    assert.equal(told.length, 1, 'one Problem, for the letter');
    assert.match(told[0].text, /Lost Letter.*"platinum" is not a coin here/);
});
