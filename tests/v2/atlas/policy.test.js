// The canonical place, regions, danger and the area tier (contract §3 P24, §5 P05): what other modules key a place by, and how a place's
// danger is found.
import test from 'node:test';
import assert from 'node:assert/strict';

import { part } from '../../../src/v2/atlas/index.js';
import { policyProjection } from '../../../src/v2/atlas/policy.js';
import { areaPolicyProblems, initialAtlas, validateAtlas } from '../../../src/v2/atlas/domain.js';
import { at, command, makeState, placeNamed, query, replay } from './helpers/fake-ctx.js';

const HAVEN = 'pack.north/haven';
const HAVEN2 = 'pack.south/haven';
const MILL = 'pack.north/mill';
const PACK = {
    places: [
        { id: HAVEN, name: 'Haven', region: 'Northmarch', kind: 'town', x: 1, y: 1 },
        { id: HAVEN2, name: 'Haven', region: 'Southmarch', kind: 'port', x: 9, y: 9 },
        { id: MILL, name: 'The Mill', region: 'Northmarch', kind: 'mill', x: 2, y: 1, aliases: ['Old Mill'] },
    ],
    routes: [],
};
const ONE = { places: PACK.places.filter(place => place.id !== HAVEN2), routes: [] };
const policy = (tier, extra = {}) => ({ tier, allowedFoes: [], allowedTags: [], lore: [], ...extra });
let n = 0;
const wr = () => `wr_${(n += 1).toString(36).padStart(8, '0')}`;
const hashOf = state => policyProjection(state.domains.atlas).hash;
const write = (state, type, payload, options = {}) => command(state, type, { write: wr(), expectedHash: hashOf(state), ...payload }, options);
const ok = run => { assert.ok(run.ok, run.message); return run; };
const canon = (state, args, pack = PACK) => query(state, 'atlas.canonical', args, { pack });

test('canonical: a pack place is its content id before and after it is on the map; two packs sharing a name are two places, and the bare name is ambiguous', () => {
    let state = makeState();
    assert.deepEqual(canon(state, { id: HAVEN }), { id: HAVEN, name: 'Haven', atlasId: null, regionId: null, source: 'pack' });
    assert.deepEqual(canon(state, { id: HAVEN2 }).id, HAVEN2);
    assert.equal(canon(state, { name: 'Haven' }), null, 'two packs answer to it');
    assert.equal(canon(state, { name: 'Haven' }, ONE).id, HAVEN, 'one pack does');
    assert.equal(canon(state, { name: 'old mill' }).id, MILL, 'an alias, case and spaces');
    assert.equal(canon(state, { id: 'pack:the mill' }).id, MILL, 'a node id names the one definition of its key');
    assert.equal(canon(state, { id: 'pack:haven' }), null);
    assert.equal(canon(state, { id: 'pl_zzzzzzzz' }), null);
    assert.equal(canon(state, { name: 'Nowhere' }), null);
    // Materialized: the place keeps the pack's id, and says which pl_ it is.
    state = ok(command(state, 'atlas.visit', { name: 'The Mill' }, { pack: PACK })).state;
    const place = placeNamed(state, 'the mill');
    assert.equal(state.domains.atlas.placeRefs[place.id], MILL);
    assert.deepEqual(canon(state, { id: place.id }), { id: MILL, name: 'The Mill', atlasId: place.id, regionId: null, source: 'pack' });
    assert.deepEqual(canon(state, { id: MILL }), canon(state, { id: place.id }), 'the same identity by either');
    assert.equal(canon(state, { name: 'Old Mill' }).atlasId, place.id);
});

test('canonical: a place no pack has is its own pl_ id, and stays so when a pack later names it; omitted means the scene\'s place; id wins', () => {
    let state = ok(command(makeState(), 'atlas.visit', { name: 'Wren Hollow' })).state;
    const own = placeNamed(state, 'wren hollow');
    assert.equal(state.domains.atlas.placeRefs[own.id], own.id);
    const later = { places: [{ id: 'pack.late/hollow', name: 'Wren Hollow', region: '', kind: '', aliases: [] }], routes: [] };
    assert.deepEqual(canon(state, { name: 'Wren Hollow' }, later), { id: own.id, name: 'Wren Hollow', atlasId: own.id, regionId: null, source: 'atlas' });
    state = at(state, 'Wren Hollow');
    assert.equal(canon(state, {}, later).id, own.id, 'the scene\'s place');
    assert.equal(canon(state, { id: HAVEN, name: 'Wren Hollow' }).id, HAVEN, 'id wins');
    assert.equal(canon(at(state, ''), {}), null, 'a scene nowhere');
});

