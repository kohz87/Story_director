// A fired beat and a dead person's own threads stop counting as open (tracker/quiet.js): read time, nothing stored or closed.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { part } from '../../../src/v2/tracker/index.js';
import { directorTail } from '../../../src/v2/tracker/note.js';
import { dropThreads, firedByLog, quietThreads } from '../../../src/v2/tracker/quiet.js';
import { makeState, story, thread } from './helpers/fake-ctx.js';

const START = '~ time March 3, 2026, 08:00 am';
const WORLD = [{ lines: [START,
    '+ beat Vorn\'s Return — Vorn comes back | on: March 4, 2026, 08:00 am',
    '+ beat The Peat-Cutter Strike — the cutters walk out | after: Vorn\'s Return',
    '+ agenda Vorn — pawns the rations | now: the quay',
    '+ agenda Ann — mends nets | now: the quay',
    '+ beat Annual Fair — stalls go up | now: the quay',
    '+ secret Vorn\'s Debt — owed to the Stray Oar',
    '+ hook Pawned Strongbox — Vorn pawned it | giver: Pella',
    '+ clock Vorn Waits — the debt comes due | due: March 30, 2026',
].join('\n') }];

// A scene known (a place), or every thread fits and nothing waits on another (scene.js).
const baseState = () => { const state = structuredClone(story(WORLD, makeState())); state.domains.scene = { place: { name: 'Nowhere Inn', kind: '', region: '' }, present: [] }; return state; };
const idOf = (state, key) => thread(state, key).id;
const withLog = (state, entries) => {
    const next = structuredClone(state);
    next.domains.chronicle = { questLog: Object.fromEntries(entries.map(([rev, key, text]) => [String(rev), { thread: idOf(state, key), text }])) };
    return next;
};
const dossiers = { vorn: { name: 'Vorn', aliases: ['the Branch Master'], lifeState: 'deceased' }, ann: { name: 'Ann', lifeState: 'alive' } };
const nsd = (dead = ['vorn']) => (name, args) => {
    if (name === 'npc.known') return ['Ann'];
    if (name !== 'npc.dossier') throw new Error(`no module answers ${name}`);
    const found = Object.entries(dossiers).find(([, d]) => [d.name, ...(d.aliases ?? [])].some(n => n.toLowerCase() === String(args.name ?? '').toLowerCase()));
    if (!found) return null;
    return { ...found[1], lifeState: dead.includes(found[0]) ? 'deceased' : 'alive' };
};
const lines = (state, query) => part.context.tail({ state, settings: {}, chat: { length: 9, lastUser: '' }, ...(query ? { query } : {}), feature: id => id !== 'story-director.initiative' }).lines.join('\n');

test('firedByLog: the last line that matters decides; a line that dates it again makes it live', () => {
    assert.equal(firedByLog([{ rev: 1, text: '+ beat X — a | on: March 4' }, { rev: 2, text: '! event X — it happened' }]), true);
    assert.equal(firedByLog([{ rev: 1, text: '! event X — it happened' }, { rev: 2, text: '~ event X — on: March 9, 2026' }]), false);
    assert.equal(firedByLog([{ rev: 1, text: '! event X — it happened' }, { rev: 2, text: '~ event X — then: more' }]), true);
    assert.equal(firedByLog([{ rev: 1, text: '+ beat X — a' }]), false);
    assert.equal(firedByLog([]), false);
});

