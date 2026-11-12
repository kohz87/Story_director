// NPC initiative (tracker/initiative.js): code picks at most one person present or nearby with an open
// thread before each reply, weighted by the thread's urgency and, when NPC State Delta answers, by trust;
// a cooldown keeps the same person from taking it two replies running; the pick is drawn with the step's
// seed and recorded, so a swipe or a Re-read of the reply shows the same one. No model call.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { part } from '../../../src/v2/tracker/index.js';
import {
    FEATURE, INITIATIVE, cooldownOf, setPersonaReader, initiativeCandidates, initiativeHook, initiativeLine, initiativeTail, nextPick, pickOf, weightedPick,
} from '../../../src/v2/tracker/initiative.js';
import { makeState, runCommand, story } from './helpers/fake-ctx.js';
import { rng } from '../../vendor/story-block/src/v2/rng.js';

const WORLD = [{ lines: [
    '~ time March 3, 2026, 08:00 am',
    '+ hook Wolf Contract — wolves at the fold | giver: Elula | goal: Kill 3 wolves | reward: 4 silver | due: March 4, 2026',
    '+ agenda Bram — moves salt at night | now: the docks',
    '+ hook Ferry Fee — the toll went up | giver: Orsa',
    '+ secret Elula Debt — Elula owes the smugglers',
].join('\n') }];

function withScene(state, { place = 'Harrow', region = '', present = ['Elula', 'Bram', 'A Passer-by'] } = {}) {
    const next = structuredClone(state);
    next.domains.scene = { place: { name: place, kind: '', region }, present };
    return next;
}

const command = part.commands[INITIATIVE];
// The step as Story Block runs it: its draws from Story Block's own generator for the receipt's seed.
const seeded = seed => (ctx, payload) => command({ ...ctx, rng: rng(seed) }, payload);
const base = () => withScene(story(WORLD, makeState()));
const people = list => list.map(entry => [entry.name, entry.weight, entry.topic]);

// NPC State Delta's queries, as a test stand-in: who it knows, their dossiers and their trust.
function nsd({ trust = {}, location = {} } = {}) {
    const dossiers = { Elula: { name: 'Elula', aliases: [] }, Bram: { name: 'Bram', aliases: ['the salter'] }, Orsa: { name: 'Orsa', aliases: [], location: location.Orsa ?? '' } };
    return {
        'npc.known': () => Object.keys(dossiers),
        'npc.present': () => [],
        'npc.dossier': (_state, { name }) => dossiers[Object.keys(dossiers).find(key => key.toLowerCase() === String(name).toLowerCase())] ?? null,
        'npc.meters': (_state, { name }) => (Object.hasOwn(trust, name) ? { name, meters: { trust: trust[name] } } : null),
    };
}
const queryOf = (queries, state) => (name, args) => {
    if (!queries[name]) throw new Error(`no module answers ${name}`);
    return queries[name](state, args);
};

test('who can take the initiative: present people with an open thread, weighted by urgency (no NSD: even)', () => {
    const state = base();
    const list = initiativeCandidates({ director: state.domains.director, state });
    // Elula's quest is due tomorrow (within the Due soon days): 3; Bram's agenda: 2; a passer-by has no thread.
    assert.deepEqual(people(list), [['Bram', 200, ''], ['Elula', 300, 'Wolf Contract']]);
    // Bram's thread is an agenda (behind the scenes): never named; Elula's quest is one {{user}} took on.
    assert.equal(initiativeLine(list[0]), 'Initiative: Bram may approach {{user}}.');
    assert.equal(initiativeLine(list[1]), 'Initiative: Elula may approach {{user}} about Wolf Contract.');
    assert.equal(initiativeLine(null), '');
    // Due now: the quest's deadline is reached; most urgent, and it interrupts.
    const late = story([{ lines: '! time +2d' }], state);
    const due = initiativeCandidates({ director: late.domains.director, state: late });
    assert.deepEqual(people(due), [['Bram', 200, ''], ['Elula', 400, 'Wolf Contract']]);
    assert.equal(initiativeLine(due[1]), 'Initiative: Elula may interrupt about Wolf Contract.');
    // Nobody present: nobody.
    const empty = withScene(state, { present: [] });
    assert.deepEqual(initiativeCandidates({ director: empty.domains.director, state: empty }), []);
});

