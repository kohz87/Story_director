// Tests for src/planner.js: reading a realistic planner answer (thinking, bold, bullets,
// aliases, relative dates), plan validation, the ops a plan becomes, the tracker summary and
// the prompt macros.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeCalendar } from '../src/calendar.js';
import { parseChanges } from '../src/changes.js';
import { replay } from '../src/tracker.js';
import {
    DEFAULT_PLANNER_PROMPT,
    buildPlannerMessages,
    parsePlan,
    planToOps,
    summarizeTracker,
    validatePlan,
} from '../src/planner.js';

const calendar = makeCalendar({
    preset: 'custom',
    era: 'CY',
    months: ['Dawnwane', 'Rainmoot', 'Greengale', 'Highsun', 'Goldwane', 'Haywane',
        'Emberwane', 'Nightfall', 'Frostfall', 'Deepwinter', 'Icewane', 'Yearsend'],
    daysPerMonth: 30,
});
const now = calendar.parse('CY 611, Haywane 12, 05:35 pm').abs;

// A planner answer the way models really write it: thinking first, a line of prose, then the
// block with bold labels, bullets, aliases and one line that is not a plan line.
const ANSWER = [
    '<think>',
    'The council thread went quiet. Draft:',
    'ARC: Wrong Arc — not this one',
    'BEAT: Draft beat — not this one',
    '</think>',
    'Here is the plan for the next arc.',
    '',
    '<plan>',
    '**ARC:** The Weir Bullion — who sold the weir route, and the Council vote it decides',
    '* **BEAT:** Council session opens — the vote is called | on: in 2 days | place: Grand Hall',
    '- **BEAT:** Kade presents the corrupted core | after: Council session opens | place: Grand Hall',
    '• BEAT: Bells at the weir — the sluice fails | on: tomorrow at dusk',
    '**NPC AGENDA:** Geva — now: Bailiff Court | then: reissues the stable warrants | on: next morning',
    'AGENDA: Brant — now: frontier road with a dray | then: reaches Auvoth | arrive: Haywane 19',
    'HOOK: River stranger — who pulled Ren from the sump; finding him settles the debt',
    'CLOCK: Hollin\'s Reach graves — washed graves left undone → the first of the dead rise | due: Haywane 28, dusk | shown: none',
    '**OFF-LIMITS:** Kade\'s buyer — Kade sold the weir route to the Highmark legation',
    'The weir hums all night.',
    '</plan>',
].join('\n');

test('the calendar fixture is the one the reader uses', () => {
    assert.equal(calendar.format(now), 'CY 611, Haywane 12, 05:35 pm');
});

test('parsePlan reads a realistic answer and skips the thinking', () => {
    const plan = parsePlan(ANSWER, { calendar, now });

    assert.deepEqual(plan.arc, {
        key: 'The Weir Bullion',
        desc: 'who sold the weir route, and the Council vote it decides',
    });
    assert.deepEqual(plan.items.map(item => [item.kind, item.key]), [
        ['beat', 'Council session opens'],
        ['beat', 'Kade presents the corrupted core'],
        ['beat', 'Bells at the weir'],
        ['agenda', 'Geva'],
        ['agenda', 'Brant'],
        ['hook', 'River stranger'],
        ['clock', 'Hollin\'s Reach graves'],
        ['secret', 'Kade\'s buyer'],
    ]);

    const [council, kade, bells, geva, brant, stranger, graves, buyer] = plan.items;
    assert.deepEqual(council.fields, { desc: 'the vote is called', on: 'Haywane 14, 05:35 pm', place: 'Grand Hall' });
    assert.deepEqual(council.extra, {});
    assert.equal(council.raw, '* **BEAT:** Council session opens — the vote is called | on: in 2 days | place: Grand Hall');

    assert.deepEqual(kade.fields, { place: 'Grand Hall' });
    assert.deepEqual(kade.extra, { after: 'Council session opens' });

    assert.equal(bells.fields.on, 'Haywane 13, 07:00 pm');
    assert.deepEqual(geva.fields, {
        now: 'Bailiff Court', then: 'reissues the stable warrants', on: 'Haywane 13, 09:00 am',
    });

    // Absolute dates stay exactly as written.
    assert.equal(brant.fields.arrive, 'Haywane 19');
    assert.equal(graves.fields.due, 'Haywane 28, dusk');
    assert.equal(graves.fields.shown, 'none');
    assert.equal(stranger.fields.desc, 'who pulled Ren from the sump; finding him settles the debt');
    assert.equal(buyer.fields.desc, 'Kade sold the weir route to the Highmark legation');

    // The prose line inside the block is reported with its line number in the answer.
    const lines = ANSWER.split('\n');
    assert.equal(plan.errors.length, 1);
    assert.equal(plan.errors[0].text, 'The weir hums all night.');
    assert.equal(plan.errors[0].line, lines.indexOf('The weir hums all night.') + 1);
});

