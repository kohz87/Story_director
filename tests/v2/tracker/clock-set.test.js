// The reader's own edit of the story clock (`director.clock`, tracker/clock-set.js): the date and time on the chat's
// calendar (leap years included), every refusal in one plain sentence that names the field, and `director.time` giving the
// same clock back as `parts`. The whole-host cases (swipe, delete, reload, a pack calendar, a rewind) are in
// clock-set-host.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PRESETS, makeCalendar } from '../../../src/calendar.js';
import { part } from '../../../src/v2/tracker/index.js';
import { CLOCK, clockCommand, clockProblem, heroDate, partsOf } from '../../../src/v2/tracker/clock-set.js';
import { calendarOf, settingsDefaults } from '../../../src/v2/tracker/time.js';
import { makeState, reply, runCommand } from './helpers/fake-ctx.js';
import { statusExtras } from '../../../src/v2/screens/queries.js';
import { formatStoryTime } from '../../vendor/story-block/src/v2/view/clock.js';

const MONTHS = ['Dawnwane', 'Rainmoot', 'Greengale', 'Highsun', 'Goldwane', 'Haywane', 'Emberwane', 'Nightfall', 'Frostfall', 'Deepwinter', 'Icewane', 'Yearsend']
    .map(name => ({ name, days: 30 }));
const ERSVEIL = { pack: 'ersveil-bluewatch', era: 'CY', months: MONTHS, start: { year: 611, month: 'Goldwane', day: 12, hour: 6, minute: 40 } };
const packs = (calendar = ERSVEIL) => ({ 'packs.calendar': () => structuredClone(calendar) });
const GREGORIAN = makeCalendar(PRESETS.gregorian);

const minutes = state => state.domains.director.time.minutes;
// The reader's click: cause `ui`, and a ctx that can mark a set (the fake ctx has no `ctx.absolute`; the host's has).
function click(state, payload, options = {}) {
    const marked = [];
    const run = runCommand(state, (ctx, input) => clockCommand({ ...ctx, cause: 'ui', absolute: (domain, path) => marked.push(`${domain}${path}`) }, input), payload, options);
    return { ...run, marked };
}
const at = (year, month, day, time = 0) => ({ year, month, day, minutes: time });

test('director.clock is a command of the tracker part, next to director.seed', () => {
    assert.equal(CLOCK, 'director.clock');
    assert.equal(part.commands[CLOCK], clockCommand);
    assert.deepEqual(Object.keys(part.commands).slice(0, 2), ['director.seed', 'director.clock']);
});

test('director.time gives parts for a set clock and null for an unset one; text and minutes are as they were', () => {
    const tools = { query: name => (name === 'packs.calendar' ? ERSVEIL : null), settings: () => settingsDefaults() };
    const unset = part.queries['director.time'](makeState(), {}, tools);
    assert.deepEqual(unset, { minutes: null, text: '', parts: null });

    const set = click(makeState(), at(611, 5, 12, 6 * 60 + 40), { queries: packs() });
    assert.equal(set.ok, true, set.message);
    const now = part.queries['director.time'](set.state, {}, tools);
    assert.deepEqual(now, { minutes: minutes(set.state), text: 'CY 611, Goldwane 12, 06:40 am', parts: { year: 611, month: 5, day: 12, minutes: 400 } });
    // The parts are what the command takes: setting them again changes nothing.
    const again = click(set.state, now.parts, { queries: packs() });
    assert.equal(minutes(again.state), minutes(set.state));
});

