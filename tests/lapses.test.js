// Tests for src/lapses.js (0.9.19): beats that slip and offers that lapse, closed by the lines
// index.js writes into the reply where time ran past them, and read back for the next note.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeCalendar } from '../src/calendar.js';
import { parseChanges } from '../src/changes.js';
import { LAPSED_REASON, SLIPPED_REASON, SLIP_GRACE_DAYS, lapseLines, lapsedOffers, lapsesIn, slippedBeats } from '../src/lapses.js';
import { applyOps, emptyTracker, findRecord, isOffer, questsDoneIn, replay } from '../src/tracker.js';

const calendar = makeCalendar({ preset: 'custom', months: ['Haywane', 'Goldwane', 'Reapwane'].map(name => ({ name, days: 30 })) });
const at = text => calendar.parse(text).abs;

function ops(text) {
    const parsed = parseChanges(text);
    assert.deepEqual(parsed.errors, [], text);
    return parsed.ops;
}

// A tracker from one reply's lines (no reader's message: nothing gated).
const trackerOf = (text, message = 1) => applyOps(emptyTracker(), ops(text), { message }).tracker;
const keys = records => records.map(record => record.key);

test('the grace is two story days', () => {
    assert.equal(SLIP_GRACE_DAYS, 2);
});

test('a beat slips once the story time passes its date and the grace (0.9.19)', () => {
    const tracker = trackerOf('+ beat Guards sack the Stray Oar — on: Goldwane 13');
    // A date without a time counts to the end of its day; two more days of grace.
    for (const now of ['Goldwane 13, 09:00 am', 'Goldwane 14, 11:00 pm', 'Goldwane 15, 11:59 pm']) {
        assert.deepEqual(slippedBeats(tracker, { calendar, now: at(now) }), [], now);
    }
    for (const now of ['Goldwane 16, 12:00 am', 'Goldwane 20, 09:00 am']) {
        assert.deepEqual(keys(slippedBeats(tracker, { calendar, now: at(now) })), ['Guards sack the Stray Oar'], now);
    }
    // A beat at a clock time: the grace runs from that minute.
    const timed = trackerOf('+ beat Toll riders reach the ford — on: Goldwane 13, 06:00 pm');
    assert.deepEqual(slippedBeats(timed, { calendar, now: at('Goldwane 15, 06:00 pm') }), []);
    assert.equal(slippedBeats(timed, { calendar, now: at('Goldwane 15, 06:01 pm') }).length, 1);
    // The grace can be set; a beat written with due instead of on slips the same.
    assert.equal(slippedBeats(tracker, { calendar, now: at('Goldwane 14, 09:00 am'), graceDays: 0 }).length, 1);
    assert.equal(slippedBeats(trackerOf('+ beat Riders — due: Goldwane 13'), { calendar, now: at('Goldwane 16, 09:00 am') }).length, 1);
});

test('what does not slip: no date, no time, no calendar, closed, fired, or not a beat', () => {
    const now = at('Goldwane 25, 09:00 am');
    assert.deepEqual(slippedBeats(trackerOf('+ beat Riders — then: they come'), { calendar, now }), [], 'no date');
    assert.deepEqual(slippedBeats(trackerOf('+ beat Riders — on: before the frost'), { calendar, now }), [], 'not a date');
    assert.deepEqual(slippedBeats(trackerOf('+ beat Riders — on: Goldwane 13'), { calendar, now: null }), [], 'no story time');
    assert.deepEqual(slippedBeats(trackerOf('+ beat Riders — on: Goldwane 13'), { calendar: null, now }), [], 'no calendar');
    assert.deepEqual(slippedBeats(trackerOf('+ beat Riders — on: Goldwane 13\n- Riders — they came'), { calendar, now }), [], 'closed');
    // Only beats: an event, a clock, an agenda or a quest keeps its date.
    const others = trackerOf([
        '+ event Fair — on: Goldwane 13',
        '+ clock Graves — due: Goldwane 13',
        '+ agenda Geva — then: files the warrant | on: Goldwane 13',
        '+ quest Wolves — giver: Hobb | due: Goldwane 13',
    ].join('\n'));
    assert.deepEqual(slippedBeats(others, { calendar, now }), []);
});

test('a fired beat never slips; one put back on the schedule can', () => {
    const now = at('Goldwane 25, 09:00 am');
    const placed = trackerOf('+ beat Riders — on: Goldwane 13', 1);
    // `!` alone clears the date.
    const fired = applyOps(placed, ops('! Riders — the riders come'), { message: 2 }).tracker;
    assert.deepEqual(slippedBeats(fired, { calendar, now }), []);
    // `!` with parts keeps it, but the beat has played out.
    const withParts = applyOps(placed, ops('! Riders — the riders come | now: at the ford'), { message: 2 }).tracker;
    assert.equal(findRecord(withParts, 'Riders').fields.on, 'Goldwane 13');
    assert.deepEqual(slippedBeats(withParts, { calendar, now }), []);
    // A new date after that is a new appointment, and it can slip.
    const again = applyOps(withParts, ops('~ Riders — on: Goldwane 20'), { message: 3 }).tracker;
    assert.equal(slippedBeats(again, { calendar, now }).length, 1);
    // A change that leaves the date alone does not make a fired beat slip.
    const moved = applyOps(withParts, ops('~ Riders — now: back at camp'), { message: 3 }).tracker;
    assert.deepEqual(slippedBeats(moved, { calendar, now }), []);
});