test('with NPC State Delta: trust weighs the pick, aliases name people, and someone nearby can step in', () => {
    const state = base();
    const queries = nsd({ trust: { Elula: 100, Bram: -100 }, location: { Orsa: 'Harrow, the ferry stairs' } });
    const list = initiativeCandidates({ director: state.domains.director, state, query: queryOf(queries, state) });
    // Elula ×2 (trust +100), Bram ×0.25 (trust -100), Orsa nearby (her dossier says Harrow), no meters: ×1.
    assert.deepEqual(people(list), [['Bram', 50, ''], ['Elula', 600, 'Wolf Contract'], ['Orsa', 200, 'Ferry Fee']]);
    assert.equal(list.find(entry => entry.name === 'Orsa').nearby, true);
    // Orsa elsewhere: not nearby.
    const far = nsd({ location: { Orsa: 'Kesh' } });
    assert.deepEqual(people(initiativeCandidates({ director: state.domains.director, state, query: queryOf(far, state) })).map(([name]) => name), ['Bram', 'Elula']);
});

test("the player's persona never takes the initiative; an NPC with a thread still does", () => {
    const world = [{ lines: [
        '~ time March 3, 2026, 08:00 am',
        '+ hook Astra Debt — what Astra owes | giver: Astra | people: Astra',
        '+ quest Lost Ring — find it | giver: astra',
        '+ hook Wolf Contract — wolves at the fold | giver: Elula',
    ].join('\n') }];
    const state = withScene(story(world, makeState()), { present: ['Astra', 'Elula'] });
    const director = state.domains.director;
    // Without a persona told, the old reading: Astra is a candidate.
    assert.deepEqual(initiativeCandidates({ director, state }).map(entry => entry.name), ['Astra', 'Elula']);
    // Told directly (any case): only the NPC.
    for (const persona of ['Astra', 'ASTRA ']) {
        const list = initiativeCandidates({ director, state, persona });
        assert.deepEqual(list.map(entry => entry.name), ['Elula']);
        assert.ok(!initiativeLine(list[0]).includes('Astra'));
    }
    // Through the host's reader (index.js: sdk.substitute('{{user}}')), by the tail too.
    setPersonaReader(() => 'Astra');
    try {
        assert.deepEqual(initiativeCandidates({ director, state }).map(entry => entry.name), ['Elula']);
        const line = initiativeTail({ state, chat: { length: 3 }, settings: {}, feature: () => true });
        assert.ok(line === '' || !line.includes('Astra'));
        assert.match(line, /Elula/);
    } finally { setPersonaReader(null); }
});

test('the weighted pick: by key order, in proportion to the weights, the same draw the same person', () => {
    const list = [{ key: 'a', weight: 100 }, { key: 'b', weight: 300 }];
    const counts = { a: 0, b: 0 };
    for (let i = 0; i < 1000; i += 1) counts[weightedPick(list, i / 1000).key] += 1;
    assert.deepEqual(counts, { a: 250, b: 750 });
    assert.equal(weightedPick(list, 0.2499).key, 'a');
    assert.equal(weightedPick(list, 0.25).key, 'b');
    assert.equal(weightedPick(list, 0.99999).key, 'b');
    assert.equal(weightedPick([], 0.5), null);
});

test('the pick is a system step drawn with its seed: the same seed, the same pick; a click is refused', () => {
    const state = base();
    const one = runCommand(state, command, { at: 5 }, { seed: 42 });
    const two = runCommand(state, command, { at: 5 }, { seed: 42 });
    assert.equal(one.ok, true, one.message);
    assert.deepEqual(one.state.domains.director.initiative, two.state.domains.director.initiative);
    const pick = pickOf(one.state.domains.director);
    assert.equal(pick.round, 1);
    assert.equal(pick.at, 5);
    assert.ok(['bram', 'elula'].includes(pick.key));
    assert.equal(one.result.narrate, false);
    // Over many seeds both can be picked, Elula more often (300 against 200).
    const tally = { bram: 0, elula: 0 };
    for (let seed = 1; seed <= 200; seed += 1) tally[pickOf(runCommand(state, seeded(seed), { at: 5 }).state.domains.director).key] += 1;
    assert.ok(tally.bram > 0 && tally.elula > tally.bram, JSON.stringify(tally));
    const ui = runCommand(state, (ctx, payload) => command({ ...ctx, cause: 'ui' }, payload), { at: 5 });
    assert.equal(ui.code, 'REFUSED');
    assert.equal(runCommand(state, command, { at: -1 }).code, 'INVALID');
});

