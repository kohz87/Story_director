// The Director note shows first what can happen now (tracker/scene.js): threads tied to the place or
// region or to someone present, items due soon, beats whose reach is met; then at most N other threads
// {{user}} knows of, by name only ("Elsewhere"), while the budget has room. Nothing behind the scenes or
// made by the arc planner is named elsewhere; the static part stays the same bytes.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { estimateTokens } from '../../../src/relevance.js';
import { part } from '../../../src/v2/tracker/index.js';
import { STATIC_TEXT, TAIL_BUDGET, directorTail } from '../../../src/v2/tracker/note.js';
import { DEFAULT_ELSEWHERE, elsewhereCap, sceneOf, splitByScene } from '../../../src/v2/tracker/scene.js';
import { makeState, story } from './helpers/fake-ctx.js';

const START = '~ time March 3, 2026, 08:00 am';
const WORLD = [
    { lines: [START,
        '+ quest Wolf Contract — wolves at the fold | giver: Elula | goal: Kill 3 wolves | reward: 4 silver',
        '+ hook Old Mill — the wheel creaks | now: Harrow, by the river',
        '+ event Salt Fair — traders gather | now: Vale market',
        '+ hook Dawn Ferry — the ferry leaves early | on: March 4, 2026, 06:00 am',
        '+ beat Storm — a gale off the sea | on: March 20, 2026, 09:00 pm | reach: Elula loses her boat',
        '+ beat Bell Tolls — the bell rings for the drowned | on: March 21, 2026, 09:00 am | after: Storm',
        '+ agenda Smuggler Bram — moves salt | now: the docks of Kesh',
        '+ clock Flood — the levee breaks | due: March 30, 2026',
        '+ secret The Heir — Ren is the lost heir',
    ].join('\n') },
    { lines: [
        '+ hook Herb run — moonleaf for the healer | giver: Mother Ysolde',
        '+ hook Lost Ring — a ring in the well | giver: Old Tam',
        '+ hook Grain Tax — the reeve wants more | giver: Reeve Hollis',
        '+ quest Far Bounty — a bandit in the hills | giver: Warden Hale | goal: Bring him in | reward: 9 silver | due: March 25, 2026',
    ].join('\n') },
];

/** A state with the scene set: place, region and who is present. */
function withScene(state, { place = '', region = '', present = [] } = {}) {
    const next = structuredClone(state);
    next.domains.scene = { place: { name: place, kind: '', region }, present };
    return next;
}

const view = (state, settings = {}, extra = {}) => ({ state, settings, chat: { length: 9, lastUser: '' }, ...extra });
const tailOf = (state, settings = {}, extra = {}) => part.context.tail(view(state, settings, extra)).lines;
const lineOf = (lines, label) => lines.find(line => line.startsWith(`${label}:`) || line.startsWith(label)) ?? '';
const BEHIND = ['Smuggler Bram', 'Storm', 'Bell Tolls', 'Flood', 'Ren is the lost heir'];

test('the kind lines keep what fits the scene: place, region, people present, due soon, beats whose reach is met', () => {
    const state = withScene(story(WORLD, makeState()), { place: 'Harrow', region: 'Vale', present: ['Elula'] });
    const lines = tailOf(state, {}, { feature: () => false });
    const all = lines.join('\n');
    // Elula is present: her quest; the beat whose reach names her.
    assert.match(lineOf(lines, 'Quests'), /^Quests: Wolf Contract — Kill 3 wolves · for Elula · 4 silver$/);
    assert.match(lineOf(lines, 'Beats'), /Storm/);
    // The beat that waits on an open beat cannot happen now: not told at all.
    assert.doesNotMatch(all, /Bell Tolls/);
    // The place (Harrow), the region (Vale), due within the Due soon days (tomorrow).
    assert.match(lineOf(lines, 'Hooks'), /Old Mill/);
    assert.match(lineOf(lines, 'Hooks'), /Dawn Ferry/);
    assert.match(lineOf(lines, 'World'), /Salt Fair/);
    // Not here: the agenda at Kesh and the far clock are behind the scenes and elsewhere, so not told.
    assert.doesNotMatch(all, /Smuggler Bram|Flood/);
    // The rest {{user}} knows of: two names, no more (the default).
    const elsewhere = lineOf(lines, 'Elsewhere');
    assert.match(elsewhere, /^Elsewhere, not in this scene: /);
    assert.equal(elsewhere.split(' · ').length, DEFAULT_ELSEWHERE);
    for (const name of ['Herb run', 'Lost Ring', 'Grain Tax', 'Far Bounty']) assert.doesNotMatch(lineOf(lines, 'Hooks') + lineOf(lines, 'Quests'), new RegExp(name));
    // The Elsewhere line comes after the kind lines, before Do not reveal.
    assert.ok(lines.indexOf(elsewhere) > lines.indexOf(lineOf(lines, 'Beats')));
    assert.ok(lines.indexOf(elsewhere) < lines.indexOf('Do not reveal: The Heir'));
});

