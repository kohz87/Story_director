// The Quests tab's cards (widget `story-director.quests`, src/v2/screens/quest-cards.js): display only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../../ui-fake-dom.js';
import { runtime, resolveData, skipReason } from './helpers/runtime.js';
import { closed, makeQueries, makeRunner, makeState, rats, thread, wolves } from './helpers/fixtures.js';
import { QUESTS_ID, QUESTS_WIDGET, createQuestsWidget, part, screens } from '../../../src/v2/screens/index.js';

const squash = text => String(text ?? '').replace(/\s+/g, ' ').trim();
const LONG = 'Quartermaster Hobb revealed that the missing party drew climbing iron and rope for the sunken quarry trench, not the flat peat bog';

// The fake DOM measures nothing: an element of class sd-q2 is 2 lines tall (28) and its text is 28 high when short, 56 when long
// (a text over 90 letters), unless it is open (then it shows all of it, no overflow).
function measure(doc) {
    const sample = doc.createElement('p');
    const proto = Object.getPrototypeOf(sample);
    const own = Object.getOwnPropertyDescriptor(proto, 'clientHeight');
    const cut = node => String(node.className).includes('sd-q2');
    Object.defineProperty(proto, 'clientHeight', { configurable: true, get() { return cut(this) ? 28 : 0; } });
    Object.defineProperty(proto, 'scrollHeight', { configurable: true, get() { return cut(this) ? (this.getAttribute('data-open') === 'true' || this.textContent.length <= 90 ? 28 : 56) : 0; } });
    return () => { if (own) Object.defineProperty(proto, 'clientHeight', own); else delete proto.clientHeight; delete proto.scrollHeight; };
}

function mount(threads, { memory = new Map(), measured = true } = {}) {
    const doc = installFakeDom();
    doc.head = doc.createElement('head');
    const restore = measured ? measure(doc) : () => {};
    const el = doc.createElement('div');
    doc.body.appendChild(el);
    const widget = createQuestsWidget({ memory });
    const instance = widget.render(el, { value: threads }, {});
    return { el, doc, instance, memory, widget, restore };
}
const more = el => el.querySelectorAll('button.sd-q-more');
const card = (el, id) => el.querySelector(`li[data-thread="${id}"]`);

const quest = (id, key, fields = {}, more_ = {}) => thread(id, 'quest', key, fields, more_);

test('Finished (n) counts the resolved quests and is folded until opened; Active (n) lists the open ones first', () => {
    const list = [
        quest('th_done0001', 'Gnashers', { goal: 'g' }, closed('done', 9)),
        quest('th_act00001', 'Active One', { goal: 'g' }),
        quest('th_fail0001', 'Lost Cart', { goal: 'g' }, closed('failed', 10)),
        quest('th_offr0001', 'Offered One', { goal: 'g' }, { offer: true }),
    ];
    const { el, restore } = mount(list);
    assert.equal(squash(el.querySelector('.sd-q-label').textContent), 'Active (2)');
    assert.deepEqual(el.querySelectorAll('section .sd-q').map(n => n.getAttribute('data-thread')), ['th_act00001', 'th_offr0001'], 'tracker order');
    const fold = el.querySelector('details.sd-q-fold');
    assert.equal(squash(fold.querySelector('summary').textContent), 'Finished (2)');
    assert.equal(fold.hasAttribute('open'), false, 'collapsed by default');
    assert.deepEqual(fold.querySelectorAll('.sd-q').map(n => n.getAttribute('data-thread')), ['th_done0001', 'th_fail0001']);
    restore();
});

test('the Finished fold and each More are remembered across redraws', () => {
    const memory = new Map();
    const list = [quest('th_act00001', 'Long', { goal: 'g' }, { summary: LONG }), quest('th_done0001', 'Old', { goal: 'g' }, closed('done', 9))];
    const first = mount(list, { memory });
    const fold = first.el.querySelector('details.sd-q-fold');
    fold.setAttribute('open', '');
    fold.open = true;
    fold.dispatch('toggle');
    first.restore();
    assert.equal(memory.get('finished'), true);
    const again = mount(list, { memory });
    assert.equal(again.el.querySelector('details.sd-q-fold').hasAttribute('open'), true);
    again.restore();
});

