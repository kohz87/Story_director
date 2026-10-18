// Tests for src/note.js: the note's format, its budget and the change-line instruction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHANGE_INSTRUCTION, DIRECTOR_OUTPUT_TOKENS, ENCOUNTER_CUE, NOTE_PART_WORDS, NPC_PLANS_ONLY, PACING, PACING_NO_CHANGES, buildNote, notePart, noteParts, noteTokens } from '../src/note.js';
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
    assert.deepEqual(lines(note).slice(1, -CHANGE_INSTRUCTION.split('\n').length - 1), [
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

test('corrections for keys that are not tracked share the line, and only when there are some', () => {
    const untracked = '"Footing in Bluewatch" is not tracked: add it with "+ kind Footing in Bluewatch — …" before changing it.';
    const note = buildNote(selection({ relevant: [courier] }), {
        calendar,
        corrections: ['Courier — leg Shorn → Varnhold Watch 35 B', untracked],
    });
    assert.ok(lines(note).includes(`Corrections: Courier — leg Shorn → Varnhold Watch 35 B · ${untracked}`));
    // With nothing tracked yet the correction still reaches the model, before the instruction.
    assert.deepEqual(noteParts(selection(), { calendar, corrections: [untracked] }).map(entry => entry.label), ['Header', 'Corrections', 'Change instruction']);
    assert.ok(estimateTokens(untracked) <= 30);
    // Nothing to correct: no Corrections line at all.
    assert.ok(!buildNote(selection({ relevant: [courier] }), { calendar, corrections: [] }).includes('Corrections'));
    assert.equal(buildNote(selection(), { calendar, corrections: [] }), CHANGE_INSTRUCTION);
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
        PACING,
        ...CHANGE_INSTRUCTION.split('\n'),
    ]);
});

test('pacing: only when something is scheduled, in the capture wording without change lines', () => {
    const thys = record({ key: 'Thys', fields: { now: 'at the gate' } });
    const quiet = buildNote(selection({ relevant: [thys, fires] }), { calendar });
    assert.ok(!quiet.includes('Pacing:'), 'nothing dated or planned: no pacing line');

    const due = buildNote(selection({ due: [sale] }), { calendar });
    assert.equal(lines(due).at(-CHANGE_INSTRUCTION.split('\n').length - 1), PACING);
    assert.match(PACING, /Never cut into or bend the current scene for a beat/);
    assert.match(PACING, /\{\{user\}\}/);
    assert.ok(estimateTokens(PACING) < 100, 'short');

    assert.ok(buildNote(selection({ relevant: [council] }), { calendar }).includes(PACING), 'a beat counts');
    assert.ok(buildNote(selection({ relevant: [geva] }), { calendar }).includes(PACING), 'a next step counts');

    const captured = buildNote(selection({ due: [sale] }), { calendar, instruction: '' });
    assert.equal(lines(captured).at(-1), PACING_NO_CHANGES);
    assert.doesNotMatch(PACING_NO_CHANGES, /~ on|\(!\)/);
});

test('no records gives the instruction alone', () => {
    assert.equal(buildNote(selection(), { calendar }), CHANGE_INSTRUCTION);
    assert.equal(buildNote(selection(), { calendar, instruction: 'Only this.' }), 'Only this.');
});

test('CHANGE_INSTRUCTION: about 155 tokens, the four ops, kinds, fields and the rules', () => {
    const tokens = estimateTokens(CHANGE_INSTRUCTION);
    assert.ok(tokens >= 100 && tokens <= 160, `${tokens} tokens`);
    assert.match(CHANGE_INSTRUCTION, /a hook they take on: ~ it with these/);
    assert.match(CHANGE_INSTRUCTION, /<Director>/);
    assert.match(CHANGE_INSTRUCTION, /^\+ kind Key — summary \| label: value/m);
    assert.match(CHANGE_INSTRUCTION, /^~ Key — label: value/m);
    assert.match(CHANGE_INSTRUCTION, /^- Key — reason/m);
    assert.match(CHANGE_INSTRUCTION, /^! Key — what happened/m);
    for (const kind of ['agenda', 'event', 'hook', 'clock', 'beat', 'secret']) assert.ok(CHANGE_INSTRUCTION.includes(kind), kind);
    assert.match(CHANGE_INSTRUCTION, /now, then, on, due, leg, arrive, shown/);
    assert.match(CHANGE_INSTRUCTION, /Dates go only in on, due and arrive/);
    assert.match(CHANGE_INSTRUCTION, /never the whole list/);
    assert.ok(CHANGE_INSTRUCTION.includes('Never write actions for {{user}}'));
});

