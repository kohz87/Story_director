// Beta fuzz cell, a1 pass 2 (C1-6): story time moved by a deleted reply stays moved. `! time +2h` is
// stored as an absolute `replace /domains/director/time/minutes` (no `was`, not a counter), so when the
// reader deletes the reply that moved the clock, every later reply keeps its absolute time: reply A
// (+2h) then reply B (+3h); delete A → the clock still reads +5h (expected +3h, B's own jump). What hangs
// on the clock moves with it: timed effects' `until`, clocks/beats/agendas due, the day digest, market
// days. Invariant 2 (a delete undoes that reply's changes); coin and qty rebase since B3-8.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { fakeRpgBattle } from '../integration/helpers/fake-rpg.js';

const reply = (text, lines = []) => (lines.length ? `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);

test('C1-6: deleting the reply that moved the clock takes its time back', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ modules: [fakeRpgBattle(), createModule()] });
    t.after(() => host.close());
    await host.send('Hello.', reply('The road.', ['~ time 3 March 1200, 08:00']));
    const minutes = () => host.head().domains.director.time.minutes;
    const t0 = minutes();
    assert.ok(Number.isInteger(t0), 'setup: the clock is set');
    await host.send('We walk.', reply('Two hours on foot.', ['! time +2h']));
    await host.send('We wait.', reply('Three hours pass.', ['! time +3h']));
    assert.equal(minutes() - t0, 300, 'setup: +5h');
    const a = host.ctx.chat.length - 3;     // the +2h reply, and its user message
    await host.st.deleteMessage(a);
    await host.st.deleteMessage(a - 1);
    assert.deepEqual(host.store.problems(), [], 'the chat replays with no problem');
    assert.equal(minutes() - t0, 180, `only the +3h is left (actual +${(minutes() - t0) / 60}h: the deleted reply's +2h stayed)`);
});

// Smallfix: `~ time <date>` is a set (Story Block's ctx.absolute): deleting a reply that moved the clock
// before it leaves the set exact, and moves after it add on top.
test('a ~ time set after a deleted earlier move stays exact; later moves add on top', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ modules: [createModule()] });
    t.after(() => host.close());
    const minutes = () => host.head().domains.director.time.minutes;
    await host.send('Hello.', reply('The road.', ['~ time 3 March 1200, 08:00']));
    const t0 = minutes();
    await host.send('We walk.', reply('Two hours on foot.', ['! time +2h']));
    const a = host.ctx.chat.length - 1;
    await host.send('Dawn.', reply('Next morning.', ['~ time 4 March 1200, 06:00']));
    const set = minutes();
    assert.equal(set - t0, 22 * 60);
    // The same date again is still a set (written even when the clock holds it).
    await host.send('Still dawn.', reply('Nothing moves.', ['~ time 4 March 1200, 06:00']));
    await host.send('We wait.', reply('Three hours pass.', ['! time +3h']));
    assert.equal(minutes(), set + 180);
    await host.st.deleteMessage(a);
    await host.st.deleteMessage(a - 1);
    assert.deepEqual(host.store.problems(), []);
    assert.equal(minutes(), set + 180, 'the set is exact: the deleted +2h before it changes nothing after it');
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live, 'rebuild == live');
});

// Smallfix: time.settle closing a thread whose reply is later deleted from the middle: the closing is
// passed over on replay (Story Block's ctx.ifThere, SPEC §2.2 rule d) and the rest of the settle (the
// check, the time) still applies, so no block is skipped.
test('a settle that lapsed a thread made by a deleted reply keeps the rest of its block', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ modules: [createModule()] });
    t.after(() => host.close());
    const director = () => host.head().domains.director;
    await host.send('Hello.', reply('The road.', ['~ time June 3, 1200, 08:00 am', '+ hook Wells — mind the wells | giver: Brom | due: June 6, 1200']));
    await host.send('A job.', reply('Fenna has work.', ['+ hook Rats — clear the cellar | giver: Fenna | due: June 4, 1200']));
    const a = host.ctx.chat.length - 1;
    await host.send('We wait.', reply('Days pass.', ['! time +9d']));
    await host.send('Then?', reply('Later.', ['! time +1h']));
    const byName = name => Object.values(director().threads).find(thread => thread.key === name);
    assert.equal(byName('Rats')?.status, 'resolved', 'setup: time lapsed Rats');
    assert.equal(byName('Wells')?.status, 'resolved', 'setup: and Wells');
    await host.st.deleteMessage(a);
    await host.st.deleteMessage(a - 1);
    assert.deepEqual(host.store.problems(), [], 'the settle block still applies');
    assert.equal(byName('Rats'), undefined, 'the deleted quest is gone, no ghost');
    assert.equal(byName('Wells').status, 'resolved', 'the other closing in that settle stays');
    assert.equal(director().checked?.[0]?.minutes, director().time.minutes - 60, 'the settle\'s check (after the +9d) stands');
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live, 'rebuild == live');
});
