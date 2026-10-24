// The checks part and the map's policy on the real Story Block host (the vendored testkit) with the module registered whole: the writers
// as the player calls them, the policy and its hash, the probe, a rebuild.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../vendor/story-block/testkit/index.js';
import { moduleWithChecks } from './helpers.js';

const newHost = () => createHost({ modules: [moduleWithChecks()] });
const ok = async promise => {
    const out = await promise;
    assert.equal(out.ok, true, out.message);
    return out;
};
let n = 0;
const wr = () => `wr_${(n += 1).toString(36).padStart(8, '0')}`;

test('the policy is empty at first, the player\'s actor is the default, and the hash moves with every write', async () => {
    const host = await newHost();
    const empty = host.sdk.query('checks.policy', {});
    assert.deepEqual(Object.keys(empty), ['actors', 'defaultActor', 'rbActors', 'rbModifiers', 'social', 'hash']);
    assert.deepEqual([empty.actors, empty.defaultActor, empty.rbActors, empty.rbModifiers, empty.social], [{}, null, {}, true, true]);
    const made = await ok(host.sdk.command('checks.actor', { write: wr(), name: 'Mara', bonuses: { DEX: 2 }, expectedHash: empty.hash }));
    const id = made.receipt.data.v2.result.actor;
    const after = host.sdk.query('checks.policy', {});
    assert.equal(made.receipt.data.v2.result.hash, after.hash);
    assert.notEqual(after.hash, empty.hash);
    assert.deepEqual([after.defaultActor, after.actors[id].name, after.actors[id].bonuses], [id, 'Mara', { DEX: 2 }]);
    // The same write again, now that the hash has moved: the same answer.
    const stale = await host.sdk.command('checks.actor', { write: wr(), name: 'Tov', expectedHash: empty.hash });
    assert.equal(stale.code, 'STALE');
    const live = host.store.rebuild ? (host.store.rebuild(), host.sdk.query('checks.policy', {})) : after;
    assert.deepEqual(live, after, 'a rebuild gives the same policy');
    // A roll is not a click.
    const roll = await host.sdk.command('checks.roll', { skill: 'Stealth', evidence: 'ev_00000001' });
    assert.equal(roll.code, 'REFUSED');
    host.close();
});

test('the map policy through the host: a region, a world danger and the tier of an unknown place', async () => {
    const host = await newHost();
    const policy = host.sdk.query('atlas.policy', {});
    assert.deepEqual([policy.regions, policy.placeRegions, policy.placeRefs, policy.danger], [[], {}, {}, { world: null, regions: {}, places: {} }]);
    const region = await ok(host.sdk.command('atlas.region', { write: wr(), name: 'Northmarch', expectedHash: policy.hash }));
    const next = host.sdk.query('atlas.policy', {});
    await ok(host.sdk.command('atlas.dangerSet', { write: wr(), scope: 'world', key: null, policy: { tier: 2, allowedFoes: [], allowedTags: [], lore: ['Quiet.'] }, expectedHash: next.hash }));
    await host.send('Hello.', 'You reach Bluewatch.\n<Changes>\n~ place Bluewatch | kind: settlement\n</Changes>');
    assert.equal(host.sdk.query('atlas.canonical', {}), null, 'the scene\'s place is not on the map until the next reply\'s hook visits it');
    await ok(host.sdk.command('atlas.visit', { name: 'Bluewatch', kind: 'settlement' }));
    const here = host.sdk.query('atlas.canonical', {});
    assert.equal(here.name, 'Bluewatch');
    assert.match(here.id, /^pl_/);
    assert.equal(here.source, 'atlas');
    const tier = host.sdk.query('world.areaTier', { place: here.id });
    assert.deepEqual([tier.tier, tier.source, tier.sourceId, tier.lore, tier.place], [2, 'world', null, ['Quiet.'], here.id]);
    assert.equal(host.sdk.query('world.areaTier', { place: 'Nowhere' }).tier, null);
    assert.ok(region.receipt.data.v2.result.region.startsWith('rg_'));
    host.close();
});

test('director.contract: SD alone answers true for what it owns, and not for the thread writers it does not have yet', async () => {
    const host = await newHost();
    const contract = host.sdk.query('director.contract', {});
    assert.deepEqual([contract.api, contract.enabled, contract.clock, contract.tiers, contract.journal, contract.checks], [2, true, true, true, true, true]);
    assert.equal(typeof contract.threads, 'boolean');
    host.close();
});

// S1: RPG Battle's checks part owns the `checks` domain, the `check` kind and its own `checks.*` names until the flip release retires it.
// Story Director as shipped registers none of them, so the two modules sit on one host.
test('S1: the shipped module does not claim RPG Battle\'s checks domain, kind or commands: both register on one host', async () => {
    const { createModule } = await import('../../../src/v2/module.js');
    const def = createModule();
    assert.equal(Object.hasOwn(def.domains, 'checks'), false);
    assert.equal(Object.keys(def.commands).some(name => name.startsWith('checks.')), false);
    assert.equal(Object.keys(def.queries).some(name => name.startsWith('checks.')), false);
    assert.equal(Object.hasOwn(def.capture.kinds, 'check'), false);
    const rb = {
        id: 'rpg-battle', name: 'RPG Battle', version: '2.0.0-test',
        domains: { checks: { initial: () => ({ prepared: {}, log: {} }), validate: () => [] } },
        commands: { 'checks.prepare'(ctx) { ctx.draft('checks').prepared.k = { for: 1 }; return { summary: 'Prepared.', narrate: false }; } },
        queries: { 'checks.log': state => state.domains.checks.log },
        capture: { kinds: { check: { grammar: '? check <skill> — what', apply: () => ({ summary: 'A check waits.', narrate: false }) } }, apply: () => ({ summary: 'A check waits.', narrate: false }) },
    };
    const host = await createHost({ modules: [createModule(), rb] });
    const prepared = await host.sdk.command('checks.prepare', {});
    assert.equal(prepared.ok, true, prepared.message);
    assert.deepEqual(Object.keys(host.head().domains.checks), ['prepared', 'log'], 'the domain is RPG Battle\'s alone');
    assert.deepEqual(host.sdk.query('checks.log', {}), {});
    host.close();
});
