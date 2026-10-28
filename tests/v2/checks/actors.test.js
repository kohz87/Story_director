// checks.actor and checks.link (contract §3 P09/P24): the player's settings, the retry ledger, the stale hash, the one-to-one link.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deepFreeze, hashOf, makeState, replay, run, write } from './helpers.js';
import { part } from '../../../src/v2/checks/index.js';
import { policyOf } from '../../../src/v2/checks/domain.js';

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

test('editing keeps bonuses it was not given; an unknown id is NOT_FOUND for the player', () => {
    let state = actor(makeState(), { bonuses: { STR: 3 } }).state;
    const id = state.domains.checks.policy.defaultActor;
    const edited = actor(state, { id, name: 'Mara of the Marsh' });
    assert.ok(edited.ok, edited.message);
    assert.deepEqual(edited.state.domains.checks.policy.actors[id], { id, name: 'Mara of the Marsh', bonuses: { STR: 3 } });
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

test('a rebuild from the ops is the state (the writes are in the domain)', () => {
    const a = actor(makeState());
    const b = actor(a.state, { name: 'Tov' });
    const initial = makeState();
    assert.deepEqual(replay(initial, [a, b]), b.state);
});

// S2: after RPG Battle's checks part ran, the domain holds its own slice ({ prepared, log, ... }), with no policy or ledger.
test('S2: an RPG Battle-shaped checks slice is valid, and the first write of ours makes it ours: policy and ledger filled, its pending fields dropped, its log kept', () => {
    const entry = { id: 'ck_00000001', actor: 'ac_x', skill: 'stealth', stat: 'DEX', dc: 15, die: 12, mod: 2, total: 14, outcome: 'cost', modifiers: [] };
    const legacy = { prepared: { k1: { for: 3, rolls: [4, 17] } }, last: { id: 'ck_00000001' }, pending: {}, log: { ck_00000001: entry, junk: { x: 1 } } };
    assert.deepEqual(part.domains.checks.validate(legacy), [], 'valid as it is');
    assert.ok(part.domains.checks.validate({ policy: 1 }).length > 0, 'a slice that claims a policy is held to it');
    assert.ok(part.domains.checks.validate({ prepared: {}, mine: 1 }).length > 0, 'a field that is nobody\'s is not');
    const state = deepFreeze({ v: 2, meta: { rev: 0, claims: {} }, domains: { checks: legacy } });
    assert.equal(policyOf(legacy).defaultActor, null);
    const made = run(state, 'checks.actor', { write: write(), name: 'Mara', expectedHash: hashOf(state) });
    assert.ok(made.ok, made.message);
    const slice = made.state.domains.checks;
    assert.deepEqual(part.domains.checks.validate(slice), []);
    assert.deepEqual(Object.keys(slice).sort(), ['log', 'policy', 'writes']);
    assert.deepEqual(Object.keys(slice.log), ['ck_00000001'], 'its log is kept where it is ours in shape');
    const id = slice.policy.defaultActor;
    assert.ok(id && slice.policy.actors[id]);
    const rolled = run(made.state, 'checks.roll', { skill: 'stealth', evidence: 'ev_00000001' }, { cause: 'capture', source: { evidence: 'ev_00000001' } });
    assert.ok(rolled.ok, rolled.message);
});