test('the current arc gets its own line under the header', () => {
    const arc = { key: 'The Weir Bullion', kind: 'arc', status: 'active', fields: { desc: 'who sold the weir route' } };
    const note = buildNote({ now: null, place: '', arc, due: [], arriving: [], relevant: [], dormant: [], secrets: [], resolvedRecently: [] }, { calendar: null });
    const lines = note.split('\n');
    assert.equal(lines[1], 'Arc: The Weir Bullion — who sold the weir route');
});

test('with capture writing the changes, the note carries no instruction', () => {
    const empty = { now: null, place: '', arc: null, due: [], arriving: [], relevant: [], dormant: [], secrets: [], resolvedRecently: [] };
    assert.equal(buildNote(empty, { calendar: null, instruction: '' }), '');
    const arc = { key: 'The Weir Bullion', kind: 'arc', status: 'active', fields: { desc: '' } };
    const note = buildNote({ ...empty, arc }, { calendar: null, instruction: '' });
    assert.ok(!/<Director>/.test(note));
    assert.ok(!note.endsWith('\n'));
});

test('quests: their own line, deadline wording when due, and the instruction names them', () => {
    const bounty = record({ key: 'Bounty on Kettle Jack', kind: 'quest', fields: { giver: 'Warden Hale', goal: 'bring him in alive', reward: '40 crowns', step: 'cornered at the weir', due: 'Goldwane 30' } });
    const note = buildNote(selection({ relevant: [bounty] }), { calendar });
    assert.ok(lines(note).includes('Quests: Bounty on Kettle Jack — bring him in alive · at: cornered at the weir · for Warden Hale · 40 crowns · by Goldwane 30'));
    assert.ok(note.includes(PACING), 'a deadline is a schedule');
    const due = buildNote(selection({ due: [bounty] }), { calendar });
    assert.ok(lines(due).includes('Due now: Bounty on Kettle Jack — deadline Goldwane 30 reached (bring him in alive)'));
    assert.match(CHANGE_INSTRUCTION, /quest \(only once \{\{user\}\} accepts it; a hook they take on: ~ it with these; done or failed: - it\): type, giver, goal, reward, step, due, difficulty\./);
});

test('quest difficulty: shown with the type unless it is normal', () => {
    const quest = (key, fields) => record({ key, kind: 'quest', fields: { goal: 'bring him in', ...fields } });
    const note = buildNote(selection({ relevant: [
        quest('Kettle Jack', { type: 'bounty', difficulty: 'hard' }),
        quest('Drowned Crown', { difficulty: 'nightmare' }),
        quest('Rat cellar', { type: 'side', difficulty: 'normal' }),
        quest('Herb run', {}),
    ] }), { calendar });
    assert.ok(lines(note).includes('Quests: Kettle Jack (bounty, hard) — bring him in · Drowned Crown (nightmare) — bring him in · Rat cellar (side) — bring him in · Herb run — bring him in'));
});