test('an own place that fits two packs is held: no identity, null canonical, the candidates to choose from, and placeBind settles it', () => {
    let state = ok(command(makeState(), 'atlas.visit', { name: 'Haven' }, { pack: PACK })).state;
    const own = placeNamed(state, 'haven');
    assert.equal(state.domains.atlas.placeRefs[own.id], undefined);
    assert.equal(canon(state, { id: own.id }), null);
    assert.deepEqual(query(state, 'atlas.candidates', { place: own.id }, { pack: PACK }), { place: own.id, definitions: [HAVEN, HAVEN2] });
    assert.equal(query(state, 'atlas.candidates', { place: 'pl_zzzzzzzz' }, { pack: PACK }), null);
    // The held place cannot be given a region or a danger until it is bound.
    assert.equal(write(state, 'atlas.dangerSet', { scope: 'place', key: own.id, policy: policy(3) }, { pack: PACK }).code, 'CONFLICT');
    assert.equal(write(state, 'atlas.placeBind', { place: own.id, definition: 'pack.north/mill' }, { pack: PACK }).code, 'CONFLICT', 'a pack place that does not match its names');
    assert.equal(write(state, 'atlas.placeBind', { place: own.id, definition: 'pack.nobody/x' }, { pack: PACK }).code, 'NOT_FOUND');
    assert.equal(write(state, 'atlas.placeBind', { place: 'pl_zzzzzzzz', definition: HAVEN }, { pack: PACK }).code, 'NOT_FOUND');
    assert.equal(write(state, 'atlas.placeBind', { place: own.id, definition: HAVEN }, { pack: PACK, cause: 'system' }).code, 'REFUSED');
    const bound = ok(write(state, 'atlas.placeBind', { place: own.id, definition: HAVEN2 }, { pack: PACK }));
    assert.deepEqual([bound.result.data.v2.result.place, bound.result.data.v2.result.definition, bound.result.data.v2.result.hash], [own.id, HAVEN2, hashOf(bound.state)]);
    assert.deepEqual(canon(bound.state, { id: own.id }), { id: HAVEN2, name: 'Haven', atlasId: own.id, regionId: null, source: 'pack' });
    // An identity once set never changes, and a definition is one place.
    assert.equal(write(bound.state, 'atlas.placeBind', { place: own.id, definition: HAVEN }, { pack: PACK }).code, 'CONFLICT');
    assert.ok(write(bound.state, 'atlas.placeBind', { place: own.id, definition: HAVEN2 }, { pack: PACK }).ok, 'the same bind again');
});

test('regions: created, renamed, unique names and aliases, no implicit creation, a write and its retry', () => {
    let state = makeState();
    const made = ok(write(state, 'atlas.region', { name: 'Northmarch', aliases: ['The North'] }));
    const id = made.result.data.v2.result.region;
    assert.match(id, /^rg_[0-9a-z]{8}$/);
    state = made.state;
    assert.deepEqual(state.domains.atlas.regions[id], { id, name: 'Northmarch', aliases: ['The North'] });
    assert.equal(write(state, 'atlas.region', { name: 'the north' }).code, 'CONFLICT', 'an alias is taken');
    assert.equal(write(state, 'atlas.region', { name: 'Southmarch', aliases: ['northmarch'] }).code, 'CONFLICT');
    assert.equal(write(state, 'atlas.region', { name: 'A', aliases: ['a'] }).code, 'INVALID', 'a name and its alias differ');
    assert.equal(write(state, 'atlas.region', { name: 'A', aliases: Array.from({ length: 17 }, (_, i) => `n${i}`) }).code, 'INVALID');
    assert.equal(write(state, 'atlas.region', { id: 'rg_zzzzzzzz', name: 'Ghost' }).code, 'NOT_FOUND');
    const renamed = ok(write(state, 'atlas.region', { id, name: 'Northern March' }));
    assert.equal(renamed.state.domains.atlas.regions[id].name, 'Northern March');
    assert.equal(renamed.state.domains.atlas.regions[id].aliases.length, 0);
    // The ledger: the same write and meaning answers again, after the state has moved on; another meaning is a conflict; a new write on the old hash is stale.
    const payload = { write: 'wr_aaaaaaaa', name: 'Mire', expectedHash: hashOf(renamed.state) };
    const first = ok(command(renamed.state, 'atlas.region', payload));
    const again = ok(command(first.state, 'atlas.region', payload));
    assert.deepEqual(again.result.data.v2.result, first.result.data.v2.result);
    assert.deepEqual(again.ops.filter(op => op.path.startsWith('/domains')), []);
    assert.equal(command(first.state, 'atlas.region', { ...payload, name: 'Bog' }).code, 'CONFLICT');
    assert.equal(command(first.state, 'atlas.region', { ...payload, write: wr() }).code, 'STALE');
    // The story cannot make a region, and a place\'s text is not one.
    assert.equal(command(state, 'atlas.region', { write: wr(), name: 'X', expectedHash: hashOf(state) }, { cause: 'story' }).code, 'REFUSED');
    assert.deepEqual(Object.keys(ok(command(makeState(), 'atlas.visit', { name: 'Haven', region: 'Northmarch' }, { pack: PACK })).state.domains.atlas.regions), []);
});

