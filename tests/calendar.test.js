// Tests for src/calendar.js: config normalisation, date maths, formatting and parsing.
import test from 'node:test';
import assert from 'node:assert/strict';

import { PRESETS, DEFAULT_PARTS_OF_DAY, normalizeCalendar, makeCalendar, parseWeek, sharedCalendar } from '../src/calendar.js';

const MONTHS = [
    'Dawnwane', 'Rainmoot', 'Greengale', 'Highsun', 'Goldwane', 'Haywane',
    'Emberwane', 'Nightfall', 'Frostfall', 'Deepwinter', 'Icewane', 'Yearsend',
];
const GOLDWANE = 4;
const HAYWANE = 5;
const YEARSEND = 11;

const cal = makeCalendar({ preset: 'custom', era: 'CY', months: MONTHS, daysPerMonth: 30 });
const greg = makeCalendar(PRESETS.gregorian);

// Haywane 12, CY 611, 05:35 pm
const REF = cal.toAbs({ year: 611, month: HAYWANE, day: 12, minutes: 17 * 60 + 35 });
const at = (month, day, minutes = 0, year = 611) => cal.toAbs({ year, month, day, minutes });

test('custom calendar: 12 months of 30 days, no leap years', () => {
    assert.equal(cal.config.preset, 'custom');
    assert.equal(cal.config.era, 'CY');
    assert.deepEqual(cal.config.months.map(m => m.name), MONTHS);
    assert.ok(cal.config.months.every(m => m.days === 30));
    assert.equal(cal.daysInYear(611), 360);
    assert.equal(cal.daysInYear(612), 360);
    assert.equal(cal.toAbs({ year: 0, month: 0, day: 1 }), 0);
    assert.equal(cal.toAbs({ year: 1, month: 0, day: 1 }), 360 * 1440);
    assert.deepEqual(cal.fromAbs(REF), { year: 611, month: HAYWANE, day: 12, minutes: 1055 });
});

test('toAbs and fromAbs round-trip, and overflowing parts roll over', () => {
    for (const abs of [0, 1, 1439, 1440, REF, 360 * 1440 - 1, -1, -1440 * 400 - 7]) {
        assert.equal(cal.toAbs(cal.fromAbs(abs)), abs);
        assert.equal(greg.toAbs(greg.fromAbs(abs)), abs);
    }
    assert.equal(cal.toAbs({ year: 611, month: 12, day: 1 }), cal.toAbs({ year: 612, month: 0, day: 1 }));
    assert.equal(cal.toAbs({ year: 611, month: YEARSEND, day: 31 }), cal.toAbs({ year: 612, month: 0, day: 1 }));
});

test('gregorian preset: real month lengths and leap years', () => {
    assert.equal(greg.config.preset, 'gregorian');
    assert.equal(greg.daysInYear(2024), 366);
    assert.equal(greg.daysInYear(2023), 365);
    assert.equal(greg.daysInYear(1900), 365);
    assert.equal(greg.daysInYear(2000), 366);
    assert.equal(greg.daysInMonth(2024, 1), 29);
    assert.equal(greg.daysInMonth(2023, 1), 28);
    assert.equal(greg.daysInMonth(2023, 3), 30);

    const feb29 = greg.toAbs({ year: 2024, month: 1, day: 29 });
    assert.deepEqual(greg.fromAbs(feb29), { year: 2024, month: 1, day: 29, minutes: 0 });
    // Feb 29 2023 does not exist: it rolls over to March 1.
    assert.deepEqual(greg.fromAbs(greg.toAbs({ year: 2023, month: 1, day: 29 })), { year: 2023, month: 2, day: 1, minutes: 0 });

    const p = greg.parse('February 29, 2024');
    assert.equal(p.abs, feb29);
    assert.equal(greg.parse('February 29, 2023'), null);
    assert.equal(greg.parse('29 Feb 2023'), null);
    assert.equal(greg.parse('29 Feb 2024').abs, feb29);
});

test('gregorian day counts agree with JavaScript dates', () => {
    const days = (y, m, d) => Date.UTC(y, m, d) / 86400000;
    const pairs = [[1900, 0, 1, 2000, 1, 29], [1999, 11, 31, 2024, 2, 1], [2023, 0, 1, 2100, 2, 1]];
    for (const [y1, m1, d1, y2, m2, d2] of pairs) {
        const a = greg.toAbs({ year: y1, month: m1, day: d1 });
        const b = greg.toAbs({ year: y2, month: m2, day: d2 });
        assert.equal(greg.daysBetween(a, b), days(y2, m2, d2) - days(y1, m1, d1));
    }
});

