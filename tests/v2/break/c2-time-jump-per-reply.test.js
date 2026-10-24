// C2-5 (a2 pass 1): the maxJump ceiling (tracker/time.js MAX_JUMP_DAYS = 30, B-b1-15) holds per line,
// not per reply, so one reply that repeats "! time +30d" moves the clock 30 days per line: 150 lines
// (the change-line limit) are 4,500 days (12 years) in one reply.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { fakeRpgBattle } from '../integration/helpers/fake-rpg.js';

const reply = (text, lines = []) => `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>`;

test('one reply moves the story clock at most maxJump (30 days), however many time lines it repeats', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ modules: [fakeRpgBattle(), createModule()] });
    t.after(() => host.close());
    await host.send('Morning.', reply('Dawn.', ['~ time March 3, 8:00 am']));
    const before = host.store.head().domains.director.time.minutes;
    await host.send('We wait.', reply('Time passes.', Array.from({ length: 150 }, () => '! time +30d')));
    const days = (host.store.head().domains.director.time.minutes - before) / 1440;
    assert.ok(days <= 30, `one reply moved the clock ${days} days`);
});
