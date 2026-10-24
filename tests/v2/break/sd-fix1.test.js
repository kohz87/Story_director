// Story Director fixes from the break rounds that the rounds' own tests (b1-capture-director, b3-quest-labels,
// b4-kill-quest-overpay, b5b-*) do not pin down on their own: the time ceiling as a setting, clock times
// no clock shows, labels the Director does not keep, the tail's cost with hundreds of threads, the rank
// a quest without one is paid at, a pack quest's reward over the story's, and the place rule when a scene
// move leaves the scene's kind empty.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeCalendar } from '../../../src/calendar.js';
import { KEY_CHARS } from '../../../src/v2/tracker/capture.js';
import { directorTail } from '../../../src/v2/tracker/note.js';
import { MAX_JUMP_DAYS, maxJumpMinutes, settingsDefaults, timeAfter } from '../../../src/v2/tracker/time.js';
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
    const state = reply(makeState(), '+ hook Pelts — bring pelts | giver: Fenna | goal: Bring 3 pelts | qty: 3 | owner_id: x | constructor: y | xp: 250000').state;
    const pelts = thread(state, 'Pelts');
    assert.ok(pelts);
    assert.deepEqual(Object.keys(pelts.fields).sort(), ['giver', 'goal']);
    const problem = lastProblems(state).find(entry => entry.kind === 'label');
    assert.match(problem.text, /"xp:" is ignored: quest XP comes from the quest's difficulty/);
    assert.match(problem.text, /"qty:", "owner_id:", "constructor:" are names the Director does not keep/);
});

test('a long name is cut to 120 characters at a space, with a Problem; the same name finds the same thread', () => {
    const name = `The ${'very '.repeat(40)}long rumour`;
    let state = reply(makeState(), `+ hook ${name} — talk`).state;
    const [only] = Object.values(state.domains.director.threads);
    assert.ok(only.key.length <= KEY_CHARS && !only.key.endsWith(' '), only.key);
    assert.equal(lastProblems(state).at(-1).kind, 'long-name');
    state = reply(state, `~ hook ${name} — more talk`).state;
    assert.equal(Object.keys(state.domains.director.threads).length, 1);
});

// The tail with many threads: one thread read from a line, copied `count` times under other names
// (building them line by line is slow).
function manyThreads(count) {
    const state = structuredClone(reply(makeState(), '+ hook Rumour — talk of the harbour').state);
    const director = state.domains.director;
    const [model] = Object.values(director.threads);
    director.threads = {};
    director.keys = {};
    for (let n = 0; n < count; n += 1) {
        const id = `th_${String(n).padStart(8, '0')}`;
        director.threads[id] = { ...structuredClone(model), id, key: `Rumour ${n}`, track: { ...model.track, order: n } };
        director.keys[`rumour ${n}`] = id;
    }
    return { state, settings: () => ({ dormantReplies: 500 }), query: () => null, chat: { lastUser: '' } };
}

// Runs fn() counting its work: every key Object.keys/entries/values hands out and every such call (the
// note walks the threads, the key index and its fields that way). The globals are put back however fn ends.
function counted(fn) {
    const work = { keys: 0, calls: 0, out: undefined };
    const original = { keys: Object.keys, entries: Object.entries, values: Object.values };
    const tally = list => { work.keys += list.length; work.calls += 1; return list; };
    Object.keys = value => tally(original.keys(value));
    Object.entries = value => tally(original.entries(value));
    Object.values = value => tally(original.values(value));
    try {
        work.out = fn();
    } finally {
        Object.assign(Object, original);
    }
    return work;
}

// Before the fix this took about 0.5 s: the key index was searched once per thread, and the note was built
// again for every thread dropped to fit the budget. The bounds are counted work, not wall-clock time, so a
// loaded machine cannot fail them (as RB #105 and SB #132 did): 600 threads walk about 2,700 keys in about
// 660 calls (a search of the index per thread would be 360,000 keys), and twice the threads at most about
// twice the work. Backstop: the fastest of three tails is under the old 150 ms bound.
test('the tail lists only the most relevant threads, and stays cheap with 600 (counted work)', () => {
    const view = manyThreads(600);
    directorTail(view);
    const work = counted(() => directorTail(view));
    assert.ok(work.out.lines.length > 0);
    assert.ok(work.keys < 20_000, `the tail walked ${work.keys} keys`);
    assert.ok(work.calls < 3_000, `the tail made ${work.calls} key walks`);
    const double = manyThreads(1200);
    directorTail(double);
    const more = counted(() => directorTail(double));
    assert.ok(more.keys < 2.5 * work.keys, `1,200 threads walked ${more.keys} keys, 600 walked ${work.keys}: not linear`);
    assert.ok(more.calls < 2.5 * work.calls, `1,200 threads made ${more.calls} key walks, 600 made ${work.calls}`);
    const times = [];
    for (let i = 0; i < 3; i += 1) {
        const started = process.hrtime.bigint();
        directorTail(view);
        times.push(Number(process.hrtime.bigint() - started) / 1e6);
    }
    assert.ok(Math.min(...times) < 150, `the fastest tail took ${Math.min(...times)} ms`);
});

// ---- B-b4-10 / B-b3-18: the rank every quest is held to -----------------------------------------------