test('membership and danger: place -> region -> world, the first policy found wins, null removes, unknown holds', () => {
    let state = ok(command(makeState(), 'atlas.visit', { name: 'The Mill' }, { pack: PACK })).state;
    state = ok(write(state, 'atlas.region', { name: 'Northmarch' })).state;
    const rg = Object.keys(state.domains.atlas.regions)[0];
    const tier = (id, p = PACK) => query(state, 'world.areaTier', { place: id }, { pack: p });
    assert.deepEqual(tier(MILL), { place: MILL, tier: null, source: 'unknown', sourceId: null, allowedFoes: [], allowedTags: [], lore: [] }, 'nothing set: unknown holds generation');
    state = ok(write(state, 'atlas.dangerSet', { scope: 'world', key: null, policy: policy(1, { lore: ['Quiet roads.'] }) })).state;
    assert.deepEqual(tier(MILL), { place: MILL, tier: 1, source: 'world', sourceId: null, allowedFoes: [], allowedTags: [], lore: ['Quiet roads.'] });
    state = ok(write(state, 'atlas.dangerSet', { scope: 'region', key: rg, policy: policy(4, { allowedFoes: ['pack.north/wolf'], allowedTags: ['beast'] }) })).state;
    assert.equal(tier(MILL).source, 'world', 'the mill is in no region yet: membership is explicit');
    state = ok(write(state, 'atlas.placeRegion', { place: 'the mill', region: rg })).state;
    assert.equal(state.domains.atlas.placeRegions[MILL], rg, 'keyed by the canonical id');
    assert.deepEqual([tier(MILL).tier, tier(MILL).source, tier(MILL).sourceId, tier(MILL).allowedFoes, tier(MILL).allowedTags], [4, 'region', rg, ['pack.north/wolf'], ['beast']]);
    assert.equal(canon(state, { id: MILL }).regionId, rg);
    state = ok(write(state, 'atlas.dangerSet', { scope: 'place', key: MILL, policy: policy(7) })).state;
    assert.deepEqual([tier(MILL).tier, tier(MILL).source, tier(MILL).sourceId], [7, 'place', MILL]);
    assert.equal(tier(placeNamed(state, 'the mill').id).tier, 7, 'by the pl_ id too');
    assert.equal(tier('Nowhere').source, 'unknown');
    assert.equal(tier(undefined).tier, null);
    // null removes an override, one at a time; the membership stays.
    state = ok(write(state, 'atlas.dangerSet', { scope: 'place', key: MILL, policy: null })).state;
    assert.equal(tier(MILL).source, 'region');
    state = ok(write(state, 'atlas.placeRegion', { place: MILL, region: null })).state;
    assert.equal(tier(MILL).source, 'world');
    state = ok(write(state, 'atlas.dangerSet', { scope: 'world', key: null, policy: null })).state;
    assert.equal(tier(MILL).source, 'unknown');
    // A pack that is gone leaves the mapping and the policy.
    state = ok(write(state, 'atlas.dangerSet', { scope: 'place', key: MILL, policy: policy(2) })).state;
    assert.equal(tier(MILL, { places: [], routes: [], candidates: [] }).tier, 2);
});