test('cooldown: never the same person two replies running; a longer cooldown waits longer', () => {
    // One candidate: Elula alone.
    const alone = withScene(story(WORLD, makeState()), { present: ['Elula'] });
    const rounds = (state, settings, n) => {
        const keys = [];
        for (let i = 0; i < n; i += 1) {
            const run = runCommand(state, command, { at: 3 + 2 * i }, { seed: 9 + i, settings });
            assert.equal(run.ok, true, run.message);
            state = run.state;
            keys.push(pickOf(state.domains.director).key);
        }
        return keys;
    };
    assert.deepEqual(rounds(alone, {}, 6), ['elula', null, 'elula', null, 'elula', null]);
    assert.deepEqual(rounds(alone, { initiativeCooldown: 3 }, 7), ['elula', null, null, 'elula', null, null, 'elula']);
    assert.equal(cooldownOf({ initiativeCooldown: 1 }), 2, 'never below 2: never two replies running');
    assert.equal(cooldownOf({ initiativeCooldown: 99 }), 20);
    // Two candidates: whatever the seeds, no one twice running.
    let state = base();
    let last = null;
    for (let i = 0; i < 30; i += 1) {
        state = runCommand(state, seeded(1000 + i * 7), { at: 3 + 2 * i }).state;
        const key = pickOf(state.domains.director).key;
        assert.notEqual(key, last, `round ${i + 1}`);
        last = key;
    }
    // nextPick keeps only those still cooling (and the chosen) in `recent`.
    const next = nextPick([{ key: 'a', weight: 1 }, { key: 'b', weight: 1 }], { pick: { round: 4, recent: [{ key: 'a', round: 4 }, { key: 'b', round: 1 }] }, draw: 0 });
    assert.deepEqual([next.round, next.chosen.key, next.recent], [5, 'b', [{ key: 'a', round: 4 }, { key: 'b', round: 5 }]]);
});

test('the hook asks for one pick per reply; a swipe, regenerate or Continue of it shows the same line', () => {
    const state = base();
    const view = (s, length, extra = {}) => ({ state: s, settings: {}, chat: { length, lastUser: '' }, ...extra });
    assert.deepEqual(initiativeHook(view(state, 5)), { commands: [{ type: INITIATIVE, payload: { at: 5 } }] });
    const picked = runCommand(state, command, { at: 5 }, { seed: 3 }).state;
    const line = initiativeTail(view(picked, 5));
    assert.match(line, /^Initiative: (Elula|Bram) may approach \{\{user\}\}/);
    // The chat holds the reply being swiped (length 6) or not yet (5): the pick is this reply's.
    assert.equal(initiativeHook(view(picked, 5)), undefined);
    assert.equal(initiativeHook(view(picked, 6)), undefined);
    assert.equal(initiativeTail(view(picked, 6)), line);
    // The line is a kept tail line (Story Block pins `{ text, keep: true }` under a tight budget).
    assert.deepEqual(part.context.tail(view(picked, 6)).lines.filter(entry => entry.text?.startsWith('Initiative:')), [{ text: line, keep: true }]);
    // The next reply: a new pick.
    assert.deepEqual(initiativeHook(view(picked, 7)), { commands: [{ type: INITIATIVE, payload: { at: 7 } }] });
    // Without the hook (a host that runs none) the tail picks from the state alone: the same state, the same line.
    assert.equal(initiativeTail(view(state, 5)), initiativeTail(view(state, 5)));
    assert.match(initiativeTail(view(state, 5)), /^Initiative: /);
    // The picked person left the scene: no line.
    assert.equal(initiativeTail(view(withScene(picked, { present: [] }), 5)), '');
});

