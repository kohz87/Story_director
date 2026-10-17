// Tests for src/relevance.js: due, arriving, dormant and the priority order of classify.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, estimateTokens, dateOf, isDue, isArriving, isDormant, classify } from '../src/relevance.js';

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

function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        Object.values(value).forEach(deepFreeze);
    }
    return value;
}

const keys = list => list.map(item => (item.record ?? item).key);

test('estimateTokens is a quarter of the characters, rounded up', () => {
    assert.equal(estimateTokens(''), 0);
    assert.equal(estimateTokens('abcde'), 2);
});

test('dateOf parses a field against the reference, and is null when unset', () => {
    const r = record({ key: 'Geva', fields: { on: 'Haywane 12, 05:45 pm' } });
    assert.equal(dateOf(r, 'on', { calendar, reference: MID }).abs, at('Haywane 12, 05:45 pm'));
    assert.equal(dateOf(r, 'due', { calendar, reference: MID }), null);
});

test('without a time, due counts for the whole day', () => {
    const r = record({ key: 'Saartje', fields: { then: 'sells the house', on: 'Haywane 12' } });
    assert.equal(isDue(r, { calendar, now: at('Haywane 12') }), true);
    assert.equal(isDue(r, { calendar, now: at('Haywane 12, 11:30 pm') }), true);
    assert.equal(isDue(r, { calendar, now: at('Haywane 11, 11:59 pm') }), false);
    assert.equal(isDue(r, { calendar, now: at('Haywane 20') }), true);
});

test('with a time, due waits for that minute', () => {
    const r = record({ key: 'Geva', fields: { then: 'files the warrant', on: 'Haywane 12, 05:45 pm' } });
    assert.equal(isDue(r, { calendar, now: at('Haywane 12, 06:00 pm') }), true);
    assert.equal(isDue(r, { calendar, now: at('Haywane 12, 05:00 pm') }), false);
});

test('a clock is due by its due field', () => {
    const r = record({ key: 'Graves', kind: 'clock', fields: { desc: 'the dead rise', due: 'Goldwane 28' } });
    assert.equal(isDue(r, { calendar, now: at('Goldwane 28, noon') }), true);
    assert.equal(isDue(r, { calendar, now: at('Goldwane 27, night') }), false);
});

test('only active records are due', () => {
    const r = record({ key: 'Saartje', status: 'resolved', fields: { on: 'Haywane 12' } });
    assert.equal(isDue(r, { calendar, now: at('Haywane 13') }), false);
});

test('arriving: arrive at or before now', () => {
    const r = record({ key: 'Courier', fields: { leg: 'Shorn → Varnhold Watch 35 B', arrive: 'Haywane 13, morning' } });
    assert.equal(isArriving(r, { calendar, now: at('Haywane 13, 08:00 am') }), false);
    assert.equal(isArriving(r, { calendar, now: at('Haywane 13, 09:00 am') }), true);
    assert.equal(isArriving(r, { calendar, now: at('Haywane 14') }), true);
    assert.equal(isDue(r, { calendar, now: at('Haywane 14') }), false);
});

test('dormant after 15 replies unseen, even when recently seen in story time', () => {
    const now = at('Haywane 12');
    const r = record({ key: 'Thys', seen: { message: 10, time: now } });
    assert.equal(isDormant(r, { calendar, now, message: 24 }), false);
    assert.equal(isDormant(r, { calendar, now, message: 25 }), true);
});

test('dormant after 30 story days unseen, even when seen one reply ago', () => {
    const now = at('Haywane 12');
    const r = record({ key: 'Thys', seen: { message: 99, time: now - 30 * DAY } });
    assert.equal(isDormant(r, { calendar, now, message: 100 }), true);
    assert.equal(isDormant(r, { calendar, now: now - DAY, message: 100 }), false);
});

test('dormant thresholds follow the settings', () => {
    const now = at('Haywane 12');
    const r = record({ key: 'Thys', seen: { message: 10, time: now } });
    assert.equal(isDormant(r, { calendar, now, message: 13, settings: { dormantReplies: 3 } }), true);
    assert.equal(DEFAULTS.dormantReplies, 15);
});

