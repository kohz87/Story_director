// Quests part: goals (F82), goals code cannot count (F83), the details query (F84), the progress note
// (F85), an older chat's offers (shown nowhere) and the story's own turn-in (F94) as the quests part answers them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { part, QUEST_STATIC, hasGoal } from '../../../src/v2/quests/index.js';
import { fakeQueries, makeHost, makeState, quest, xpCommand, fakeCommands } from './helpers/fake-ctx.js';

const progress = part.queries['quest.progress'];
const details = part.queries['quest.details'];
const finish = part.commands['quest.finish'];
const take = part.commands['quest.take'];
const viewOf = state => ({ state, query: (name, args) => fakeQueries[name](state, args), settings: {}, chat: { length: 3, lastUser: '' } });
const settlement = { place: { name: 'Bluewatch', kind: 'settlement' } };

const ring = (more = {}) => quest('th_ring0001', 'Lost Ring', { goal: 'Find Mara\'s ring in the old well', giver: 'Mara', reward: '20 gold' }, { taken: { rev: 4 }, ...more });

test('F82: a goal is a goal: label or a target code can read; a description alone is not', () => {
    assert.equal(hasGoal(ring()), true);
    assert.equal(hasGoal(quest('th_a0000001', 'A', { goal: '' }, { summary: 'Kill 3 wolves near the mill' })), true, 'a target in the text');
    assert.equal(hasGoal(quest('th_a0000001', 'A', { target: '3 wolves' })), true);
    assert.equal(hasGoal(quest('th_a0000001', 'A', {}, { summary: 'help the miller' })), false);
});

test('F82: the tail asks for a goal only while the quest is open and has none', () => {
    const vague = quest('th_vague001', 'Miller Trouble', { giver: 'Fenna' }, { summary: 'help the miller', taken: { rev: 2 } });
    const tail = part.context.tail(viewOf(makeState({ threads: [vague, ring()] })));
    assert.ok(tail.lines.includes('Quests with no goal yet (give each a concrete goal: ~ quest Name | goal: …): Miller Trouble.'));
    const given = part.context.tail(viewOf(makeState({ threads: [{ ...vague, fields: { ...vague.fields, goal: 'find out who fouls the millrace' } }] })));
    assert.equal(given.lines.some(line => line.startsWith('Quests with no goal')), false);
    const over = part.context.tail(viewOf(makeState({ threads: [{ ...vague, status: 'resolved', ended: { rev: 5, reason: 'x', outcome: 'done' } }] })));
    assert.deepEqual(over.lines, []);
});

test('F83: the tail lists at most three open taken quests code cannot count, one short line each, recent first', () => {
    const threads = [
        ring({ rev: 9 }),
        quest('th_q0000002', 'Ghost', { goal: 'Lay the mill ghost to rest' }, { taken: { rev: 2 }, rev: 8 }),
        quest('th_q0000003', 'Letter', { goal: 'Deliver the letter to the reeve' }, { taken: { rev: 2 }, rev: 7 }),
        quest('th_q0000004', 'Old Debt', { goal: 'Settle the old debt' }, { taken: { rev: 2 }, rev: 6 }),
        quest('th_q0000005', 'Offer', { goal: 'Talk to the hermit' }, { offer: true }),
        quest('th_q0000006', 'Untaken', { goal: 'Talk to the smith' }),
        quest('th_q0000007', 'Long', { goal: 'x'.repeat(200) }, { taken: { rev: 2 }, rev: 1 }),
    ];
    const lines = part.context.tail(viewOf(makeState({ threads }))).lines.filter(line => line.startsWith('Quest goal the story judges'));
    assert.deepEqual(lines, [
        'Quest goal the story judges: Lost Ring — Find Mara\'s ring in the old well.',
        'Quest goal the story judges: Ghost — Lay the mill ghost to rest.',
        'Quest goal the story judges: Letter — Deliver the letter to the reeve.',
    ]);
    const long = part.context.tail(viewOf(makeState({ threads: [threads.at(-1)] }))).lines[0];
    assert.ok(long.length < 140, 'the goal is cut short');
    // Ready ones are not asked about again: they are ready to turn in.
    const ready = part.context.tail(viewOf(makeState({ threads: [ring({ ready: { rev: 9 } })], scene: settlement }))).lines;
    assert.deepEqual(ready, ['Quests ready to turn in here (code checks and pays when the story turns one in): Lost Ring (goal met).']);
});