test('off (the feature): no step, no line; nothing to pick: no step', () => {
    const state = base();
    const off = { feature: id => id !== FEATURE };
    const view = (s, extra = {}) => ({ state: s, settings: {}, chat: { length: 5, lastUser: '' }, ...extra });
    assert.equal(initiativeHook(view(state, off)), undefined);
    assert.equal(initiativeTail(view(state, off)), '');
    assert.equal(part.context.tail(view(state, off)).lines.some(line => (line.text ?? line).startsWith('Initiative:')), false);
    // An older host without features: on.
    assert.ok(initiativeHook(view(state)));
    const nobody = withScene(state, { present: ['A Passer-by'] });
    assert.equal(initiativeHook(view(nobody)), undefined);
    assert.equal(initiativeTail(view(nobody)), '');
});

test('the validator takes the slot and refuses a malformed one', () => {
    const state = runCommand(base(), command, { at: 5 }, { seed: 3 }).state;
    assert.deepEqual(part.domains.director.validate(state.domains.director), []);
    assert.deepEqual(part.domains.director.validate({ ...state.domains.director, initiative: [{ round: 'x' }] }), ['director.initiative must be null or [{ at, round, key, name, recent }].']);
    assert.deepEqual(part.domains.director.validate({ ...state.domains.director, initiative: null }), []);
});

// ---- World pulse (pulse/effects.js): the same shape as the initiative: a seeded step before the reply, a slot, one tail line ----

import { PULSE, QUIET, agendaProgress, modeOf, part as pulsePart, pulseCommand, pulseHook, quietCommand, resultsOf, shiftEntry, weatherFrom, worldLine } from '../../../src/v2/pulse/effects.js';
import { rumor } from '../../../src/v2/chronicle/capture/world.js';
import { QUIET_FALLBACK, TABLES, d20Of, resolveKind, tableFor } from '../../../src/v2/pulse/tables.js';

const seededPulse = seed => (ctx, payload) => pulseCommand({ ...ctx, rng: rng(seed) }, payload);
const pulseAt = (state, seed, { at = 5, settings = {}, call = null, queries = {} } = {}) => runCommand(state, seededPulse(seed), { at }, { settings, call, queries });
const clocked = () => withScene(story(WORLD, makeState()), { present: ['Elula', 'Bram'] });

test('pulse: the roll is a system step drawn with its seed: same seed same result, a click is refused, a swipe (new seed) rolls again', () => {
    const state = clocked();
    const one = pulseAt(state, 42);
    const two = pulseAt(state, 42);
    assert.equal(one.ok, true, one.message);
    assert.deepEqual(one.state.domains.director.pulse, two.state.domains.director.pulse);
    const [entry] = resultsOf(one.state.domains.director);
    assert.equal(entry.at, 5);
    assert.ok(entry.d20 >= 1 && entry.d20 <= 20 && ['std', 'duo'].includes(entry.table));
    assert.deepEqual(part.domains.director.validate(one.state.domains.director), []);
    const seen = new Set();
    for (let seed = 1; seed <= 60; seed += 1) seen.add(resultsOf(pulseAt(state, seed).state.domains.director)[0].d20);
    assert.ok(seen.size > 8, `fresh rolls per seed: ${seen.size} different d20s`);
    assert.equal(runCommand(state, (ctx, payload) => pulseCommand({ ...ctx, cause: 'ui' }, payload), { at: 5 }).code, 'REFUSED');
    assert.equal(runCommand(state, pulseCommand, { at: -1 }).code, 'INVALID');
    assert.equal(d20Of(0), 1);
    assert.equal(d20Of(0.999999), 20);
});

test('pulse: only the last 6 results are kept; a result for the same reply (a redo) replaces its own', () => {
    let state = clocked();
    for (let at = 1; at <= 8; at += 1) state = pulseAt(state, at, { at }).state;
    assert.deepEqual(resultsOf(state.domains.director).map(entry => entry.at), [3, 4, 5, 6, 7, 8]);
    state = pulseAt(state, 99, { at: 8 }).state;
    assert.deepEqual(resultsOf(state.domains.director).map(entry => entry.at), [3, 4, 5, 6, 7, 8]);
    assert.equal(part.domains.director.validate({ ...state.domains.director, pulse: [{ results: [...resultsOf(state.domains.director), ...resultsOf(state.domains.director)] }] }).length, 1);
    assert.equal(part.domains.director.validate({ ...state.domains.director, pulse: [{ results: [{ at: 'x' }] }] }).length, 1);
    assert.equal(part.domains.director.validate({ ...state.domains.director, pulse: null }).length, 0);
});

