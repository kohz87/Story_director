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
