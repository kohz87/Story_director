// Arc planning: "Accept planned arcs automatically" (setting arc.autoAccept, off by default). On, a plan the
// planner made (Plan arc, or by itself) is accepted at once through the same strict reading and commands as
// Accept; the arc panel then notes quietly that an arc began, naming nothing while behind the scenes is
// hidden; a plan code cannot use is not accepted; deleting the plan's reply takes the arc and the note away.
import test from 'node:test';
import assert from 'node:assert/strict';

import { installFakeDom } from '../../ui-fake-dom.js';
import { createFakeModel, createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule, storyDirectorModule } from '../../../src/v2/module.js';
import { createArcController, createArcWidget } from '../../../src/v2/arc/index.js';
import { browserStore, createReveal } from '../../../src/v2/screens/index.js';

const said = (text, lines = []) => (lines.length ? `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);
const squash = text => String(text ?? '').replace(/\s+/g, ' ').trim();
const PLAN = '<plan>\nARC: The Drowned Bell — the old bell rings\nBEAT: Bell Rings — it tolls\nBEAT: Diver Missing — gone\nSECRET: Bell Curse — ashes\n</plan>';
const BROKEN = '<plan>\nBEAT: Bell Rings — it tolls\n</plan>';
const SPOILERS = ['Drowned Bell', 'old bell rings', 'Bell Rings', 'Diver Missing', 'Bell Curse'];

async function setUp({ settings = {}, script = [PLAN] } = {}) {
    let host = null;
    const module = createModule({ host: { settings: id => host?.sdk.settings(id) ?? null, substitute: text => host?.sdk.substitute(text) } });
    host = await createHost({ callModel: createFakeModel(script), modules: [module], settings: { modules: { 'story-director': settings } } });
    const memory = new Map();
    const store = browserStore({ getItem: key => (memory.has(key) ? memory.get(key) : null), setItem: (key, value) => memory.set(key, String(value)) });
    const reveal = createReveal({ store, chatId: () => 'chat-1', settings: () => host.sdk.settings('story-director') });
    const notes = [];
    const arc = createArcController({ sdk: () => host.sdk, chat: () => host.ctx.chat, chatId: () => 'chat-1', store, reveal, notify: (kind, text) => notes.push([kind, text]) });
    await host.send('Hello.', said('The harbour.', ['~ time June 3, 1200, 08:00 am', '+ hook Old Debt — Mira owes the guild']));
    await host.send('On.', said('The quay.', ['+ hook Quay Talk — gossip']));
    return { host, arc, reveal, notes };
}

function drawPanel(arc, host) {
    const doc = installFakeDom();
    const el = doc.createElement('div');
    doc.body.appendChild(el);
    createArcWidget({ controller: arc }).render(el, { value: host.sdk.query('director.arc') }, {});
    return el;
}

test('the setting: off by default, its label, under the arc feature', () => {
    assert.equal(storyDirectorModule.settings.defaults['arc.autoAccept'], false);
    const field = storyDirectorModule.settings.schema['arc.autoAccept'];
    assert.equal(field.type, 'bool');
    assert.equal(field.label, 'Arc planning: Accept planned arcs automatically');
    assert.equal(field.feature, 'story-director.arc');
});

test('off: a plan waits for review; nothing is accepted and no note shows', async t => {
    t.mock.method(console, 'warn', () => {});
    const { host, arc } = await setUp();
    await arc.plan();
    assert.ok(arc.status().draft);
    assert.equal(host.sdk.query('director.arc').current, null);
    assert.equal(arc.status().began, null);
    host.close();
});

test('on: Plan arc is accepted at once by the same commands; a quiet note that names nothing while hidden; OK clears it', async t => {
    t.mock.method(console, 'warn', () => {});
    const { host, arc, reveal, notes } = await setUp({ settings: { 'arc.autoAccept': true } });
    const out = await arc.plan();
    assert.equal(out.ok, true, out.message);
    assert.equal(arc.status().draft, null, 'no plan waits');
    const current = host.sdk.query('director.arc').current;
    assert.equal(current.key, 'The Drowned Bell');
    assert.deepEqual(current.beats, { done: 0, total: 2 });
    // The same commands as Accept: an accept receipt from the reader's side.
    assert.ok(host.sdk.receipts().some(entry => entry.receipt.type === 'director.arc.accept' && entry.receipt.cause === 'ui'));
    assert.deepEqual(arc.status().began, { arc: current.id });
    assert.deepEqual(notes.at(-1), ['info', 'A new arc began (accepted without review). See the Director tab.']);
    assert.ok(!SPOILERS.some(word => notes.at(-1)[1].includes(word)), 'the toast names nothing');

    assert.equal(reveal.hidden(), true);
    let el = drawPanel(arc, host);
    const hidden = squash(el.textContent);
    assert.match(hidden, /A new arc began by itself \(accepted without review\)\. ?OK/);
    assert.match(hidden, /An arc is in progress \(0 of 2 beats played\)/);
    for (const word of SPOILERS) assert.ok(!hidden.includes(word), `${word} is not in the page`);
    reveal.set(true, 'chat-1');
    el = drawPanel(arc, host);
    assert.match(squash(el.textContent), /This arc began by itself \(accepted without review\)\..*The Drowned Bell/);
    el.querySelectorAll('button').find(node => squash(node.textContent) === 'OK').dispatch('click');
    assert.equal(arc.status().began, null);
    assert.doesNotMatch(squash(drawPanel(arc, host).textContent), /began by itself/);
    host.close();
});

test('on, planning by itself: the plan is used at once, with the note', async t => {
    t.mock.method(console, 'warn', () => {});
    const { host, arc } = await setUp({ settings: { 'arc.autoAccept': true, 'arc.trigger': 'auto' } });
    await arc.onTurn({ index: 3, type: 'normal' });
    assert.equal(host.sdk.query('director.arc').current?.key, 'The Drowned Bell');
    assert.ok(arc.status().began);
    host.close();
});

test('on: a plan code cannot use (no ARC line) is not accepted; the reason shows', async t => {
    t.mock.method(console, 'warn', () => {});
    const { host, arc } = await setUp({ settings: { 'arc.autoAccept': true }, script: [BROKEN] });
    const out = await arc.plan();
    assert.equal(out.ok, false);
    assert.match(arc.status().error, /The plan could not be used/);
    assert.equal(host.sdk.query('director.arc').current, null);
    assert.equal(arc.status().began, null);
    host.close();
});

test('on: deleting the reply the plan was accepted on takes the arc and the note away; replay equals a rebuild', async t => {
    t.mock.method(console, 'warn', () => {});
    const { host, arc } = await setUp({ settings: { 'arc.autoAccept': true } });
    await arc.plan();
    await host.send('Later.', said('Evening.', ['+ hook Tavern Brawl — a fight brews']));
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live);
    const holder = host.ctx.chat.findIndex(message => /The quay\./.test(message.mes));
    await host.st.deleteMessage(holder);
    await host.st.deleteMessage(holder - 1);
    assert.equal(host.sdk.query('director.arc').current, null);
    assert.equal(arc.status().began, null, 'no note for an arc that is gone');
    host.close();
});