test('pulse: skipped (and the reason recorded) in a fight, in a quiet scene, with no clock, after a rest and after a 6-hour jump; mode off does nothing', () => {
    const state = clocked();
    const reason = result => resultsOf(result.state.domains.director).at(-1).skipped;
    assert.equal(reason(pulseAt(state, 3, { queries: { 'combat.session': () => ({ status: 'active' }) } })), 'fight');
    const quiet = runCommand(state, quietCommand, { on: true }).state;
    assert.equal(reason(pulseAt(quiet, 3)), 'quiet');
    assert.equal(runCommand(state, quietCommand, { on: 'yes' }).code, 'INVALID');
    assert.deepEqual(part.domains.director.validate(quiet.domains.director), []);
    const noClock = makeState();
    assert.equal(reason(pulseAt(noClock, 3)), 'clock');
    // After a roll, a jump of 6+ hours: skipped; a smaller one rolls.
    const first = pulseAt(state, 3, { at: 5 }).state;
    const later = hours => { const next = structuredClone(first); next.domains.director.time.minutes += hours * 60; return next; };
    assert.equal(reason(pulseAt(later(6), 3, { at: 7 })), 'jump');
    assert.equal(reason(pulseAt(later(5), 3, { at: 7 })), undefined);
    const rested = later(1);
    rested.domains.dataModules = { instances: { a: { chat: { fields: { 'rested-at': rested.domains.director.time.minutes } } } } };
    assert.equal(reason(pulseAt(rested, 3, { at: 7 })), 'rest');
    rested.domains.dataModules = { instances: { a: { chat: { fields: {} }, characters: { ann: { fields: { 'rested-at': rested.domains.director.time.minutes } } } } } };
    assert.equal(reason(pulseAt(rested, 3, { at: 7 })), 'rest', 'a character module\'s rest counts too');
    const off = pulseAt(state, 3, { settings: { mode: 'off' } });
    assert.equal(off.state.domains.director.pulse, null);
    assert.equal(modeOf({ mode: 'x' }), 'lively');
});

test('pulse: the hook asks for one step per reply written; a swipe is one below the chat length; a Continue, off and mode off ask for none', () => {
    const state = clocked();
    const view = (extra = {}) => ({ state, settings: {}, chat: { length: 5, lastUser: '' }, ...extra });
    assert.deepEqual(pulseHook(view()), { commands: [{ type: PULSE, payload: { at: 5, age: 1 } }] });
    assert.deepEqual(pulseHook(view({ chat: { length: 6 } }), { type: 'swipe' }), { commands: [{ type: PULSE, payload: { at: 5, age: 1 } }] });
    assert.ok(pulseHook(view(), { type: 'regenerate' }));
    assert.equal(pulseHook(view(), { type: 'continue', commit: false }), undefined);
    assert.equal(pulseHook(view({ feature: id => id !== 'story-director.pulse' })), undefined);
    assert.equal(pulseHook(view({ settings: { mode: 'off' } })), undefined);
    // The swipe does not stop at "the pick is made": it asks again (a fresh roll), unlike the initiative.
    const rolled = pulseAt(state, 3).state;
    assert.ok(pulseHook({ ...view({ chat: { length: 6 } }), state: rolled }, { type: 'swipe' }));
    assert.equal(pulsePart.hooks.beforeGenerate, pulseHook);
    assert.equal(pulsePart.commands[PULSE].feature, 'story-director.pulse');
    assert.equal(pulsePart.commands[PULSE].prelude, true, 'a prelude: stored on the reply, so the reply takes it back');
    assert.equal(pulsePart.context.tail, undefined);
    assert.equal(pulsePart.commands[QUIET].feature, 'story-director.pulse');
});

