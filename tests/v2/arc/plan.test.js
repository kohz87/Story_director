// Arc part: the planner's answer read strictly (plan.js readPlan), the prompt, and when to plan by itself.
import test from 'node:test';
import assert from 'node:assert/strict';

import { PRESETS, makeCalendar } from '../../../src/calendar.js';
import {
    DEFAULT_PLANNER_PROMPT, FIGHT_RULE, MAX_ANSWER_CHARS, MAX_ITEMS, NO_FIGHT_RULE, PLAN_CAPS,
    autoPlanReason, flat, noteMark, planText, plannerRequest, readPlan, trackerSummary,
} from '../../../src/v2/arc/plan.js';

const calendar = makeCalendar(PRESETS.gregorian);
const now = calendar.parse('June 3, 1200, 08:00 am', { reference: null }).abs;
const opts = { calendar, now, fights: true, userName: 'Ren' };

const ANSWER = `<think>Let me plan. ARC: not this one</think>
Here is the <plan> you asked for:
<plan>
**ARC:** The Drowned Bell — the harbour's old bell rings again
- BEAT: Bell Rings — the sunken bell tolls | on: in 2 days | place: Harbour | reach: prices go up
2. BEAT: Diver Missing — a diver does not come up | after: Bell Rings
AGENDA: Mira — wants the bell raised | now: buying rope | then: hires divers | on: tomorrow
HOOK: Salvage Rights — who owns what the sea gives | then: the guild seizes it
CLOCK: Storm Season — storms close the harbour | due: in 10 days | shown: sign
SECRET: Bell Curse — cast with a drowned man's ashes
ENCOUNTER: Wreckers at the Quay — 3 wrecker, wrecker boss (boss) | on: in 3 days
</plan>
Hope this helps!`;

test('a planner answer is read: reasoning, prose and decoration aside, relative dates written by code', () => {
    const plan = readPlan(ANSWER, opts);
    assert.deepEqual(plan.arc, { key: 'The Drowned Bell', desc: "the harbour's old bell rings again" });
    assert.deepEqual(plan.items.map(item => [item.kind, item.key]), [
        ['beat', 'Bell Rings'], ['beat', 'Diver Missing'], ['agenda', 'Mira'], ['hook', 'Salvage Rights'],
        ['clock', 'Storm Season'], ['secret', 'Bell Curse'], ['beat', 'Wreckers at the Quay'],
    ]);
    const [rings, diver, mira, , storm, , wreck] = plan.items;
    assert.equal(rings.parts.on, calendar.format(calendar.addDays(now, 2), { era: false }));
    assert.deepEqual(Object.keys(rings.parts), ['on', 'place', 'reach']);
    assert.equal(diver.parts.after, 'Bell Rings');
    assert.equal(mira.parts.on, calendar.format(calendar.addDays(now, 1), { era: false, time: false }));
    assert.equal(storm.parts.shown, 'sign');
    assert.equal(wreck.parts.encounter, '3 wrecker, wrecker boss (boss)', 'an ENCOUNTER is a beat with its foes');
    assert.equal(plan.findings.filter(entry => entry.severity === 'error').length, 0);
    // The text form reads back as the same plan.
    const again = readPlan(planText(plan), opts);
    assert.deepEqual(again.items, plan.items);
    assert.deepEqual(again.arc, plan.arc);
});

test('nothing the planner writes sets an amount: rewards, XP, ranks and unknown parts are left out', () => {
    const plan = readPlan(`ARC: Gold Rush — money everywhere
HOOK: Big Bounty — a bounty | reward: 999999 gold | xp: 5000 | rank: SSS | qty: 40 | then: it lapses
BEAT: Payday — the mint opens | encounter: 500 dragon | difficulty: nightmare | gold: 100`, opts);
    const [hook, beat] = plan.items;
    assert.deepEqual(hook.parts, { then: 'it lapses' });
    assert.deepEqual(beat.parts, { encounter: '500 dragon' }, 'the foes are words for the story; the fight runner sets the numbers');
    assert.ok(plan.findings.some(entry => /reward:, xp:, rank:, qty: left out/.test(entry.text)));
    assert.ok(plan.findings.some(entry => /difficulty:, gold: left out/.test(entry.text)));
});

