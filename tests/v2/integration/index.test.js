// index.js, the v2 bootstrap: registers with Story Block v2 when it is there; otherwise one line
// in the drawer and nothing else.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHost } from '../../vendor/story-block/testkit/index.js';
import { fakeFightRunner } from './helpers/fake-fight-runner.js';

globalThis.STORY_DIRECTOR_NO_START = true;
const { NEEDS_HOST, start, v2Host } = await import('../../../index.js');

const noWait = async () => {};

function fakeDocument() {
    const nodes = new Map();
    const make = tag => ({ tagName: tag, id: '', className: '', textContent: '', children: [], appendChild(child) { this.children.push(child); if (child.id) nodes.set(child.id, child); return child; } });
    const drawer = make('div');
    drawer.id = 'extensions_settings2';
    nodes.set(drawer.id, drawer);
    return { drawer, createElement: make, getElementById: id => nodes.get(id) ?? null };
}

test('with Story Block v2 the module registers once, and its chat state is set up', async () => {
    const host = await createHost({ modules: [fakeFightRunner()] });
    const root = { StoryBlock: { apiVersion: 2, ready: Promise.resolve(host.sdk), sdk: host.sdk } };
    assert.ok(v2Host(root));
    const first = await start({ root, doc: fakeDocument(), wait: noWait, tries: 0 });
    assert.equal(first.registered, true);
    assert.ok(host.sdk.modules().some(entry => entry.id === 'story-director'));
    assert.ok(host.head().domains.director, 'a module enabled mid-chat gets its initial slice');
    const again = await start({ root, doc: fakeDocument(), wait: noWait, tries: 0 });
    assert.equal(again.registered, true, 'a second start does not register twice');
    host.close();
});

test('with a host that has the header slot the module registers its Quiet scene toggle; an older host gets the module without the field', async () => {
    const host = await createHost({ modules: [fakeFightRunner()] });
    assert.ok(host.sdk.modules().every(entry => Array.isArray(entry.headerControls)), 'the vendored host has the slot');
    const root = { StoryBlock: { apiVersion: 2, ready: Promise.resolve(host.sdk), sdk: host.sdk } };
    assert.equal((await start({ root, doc: fakeDocument(), wait: noWait, tries: 0 })).registered, true);
    assert.deepEqual(host.registry.headerControls().map(control => [control.key, control.label, control.query, control.command]), [['story-director/quiet', 'Quiet scene', 'pulse.quiet', 'director.pulse.quiet']]);
    // The pill's state comes from the module's own query on the head state: off by default, on once the reader sets it.
    assert.deepEqual(host.sdk.query('pulse.quiet', {}), { on: false });
    assert.equal((await host.sdk.command('director.pulse.quiet', { on: true })).ok, true);
    assert.deepEqual(host.sdk.query('pulse.quiet', {}), { on: true });
    host.close();

    const old = await createHost({ modules: [fakeFightRunner()] });
    const seen = [];
    const oldSdk = Object.create(old.sdk, { modules: { value: () => old.sdk.modules().map(({ headerControls, ...rest }) => rest) }, registerModule: { value: def => { seen.push(def); return old.sdk.registerModule(def); } } });
    const oldRoot = { StoryBlock: { apiVersion: 2, ready: Promise.resolve(oldSdk), sdk: oldSdk } };
    assert.equal((await start({ root: oldRoot, doc: fakeDocument(), wait: noWait, tries: 0 })).registered, true);
    assert.equal(seen.length, 1);
    assert.equal('headerControls' in seen[0], false, 'no field the older host would log as ignored');
    old.close();
});

test('Story Block coming up a little later is waited for', async () => {
    const host = await createHost({ modules: [] });
    const root = {};
    let waits = 0;
    const wait = async () => {
        waits += 1;
        if (waits === 3) root.StoryBlock = { apiVersion: 2, ready: Promise.resolve(host.sdk), sdk: host.sdk };
    };
    assert.equal((await start({ root, doc: fakeDocument(), wait, tries: 10 })).registered, true);
    assert.equal(waits, 3);
    host.close();
});

test('without a v2 host: one line in the drawer, nothing registered', async () => {
    const doc = fakeDocument();
    for (const root of [{}, { StoryBlock: { apiVersion: 1 } }, { StoryBlock: { registerTab() {} } }]) {
        assert.equal(v2Host(root), null);
        const result = await start({ root, doc, wait: noWait, tries: 2 });
        assert.deepEqual(result, { registered: false, reason: NEEDS_HOST });
    }
    assert.equal(doc.drawer.children.length, 1, 'the line is shown once');
    assert.equal(doc.drawer.children[0].textContent, NEEDS_HOST);
});
