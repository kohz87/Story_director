// Story Director fixes from the break rounds that the rounds' own tests (b1-capture-director, b3-quest-labels,
// b4-kill-quest-overpay, b5b-*) do not pin down on their own: the time ceiling as a setting, clock times
// no clock shows, labels the Director does not keep, the tail's cost with hundreds of threads, the rank
// a quest without one is paid at, a pack quest's reward over the story's, and the place rule when a scene
// move leaves the scene's kind empty.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeCalendar } from '../../../src/calendar.js';
import { part as quests, packQuestOf } from '../../../src/v2/quests/index.js';
import { DEFAULT_RANKS, defaultRank, questRank } from '../../../src/v2/quests/ranks.js';
import { KEY_CHARS } from '../../../src/v2/tracker/capture.js';
import { directorTail } from '../../../src/v2/tracker/note.js';
import { MAX_JUMP_DAYS, maxJumpMinutes, settingsDefaults, timeAfter } from '../../../src/v2/tracker/time.js';
import { fakeQueries, makeHost, makeState as questState, quest, xpCommand, fakeCommands } from '../quests/helpers/fake-ctx.js';
import { lastProblems, makeState, reply, thread } from '../tracker/helpers/fake-ctx.js';
import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { fakeRpgBattle } from '../integration/helpers/fake-rpg.js';

const gregorian = makeCalendar('gregorian');
const DAY = 1440;
const minutes = state => state.domains.director.time.minutes;
const line = (op, name, text = '') => ({ op, kind: 'time', name, text, labels: {} });

// ---- B-b1-capture-15: the longest time jump --------------------------------------------------------

test('maxJump: 30 days by default, a setting in story days; a longer move is held to it with a Problem', () => {
    assert.equal(settingsDefaults().maxJump, MAX_JUMP_DAYS);
    assert.equal(MAX_JUMP_DAYS, 30);
    assert.equal(maxJumpMinutes({}), 30 * DAY);
    assert.equal(maxJumpMinutes({ maxJump: 2 }), 2 * DAY);
    assert.equal(maxJumpMinutes({ maxJump: 0 }), 30 * DAY, 'a bad value is the default');

    const start = gregorian.parse('June 3, 1200, 08:00 am').abs;
    assert.deepEqual(timeAfter(line('!', '+3d'), start, gregorian), { minutes: start + 3 * DAY });
    const far = timeAfter(line('!', '+99999999999d'), start, gregorian);
    assert.equal(far.minutes, start + 30 * DAY);
    assert.match(far.problem, /more than 30 days at once; it moved 30 days/);
    // A date far ahead is held the same way; the first date set (no clock yet) is not.
    assert.equal(timeAfter(line('~', 'June 3, 1300, 08:00 am'), start, gregorian).minutes, start + 30 * DAY);
    assert.equal(timeAfter(line('~', 'June 3, 1300, 08:00 am'), null, gregorian).minutes, gregorian.parse('June 3, 1300, 08:00 am').abs);
    assert.equal(timeAfter(line('!', '+3d'), start, gregorian, { maxJump: 2 * DAY }).minutes, start + 2 * DAY);

    // Through capture: the setting is read, the clock moves only that far, the Problem is on the list.
    let state = reply(makeState(), '~ time June 3, 1200, 08:00 am').state;
    state = reply(state, '! time +10d', { settings: { maxJump: 4 } }).state;
    assert.equal(minutes(state), start + 4 * DAY);
    assert.equal(lastProblems(state).at(-1).kind, 'time');
});

// ---- B-b1-capture-16: clock times and years no calendar has -----------------------------------------

test('a time line with a clock time no clock shows, or a year past 999999, leaves the clock alone', () => {
    const start = gregorian.parse('June 3, 1200, 08:00 am').abs;
    for (const text of ['June 3, 1200, 25:99 pm', 'June 4, 1200, 13 pm', 'June 4, 0 am', 'June 4, 23:60', 'June 4, 12:5 pm', 'June 4, 24:00']) {
        const next = timeAfter(line('~', text), start, gregorian);
        assert.ok(next.error, `${text} → ${JSON.stringify(next)}`);
    }
    assert.match(timeAfter(line('~', 'June 3, 99999999'), start, gregorian).error ?? '', /year past 999999/);
    for (const text of ['June 4, 1200, 12:30 pm', 'June 4, 1200, 08:00', 'June 4, 1200, 12 am', 'June 4, 1200, 23:59']) {
        assert.equal(typeof timeAfter(line('~', text), start, gregorian).minutes, 'number', text);
    }
});