test('an offer lapses at its deadline; a date alone runs to the end of its day (0.9.19)', () => {
    const tracker = trackerOf('+ hook Rat Culling — giver: Danique | reward: 4 copper | due: Goldwane 13');
    assert.ok(isOffer(findRecord(tracker, 'Rat Culling')));
    assert.deepEqual(lapsedOffers(tracker, { calendar, now: at('Goldwane 13, 11:58 pm') }), []);
    assert.deepEqual(keys(lapsedOffers(tracker, { calendar, now: at('Goldwane 13, 11:59 pm') })), ['Rat Culling']);
    const timed = trackerOf('+ hook Ferry — reward: 2 silver | due: Goldwane 13 dawn');
    assert.deepEqual(lapsedOffers(timed, { calendar, now: at('Goldwane 13, 05:59 am') }), []);
    assert.equal(lapsedOffers(timed, { calendar, now: at('Goldwane 13, 06:00 am') }).length, 1);
});

test('what does not lapse: no deadline, a quest taken on, a plain hook, closed, no time', () => {
    const now = at('Goldwane 25, 09:00 am');
    const tracker = trackerOf([
        '+ hook Rat Culling — giver: Danique | reward: 4 copper',
        '+ quest Wolves — giver: Hobb | reward: 4 silver | due: Goldwane 13',
        '+ hook River stranger — who pulled Ren out | due: Goldwane 13',
        '+ hook Ferry — reward: 2 silver | due: Goldwane 13',
        '- Ferry — someone else took it',
    ].join('\n'));
    assert.deepEqual(lapsedOffers(tracker, { calendar, now }), []);
    assert.deepEqual(lapsedOffers(trackerOf('+ hook Ferry — reward: 2 silver | due: Goldwane 13'), { calendar, now: null }), []);
});

test('the lines close them as resolved, not as failures, choices or quest outcomes', () => {
    const tracker = trackerOf([
        '+ beat Guards sack the Stray Oar — on: Goldwane 13',
        '+ hook Rat Culling — giver: Danique | reward: 4 copper | due: Goldwane 13',
    ].join('\n'));
    const now = at('Goldwane 16, 09:00 am');
    const lines = lapseLines({ slipped: slippedBeats(tracker, { calendar, now }), lapsed: lapsedOffers(tracker, { calendar, now }) });
    assert.deepEqual(lines, ['- Guards sack the Stray Oar — slipped', '- Rat Culling — offer lapsed']);
    // Gated as a real reply is (the reader's message said nothing of either): still closed.
    const { tracker: after, problems } = applyOps(tracker, ops(lines.join('\n')), { message: 2, time: now, said: 'I walk to the docks.' });
    assert.deepEqual(problems.filter(problem => problem.kind === 'not-chosen'), []);
    const beat = findRecord(after, 'Guards sack the Stray Oar');
    const offer = findRecord(after, 'Rat Culling');
    assert.equal(beat.status, 'resolved');
    assert.deepEqual(beat.resolved, { message: 2, time: now, reason: SLIPPED_REASON });
    assert.equal(offer.status, 'resolved');
    assert.deepEqual(offer.resolved, { message: 2, time: now, reason: LAPSED_REASON });
    assert.deepEqual(questsDoneIn(after, 2), []);
    // Nothing left to close: the next reply writes nothing again.
    assert.deepEqual(slippedBeats(after, { calendar, now: at('Goldwane 20, 09:00 am') }), []);
    assert.deepEqual(lapsedOffers(after, { calendar, now: at('Goldwane 20, 09:00 am') }), []);
});

test('lapsesIn reads what one reply closed this way, for the next note only', () => {
    const entries = [
        { message: 1, ops: ops('+ beat Guards sack the Stray Oar — on: Goldwane 13\n+ hook Rat Culling — giver: Danique, the widow | reward: 4 copper | due: Goldwane 13\n+ beat Riders — on: Goldwane 14') },
        { message: 3, ops: ops('- Guards sack the Stray Oar — slipped\n- Rat Culling — offer lapsed\n- Riders — they came') },
        { message: 5, ops: ops('+ event Fair — on: Goldwane 30') },
    ];
    const { tracker } = replay(entries);
    assert.deepEqual(lapsesIn(tracker, 3), {
        slipped: [{ key: 'Guards sack the Stray Oar', on: 'Goldwane 13', giver: '' }],
        lapsed: [{ key: 'Rat Culling', on: '', giver: 'Danique, the widow' }],
    });
    assert.deepEqual(lapsesIn(tracker, 5), { slipped: [], lapsed: [] });
    assert.deepEqual(lapsesIn(tracker, -1), { slipped: [], lapsed: [] });
    assert.deepEqual(lapsesIn(tracker, undefined), { slipped: [], lapsed: [] });
});

test('nothing is mutated', () => {
    const tracker = trackerOf('+ beat Riders — on: Goldwane 13\n+ hook Ferry — reward: 2 silver | due: Goldwane 13');
    const copy = structuredClone(tracker);
    slippedBeats(tracker, { calendar, now: at('Goldwane 25, 09:00 am') });
    lapsedOffers(tracker, { calendar, now: at('Goldwane 25, 09:00 am') });
    lapsesIn(tracker, 1);
    assert.deepEqual(tracker, copy);
});