test('parsePlan converts the other relative forms and leaves unreadable ones', () => {
    const text = [
        'BEAT: A | on: the day after tomorrow at noon',
        'BEAT: B | on: in 6 hours',
        'BEAT: C | on: tomorrow',
        'BEAT: D | on: "in a week"',
        'BEAT: E | on: tonight',
        'BEAT: F | on: the next day, morning',
        'BEAT: G | on: this evening',
        'BEAT: H | on: 3 days from now at dawn',
        'BEAT: I | on: when the bells ring',
        'BEAT: J | on: in 2 hours at dusk',
        'AGENDA: K — now: on the road | arrive: in 3 days',
    ].join('\n');
    const plan = parsePlan(text, { calendar, now });
    const dates = Object.fromEntries(plan.items.map(item => [item.key, item.fields.on ?? item.fields.arrive]));
    assert.deepEqual(dates, {
        A: 'Haywane 14, 12:00 pm',
        B: 'Haywane 12, 11:35 pm',
        // A day without a time stays a whole day.
        C: 'Haywane 13',
        D: 'Haywane 19, 05:35 pm',
        E: 'Haywane 12, 10:00 pm',
        F: 'Haywane 13, 09:00 am',
        G: 'Haywane 12, 07:00 pm',
        H: 'Haywane 15, 06:00 am',
        I: 'when the bells ring',
        J: 'in 2 hours at dusk',
        K: 'Haywane 15, 05:35 pm',
    });
    assert.deepEqual(plan.errors, []);
});

test('parsePlan without a calendar or now keeps relative dates as written', () => {
    const plan = parsePlan('BEAT: Council session opens | on: in 2 days');
    assert.equal(plan.items[0].fields.on, 'in 2 days');
    assert.equal(parsePlan('BEAT: X | on: tomorrow', { calendar }).items[0].fields.on, 'tomorrow');
});

test('parsePlan uses the whole text when there are no <plan> tags', () => {
    const text = [
        '```text',
        'ARC: The Long Winter — the granaries run low and someone is hoarding',
        '1. BEAT 1: Ration lines form | on: Haywane 20 | place: Market Square',
        '---',
        'TIMER: Grain runs out — hoarding → riots | due: Emberwane 2',
        'THREAD: The miller\'s ledger — who altered it',
        'SUB-EVENT: A fire at the mill | after: Ration lines form',
        '```',
    ].join('\n');
    const plan = parsePlan(text, { calendar, now });
    assert.equal(plan.arc.key, 'The Long Winter');
    assert.deepEqual(plan.items.map(item => [item.kind, item.key]), [
        ['beat', 'Ration lines form'],
        ['clock', 'Grain runs out'],
        ['hook', 'The miller\'s ledger'],
        ['beat', 'A fire at the mill'],
    ]);
    assert.equal(plan.items[0].fields.on, 'Haywane 20');
    assert.deepEqual(plan.errors, []);
});

test('parsePlan reports unknown labels, missing keys and a second ARC, and never throws', () => {
    const plan = parsePlan([
        '<plan>',
        'ARC: One — first',
        'ARC: Two — second',
        'NOTE: remember the rain',
        'BEAT: — nothing before the dash',
        'Geva — now: Court',
        '</plan>',
    ].join('\n'));
    assert.equal(plan.arc.key, 'One');
    assert.deepEqual(plan.items, []);
    assert.deepEqual(plan.errors.map(error => error.line), [3, 4, 5, 6]);
    assert.match(plan.errors[0].message, /second ARC/);
    assert.match(plan.errors[1].message, /unknown label "NOTE"/);
    assert.match(plan.errors[2].message, /missing key/);
    assert.match(plan.errors[3].message, /no label/);

    assert.deepEqual(parsePlan(null), { arc: null, items: [], errors: [] });
});

test('parsePlan drops thinking whose opening tag was cut off', () => {
    const plan = parsePlan('ARC: Draft — no\n</thinking>\n<plan>\nARC: Real — yes\nBEAT: B\n</plan>');
    assert.equal(plan.arc.key, 'Real');
    assert.deepEqual(plan.errors, []);
});

