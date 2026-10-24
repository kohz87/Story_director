// SD-r2fix2: Story Director fixes from the b1-capture re-break (round 2) and b7-combos R2-1.
// * B-b1r2-12: bookkeeping later replies rewrite never depends on what an earlier reply wrote (turn,
//   problems, the time part's settle and recap, the chronicle's picks, the quests' vouched mark), and a
//   line no longer rewrites threads it did not change.
// * B-b1r2-7: the atlas adds at most NEW_PER_REPLY places and routes a reply, MAX_PLACES / MAX_ROUTES
//   in all, and reads the packs' world once per reply.
// * B-b1r2-8: the tail reads the live threads only; at most MAX_OPEN_THREADS are open.
// * Names: invisible format marks and other normal forms are one name in the tracker, atlas, chronicle.
// * B-b7r2-1: the module says which Story Block it needs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../vendor/story-block/testkit/index.js';
import { satisfies } from '../../vendor/story-block/src/v2/packs/version.js';
import { STORY_BLOCK_RANGE, createModule } from '../../../src/v2/module.js';
import { MAX_PLACES, NEW_PER_REPLY, applyLandmarkLine, applyRouteLine } from '../../../src/v2/atlas/capture.js';
import { initialAtlas } from '../../../src/v2/atlas/domain.js';
import { MAX_OPEN_THREADS } from '../../../src/v2/tracker/capture.js';
import { PROBLEM_ROOM, problemList, replyTurn } from '../../../src/v2/tracker/domain.js';
import { IDLE_REPLIES, tailThreads } from '../../../src/v2/tracker/note.js';
import { seenOf } from '../../../src/v2/chronicle/domain.js';
import { slotValue } from '../../../src/v2/slot.js';
import { fakeRpgBattle } from '../integration/helpers/fake-rpg.js';
import { makeState, reply as trackerReply } from '../tracker/helpers/fake-ctx.js';