test('parse: the reference date strings', () => {
    const p = cal.parse('CY 611, Haywane 12, 05:35 pm', { reference: REF });
    assert.equal(p.abs, REF);
    assert.deepEqual([p.year, p.month, p.day, p.minutes], [611, HAYWANE, 12, 1055]);
    assert.equal(p.hasTime, true);
    assert.equal(p.yearInferred, false);
    assert.equal(p.partOfDay, null);
    assert.equal(p.text, 'CY 611, Haywane 12, 05:35 pm');

    const gold = cal.parse('Goldwane 13', { reference: REF });
    assert.deepEqual([gold.year, gold.month, gold.day, gold.minutes], [611, GOLDWANE, 13, null]);
    assert.equal(gold.abs, at(GOLDWANE, 13));
    assert.equal(gold.yearInferred, true);

    const dusk = cal.parse('Goldwane 13, dusk', { reference: REF });
    assert.equal(dusk.abs, at(GOLDWANE, 13, 1140));
    assert.equal(dusk.partOfDay, 'dusk');
    assert.equal(dusk.hasTime, true);
    assert.equal(dusk.text, 'Goldwane 13, dusk');

    const bare = cal.parse('dusk', { reference: REF });
    assert.equal(bare.abs, at(HAYWANE, 12, 1140));
    assert.deepEqual([bare.year, bare.month, bare.day, bare.minutes], [611, HAYWANE, 12, 1140]);
    assert.equal(bare.partOfDay, 'dusk');

    assert.equal(cal.parse('Haywane 13, 09:00 am', { reference: REF }).abs, at(HAYWANE, 13, 540));

    const md = cal.parse('**on:** Haywane 14', { reference: REF });
    assert.equal(md.abs, at(HAYWANE, 14));
    assert.equal(md.text, 'Haywane 14');

    assert.equal(cal.parse('5 pm', { reference: REF }).abs, at(HAYWANE, 12, 17 * 60));
    assert.equal(cal.parse('17:50', { reference: REF }).abs, at(HAYWANE, 12, 17 * 60 + 50));

    const dmy = cal.parse('12 Goldwane 611', { reference: REF });
    assert.equal(dmy.abs, at(GOLDWANE, 12));
    assert.equal(dmy.yearInferred, false);
});

test('parse: finds the first date anywhere, and other time spellings', () => {
    const p = cal.parse('Geva files the warrant on Goldwane 17 at dawn, then rides on Haywane 2.', { reference: REF });
    assert.equal(p.abs, at(GOLDWANE, 17, 360));
    assert.equal(p.text, 'Goldwane 17 at dawn');

    assert.equal(cal.parse('dusk on Goldwane 13', { reference: REF }).abs, at(GOLDWANE, 13, 1140));
    assert.equal(cal.parse('Goldwane 13, 5:50pm', { reference: REF }).minutes, 17 * 60 + 50);
    assert.equal(cal.parse('Goldwane 13, 12:15 am', { reference: REF }).minutes, 15);
    assert.equal(cal.parse('Goldwane 13, 12 pm', { reference: REF }).minutes, 720);
    assert.equal(cal.parse('goldwane 13th, CY 612').year, 612);
    assert.equal(cal.parse('Goldwane 13, 611').year, 611);
    assert.equal(cal.parse('the 3rd of Goldwane').day, 3);
});

test('parse: rejects what is not a date', () => {
    assert.equal(cal.parse('', { reference: REF }), null);
    assert.equal(cal.parse(null, { reference: REF }), null);
    assert.equal(cal.parse('Nothing here.', { reference: REF }), null);
    assert.equal(cal.parse('Goldwane 31', { reference: REF }), null);
    assert.equal(cal.parse('Goldwane 0', { reference: REF }), null);
    assert.equal(cal.parse('Smarch 3', { reference: REF }), null);
    assert.equal(cal.parse('Goldwanes 3', { reference: REF }), null);
    assert.equal(cal.parse('13:75', { reference: REF }), null);
    // A bare time has no day without a reference.
    assert.equal(cal.parse('5 pm'), null);
});

test('parse: nearest-year inference', () => {
    const yearsend = cal.toAbs({ year: 611, month: YEARSEND, day: 28 });
    const next = cal.parse('Dawnwane 2', { reference: yearsend });
    assert.equal(next.year, 612);
    assert.equal(next.abs, cal.toAbs({ year: 612, month: 0, day: 2 }));
    assert.equal(next.yearInferred, true);

    const past = cal.parse('Haywane 10', { reference: REF });
    assert.equal(past.year, 611);
    assert.ok(past.abs < REF);

    // No reference and no year: year 0.
    assert.equal(cal.parse('Goldwane 13').year, 0);

    // February 29 with no year finds the nearest leap year (2028 is nearer than 2024).
    const ref2026 = greg.toAbs({ year: 2026, month: 5, day: 1 });
    assert.equal(greg.parse('Feb 29', { reference: ref2026 }).year, 2028);
});

