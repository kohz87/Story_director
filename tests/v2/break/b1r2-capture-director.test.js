// b1-capture round 2 (Story Director): findings against 1303ac9 on its vendored host (moved here as
// written; B-b1r2-9 was fixed by #86, B-b1r2-14 was Story Block's, #86).
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

// B-b1r2-7: atlas routes and landmarks have no per-reply or total limit (threads got one, the atlas
// did not); each route line queries the pack world through ctx.query, which clones the whole state,
// so after five replies of 150 routes the sixth takes about 14 s and a plain reply about 4.7 s.
test('one reply cannot add 150 routes', async t => {
    const host = await fresh(t);
    await host.send('Map it.', reply('Roads everywhere.', Array.from({ length: 150 }, (_, i) => `+ route A${i} — B${i} | hours: 2 | kind: road`)));
    const routes = Object.keys(host.head().domains.atlas.routes).length;
    assert.ok(routes <= 20, `${routes} routes after one reply`);
});

// B-b1r2-8 (B-b1-capture-13 partly fixed): 16 new threads per reply and names cut to size, but the
// total has no limit and every reply composes the director tail over all of them: after 40 replies of
// 16 quests (640 threads) a reply with no changes takes about 1.8 s, growing with the chat.
test('40 replies of new quests do not leave 640 threads in every later state and tail build', async t => {
    const host = await fresh(t, ['~ time June 3, 1200, 08:00 am']);
    for (let r = 0; r < 40; r += 1) {
        await host.send('More work?', reply('Notices.', Array.from({ length: 16 }, (_, i) => `+ hook Q${r}x${i} — job | giver: G | goal: Kill 3 rats | reward: 5 gold`)));
    }
    const started = performance.now();
    await host.send('And then?', 'Quiet.');
    const ms = performance.now() - started;
    const count = Object.keys(director(host).threads).length;
    // 640 threads measured 0.8–1.8 s for a reply with no changes (it was 0.1 s at 128).
    assert.ok(count <= 300, `${count} threads kept; a plain reply took ${Math.round(ms)} ms`);
});

// B-b1r2-9: a quest whose goal code cannot count is paid on the story's word alone (`~ hook | met:
// yes`, then `- hook — turned in`), and the payout is code's own, so it is not held to the story
// coin budget: 16 quests offered and accepted in one reply, all turned in the next, pay 16 rewards.
test('deleting an early reply keeps the threads later replies made', async t => {
    const host = await fresh(t, ['~ time June 3, 1200, 08:00 am']);
    await host.send('a', reply('A.', ['+ hook Alpha — x']));
    const a = host.store.headIndex();
    await host.send('b', reply('B.', ['+ hook Bravo — y', '+ hook Rats — cellar | giver: Fenna | goal: Kill 3 rats | reward: 5 gold']));
    await host.send('c', reply('C.', ['+ hook Charlie — z']));
    await host.st.deleteMessage(a);
    await host.st.deleteMessage(a - 1);
    const keys = Object.values(director(host).threads).map(thread => thread.key).sort();
    assert.deepEqual(keys, ['Bravo', 'Charlie', 'Rats'], JSON.stringify(host.store.problems().map(problem => problem.message)));
});

// B-b1r2-14: replay after a middle delete applies a later reply's block without the domain checks
// a command gets (store.js replay), so a route a later reply drew to a landmark the deleted reply
// made survives with nothing at its end: the head state fails the atlas's own validator.
// Story Block's to fix (B-b1r2-14: replay runs the domains' validators on each block, Story Block #86).
test('after deleting the reply that made a landmark, the head state is still valid', async t => {
    const host = await fresh(t, ['~ time June 3, 1200, 08:00 am']);
    await host.send('a', reply('A.', ['+ landmark Alton | region: Vale | kind: town']));
    const a = host.store.headIndex();
    await host.send('b', reply('B.', ['+ route Alton — Brigg | hours: 2 | kind: road']));
    await host.st.deleteMessage(a);
    await host.st.deleteMessage(a - 1);
    const state = host.head();
    const errors = host.registry.validator('atlas')(state.domains.atlas, state);
    assert.deepEqual(errors, []);
});