test('F83: the static part says how to mark a goal met, with the pacing lines, and has no numbers', () => {
    assert.match(QUEST_STATIC, /write ~ quest Name \| met: yes/);
    assert.match(QUEST_STATIC, /offer a new quest rarely/);
    assert.match(QUEST_STATIC, /A passer-by is only a passer-by/);
    assert.match(QUEST_STATIC, /unless they provoke it/);
    assert.doesNotMatch(QUEST_STATIC, /\d/);
    assert.equal(part.context.static(), part.context.static());
});

test('F83: quest.progress reports ready; Finish is enabled for a ready quest, still by the place rule', () => {
    const waiting = progress(makeState({ threads: [ring()], scene: settlement }), { id: 'th_ring0001' });
    assert.deepEqual([waiting.met, waiting.ready, waiting.finish.ok], [false, false, false]);
    const ready = progress(makeState({ threads: [ring({ ready: { rev: 9 } })], scene: settlement }), { id: 'th_ring0001' });
    assert.deepEqual([ready.met, ready.ready, ready.finish], [true, true, { ok: true, reason: '' }]);
    const away = progress(makeState({ threads: [ring({ ready: { rev: 9 } })], scene: { place: { kind: 'wild' } } }), { id: 'th_ring0001' });
    assert.deepEqual(away.finish, { ok: false, reason: 'Turn it in at a settlement or where Mara is.' });
    // The story's own turn-in takes its word for the goal (F94), and says why it would refuse.
    const closing = progress(makeState({ threads: [ring()], scene: { place: { kind: 'wild' } } }), { id: 'th_ring0001', closing: true });
    assert.deepEqual([closing.met, closing.refusal], [true, 'it can only be turned in at a settlement or where Mara is']);
});

test('F83: quest.finish on a ready quest code cannot count pays its fixed reward, closes it with a receipt, keeps it', () => {
    const host = makeHost(makeState({ threads: [ring({ ready: { rev: 9 } })], scene: settlement }), { commands: { ...fakeCommands, ...xpCommand } });
    const done = host.run(finish, { id: 'th_ring0001' });
    assert.equal(done.ok, true, done.message);
    assert.equal(done.receipt.summary, 'Astra turns in Lost Ring: goal met (Find Mara\'s ring in the old well), 20 gold paid.');
    assert.deepEqual(host.state.domains.inventory.wallets.party, { coin: 20 });
    const thread = host.state.domains.director.threads.th_ring0001;
    assert.deepEqual([thread.status, thread.ended.outcome, thread.ended.reason], ['resolved', 'done', 'turned in']);
    assert.ok(host.state.meta.claims['quest:th_ring0001:paid']);
    assert.equal(host.run(finish, { id: 'th_ring0001' }).code, 'REFUSED', 'once only');
});

test('F83: quest.finish refuses a quest code cannot count until the story says it is met; a click cannot claim the story\'s word', () => {
    const host = makeHost(makeState({ threads: [ring()], scene: settlement }));
    const before = structuredClone(host.state);
    const refused = host.run(finish, { id: 'th_ring0001' });
    assert.equal(refused.code, 'REFUSED');
    assert.equal(refused.message, 'Lost Ring is not done yet: the story has not said its goal is met yet.');
    // `by: 'story'` from a click is not the story.
    const ui = makeHost(makeState({ threads: [ring()], scene: settlement }));
    const run = ui.run;
    ui.run = (handler, payload) => run((ctx, p) => handler({ ...ctx, cause: 'ui' }, p), payload);
    assert.equal(ui.run(finish, { id: 'th_ring0001', by: 'story' }).code, 'REFUSED');
    assert.deepEqual(host.state, before);
    // The story itself (cause story): its word is taken (F94).
    const story = makeHost(makeState({ threads: [ring()], scene: settlement }));
    const storyRun = story.run;
    story.run = (handler, payload) => storyRun((ctx, p) => handler({ ...ctx, cause: 'story' }, p), payload);
    const turned = story.run(finish, { id: 'th_ring0001', by: 'story' });
    assert.equal(turned.ok, true, turned.message);
    assert.equal(turned.receipt.data.by, 'story');
});