test('pulse: the line is the step\'s cue (narrated only when there is a line), plain, under 40 tokens, cut at a word; none on CALM or a skip', () => {
    const state = clocked();
    let shown = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
        const result = pulseAt(state, seed);
        const [entry] = resultsOf(result.state.domains.director);
        if (entry.kind === 'CALM' || !entry.text) assert.deepEqual([result.result.narrate, result.result.summary], [false, '']);
        else {
            shown += 1;
            assert.equal(result.result.narrate, true);
            assert.match(result.result.summary, /^World this reply: /);
            assert.ok(Math.ceil(result.result.summary.length / 4) <= 40);
            assert.doesNotMatch(result.result.summary, /[{}<>]/);
        }
    }
    assert.ok(shown > 5);
    assert.equal(pulseAt(runCommand(state, quietCommand, { on: true }).state, 5).result.narrate, false);
    const long = worldLine(`Snatches of talk ${'in the lower town about the grain tax '.repeat(6)}`);
    assert.ok(Math.ceil(long.length / 4) <= 40 && !/\s$/.test(long) && /\w$/.test(long) && long.endsWith("grain"), long);
});

test('pulse: quiet mode makes flavour only; lively with real people and news can write a rumour, a meeting or an agenda change', () => {
    const base = withScene(story([{ lines: [WORLD[0].lines, '+ agenda Courier — rides in | now: far north | then: reaches the gate | on: March 3, 2026, 06:00 pm'].join('\n') }], makeState()), { present: ['Elula', 'Bram', 'Orsa'] });
    const cast = { people: { ann: { name: 'Ann', alive: true, met: null, where: 'Elsewhere' } } };
    const calls = [];
    const queries = { 'chronicle.events': () => [{ id: 'ev_1', name: 'Wolf Plague', summary: 'wolves in the fold', state: 'ongoing', place: 'Harrow', factions: [] }], 'atlas.here': () => ({ name: 'Harrow', placeKind: 'town' }) };
    const call = (type, payload) => { calls.push(type); return {}; };
    const kinds = new Set();
    for (let seed = 1; seed <= 150; seed += 1) {
        const state = { ...base, domains: { ...base.domains, cast } };
        const result = runCommand(state, seededPulse(seed), { at: 5 }, { call, queries, owned: ['director'] });
        assert.equal(result.ok, true, result.message);
        const [entry] = resultsOf(result.state.domains.director);
        kinds.add(entry.kind);
        const quietRun = runCommand(state, seededPulse(seed), { at: 5 }, { settings: { mode: 'quiet' }, call: () => assert.fail('quiet mode writes no effect'), queries });
        assert.equal(resultsOf(quietRun.state.domains.director)[0].effect, undefined);
        if (entry.kind === 'TASK_SHIFT' || entry.kind === 'ENTER_CHECK') {
            const fields = Object.values(result.state.domains.director.threads).find(thread => thread.key === 'Courier').fields;
            assert.ok(entry.kind === 'ENTER_CHECK' ? fields.arrive : fields.on !== 'March 3, 2026, 06:00 pm', JSON.stringify(fields));
            assert.deepEqual(part.domains.director.validate(result.state.domains.director), []);
        }
    }
    for (const type of ['chronicle.rumor', 'cast.meet']) assert.ok(calls.includes(type), `${type} was called`);
    assert.ok(kinds.has('TASK_SHIFT') || kinds.has('ENTER_CHECK'), [...kinds].join());
});

test('pulse: chronicle.rumor writes a looming event once, refused from a click, waits for the clock', () => {
    const chronicle = { events: {}, factions: {}, seen: [], seenAt: {}, round: 0, surfaced: null, days: {}, written: null, dayFacts: {}, noted: null, questLog: {} };
    const payload = { at: 5, event: { name: 'Rumour of Plague', summary: 'coughing', place: 'Harrow', factions: [] } };
    const run = (extra = {}, body = payload) => {
        const draft = structuredClone(chronicle);
        const ctx = { cause: 'system', rev: 3, rng: () => 0.5, id: prefix => `${prefix}_abcdefgh`, time: () => 100, draft: () => draft, query: () => 100, fail: (code, message) => { throw Object.assign(new Error(message), { code }); }, ...extra };
        try { return { out: rumor(ctx, body), draft }; } catch (error) { return { code: error.code }; }
    };
    const made = run();
    assert.equal(Object.values(made.draft.events)[0].state, 'looming');
    assert.equal(Object.values(made.draft.events)[0].name, 'Rumour of Plague');
    assert.equal(run({ cause: 'ui' }).code, 'REFUSED');
    assert.equal(run({}, { at: 5, event: { name: '' } }).code, 'INVALID');
    assert.equal(run({ time: () => null, query: () => null }).code, 'NOT_YET');
});