// ---- B-b1-capture-17, B-b3-19: labels the Director does not keep -------------------------------------

test('qty, id, *_id, constructor and xp labels are left out of the thread with one Problem; the line is used', () => {
    const state = reply(makeState(), '+ quest Pelts — bring pelts | giver: Fenna | goal: Bring 3 pelts | qty: 3 | owner_id: x | constructor: y | xp: 250000').state;
    const pelts = thread(state, 'Pelts');
    assert.ok(pelts);
    assert.deepEqual(Object.keys(pelts.fields).sort(), ['giver', 'goal']);
    const problem = lastProblems(state).find(entry => entry.kind === 'label');
    assert.match(problem.text, /"xp:" is ignored: quest XP comes from the quest's difficulty/);
    assert.match(problem.text, /"qty:", "owner_id:", "constructor:" are names the Director does not keep/);
});

test('quest.finish never sends a written XP amount to party.grantXp, only the quest and its difficulty', () => {
    const host = makeHost(questState({
        threads: [quest('th_wolves01', 'Wolves', { giver: 'Orsa', goal: 'Kill 3 wolves', reward: '10 gold', difficulty: 'hard', xp: '250000' }, { offer: true })],
        scene: { place: { kind: 'settlement' } },
    }), { commands: { ...fakeCommands, ...xpCommand } });
    assert.equal(host.run(quests.commands['quest.take'], { id: 'th_wolves01' }).ok, true);
    host.state.domains.combat.beaten = [{ rev: 12, foes: [{ name: 'Wolf', count: 3 }], won: true }];
    assert.equal(host.run(quests.commands['quest.finish'], { id: 'th_wolves01' }).ok, true);
    assert.deepEqual(host.state.domains.party.xpLog, [{ quest: 'th_wolves01', difficulty: 'hard' }]);
});

// ---- B-b1-capture-13: names and the tail's cost ------------------------------------------------------

test('a long name is cut to 120 characters at a space, with a Problem; the same name finds the same thread', () => {
    const name = `The ${'very '.repeat(40)}long rumour`;
    let state = reply(makeState(), `+ hook ${name} — talk`).state;
    const [only] = Object.values(state.domains.director.threads);
    assert.ok(only.key.length <= KEY_CHARS && !only.key.endsWith(' '), only.key);
    assert.equal(lastProblems(state).at(-1).kind, 'long-name');
    state = reply(state, `~ hook ${name} — more talk`).state;
    assert.equal(Object.keys(state.domains.director.threads).length, 1);
});

test('the tail lists only the most relevant threads, and stays cheap with 600', () => {
    // One thread read from a line, copied 600 times under other names (building them line by line is slow).
    const state = structuredClone(reply(makeState(), '+ hook Rumour — talk of the harbour').state);
    const director = state.domains.director;
    const [model] = Object.values(director.threads);
    director.threads = {};
    director.keys = {};
    for (let n = 0; n < 600; n += 1) {
        const id = `th_${String(n).padStart(8, '0')}`;
        director.threads[id] = { ...structuredClone(model), id, key: `Rumour ${n}`, track: { ...model.track, order: n } };
        director.keys[`rumour ${n}`] = id;
    }
    const view = { state, settings: () => ({ dormantReplies: 500 }), query: () => null, chat: { lastUser: '' } };
    directorTail(view);
    const start = process.hrtime.bigint();
    const tail = directorTail(view);
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    assert.ok(tail.lines.length > 0);
    // Before the fix this took about 0.5 s: the key index was searched once per thread, and the note
    // was built again for every thread dropped to fit the budget.
    assert.ok(ms < 150, `the tail took ${ms} ms`);
});

// ---- B-b4-10 / B-b3-18: the rank every quest is held to -----------------------------------------------

test('defaultRank: the party\'s rank by level, moved by difficulty, held to the ends of the ladder', () => {
    const at = (difficulty, level) => defaultRank(DEFAULT_RANKS, difficulty, level).id;
    assert.deepEqual(['easy', 'normal', 'hard', 'nightmare'].map(word => at(word, 1)), ['F', 'F', 'F', 'F'], 'RX-E-1: no step above the party\'s rank');
    assert.deepEqual(['easy', 'normal', 'hard', 'nightmare'].map(word => at(word, 25)), ['D', 'C', 'C', 'C']);
    assert.deepEqual(['easy', 'normal', 'hard', 'nightmare'].map(word => at(word, 99)), ['A', 'S', 'S', 'S']);
    assert.equal(at('normal', null), 'F', 'no level known: the lowest rank');
    assert.equal(defaultRank([], 'normal', 1), null);
    // A pack quest's rank, then the quest's own, then the difficulty's.
    const thread = { fields: { rank: 'D', difficulty: 'easy' } };
    assert.deepEqual(questRank(thread, DEFAULT_RANKS, { pack: { letter: 'F' } }).by, 'pack');
    assert.deepEqual(questRank(thread, DEFAULT_RANKS, { level: 13 }).rank.id, 'D');
    assert.deepEqual(questRank({ fields: {} }, DEFAULT_RANKS, { difficulty: 'hard', level: 1 }), { rank: DEFAULT_RANKS[0], by: 'difficulty' });
});

test('a pack quest pays the pack\'s reward, also for a quest taken on before (its stored reward is the story\'s)', () => {
    const PACK_QUESTS = [{ pack: 'p', name: 'Granary Rats', aliases: ['GranaryRats'], letter: 'F', reward: '50 gold' }];
    const queries = { ...fakeQueries, 'packs.content': (_state, { kind } = {}) => (kind === 'quests' ? PACK_QUESTS : []) };
    assert.equal(packQuestOf(name => queries[name]?.(null, { kind: 'quests' }), { key: 'granary-rats' }).name, 'Granary Rats');
    const host = makeHost(questState({
        threads: [quest('th_rats0001', 'Granary Rats', { giver: 'Fenna', goal: 'Kill 2 cellar rats', reward: '5000000 gold' }, {
            taken: { rev: 9 }, reward: { amount: 5000000, each: false, unit: '', text: '5000000 gold' },
        })],
        scene: { place: { kind: 'settlement' } },
    }), { queries });
    host.state.domains.combat.beaten = [{ rev: 12, foes: [{ name: 'Cellar Rat', count: 2 }], won: true }];
    const done = host.run(quests.commands['quest.finish'], { id: 'th_rats0001' });
    assert.equal(done.ok, true, done.message);
    assert.deepEqual(host.state.domains.inventory.wallets.party, { coin: 50 });
    assert.match(done.receipt.summary, /50 gold paid \(the pack's reward for Granary Rats; the story said 5000000 gold\)\.$/);
});

// ---- the place rule reads the atlas's kind (atlas.here) ----------------------------------------------

test('a scene move without | kind: back to a known settlement still lets a quest be turned in there', async () => {
    const host = await createHost({ modules: [fakeRpgBattle(), createModule()] });
    const said = (text, lines) => `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>`;
    try {
        await host.send('Work?', said('A notice.', ['~ place Bluewatch | kind: settlement', '+ present Fenna',
            '+ quest Lone Wolf — a wolf | giver: Fenna | goal: Kill 1 wolf | reward: 20 gold']));
        assert.ok(host.sdk.query('director.thread', { key: 'Lone Wolf' }).taken, 'taken on by its + quest');
        await host.send('Out we go.', said('The ridge.', ['~ place East Ridge | kind: wild']));
        await host.send('Back.', said('Back in town.', ['~ place Bluewatch']));
        // Story Block leaves the scene's kind empty (before 2.0.0-alpha.2) or keeps the ridge's.
        assert.ok(['', 'wild'].includes(host.head().domains.scene.place.kind), 'the move did not say the kind');
        assert.equal(host.sdk.query('atlas.here').placeKind, 'settlement');
        assert.equal((await host.sdk.command('combat.win', { foes: [{ name: 'Wolf', count: 1 }] })).ok, true);
        const done = await host.sdk.command('quest.finish', { key: 'Lone Wolf' });
        assert.equal(done.ok, true, done.message);
    } finally {
        host.close();
    }
});