test('F84: quest.details gives goal, note, terms, rank, giver, due, dates, status and the receipts touching the quest', () => {
    const state = makeState({ threads: [ring({ ready: { rev: 9 }, fields: { goal: 'Find the ring', giver: 'Mara', reward: '900 gold', rank: 'F', due: 'Goldwane 3', step: 'searching the well' }, taken: { rev: 4, at: 600 }, rev: 9 })], scene: settlement });
    const receipts = [
        { index: 1, receipt: { rev: 4, summary: 'Astra takes on Lost Ring: 900 gold.', data: { quest: 'th_ring0001' } } },
        { index: 1, receipt: { rev: 5, summary: 'Something else.', data: { quest: 'th_other001' } } },
        { index: 3, receipt: { rev: 9, summary: 'Director: ~ quest Lost Ring | met: yes', data: { thread: 'th_ring0001' } } },
    ];
    const got = details(state, { key: 'lost ring' }, { query: (name, args) => fakeQueries[name]?.(state, args), receipts: () => receipts });
    assert.deepEqual(got, {
        id: 'th_ring0001', key: 'Lost Ring', goal: 'Find the ring', hasGoal: true, countable: false, note: 'searching the well',
        giver: 'Mara', due: 'Goldwane 3', rank: { id: 'F', title: 'F-rank', reward: [10, 50] },
        terms: { target: '', reward: '900 gold', held: 'reward clamped to F-rank range: 10–50 gold (clamped from 900 gold)', text: '900 gold (reward clamped to F-rank range: 10–50 gold (clamped from 900 gold)); F-rank', level: '' },
        ready: true, waiting: false, taken: { rev: 4, at: 600 }, ended: null,
        status: { state: 'here', text: 'Ready to turn in — goal met' },
        history: [{ rev: 4, text: 'Astra takes on Lost Ring: 900 gold.' }, { rev: 9, text: '~ quest Lost Ring | met: yes' }],
    });
    assert.equal(details(state, { id: 'th_nope0001' }), null);
    assert.deepEqual(details(state, { id: 'th_ring0001' }).history, [], 'no receipts without the host\'s tools');
});

test('F85: the note is the latest progress line, at most 160 characters', () => {
    const long = 'x'.repeat(300);
    const state = makeState({ threads: [ring({ fields: { goal: 'Find the ring', step: long } })] });
    const note = details(state, { id: 'th_ring0001' }).note;
    assert.equal(note.length, 160);
    assert.ok(note.endsWith('…'));
    const progressFirst = makeState({ threads: [ring({ fields: { goal: 'Find the ring', step: 'old', progress: 'new' } })] });
    assert.equal(details(progressFirst, { id: 'th_ring0001' }).note, 'new');
});

test('an older chat\'s offers, held or not, are told nowhere and are no active quest; the story\'s + quest takes one on', () => {
    const held = quest('th_held0001', 'Second Job', { goal: 'Kill 2 rats', giver: 'Hobb' }, { offer: true, shown: { turn: 9 } });
    const first = quest('th_first001', 'First Job', { goal: 'Kill 2 wolves', giver: 'Orsa' }, { offer: true, shown: { turn: 3 } });
    const state = makeState({ threads: [held, first] });
    state.domains.director.turn = { n: 4, reply: null, index: -1, from: null, quests: [], lone: null };
    assert.deepEqual(part.context.tail(viewOf(state)).lines, []);
    assert.deepEqual(details(state, { id: 'th_first001' }).status, { state: 'untaken', text: 'Not taken on' });
    const host = makeHost(state);
    assert.equal(host.run(take, { id: 'th_held0001' }).ok, true);
    assert.equal(host.state.domains.director.threads.th_held0001.offer, false);
});
