// Screens part: the view queries (director.goal, director.next, quest.board) the screens bind to.
// They are built from the Director's own queries through tools.query and read only the state given.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    at, closed, earlierState, fair, headState, makeQueries, makeRunner, makeState, pelts, plot, raid, rats, ring, smuggler, thread, wolves,
} from './helpers/fixtures.js';
import { calendarSetting, createScreensPart, finishState, questBoard, readerWords } from '../../../src/v2/screens/index.js';

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

test('quest.board: active quests with progress and Finish, finished latest first; an older chat\'s offer nowhere', () => {
    const board = run(headState(), 'quest.board');
    // Granary Rats is an older chat's offer: no Offered list, and no active quest.
    assert.equal(board.offers, undefined);
    assert.ok(!JSON.stringify(board).includes('Granary Rats'));
    assert.deepEqual(board.active.map(quest => quest.id), ['th_wolves01', 'th_pelts001']);
    const [hunt, hides] = board.active;
    assert.deepEqual(hunt.progress, { have: 8, need: 3, met: true, ready: false, source: 'fights', label: 'Wolves 8/3', reason: '', finish: { ok: true, reason: '' } });
    assert.deepEqual(hunt.status, { state: 'here', text: 'Ready to turn in — 8/3 wolves' });
    assert.equal(hunt.note, 'Hunt along the ridge', 'the progress note (F85)');
    assert.equal(hunt.meter, true);
    assert.deepEqual(hunt.finish, { show: true, blocked: false, reason: '', title: 'Turn in East Bluff Wolves' });
    // The row's reward is the one the terms count, in the chat's money words, so the two agree.
    assert.equal(hunt.reward, '1 gold per wolf');
    assert.match(hunt.details.terms, /1 gold per wolf/);
    assert.equal(hides.progress.label, 'Wolf pelt 2/5');
    assert.deepEqual(hides.finish, { show: true, blocked: true, reason: hides.progress.reason, title: hides.progress.reason });
    assert.match(hides.finish.reason, /Need 3 more/);
    assert.deepEqual(hides.status, { state: 'notyet', text: 'Not yet: 2/5 wolf pelt' });
    assert.deepEqual(board.finished.map(entry => ({ ...entry, details: undefined })), [{ id: 'th_ring0001', key: 'Lost Ring', outcome: 'done', outcomeText: 'Done', reason: 'returned it', details: undefined }]);
    assert.equal(board.finished[0].details.goal, 'find the ring');
    assert.deepEqual([board.hasActive, board.hasFinished, board.finishedCount], [true, true, 1]);
});

test('quest.board: Finish says why it is off (not taken, not met, wrong place) and is on with the giver present', () => {
    const away = { place: { name: 'East Bluff', kind: 'wild' } };
    const beaten = [{ rev: 11, foes: [{ name: 'Wolf', count: 8 }], won: true }];
    const finishOf = state => {
        const { title, ...finish } = run(state, 'quest.board').active[0].finish;
        // The button's title is the reason while it is off.
        assert.equal(title, finish.reason || 'Turn in East Bluff Wolves');
        return finish;
    };

    const untaken = makeState({ threads: [wolves({ taken: null })], beaten, ...away });
    assert.deepEqual(finishOf(untaken), { show: true, blocked: true, reason: 'It was never taken on.' });
    assert.deepEqual(run(untaken, 'quest.board').active[0].status, { state: 'untaken', text: 'Not taken on' });

    const short = makeState({ threads: [wolves()], beaten: [{ rev: 11, foes: [{ name: 'Wolf', count: 1 }], won: true }], ...away });
    assert.deepEqual(finishOf(short), { show: true, blocked: true, reason: 'Need 2 more wolves.' });

    const wild = makeState({ threads: [wolves()], beaten, ...away });
    assert.deepEqual(finishOf(wild), { show: true, blocked: true, reason: 'Turn it in at a settlement or where Orsa is.' });
    assert.deepEqual(run(wild, 'quest.board').active[0].status, { state: 'ready', text: 'Ready — 8/3 wolves; turn it in at a settlement or where Orsa is.' });

    const withGiver = makeState({ threads: [wolves()], beaten, ...away, present: ['Orsa the huntress'] });
    assert.deepEqual(finishOf(withGiver), { show: true, blocked: false, reason: '' });

    const noGiver = makeState({ threads: [wolves({ fields: { goal: 'kill 3 wolves' } })], beaten, ...away });
    assert.equal(finishOf(noGiver).reason, 'Turn it in at a settlement.');

    // A quest code cannot count (F83): no meter; not yet until the story says its goal is met, then Ready.
    const story = makeState({ threads: [thread('th_mill0001', 'quest', 'Old Mill', { goal: 'see what haunts the mill' }, { taken: { rev: 1 } })], ...away });
    const mill = run(story, 'quest.board').active[0];
    assert.equal(mill.meter, false);
    assert.deepEqual(mill.finish, { show: true, blocked: true, reason: 'The story has not said its goal is met yet.', title: 'The story has not said its goal is met yet.' });
    assert.deepEqual(mill.status, { state: 'notyet', text: 'Not yet: the story has not said its goal is met yet.' });
    const met = run(makeState({ threads: [thread('th_mill0001', 'quest', 'Old Mill', { goal: 'see what haunts the mill', giver: 'Hobb' }, { taken: { rev: 1 }, ready: { rev: 4 } })], ...away, present: ['Hobb'] }), 'quest.board').active[0];
    assert.equal(met.ready, true);
    assert.deepEqual(met.status, { state: 'here', text: 'Ready to turn in — goal met' });
    assert.equal(met.finish.blocked, false);
});