test('More shows only where the description is cut, toggles to Less, and is remembered', () => {
    const memory = new Map();
    const list = [quest('th_long0001', 'Long', { goal: 'g' }, { summary: LONG }), quest('th_short001', 'Short', { goal: 'g' }, { summary: 'Short text' })];
    const { el, instance, restore } = mount(list, { memory });
    assert.equal(more(card(el, 'th_long0001'))[0].hidden, false, 'a cut text has More');
    assert.equal(more(card(el, 'th_short001'))[0].hidden, true, 'a short text has none');
    const button = more(card(el, 'th_long0001'))[0];
    const body = card(el, 'th_long0001').querySelector('.sd-q2');
    assert.equal(squash(button.textContent), 'More');
    assert.equal(body.getAttribute('data-open'), 'false');
    button.click();
    assert.equal(squash(button.textContent), 'Less');
    assert.equal(button.getAttribute('aria-expanded'), 'true');
    assert.equal(body.getAttribute('data-open'), 'true');
    assert.equal(memory.get('more:th_long0001'), true);
    button.click();
    assert.equal(squash(button.textContent), 'More');
    button.click();
    // A redraw (update) keeps it open.
    instance.update({ value: list });
    assert.equal(card(el, 'th_long0001').querySelector('.sd-q2').getAttribute('data-open'), 'true');
    assert.equal(squash(more(card(el, 'th_long0001'))[0].textContent), 'Less');
    restore();
});

test('where nothing can be measured a long text counts as cut and a short one does not', () => {
    const { el, restore } = mount([quest('th_long0001', 'Long', { goal: 'g' }, { summary: LONG }), quest('th_short001', 'Short', { goal: 'g' }, { summary: 'Short text' })], { measured: false });
    assert.equal(more(card(el, 'th_long0001'))[0].hidden, false);
    assert.equal(more(card(el, 'th_short001'))[0].hidden, true);
    restore();
});

test('rows show only what is set; difficulty "normal" is left out, any other shows', () => {
    const { el, restore } = mount([
        quest('th_a0000001', 'Bare', { goal: 'g' }),
        quest('th_b0000001', 'Full', { goal: 'g', giver: 'Nelje', reward: '5 silver', difficulty: 'Rank E', due: 'June 20' }),
        quest('th_c0000001', 'Normal', { goal: 'g', difficulty: 'Normal' }),
    ]);
    assert.equal(card(el, 'th_a0000001').querySelector('dl'), null, 'no rows, no list');
    assert.equal(card(el, 'th_c0000001').querySelector('dl'), null, '"normal" (any case) is hidden');
    const full = card(el, 'th_b0000001').querySelector('dl');
    assert.deepEqual(full.querySelectorAll('dt').map(n => n.textContent), ['Giver', 'Reward', 'Difficulty', 'Due']);
    assert.deepEqual(full.querySelectorAll('dd').map(n => n.textContent), ['Nelje', '5 silver', 'Rank E', 'June 20']);
    restore();
});

test('the step line shows the step, else the goal; no summary means no description or More', () => {
    const { el, restore } = mount([quest('th_a0000001', 'A', { step: 'Go north', goal: 'g' }), quest('th_b0000001', 'B', { goal: 'Find it' })]);
    assert.equal(squash(card(el, 'th_a0000001').querySelector('.sd-q-step').textContent), 'Go north');
    assert.equal(squash(card(el, 'th_b0000001').querySelector('.sd-q-step').textContent), 'Find it');
    assert.equal(card(el, 'th_b0000001').querySelector('.sd-q2'), null);
    assert.equal(more(card(el, 'th_b0000001')).length, 0);
    restore();
});

