// Tests for src/note.js: the note's format, its budget and the change-line instruction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AWAY_ARRIVAL, AWAY_CUE, AWAY_DEADLINE, AWAY_RECORD, CHANGE_INSTRUCTION, DIRECTOR_OUTPUT_TOKENS, ENCOUNTER_CUE, NOTE_PART_WORDS, NPC_PLANS_ONLY, PACING, PACING_NO_CHANGES, STATIC_LABELS, buildNote, notePart, noteParts, noteTokens, staticNote, tailNote } from '../src/note.js';
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
        format(abs, { era = true } = {}) {
            const { year, month, day, minutes } = fromAbs(abs);
            const hour = Math.floor(minutes / 60);
            return `${era ? `CY ${year}, ` : ''}${MONTHS[month]} ${day}, ${pad(hour % 12 || 12)}:${pad(minutes % 60)} ${hour < 12 ? 'am' : 'pm'}`;
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

test('CHANGE_INSTRUCTION: about 165 tokens, the four ops, kinds, fields and the rules', () => {
    const tokens = estimateTokens(CHANGE_INSTRUCTION);
    assert.ok(tokens >= 100 && tokens <= 165, `${tokens} tokens`);
    assert.match(CHANGE_INSTRUCTION, /a job only offered: \+ hook with giver, reward/);
    assert.match(CHANGE_INSTRUCTION, /<Director>/);
    assert.match(CHANGE_INSTRUCTION, /^\+ kind Key — summary \| label: value/m);
    assert.match(CHANGE_INSTRUCTION, /^~ Key — label: value/m);
    assert.match(CHANGE_INSTRUCTION, /^- Key — reason/m);
    assert.match(CHANGE_INSTRUCTION, /^! Key — what happened/m);
    for (const kind of ['agenda', 'event', 'hook', 'clock', 'beat', 'secret']) assert.ok(CHANGE_INSTRUCTION.includes(kind), kind);
    assert.match(CHANGE_INSTRUCTION, /now, then, on, due, leg, arrive, shown/);
    assert.match(CHANGE_INSTRUCTION, /Dates go only in on, due and arrive, with a clock time/);
    assert.match(CHANGE_INSTRUCTION, /never the whole list/);
    assert.ok(CHANGE_INSTRUCTION.includes('Never write actions for {{user}}'));
});

test('the current arc heads its beats, with no line of its own (0.9.3)', () => {
    const arc = { key: 'The Weir Bullion', kind: 'arc', status: 'active', fields: { desc: 'who sold the weir route' } };
    const empty = { now: null, place: '', arc, due: [], arriving: [], relevant: [], dormant: [], secrets: [], resolvedRecently: [] };
    const alone = buildNote(empty, { calendar: null }).split('\n');
    assert.equal(alone[1], 'Beats — The Weir Bullion (who sold the weir route)', 'every beat due or none left: the arc alone');
    assert.ok(!alone.some(line => line.startsWith('Arc:')));
    const riders = { key: 'Toll riders', kind: 'beat', status: 'active', fields: { desc: 'reach the ford', on: 'Goldwane 19' } };
    const withBeat = buildNote({ ...empty, relevant: [{ record: riders, reason: 'beat', priority: 2 }] }, { calendar: null }).split('\n');
    assert.equal(withBeat[1], 'Beats — The Weir Bullion (who sold the weir route): Toll riders — reach the ford (Goldwane 19)');
    // No arc: the beats line as before.
    assert.equal(buildNote({ ...empty, arc: null, relevant: [{ record: riders, reason: 'beat', priority: 2 }] }, { calendar: null }).split('\n')[1], 'Beats: Toll riders — reach the ford (Goldwane 19)');
});

test('with the agendas in the scene block\'s Off-Screen, the note leaves its Off-screen line out (0.9.3)', () => {
    const geva = { key: 'Geva', kind: 'agenda', status: 'active', fields: { now: 'Bailiff Court', then: 'files the warrant', on: 'Goldwane 17' } };
    const brant = { key: 'Brant', kind: 'agenda', status: 'active', fields: { now: 'on the road', arrive: 'Goldwane 16' } };
    const sel = { now: null, place: '', arc: null, due: [], arriving: [brant], relevant: [{ record: geva, reason: 'active', priority: 6 }], dormant: [], secrets: [], resolvedRecently: [] };
    assert.ok(buildNote(sel, { calendar: null }).split('\n').some(line => line.startsWith('Off-screen: Geva')));
    const lines = buildNote(sel, { calendar: null, offscreenInBlock: true }).split('\n');
    assert.ok(!lines.some(line => line.startsWith('Off-screen:')));
    assert.ok(lines.some(line => line.startsWith('Arriving: Brant')), 'arriving still told');
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
    assert.match(CHANGE_INSTRUCTION, /quest \(a job \{\{user\}\} accepted, not an errand; a job only offered: \+ hook with giver, reward; done or failed: - it\): type, giver, goal, reward, step, due, difficulty\./);
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

// (0.9.19)
test('reach: a due beat says how it touches {{user}}, a beat still ahead does not', () => {
    const sack = record({ key: 'Guards sack the Stray Oar', kind: 'beat', fields: {
        desc: 'drunken convoy guards wreck the taproom', on: 'Goldwane 16, 10:30 pm', place: 'Stray Oar',
        reach: 'the inn shuts for repairs; Marrit is out of work and asks Wessel for a charter' } });
    const due = buildNote(selection({ due: [sack] }), { calendar });
    assert.equal(lines(due)[1], 'Due now: Guards sack the Stray Oar (Goldwane 16, 10:30 pm) · reach: the inn shuts for repairs; Marrit is out of work and asks Wessel for a charter');

    const fight = record({ key: 'Ambush at the weir', kind: 'beat', fields: { on: 'Goldwane 16', encounter: '3 bandit', reach: 'the weir road closes' } });
    assert.equal(lines(buildNote(selection({ due: [fight] }), { calendar }))[1], 'Due now: Ambush at the weir (Goldwane 16) (fight: 3 bandit) · reach: the weir road closes');

    const ahead = buildNote(selection({ relevant: [record({ ...sack, fields: { ...sack.fields, on: 'Goldwane 19' } })] }), { calendar });
    assert.ok(lines(ahead).some(line => line.startsWith('Beats: Guards sack the Stray Oar')));
    assert.doesNotMatch(ahead, /reach/);

    // A long reach ends in "…" in the note only.
    const long = record({ ...sack, fields: { ...sack.fields, reach: Array.from({ length: 30 }, (_, i) => `w${i}`).join(' ') } });
    assert.match(lines(buildNote(selection({ due: [long] }), { calendar }))[1], / · reach: w0 .* w15…$/);
    assert.equal(NOTE_PART_WORDS.reach, 16);
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
    assert.deepEqual(parts.map(entry => entry.label), ['Header', 'Due now', 'Arriving', 'Off-screen', 'World', 'Hooks', 'Quests', 'Clocks', 'Beats',
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

test('quest check: an open quest whose step or now reads as over asks the story to close it (0.9.5)', () => {
    const quest = (key, fields) => ({ key, id: key.toLowerCase(), kind: 'quest', status: 'active', fields: { desc: '', goal: '', step: '', now: '', ...fields } });
    const sel = rel => ({ now: null, place: '', arc: null, due: [], arriving: [], relevant: rel.map(record => ({ record, reason: 'active', priority: 6 })), dormant: [], secrets: [], resolvedRecently: [] });
    const done = quest('Sheep-killer', { goal: 'kill the wolf', step: 'wolf slain, reward collected' });
    const lines = buildNote(sel([done]), { calendar: null }).split('\n');
    assert.ok(lines.includes('Quest check: the story may have finished Sheep-killer. If it has, close it with - Key — outcome; if not, leave it.'));
    for (const fields of [{ goal: 'complete the ritual', step: 'gathering herbs' }, { step: 'done with the first part, now the den' }, { desc: 'finished business with the guild' }]) {
        assert.ok(!buildNote(sel([quest('Ritual', fields)]), { calendar: null }).includes('Quest check'), JSON.stringify(fields));
    }
    assert.ok(!buildNote(sel([done]), { calendar: null, instruction: '' }).includes('Quest check'), 'not when capture writes the changes');
});

test('quest check: a quest the latest exchange gives up asks the story to close it as abandoned (0.9.6)', () => {
    const quest = { key: 'Herb run', id: 'herb run', kind: 'quest', status: 'active', fields: { goal: 'moonleaf', step: 'two found' } };
    const sel = { now: null, place: '', arc: null, due: [], arriving: [], relevant: [{ record: quest, reason: 'active', priority: 6 }], dormant: [], secrets: [], resolvedRecently: [] };
    const lines = buildNote(sel, { calendar: null, givenUp: ['Herb run'] }).split('\n');
    assert.ok(lines.includes('Quest check: {{user}} may be giving up Herb run. If they do, close it with - Key — abandoned; if not, leave it.'));
    assert.ok(!buildNote(sel, { calendar: null, givenUp: ['Herb run'], instruction: '' }).includes('Quest check'));
});

test('a quest deadline goes out at the clock time the calendar sets, never "sunset" (0.9.12)', async () => {
    const { makeCalendar } = await import('../src/calendar.js');
    const real = makeCalendar({ preset: 'custom', months: ['Dawnwane', 'Goldwane', 'Haywane'].map(name => ({ name, days: 30 })) });
    const now = real.parse('Goldwane 16, 09:00 am').abs;
    const quest = (key, due) => record({ key, kind: 'quest', fields: { goal: 'drive off the wolves', due } });
    const note = buildNote(selection({ now, relevant: [quest('Wolves', 'Goldwane 30 sunset'), quest('Bond', 'Goldwane 30'), quest('Ferry', 'Goldwane 18, 06:15 am'), quest('Vague', 'before the frost')] }), { calendar: real });
    assert.ok(lines(note).includes('Quests: Wolves — drive off the wolves · by Goldwane 30, 07:00 pm · Bond — drive off the wolves · by Goldwane 30, 11:59 pm · Ferry — drive off the wolves · by Goldwane 18, 06:15 am · Vague — drive off the wolves · by before the frost'));
    const due = buildNote(selection({ now, due: [quest('Wolves', 'Goldwane 16 dawn')] }), { calendar: real });
    assert.ok(lines(due).includes('Due now: Wolves — deadline Goldwane 16, 06:00 am reached (drive off the wolves)'));
});

test('quest check: an offer the reader takes on or turns down asks the story to record it (0.9.15)', () => {
    const offer = record({ key: 'Wolf Hunt', kind: 'hook', fields: { giver: 'Danique', reward: '4 silver' } });
    const note = buildNote(selection({ relevant: [offer] }), { calendar, taking: ['Wolf Hunt'], declining: ['Rat Culling'] });
    const check = lines(note).find(line => line.startsWith('Quest check:'));
    assert.match(check, /\{\{user\}\} may be taking on Wolf Hunt\. If they do, write \+ quest Key with its parts \(no - line for the hook\); if not, leave it an offer\./);
    assert.match(check, /\{\{user\}\} may be turning down Rat Culling\. If they do, close it with - Key — declined; if not, leave it\./);
    // Even with nothing else to say, and never where capture writes the lines.
    assert.match(buildNote(selection(), { calendar, taking: ['Wolf Hunt'] }), /may be taking on Wolf Hunt/);
    assert.doesNotMatch(buildNote(selection({ relevant: [offer] }), { calendar, taking: ['Wolf Hunt'], instruction: '' }), /Quest check/);
});

test('a quest given up with the Abandon flag is told behind the scenes (0.9.15)', () => {
    const note = buildNote(selection(), { calendar, abandoning: ['Wolf Hunt'] });
    assert.ok(lines(note).includes('Abandoned: {{user}} gives up Wolf Hunt. Show it in this reply, and close each with - Key — abandoned.'));
    // With capture writing the lines, the story is only told to show it.
    assert.match(buildNote(selection(), { calendar, abandoning: ['Wolf Hunt'], instruction: '' }), /Abandoned: \{\{user\}\} gives up Wolf Hunt\. Show it in this reply\./);
});

test('an offer taken on or turned down with the buttons is told the same way (0.9.33)', () => {
    const note = buildNote(selection(), { calendar, takingOn: ['Wicker Bed Hogs'], turningDown: ['Lime Kiln Bats'] });
    assert.ok(lines(note).includes("Taken on: {{user}} takes on Wicker Bed Hogs. Show it in this reply as part of the scene, in the story's own voice, and write ~ Key — accepted for each."));
    assert.ok(lines(note).includes('Turned down: {{user}} turns down Lime Kiln Bats. Show it in this reply, and close each with - Key — declined.'));
    assert.match(buildNote(selection(), { calendar, takingOn: ['Wicker Bed Hogs'], instruction: '' }), /Taken on: \{\{user\}\} takes on Wicker Bed Hogs\. Show it in this reply as part of the scene, in the story's own voice\./);
});

// (0.9.19) While away: what came due while the story skipped ahead.

test('while away: a jump of 12 hours or more tells what came due in the gap once, before Due now', () => {
    const from = at('Goldwane 12, 08:00 pm');
    const now = at('Goldwane 15, 07:00 am');
    const oar = record({ key: 'Stray Oar', kind: 'event', fields: { then: 'sacked by the guild', on: 'Goldwane 13' } });
    const collector = record({ key: 'Bond collector', fields: { leg: "Shorn → Hollin's Reach 40 B, ride 60/day → 1", arrive: 'Goldwane 14' } });
    const ambush = record({ key: 'Ambush at the weir', kind: 'beat', fields: { on: 'Goldwane 14, 09:00 am', encounter: '3 bandit' } });
    // Already due before the jump: it was waiting, so it stays on Due now.
    const waiting = record({ key: "Saartje's sale", fields: { on: 'Goldwane 12' } });
    const sel = selection({ now, due: [oar, ambush, waiting], arriving: [collector], relevant: [geva] });
    const parts = noteParts(sel, { calendar, previousTime: from });
    assert.deepEqual(parts.map(entry => entry.label).slice(0, 3), ['Header', 'While away', 'Due now']);
    assert.equal(parts[1].text, "While away (Goldwane 12, 08:00 pm → Goldwane 15, 07:00 am): Stray Oar — sacked by the guild (Goldwane 13) · Ambush at the weir (Goldwane 14, 09:00 am) (fought off-screen: 3 bandit) · Bond collector reached Hollin's Reach (Goldwane 14). "
        + `${AWAY_CUE} ${AWAY_RECORD} ${AWAY_ARRIVAL}`);
    assert.equal(parts[2].text, "Due now: Saartje's sale (Goldwane 12)");
    assert.ok(!parts.some(entry => entry.label === 'Arriving'), 'an arrival in the gap is not repeated');
    assert.ok(!parts.some(entry => entry.label === 'Encounter cue'), 'a fight in the gap was fought off-screen');
    assert.ok(parts.some(entry => entry.label === 'Pacing'));
    assert.equal(joined(parts), buildNote(sel, { calendar, previousTime: from }));
    // The recap is about the narration: it stays when capture writes the change lines, without asking for them.
    const captured = noteParts(sel, { calendar, previousTime: from, instruction: '' }).find(entry => entry.label === 'While away');
    assert.ok(captured.text.endsWith(`(Goldwane 14). ${AWAY_CUE}`));
    // It is counted like any other part, and kept by the budget like Due now.
    assert.ok(noteTokens(parts).parts.some(entry => entry.label === 'While away' && entry.input > 0));
    assert.ok(noteParts(sel, { calendar, previousTime: from, budgetTokens: 10 }).some(entry => entry.label === 'While away'));
    assert.ok(estimateTokens(`${AWAY_CUE} ${AWAY_RECORD}`) <= 35);
});

test('while away: a small gap, no earlier time or no calendar changes nothing', () => {
    const oar = record({ key: 'Stray Oar', kind: 'event', fields: { then: 'sacked', on: 'Goldwane 16, 08:00 am' } });
    const sel = selection({ now: at('Goldwane 16, 09:00 am'), due: [oar] });
    const plain = buildNote(sel, { calendar });
    for (const previousTime of [at('Goldwane 15, 10:00 pm'), null, at('Goldwane 17, 09:00 am')]) {
        assert.equal(buildNote(sel, { calendar, previousTime }), plain, String(previousTime));
    }
    assert.equal(buildNote(sel, { calendar: null, previousTime: at('Goldwane 10') }), buildNote(sel, { calendar: null }));
    // Exactly 12 hours is a jump.
    assert.match(buildNote(sel, { calendar, previousTime: at('Goldwane 15, 09:00 pm') }), /^While away \(Goldwane 15, 09:00 pm → Goldwane 16, 09:00 am\): Stray Oar — sacked/m);
});

test('while away: secrets never appear, only on Do not reveal', () => {
    const from = at('Goldwane 12, 08:00 pm');
    const plot = record({ key: 'The heir', kind: 'secret', fields: { desc: 'Ren is the heir', on: 'Goldwane 13' } });
    const oar = record({ key: 'Stray Oar', kind: 'event', fields: { then: 'sacked', on: 'Goldwane 13' } });
    // Even a secret slipped into the due list by mistake stays out of the recap.
    const note = buildNote(selection({ now: at('Goldwane 15, 07:00 am'), due: [oar, plot], secrets: [plot] }), { calendar, previousTime: from });
    const away = lines(note).find(line => line.startsWith('While away'));
    assert.ok(away && !away.includes('The heir') && !away.includes('Ren is the heir'));
    assert.ok(lines(note).includes('Do not reveal: The heir'));
});

test('while away: a quest deadline in the gap passed; one later today is still only reached', () => {
    const from = at('Goldwane 12, 08:00 pm');
    const now = at('Goldwane 15, 07:00 am');
    const bounty = record({ key: 'Bounty on Kettle Jack', kind: 'quest', fields: { goal: 'bring him in alive', due: 'Goldwane 14' } });
    const ferry = record({ key: 'Ferry', kind: 'quest', fields: { goal: 'catch the ferry', due: 'Goldwane 15' } });
    const note = buildNote(selection({ now, due: [bounty, ferry] }), { calendar, previousTime: from });
    const away = lines(note).find(line => line.startsWith('While away'));
    assert.match(away, /: Bounty on Kettle Jack — deadline Goldwane 14 passed \(bring him in alive\)\./);
    assert.ok(away.endsWith(`${AWAY_RECORD} ${AWAY_DEADLINE}`));
    assert.ok(lines(note).includes('Due now: Ferry — deadline Goldwane 15 reached (catch the ferry)'));
    assert.ok(!buildNote(selection({ now, due: [bounty] }), { calendar, previousTime: from, instruction: '' }).includes(AWAY_DEADLINE));
});

test('a beat that slipped in the latest reply is told once, as off-screen or not at all (0.9.19)', () => {
    const slipped = [{ key: 'Guards sack the Stray Oar', on: 'Goldwane 13', giver: '' }];
    // Even with nothing else tracked, and where capture writes the lines too.
    const note = buildNote(selection(), { calendar, slipped });
    assert.ok(lines(note).includes('Slipped: Guards sack the Stray Oar (Goldwane 13) — it happened off-screen or not at all; mention it only where it fits.'));
    assert.match(buildNote(selection(), { calendar, slipped, instruction: '' }), /^Slipped: Guards sack/m);
    const two = buildNote(selection({ relevant: [geva] }), { calendar, slipped: [...slipped, { key: 'Toll riders', on: '', giver: '' }, slipped[0]] });
    assert.ok(lines(two).includes('Slipped: Guards sack the Stray Oar (Goldwane 13), Toll riders — they happened off-screen or not at all; mention them only where they fit.'));
    assert.doesNotMatch(buildNote(selection(), { calendar }), /Slipped/);
    assert.deepEqual(buildNote(selection(), { calendar, slipped: [] }), CHANGE_INSTRUCTION, 'nothing to say: the instruction alone');
});

test('an offer that lapsed in the latest reply gets one line, its giver by name (0.9.19)', () => {
    const note = buildNote(selection(), { calendar, lapsed: [{ key: 'Rat Culling', on: '', giver: 'Danique, the rat-catcher\'s widow' }] });
    assert.ok(lines(note).includes('Lapsed: Rat Culling (Danique\'s offer) went to someone else; Danique may mention it.'));
    assert.ok(lines(buildNote(selection(), { calendar, lapsed: [{ key: 'Ferry', on: '', giver: '' }] })).includes('Lapsed: Ferry went to someone else; it may come up in passing.'));
    const two = buildNote(selection(), { calendar, instruction: '', lapsed: [{ key: 'Rat Culling', giver: 'Danique' }, { key: 'Ferry', giver: '' }] });
    assert.ok(lines(two).includes('Lapsed: Rat Culling (Danique\'s offer), Ferry went to someone else; whoever offered them may mention it.'));
    // Labelled parts, after Abandoned and before the instruction.
    const labels = noteParts(selection(), { calendar, abandoning: ['Wolf Hunt'], slipped: [{ key: 'Riders', on: 'Goldwane 13' }], lapsed: [{ key: 'Ferry' }] }).map(entry => entry.label);
    assert.deepEqual(labels, ['Header', 'Abandoned', 'Slipped', 'Lapsed', 'Change instruction']);
});

test('weekdays in the note (0.9.21): today\'s leads the header; a world without a week is told to give dates', async () => {
    const { makeCalendar } = await import('../src/calendar.js');
    const plain = makeCalendar({ preset: 'custom', era: 'CY', months: ['Dawnwane', 'Goldwane', 'Haywane'] });
    const now = plain.toAbs({ year: 611, month: 1, day: 12, minutes: 738 });
    const selection = { now, place: 'Bluewatch', arc: null, due: [], arriving: [], relevant: [{ record: record({ key: 'Marsh-trolls', kind: 'hook' }), reason: 'active', priority: 6 }], dormant: [], secrets: [], resolvedRecently: [] };
    const parts = noteParts(selection, { calendar: plain });
    assert.equal(parts[0].text, '[Story Director · CY 611, Goldwane 12, 12:18 pm · Bluewatch]');
    assert.deepEqual([parts[1].label, parts[1].join], ['No weekdays', ' ']);
    assert.equal(parts[1].text, 'This world has no weekdays: name a day by its date (Goldwane 14), never Monday to Sunday.');
    const config = { preset: 'custom', era: 'CY', months: ['Dawnwane', 'Goldwane', 'Haywane'], week: ['Moonday', 'Tideday', 'Thornday'] };
    const week = makeCalendar({ ...config, weekOffset: makeCalendar(config).weekOffsetFor(now, 'Tideday') });
    const named = noteParts(selection, { calendar: week });
    assert.equal(named[0].text, '[Story Director · Tideday, CY 611, Goldwane 12, 12:18 pm · Bluewatch]');
    assert.ok(!named.some(entry => entry.label === 'No weekdays'));
    const gregorian = makeCalendar('gregorian');
    const real = noteParts({ ...selection, now: gregorian.toAbs({ year: 2026, month: 9, day: 19, minutes: 600 }) }, { calendar: gregorian });
    assert.match(real[0].text, /^\[Story Director · Monday, October 19, 2026, 10:00 am/);
    assert.ok(!real.some(entry => entry.label === 'No weekdays'));
});

test('a quest whose work is done and only the pay is left: its time is when the pay can be had (0.9.28)', () => {
    const wolf = record({ key: 'Lone Grey Wolf', kind: 'quest', fields: { giver: 'Verna', goal: 'Slay the pack', reward: '1 gold', step: 'turn in voucher at bailiff hatch on Friday noon', due: 'Goldwane 16, 12:00 pm' } });
    const due = buildNote(selection({ now: at('Goldwane 16, 01:00 pm'), due: [wolf] }), { calendar });
    assert.ok(lines(due).includes('Due now: Lone Grey Wolf — pay waiting from Goldwane 16, 12:00 pm (turn in voucher at bailiff hatch on Friday noon); the work is done, the hour fails nothing'));
    assert.ok(!due.includes('deadline'), 'never told as a deadline reached');
    // In a skipped stretch of time too, without the passed-deadline instruction.
    const parts = noteParts(selection({ now: at('Goldwane 17, 07:00 am'), due: [wolf] }), { calendar, previousTime: at('Goldwane 15, 08:00 pm') });
    const away = parts.find(entry => entry.label === 'While away').text;
    assert.ok(away.includes('Lone Grey Wolf — pay waiting from Goldwane 16, 12:00 pm'));
    assert.ok(!away.includes(AWAY_DEADLINE));
    // A step that is still the work keeps the deadline wording.
    const hunt = record({ key: 'Wolves', kind: 'quest', fields: { goal: 'drive off the wolves', step: 'return skins to Verna', due: 'Goldwane 16' } });
    assert.ok(lines(buildNote(selection({ due: [hunt] }), { calendar })).includes('Due now: Wolves — deadline Goldwane 16 reached (drive off the wolves)'));
});

test('cache-friendly: the fixed part is byte-identical reply to reply, the rest goes at the end (0.9.38)', () => {
    const fight = record({ key: 'Drake Shallows', kind: 'event', fields: { on: 'Goldwane 16, 09:00 am', encounter: 'swamp drake' } });
    const replies = [
        { selection: selection(), options: { calendar } },
        { selection: selection({ due: [fight], relevant: [record({ key: 'Brecht', fields: { now: 'at the Stray Oar' } })] }), options: { calendar, abandoning: ['Wolf Hunt'], takingOn: ['Lime Kiln Bats'] } },
        { selection: selection({ now: at('Goldwane 18, 06:00 pm'), place: 'Bluewatch' }), options: { calendar, npcPlansOnly: true } },
    ];
    const fixed = replies.map(({ options }) => staticNote({ instruction: options.instruction ?? CHANGE_INSTRUCTION, npcPlansOnly: false }));
    assert.equal(new Set(fixed).size, 1, 'the same text whatever the reply holds');
    assert.equal(fixed[0], `${CHANGE_INSTRUCTION}\n${PACING}`);
    // Pacing is always there now, the encounter cue and everything for this reply only in the tail.
    const tails = replies.map(({ selection: s, options }) => tailNote(noteParts(s, options)));
    for (const tail of tails) for (const label of STATIC_LABELS) assert.ok(!tail.includes(label === 'Pacing' ? 'Pacing:' : label === 'Change instruction' ? 'End your reply with one <Director>' : NPC_PLANS_ONLY), `${label} not in the tail`);
    assert.equal(tails[0], '', 'nothing scheduled, nothing chosen: no tail at all');
    assert.match(tails[1], /^\[Story Director · .*\]\n/);
    assert.match(tails[1], /\nA due fight starts when the scene reaches it/);
    assert.match(tails[1], /Abandoned: \{\{user\}\} gives up Wolf Hunt/);
    // The whole note is still the two together, part for part.
    const whole = buildNote(replies[1].selection, replies[1].options);
    assert.ok(whole.includes(CHANGE_INSTRUCTION) && whole.includes('Abandoned:'));
    // A capture call writes the lines: no instruction, Pacing without the change lines' words.
    assert.equal(staticNote({ instruction: '' }), PACING_NO_CHANGES);
    assert.equal(staticNote({ npcPlansOnly: true }), `${CHANGE_INSTRUCTION}\n${NPC_PLANS_ONLY}\n${PACING}`);
});

test('a preset with its Main Prompt off drops in-prompt parts: the fixed part is put back early (0.9.38)', async () => {
    const { withFixedNote } = await import('../src/note.js');
    const fixed = `${CHANGE_INSTRUCTION}\n${PACING}`;
    const messages = [{ role: 'system', content: 'Character card' }, { role: 'system', content: 'World info' }, { role: 'user', content: 'hi' }];
    const kept = withFixedNote(messages, fixed);
    assert.deepEqual(kept.map(message => message.role), ['system', 'system', 'system', 'user']);
    assert.equal(kept[2].content, fixed);
    // Already there (the Main Prompt is on): the same array, untouched.
    assert.equal(withFixedNote(kept, fixed), kept);
    assert.equal(withFixedNote(messages, ''), messages);
});