test('finishState takes the quests part\'s own verdict from quest.progress; it never works out the place itself', () => {
    const taken = wolves();
    assert.deepEqual(finishState(taken, { have: 3, need: 3, met: true, finish: { ok: false, reason: 'Not here.' } }),
        { show: true, blocked: true, reason: 'Not here.' });
    assert.deepEqual(finishState(taken, { have: 3, need: 3, met: true, finish: { ok: true, reason: '' } }),
        { show: true, blocked: false, reason: '' });
    // Without a verdict (an older quests part) Finish is offered and quest.finish itself checks the place.
    assert.deepEqual(finishState(taken, { have: 3, need: 3, met: true }), { show: true, blocked: false, reason: '' });
    assert.deepEqual(finishState(taken, null), { show: false, blocked: true, reason: '' });
});

test('quest.board keeps at most 20 finished quests, latest first, and counts them all', () => {
    const threads = Array.from({ length: 25 }, (_, i) => thread(`th_done${String(i).padStart(4, '0')}`, 'quest', `Job ${i}`, {}, closed(i % 2 ? 'failed' : 'declined', i + 1)));
    const board = run(makeState({ threads }), 'quest.board');
    assert.equal(board.finished.length, 20);
    assert.equal(board.finishedCount, 25);
    assert.equal(board.finished[0].key, 'Job 24');
    assert.deepEqual([...new Set(board.finished.map(item => item.outcomeText))].sort(), ['Failed', 'Turned down']);
    assert.equal(board.hasActive, false);
});

test('without tools the queries read the director layout and leave progress out', () => {
    const state = headState();
    const board = questBoard(state, {}, null);
    assert.deepEqual(board.active.map(quest => quest.key), ['East Bluff Wolves', 'Tanner Pelts']);
    assert.ok(board.active.every(quest => quest.progress === null && quest.meter === false && quest.finish.show === false));
    const queries = createScreensPart({ settings: {} }).queries;
    assert.equal(queries['director.goal'](state).id, 'th_wolves01');
    assert.equal(queries['director.next'](state).id, 'th_raid0001');
});

test('the view queries read only the state they are given (a card\'s reply, not the head)', () => {
    const head = headState();
    const earlier = earlierState();
    assert.equal(run(earlier, 'director.goal').id, 'th_pelts001');
    assert.equal(run(head, 'director.goal').id, 'th_wolves01');
    assert.equal(run(earlier, 'quest.progress', { id: 'th_pelts001' }).label, 'Wolf pelt 1/5');
    assert.equal(run(head, 'quest.progress', { id: 'th_pelts001' }).label, 'Wolf pelt 2/5');
    assert.equal(run(earlier, 'director.next'), null);
    // The answers are copies: changing one changes nothing for the next caller.
    const board = run(head, 'quest.board');
    board.active.length = 0;
    assert.equal(run(head, 'quest.board').active.length, 2);
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

test('quest.board: an older chat\'s offer, held or not, is on no list', () => {
    for (const turn of [9, 3]) {
        const board = run(makeState({ threads: [rats({ shown: { turn } })] }), 'quest.board');
        assert.deepEqual([board.active, board.finished, board.hasActive, board.hasFinished], [[], [], false, false], String(turn));
    }
});
