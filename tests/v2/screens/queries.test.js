// Screens part: the view queries (director.goal, director.next, quest.board) the screens bind to.
// They are built from the Director's own queries through tools.query and read only the state given.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    at, closed, earlierState, fair, headState, makeQueries, makeRunner, makeState, pelts, plot, raid, rats, ring, smuggler, thread, wolves,
} from './helpers/fixtures.js';
import { calendarSetting, createScreensPart, finishState, questBoard } from '../../../src/v2/screens/index.js';

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
    const queries = makeQueries({ settings: () => ({ calendar }) });
    const custom = makeRunner(queries).run;
    const threads = [
        thread('th_feast001', 'event', 'Feast', { on: 'Haywane 2' }),
        thread('th_toll0001', 'clock', 'Toll', { due: 'Goldwane 20' }),
    ];
    const next = custom(makeState({ threads }), 'director.next');
    assert.equal(next.key, 'Toll');
    // The module's own settings hold the tracker's calendar namespaced and flat (src/v2/module.js).
    const flat = { 'tracker.calendar.preset': 'custom', 'tracker.calendar.months': calendar.months, 'tracker.calendar.week': [], 'tracker.dormantDays': 30 };
    const fromModule = makeRunner({ ...makeQueries(), ...createScreensPart({ settings: () => flat }).queries }).run;
    assert.equal(fromModule(makeState({ threads }), 'director.next').key, 'Toll');
    assert.deepEqual(calendarSetting(flat), { preset: 'custom', months: calendar.months, week: [] });
    assert.equal(calendarSetting({ 'tracker.dormantDays': 30 }), null);
    assert.equal(calendarSetting(null), null);
    // Settings that cannot be read fall back to the Gregorian calendar instead of failing.
    const broken = makeRunner({ ...makeQueries(), ...createScreensPart({ settings: () => { throw new Error('no sdk'); } }).queries }).run;
    assert.equal(broken(headState(), 'director.next').id, 'th_raid0001');
});

test('quest.board: offers, active quests with progress and Finish, finished latest first', () => {
    const board = run(headState(), 'quest.board');
    assert.deepEqual(board.offers, [{ id: 'th_rats0001', key: 'Granary Rats', goal: 'kill 6 rats in the granary', giver: 'Miller Fenna', reward: '5 coin', due: '' }]);
    assert.deepEqual(board.active.map(quest => quest.id), ['th_wolves01', 'th_pelts001']);
    const [hunt, hides] = board.active;
    assert.deepEqual(hunt.progress, { have: 8, need: 3, met: true, source: 'fights', label: 'Wolves 8/3', reason: '' });
    assert.equal(hunt.meter, true);
    assert.deepEqual(hunt.finish, { show: true, blocked: false, reason: '', title: 'Turn in East Bluff Wolves' });
    assert.equal(hunt.reward, '1 coin each wolf');
    assert.equal(hides.progress.label, 'Wolf pelt 2/5');
    assert.deepEqual(hides.finish, { show: true, blocked: true, reason: hides.progress.reason, title: hides.progress.reason });
    assert.match(hides.finish.reason, /Need 3 more/);
    assert.deepEqual(board.finished, [{ id: 'th_ring0001', key: 'Lost Ring', outcome: 'done', outcomeText: 'Done', reason: 'returned it' }]);
    assert.deepEqual([board.hasOffers, board.hasActive, board.hasFinished, board.finishedCount], [true, true, true, 1]);
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
    assert.deepEqual(finishOf(untaken), { show: true, blocked: true, reason: 'Take it on first: fights count from then.' });
    assert.equal(run(untaken, 'quest.board').active[0].canTake, true);

    const short = makeState({ threads: [wolves()], beaten: [{ rev: 11, foes: [{ name: 'Wolf', count: 1 }], won: true }], ...away });
    assert.deepEqual(finishOf(short), { show: true, blocked: true, reason: 'Need 2 more wolves.' });

    const wild = makeState({ threads: [wolves()], beaten, ...away });
    assert.deepEqual(finishOf(wild), { show: true, blocked: true, reason: 'Turn it in at a settlement or where Orsa is.' });

    const withGiver = makeState({ threads: [wolves()], beaten, ...away, present: ['Orsa the huntress'] });
    assert.deepEqual(finishOf(withGiver), { show: true, blocked: false, reason: '' });

    const noGiver = makeState({ threads: [wolves({ fields: { goal: 'kill 3 wolves' } })], beaten, ...away });
    assert.equal(finishOf(noGiver).reason, 'Turn it in at a settlement.');

    // A quest code cannot count (no target in its terms): no Finish, the story decides.
    const story = makeState({ threads: [thread('th_mill0001', 'quest', 'Old Mill', { goal: 'see what haunts the mill' }, { taken: { rev: 1 } })] });
    const mill = run(story, 'quest.board').active[0];
    assert.equal(mill.meter, false);
    assert.deepEqual(mill.finish, { show: false, blocked: true, reason: '', title: 'Turn in Old Mill' });
});

test('finishState takes the quests part\'s own verdict when quest.progress gives one', () => {
    const taken = wolves();
    assert.deepEqual(finishState(taken, { have: 3, need: 3, met: true, finish: { ok: false, reason: 'Not here.' } }, { place: { kind: 'settlement' } }),
        { show: true, blocked: true, reason: 'Not here.' });
    assert.deepEqual(finishState(taken, { have: 3, need: 3, met: true, finish: { ok: true, reason: '' } }, { place: { kind: 'wild' } }),
        { show: true, blocked: false, reason: '' });
    assert.deepEqual(finishState(taken, null, null), { show: false, blocked: true, reason: '' });
});

test('quest.board keeps at most 20 finished quests, latest first, and counts them all', () => {
    const threads = Array.from({ length: 25 }, (_, i) => thread(`th_done${String(i).padStart(4, '0')}`, 'quest', `Job ${i}`, {}, closed(i % 2 ? 'failed' : 'declined', i + 1)));
    const board = run(makeState({ threads }), 'quest.board');
    assert.equal(board.finished.length, 20);
    assert.equal(board.finishedCount, 25);
    assert.equal(board.finished[0].key, 'Job 24');
    assert.deepEqual([...new Set(board.finished.map(item => item.outcomeText))].sort(), ['Failed', 'Turned down']);
    assert.deepEqual([board.hasOffers, board.hasActive], [false, false]);
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
