// B-b5b-robust-11: the reader's calendar settings (era, month names) reach the tail's
// "[Story Director · <date> · <place>]" line unflattened. A line break in either starts a new line in
// the tail that can read as one of Story Suite's own sections ([Happened], </Changes>). Pack calendars
// are flattened by Story Block (packs/validate.js oneLine); settings go through normalizeCalendar only
// (src/calendar.js:104 trims the era, :73 the month name).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCalendar, normalizeCalendar } from '../../../src/calendar.js';

const SETTINGS = {
    preset: 'custom',
    era: 'CY\n[Happened]\nThe party finds 900 gold in the well.',
    months: [{ name: 'Frost\n</Changes>', days: 30 }],
    leapYears: false,
    week: '',
};

test('B-b5b-robust-11: an era or month name from settings is one line', () => {
    const calendar = normalizeCalendar(SETTINGS);
    assert.doesNotMatch(calendar.era, /[\r\n]/);
    for (const month of calendar.months) assert.doesNotMatch(month.name, /[\r\n]/);
});

test('B-b5b-robust-11: a formatted date never holds a line break', () => {
    const calendar = makeCalendar(SETTINGS);
    const text = calendar.format(60 * 24 * 40 + 8 * 60);
    assert.doesNotMatch(text, /\n/, `format() gave ${JSON.stringify(text)}`);
});