test('writer refusals: bad shapes, unknown regions and places, a policy over the limits, the wrong issuer', () => {
    let state = ok(write(makeState(), 'atlas.region', { name: 'Northmarch' })).state;
    const rg = Object.keys(state.domains.atlas.regions)[0];
    const set = (payload, options) => write(state, 'atlas.dangerSet', payload, options);
    assert.equal(set({ scope: 'galaxy', key: null, policy: null }).code, 'INVALID');
    assert.equal(set({ scope: 'world', key: rg, policy: policy(1) }).code, 'INVALID');
    assert.equal(set({ scope: 'region', key: null, policy: policy(1) }).code, 'INVALID');
    assert.equal(set({ scope: 'region', key: rg }).code, 'INVALID', 'no policy at all');
    assert.equal(set({ scope: 'region', key: 'rg_zzzzzzzz', policy: policy(1) }).code, 'NOT_FOUND');
    assert.equal(set({ scope: 'place', key: 'Nowhere', policy: policy(1) }).code, 'NOT_FOUND');
    for (const bad of [policy(10), policy(-1), policy(1.5), policy(1, { allowedFoes: Array.from({ length: 1001 }, (_, i) => `pack.x/f${i}`) }), policy(1, { allowedTags: Array.from({ length: 33 }, (_, i) => `t${i}`) }), policy(1, { allowedTags: ['x'.repeat(41)] }), policy(1, { lore: Array.from({ length: 17 }, () => 'a') }), policy(1, { lore: ['a'.repeat(241)] }), policy(1, { extra: 1 })]) {
        assert.equal(set({ scope: 'world', key: null, policy: bad }).code, 'INVALID', JSON.stringify(bad).slice(0, 60));
    }
    assert.ok(set({ scope: 'world', key: null, policy: policy(1, { allowedFoes: Array.from({ length: 1000 }, (_, i) => `pack.x/f${i}`) }) }).ok, '1000 foes are the limit');
    assert.equal(set({ scope: 'world', key: null, policy: policy(1) }, { cause: 'capture' }).code, 'REFUSED');
    assert.equal(set({ scope: 'world', key: null, policy: policy(1) }, { caller: 'rpg-battle' }).code, 'REFUSED');
    assert.equal(write(state, 'atlas.placeRegion', { place: 'Nowhere', region: rg }).code, 'NOT_FOUND');
    assert.equal(write(state, 'atlas.placeRegion', { place: 'Haven', region: 'rg_zzzzzzzz' }, { pack: ONE }).code, 'NOT_FOUND');
    assert.equal(write(state, 'atlas.placeRegion', { place: 'Haven', region: 'x' }, { pack: ONE }).code, 'INVALID');
    assert.equal(write(state, 'atlas.placeRegion', { place: 'Haven', region: rg, extra: 1 }, { pack: ONE }).code, 'INVALID');
    assert.equal(command(state, 'atlas.placeRegion', { write: wr(), place: 'Haven', region: rg, expectedHash: 'f'.repeat(64) }, { pack: ONE }).code, 'STALE');
});

test('the policy projection: sorted, hashed without the ledger, and the same state gives the same hash', () => {
    const a = ok(write(makeState(), 'atlas.region', { name: 'Northmarch' }));
    const b = ok(write(a.state, 'atlas.region', { name: 'Southmarch' }));
    const projection = query(b.state, 'atlas.policy', {});
    assert.deepEqual(projection.regions.map(region => region.id), Object.keys(b.state.domains.atlas.regions).sort());
    assert.equal(projection.regions.length, 2);
    assert.deepEqual(Object.keys(projection), ['regions', 'placeRegions', 'placeRefs', 'danger', 'hash']);
    assert.equal(projection.hash, hashOf(b.state));
    const stripped = structuredClone(b.state);
    stripped.domains.atlas.writes = {};
    assert.equal(hashOf(stripped), hashOf(b.state), 'the retry ledger is not policy');
    assert.notEqual(hashOf(a.state), hashOf(b.state));
    assert.deepEqual(replay(makeState(), [a, b]), b.state);
});

test('the atlas domain: the new parts are validated, an older save without them is whole, a dangling membership is not', () => {
    assert.deepEqual(validateAtlas(initialAtlas()), []);
    const old = { places: {}, routes: {}, keys: {}, focus: null };
    assert.deepEqual(validateAtlas(old), []);
    const bad = patch => validateAtlas({ ...initialAtlas(), ...patch });
    assert.ok(bad({ placeRegions: { [HAVEN]: 'rg_00000001' } }).length, 'no such region');
    assert.ok(bad({ regions: { rg_00000001: { id: 'rg_00000001', name: 'A', aliases: [] }, rg_00000002: { id: 'rg_00000002', name: 'a', aliases: [] } } }).length, 'two regions, one name');
    assert.ok(bad({ placeRefs: { pl_00000001: HAVEN } }).length, 'a place that is not there');
    assert.ok(bad({ danger: { world: policy(12), regions: {}, places: {} } }).length);
    assert.ok(bad({ danger: { world: null, regions: { rg_00000001: policy(1) }, places: {} } }).length, 'a policy for no region');
    assert.ok(bad({ writes: { nope: {} } }).length);
    assert.deepEqual(areaPolicyProblems(policy(0), 'p'), []);
});
