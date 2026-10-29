// fightRunner (src/v2/module.js): whether another module runs fights. On a host with a module
// lifecycle (sdk.modules() entries carry `status`) only a `ready` module counts: a dormant one, or any
// module while a restore is pending, asks for no encounters, and no query is asked as a fallback.
// Older hosts have no status and keep the command probe. Story Block's own lifecycle (peers, dormant,
// restore barrier) is tested there; here the host is a stand-in for `StoryBlock.sdk.modules()`, and one
// test runs the real host when the vendored Story Block has the lifecycle (sdk.preflight).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHost } from '../../vendor/story-block/testkit/index.js';
import { fightRunner } from '../../../src/v2/module.js';

const entry = (id, commands, status) => ({ id, name: id, version: '1.0.0', domains: [], commands, kinds: [], tabs: [], features: [], ...(status ? { status, reason: status === 'ready' ? null : 'Needs something.' } : {}) });
const original = Object.getOwnPropertyDescriptor(globalThis, 'StoryBlock');
const restoreLive = () => { if (original) Object.defineProperty(globalThis, 'StoryBlock', original); else delete globalThis.StoryBlock; };
const withLiveSdk = (t, modules) => {
    globalThis.StoryBlock = { sdk: { modules: () => modules } };
    t.after(restoreLive);
};
// A view whose queries answer, as a dormant module's would on a host that answers null: it must not count.
const answeringView = { query: () => null };
const absentView = { query: name => { throw new Error(`Story Suite: no module answers the query "${name}".`); } };

test('an older host (no status): a module that registers combat.* commands runs fights, as before', t => {
    withLiveSdk(t, [entry('story-block', ['scene.place']), entry('rules-module', ['combat.start', 'item.use'])]);
    assert.equal(fightRunner(), true);
    withLiveSdk(t, [entry('story-block', ['scene.place']), entry('crafting', ['craft.make'])]);
    assert.equal(fightRunner(), false);
    withLiveSdk(t, [entry('story-block', []), entry('story-director', ['combat.mine'])]);
    assert.equal(fightRunner(), false, 'its own commands do not count');
});

test('a lifecycle host: only a ready module with combat.* commands runs fights', t => {
    withLiveSdk(t, [entry('story-block', [], 'ready'), entry('rules-module', ['combat.start'], 'ready')]);
    assert.equal(fightRunner(), true);
    withLiveSdk(t, [entry('story-block', [], 'ready'), entry('rules-module', ['combat.start'], 'dormant')]);
    assert.equal(fightRunner(), false, 'dormant: no encounter requests');
    withLiveSdk(t, [entry('story-block', [], 'restore-pending'), entry('rules-module', ['combat.start'], 'restore-pending')]);
    assert.equal(fightRunner(), false, 'restore-pending: nothing is ready');
    withLiveSdk(t, [entry('story-block', [], 'ready'), entry('rules-module', ['item.use'], 'ready')]);
    assert.equal(fightRunner(), false, 'ready, but no combat commands');
    withLiveSdk(t, [entry('story-block', [], 'ready')]);
    assert.equal(fightRunner(), false, 'missing');
});

test('a lifecycle host: no fallback to a query for a dormant entry, whatever the view answers', t => {
    withLiveSdk(t, [entry('story-block', [], 'ready'), entry('rules-module', ['combat.start'], 'dormant')]);
    assert.equal(fightRunner(answeringView), false);
    assert.equal(fightRunner(absentView), false);
    withLiveSdk(t, [entry('story-block', [], 'ready'), entry('rules-module', ['combat.start'], 'ready')]);
    assert.equal(fightRunner(absentView), true, 'a ready entry is enough; the view is not asked');
});

test('without the live sdk the query probe is kept (null: neither can be asked)', () => {
    assert.equal(globalThis.StoryBlock?.sdk, undefined);
    assert.equal(fightRunner(), null);
    assert.equal(fightRunner(answeringView), true);
    assert.equal(fightRunner(absentView), false);
});

test('the real host: a dormant fight runner is not asked for, and a late peer wakes it', async t => {
    const probe = await createHost({ modules: [] });
    const capable = typeof probe.sdk.preflight === 'function';
    probe.close();
    if (!capable) { t.skip('the vendored Story Block has no module lifecycle yet'); return; }
    const host = await createHost({ modules: [] });
    t.after(() => { restoreLive(); host.close(); });
    globalThis.StoryBlock = { sdk: host.sdk };
    await host.sdk.registerModule({
        id: 'rules-module', name: 'example fight runner', version: '2.0.0-beta.2', requires: { peers: { 'story-director': '>=2.0.0-beta.1' } },
        commands: { 'combat.start': () => ({ summary: 'A fight starts.', narrate: false }) },
        queries: { 'combat.session': () => null },
    });
    assert.equal(host.sdk.modules().find(item => item.id === 'rules-module').status, 'dormant');
    assert.equal(fightRunner({ query: (name, args) => host.sdk.query(name, args) }), false, 'dormant: no encounters');
    await host.sdk.registerModule({ id: 'story-director', name: 'Story Director', version: '2.0.0-beta.2' });
    assert.equal(host.sdk.modules().find(item => item.id === 'rules-module').status, 'ready');
    assert.equal(fightRunner({ query: (name, args) => host.sdk.query(name, args) }), true, 'late activation: asked for at the next look');
    host.registry.setRestore('pending', 'Restoring.');
    assert.equal(fightRunner(), false, 'restore-pending');
});
