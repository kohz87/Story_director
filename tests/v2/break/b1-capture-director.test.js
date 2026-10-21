// Story Director capture findings from the b1-capture break round (B-b1-capture-13 … -16).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { fakeRpgBattle } from '../integration/helpers/fake-rpg.js';

const reply = (text, lines = []) => (lines.length ? `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);
const director = host => host.head().domains.director;

async function fresh(t, first = []) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ modules: [fakeRpgBattle(), createModule()] });
    t.after(() => host.close());
    await host.send('Hello.', reply('The road.', first));
    return host;
}

// B-b1-capture-13: thread names have no length limit and a reply may add any number of threads.
// 150 hooks with 2000-character names add about 4 MB to one reply; every reply after it pays for
// the director tail over all threads (tracker/note.js → src/note.js compose), so the per-reply
// cost grows without bound (invariant 8).
test('a 10000-character hook name is refused or cut to a sane length', async t => {
    const host = await fresh(t);
    await host.send('Rumours?', reply('Talk.', [`+ hook ${'L'.repeat(10000)} — a long rumour`]));
    const keys = Object.values(director(host).threads).map(thread => thread.key.length);
    assert.ok(keys.every(length => length <= 200), `thread key lengths: ${keys}`);
});

test('one reply cannot add 300 new threads', async t => {
    const host = await fresh(t);
    await host.send('Rumours?', reply('Everyone talks.', Array.from({ length: 300 }, (_, i) => `+ hook Rumour ${i} — talk`)));
    const count = Object.keys(director(host).threads).length;
    assert.ok(count <= 50, `${count} threads after one reply`);
});

// B-b1-capture-14: director.problems keeps the newest 50 with `.slice(-50)`, so once it is full
// every new problem makes the bus diff `replace` the whole array: each junk Director line then
// stores about 9 KB of ops (150 such lines: 2 MB in one reply, twice with swipe_info).
test('a Director problem once the list is full stores a small op, not the whole list', async t => {
    const host = await fresh(t);
    // The clock is not set, so every "! time" line is a problem.
    await host.send('Wait.', reply('Time passes.', Array.from({ length: 60 }, () => '! time +1h')));
    await host.send('Wait more.', reply('More time.', ['! time +1h']));
    const index = host.store.headIndex();
    const bytes = JSON.stringify(host.store.opsAt(index)).length;
    assert.ok(bytes < 2000, `one problem line stored ${bytes} bytes of ops`);
});

// B-b1-capture-15: a time jump has no ceiling: `! time +99999999999d` moves the clock about
// 274 million years in one line, lapsing every deadline and agenda (runaway time).
test('a single ! time line cannot move the clock by millions of years', async t => {
    const host = await fresh(t, ['~ time June 3, 1200, 08:00 am']);
    const before = director(host).time.minutes;
    await host.send('We wait.', reply('Ages pass.', ['! time +99999999999d']));
    const moved = director(host).time.minutes - before;
    assert.ok(moved < 100 * 365 * 24 * 60, `the clock moved ${moved} minutes`);
});

// B-b1-capture-16: a clock time that is not a time ("25:99 pm") is read as midnight of the same
// day, so the clock goes back eight hours with no Problem.
test('~ time with an impossible clock time leaves the clock alone and is a Problem', async t => {
    const host = await fresh(t, ['~ time June 3, 1200, 08:00 am']);
    const before = director(host).time.minutes;
    await host.send('What time is it?', reply('Late.', ['~ time June 3, 1200, 25:99 pm']));
    assert.equal(director(host).time.minutes, before);
});

// B-b1-capture-17: the tracker keeps every label under thread.fields by its written name, and
// Story Block's generic op rules (checkOps: `qty` must be a whole number, `id` / `*_id` must be
// IDs) apply to any key of that name, so a quest line that also says `| qty: 3` or `| id: …` is
// refused whole, with an internal message ("…/fields/qty: qty must be a whole number").
test('a quest line with a "qty" or "id" label is still taken', async t => {
    const host = await fresh(t);
    await host.send('Work?', reply('Fenna wants pelts.', [
        '+ quest Pelts — bring pelts | giver: Fenna | goal: Bring 3 pelts | reward: 10 gold | qty: 3',
        '+ hook Wolves — on the ridge | id: wolves-1',
    ]));
    const keys = Object.values(director(host).threads).map(thread => thread.key).sort();
    assert.deepEqual(keys, ['Pelts', 'Wolves'], JSON.stringify(host.turn.problems().map(problem => problem.message)));
});
