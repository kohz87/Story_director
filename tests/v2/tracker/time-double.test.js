// The same stretch of time counts once: a "~ time <date>" and a "! time +X" in one reply (Ersveil Blade, replies 20 and 24).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeCalendar } from '../../../src/calendar.js';
import { lastProblems, makeState, reply } from './helpers/fake-ctx.js';

const gregorian = makeCalendar('gregorian');
const minutes = state => state.domains.director.time.minutes;
const at = text => gregorian.parse(text).abs;
const start = () => reply(makeState(), '~ time March 3, 2026, 01:15 pm').state;

test('a set and the advance for the same stretch (reply 24): only the set counts', () => {
    const state = reply(start(), '~ time March 3, 2026, 05:30 pm\n! time +4h15m').state;
    assert.equal(minutes(state), at('March 3, 2026, 05:30 pm'));
});

test('one line "~ time <date> · ! time +1h15m" (reply 20), with and without brackets: only the set counts', () => {
    for (const text of ['~ time <March 3, 2026, 02:30 pm> · ! time +1h15m', '~ time March 3, 2026, 02:30 pm · ! time +1h15m']) {
        const state = reply(start(), text).state;
        assert.equal(minutes(state), at('March 3, 2026, 02:30 pm'), text);
        assert.deepEqual(lastProblems(state), [], text);
    }
});

test('a set and a different stretch both apply in order', () => {
    const state = reply(start(), '~ time March 3, 2026, 05:30 pm\n! time +30m').state;
    assert.equal(minutes(state), at('March 3, 2026, 06:00 pm'));
});

test('the advance first and then the set for the same stretch: only the set counts', () => {
    const state = reply(start(), '! time +4h15m\n~ time March 3, 2026, 05:30 pm').state;
    assert.equal(minutes(state), at('March 3, 2026, 05:30 pm'));
    // Within 15 minutes counts as the same stretch, further does not.
    assert.equal(minutes(reply(start(), '! time +4h\n~ time March 3, 2026, 05:30 pm').state), at('March 3, 2026, 05:30 pm'));
    assert.equal(minutes(reply(start(), '! time +1h\n~ time March 3, 2026, 05:30 pm').state), at('March 3, 2026, 05:30 pm'));
});

test('a stretch that is not the gap is still added (an hour, a set of 5:30 pm, an hour more)', () => {
    const state = reply(start(), '~ time March 3, 2026, 05:30 pm\n! time +1h').state;
    assert.equal(minutes(state), at('March 3, 2026, 06:30 pm'));
});

test('a bad date in the one-line form still warns', () => {
    const state = reply(start(), '~ time <March 3, 2026, 25:99 pm> · ! time +1h').state;
    assert.ok(lastProblems(state).some(problem => problem.kind === 'time'));
    assert.equal(minutes(state), at('March 3, 2026, 02:15 pm'));
});

test('a different reply is not the same stretch', () => {
    let state = reply(start(), '~ time March 3, 2026, 05:30 pm').state;
    state = reply(state, '! time +4h15m').state;
    assert.equal(minutes(state), at('March 3, 2026, 09:45 pm'));
});
