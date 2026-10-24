// checks.actor and checks.link (contract §3 P09/P24): the player's settings, the retry ledger, the stale hash, the one-to-one link.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hashOf, makeState, replay, run, write } from './helpers.js';

const SHEET = { 'rules.sheet': ({ actor }) => ({ ac_00000001: { id: actor, kind: 'pc' }, ac_00000002: { id: actor, kind: 'companion' }, ac_00000003: { id: actor, kind: 'summon' } })[actor] ?? null };

function actor(state, extra = {}, options = {}) {
    return run(state, 'checks.actor', { write: write(), name: 'Mara', expectedHash: hashOf(state), ...extra }, options);
}

test('the first actor becomes the default, bonuses default to {}, a second does not take it unless asked; ids are ca_', () => {
    const first = actor(makeState());
    assert.ok(first.ok, first.message);
    const id = first.result.data.v2.result.actor;
    assert.match(id, /^ca_[0-9a-z]{8}$/);
    assert.deepEqual(first.state.domains.checks.policy.actors[id], { id, name: 'Mara', bonuses: {} });
    assert.equal(first.state.domains.checks.policy.defaultActor, id);
    const second = actor(first.state, { name: 'Tov', bonuses: { DEX: 2, 'topic:stealth': 1 } });
    assert.ok(second.ok, second.message);
    assert.equal(second.state.domains.checks.policy.defaultActor, id);
    const third = actor(second.state, { name: 'Ilse', makeDefault: true });
    assert.equal(third.state.domains.checks.policy.defaultActor, third.result.data.v2.result.actor);
    assert.equal(third.result.data.v2.result.hash, hashOf(third.state));
});

test('editing keeps the link and the bonuses it was not given; an unknown id is NOT_FOUND for the player', () => {
    let state = actor(makeState(), { bonuses: { STR: 3 } }).state;
    const id = state.domains.checks.policy.defaultActor;
    state = run(state, 'checks.link', { write: write(), actor: id, rbActor: 'ac_00000001', expectedHash: hashOf(state) }, { queries: SHEET }).state;
    const edited = actor(state, { id, name: 'Mara of the Marsh' });
    assert.ok(edited.ok, edited.message);
    assert.deepEqual(edited.state.domains.checks.policy.actors[id], { id, name: 'Mara of the Marsh', bonuses: { STR: 3 } });
    assert.equal(edited.state.domains.checks.policy.rbActors[id], 'ac_00000001');
    assert.equal(actor(state, { id: 'ca_zzzzzzzz' }).code, 'NOT_FOUND');
});

test('the same write again is the same answer before any stale check; the same write with another meaning is a CONFLICT', () => {
    const state = makeState();
    const payload = { write: 'wr_00000001', name: 'Mara', expectedHash: hashOf(state) };
    const first = run(state, 'checks.actor', payload);
    assert.ok(first.ok);
    // The state moved on (the hash is no longer the one asked about), and the retry still answers.
    const retry = run(first.state, 'checks.actor', payload);
    assert.ok(retry.ok, retry.message);
    assert.deepEqual(retry.result.data.v2.result, first.result.data.v2.result);
    assert.deepEqual(retry.ops.filter(op => op.path.startsWith('/domains')), [], 'a retry changes nothing');
    assert.equal(run(first.state, 'checks.actor', { ...payload, name: 'Someone else' }).code, 'CONFLICT');
    // A new write on the old hash is stale.
    assert.equal(run(first.state, 'checks.actor', { ...payload, write: 'wr_00000002' }).code, 'STALE');
});