test('chips: Active, Offered, Done, Failed, Abandoned, Declined, superseded', () => {
    const list = [
        quest('th_act00001', 'A', { goal: 'g' }),
        quest('th_off00001', 'B', { goal: 'g' }, { offer: true }),
        quest('th_don00001', 'C', { goal: 'g' }, closed('done', 9)),
        quest('th_fai00001', 'D', { goal: 'g' }, closed('failed', 9)),
        quest('th_aba00001', 'E', { goal: 'g' }, closed('abandoned', 9)),
        quest('th_dec00001', 'F', { goal: 'g' }, closed('declined', 9)),
        quest('th_sup00001', 'G', { goal: 'g' }, { status: 'superseded', ended: { rev: 9, reason: '', outcome: 'superseded' } }),
    ];
    const { el, restore } = mount(list);
    const chip = id => {
        const node = card(el, id).querySelector('.sd-chip');
        return [squash(node.textContent), String(node.className).split(' ').pop()];
    };
    assert.deepEqual(chip('th_act00001'), ['Active', 'sd-chip-accent']);
    assert.deepEqual(chip('th_off00001'), ['Offered', 'sd-chip-neutral']);
    assert.deepEqual(chip('th_don00001'), ['Done', 'sd-chip-good']);
    assert.deepEqual(chip('th_fai00001'), ['Failed', 'sd-chip-bad']);
    assert.deepEqual(chip('th_aba00001'), ['Abandoned', 'sd-chip-bad']);
    assert.deepEqual(chip('th_dec00001'), ['Declined', 'sd-chip-bad']);
    assert.deepEqual(chip('th_sup00001'), ['Superseded', 'sd-chip-neutral']);
    assert.equal(squash(el.querySelector('details.sd-q-fold summary').textContent), 'Finished (5)');
    restore();
});

test('only the threads the tab lists are drawn: quests, an old record with rpg, or any thread with a goal', () => {
    const { el, restore } = mount([
        quest('th_q0000001', 'Quest', {}),
        thread('th_g0000001', 'agenda', 'Has Goal', { goal: 'x' }),
        thread('th_r0000001', 'hook', 'Old Rpg', {}, { rpg: { xp: 1 } }),
        thread('th_n0000001', 'agenda', 'Not Listed', { step: 'x' }),
    ]);
    assert.deepEqual(el.querySelectorAll('.sd-q').map(n => n.getAttribute('data-thread')), ['th_q0000001', 'th_g0000001', 'th_r0000001']);
    restore();
});

test('an old chat\'s quest (rpg, owed, ready) keeps its read-only lines and its data is not changed', () => {
    const owed = { text: '12 coin', rev: 4 };
    const list = [
        quest('th_old00001', 'Old Reward', { goal: 'g' }, { owed }),
        quest('th_rpg00001', 'Old Rpg', { goal: 'g' }, { rpg: { xp: 5 }, owed }),
        quest('th_rdy00001', 'Old Ready', { goal: 'g' }, { ready: { rev: 3 } }),
        quest('th_new00001', 'Plain', { goal: 'g' }),
    ];
    const frozen = JSON.parse(JSON.stringify(list));
    Object.freeze(list); list.forEach(Object.freeze);
    const { el, restore } = mount(list);
    const lines = id => card(el, id).querySelectorAll('.sd-q-old').map(n => squash(n.textContent));
    assert.deepEqual(lines('th_old00001'), ['From an earlier version (read only)', 'Reward from an earlier version: 12 coin']);
    assert.deepEqual(lines('th_rpg00001'), ['From an earlier version (read only)'], 'with rpg the v1 reward line is not repeated, as today');
    assert.deepEqual(lines('th_rdy00001'), ['From an earlier version (read only)']);
    assert.deepEqual(lines('th_new00001'), []);
    assert.deepEqual(JSON.parse(JSON.stringify(list)), frozen);
    restore();
});

