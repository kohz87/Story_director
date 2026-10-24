// B-a1-6 (a1, story-suite break pass 2): the maxJump ceiling per reply (C2-5, tracker/time.js
// MAX_JUMP_DAYS 30, "maxJump holds for the whole reply") resets on every Continue. capture.js beginTurn
// starts a fresh reply when a line's index is at or below the last one read (`index <= turn.index`), and
// a Continue's lines are numbered from 0 again, so each Continue of the same reply gets another 30 days.
// Two Continues moved one reply's clock 90 days.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { fakeRpgBattle } from '../integration/helpers/fake-rpg.js';

const reply = (text, lines = []) => `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>`;

test('a reply and its Continues move the story clock at most maxJump (30 days) in all', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ modules: [fakeRpgBattle(), createModule()] });
    t.after(() => host.close());
    await host.send('Morning.', reply('Dawn.', ['~ time March 3, 8:00 am']));
    const before = host.store.head().domains.director.time.minutes;
    await host.send('We wait.', reply('Time passes.', ['! time +30d']));
    const one = (host.store.head().domains.director.time.minutes - before) / 1440;
    assert.equal(one, 30, 'the reply itself moves 30 days');
    await host.cont(reply(' More time passes.', ['! time +30d']));
    await host.cont(reply(' And more.', ['! time +30d']));
    const days = (host.store.head().domains.director.time.minutes - before) / 1440;
    assert.ok(days <= 30, `one reply and its Continues moved the clock ${days} days`);
});
