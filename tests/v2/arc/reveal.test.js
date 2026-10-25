// Behind the scenes, hidden until revealed (per chat, remembered in the browser), on the Director screen's
// panels (widgets story-director.behind and story-director.arc) and the status card's Next; the story's
// prompt still gets all of it.
import test from 'node:test';
import assert from 'node:assert/strict';

import { installFakeDom } from '../../ui-fake-dom.js';
import { createFakeModel, createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { createArcController, createArcWidget } from '../../../src/v2/arc/index.js';
import { browserStore, createBehindWidget, createReveal } from '../../../src/v2/screens/index.js';

const said = (text, lines = []) => (lines.length ? `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);
const squash = text => String(text ?? '').replace(/\s+/g, ' ').trim();
const buttons = root => root.querySelectorAll('button').map(node => squash(node.textContent));
const click = (root, label) => root.querySelectorAll('button').find(node => squash(node.textContent) === label).dispatch('click');
const PLAN = '<plan>\nARC: The Drowned Bell — the old bell rings\nBEAT: Bell Rings — it tolls\nBEAT: Diver Missing — gone\nSECRET: Bell Curse — ashes\n</plan>';

async function setUp({ settings = {}, script = [PLAN] } = {}) {
    let host = null;
    const module = createModule({ host: { settings: id => host?.sdk.settings(id) ?? null, substitute: text => host?.sdk.substitute(text) } });
    host = await createHost({ callModel: createFakeModel(script), modules: [module], settings: { modules: { 'story-director': settings } } });
    const memory = new Map();
    const storage = { getItem: key => (memory.has(key) ? memory.get(key) : null), setItem: (key, value) => memory.set(key, String(value)) };
    const store = browserStore(storage);
    const chat = { id: 'chat-1' };
    const reveal = createReveal({ store, chatId: () => chat.id, settings: () => host.sdk.settings('story-director') });
    const arc = createArcController({ sdk: () => host.sdk, chat: () => host.ctx.chat, chatId: () => chat.id, store, reveal, notify: () => {} });
    await host.send('Hello.', said('The harbour.', [
        '~ time June 3, 1200, 08:00 am', '+ hook Lost Net — find the net | giver: Tom | goal: Find the net',
        '+ agenda Smuggler Vane — moving crates | now: the docks | then: meet the reeve | on: June 3, 1200, 10:00 am',
        '+ clock Raid — bandits come | due: June 3, 1200, 09:00 am', '+ secret Reeve Bought — paid off',
        '+ event Harvest Fair — the fair | on: June 4, 1200',
    ]));
    return { host, arc, reveal, store, storage, chat };
}

function drawWidget(widget, value) {
    const doc = installFakeDom();
    const el = doc.createElement('div');
    doc.body.appendChild(el);
    const instance = widget.render(el, { value }, {});
    return { el, instance };
}

test('behind the scenes: a count and Reveal, nothing of it in the page; revealed per chat and remembered; Hide', async t => {
    t.mock.method(console, 'warn', () => {});
    const { host, reveal, store, chat } = await setUp();
    const value = host.sdk.query('director.behind');
    assert.deepEqual(value.kinds.map(group => group.kind), ['agenda', 'clock', 'secret']);
    assert.deepEqual(value.kinds.find(group => group.kind === 'secret').open[0], { id: value.kinds.at(-1).open[0].id, key: 'Reeve Bought', summary: '', fields: {}, ended: null }, 'a secret by its name alone');
    const { el } = drawWidget(createBehindWidget({ reveal }), value);
    const hidden = squash(el.textContent);
    assert.match(hidden, /Behind the scenes .* 3 open threads/);
    for (const word of ['Smuggler', 'Raid', 'Reeve', 'docks', 'crates']) assert.ok(!hidden.includes(word), `${word} is not in the page`);
    assert.deepEqual(buttons(el), ['Reveal']);
    click(el, 'Reveal');
    const shown = squash(el.textContent);
    assert.match(shown, /Behind the scenes is showing\. Hide Off-screen 1 Smuggler Vane moving crates At: the docks Next: meet the reeve/);
    assert.match(shown, /Secrets 1 Reeve Bought/);
    assert.doesNotMatch(shown, /paid off/, 'a secret shows only its name');
    // Remembered for this chat (a new page reads it back), not for another.
    assert.equal(createReveal({ store, chatId: () => 'chat-1', settings: () => ({}) }).revealed(), true);
    chat.id = 'chat-2';
    assert.equal(reveal.hidden(), true, 'another chat is still hidden');
    chat.id = 'chat-1';
    click(el, 'Hide');
    assert.doesNotMatch(squash(el.textContent), /Smuggler/);
    // The setting off: always shown, no Reveal or Hide.
    host.settings.set('story-director', 'screens.hideBehind', false);
    const open = drawWidget(createBehindWidget({ reveal }), value).el;
    assert.match(squash(open.textContent), /Smuggler Vane/);
    assert.deepEqual(buttons(open), []);
    // The story is told all of it, hidden or not.
    await host.send('On.', said('Gulls.'));
    const tail = host.st.promptLog.filter(entry => entry.key === 'story_suite_tail_1' && entry.value).at(-1).value;
    assert.match(tail, /Smuggler Vane/);
    host.close();
});

test('the status card names no agenda, beat or clock while hidden; the Director screen\'s problems split the same way', async t => {
    t.mock.method(console, 'warn', () => {});
    const { host } = await setUp();
    assert.equal(host.sdk.query('director.next', { shown: true }).key, 'Harvest Fair');
    assert.equal(host.sdk.query('director.next').key, 'Raid', 'other callers get every thread as before');
    host.settings.set('story-director', 'screens.hideBehind', false);
    assert.equal(host.sdk.query('director.next', { shown: true }).key, 'Raid');
    // A problem about an agenda is behind the scenes; one about a quest is not.
    await host.send('Hm.', said('Odd.', ['+ agenda Smuggler Vane — again | qty: 3', '+ hook Lost Net — again | qty: 2']));
    const behind = host.sdk.query('director.problems', { behind: true }).map(problem => problem.text);
    const open = host.sdk.query('director.problems', { behind: false }).map(problem => problem.text);
    assert.ok(behind.length && behind.every(text => !/Lost Net/.test(text)));
    assert.ok(open.some(text => /qty/.test(text)) && open.every(text => !/Smuggler/.test(text)));
    assert.equal(host.sdk.query('director.problems').length, behind.length + open.length);
    assert.deepEqual(host.sdk.query('director.behind').problems.map(problem => problem.text), behind);
    host.close();
});

test('the arc panel: Plan arc; a waiting plan hidden (Accept without reading, Review, Discard) or shown to edit; the arc by name only when revealed', async t => {
    t.mock.method(console, 'warn', () => {});
    t.mock.method(console, 'info', () => {});
    const { host, arc, reveal } = await setUp({ script: [PLAN, PLAN] });
    const widget = createArcWidget({ controller: arc });
    const value = () => host.sdk.query('director.arc');
    const { el, instance } = drawWidget(widget, value());
    assert.match(squash(el.textContent), /No arc planned yet\./);
    assert.deepEqual(buttons(el), ['Plan arc']);
    await arc.plan();
    assert.deepEqual(buttons(el), ['Accept without reading', 'Review', 'Discard']);
    assert.match(squash(el.textContent), /A new arc plan is waiting\./);
    assert.doesNotMatch(squash(el.textContent), /Drowned|Bell/, 'the plan is not in the page');
    click(el, 'Review');
    assert.equal(reveal.revealed(), true);
    assert.deepEqual(buttons(el), ['Accept', 'Discard', 'Plan again']);
    const area = el.querySelector('textarea');
    assert.match(area.value, /^ARC: The Drowned Bell/);
    area.value = area.value.replace('Bell Rings', 'Bell Tolls');
    area.dispatch('input');
    click(el, 'Accept');
    await new Promise(resolve => setTimeout(resolve, 20));
    instance.update({ value: value() });
    assert.match(squash(el.textContent), /The Drowned Bell · 0 of 2 beats played the old bell rings/);
    assert.ok(host.sdk.query('director.threads', { kind: 'beat' }).some(thread => thread.key === 'Bell Tolls'), 'the edit is what was accepted');
    assert.deepEqual(buttons(el), ['Plan next arc', 'End arc']);
    reveal.set(false);
    assert.match(squash(el.textContent), /An arc is in progress \(0 of 2 beats played\)\./);
    assert.doesNotMatch(squash(el.textContent), /Drowned/);
    // Accept without reading takes the plan as it came.
    await arc.plan();
    click(el, 'Accept without reading');
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(arc.status().draft, null);
    assert.equal(host.sdk.query('director.arc').count, 2);
    instance.destroy();
    host.close();
});

test('the arc panel on a Story Block without sdk.callModel: one plain sentence, no buttons', () => {
    const controller = createArcController({ sdk: () => ({ view: () => ({ state: null }), feature: () => true }), chat: () => [], chatId: () => 'x', store: browserStore(null), notify: () => {} });
    const { el } = drawWidget(createArcWidget({ controller }), null);
    assert.equal(squash(el.textContent), 'Arc Arc planning needs Story Block 2.0.0-beta.1 or newer (it asks the planner through Story Block). Update Story Block to plan arcs.');
    assert.deepEqual(buttons(el), []);
});