test('refusals: unknown fields and bad bonuses are INVALID; the story, a module and a click on someone else\'s behalf are REFUSED', () => {
    const state = makeState();
    const base = { write: write(), name: 'Mara', expectedHash: hashOf(state) };
    assert.equal(run(state, 'checks.actor', { ...base, mood: 'grim' }).code, 'INVALID');
    assert.equal(run(state, 'checks.actor', { ...base, bonuses: { DEX: 31 } }).code, 'INVALID');
    assert.equal(run(state, 'checks.actor', { ...base, bonuses: { 'topic:nonsense': 1 } }).code, 'INVALID');
    assert.equal(run(state, 'checks.actor', { ...base, bonuses: { luck: 1 } }).code, 'INVALID');
    assert.equal(run(state, 'checks.actor', { ...base, name: '' }).code, 'INVALID');
    assert.equal(run(state, 'checks.actor', { ...base, expectedHash: 'nope' }).code, 'INVALID');
    assert.equal(run(state, 'checks.actor', base, { cause: 'capture' }).code, 'REFUSED');
    assert.equal(run(state, 'checks.actor', base, { cause: 'system' }).code, 'REFUSED');
    assert.equal(run(state, 'checks.actor', base, { caller: 'story-block' }).code, 'REFUSED');
});

test('RPG Battle\'s creation makes a missing actor, and never edits one', () => {
    const made = actor(makeState(), {}, { cause: 'ui', caller: 'rpg-battle' });
    assert.ok(made.ok, made.message);
    const id = made.result.data.v2.result.actor;
    assert.equal(actor(made.state, { id }, { caller: 'rpg-battle' }).code, 'REFUSED');
    // A missing one by its id is made too.
    const named = actor(made.state, { id: 'ca_abcd1234', name: 'Wren' }, { caller: 'rpg-battle' });
    assert.ok(named.ok, named.message);
    assert.ok(named.state.domains.checks.policy.actors.ca_abcd1234);
});

test('checks.link: the PC or a durable companion, one to one, null unlinks, the player may relink and RB\'s creation may not', () => {
    let state = actor(makeState()).state;
    const mara = state.domains.checks.policy.defaultActor;
    state = actor(state, { name: 'Tov' }).state;
    const tov = Object.keys(state.domains.checks.policy.actors).find(id => id !== mara);
    const link = (which, rb, options = {}) => run(state, 'checks.link', { write: write(), actor: which, rbActor: rb, expectedHash: hashOf(state) }, { queries: SHEET, ...options });
    const linked = link(mara, 'ac_00000001');
    assert.ok(linked.ok, linked.message);
    assert.deepEqual(linked.result.data.v2.result, { actor: mara, rbActor: 'ac_00000001', hash: hashOf(linked.state) });
    state = linked.state;
    assert.equal(link(tov, 'ac_00000001').code, 'CONFLICT', 'one character, one actor');
    assert.equal(link(tov, 'ac_00000002').ok, true, 'a durable companion');
    assert.equal(link(tov, 'ac_00000003').code, 'REFUSED', 'a summon is not linked');
    assert.equal(link(tov, 'ac_00000009').code, 'NOT_FOUND', 'RPG Battle has no such character');
    assert.equal(link('ca_zzzzzzzz', 'ac_00000002').code, 'NOT_FOUND');
    assert.equal(link(mara, 'ac_00000002').ok, true, 'the player relinks');
    assert.equal(link(mara, 'ac_00000002', { caller: 'rpg-battle' }).code, 'CONFLICT', 'creation does not relink silently');
    assert.equal(link(mara, 'ac_00000001', { caller: 'rpg-battle' }).ok, true, 'the same link again is fine');
    const none = link(mara, null);
    assert.ok(none.ok);
    assert.deepEqual(none.state.domains.checks.policy.rbActors, {});
    assert.equal(link(mara, 'ac_00000002', { queries: {} }).code, 'DEPENDENCY_UNAVAILABLE', 'RPG Battle is not ready');
    assert.equal(link(mara, 'ac_00000001', { cause: 'capture' }).code, 'REFUSED');
});

test('a rebuild from the ops is the state (the writes are in the domain)', () => {
    const a = actor(makeState());
    const b = actor(a.state, { name: 'Tov' });
    const initial = makeState();
    assert.deepEqual(replay(initial, [a, b]), b.state);
});