test('text goes in as text: markup in a title, summary or field stays text, and no button acts on the story', () => {
    const { el, restore } = mount([quest('th_x0000001', '<img src=x onerror=boom()>', { goal: '<b>g</b>', giver: '<i>G</i>' }, { summary: '<script>boom()</script>' })]);
    assert.equal(el.querySelectorAll('img, script, b b, i').length, 0);
    assert.equal(squash(el.querySelector('.sd-qt').textContent), '<img src=x onerror=boom()>');
    assert.deepEqual(el.querySelectorAll('button').map(n => String(n.className)), ['sd-q-more']);
    restore();
});

test('an empty list says so; a bad value is refused by validate', () => {
    const { el, widget, restore } = mount([]);
    assert.match(squash(el.textContent), /No quests or goals yet/);
    assert.deepEqual(widget.validate({ value: [] }), []);
    assert.equal(widget.validate({ value: 'x' }).length, 1);
    restore();
});

test('registered as story-director.quests and placed by the Quests screen, with the plain list kept as the fallback', () => {
    assert.equal(QUESTS_WIDGET, 'story-director.quests');
    assert.equal(typeof part.widgets[QUESTS_WIDGET].render, 'function');
    const screen = screens.find(entry => entry.id === QUESTS_ID);
    assert.match(screen.template, /<ss-widget[^>]*name="story-director\.quests"[^>]*q\.threads/);
    assert.match(screen.template, /sd-plain/);
    assert.match(screen.template, /From an earlier version/);
    assert.doesNotMatch(screen.template, /data-command/);
    assert.match(screen.css, /\.sd-qw:has\(\.sd-q-root\) \+ \.sd-plain \{ display: none; \}/);
    assert.match(screen.css, /var\(--ss-muted, [^)#]/, 'tokens come with fallbacks (no hex: the screens carry no palette of their own)');
});

const skip = runtime ? false : skipReason;
function drawScreen(state, widgets) {
    const { run } = makeRunner(makeQueries());
    const screen = screens.find(entry => entry.id === QUESTS_ID);
    const doc = installFakeDom();
    doc.head = doc.createElement('head');
    const el = doc.createElement('div');
    el.setAttribute('data-ss-screen', QUESTS_ID);
    doc.body.appendChild(el);
    const data = resolveData(screen.data, (name, args) => run(state, name, args));
    const compiled = runtime.compileTemplate(screen.template);
    const warnings = [...compiled.warnings];
    runtime.renderTemplate(el, compiled, { state, q: data.q, changes: [], settings: {}, mount: 'tab', screenId: QUESTS_ID, api: {} }, { evaluate: runtime.evaluate, widgets, formatters: {}, command: null, onWarn: m => warnings.push(m) });
    return { el, warnings };
}

test('in Story Block\'s renderer the widget draws the cards from director.threads; an older host without it still lists the quests', { skip }, () => {
    const state = makeState({ threads: [wolves(), rats(), quest('th_done0001', 'Gnashers', { goal: 'g' }, closed('done', 9))] });
    const withWidget = drawScreen(state, { ...runtime.widgets, [QUESTS_WIDGET]: part.widgets[QUESTS_WIDGET] });
    assert.deepEqual(withWidget.warnings, []);
    assert.equal(withWidget.el.querySelectorAll('.sd-q-root .sd-q').length, 3);
    assert.equal(squash(withWidget.el.querySelector('details.sd-q-fold summary').textContent), 'Finished (1)');
    const without = drawScreen(state, { ...runtime.widgets });
    assert.match(without.warnings.join(' '), /no widget called "story-director\.quests"/i);
    assert.equal(without.el.querySelector('.sd-q-root'), null);
    const plain = squash(without.el.querySelector('.sd-plain').textContent);
    for (const name of ['East Bluff Wolves', 'Granary Rats', 'Gnashers']) assert.match(plain, new RegExp(name));
});