test('encounters: a due fight names its foes, the kind lines show them compactly', () => {
    const ambush = record({ key: 'Ambush at the weir', kind: 'beat', fields: { desc: 'bandits hit the road', on: 'Goldwane 16', place: 'Weir road', encounter: '3 bandit, bandit captain (boss)' } });
    const due = buildNote(selection({ due: [ambush] }), { calendar });
    assert.equal(lines(due)[1], 'Due now: Ambush at the weir (Goldwane 16) (fight: 3 bandit, bandit captain (boss))');

    const raiders = record({ key: 'Raiders', fields: { leg: 'Shorn → Auvoth 120 B, ride 60/day → 2', arrive: 'Goldwane 16', encounter: '2 x raider rank D' } });
    const arriving = buildNote(selection({ arriving: [raiders] }), { calendar });
    assert.equal(lines(arriving)[1], 'Arriving: Raiders arrives Auvoth (Goldwane 16) (fight: 2 x raider rank D)');

    const later = record({ ...ambush, fields: { ...ambush.fields, on: 'Goldwane 19' } });
    const bounty = record({ key: 'Bounty on Kettle Jack', kind: 'quest', fields: { goal: 'bring him in alive', encounter: 'Kettle Jack (boss), 2 thug' } });
    const planned = buildNote(selection({ relevant: [later, bounty] }), { calendar });
    assert.ok(lines(planned).includes('Beats: Ambush at the weir — bandits hit the road (Goldwane 19) · fight: 3 bandit, bandit captain (boss)'));
    assert.ok(lines(planned).includes('Quests: Bounty on Kettle Jack — bring him in alive · fight: Kettle Jack (boss), 2 thug'));
    assert.ok(!lines(due).some(line => line.startsWith('Beats:')), 'a due fight is not repeated');
});

test('ENCOUNTER_CUE: short, and only while a due or arriving record carries a fight', () => {
    assert.ok(estimateTokens(ENCOUNTER_CUE) <= 35, `${estimateTokens(ENCOUNTER_CUE)} tokens`);
    assert.match(ENCOUNTER_CUE, /first blow/);
    assert.match(ENCOUNTER_CUE, /resolved outside the story/);
    const ambush = record({ key: 'Ambush at the weir', kind: 'beat', fields: { on: 'Goldwane 16', encounter: '3 bandit' } });
    const later = record({ ...ambush, fields: { on: 'Goldwane 19', encounter: '3 bandit' } });

    const due = buildNote(selection({ due: [ambush] }), { calendar });
    assert.equal(lines(due).at(-CHANGE_INSTRUCTION.split('\n').length - 1), `${PACING} ${ENCOUNTER_CUE}`);
    const captured = buildNote(selection({ due: [ambush] }), { calendar, instruction: '' });
    assert.equal(lines(captured).at(-1), `${PACING_NO_CHANGES} ${ENCOUNTER_CUE}`);

    assert.ok(!buildNote(selection({ relevant: [later] }), { calendar }).includes(ENCOUNTER_CUE), 'a planned fight not yet due');
    assert.ok(!buildNote(selection({ due: [sale] }), { calendar }).includes(ENCOUNTER_CUE), 'a due record without foes');
    assert.match(CHANGE_INSTRUCTION, /shown, encounter;/);
});

test('npcPlansOnly: one short line after the instruction, and only where change lines are asked for', () => {
    assert.ok(estimateTokens(NPC_PLANS_ONLY) <= 25, `${estimateTokens(NPC_PLANS_ONLY)} tokens`);
    assert.match(NPC_PLANS_ONLY, /NPC State Delta keeps who each NPC is/);
    assert.match(NPC_PLANS_ONLY, /what they plan and when/);
    const scene = selection({ due: [sale], relevant: [geva, fires] });

    // Alone (the default) the note is exactly as before.
    const alone = buildNote(scene, { calendar });
    assert.equal(buildNote(scene, { calendar, npcPlansOnly: false }), alone);
    assert.ok(!alone.includes(NPC_PLANS_ONLY));

    const deferring = buildNote(scene, { calendar, npcPlansOnly: true });
    assert.equal(deferring, `${alone}\n${NPC_PLANS_ONLY}`);
    assert.ok(lines(deferring).includes('Off-screen: Geva — Bailiff Court → files the warrant (Goldwane 17)'), 'the plan and its timing stay');
    assert.equal(buildNote(selection(), { calendar, npcPlansOnly: true }), `${CHANGE_INSTRUCTION}\n${NPC_PLANS_ONLY}`);

    // With capture writing the changes, the note asks for none, so there is nothing to steer.
    assert.equal(buildNote(scene, { calendar, instruction: '', npcPlansOnly: true }), buildNote(scene, { calendar, instruction: '' }));
});