test('the Elsewhere cap is a setting: 0 names none, a larger one names every known thread elsewhere, never more', () => {
    const state = withScene(story(WORLD, makeState()), { place: 'Harrow', region: 'Vale', present: ['Elula'] });
    const off = { feature: () => false };
    assert.equal(lineOf(tailOf(state, { elsewhere: 0 }, off), 'Elsewhere'), '');
    const one = lineOf(tailOf(state, { elsewhere: 1 }, off), 'Elsewhere');
    assert.equal(one.split(' · ').length, 1);
    const many = lineOf(tailOf(state, { elsewhere: 10 }, off), 'Elsewhere');
    assert.deepEqual(many.replace('Elsewhere, not in this scene: ', '').split(' · ').sort(),
        ['Far Bounty (quest)', 'Grain Tax (hook)', 'Herb run (hook)', 'Lost Ring (hook)']);
    assert.equal(elsewhereCap({}), 2);
    assert.equal(elsewhereCap({ elsewhere: 99 }), 10);
    assert.equal(elsewhereCap({ elsewhere: -1 }), 2);
    // The same state gives the same note (no clock, no randomness).
    assert.deepEqual(tailOf(state, { elsewhere: 10 }, off), tailOf(state, { elsewhere: 10 }, off));
});

test('known only: nothing behind the scenes or planned by the arc is named elsewhere', () => {
    let state = withScene(story(WORLD, makeState()), { place: 'Harrow', region: 'Vale', present: ['Elula'] });
    // A hook the arc planner made (track.arc): its words are the planner's, never named elsewhere.
    const planned = Object.values(state.domains.director.threads).find(thread => thread.key === 'Lost Ring');
    state.domains.director.threads[planned.id].track.arc = 'arc_00000001';
    const lines = tailOf(state, { elsewhere: 10 }, { feature: () => false });
    const elsewhere = lineOf(lines, 'Elsewhere');
    assert.doesNotMatch(elsewhere, /Lost Ring/);
    for (const name of BEHIND) assert.doesNotMatch(elsewhere, new RegExp(name));
    assert.match(elsewhere, /Herb run/);
    // A secret is still guarded by name only.
    assert.ok(lines.includes('Do not reveal: The Heir'));
    assert.doesNotMatch(lines.join('\n'), /lost heir/);
    state = withScene(state, { place: 'Kesh', region: '', present: [] });
    // At Kesh the agenda there fits the scene (the narrator needs it) and the rest is elsewhere.
    const kesh = tailOf(state, { elsewhere: 10 }, { feature: () => false });
    assert.match(lineOf(kesh, 'Off-screen'), /Smuggler Bram/);
    assert.doesNotMatch(lineOf(kesh, 'Elsewhere'), /Storm|Bell Tolls|Flood|Smuggler/);
});

test('a beat whose prerequisite ended fits; people go by their NPC State Delta names and aliases', () => {
    let state = story([...WORLD, { lines: '- beat Storm — it blew over' }], makeState());
    state = withScene(state, { place: 'Nowhere Inn', region: '', present: ['the ferrywoman'] });
    const queries = {
        'npc.known': () => ['Elula'],
        'npc.dossier': ({ name }) => (/ferrywoman|elula/i.test(name) ? { name: 'Elula', aliases: ['the ferrywoman'] } : null),
    };
    const query = (name, args) => { if (!queries[name]) throw new Error(`no module answers ${name}`); return queries[name](args); };
    const lines = tailOf(state, {}, { query, feature: () => false });
    assert.match(lineOf(lines, 'Beats'), /Bell Tolls/, 'its after: beat has ended');
    assert.match(lineOf(lines, 'Quests'), /Wolf Contract/, 'the alias names Elula');
    const scene = sceneOf(query, state);
    assert.deepEqual(scene.people.map(person => [person.name, person.names]), [['Elula', ['Elula', 'the ferrywoman']]]);
    assert.equal(scene.nsd, true);
    // Without NSD the name stands alone: the quest's giver is not "the ferrywoman".
    const alone = tailOf(state, {}, { feature: () => false });
    assert.doesNotMatch(lineOf(alone, 'Quests'), /Wolf Contract/);
});