test('pulse: agenda progress: stepAt, stepOf and stepSince follow now/then and never touch the narrator\'s `step`; where is the atlas place; old agendas are valid', () => {
    assert.deepEqual(agendaProgress(null, { now: 'the docks', then: 'sells; hides; leaves' }, { minutes: 90 }), { stepAt: '1', stepOf: '4', stepSince: '90' });
    assert.deepEqual(agendaProgress({ now: 'the docks', then: 'a', stepAt: '1', stepOf: '2' }, { now: 'the market', then: 'b', stepAt: '1', stepOf: '2' }, { minutes: 200, where: 'Market' }), { stepAt: '2', stepSince: '200', where: 'Market' });
    assert.equal(agendaProgress({ now: 'a', then: 'b' }, { now: 'a', then: 'b' }, { minutes: 5 }), null);
    const text = agendaProgress({ now: 'a', then: 'b', step: 'sneaks in' }, { now: 'c', then: 'b', step: 'sneaks in' }, {});
    assert.equal(text?.step, undefined, 'a text `step` is left alone');
    assert.equal(weatherFrom('soft rain, mild'), 'rain');
    assert.equal(weatherFrom('clear'), null);
});

test('pulse: TASK_SHIFT never moves `on` into the past; ENTER_CHECK only takes agendas that can converge and sets no place', () => {
    const format = minutes => `m${minutes}`;
    const agendas = [{ id: 'a', name: 'Courier', named: false, text: 'x', abs: 1000 }];
    for (let line = 0; line < 1; line += 0.05) {
        const made = shiftEntry({ agendas, at: 5, now: 990, format, draw: { actor: 0, line } });
        if (made) assert.ok(made.receipt.to >= 990 + 20, `${line} -> ${made.receipt.to}`);
    }
    assert.equal(shiftEntry({ agendas, at: 5, now: 2000, format, draw: { actor: 0, line: 0.1 } }), null, 'already overdue: no earlier date');
    assert.equal(shiftEntry({ agendas, at: 5, now: 2000, format, draw: { actor: 0, line: 0.9 } }).receipt.to, 1000 + 60 * (1 + Math.floor(((0.9 * 2) % 1) * 4)));
    const state = withScene(story([{ lines: [WORLD[0].lines, '+ agenda Courier — rides in | now: far north | then: reaches the gate'].join('\n') }], makeState()), { present: ['Elula', 'Bram', 'Orsa'] });
    const queries = { 'atlas.here': () => ({ name: 'Harrow', placeKind: 'town', region: 'Vale' }), 'atlas.place': ({ name }) => ({ name, region: 'Coast' }) };
    for (let seed = 1; seed <= 150; seed += 1) {
        const threads = Object.values(pulseAt(state, seed, { queries, call: () => ({}) }).state.domains.director.threads);
        assert.ok(threads.every(thread => !thread.fields.arrive && !thread.fields.where), 'a far agenda is not picked, and nobody gets a place');
    }
});