// --- validatePlan ------------------------------------------------------------------------

function kinds(findings) {
    return findings.map(finding => [finding.kind, finding.severity, finding.key]);
}

test('validatePlan accepts a clean plan', () => {
    const plan = parsePlan(ANSWER.replace('The weir hums all night.\n', ''), { calendar, now });
    assert.deepEqual(validatePlan(plan, { calendar, now, userName: 'Ren' }), []);
});

test('validatePlan: no arc and no items are errors', () => {
    assert.deepEqual(kinds(validatePlan(parsePlan(''), { calendar, now })), [
        ['plan-no-arc', 'error', null],
        ['plan-empty', 'error', null],
    ]);
});

test('validatePlan: on/due that does not parse, or lies in the past', () => {
    const plan = parsePlan([
        'ARC: A — a',
        'BEAT: Bells | on: when the bells ring',
        'BEAT: Yesterday | on: Haywane 10',
        'BEAT: This morning | on: Haywane 12, 09:00 am',
        'BEAT: Today | on: Haywane 12',
        'CLOCK: Graves | due: Haywane 11, dusk',
        'AGENDA: Brant — now: road | arrive: soon',
    ].join('\n'), { calendar, now });
    assert.deepEqual(kinds(validatePlan(plan, { calendar, now })), [
        ['plan-bad-date', 'warn', 'Bells'],
        ['plan-past-date', 'warn', 'Yesterday'],
        ['plan-past-date', 'warn', 'This morning'],
        ['plan-past-date', 'warn', 'Graves'],
    ]);
    // Without a calendar there is nothing to check dates against.
    assert.deepEqual(validatePlan(plan), []);
});

test('validatePlan: items that plan what the user does', () => {
    const plan = parsePlan([
        'ARC: A — a',
        'AGENDA: Ren — now: at the inn | then: leaves town',
        'BEAT: Council | then: Ren gives a speech',
        'HOOK: Ren\'s debt — what he owes the guild',
        'HOOK: Renata — the smuggler',
        'SECRET: Ren is the heir',
    ].join('\n'));
    assert.deepEqual(kinds(validatePlan(plan, { userName: 'Ren' })), [
        ['plan-user-action', 'warn', 'Ren'],
        ['plan-user-action', 'warn', 'Council'],
    ]);
    assert.deepEqual(validatePlan(plan, { userName: '' }), []);
});

test('validatePlan: one info finding per unread line', () => {
    const plan = parsePlan('ARC: A — a\nBEAT: B\nprose\nmore prose');
    const findings = validatePlan(plan);
    assert.deepEqual(kinds(findings), [
        ['plan-unread', 'info', null],
        ['plan-unread', 'info', null],
    ]);
    assert.match(findings[0].message, /Line 3/);
});

// --- planToOps ---------------------------------------------------------------------------

test('planToOps: an arc op, then an item op each, all tagged with the arc', () => {
    const plan = parsePlan(ANSWER, { calendar, now });
    const ops = planToOps(plan, { arcId: 'arc-2' });
    assert.equal(ops.length, 1 + plan.items.length);

    const [arc, ...items] = ops;
    assert.deepEqual(arc, {
        op: '+', kind: 'arc', key: 'The Weir Bullion', id: 'the weir bullion',
        fields: { desc: 'who sold the weir route, and the Council vote it decides' },
        extra: { arc: 'arc-2' }, reason: '',
        raw: '+ arc The Weir Bullion — who sold the weir route, and the Council vote it decides | arc: arc-2',
    });

    assert.deepEqual(items.map(op => [op.op, op.kind, op.key]), plan.items.map(item => ['+', item.kind, item.key]));
    for (const op of items) assert.equal(op.extra.arc, 'arc-2');
    assert.deepEqual(items[1].extra, { after: 'Council session opens', arc: 'arc-2' });
    assert.equal(items[0].fields.on, 'Haywane 14, 05:35 pm');

    // Every item op reads back the same through the change-line grammar.
    for (const op of items) {
        const { ops: back, errors } = parseChanges(op.raw);
        assert.deepEqual(errors, []);
        const { raw, ...rest } = back[0];
        const { raw: written, ...expected } = op;
        assert.equal(raw, written);
        assert.deepEqual(rest, expected);
    }
});

test('planToOps without an arc line gives item ops only, and needs an arcId', () => {
    const ops = planToOps(parsePlan('BEAT: Bells — ring'), { arcId: 'arc-1' });
    assert.deepEqual(ops.map(op => op.raw), ['+ beat Bells — ring | arc: arc-1']);
    assert.throws(() => planToOps(parsePlan('BEAT: Bells'), {}), TypeError);
});