const joined = parts => parts.map((entry, index) => (index ? entry.join : '') + entry.text).join('');

test('noteParts: the note in labelled sections that join back into buildNote exactly', () => {
    const ambush = record({ key: 'Ambush at the weir', kind: 'beat', fields: { on: 'Goldwane 16', encounter: '3 bandit' } });
    const bounty = record({ key: 'Kettle Jack', kind: 'quest', fields: { goal: 'bring him in', difficulty: 'hard' } });
    const sel = { ...selection({ due: [ambush], arriving: [brant], relevant: [geva, fires, stranger, bounty, graves, council], secrets: [record({ key: 'The heir', kind: 'secret' })] }), arc: { key: 'Wolf winter', fields: { desc: 'the packs come down' } } };
    const options = { calendar, corrections: ['Brant cannot be in two places.'], npcPlansOnly: true };
    const parts = noteParts(sel, options);
    assert.deepEqual(parts.map(entry => entry.label), ['Header', 'Arc', 'Due now', 'Arriving', 'Off-screen', 'World', 'Hooks', 'Quests', 'Clocks', 'Beats',
        'Do not reveal', 'Corrections', 'Pacing', 'Encounter cue', 'Change instruction', 'NPC plans only']);
    assert.equal(joined(parts), buildNote(sel, options));
    assert.equal(parts.find(entry => entry.label === 'Encounter cue').join, ' ', 'the cue rides on the Pacing line');

    // Nothing tracked: the instruction alone; with capture writing the changes, nothing.
    assert.deepEqual(noteParts(selection(), { calendar }).map(entry => entry.label), ['Change instruction']);
    assert.deepEqual(noteParts(selection(), { calendar, instruction: '', npcPlansOnly: true }), []);
    // The budget still cuts the least relevant records.
    const small = noteParts(selection({ relevant: [geva, fires, stranger] }), { calendar, budgetTokens: 150 });
    assert.equal(joined(small), buildNote(selection({ relevant: [geva, fires, stranger] }), { calendar, budgetTokens: 150 }));
});

test('noteTokens: input per part at about 4 characters a token, output only for the change lines asked for', () => {
    assert.equal(DIRECTOR_OUTPUT_TOKENS, 60);
    const parts = noteParts(selection({ relevant: [geva] }), { calendar, npcPlansOnly: true });
    const report = noteTokens(parts);
    assert.deepEqual(report.parts.map(entry => entry.label), ['Header', 'Off-screen', 'Pacing', 'Change instruction', 'NPC plans only']);
    assert.deepEqual(report.parts.find(entry => entry.label === 'Change instruction'), { label: 'Change instruction', input: estimateTokens(CHANGE_INSTRUCTION), output: 60 });
    assert.equal(report.input, report.parts.reduce((sum, entry) => sum + entry.input, 0));
    assert.equal(report.output, 60);
    assert.ok(Math.abs(report.input - estimateTokens(buildNote(selection({ relevant: [geva] }), { calendar, npcPlansOnly: true }))) <= report.parts.length);

    const captured = noteTokens(noteParts(selection({ relevant: [geva] }), { calendar, instruction: '' }));
    assert.equal(captured.output, 0, 'capture writes the changes in a quiet call of its own');
    assert.ok(captured.input > 0);
    assert.equal(noteTokens(parts, { outputTokens: 90 }).output, 90);
    for (const nothing of [[], null, undefined, 'x', [null, { label: 'Header', text: '' }]]) assert.deepEqual(noteTokens(nothing), { input: 0, output: 0, parts: [] });
});

// v0.8.4: long parts are trimmed in the note only.

