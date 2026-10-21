// The story clock: `time` lines set and advance `director.time.minutes` on the reader's calendar.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeCalendar } from '../../../src/calendar.js';
import { part } from '../../../src/v2/tracker/index.js';
import { durationMinutes, settingsDefaults } from '../../../src/v2/tracker/time.js';
import { lastProblems, makeState, readLine, reply, runCommand, thread } from './helpers/fake-ctx.js';

const gregorian = makeCalendar('gregorian');
const minutes = state => state.domains.director.time.minutes;
const CUSTOM = { calendar: { preset: 'custom', era: 'CY', months: ['Haywane | 30', 'Goldwane | 30', 'Frostwane | 30'], week: [] } };

test('stretches of time read as minutes; anything else is not one', () => {
    for (const [text, expected] of [['+2h', 120], ['2 hours', 120], ['+1d 4h', 1680], ['2h30m', 150], ['an hour and 30 minutes', 90], ['half an hour', 30], ['+3 days later', 4320], ['1.5h', 90], ['+1 week', 10080]]) {
        assert.equal(durationMinutes(text), expected, text);
    }
    for (const text of ['Goldwane 12', '+2 apples', '', 'evening', '0h']) assert.equal(durationMinutes(text), null, text);
});

test('~ time sets the clock; ! time moves it on; ctx.time() reads it', () => {
    let state = makeState();
    assert.equal(minutes(state), null);
    state = reply(state, '~ time March 3, 2026, 08:00 am').state;
    assert.equal(minutes(state), gregorian.parse('March 3, 2026, 08:00 am').abs);
    const run = runCommand(state, part.kinds.time.apply, readLine('! time +2h'));
    assert.equal(run.ctx.time(), minutes(state) + 120);
    assert.deepEqual(run.result.data, { minutes: minutes(state) + 120, from: minutes(state) });
    assert.equal(run.result.summary, 'Story time: March 3, 2026, 10:00 am.');
    assert.equal(run.result.narrate, false);
    state = run.state;
    state = reply(state, '+ time 30 minutes').state;
    assert.equal(gregorian.format(minutes(state)), 'March 3, 2026, 10:30 am');
    // A date without a year is the nearest to now; a time alone is today's, or tomorrow's when past.
    state = reply(state, '~ time March 5, dusk').state;
    assert.equal(gregorian.format(minutes(state)), 'March 5, 2026, 07:00 pm');
    state = reply(state, '~ time 07:00 am').state;
    assert.equal(gregorian.format(minutes(state)), 'March 6, 2026, 07:00 am');
    state = reply(state, '~ time noon').state;
    assert.equal(gregorian.format(minutes(state)), 'March 6, 2026, 12:00 pm');
    assert.deepEqual(part.queries['director.time'](state), { minutes: minutes(state) });
    assert.deepEqual(part.domains.director.validate(state.domains.director, state), []);
});

test('time lines the clock cannot use are Problems and change nothing', () => {
    let state = makeState();
    state = reply(state, '! time +2h').state;
    assert.equal(minutes(state), null);
    assert.deepEqual(lastProblems(state).map(problem => problem.kind), ['time']);
    assert.match(lastProblems(state)[0].text, /not set yet/);
    state = reply(state, '~ time evening').state;
    assert.equal(minutes(state), null, 'a time of day with no day to put it on');
    state = reply(state, '~ time March 3, 2026, 08:00 am').state;
    const set = minutes(state);
    for (const line of ['- time 2h', '? time how late is it', '~ time whenever']) {
        const next = reply(state, line).state;
        assert.equal(minutes(next), set, line);
        assert.deepEqual(lastProblems(next).map(problem => problem.kind), ['time'], line);
    }
});

test('the calendar is the reader\'s: settings section Calendar, v1 defaults', () => {
    assert.equal(part.settings.section, 'Calendar');
    assert.deepEqual(part.settings.defaults, settingsDefaults());
    assert.equal(part.settings.defaults.calendar.preset, 'gregorian');
    assert.equal(part.settings.defaults.calendar.months[0].name, 'January');
    let state = reply(makeState(), '~ time CY 611, Goldwane 12, 12:45 pm', { settings: CUSTOM }).state;
    const custom = makeCalendar(CUSTOM.calendar);
    assert.equal(custom.format(minutes(state)), 'CY 611, Goldwane 12, 12:45 pm');
    state = reply(state, '! time +1d', { settings: CUSTOM }).state;
    assert.equal(custom.format(minutes(state)), 'CY 611, Goldwane 13, 12:45 pm');
});

test('threads remember the story time they were changed at', () => {
    let state = reply(makeState(), '~ time March 3, 2026, 08:00 am\n+ hook River stranger — who').state;
    state = reply(state, '! time +3h\n~ hook River stranger | now: at the inn').state;
    const track = state.domains.director.threads[thread(state, 'River stranger').id].track;
    assert.equal(track.created.time, gregorian.parse('March 3, 2026, 08:00 am').abs);
    assert.equal(track.changed.time, gregorian.parse('March 3, 2026, 11:00 am').abs);
    assert.deepEqual([track.created.turn, track.changed.turn], [1, 2]);
});