test('a fired beat no longer blocks the beat that waits on it, and leaves the note; re-dating brings it back', () => {
    const state = baseState();
    assert.doesNotMatch(lines(state), /Peat-Cutter/, 'waits on an open beat: not told');
    const fired = withLog(state, [[10, 'Vorn\'s Return', '! event Vorn\'s Return — Vorn returned']]);
    const text = lines(fired);
    assert.match(text, /Peat-Cutter/);
    assert.doesNotMatch(text, /Vorn's Return —|Vorn comes back/);
    const dated = withLog(state, [[10, 'Vorn\'s Return', '! event Vorn\'s Return — Vorn returned'], [11, 'Vorn\'s Return', '~ event Vorn\'s Return — on: March 9, 2026, 08:00 am']]);
    assert.doesNotMatch(lines(dated), /Peat-Cutter/);
    // Nothing stored or closed: the thread is as it was.
    assert.equal(thread(fired, 'Vorn\'s Return').status, 'active');
    assert.deepEqual(fired.domains.director, state.domains.director);
});

test('the open lists leave a fired beat, but the Chronicle history and the plain list keep it', () => {
    const fired = withLog(baseState(), [[10, 'Vorn\'s Return', '! event Vorn\'s Return — Vorn returned']]);
    const ask = (args) => part.queries['director.threads'](fired, args, {}).map(item => item.key);
    assert.ok(!ask({ kind: 'beat', status: 'active', open: true }).includes('Vorn\'s Return'));
    assert.ok(ask({ kind: 'beat', status: 'active' }).includes('Vorn\'s Return'));
    assert.equal(fired.domains.chronicle.questLog['10'].text.startsWith('! event'), true);
});

test('a dead person\'s agenda and the beat naming them leave; secret, hook, clock and others stay; no match by accident', () => {
    const state = baseState();
    const query = nsd();
    const quiet = quietThreads(state.domains.director, { state, query });
    const keys = [...quiet].map(id => state.domains.director.threads[id].key).sort();
    assert.deepEqual(keys, ['Vorn', 'Vorn\'s Return']);
    const text = lines(state, query);
    assert.doesNotMatch(text, /pawns the rations/);
    assert.match(text, /Vorn's Debt|Pawned Strongbox|Vorn Waits/);
    // The beat that waited on his own beat is free.
    assert.match(text, /Peat-Cutter/);
    const open = part.queries['director.threads'](state, { kind: 'agenda', status: 'active', open: true }, { query }).map(item => item.key);
    assert.deepEqual(open, ['Ann']);
});

test('an alias counts; "Ann" does not match "Annual Fair"', () => {
    const state = baseState();
    const next = structuredClone(state);
    const probe = story([{ lines: '+ beat The Branch Master Arrives — a visit | now: the quay' }], next);
    const quiet = quietThreads(probe.domains.director, { state: probe, query: nsd() });
    assert.ok([...quiet].some(id => probe.domains.director.threads[id].key === 'The Branch Master Arrives'));
    const annDead = quietThreads(state.domains.director, { state, query: nsd(['ann']) });
    const annKeys = [...annDead].map(id => state.domains.director.threads[id].key);
    assert.deepEqual(annKeys, ['Ann']);
});

test('without NPC State Delta, or with nobody dead named, the note is byte for byte the same', () => {
    const state = baseState();
    const plain = lines(state);
    assert.equal(lines(state, (name) => { throw new Error(`no module answers ${name}`); }), plain);
    assert.equal(lines(state, nsd([])), plain);
    assert.equal(dropThreads(state.domains.director, new Set()), state.domains.director);
    assert.equal(quietThreads(state.domains.director, { state, query: null }).size, 0);
});

test('the story\'s own death line for a pinned person counts; a person who is back brings the threads back', () => {
    const state = baseState();
    const dead = structuredClone(state);
    dead.domains.keypeople = { pins: {}, away: {}, notes: {}, gone: { vorn: { name: 'Vorn', reason: 'died', on: null, rev: 3 } } };
    const keys = [...quietThreads(dead.domains.director, { state: dead })].map(id => dead.domains.director.threads[id].key).sort();
    assert.deepEqual(keys, ['Vorn', 'Vorn\'s Return']);
    assert.equal(quietThreads(state.domains.director, { state, query: nsd([]) }).size, 0);
});

test('directorTail still returns the lines of a state with no chronicle or keypeople slice', () => {
    const tail = directorTail({ state: baseState(), settings: {}, chat: { length: 9, lastUser: '' } });
    assert.ok(tail.lines.length > 0);
});
