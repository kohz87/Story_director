// NPC initiative (tracker/initiative.js): code picks at most one person present or nearby with an open
// thread before each reply, weighted by the thread's urgency and, when NPC State Delta answers, by trust;
// a cooldown keeps the same person from taking it two replies running; the pick is drawn with the step's
// seed and recorded, so a swipe or a Re-read of the reply shows the same one. No model call.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { part } from '../../../src/v2/tracker/index.js';
import {
    FEATURE, INITIATIVE, cooldownOf, initiativeCandidates, initiativeHook, initiativeLine, initiativeTail, nextPick, pickOf, weightedPick,
} from '../../../src/v2/tracker/initiative.js';
import { makeState, runCommand, story } from './helpers/fake-ctx.js';
import { rng } from '../../vendor/story-block/src/v2/rng.js';

const WORLD = [{ lines: [
    '~ time March 3, 2026, 08:00 am',
    '+ quest Wolf Contract — wolves at the fold | giver: Elula | goal: Kill 3 wolves | reward: 4 silver | due: March 4, 2026',
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
    assert.equal(part.context.tail(view(picked, 6)).lines.filter(entry => entry.startsWith('Initiative:')).join(), line);
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
    assert.equal(part.context.tail(view(state, off)).lines.some(line => line.startsWith('Initiative:')), false);
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