// --- summarizeTracker --------------------------------------------------------------------

test('summarizeTracker: an empty tracker', () => {
    assert.equal(summarizeTracker({ version: 1, records: [], message: -1, time: null }), '(nothing tracked yet)');
    assert.equal(summarizeTracker(null), '(nothing tracked yet)');
});

test('summarizeTracker: active records by kind, soonest first, then resolved', () => {
    const lines = text => parseChanges(text).ops;
    const { tracker } = replay([
        {
            message: 1,
            time: now,
            text: '',
            ops: lines([
                '+ agenda Geva — now: Bailiff Court | then: files the warrant | on: Haywane 17',
                '+ agenda Brant — now: frontier road | then: reaches Auvoth | on: Haywane 14',
                '+ event Canal Street fires — curfew in force',
                '+ hook River stranger — who pulled Ren from the sump',
                '+ clock Hollin\'s Reach graves — the dead rise | due: Haywane 28 | shown: sign',
                '+ secret Kade\'s buyer — the Highmark legation',
                '+ beat Bells at the weir — the sluice fails | on: Haywane 13',
            ].join('\n')),
        },
        { message: 2, time: now, text: '', ops: lines('- Bells at the weir — the sluice held') },
    ]);

    assert.equal(summarizeTracker(tracker, { calendar }), [
        'Off-screen:',
        '- Brant — frontier road → reaches Auvoth (Haywane 14)',
        '- Geva — Bailiff Court → files the warrant (Haywane 17)',
        'World:',
        '- Canal Street fires — curfew in force',
        'Hooks:',
        '- River stranger — who pulled Ren from the sump',
        'Clocks:',
        '- Hollin\'s Reach graves — the dead rise (Haywane 28)',
        'Secrets:',
        '- Kade\'s buyer — the Highmark legation',
        'Resolved:',
        '- Bells at the weir — the sluice held',
    ].join('\n'));

    // Without a calendar the tracker order is kept.
    assert.match(summarizeTracker(tracker), /Off-screen:\n- Geva .*\n- Brant /);
});

// --- buildPlannerMessages ----------------------------------------------------------------

test('buildPlannerMessages fills macros and leaves the rest as written', () => {
    const messages = buildPlannerMessages({
        template: 'T {{now}} | {{place}} | {{nearby}} | {{note}} | {{genre}} | {{previous_arc}} | {{tracker}} | {{recent}} | {{user}} {{char}} {{mystery}}',
        recent: 'Geva: The vote is $& tomorrow.',
        trackerSummary: '(nothing tracked yet)',
        nowText: 'CY 611, Haywane 12, 05:35 pm',
        place: 'Auvoth',
        nearby: ['Shorn', 'Varnhold Watch'],
        genre: 'political intrigue',
        previousArc: 'The Flood — the levee broke',
    });
    assert.deepEqual(messages, [
        {
            role: 'system',
            content: 'T CY 611, Haywane 12, 05:35 pm | Auvoth | Shorn, Varnhold Watch | (none) | political intrigue | The Flood — the levee broke | (nothing tracked yet) | Geva: The vote is $& tomorrow. | {{user}} {{char}} {{mystery}}',
        },
        { role: 'user', content: 'Plan the next arc. Answer only with the <plan> block.' },
    ]);
});

test('buildPlannerMessages with the default prompt leaves only {{user}} and {{char}}', () => {
    const [system, user] = buildPlannerMessages({ nowText: 'Haywane 12', place: 'Auvoth' });
    assert.equal(system.role, 'system');
    assert.equal(user.role, 'user');
    const left = new Set(system.content.match(/\{\{[^}]*\}\}/g));
    assert.deepEqual([...left].sort(), ['{{char}}', '{{user}}']);
    assert.match(system.content, /Now: Haywane 12\nPlace: Auvoth\n/);
    assert.equal(buildPlannerMessages({ template: '' })[0].content, buildPlannerMessages()[0].content);
});

