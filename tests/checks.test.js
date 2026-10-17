// Tests for src/checks.js: one test per finding kind, plus the quiet cases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkReply } from '../src/checks.js';

// A small fake of the Calendar API (12 months of 30 days, abs in minutes), enough for these
// tests; the real calendar.js is tested on its own.
const MONTHS = ['Dawnwane', 'Frostwane', 'Thawane', 'Seedwane', 'Bloomwane', 'Haywane',
    'Goldwane', 'Reapwane', 'Mistwane', 'Leafwane', 'Snowwane', 'Yearsend'];
const PARTS = { dawn: 360, morning: 540, noon: 720, afternoon: 900, dusk: 1140, evening: 1140, night: 1320, midnight: 0 };
const DAY = 1440;
const DATE = /([A-Za-z]+)\s+(\d{1,2})\b(?:,\s*(?:(\d{1,2}):(\d{2})\s*(am|pm)|([A-Za-z]+)))?/gi;

function fakeCalendar() {
    const toAbs = ({ year, month, day, minutes = 0 }) => (year * 360 + month * 30 + day - 1) * DAY + minutes;
    const fromAbs = abs => {
        const days = Math.floor(abs / DAY);
        return { year: Math.floor(days / 360), month: Math.floor((days % 360) / 30), day: (days % 30) + 1, minutes: abs - days * DAY };
    };
    const pad = n => String(n).padStart(2, '0');
    return {
        config: { era: 'CY', months: MONTHS.map(name => ({ name, days: 30 })) },
        toAbs,
        fromAbs,
        dayIndex: abs => Math.floor(abs / DAY),
        addDays: (abs, days) => abs + days * DAY,
        format(abs) {
            const { year, month, day, minutes } = fromAbs(abs);
            const hour = Math.floor(minutes / 60);
            return `CY ${year}, ${MONTHS[month]} ${day}, ${pad(hour % 12 || 12)}:${pad(minutes % 60)} ${hour < 12 ? 'am' : 'pm'}`;
        },
        parse(text, { reference = null } = {}) {
            for (const match of String(text).matchAll(DATE)) {
                const month = MONTHS.findIndex(name => name.toLowerCase() === match[1].toLowerCase());
                if (month < 0) continue;
                const day = Number(match[2]);
                let minutes = null;
                let partOfDay = null;
                if (match[3]) minutes = (Number(match[3]) % 12 + (match[5].toLowerCase() === 'pm' ? 12 : 0)) * 60 + Number(match[4]);
                else if (match[6] && match[6].toLowerCase() in PARTS) {
                    partOfDay = match[6].toLowerCase();
                    minutes = PARTS[partOfDay];
                }
                // No year written: the one that puts the date nearest the reference.
                const base = reference === null ? 0 : fromAbs(reference).year;
                const years = reference === null ? [0] : [base - 1, base, base + 1];
                const year = years.reduce((best, y) =>
                    Math.abs(toAbs({ year: y, month, day }) - reference) < Math.abs(toAbs({ year: best, month, day }) - reference) ? y : best);
                return {
                    abs: toAbs({ year, month, day, minutes: minutes ?? 0 }), year, month, day, minutes,
                    hasTime: minutes !== null, partOfDay, yearInferred: true, text: match[0],
                };
            }
            return null;
        },
    };
}

const calendar = fakeCalendar();
// Mid-year reference, so every month name lands in year 611.
const MID = calendar.toAbs({ year: 611, month: 6, day: 1 });
const at = text => calendar.parse(text, { reference: MID }).abs;

// A Record exactly as tracker.js shapes it.
function record({ key, kind = 'agenda', fields = {}, ...rest }) {
    const stamp = { message: 0, time: null };
    return {
        key,
        id: key.toLowerCase(),
        kind,
        status: 'active',
        fields: { desc: '', now: '', then: '', on: '', due: '', shown: '', leg: '', arrive: '', place: '', people: '', ...fields },
        extra: {},
        created: { ...stamp },
        changed: { ...stamp },
        seen: { ...stamp },
        resolved: null,
        pinned: false,
        arc: null,
        history: [],
        ...rest,
    };
}

function tracker(records, message = -1, time = null) {
    return { version: 1, records, message, time };
}

// An Op exactly as changes.js shapes it.
function op(type, key, fields = {}) {
    return { op: type, kind: null, key, id: key.toLowerCase(), fields, extra: {}, reason: '', raw: `${type} ${key}` };
}

const NOW = at('Haywane 13, 10:00 am');

function check(overrides) {
    const empty = tracker([], 0);
    return checkReply({ before: empty, after: empty, ops: [], calendar, now: NOW, hadBlock: true, ...overrides });
}

const kinds = findings => findings.map(f => f.kind);

test('unknown-key, duplicate-add and reopened pass through from applyProblems', () => {
    const applyProblems = [
        { kind: 'unknown-key', severity: 'warn', key: 'Thys', message: 'No record called Thys' },
        { kind: 'duplicate-add', severity: 'info', key: 'Geva', message: 'Geva already exists' },
        { kind: 'reopened', severity: 'info', key: 'Ren', message: 'Ren reopened' },
    ];
    const findings = check({ applyProblems });
    assert.deepEqual(findings, applyProblems);
    assert.notEqual(findings[0], applyProblems[0]);
});