const LONG_GOAL = 'collect the bond from the widow at the mill before the river guild hears of it and sends its own collectors to the door';
const LONG_NOW = 'waits in the back room of the Gilded Eel with two hired knives and a ledger of every debt owed';

test('notePart: short parts unchanged, long ones cut at a word boundary with an ellipsis', () => {
    assert.equal(notePart('  files the warrant ', 'then'), 'files the warrant');
    assert.equal(notePart('', 'now'), '');
    assert.equal(notePart(null, 'goal'), '');
    assert.deepEqual([NOTE_PART_WORDS.now, NOTE_PART_WORDS.then, NOTE_PART_WORDS.goal, NOTE_PART_WORDS.desc], [12, 12, 16, 16]);
    // Exactly at the limit is kept whole.
    const twelve = 'one two three four five six seven eight nine ten eleven twelve';
    assert.equal(notePart(twelve, 'now'), twelve);
    assert.equal(notePart(`${twelve} thirteen`, 'now'), `${twelve}…`);
    assert.equal(notePart(LONG_NOW, 'now'), 'waits in the back room of the Gilded Eel with two hired…');
    assert.equal(notePart(LONG_GOAL, 'goal'), 'collect the bond from the widow at the mill before the river guild hears of it…');
    // A field the table does not name gets 16 words.
    assert.equal(notePart(LONG_GOAL, 'mood').split(' ').length, 16);
    // Trailing punctuation goes before the ellipsis.
    assert.equal(notePart('a, b, c, d, e, f, g, h, i, j, k, l, m', 'now'), 'a, b, c, d, e, f, g, h, i, j, k, l…');
    // A cut never leaves a bracket open when words are left before it.
    assert.equal(notePart('meets the envoy at the old bridge near the (Lord Warden of the Eastern March) tomorrow', 'now'), 'meets the envoy at the old bridge near the…');
});

test('long parts are trimmed in the note and its token count, never in the record', () => {
    const collector = record({ key: 'Bond collector', fields: { now: LONG_NOW, then: 'calls on the widow', on: 'Goldwane 17' } });
    const bond = record({ key: 'The bond', kind: 'quest', fields: { goal: LONG_GOAL, giver: 'Warden Hale', reward: '40 crowns', type: 'contract' } });
    const longHook = record({ key: 'River stranger', kind: 'hook', fields: { desc: LONG_GOAL } });
    const due = record({ key: 'Widow\'s mill', kind: 'clock', fields: { desc: LONG_GOAL, due: 'Goldwane 16' } });
    const parts = noteParts(selection({ due: [due], relevant: [collector, bond, longHook] }), { calendar });
    const note = parts.map(entry => entry.text).join('\n');
    const trimmedGoal = 'collect the bond from the widow at the mill before the river guild hears of it…';
    assert.ok(lines(note).includes('Off-screen: Bond collector — waits in the back room of the Gilded Eel with two hired… → calls on the widow (Goldwane 17)'));
    assert.ok(lines(note).includes(`Quests: The bond (contract) — ${trimmedGoal} · for Warden Hale · 40 crowns`));
    assert.ok(lines(note).includes(`Hooks: River stranger — ${trimmedGoal}`));
    assert.ok(lines(note).includes(`Due now: Widow's mill — ${trimmedGoal} (Goldwane 16)`));
    assert.ok(!note.includes('ledger of every debt'));
    assert.ok(!note.includes('its own collectors'));
    // The token count is the trimmed note's.
    assert.equal(noteTokens(parts).input, parts.reduce((sum, entry) => sum + estimateTokens(entry.text), 0));
    assert.equal(buildNote(selection({ due: [due], relevant: [collector, bond, longHook] }), { calendar }), note);
    // The records are untouched.
    assert.equal(collector.fields.now, LONG_NOW);
    assert.equal(bond.fields.goal, LONG_GOAL);
    // Short parts are written as before.
    assert.ok(lines(buildNote(selection({ relevant: [geva] }), { calendar })).includes('Off-screen: Geva — Bailiff Court → files the warrant (Goldwane 17)'));
});