test('the default prompt asks for the plan lines and assumes no setting', () => {
    for (const macro of ['recent', 'tracker', 'now', 'place', 'nearby', 'note', 'genre', 'previous_arc', 'user', 'char']) {
        assert.ok(DEFAULT_PLANNER_PROMPT.includes(`{{${macro}}}`), macro);
    }
    for (const label of ['ARC:', 'BEAT:', 'AGENDA:', 'HOOK:', 'CLOCK:', 'SECRET:']) {
        assert.ok(DEFAULT_PLANNER_PROMPT.includes(label), label);
    }
    assert.match(DEFAULT_PLANNER_PROMPT, /<plan>[\s\S]*<\/plan>/);
    assert.ok(DEFAULT_PLANNER_PROMPT.split(/\s+/).length <= 600);

    // The template's own example block is itself a readable plan.
    const example = parsePlan(DEFAULT_PLANNER_PROMPT.slice(DEFAULT_PLANNER_PROMPT.indexOf('<plan>')));
    assert.ok(example.arc);
    assert.equal(example.items.length, 5);
    assert.deepEqual(example.errors, []);
});

// --- encounters ----------------------------------------------------------------------------

test('parsePlan and planToOps carry a fight beat\'s encounter', () => {
    const plan = parsePlan([
        '<plan>',
        'ARC: The Weir Bullion — who sold the weir route',
        'BEAT: Ambush at the weir — the legation\'s hirelings strike | on: in 2 days | place: Weir road | encounter: 3 bandit, bandit captain (boss)',
        '</plan>',
    ].join('\n'), { calendar, now });
    assert.deepEqual(plan.errors, []);
    const [beat] = plan.items;
    assert.equal(beat.kind, 'beat');
    assert.deepEqual(beat.fields, { desc: 'the legation\'s hirelings strike', on: 'Haywane 14, 05:35 pm', place: 'Weir road', encounter: '3 bandit, bandit captain (boss)' });

    const [, op] = planToOps(plan, { arcId: 'arc-3' });
    assert.equal(op.raw, '+ beat Ambush at the weir — the legation\'s hirelings strike | on: Haywane 14, 05:35 pm | place: Weir road | encounter: 3 bandit, bandit captain (boss) | arc: arc-3');
    const { ops: back } = parseChanges(op.raw);
    assert.equal(back[0].fields.encounter, '3 bandit, bandit captain (boss)');
    const { tracker } = replay([{ message: 0, time: now, text: '', ops: [op] }]);
    assert.equal(tracker.records[0].fields.encounter, '3 bandit, bandit captain (boss)');
    assert.equal(tracker.records[0].arc, 'arc-3');
});

test('an ENCOUNTER line is a beat with its foes, from encounter:, the description or the key', () => {
    const plan = parsePlan([
        '**ENCOUNTER:** Wolves on the ridge — 2 x dire wolf rank D | on: tomorrow at dusk',
        'ENCOUNTER: Kettle Jack\'s stand — he will not go quietly | encounter: Kettle Jack (boss), 2 thug | on: Haywane 16',
        'Encounter 2: 1 river troll (boss) | place: the weir',
    ].join('\n'), { calendar, now });
    assert.deepEqual(plan.errors, []);
    assert.deepEqual(plan.items.map(item => [item.kind, item.key, item.fields.encounter, item.fields.desc]), [
        ['beat', 'Wolves on the ridge', '2 x dire wolf rank D', undefined],
        ['beat', 'Kettle Jack\'s stand', 'Kettle Jack (boss), 2 thug', 'he will not go quietly'],
        ['beat', '1 river troll (boss)', '1 river troll (boss)', undefined],
    ]);
    assert.equal(plan.items[0].fields.on, 'Haywane 13, 07:00 pm');
});

test('the default prompt plans fights sparingly, and stays within 600 words', () => {
    const rule = DEFAULT_PLANNER_PROMPT.split('\n').find(line => line.includes('encounter:'));
    assert.ok(rule, 'a rule for fights');
    assert.match(rule, /BEAT/);
    assert.match(rule, /at most 1 or 2 per arc/);
    assert.match(rule, /named as the story names them/);
    const words = DEFAULT_PLANNER_PROMPT.split(/\s+/).length;
    assert.ok(words <= 600, `${words} words`);
    // The rule's example is itself readable as a fight beat.
    const example = rule.match(/"(\| encounter: [^"]+)"/)[1];
    assert.equal(parsePlan(`BEAT: Ambush ${example}`).items[0].fields.encounter, '3 bandit, bandit captain (boss)');
});

test('summarizeTracker marks a planned fight', () => {
    const { tracker } = replay([{ message: 0, time: now, text: '', ops: parseChanges('+ beat Ambush at the weir — on: Haywane 14 | encounter: 3 bandit').ops }]);
    assert.match(summarizeTracker(tracker), /- Ambush at the weir \(Haywane 14\) · fight: 3 bandit/);
});