test('hostile input: markup, control characters, huge text, reserved names, unknown labels, caps', () => {
    const long = 'x'.repeat(5000);
    const lines = [
        'ARC: <script>alert(1)</script>Arc‮ One — <b>bold</b> \u0007 plan',
        `BEAT: ${long} — ${long}`,
        'BEAT: __proto__ — a trap',
        'BEAT: constructor — another',
        'QUEST: Free Money — reward: 1000 gold',
        'NOTE: the planner talking',
        'just prose without a label',
        'BEAT: Ren storms the keep — the hero acts',
        'SECRET: Ren is the heir — a secret about the reader is fine',
        ...Array.from({ length: 12 }, (_, n) => `BEAT: Beat ${n} — one more`),
        ...Array.from({ length: 12 }, (_, n) => `AGENDA: Agent ${n} — busy`),
        'BEAT: Beat 0 — the same again',
        'CLOCK: Doom — soon | due: last year | shown: blinking',
        'CLOCK: Rot — soon | due: the day the moon falls',
    ];
    const plan = readPlan(`<plan>\n${lines.join('\n')}\n</plan>`, opts);
    assert.equal(plan.arc.key, 'scriptalert(1)/scriptArc One', 'no markup and no control characters survive');
    assert.equal(plan.arc.desc, 'bbold/b plan');
    const keys = plan.items.map(item => item.key);
    assert.ok(keys.every(key => [...key].length <= 80));
    assert.ok(plan.items.every(item => [...item.desc].length <= 240));
    assert.ok(!keys.includes('__proto__') && !keys.includes('constructor'));
    assert.ok(!keys.includes('Free Money') && !keys.some(key => /planner|prose/.test(key)), 'unknown labels and prose are not read');
    assert.ok(!keys.includes('Ren storms the keep'), 'a plan for the reader\'s character is left out');
    assert.ok(keys.includes('Ren is the heir'));
    assert.ok(plan.items.filter(item => item.kind === 'beat').length <= PLAN_CAPS.beat);
    assert.ok(plan.items.filter(item => item.kind === 'agenda').length <= PLAN_CAPS.agenda);
    assert.ok(plan.items.length <= MAX_ITEMS);
    assert.equal(new Set(keys).size, keys.length, 'a name twice is kept once');
    for (const item of plan.items) assert.ok(!/[<>\u0000-\u001f‮]/u.test(item.key + item.desc + Object.values(item.parts).join('')));
    const doom = plan.items.find(item => item.key === 'Doom');
    assert.deepEqual(doom.parts, {}, 'a past date and an unknown shown: are left out');
});

test('dates: past and unreadable ones are left out; without a story clock they stay as written', () => {
    const plan = readPlan('ARC: A — b\nCLOCK: Doom — soon | due: May 1, 1100 | shown: blinking\nCLOCK: Rot — soon | due: the day the moon falls\nBEAT: Next Week — later | on: next week', opts);
    const [doom, rot, week] = plan.items;
    assert.deepEqual(doom.parts, {}, 'a past date and an unknown shown: are left out');
    assert.deepEqual(rot.parts, {});
    assert.equal(week.parts.on, calendar.format(calendar.addDays(now, 7), { era: false, time: false }));
    assert.ok(plan.findings.some(entry => /already past/.test(entry.text)));
    const loose = readPlan('ARC: A — b\nBEAT: Soon — x | on: in 2 days', { calendar, now: null });
    assert.equal(loose.items[0].parts.on, 'in 2 days');
});

test('a plan without an ARC line or without items cannot be used; garbage reads as nothing', () => {
    for (const text of ['', 'no plan at all', '<plan></plan>', 'BEAT: Lone — x', 'ARC: Only — an arc', '\u0000'.repeat(100), '<plan>'.repeat(1000)]) {
        const plan = readPlan(text, opts);
        assert.ok(plan.findings.some(entry => entry.severity === 'error'), JSON.stringify(text.slice(0, 20)));
    }
    assert.equal(readPlan('BEAT: Lone — x', { ...opts, lone: true }).findings.filter(entry => entry.severity === 'error').length, 0, 'one item read alone');
    const huge = readPlan(`ARC: A — b\nBEAT: B — c\n${'y'.repeat(MAX_ANSWER_CHARS)}`, opts);
    assert.ok(huge.findings.some(entry => /Only the first/.test(entry.text)));
    assert.equal(readPlan(null, opts).arc, null);
});