test('parts on a calendar with leap years: February 29 only in a leap year, the century rules, the last minute of the day', () => {
    const feb29 = GREGORIAN.toAbs({ year: 2024, month: 1, day: 29, minutes: 0 });
    assert.deepEqual(partsOf(GREGORIAN, feb29), { year: 2024, month: 2, day: 29, minutes: 0 });
    assert.deepEqual(partsOf(GREGORIAN, feb29 + 1439), { year: 2024, month: 2, day: 29, minutes: 1439 });
    assert.deepEqual(partsOf(GREGORIAN, feb29 + 1440), { year: 2024, month: 3, day: 1, minutes: 0 });
    // Every day of 2000 (a leap year) and 1900 (not one) reads back as the date it was made from.
    for (const year of [2000, 1900, 2023]) {
        for (let month = 1; month <= 12; month += 1) {
            for (let day = 1; day <= GREGORIAN.daysInMonth(year, month - 1); day += 1) {
                const abs = GREGORIAN.toAbs({ year, month: month - 1, day, minutes: 725 });
                assert.deepEqual(partsOf(GREGORIAN, abs), { year, month, day, minutes: 725 }, `${year}-${month}-${day}`);
            }
        }
    }
    assert.equal(partsOf(GREGORIAN, null), null);
    assert.equal(partsOf(GREGORIAN, 1.5), null);

    // The query on a Gregorian chat, a leap day.
    const run = click(makeState(), at(2024, 2, 29, 90));
    assert.equal(run.ok, true, run.message);
    assert.deepEqual(part.queries['director.time'](run.state, {}, {}).parts, { year: 2024, month: 2, day: 29, minutes: 90 });
    assert.equal(part.queries['director.time'](run.state, {}, {}).text, 'February 29, 2024, 01:30 am');
});

test('every refusal is one plain sentence that names the field, and changes nothing', () => {
    const base = click(makeState(), at(2023, 6, 10, 600)).state;
    const refuses = (payload, sentence, options = {}) => {
        const run = click(base, payload, options);
        assert.equal(run.ok, false, JSON.stringify(payload));
        assert.equal(run.code, 'INVALID');
        assert.equal(run.message, sentence, JSON.stringify(payload));
        assert.equal(run.state, base, 'nothing was changed');
    };
    // No date, no time, or something that is not a whole number.
    for (const payload of [undefined, null, 'June 5', [], {}, { year: 2023, month: 6, day: 5 }, { ...at(2023, 6, 5, 60), minutes: undefined },
        { ...at(2023, 6, 5, 60), year: '2023' }, { ...at(2023, 6, 5, 60), day: 5.5 }, { ...at(2023, 6, 5, 60), month: null }, { ...at(2023, 6, 5, 60), minutes: Number.NaN },
        { ...at(2023, 6, 5, 60), year: Number.POSITIVE_INFINITY }]) {
        refuses(payload, 'Pick a date and a time.');
    }
    refuses(at(1000000, 6, 5, 60), 'Pick a year between -999999 and 999999.');
    refuses(at(-1000000, 6, 5, 60), 'Pick a year between -999999 and 999999.');
    refuses(at(2023, 0, 5, 60), 'Pick a month from the list.');
    refuses(at(2023, 13, 5, 60), 'Pick a month from the list.');
    refuses(at(2023, 6, 0, 60), 'Day must be 1 or more.');
    refuses(at(2023, 6, -3, 60), 'Day must be 1 or more.');
    refuses(at(2023, 6, 31, 60), 'June has 30 days.');
    refuses(at(2023, 1, 32, 60), 'January has 31 days.');
    refuses(at(2023, 2, 29, 60), 'February has 28 days in 2023.');
    refuses(at(1900, 2, 29, 60), 'February has 28 days in 1900.');
    refuses(at(2024, 2, 30, 60), 'February has 29 days in 2024.');
    refuses(at(2023, 6, 5, -1), 'Pick a time of day.');
    refuses(at(2023, 6, 5, 1440), 'Pick a time of day.');
    // The first thing wrong is the one named (year before month before day before time).
    refuses(at(2023, 13, 40, 5000), 'Pick a month from the list.');
    refuses(at(2023, 6, 40, 5000), 'June has 30 days.');
    // The same on an unset clock: a refusal leaves it unset.
    const none = click(makeState(), at(2023, 4, 31, 60));
    assert.deepEqual([none.ok, none.message, minutes(none.state)], [false, 'April has 30 days.', null]);
});

