// The arc planner and the module's fixed prompt on a host with a module lifecycle: a fight runner that is dormant
// (its peer is missing) or held by a restore is no fight runner, so the planner is told no fights, keeps none, and
// the first prompt asks for none. Needs a Story Block that has the lifecycle (sdk.preflight); skipped on an older one.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createFakeModel, createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule, fightRunner } from '../../../src/v2/module.js';
import { createArcController } from '../../../src/v2/arc/index.js';
import { FIGHT_RULE, NO_FIGHT_RULE } from '../../../src/v2/arc/plan.js';
import { browserStore, createReveal } from '../../../src/v2/screens/reveal.js';
import { fakeFightRunner } from '../integration/helpers/fake-fight-runner.js';

const said = (text, lines = []) => (lines.length ? `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);
const PLAN = `<plan>
ARC: The Drowned Bell — the harbour's old bell rings again
BEAT: Bell Rings — the sunken bell tolls at night | on: in 2 days | place: Harbour
ENCOUNTER: Wreckers — 3 wrecker | on: in 3 days
</plan>`;
const original = Object.getOwnPropertyDescriptor(globalThis, 'StoryBlock');
const restoreLive = () => { if (original) Object.defineProperty(globalThis, 'StoryBlock', original); else delete globalThis.StoryBlock; };

// example fight runner's stand-in, naming a peer: dormant until `waitsFor` is registered.
const rpg = waitsFor => ({ ...fakeFightRunner(), requires: { storyBlock: '>=2.0.0-beta.2', peers: { [waitsFor]: '>=0.0.0' } } });

async function setUp(t, { waitsFor = 'nobody-yet', beforeModule = null } = {}) {
    const probe = await createHost({ modules: [] });
    const capable = typeof probe.sdk.preflight === 'function';
    probe.close();
    if (!capable) { t.skip('the vendored Story Block has no module lifecycle yet'); return null; }
    t.mock.method(console, 'warn', () => {});
    t.mock.method(console, 'info', () => {});
    const model = createFakeModel([PLAN]);
    const host = await createHost({ callModel: model, modules: [] });
    globalThis.StoryBlock = { sdk: host.sdk };
    t.after(() => { restoreLive(); host.close(); });
    beforeModule?.(host);
    const module = createModule({ host: { settings: id => host.sdk.settings(id), substitute: text => host.sdk.substitute(text) } });
    await host.sdk.registerModule(rpg(waitsFor));
    await host.sdk.registerModule(module);
    const store = browserStore(null);
    const reveal = createReveal({ store, chatId: () => 'chat-1', settings: () => host.sdk.settings('story-director') });
    const arc = createArcController({ sdk: () => host.sdk, chat: () => host.ctx.chat, chatId: () => 'chat-1', store, reveal, notify: () => {} });
    await host.send('Hello.', said('The harbour at dawn.', ['~ time June 3, 1200, 08:00 am']));
    return { host, model, arc, module };
}
const beat = (host, key) => host.sdk.query('director.threads', { kind: 'beat' }).find(thread => thread.key === key);

test('a dormant fight runner: the planner is told no fights and keeps none', async t => {
    const s = await setUp(t);
    if (!s) return;
    assert.equal(s.host.sdk.modules().find(entry => entry.id === 'rules-module').status, 'dormant');
    assert.equal((await s.arc.plan()).ok, true);
    assert.ok(s.model.calls[0].system.includes(NO_FIGHT_RULE));
    assert.ok(!s.model.calls[0].system.includes(FIGHT_RULE));
    assert.ok(s.arc.status().draft.findings.some(entry => /no module runs fights/.test(entry.text)));
    assert.equal((await s.arc.accept()).ok, true);
    assert.equal(beat(s.host, 'Wreckers').fields.encounter, undefined, 'no planned fight is kept');
});

test('a restore pending: nothing is a fight runner, and the planner is not asked at all', async t => {
    const s = await setUp(t, { waitsFor: 'story-block' });     // ready: its peer is Story Block itself
    if (!s) return;
    assert.equal(s.host.sdk.modules().find(entry => entry.id === 'rules-module').status, 'ready');
    assert.equal(fightRunner(), true);
    s.host.registry.setRestore('pending', 'Going back to a save point.');
    assert.equal(fightRunner(), false, 'restore-pending: no fight runner');
    const out = await s.arc.plan();
    assert.equal(out.ok, false, 'Story Director is held too: nothing is asked of the model');
    assert.equal(s.model.calls.length, 0);
    s.host.registry.setRestore('idle');
    assert.equal(fightRunner(), true);
    assert.equal((await s.arc.plan()).ok, true);
    assert.ok(s.model.calls[0].system.includes(FIGHT_RULE));
});

test('a ready fight runner: fights are asked for, as before', async t => {
    const s = await setUp(t, { waitsFor: 'story-block' });
    if (!s) return;
    assert.equal((await s.arc.plan()).ok, true);
    assert.ok(s.model.calls[0].system.includes(FIGHT_RULE));
    assert.equal((await s.arc.accept()).ok, true);
    assert.equal(beat(s.host, 'Wreckers').fields.encounter, '3 wrecker');
});

test('the module\'s first prompt starts from the fight runner\'s status, not from "fights"', async t => {
    const probe = await createHost({ modules: [] });
    const capable = typeof probe.sdk.preflight === 'function';
    probe.close();
    if (!capable) { t.skip('the vendored Story Block has no module lifecycle yet'); return; }
    const staticOf = async waitsFor => {
        const host = await createHost({ modules: [] });
        globalThis.StoryBlock = { sdk: host.sdk };
        try {
            await host.sdk.registerModule(rpg(waitsFor));
            const module = createModule({ host: { settings: id => host.sdk.settings(id), substitute: text => host.sdk.substitute(text) } });
            return module.context.static();
        } finally {
            restoreLive();
            host.close();
        }
    };
    const dormant = await staticOf('nobody-yet');
    const ready = await staticOf('story-block');
    assert.notEqual(dormant, ready, 'the fixed prompt differs with a fight runner');
    assert.doesNotMatch(dormant, /encounter/i);
    assert.match(ready, /encounter/i);
});