test('parse: hasTime is false for a date without a time', () => {
    const p = cal.parse('Goldwane 13', { reference: REF });
    assert.equal(p.hasTime, false);
    assert.equal(p.minutes, null);
    assert.equal(p.partOfDay, null);
    assert.equal(p.abs % 1440, 0);
});

test('parse: unambiguous 3+ letter month prefixes', () => {
    assert.equal(cal.parse('Gold 13', { reference: REF }).abs, at(GOLDWANE, 13));
    assert.equal(cal.parse('13 Hay', { reference: REF }).month, HAYWANE);
    assert.equal(greg.parse('Dec 25, 2024').month, 11);
    assert.equal(cal.parse('Go 13', { reference: REF }), null);   // too short

    const frost = makeCalendar({ months: ['Frostmoot', 'Frostfall', 'Thaw'], daysPerMonth: 30 });
    assert.equal(frost.parse('Frost 3'), null);                   // ambiguous
    assert.equal(frost.parse('Frostf 3').month, 1);
    assert.equal(frost.parse('Thaw 3').month, 2);

    // A part of day is never read as a shortened month: 'night 3' is not Nightfall 3.
    const night = cal.parse('night 3', { reference: REF });
    assert.equal(night.partOfDay, 'night');
    assert.equal(night.month, HAYWANE);
});

test('format: the documented shape, and round-trips', () => {
    const abs = cal.toAbs({ year: 611, month: GOLDWANE, day: 13, minutes: 5 * 60 + 50 });
    assert.equal(cal.format(abs), 'CY 611, Goldwane 13, 05:50 am');
    assert.equal(cal.format(abs, { time: false }), 'CY 611, Goldwane 13');
    assert.equal(cal.format(abs, { era: false }), 'Goldwane 13, 05:50 am');
    assert.equal(cal.format(abs, { era: false, time: false }), 'Goldwane 13');
    assert.equal(cal.format(at(HAYWANE, 1, 0)), 'CY 611, Haywane 1, 12:00 am');
    assert.equal(cal.format(at(HAYWANE, 1, 12 * 60 + 5)), 'CY 611, Haywane 1, 12:05 pm');
    assert.equal(cal.format(at(HAYWANE, 1, 23 * 60 + 59)), 'CY 611, Haywane 1, 11:59 pm');

    const day = Math.floor(abs / 1440) * 1440;
    for (const value of [abs, REF, at(YEARSEND, 30, 1439), at(0, 1, 0, 612)]) {
        const start = Math.floor(value / 1440) * 1440;
        assert.equal(cal.parse(cal.format(value)).abs, value);
        assert.equal(cal.parse(cal.format(value, { era: false }), { reference: value }).abs, value);
        assert.equal(cal.parse(cal.format(value, { time: false })).abs, start);
        assert.equal(cal.parse(cal.format(value, { time: false, era: false }), { reference: value }).abs, start);
    }
    assert.equal(cal.parse(cal.format(abs, { time: false })).abs, day);

    // No era configured: the year goes last.
    const leap = greg.toAbs({ year: 2024, month: 1, day: 29, minutes: 17 * 60 });
    assert.equal(greg.format(leap), 'February 29, 2024, 05:00 pm');
    assert.equal(greg.parse(greg.format(leap)).abs, leap);

    // Numbered preset months survive a round trip too.
    const plain = makeCalendar(PRESETS.custom30);
    const m12 = plain.toAbs({ year: 3, month: 11, day: 12, minutes: 61 });
    assert.equal(plain.format(m12), 'Month 12 12, 3, 01:01 am');
    assert.equal(plain.parse(plain.format(m12, { era: false }), { reference: m12 }).abs, m12);
});

test('addDays and daysBetween', () => {
    assert.equal(cal.addDays(REF, 0.5), REF + 720);
    assert.equal(cal.addDays(REF, -2), REF - 2880);
    assert.equal(cal.daysBetween(REF, cal.addDays(REF, 3)), 3);
    assert.equal(cal.daysBetween(at(GOLDWANE, 13), at(HAYWANE, 13)), 30);
    assert.equal(cal.daysBetween(REF, REF + 720), 0.5);
    assert.equal(cal.dayIndex(REF), Math.floor(REF / 1440));
    assert.equal(cal.dayIndex(-1), -1);
});