test('pulse: rumours never use pulse rumours or hidden names as facts, and leave room: a near-full chronicle gets none', () => {
    const state = withScene(story([{ lines: [WORLD[0].lines, '+ agenda Courier — rides in | now: far north'].join('\n') }], makeState()), { present: ['Elula', 'Bram', 'Orsa'] });
    const event = (id, name, extra = {}) => ({ id, name, summary: `${name} news`, state: 'ongoing', place: 'Harrow', factions: [], ...extra });
    const run = (events, seed) => {
        const types = [];
        pulseAt(state, seed, { queries: { 'chronicle.events': () => events, 'atlas.here': () => ({ name: 'Harrow', placeKind: 'town' }) }, call: (type, payload) => { types.push([type, payload]); return {}; } });
        return types.filter(([type, payload]) => type === 'chronicle.rumor' && payload.event);
    };
    const used = new Set();
    for (let seed = 1; seed <= 200; seed += 1) {
        for (const [, payload] of run([event('ev_1', 'Courier'), event('ev_2', 'Rumour of Wolves', { rumour: 'Wolves' }), event('ev_3', 'Wolf Plague')], seed)) if (payload.event) used.add(payload.event.name);
        const full = Array.from({ length: 54 }, (_, n) => event(`ev_${n}`, `Fact ${n}`));
        assert.deepEqual(run(full, seed), [], 'a near-full chronicle: the pulse writes no rumour');
    }
    assert.deepEqual([...used], ['Rumour of Wolf Plague'], 'not about a hidden agenda name, nor a rumour');
});

const PRESET = {
    std: [[1, 2, 'CALM'], [3, 4, 'ENTER_CHECK'], [5, 6, 'BACKGROUND_INCIDENT'], [7, 8, 'MOOD_SWING'], [9, 10, 'GOSSIP_SURGE'], [11, 12, 'CHANCE_MEETING'], [13, 14, 'OVERHEARD_DETAIL'], [15, 16, 'TASK_SHIFT'], [17, 18, 'MUNDANE_INTERRUPTION'], [19, 20, 'CALM']],
    duo: [[1, 2, 'CALM'], [3, 4, 'ENV_SHIFT'], [5, 6, 'MOOD_SWING'], [7, 8, 'PHYSICAL_REACTION'], [9, 10, 'MEMORY_TRIGGER'], [11, 12, 'OBJECT_DISCOVERY'], [13, 14, 'OUTSIDE_INTRUSION'], [15, 16, 'POWER_SHIFT'], [17, 18, 'MUNDANE_INTERRUPTION'], [19, 20, 'CALM']],
};

test('pulse: both tables carry exactly the preset d20 ranges, every d20 resolves to its row, and the table choice follows the counts', () => {
    for (const id of ['std', 'duo']) {
        assert.deepEqual(TABLES[id].rows.map(item => [item.from, item.to, item.kind]), PRESET[id]);
        const context = { group: 'town', weather: 'rain', counts: { present: 1, offscreen: 1, known: 1, cast: 1 } };
        for (const [from, to, kind] of PRESET[id]) for (let roll = from; roll <= to; roll += 1) assert.equal(resolveKind(id, roll, context).kind, kind, `${id} ${roll}`);
    }
    assert.equal(tableFor({ named: 3, offscreen: 1 }), 'std');
    assert.equal(tableFor({ named: 2, offscreen: 5 }), 'duo');
    assert.equal(tableFor({ named: 6, offscreen: 0 }), 'duo');
});

test('pulse: in quiet mode an effect entry reads as its flavour fallback and keeps its band', () => {
    assert.deepEqual(Object.keys(QUIET_FALLBACK).sort(), ['CHANCE_MEETING', 'ENTER_CHECK', 'GOSSIP_SURGE', 'OVERHEARD_DETAIL', 'TASK_SHIFT']);
    const state = clocked();
    for (let seed = 1; seed <= 60; seed += 1) {
        const entry = resultsOf(pulseAt(state, seed, { settings: { mode: 'quiet' } }).state.domains.director)[0];
        assert.ok(!Object.keys(QUIET_FALLBACK).includes(entry.kind), `${seed} ${entry.kind}`);
        assert.equal(entry.effect, undefined);
        const band = PRESET[entry.table].find(([from, to]) => entry.d20 >= from && entry.d20 <= to)[2];
        // (Duo's ENV_SHIFT may step down when the scene has no weather line; the effect bands' fallbacks always have lines.)
        if (QUIET_FALLBACK[band]) assert.equal(entry.kind, QUIET_FALLBACK[band], `${seed} d20 ${entry.d20}`);
        else if (entry.table === 'std') assert.equal(entry.kind, band, `${seed} d20 ${entry.d20}`);
    }
});
