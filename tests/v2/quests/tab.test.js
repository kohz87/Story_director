// Quests part: the minimal Quests tab against the fake DOM (smoke tests).
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../../ui-fake-dom.js';
import { fakeQueries, makeState, quest } from './helpers/fake-ctx.js';

const doc = installFakeDom();
const { part } = await import('../../../src/v2/quests/index.js');
const render = part.tabs[0].render;

const viewOf = state => ({ state, query: (name, args) => fakeQueries[name](state, args), settings: {}, chat: { length: 3, lastUser: '' } });
const buttons = (pane, label) => pane.querySelectorAll('button').filter(node => node.textContent === label);

function draw(state, api) {
    const pane = doc.createElement('div');
    doc.body.appendChild(pane);
    render(pane, viewOf(state), api);
    return pane;
}

const wolves = more => quest('th_wolves01', 'EastBluffWolves', { goal: 'Clear at least 3 wolves', giver: 'Orsa' },
    { taken: { rev: 10 }, target: { noun: 'wolves', count: 3, kind: 'foes' }, reward: { amount: 1, each: true, unit: 'silver', text: '1 silver each wolf' }, ...more });

test('offers show Take on and Turn down, which send commands', async () => {
    const sent = [];
    const api = { command: (type, payload, options) => { sent.push([type, payload, options]); return { ok: true }; } };
    const pane = draw(makeState({ threads: [quest('th_offer001', 'Granary Rats', { goal: 'kill 6 rats', reward: '5 silver' }, { offer: true })] }), api);
    assert.match(pane.textContent, /Offered/);
    assert.match(pane.textContent, /Granary Rats/);
    assert.match(pane.textContent, /No quests taken on/);
    buttons(pane, 'Take on')[0].click();
    buttons(pane, 'Turn down')[0].click();
    assert.deepEqual(sent, [['quest.take', { id: 'th_offer001' }, { cause: 'ui' }], ['quest.decline', { id: 'th_offer001' }, { cause: 'ui' }]]);
});

test('active quest shows progress and an enabled Finish when it can be turned in', () => {
    const sent = [];
    const state = makeState({ threads: [wolves()], beaten: [{ rev: 11, foes: [{ name: 'Wolf', count: 8 }], won: true }], scene: { place: { kind: 'settlement' } } });
    const pane = draw(state, { command: (type, payload) => { sent.push([type, payload]); return { ok: true }; } });
    assert.match(pane.textContent, /Wolves 8\/3/);
    assert.match(pane.textContent, /beat 3 wolves; 1 gold per wolf/);
    const finish = buttons(pane, 'Finish')[0];
    assert.equal(finish.disabled, false);
    finish.click();
    assert.deepEqual(sent, [['quest.finish', { id: 'th_wolves01' }]]);
});

test('Finish is disabled with the reason when the place rule fails or the target is not met', () => {
    let state = makeState({ threads: [wolves()], beaten: [{ rev: 11, foes: [{ name: 'Wolf', count: 8 }], won: true }], scene: { place: { kind: 'wild' } } });
    let pane = draw(state, { command: () => assert.fail('no command while disabled') });
    let finish = buttons(pane, 'Finish')[0];
    assert.equal(finish.disabled, true);
    assert.match(pane.textContent, /Turn it in at a settlement or where Orsa is\./);
    finish.click();
    state = makeState({ threads: [wolves()], beaten: [{ rev: 11, foes: [{ name: 'Wolf', count: 1 }], won: true }], scene: { place: { kind: 'settlement' } } });
    pane = draw(state, {});
    finish = buttons(pane, 'Finish')[0];
    assert.equal(finish.disabled, true);
    assert.match(pane.textContent, /Wolves 1\/3/);
    assert.match(pane.textContent, /Need 2 more wolves\./);
});

test('a refused command shows its message; finished quests are listed with their outcome', async () => {
    const state = makeState({ threads: [wolves(), quest('th_old00001', 'Old Job', {}, { status: 'resolved', ended: { rev: 4, reason: 'turned down', outcome: 'declined' } })] });
    const pane = draw(state, { command: async () => ({ ok: false, code: 'INVALID', message: 'Not now.' }) });
    assert.match(pane.textContent, /Finished/);
    assert.match(pane.textContent, /Old Job — declined/);
    buttons(pane, 'Abandon')[0].click();
    await new Promise(resolve => setImmediate(resolve));
    assert.match(pane.textContent, /Not now\./);
});