test('a pack calendar (Ersveil): its months, its length of a month, its era in the card line', () => {
    const queries = packs();
    const calendar = calendarOf(settingsDefaults(), ERSVEIL);
    const refuse = payload => click(makeState(), payload, { queries });
    assert.equal(refuse(at(611, 5, 31, 60)).message, 'Goldwane has 30 days.');
    assert.equal(refuse(at(611, 12, 31, 60)).message, 'Yearsend has 30 days.');
    assert.equal(refuse(at(611, 13, 1, 60)).message, 'Pick a month from the list.', 'Ersveil has twelve months');
    assert.equal(refuse(at(611, 2, 30, 60)).ok, true, 'a month of 30 days has its 30th day');
    // No leap years there: the day after Yearsend 30 is Dawnwane 1 of the next year.
    const last = click(makeState(), at(611, 12, 30, 1439), { queries });
    assert.deepEqual(partsOf(calendar, minutes(last.state) + 1), { year: 612, month: 1, day: 1, minutes: 0 });

    // The first set writes the year (the clock had none); with the year unchanged the line leaves year and era out.
    const first = click(makeState(), at(611, 5, 12, 6 * 60 + 40), { queries });
    assert.equal(first.result.summary, 'Clock set to CY 611, Goldwane 12, 6:40 am');
    const same = click(first.state, at(611, 5, 14, 18 * 60), { queries });
    assert.equal(same.result.summary, 'Clock set to Goldwane 14, 6:00 pm');
    assert.equal(same.result.data.date, 'CY 611, Goldwane 14, 6:00 pm', 'the card\'s tooltip: the full date');
    // A change of year writes year and era in.
    const next = click(same.state, at(612, 1, 2, 0), { queries });
    assert.equal(next.result.summary, 'Clock set to CY 612, Dawnwane 2, 12:00 am');
});

test('it sets the clock as a set (ctx.absolute), tells the host not to narrate, and is the reader\'s alone', () => {
    const start = reply(makeState(), '~ time June 3, 2023, 08:00 am').state;
    const run = click(start, at(2023, 6, 5, 18 * 60 + 30));
    assert.equal(run.ok, true, run.message);
    assert.deepEqual(run.marked, ['director/time/minutes']);
    assert.equal(minutes(run.state), GREGORIAN.toAbs({ year: 2023, month: 5, day: 5, minutes: 18 * 60 + 30 }));
    assert.equal(run.result.summary, 'Clock set to June 5, 6:30 pm', 'the year did not change: left out');
    assert.equal(run.result.narrate, false);
    assert.deepEqual(run.result.data, { minutes: minutes(run.state), from: minutes(start), date: 'June 5, 2023, 6:30 pm', edit: true });
    // The same date again is a set too (written even when the clock holds it).
    const same = click(run.state, at(2023, 6, 5, 18 * 60 + 30));
    assert.deepEqual(same.marked, ['director/time/minutes']);
    assert.equal(minutes(same.state), minutes(run.state));

    // The story, another module and a bare ctx cannot: only a click (cause ui).
    for (const cause of ['story', 'system']) {
        const refused = runCommand(start, (ctx, input) => clockCommand({ ...ctx, cause }, input), at(2023, 6, 5, 60));
        assert.equal(refused.ok, false);
        assert.equal(refused.code, 'REFUSED', cause);
        assert.equal(refused.message, 'Only you set the story clock by hand; the story sets it with a time line.');
        assert.equal(minutes(refused.state), minutes(start));
    }
    const asStory = runCommand(start, clockCommand, at(2023, 6, 5, 60));
    assert.equal(asStory.code, 'REFUSED', 'the fake ctx\'s own cause is the story');
});

test('it is not held to the longest time jump, and it may go back (a rewind)', () => {
    const start = reply(makeState(), '~ time June 3, 2023, 08:00 am').state;
    // A year and a half on: a story line would be held to 30 days.
    const far = click(start, at(2024, 12, 25, 0));
    assert.equal(far.ok, true, far.message);
    assert.equal(far.result.summary, 'Clock set to December 25, 2024, 12:00 am', 'a change of year writes the year in');
    assert.ok(minutes(far.state) - minutes(start) > 30 * 1440);
    assert.deepEqual(part.queries['director.time'](far.state, {}, {}).parts, { year: 2024, month: 12, day: 25, minutes: 0 });
    // Back before where the story began.
    const back = click(far.state, at(2023, 5, 1, 0));
    assert.equal(back.ok, true, back.message);
    assert.ok(minutes(back.state) < minutes(start));
    assert.equal(back.result.data.from, minutes(far.state));
    assert.equal(back.result.summary, 'Clock set to May 1, 2023, 12:00 am');
    // The story\'s lines go on from the edited clock, held to the jump from there.
    const later = reply(back.state, '! time +2h').state;
    assert.equal(minutes(later), minutes(back.state) + 120);
    // And a negative year is a date too.
    assert.equal(click(start, at(-5, 3, 3, 0)).ok, true);
});