const said = (text, lines = []) => (lines.length ? `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);
const director = host => host.head().domains.director;
const keys = host => Object.values(director(host).threads).map(entry => entry.key).sort();

async function fresh(t, first = []) {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ modules: [fakeRpgBattle(), createModule()] });
    t.after(() => host.close());
    await host.send('Hello.', said('The road.', first));
    return host;
}

// Deletes the exchange (the reader's message and the reply) whose reply is at `index`.
async function deleteExchange(host, index) {
    await host.st.deleteMessage(index);
    await host.st.deleteMessage(index - 1);
}

// ---- B-b1r2-12: a deleted reply never takes a later reply's lines with it ------------------------------

test('deleting an early reply keeps every later reply\'s threads, problems, settles and picks', async t => {
    const host = await fresh(t, ['~ time June 3, 1200, 08:00 am']);
    await host.send('Any work? I take it.', said('A.', [
        '+ hook Alpha — x', '? hook Bad A — asks', '+ hook Rats — cellar | giver: Fenna | goal: Kill 3 rats | reward: 5 gold',
        '+ world Plague — fever | state: ongoing', '+ world Drought — dry | state: ongoing', '! time +3d',
    ]));
    const a = host.store.headIndex();
    await host.send('More work? I take it.', said('B.', [
        '+ hook Bravo — y', '? hook Bad B — asks', '+ hook Wolves — ridge | giver: Fenna | goal: Kill 2 wolves | reward: 5 gold',
        '+ world War — north | state: ongoing', '+ world Riots — south | state: ongoing', '+ world Flood — east | state: ongoing', '! time +3d',
    ]));
    await host.send('And?', said('C.', ['+ hook Charlie — z', '- hook Bravo — gone', '? hook Bad C — asks', '~ world War | state: resolved', '! time +2h']));
    await host.send('Then?', said('D.', ['+ hook Delta — w']));
    assert.ok(slotValue(director(host).checked), 'the time part settled');
    assert.ok(slotValue(host.head().domains.chronicle.surfaced), 'the chronicle picked');

    await deleteExchange(host, a);
    assert.deepEqual(host.store.problems().map(problem => problem.why), [], 'every later block still applies');
    assert.deepEqual(keys(host), ['Bravo', 'Charlie', 'Delta', 'Wolves']);
    assert.equal(Object.values(director(host).threads).find(entry => entry.key === 'Bravo').status, 'resolved');
    assert.deepEqual(problemList(director(host)).filter(problem => problem.kind === 'unread').map(problem => problem.key), ['Bad B', 'Bad C']);
    assert.equal(host.head().domains.chronicle.events[Object.keys(host.head().domains.chronicle.events).find(id => host.head().domains.chronicle.events[id].name === 'War')].state, 'resolved');
    // Rebuilt and replayed on a fresh host, the state is the same.
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live);
    const again = await createHost({ modules: [fakeRpgBattle(), createModule()] });
    t.after(() => again.close());
    await again.st.loadChat(structuredClone(host.ctx.chat));
    assert.equal(JSON.stringify(again.head().domains), JSON.stringify(host.head().domains));
    assert.deepEqual(again.store.problems(), []);
    // The next reply goes on as usual.
    await host.send('Next.', said('E.', ['+ hook Echo — v']));
    assert.deepEqual(keys(host), ['Bravo', 'Charlie', 'Delta', 'Echo', 'Wolves']);
});

test('the reply\'s bookkeeping and each problem are written whole, never inside what an earlier reply wrote', async t => {
    const host = await fresh(t, ['~ time June 3, 1200, 08:00 am']);
    await host.send('a', said('A.', ['+ hook Alpha — x', '? hook Bad — y']));
    const records = host.ctx.chat.map(message => message.extra?.storySuite).filter(Boolean);
    await host.send('b', said('B.', ['+ hook Bravo — y', '? hook Worse — z']));
    const ops = host.ctx.chat.at(-1).extra.storySuite.ops.filter(op => op.path.startsWith('/domains/director/'));
    assert.ok(records.length > 0);
    for (const op of ops) {
        const path = op.path.slice('/domains/director/'.length);
        const ok = /^(threads|keys)\//.test(path) || ['turn/n', 'turn/now', 'time/minutes', 'checked', 'recap'].includes(path) || /^problems\/\d+\.\d+$/.test(path);
        assert.ok(ok, `${op.op} ${op.path}`);
        if (/^(turn\/now|checked|recap)$/.test(path)) assert.equal(op.op, 'replace', `${op.path} is written whole`);
        if (path.startsWith('problems/')) assert.equal(op.op, 'add', `${op.path}: a problem is added under its own key`);
    }
    assert.equal(replyTurn(director(host)).added, 1);
});

test('the problems keep the newest 100, each under its own key, and show the newest 50', async t => {
    const host = await fresh(t);
    for (let r = 0; r < 12; r += 1) await host.send(`r${r}`, said('x', Array.from({ length: 10 }, (_, i) => `? hook Q${r}x${i} — asks`)));
    const kept = problemList(director(host));
    assert.equal(kept.length, PROBLEM_ROOM);
    assert.equal(kept[0].key, 'Q2x0');
    assert.equal(kept.at(-1).key, 'Q11x9');
    assert.ok(Object.keys(director(host).problems).every(key => /^\d+\.\d+$/.test(key)));
    const shown = host.sdk.query('director.problems');
    assert.equal(shown.length, 50);
    assert.match(shown.at(-1).text, /Q11x9/);
});

test('an older state\'s bare turn and problem list are read, and moved on the next write', () => {
    let state = makeState();
    const old = structuredClone(state);
    old.domains.director.turn = { n: 4, reply: 'r4', index: 0, from: null, quests: [], lone: null, added: 2 };
    old.domains.director.problems = [{ rev: 1, turn: 4, kind: 'unread', text: 'old one' }];
    assert.equal(replyTurn(old.domains.director).added, 2);
    assert.equal(problemList(old.domains.director)[0].text, 'old one');
    state = trackerReply(old, '+ hook Fresh — new', { carrier: 9 }).state;
    assert.equal(state.domains.director.turn.n, 5);
    assert.ok(Array.isArray(state.domains.director.turn.now));
    assert.equal(replyTurn(state.domains.director).added, 1);
    state = trackerReply(state, '? hook Bad — asks', { carrier: 10 }).state;
    assert.deepEqual(problemList(state.domains.director).map(problem => problem.text.slice(0, 7)), ['old one', '"? hook']);
});

// ---- B-b1r2-7: atlas limits and one pack read a reply ----------------------------------------------------

test('one reply adds at most 16 new places and 16 new routes; a known place or route is still changed', async t => {
    const host = await fresh(t);
    await host.send('Map it.', said('Landmarks.', Array.from({ length: 20 }, (_, i) => `+ landmark Spot ${i} | region: Vale | kind: town`)));
    const atlas = () => host.head().domains.atlas;
    assert.equal(Object.keys(atlas().places).length, NEW_PER_REPLY);
    assert.ok(host.turn.problems().some(problem => /one reply adds at most 16 new places/.test(problem.message)));
    await host.send('Roads.', said('Roads.', [...Array.from({ length: 18 }, (_, i) => `+ route Spot 0 — Spot ${i + 1} | hours: 2`).slice(0, 15), '+ landmark Spot 3 | kind: city']));
    assert.equal(Object.keys(atlas().routes).length, 15);
    assert.equal(Object.values(atlas().places).find(place => place.name === 'Spot 3').kind, 'city', 'a known place is changed past the limit too');
    const made = new Set(Object.values(atlas().places).map(place => place.made));
    assert.equal(made.size, 1, 'each place names the reply that made it');
});

test('the atlas keeps at most 400 places', async t => {
    const host = await fresh(t);
    for (let r = 0; r < 26; r += 1) await host.send(`m${r}`, said('More.', Array.from({ length: 16 }, (_, i) => `+ landmark P${r}x${i}`)));
    assert.equal(Object.keys(host.head().domains.atlas.places).length, MAX_PLACES);
    assert.ok(host.turn.problems().some(problem => /keeps at most 400 places/.test(problem.message)));
});

test('route and landmark lines read the packs\' world once for the lines of one reply', () => {
    let reads = 0;
    const atlas = initialAtlas();
    let rev = 10;
    const ctx = (index, reply = 'm_one', text = 'The roads.') => ({
        cause: 'story', carrier: { index: 3, swipe: 0, sid: reply, key: '3:0' }, chat: { lastUser: '', reply: text }, rev: (rev += 1),
        draft: () => atlas, rng: (() => { let n = index; return () => ((n += 0.137) % 1); })(),
        query: name => { if (name === 'packs.content') reads += 1; return []; },
        fail: (code, message) => { throw Object.assign(new Error(message), { code }); },
    });
    applyRouteLine(ctx(0), { op: '+', kind: 'route', name: 'A', text: 'B', labels: { hours: '2' }, index: 0 });
    applyRouteLine(ctx(1), { op: '+', kind: 'route', name: 'B', text: 'C', labels: { hours: '2' }, index: 1 });
    applyLandmarkLine(ctx(2), { op: '+', kind: 'landmark', name: 'D', labels: {}, index: 2 });
    const once = reads;
    applyLandmarkLine(ctx(0, 'm_two', 'Another reply.'), { op: '+', kind: 'landmark', name: 'E', labels: {}, index: 0 });
    assert.equal(reads, once * 2, 'another reply reads them again');
    assert.ok(once > 0 && once <= 2, `${once} pack reads for three lines`);
});

// ---- B-b1r2-8: the tail reads the live threads, and open threads are capped ------------------------------

test('ended threads leave the tail after a few replies, idle ones after IDLE_REPLIES unless dated, taken or named', () => {
    const at = turn => ({ created: { turn, time: null }, changed: { turn, time: null }, seen: { turn, time: null } });
    const base = { summary: '', fields: {}, status: 'active', offer: false, taken: null, ended: null, target: null, reward: null, rev: 1 };
    const threads = {
        th_old00001: { ...base, id: 'th_old00001', kind: 'hook', key: 'Old Rumour', track: at(1) },
        th_new00001: { ...base, id: 'th_new00001', kind: 'hook', key: 'New Rumour', track: at(95) },
        th_due00001: { ...base, id: 'th_due00001', kind: 'clock', key: 'Doom', fields: { due: 'June 9' }, track: at(1) },
        th_job00001: { ...base, id: 'th_job00001', kind: 'quest', key: 'Old Job', taken: { rev: 1 }, track: at(1) },
        th_sec00001: { ...base, id: 'th_sec00001', kind: 'secret', key: 'Hidden', track: at(1) },
        th_ask00001: { ...base, id: 'th_ask00001', kind: 'hook', key: 'Lost Ring', track: at(1) },
        th_end00001: { ...base, id: 'th_end00001', kind: 'hook', key: 'Done Long Ago', status: 'resolved', ended: { rev: 1, reason: 'x', outcome: 'done' }, track: { ...at(1), closed: { turn: 2, time: null } } },
        th_end00002: { ...base, id: 'th_end00002', kind: 'hook', key: 'Just Done', status: 'resolved', ended: { rev: 1, reason: 'x', outcome: 'done' }, track: { ...at(90), closed: { turn: 98, time: null } } },
    };
    const kept = tailThreads({ turn: { n: 100, now: null }, threads }, { said: 'Where is the lost ring?' });
    assert.ok(100 - 1 >= IDLE_REPLIES);
    assert.deepEqual(Object.values(kept.threads).map(entry => entry.key).sort(), ['Doom', 'Hidden', 'Just Done', 'Lost Ring', 'New Rumour', 'Old Job']);
});

test('at most 300 threads are open at once: a line that would add one more is a Problem', async t => {
    const host = await fresh(t);
    const hooks = r => Array.from({ length: 16 }, (_, i) => `+ hook H${r}x${i} — x`);
    for (let r = 0; r < 19; r += 1) await host.send(`r${r}`, said('More.', hooks(r)));
    assert.equal(Object.keys(director(host).threads).length, MAX_OPEN_THREADS, '304 written, 300 kept');
    assert.ok(problemList(director(host)).some(problem => problem.key === 'H18x15' && /at most 300 open threads/.test(problem.text)));
    await host.send('s', said('Done.', ['+ hook One More — x', '- hook H0x0 — done', '+ hook Two More — y']));
    const byKey = key => Object.values(director(host).threads).find(entry => entry.key === key) ?? null;
    assert.equal(byKey('One More'), null);
    assert.equal(byKey('H0x0').status, 'resolved', 'closing still works');
    assert.equal(byKey('Two More').status, 'active', 'one closed makes room');
});

// ---- invisible marks in names --------------------------------------------------------------------------

test('a zero-width or bidi mark makes no new thread, place or world event', async t => {
    const host = await fresh(t, ['~ time June 3, 1200, 08:00 am']);
    await host.send('a', said('A.', ['+ hook Ro​pe — a rope', '+ landmark Brig​g | kind: town', '+ world W‮ar — north | state: ongoing']));
    await host.send('b', said('B.', ['~ hook Rope | now: at the inn', '+ hook ‮Rope — again', '+ landmark Brigg | region: Vale', '~ world War | state: resolved']));
    assert.deepEqual(keys(host), ['Rope']);
    assert.deepEqual(Object.values(host.head().domains.atlas.places).map(place => [place.name, place.region]), [['Brigg', 'Vale']]);
    assert.deepEqual(Object.values(host.head().domains.chronicle.events).map(event => [event.name, event.state]), [['War', 'resolved']]);
    assert.deepEqual(seenOf(host.head().domains.chronicle), {});
});

// ---- B-b7r2-1 ------------------------------------------------------------------------------------------

test('the module needs Story Block 2.0.0-beta.2 or later', async t => {
    const def = createModule();
    assert.deepEqual(def.requires, { storyBlock: '>=2.0.0-beta.2' });
    assert.equal(STORY_BLOCK_RANGE, '>=2.0.0-beta.2');
    // Story Block 2.0.0-alpha.2 orders pre-releases (Story Block before it compared without the tag, so
    // it read this as ">=2.0.0" and still loaded the module). Every alpha and beta.1 are below beta.2.
    for (const [version, ok] of [['2.0.0-beta.2', true], ['2.0.0-beta.3', true], ['2.0.0-rc.1', true], ['2.0.0', true], ['2.0.0-beta.1', false], ['2.0.0-alpha.10', false], ['2.0.0-alpha.2', false], ['2.0.0-alpha.1', false], ['1.9.0', false]]) {
        assert.equal(satisfies(version, def.requires.storyBlock), ok, version);
    }
    const host = await fresh(t);
    assert.ok(host.head().domains.director, 'the vendored host registers it');
});

// ---- the story-vouched payout on Story Block's per-reply budget (SD-r2fix follow-up) --------------------