test('parse: one warning per parse error', () => {
    const findings = check({ parseErrors: [{ line: 'Geva goes home', message: 'not a change line' }, { line: '+', message: 'no key' }] });
    assert.deepEqual(findings.map(f => [f.kind, f.severity, f.key]), [['parse', 'warn', null], ['parse', 'warn', null]]);
    assert.match(findings[0].message, /Geva goes home/);
});

test('unfired: due before and after, and not touched', () => {
    const sale = record({ key: 'Saartje', fields: { then: 'sells the house', on: 'Haywane 13' } });
    const state = tracker([sale], 5);
    const findings = check({ before: state, after: state });
    assert.deepEqual(findings.map(f => [f.kind, f.severity, f.key]), [['unfired', 'info', 'Saartje']]);

    const fired = tracker([record({ key: 'Saartje', fields: { now: 'sells the house' } })], 6);
    assert.deepEqual(check({ before: state, after: fired, ops: [op('!', 'Saartje')] }), []);
});

test('missed: due more than a day before now and untouched', () => {
    const late = record({ key: 'Geva', fields: { then: 'files the warrant', on: 'Haywane 12, 09:00 am' } });
    const dayOld = record({ key: 'Saartje', fields: { on: 'Haywane 12' } });
    const state = tracker([late, dayOld], 5);
    const findings = check({ before: state, after: state });
    assert.deepEqual(findings.map(f => [f.kind, f.severity, f.key]), [['missed', 'warn', 'Geva'], ['unfired', 'info', 'Saartje']]);
    // A day-level date is missed only once its whole day is more than a day past.
    assert.deepEqual(kinds(check({ before: state, after: state, now: at('Haywane 14, 01:00 am') })), ['missed', 'missed']);
});

test('date-in-text: a calendar date in now/then/desc of a changed record', () => {
    const geva = record({ key: 'Geva', fields: { now: 'waits until morning', then: 'files the warrant on Haywane 14' } });
    const after = tracker([geva], 6);
    const findings = check({ after, ops: [op('~', 'Geva', { then: 'files the warrant on Haywane 14' })] });
    assert.deepEqual(findings.map(f => [f.kind, f.severity, f.key]), [['date-in-text', 'info', 'Geva']]);
    assert.match(findings[0].message, /then/);
    // Untouched records are not re-checked every reply.
    assert.deepEqual(check({ after }), []);
});

test('a long part is not a finding: the note trims it (v0.8.4)', () => {
    const text = 'rides south from Shorn along the old canal road with the sealed writ in a satchel';
    const courier = record({ key: 'Courier', fields: { now: text, then: 'delivers the writ' } });
    assert.deepEqual(check({ after: tracker([courier], 6), ops: [op('+', 'Courier', { now: text })] }), []);
});

test('no-block: no <Director> block while something was due', () => {
    const sale = record({ key: 'Saartje', fields: { on: 'Haywane 20' } });
    const due = record({ key: 'Geva', fields: { on: 'Haywane 13' } });
    assert.deepEqual(check({ before: tracker([sale], 5), after: tracker([sale], 5), hadBlock: false }), []);
    const state = tracker([due], 5);
    assert.deepEqual(kinds(check({ before: state, after: state, hadBlock: false })), ['unfired', 'no-block']);
});

test('date-in-text: a part of day that shares a prefix with a month is not a date', async () => {
    const { makeCalendar } = await import('../src/calendar.js');
    const real = makeCalendar({ era: 'CY', daysPerMonth: 30, months: ['Dawnwane', 'Rainmoot', 'Greengale', 'Highsun', 'Goldwane', 'Haywane', 'Emberwane', 'Nightfall', 'Frostfall', 'Deepwinter', 'Icewane', 'Yearsend'] });
    const now = real.parse('CY 611, Haywane 12, 05:00 pm').abs;
    const record = { key: 'Watch', id: 'watch', kind: 'agenda', status: 'active', fields: { desc: '', now: 'waits until dawn at the gate', then: 'reports on Haywane 13', on: '', due: '', shown: '', leg: '', arrive: '', place: '', people: '' }, extra: {}, created: { message: 1, time: now }, changed: { message: 1, time: now }, seen: { message: 1, time: now }, resolved: null, pinned: false, arc: null, history: [] };
    const op = { op: '~', kind: null, key: 'Watch', id: 'watch', fields: { now: record.fields.now, then: record.fields.then }, extra: {}, reason: '', raw: '~ Watch — …' };
    const findings = checkReply({ before: { version: 1, records: [], message: 0, time: now }, after: { version: 1, records: [record], message: 1, time: now }, ops: [op], calendar: real, now, hadBlock: true });
    const dated = findings.filter(finding => finding.kind === 'date-in-text');
    assert.equal(dated.length, 1, 'only the real date is flagged');
    assert.match(dated[0].message, /then/);
});