test('normalizeCalendar: bare month names plus daysPerMonth', () => {
    const c = normalizeCalendar({ era: 'CY', months: MONTHS, daysPerMonth: 30 });
    assert.equal(c.preset, 'custom');
    assert.equal(c.era, 'CY');
    assert.deepEqual(c.months, MONTHS.map(name => ({ name, days: 30 })));
    assert.equal(c.daysPerMonth, 30);
    assert.equal(c.leapYears, false);
    assert.deepEqual(c.partsOfDay, DEFAULT_PARTS_OF_DAY);

    // Settings textarea lines and objects; days default to daysPerMonth.
    const mixed = normalizeCalendar({ months: ['Thaw | 20', { name: 'Bloom' }, '  ', { name: 'Ash', days: 40 }], daysPerMonth: 25 });
    assert.deepEqual(mixed.months, [{ name: 'Thaw', days: 20 }, { name: 'Bloom', days: 25 }, { name: 'Ash', days: 40 }]);
});

test('normalizeCalendar: a world pack calendar object', () => {
    const c = normalizeCalendar({ era: 'CY', days_per_month: 30, months: MONTHS });
    assert.equal(c.preset, 'custom');
    assert.equal(c.daysPerMonth, 30);
    assert.equal(c.months.length, 12);
    assert.equal(c.months[HAYWANE].name, 'Haywane');

    const fromPack = makeCalendar({ era: 'CY', days_per_month: 30, months: MONTHS });
    assert.equal(fromPack.format(REF), 'CY 611, Haywane 12, 05:35 pm');
});

test('normalizeCalendar: presets, fallbacks and parts of day', () => {
    assert.deepEqual(normalizeCalendar('gregorian'), normalizeCalendar(PRESETS.gregorian));
    assert.equal(normalizeCalendar({ preset: 'gregorian', era: 'AD' }).era, 'AD');
    assert.equal(normalizeCalendar(null).months.length, 12);
    assert.equal(normalizeCalendar({ months: [] }).months[0].name, 'Month 1');

    const parts = normalizeCalendar({ partsOfDay: { Dusk: 1200, Vespers: '18:30', bad: 'x' } }).partsOfDay;
    assert.equal(parts.dusk, 1200);
    assert.equal(parts.vespers, 1110);
    assert.equal(parts.dawn, 360);
    assert.equal('bad' in parts, false);

    const vespers = makeCalendar({ months: MONTHS, partsOfDay: { vespers: '18:30' } });
    assert.equal(vespers.parse('Goldwane 2, vespers').minutes, 1110);

    // Inputs are not mutated and presets are frozen.
    const input = { months: ['A1x', 'B2y'] };
    normalizeCalendar(input);
    assert.deepEqual(input, { months: ['A1x', 'B2y'] });
    assert.ok(Object.isFrozen(PRESETS.gregorian.months[0]));
    assert.ok(Object.isFrozen(cal.config));
});

test('leap years can be switched on for a custom calendar', () => {
    const c = makeCalendar({ months: MONTHS, daysPerMonth: 30, leapYears: true });
    assert.equal(c.daysInYear(612), 361);
    assert.equal(c.daysInYear(611), 360);
    assert.equal(c.daysInMonth(612, 1), 31);
    assert.equal(c.parse('Rainmoot 31, 612').day, 31);
    assert.equal(c.parse('Rainmoot 31, 611'), null);
});

test('sharedCalendar: era and months as plain copies, for StoryDirector.calendar()', () => {
    const greg = sharedCalendar(PRESETS.gregorian);
    assert.deepEqual(Object.keys(greg), ['era', 'months']);
    assert.equal(greg.era, '');
    assert.equal(greg.months.length, 12);
    assert.deepEqual(greg.months[0], { name: 'January', days: 31 });
    assert.deepEqual(greg.months[1], { name: 'February', days: 28 });
    greg.months[0].name = 'Changed';
    greg.months.push({ name: 'Extra', days: 1 });
    assert.equal(PRESETS.gregorian.months[0].name, 'January', 'the preset is untouched');
    assert.equal(sharedCalendar(PRESETS.gregorian).months.length, 12);

    const settings = { preset: 'custom', era: ' CY ', months: [{ name: 'Dawnwane', days: 30 }, { name: 'Haywane', days: 31, extra: 'kept out' }], daysPerMonth: 30, partsOfDay: { dawn: '05:00' } };
    const shared = sharedCalendar(settings);
    assert.deepEqual(shared, { era: 'CY', months: [{ name: 'Dawnwane', days: 30 }, { name: 'Haywane', days: 31 }] });
    shared.months[1].days = 2;
    assert.equal(settings.months[1].days, 31, "the reader's settings are untouched");
    assert.ok(!Object.isFrozen(shared.months[0]), 'plain objects the caller may change');

    // A world pack's shape (bare names, days_per_month) reads the same.
    assert.deepEqual(sharedCalendar({ era: 'AR', days_per_month: 28, months: ['Solmonth', 'Lunmonth'] }),
        { era: 'AR', months: [{ name: 'Solmonth', days: 28 }, { name: 'Lunmonth', days: 28 }] });
});