test('a pinned record is never dormant', () => {
    const now = at('Haywane 12');
    const r = record({ key: 'Thys', pinned: true, seen: { message: 0, time: now - 90 * DAY } });
    assert.equal(isDormant(r, { calendar, now, message: 100 }), false);
});

test('something due within dueSoonDays is never dormant', () => {
    const now = at('Haywane 12, 10:00 am');
    const quiet = { message: 0, time: now - 90 * DAY };
    const soon = record({ key: 'Council', fields: { on: 'Haywane 15' }, seen: quiet });
    const later = record({ key: 'Council', fields: { on: 'Haywane 16' }, seen: quiet });
    const arriving = record({ key: 'Brant', fields: { arrive: 'Haywane 14, dusk' }, seen: quiet });
    const overdue = record({ key: 'Graves', kind: 'clock', fields: { due: 'Haywane 1' }, seen: quiet });
    const options = { calendar, now, message: 100 };
    assert.equal(isDormant(soon, options), false);
    assert.equal(isDormant(arriving, options), false);
    assert.equal(isDormant(overdue, options), false);
    assert.equal(isDormant(later, options), true);
});

test('classify: due and arriving records, not repeated in relevant', () => {
    const now = at('Haywane 13, 10:00 am');
    const due = record({ key: 'Saartje', fields: { on: 'Haywane 13' } });
    const arriving = record({ key: 'Courier', fields: { arrive: 'Haywane 13, morning' } });
    const later = record({ key: 'Geva', fields: { on: 'Haywane 20' } });
    const selection = classify(tracker([due, arriving, later], 5), { calendar, now, message: 5 });
    assert.deepEqual(keys(selection.due), ['Saartje']);
    assert.deepEqual(keys(selection.arriving), ['Courier']);
    assert.deepEqual(keys(selection.relevant), ['Geva']);
    assert.equal(selection.now, now);
});

test('classify: secrets go to secrets only', () => {
    const now = at('Haywane 13');
    const secret = record({
        key: 'Chiyo', kind: 'secret',
        fields: { desc: 'owes the guild', on: 'Haywane 1', place: 'Auvoth' },
        seen: { message: 0, time: now - 90 * DAY },
    });
    const selection = classify(tracker([secret], 50), {
        calendar, now, message: 50, place: 'Auvoth', sceneText: 'Chiyo waits.',
    });
    assert.deepEqual(keys(selection.secrets), ['Chiyo']);
    for (const list of ['due', 'arriving', 'relevant', 'dormant', 'resolvedRecently']) {
        assert.deepEqual(selection[list], [], list);
    }
});

test('classify: dormant records go to the shelf, but a mention wakes one', () => {
    const now = at('Haywane 13');
    const quiet = { message: 0, time: now - 90 * DAY };
    const thys = record({ key: 'Thys', fields: { now: 'at the gate' }, seen: quiet });
    const brant = record({ key: 'Wagon', fields: { people: 'Brant, Ilse' }, seen: quiet });
    const selection = classify(tracker([thys, brant], 50), {
        calendar, now, message: 50, recentText: 'Ilse looks up.',
    });
    assert.deepEqual(keys(selection.dormant), ['Thys']);
    assert.deepEqual(selection.relevant.map(({ record: r, reason, priority }) => [r.key, reason, priority]), [['Wagon', 'mentioned', 4]]);
});

test('classify: resolved in the last 5 messages', () => {
    const resolvedAt = message => ({ message, time: null, reason: 'done' });
    const recent = record({ key: 'Thys', status: 'resolved', resolved: resolvedAt(6) });
    const old = record({ key: 'Ren', status: 'superseded', resolved: resolvedAt(5) });
    const selection = classify(tracker([recent, old], 10), { calendar, now: at('Haywane 13'), message: 10 });
    assert.deepEqual(keys(selection.resolvedRecently), ['Thys']);
    assert.deepEqual(selection.relevant, []);
    assert.deepEqual(selection.dormant, []);
});

