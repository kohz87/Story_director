// Tests for src/note.js: the note's format, its budget and the change-line instruction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHANGE_INSTRUCTION, buildNote } from '../src/note.js';
import { estimateTokens } from '../src/relevance.js';

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

function selection({ now = at('Goldwane 16, 09:00 am'), place = 'Auvoth', due = [], arriving = [], relevant = [], secrets = [] } = {}) {
    return {
        now,
        place,
        due,
        arriving,
        relevant: relevant.map((r, index) => ({ record: r, reason: 'active', priority: index + 1 })),
        dormant: [],
        secrets,
        resolvedRecently: [],
    };
}

const lines = note => note.split('\n');

const geva = record({ key: 'Geva', fields: { now: 'Bailiff Court', then: 'files the warrant', on: 'Goldwane 17' } });
const brant = record({ key: 'Brant', fields: { now: 'on the frontier road with a dray', leg: 'Shorn → Auvoth 120 B, wagon 30/day → 4', arrive: 'Goldwane 19' } });
const fires = record({ key: 'Canal Street fires', kind: 'event', fields: { now: 'curfew in force' } });
const stranger = record({ key: 'River stranger', kind: 'hook', fields: { desc: 'who pulled Ren from the sump' } });
const graves = record({ key: "Hollin's Reach graves", kind: 'clock', fields: { desc: 'the dead rise', due: 'Goldwane 28', shown: 'sign' } });
const council = record({ key: 'Council session opens', kind: 'beat', fields: { on: 'Goldwane 18, 09:00 am' } });
const sale = record({ key: "Saartje's sale", fields: { on: 'Goldwane 16' } });
const courier = record({ key: 'Courier', fields: { leg: 'Shorn → Varnhold Watch 35 B, courier 70/day → 0.5', arrive: 'Goldwane 16, morning' } });
const weir = record({ key: 'who sold the weir route', kind: 'secret', fields: { desc: 'Brant sold it to the guild' } });
const debt = record({ key: "Chiyo's debt", kind: 'secret' });

test('the header carries the formatted time and the place', () => {
    const note = buildNote(selection({ relevant: [fires] }), { calendar });
    assert.equal(lines(note)[0], '[Story Director · CY 611, Goldwane 16, 09:00 am · Auvoth]');
});

test('Due now and Arriving lines', () => {
    const note = buildNote(selection({ due: [sale, geva], arriving: [courier] }), { calendar });
    assert.deepEqual(lines(note).slice(1, 3), [
        "Due now: Saartje's sale (Goldwane 16) · Geva — files the warrant (Goldwane 17)",
        'Arriving: Courier arrives Varnhold Watch (Goldwane 16, morning)',
    ]);
});

test('one line per kind, in the contract order', () => {
    const thys = record({ key: 'Thys', fields: { now: 'at the gate' } });
    const note = buildNote(selection({ relevant: [council, graves, geva, stranger, fires, brant, thys] }), { calendar });
    assert.deepEqual(lines(note).slice(1, -CHANGE_INSTRUCTION.split('\n').length), [
        'Off-screen: Geva — Bailiff Court → files the warrant (Goldwane 17) · Brant — on the frontier road with a dray → arrives Auvoth (Goldwane 19) · Thys — at the gate',
        'World: Canal Street fires — curfew in force',
        'Hooks: River stranger — who pulled Ren from the sump',
        "Clocks: Hollin's Reach graves — the dead rise (Goldwane 28) · shown: sign",
        'Beats: Council session opens (Goldwane 18, 09:00 am)',
    ]);
});

test('Do not reveal lists secret keys only', () => {
    const note = buildNote(selection({ secrets: [weir, debt] }), { calendar });
    assert.ok(lines(note).includes("Do not reveal: who sold the weir route; Chiyo's debt"));
    assert.ok(!note.includes('Brant sold it'));
});

test('corrections get their own line', () => {
    const note = buildNote(selection({ relevant: [courier] }), {
        calendar,
        corrections: ['Courier — leg is Shorn → Varnhold Watch 35 km B, arrive Goldwane 16, morning'],
    });
    assert.ok(lines(note).includes('Corrections: Courier — leg is Shorn → Varnhold Watch 35 km B, arrive Goldwane 16, morning'));
});

test('the instruction comes last', () => {
    const note = buildNote(selection({ relevant: [fires] }), { calendar });
    assert.ok(note.endsWith(`\n${CHANGE_INSTRUCTION}`));
    const custom = buildNote(selection({ relevant: [fires] }), { calendar, instruction: 'Write <Director>.' });
    assert.ok(custom.endsWith('\nWrite <Director>.'));
});

test('the budget drops the lowest-priority relevant records first', () => {
    const relevant = [graves, council, geva, fires, stranger];
    const full = buildNote(selection({ relevant }), { calendar });
    const withoutLast = buildNote(selection({ relevant: relevant.slice(0, -1) }), { calendar });
    const note = buildNote(selection({ relevant }), { calendar, budgetTokens: estimateTokens(withoutLast) });
    assert.ok(estimateTokens(full) > estimateTokens(withoutLast));
    assert.equal(note, withoutLast);
    assert.ok(!note.includes('River stranger'));
    assert.ok(note.includes("Hollin's Reach graves"));
});

test('a tiny budget keeps the header, due lines, Do not reveal and the instruction', () => {
    const note = buildNote(selection({ due: [sale], arriving: [courier], relevant: [graves, geva, fires], secrets: [debt] }), {
        calendar,
        budgetTokens: 5,
    });
    assert.deepEqual(lines(note), [
        '[Story Director · CY 611, Goldwane 16, 09:00 am · Auvoth]',
        "Due now: Saartje's sale (Goldwane 16)",
        'Arriving: Courier arrives Varnhold Watch (Goldwane 16, morning)',
        "Do not reveal: Chiyo's debt",
        ...CHANGE_INSTRUCTION.split('\n'),
    ]);
});

test('no records gives the instruction alone', () => {
    assert.equal(buildNote(selection(), { calendar }), CHANGE_INSTRUCTION);
    assert.equal(buildNote(selection(), { calendar, instruction: 'Only this.' }), 'Only this.');
});

test('CHANGE_INSTRUCTION: about 120 tokens, the four ops, kinds, fields and the rules', () => {
    const tokens = estimateTokens(CHANGE_INSTRUCTION);
    assert.ok(tokens >= 100 && tokens <= 140, `${tokens} tokens`);
    assert.match(CHANGE_INSTRUCTION, /<Director>/);
    assert.match(CHANGE_INSTRUCTION, /^\+ kind Key — part \| label: value/m);
    assert.match(CHANGE_INSTRUCTION, /^~ Key — label: value/m);
    assert.match(CHANGE_INSTRUCTION, /^- Key — reason/m);
    assert.match(CHANGE_INSTRUCTION, /^! Key — what happened/m);
    for (const kind of ['agenda', 'event', 'hook', 'clock', 'beat', 'secret']) assert.ok(CHANGE_INSTRUCTION.includes(kind), kind);
    assert.match(CHANGE_INSTRUCTION, /now, then, on, due, leg, arrive, shown/);
    assert.match(CHANGE_INSTRUCTION, /Dates go only in on, due and arrive/);
    assert.match(CHANGE_INSTRUCTION, /never the whole list/);
    assert.ok(CHANGE_INSTRUCTION.includes('Never write actions for {{user}}'));
});