test('the sun words are parts of day: "Goldwane 12 sunset" is at dusk, not the start of the day (0.9.11)', () => {
    const c = makeCalendar({ months: MONTHS });
    for (const [word, minutes] of [['sunset', 1140], ['sundown', 1140], ['sunrise', 360], ['daybreak', 360]]) {
        const parsed = c.parse(`Goldwane 12 ${word}`, { reference: c.toAbs({ year: 611, month: GOLDWANE, day: 1 }) });
        assert.ok(parsed?.hasTime, word);
        assert.equal(parsed.minutes, minutes, word);
        assert.equal(parsed.month, GOLDWANE);
    }
    // A month called Nightfall stays a month.
    assert.equal(c.parse('Nightfall 3').month, 7);
});

test('withClock: the calendar sets the clock time of a written date (0.9.12)', () => {
    const c = makeCalendar({ months: MONTHS, era: 'CY' });
    const reference = c.toAbs({ year: 611, month: GOLDWANE, day: 1 });
    assert.equal(c.withClock('Goldwane 12 sunset', { reference }), 'Goldwane 12, 07:00 pm');
    assert.equal(c.withClock('dawn on Goldwane 14, or the flock is lost', { reference }), 'Goldwane 14, 06:00 am, or the flock is lost');
    assert.equal(c.withClock('Goldwane 30', { reference }), 'Goldwane 30, 11:59 pm', 'a date alone runs to the end of its day');
    assert.equal(c.withClock('CY 612, Haywane 3 evening', { reference }), 'CY 612, Haywane 3, 07:00 pm', 'a written year is kept');
    assert.equal(c.withClock('Goldwane 12, 06:15 pm', { reference }), 'Goldwane 12, 06:15 pm', 'a clock time stays');
    assert.equal(c.withClock('before the frost', { reference }), 'before the frost');
    assert.equal(c.withClock('', { reference }), '');
});

test('weekdays (0.9.21): Gregorian has the real ones, a custom week runs from the day the reader names, none means none', () => {
    const gregorian = makeCalendar('gregorian');
    assert.equal(gregorian.weekday(gregorian.toAbs({ year: 2026, month: 9, day: 19 })), 'Monday');
    assert.equal(gregorian.weekday(gregorian.toAbs({ year: 2000, month: 0, day: 1, minutes: 600 })), 'Saturday');
    const plain = makeCalendar({ preset: 'custom', era: 'CY', months: ['Dawnwane', 'Goldwane'] });
    assert.deepEqual(plain.config.week, []);
    assert.equal(plain.weekday(plain.toAbs({ year: 611, month: 1, day: 12 })), '', 'no week, no weekday');
    assert.deepEqual(parseWeek('Moonday, Tideday\nThornday, moonday, , Ashday'), ['Moonday', 'Tideday', 'Thornday', 'Ashday']);
    const config = { preset: 'custom', era: 'CY', months: ['Dawnwane', 'Goldwane'], week: 'Moonday, Tideday, Thornday, Ashday' };
    const at = makeCalendar(config).toAbs({ year: 611, month: 1, day: 12, minutes: 735 });
    const offset = makeCalendar(config).weekOffsetFor(at, 'thornday');
    const week = makeCalendar({ ...config, weekOffset: offset });
    assert.equal(week.weekday(at), 'Thornday', 'today is the day named');
    assert.equal(week.weekday(week.addDays(at, 1)), 'Ashday');
    assert.equal(week.weekday(week.addDays(at, 2)), 'Moonday', 'and it wraps round');
    assert.equal(week.weekday(week.addDays(at, -2)), 'Moonday', 'backwards too');
    assert.equal(makeCalendar({ ...config, weekOffset: 4 + offset }).weekday(at), 'Thornday', 'the offset is taken round the week');
    assert.equal(makeCalendar(config).weekOffsetFor(at, 'Sunday'), 0, 'a name not in the week');
});
