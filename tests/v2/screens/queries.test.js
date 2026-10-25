// Screens part: the view queries (director.goal, director.next, quest.board) the screens bind to.
// They are built from the Director's own queries through tools.query and read only the state given.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    at, closed, earlierState, fair, headState, makeQueries, makeRunner, makeState, pelts, plot, raid, rats, ring, smuggler, thread, wolves,
} from './helpers/fixtures.js';
import { calendarSetting, createScreensPart, finishState, readerWords } from '../../../src/v2/screens/index.js';

const { run } = makeRunner();

test('director.goal is the active quest touched last, never an open offer', () => {
    assert.deepEqual(run(headState(), 'director.goal'), {
        id: 'th_wolves01', key: 'East Bluff Wolves', goal: 'Clear at least 3 wolves from East Bluff', step: 'Hunt along the ridge', giver: 'Orsa', due: '', taken: true,
    });
    // The offer (rev 14) is newer than both quests but is not a goal yet.
    const state = makeState({ threads: [wolves({ rev: 5 }), pelts({ rev: 6 }), rats({ rev: 30 })] });
    assert.equal(run(state, 'director.goal').id, 'th_pelts001');
    // A tie on rev keeps the tracker's order.
    assert.equal(run(makeState({ threads: [pelts({ rev: 4 }), wolves({ rev: 4 })] }), 'director.goal').id, 'th_pelts001');
    // Closed quests and other kinds never count; nothing open is null.
    assert.equal(run(makeState({ threads: [ring(), fair()] }), 'director.goal'), null);
    // A quest without a goal field shows its summary.
    assert.equal(run(makeState({ threads: [thread('th_mill0001', 'quest', 'Old Mill', {}, { summary: 'see what haunts the mill', taken: { rev: 1 } })] }), 'director.goal').goal, 'see what haunts the mill');
});

test('director.next is the open thread whose date comes first; secrets never count', () => {
    const next = run(headState(), 'director.next');
    assert.deepEqual(next, {
        id: 'th_raid0001', key: 'Bandit Raid', kind: 'clock', summary: 'the bandits ride on the mill', field: 'due',
        when: 'June 12, 2025, 8:00 pm', at: at('June 12, 2025, 8:00 pm'), reached: false,
    });
    // The secret is due earlier (June 11) and stays hidden.
    assert.notEqual(next.id, plot().id);
    // Once the time passes the raid, it is the one reached.
    const late = makeState({ minutes: at('June 13, 2025, 7:00 am'), threads: [fair(), raid()] });
    assert.equal(run(late, 'director.next').id, 'th_raid0001');
    assert.equal(run(late, 'director.next').reached, true);
    // A date with no clock time counts for its whole day.
    const fairDay = makeState({ minutes: at('June 14, 2025, 6:00 am'), threads: [fair()] });
    assert.equal(run(fairDay, 'director.next').reached, true);
    // Closed threads, threads with no date and no threads at all give null.
    assert.equal(run(makeState({ threads: [raid(closed('done', 3)), smuggler()] }), 'director.next'), null);
    assert.equal(run(makeState(), 'director.next'), null);
});

test('director.next reads dates on the reader\'s calendar from the settings', () => {
    const calendar = {
        preset: 'custom', era: '', leapYears: false, week: [],
        months: [{ name: 'Goldwane', days: 30 }, { name: 'Haywane', days: 30 }],
    };
    // Without the tracker's director.calendar the screens read the setting they are given …
    const { 'director.calendar': _calendar, ...queries } = makeQueries({ settings: () => ({ calendar }) });
    const custom = makeRunner(queries).run;
    const threads = [
        thread('th_feast001', 'event', 'Feast', { on: 'Haywane 2' }),
        thread('th_toll0001', 'clock', 'Toll', { due: 'Goldwane 20' }),
    ];
    const next = custom(makeState({ threads }), 'director.next');
    assert.equal(next.key, 'Toll');
    // The module's own settings hold the tracker's calendar namespaced and flat (src/v2/module.js).
    const flat = { 'tracker.calendar.preset': 'custom', 'tracker.calendar.months': calendar.months, 'tracker.calendar.week': [], 'tracker.dormantDays': 30 };
    const { 'director.calendar': _flat, ...flatQueries } = makeQueries();
    const fromModule = makeRunner({ ...flatQueries, ...createScreensPart({ settings: () => flat }).queries }).run;
    assert.equal(fromModule(makeState({ threads }), 'director.next').key, 'Toll');
    assert.deepEqual(calendarSetting(flat), { preset: 'custom', months: calendar.months, week: [] });
    assert.equal(calendarSetting({ 'tracker.dormantDays': 30 }), null);
    assert.equal(calendarSetting(null), null);
    // Settings that cannot be read fall back to the Gregorian calendar instead of failing.
    const broken = makeRunner({ ...flatQueries, ...createScreensPart({ settings: () => { throw new Error('no sdk'); } }).queries }).run;
    assert.equal(broken(headState(), 'director.next').id, 'th_raid0001');
    // … and with it, the chat's calendar: here the enabled pack's (the tracker's default preset `pack`).
    const pack = { pack: 'ersveil', era: 'CY', months: calendar.months, start: null };
    const withPack = makeRunner({ ...makeQueries(), 'packs.calendar': () => pack }).run;
    assert.equal(withPack(makeState({ threads }), 'director.next').key, 'Toll');
    assert.equal(run(makeState({ threads }), 'director.next'), null, 'Goldwane is no Gregorian month');
});