test('no scene known (no place, nobody present): every thread is told as before, no Elsewhere line', () => {
    const state = story(WORLD, makeState());
    const lines = tailOf(state, {}, { feature: () => false });
    assert.equal(lineOf(lines, 'Elsewhere'), '');
    for (const name of ['Herb run', 'Lost Ring', 'Grain Tax', 'Old Mill']) assert.match(lineOf(lines, 'Hooks'), new RegExp(name));
    const split = splitByScene([{ record: { kind: 'hook', key: 'X', fields: {} } }], { scene: { known: false } });
    assert.equal(split.here.length, 1);
});

test('a ready quest keeps its line wherever the scene is', () => {
    let state = story([...WORLD, { lines: '~ quest Far Bounty | met: yes' }], makeState());
    state = withScene(state, { place: 'Harrow', region: 'Vale', present: [] });
    const lines = tailOf(state, {}, { feature: () => false });
    assert.match(lineOf(lines, 'Quests'), /Far Bounty/);
    assert.doesNotMatch(lineOf(lines, 'Elsewhere'), /Far Bounty/);
});

test('the tail stays within its budget with many threads; Elsewhere goes first when room is short', () => {
    const many = [{ lines: START }];
    for (let i = 0; i < 12; i += 1) {
        many.push({ lines: Array.from({ length: 10 }, (_, j) => `+ hook Errand ${i}-${j} — a long errand with many words in its summary to fill the note | giver: Elula | now: Harrow`).join('\n'), seed: 100 + i });
    }
    many.push({ lines: Array.from({ length: 10 }, (_, j) => `+ hook Far Errand ${j} — far away | giver: Someone Else`).join('\n'), seed: 99 });
    const state = withScene(story(many, makeState()), { place: 'Harrow', region: '', present: ['Elula'] });
    const lines = tailOf(state, { elsewhere: 10 });
    assert.ok(estimateTokens(lines.join('\n')) <= TAIL_BUDGET, `${estimateTokens(lines.join('\n'))} tokens`);
    // The Initiative line has its room first; the scene's hooks fill the rest, so nothing elsewhere fits.
    assert.match(lineOf(lines, 'Initiative'), /^Initiative: Elula may approach \{\{user\}\} about Errand/);
    assert.equal(lineOf(lines, 'Elsewhere'), '');
    // With room, the Elsewhere line is there, still within the budget.
    const roomy = withScene(story([...WORLD], makeState()), { place: 'Harrow', region: 'Vale', present: ['Elula'] });
    const small = directorTail(view(roomy, { elsewhere: 10 }), { budget: 140 }).lines;
    assert.ok(estimateTokens(small.join('\n')) <= 140, small.join('\n'));
    const big = directorTail(view(roomy, { elsewhere: 10 }), { budget: TAIL_BUDGET }).lines;
    assert.ok(lineOf(big, 'Elsewhere').split(' · ').length >= lineOf(small, 'Elsewhere').split(' · ').length);
    assert.ok(lineOf(big, 'Initiative'));
});

test('the static part is byte-identical whatever the scene, the threads or the pick', () => {
    const before = part.context.static();
    const state = withScene(story(WORLD, makeState()), { place: 'Harrow', region: 'Vale', present: ['Elula'] });
    tailOf(state);
    assert.equal(part.context.static(), before);
    assert.equal(before, STATIC_TEXT);
    // The initiative line is a context part under its feature: the host adds it only while the feature is on.
    assert.equal(part.context.parts.length, 1);
    assert.equal(part.context.parts[0].feature, 'story-director.initiative');
    assert.equal(part.context.parts[0].static(), part.context.parts[0].static());
    assert.doesNotMatch(part.context.parts[0].static(), /Elula|Harrow|\d/);
});