test('without a fight runner a planned fight stays a beat without foes; fights are capped', () => {
    const alone = readPlan('ARC: A — b\nENCOUNTER: Ambush — 3 bandit\nBEAT: Raid — x | encounter: 2 wolf', { ...opts, fights: false });
    assert.deepEqual(alone.items.map(item => item.parts), [{}, {}]);
    const three = readPlan('ARC: A — b\nBEAT: F1 — x | encounter: a\nBEAT: F2 — x | encounter: b\nBEAT: F3 — x | encounter: c', opts);
    assert.deepEqual(three.items.map(item => item.parts.encounter ?? null), ['a', 'b', null]);
});

test('the prompt: the reader\'s template or the default, macros filled, fights said only with a fight runner', () => {
    const alone = plannerRequest({ genre: 'cosy mystery', now: 'June 3', tracker: '(nothing tracked yet)', recent: 'You: hi', fights: false });
    assert.match(alone.system, /Genre and tone: cosy mystery/);
    assert.ok(alone.system.includes(NO_FIGHT_RULE) && !alone.system.includes(FIGHT_RULE));
    assert.match(alone.system, /Director's note: \(none\)/);
    assert.ok(alone.system.includes('{{user}}'), '{{user}} stays for Story Block\'s substitute');
    assert.ok(plannerRequest({ fights: true }).system.includes(FIGHT_RULE));
    assert.equal(plannerRequest({ template: 'Plan {{genre}} {{unknown}}', genre: 'noir' }).system, 'Plan noir {{unknown}}');
    assert.equal(plannerRequest({ template: '   ' }).system.startsWith(DEFAULT_PLANNER_PROMPT.slice(0, 40)), true, 'an emptied prompt is the default');
    assert.match(alone.prompt, /Answer only with the <plan> block/);
});

test('the tracker summary and the note mark', () => {
    const text = trackerSummary([
        { kind: 'hook', key: 'Lost Cat', summary: 'the cat is gone', status: 'active', fields: { then: 'it returns' } },
        { kind: 'quest', key: 'Old Job', summary: '', status: 'resolved', fields: {}, ended: { reason: 'done' } },
    ]);
    assert.equal(text, 'Hooks:\n- Lost Cat — the cat is gone → it returns\nResolved:\n- Old Job — done');
    assert.equal(trackerSummary([]), '(nothing tracked yet)');
    assert.equal(noteMark(''), '');
    assert.equal(noteMark(' Make it  grim '), noteMark('Make it grim'));
    assert.notEqual(noteMark('Make it grim'), noteMark('Make it bright'));
    assert.equal(flat('a​b  c', 10), 'a b c');
});

test('when to plan by itself (v1): no arc, arc played out, stalled, running low after five replies', () => {
    const beat = (arc, status = 'active', on = '') => ({ kind: 'beat', status, arc, fields: on ? { on } : {}, offer: false });
    const hook = { kind: 'hook', status: 'active', arc: null, fields: {}, offer: false };
    assert.equal(autoPlanReason({ threads: [] }), null, 'nothing tracked: nothing to plan from');
    assert.equal(autoPlanReason({ threads: [hook] }), 'no-arc');
    assert.equal(autoPlanReason({ threads: [hook], arc: { id: 'arc_a', active: false } }), 'no-arc', 'an ended arc is none');
    assert.equal(autoPlanReason({ threads: [beat('arc_a', 'resolved')], arc: { id: 'arc_a', active: true } }), 'arc-end');
    const far = calendar.format(calendar.addDays(now, 30));
    assert.equal(autoPlanReason({ threads: [beat('arc_a', 'active', far)], arc: { id: 'arc_a', active: true }, now, calendar }), 'stalled');
    assert.equal(autoPlanReason({ threads: [beat('arc_a', 'active', far)], arc: { id: 'arc_a', active: true }, now, calendar, stallDays: 60, lowThreads: 0 }), null);
    const thin = { threads: [beat('arc_a')], arc: { id: 'arc_a', active: true }, now, calendar };
    assert.equal(autoPlanReason({ ...thin, repliesSincePlan: 4 }), null, 'running low waits for the story to move on');
    assert.equal(autoPlanReason({ ...thin, repliesSincePlan: 5 }), 'running-low');
    assert.equal(autoPlanReason({ ...thin, repliesSincePlan: 5, lowThreads: 0 }), null, '0 turns it off');
});