test('director.problems: v1\'s {{user}} through the host\'s substitute, else "you" with the verb put right', () => {
    const problems = [
        { rev: 3, kind: 'offered', text: '"Rats" was offered, not taken on: it stays an offer until {{user}} accepts it.' },
        { rev: 4, kind: 'not-chosen', text: '"Rats" stays open: giving it up or turning it down is {{user}}\'s choice, and their message did not make it.' },
        { rev: 5, kind: 'done-offer', text: '"Rats" was offered and the story says it is done: it is a quest {{user}} finished.' },
    ];
    const state = makeState({ problems });
    const plain = run(state, 'director.problems').map(problem => problem.text);
    // An older chat's "was offered" is not shown: there is nothing to accept any more.
    assert.deepEqual(plain, [
        '"Rats" stays open: giving it up or turning it down is your choice, and your message did not make it.',
        '"Rats" was offered and the story says it is done: it is a quest you finished.',
    ]);
    const queries = makeQueries();
    const named = queries['director.problems'](state, {}, { query: () => null, substitute: text => text.replace(/\{\{user\}\}/g, 'Astra') });
    assert.equal(named[0].text, '"Rats" stays open: giving it up or turning it down is Astra\'s choice, and their message did not make it.');
    assert.deepEqual(named.map(problem => [problem.rev, problem.kind]), [[4, 'not-chosen'], [5, 'done-offer']]);
    // A substitute that leaves the macro, or throws, still reads "you".
    assert.match(queries['director.problems'](state, {}, { substitute: text => text })[1].text, /a quest you finished/);
    assert.match(queries['director.problems'](state, {}, { substitute: () => { throw new Error('x'); } })[1].text, /a quest you finished/);
    assert.equal(readerWords('until {{user}} accepts it'), 'until you accept it');
    assert.equal(readerWords('Ask {{User}}.'), 'Ask you.');
    assert.deepEqual(run(makeState(), 'director.problems'), []);
});

test('director.problems: a Problem about a missing goal goes once that is no longer so; one about an offer always', () => {
    const problems = [
        { rev: 3, kind: 'offered', key: 'Granary Rats', text: '"Granary Rats" was offered, not taken on: it stays an offer until {{user}} accepts it.' },
        { rev: 3, kind: 'offered', key: 'East Bluff Wolves', text: '"East Bluff Wolves" was offered, not taken on.' },
        { rev: 4, kind: 'no-goal', key: 'Miller Trouble', text: '"Miller Trouble" has no goal.' },
        { rev: 4, kind: 'no-goal', key: 'Old Mill', text: '"Old Mill" has no goal.' },
        { rev: 5, kind: 'time', text: 'The story time is not set yet.' },
    ];
    const vague = thread('th_vague001', 'quest', 'Miller Trouble', {}, { summary: 'help the miller', taken: { rev: 2 } });
    const given = thread('th_mill0001', 'quest', 'Old Mill', { goal: 'see what haunts the mill' }, { taken: { rev: 2 } });
    const state = makeState({ threads: [rats(), wolves(), vague, given], problems });
    assert.deepEqual(run(state, 'director.problems').map(problem => [problem.kind, problem.rev]), [['no-goal', 4], ['time', 5]],
        'the offers (an older chat\'s) and the mill with its goal are left out');
    // Without the quests part's details, a goal: field decides.
    const { 'quest.details': _details, ...noDetails } = makeQueries();
    assert.equal(makeRunner(noDetails).run(state, 'director.problems').length, 2);
});