test('classify: the priority order', () => {
    const now = at('Haywane 13, 10:00 am');
    const message = 40;
    const old = { message: 30, time: now - DAY };
    const records = [
        record({ key: 'Other', fields: { now: 'sleeps' }, seen: old, changed: old }),
        record({ key: 'Quiet clock', kind: 'clock', fields: { due: 'Haywane 29', shown: 'none' }, seen: old, changed: old }),
        record({ key: 'Recent', kind: 'event', fields: { now: 'curfew' }, seen: { message: 39, time: now }, changed: { message: 38, time: now } }),
        record({ key: 'Brant', fields: { people: 'Brant' }, seen: old, changed: old }),
        record({ key: 'Geva', fields: { now: 'District Bailiff Court, Auvoth' }, seen: old, changed: old }),
        record({ key: 'Courier', fields: { leg: 'Shorn → Auvoth 35 B' }, seen: old, changed: old }),
        record({ key: 'Council', kind: 'beat', fields: { on: 'Haywane 18' }, seen: old, changed: old }),
        record({ key: 'Graves', kind: 'clock', fields: { due: 'Haywane 28', shown: 'sign' }, seen: old, changed: old }),
    ];
    const selection = classify(tracker(records, message), {
        calendar, now, message, place: 'auvoth', sceneText: 'Brant drives the dray.',
    });
    assert.deepEqual(selection.relevant.map(entry => [entry.record.key, entry.priority]), [
        ['Graves', 1],
        ['Council', 2],
        ['Geva', 3],
        ['Courier', 3],
        ['Brant', 4],
        ['Recent', 5],
        ['Other', 6],
        ['Quiet clock', 6],
    ]);
});

test('classify: place matches either way, and through the place field', () => {
    const now = at('Haywane 13');
    const r = record({ key: 'Fires', kind: 'event', fields: { place: 'Auvoth' } });
    const selection = classify(tracker([r], 0), { calendar, now, message: 0, place: 'Canal Street, Auvoth' });
    assert.equal(selection.relevant[0].reason, 'place');
});

test('classify does not mutate its input', () => {
    const now = at('Haywane 13');
    const input = tracker([
        record({ key: 'Saartje', fields: { on: 'Haywane 13' } }),
        record({ key: 'Thys', seen: { message: 0, time: now - 90 * DAY } }),
        record({ key: 'Chiyo', kind: 'secret' }),
        record({ key: 'Graves', kind: 'clock', fields: { due: 'Haywane 28', shown: 'warning' } }),
    ], 30);
    const copy = structuredClone(input);
    deepFreeze(input);
    classify(input, { calendar, now, message: 30, place: 'Auvoth', sceneText: 'Thys' });
    assert.deepEqual(input, copy);
});

test('the current arc is shown on its own, and only its beats take priority 2', () => {
    const arcOld = record({ key: 'Old Arc', kind: 'arc', status: 'superseded', arc: 'arc-1' });
    const arcNow = record({ key: 'The Weir Bullion', kind: 'arc', arc: 'arc-2', created: { message: 5, time: null } });
    const ownBeat = record({ key: 'Council vote', kind: 'beat', arc: 'arc-2' });
    const oldBeat = record({ key: 'Old beat', kind: 'beat', arc: 'arc-1', seen: { message: 1, time: null }, changed: { message: 1, time: null } });
    const tracker = { version: 1, records: [arcOld, arcNow, ownBeat, oldBeat], message: 10, time: null };
    const selection = classify(tracker, { calendar, now: null, message: 10, settings: { dormantReplies: 1000, dormantDays: 1000, dueSoonDays: 0, budgetTokens: 1000 } });
    assert.equal(selection.arc.key, 'The Weir Bullion');
    assert.ok(!selection.relevant.some(entry => entry.record.kind === 'arc'), 'arcs are not listed as records');
    assert.equal(selection.relevant.find(entry => entry.record.key === 'Council vote').priority, 2);
    assert.notEqual(selection.relevant.find(entry => entry.record.key === 'Old beat')?.priority, 2);
});