test('clockProblem is pure: a calendar and a date in, a sentence or nothing out', () => {
    assert.equal(clockProblem(GREGORIAN, at(2024, 2, 29, 0)), '');
    assert.equal(clockProblem(GREGORIAN, at(2025, 2, 29, 0)), 'February has 28 days in 2025.');
    assert.equal(clockProblem(GREGORIAN, null), 'Pick a date and a time.');
    const one = makeCalendar({ preset: 'custom', months: [{ name: 'Only', days: 10 }], leapYears: true });
    assert.equal(clockProblem(one, at(5, 1, 11, 0)), 'Only has 10 days in 5.', 'a one-month calendar: its only month is the leap month');
    assert.equal(clockProblem(one, at(5, 2, 1, 0)), 'Pick a month from the list.');
});

test('the card line and its tooltip write the time the way the Game view hero does (Story Block\'s fmt.time): no leading zero, every hour of the day', () => {
    const calendars = [
        PRESETS.gregorian,
        { preset: 'custom', era: 'CY', months: MONTHS, leapYears: false },
        { preset: 'custom', era: '', months: MONTHS.slice(0, 3), leapYears: true },
    ];
    for (const config of calendars) {
        const calendar = makeCalendar(config);
        for (const year of [611, 1900, 2024]) {
            for (let hour = 0; hour < 24; hour += 1) {
                const abs = calendar.toAbs({ year, month: 1, day: 3, minutes: hour * 60 + (hour * 7) % 60 });
                assert.equal(heroDate(calendar, abs), formatStoryTime(abs, calendar.config), `${config.era || 'no era'} ${year} ${hour}h`);
            }
        }
    }
    // Through the command: the tooltip date is the hero's text for the clock now, the line its short form.
    const run = click(makeState(), at(611, 5, 12, 19 * 60 + 40), { queries: packs() });
    const calendar = calendarOf(settingsDefaults(), ERSVEIL);
    assert.equal(run.result.data.date, formatStoryTime(minutes(run.state), calendar.config));
    assert.equal(run.result.data.date, 'CY 611, Goldwane 12, 7:40 pm');
    assert.equal(heroDate(calendar, minutes(run.state), { year: false }), 'Goldwane 12, 7:40 pm');
    // The Status card's Time row (director.status `when`) is that text; unset: nothing. director.time's text is not touched.
    const tools = { query: name => (name === 'packs.calendar' ? ERSVEIL : null), settings: () => settingsDefaults() };
    const shown = { ...tools, query: name => (name === 'director.calendar' ? part.queries['director.calendar'](run.state, {}, tools) : tools.query(name)) };
    assert.equal(statusExtras(run.state, {}, shown).when, 'CY 611, Goldwane 12, 7:40 pm');
    assert.equal(statusExtras(makeState(), {}, shown).when, '');
    assert.equal(part.queries['director.time'](run.state, {}, tools).text, 'CY 611, Goldwane 12, 07:40 pm');
});

test('calendarRule: only a custom calendar without a week; foreignNames: whole words, capitalised, "May" only as a date', async () => {
    const { calendarRule, foreignNames } = await import('../../../src/v2/tracker/calendar-settings.js');
    const custom = makeCalendar({ preset: 'custom', era: 'CY', months: [{ name: 'Goldwane', days: 30 }, { name: 'Icewane', days: 30 }], leapYears: false });
    assert.equal(calendarRule(custom), "Dates use this world's calendar only: months Goldwane, Icewane; no weekdays. Never use Monday–Sunday or January–December, in narration or speech; say 'three days ago', 'yesterday' or the date (Goldwane 14).");
    assert.equal(calendarRule(GREGORIAN), '');
    assert.equal(calendarRule(makeCalendar({ preset: 'custom', months: [{ name: 'A', days: 30 }], week: ['Ax', 'Bx'] })), '');
    assert.deepEqual(foreignNames('On Tuesday and Friday; Tuesdays no; tuesday no; Mayhem no; in December, of May, May 4. "May I?" Maybe.', custom), ['Tuesday', 'Friday', 'December', 'May']);
    assert.deepEqual(foreignNames('March on at August noon. The August hall.', custom), []);
    assert.deepEqual(foreignNames('Goldwane 3', makeCalendar({ preset: 'custom', months: [{ name: 'March', days: 30 }] })), []);
    assert.deepEqual(foreignNames('in March', makeCalendar({ preset: 'custom', months: [{ name: 'March', days: 30 }] })), []);
});
