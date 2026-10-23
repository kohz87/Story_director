// Screens part: the four screens drawn by Story Block's template renderer (SPEC §13.2) against fixture
// states, with the real condition language and standard widgets; the status card through Story Block's
// card mount, which draws each reply's card from that reply's state (stateAt). Needs a Story Block
// checkout (STORY_BLOCK_DIR, see helpers/runtime.js); skipped with the reason otherwise.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../../ui-fake-dom.js';
import { resolveData, runtime, skipReason } from './helpers/runtime.js';
import { at, calendar, earlierState, headState, makeQueries, makeRunner, makeState, rats, wolves } from './helpers/fixtures.js';
import { DIRECTOR_ID, QUESTS_ID, STATUS_CARD_ID, createBehindWidget, part, screens } from '../../../src/v2/screens/index.js';
import { createArcWidget } from '../../../src/v2/arc/widget.js';

// The module's own widgets on the Director screen, with a planner that is not there and a reveal choice
// the test sets (shown unless a test hides it).
let shown = true;
const stillReveal = { guard: () => true, revealed: () => shown, set: on => { shown = on; }, hidden: () => !shown, subscribe: () => () => {} };
const noPlanner = { status: () => ({ available: true, busy: false, draft: null, error: '', hidden: !shown, arc: null }), subscribe: () => () => {}, plan() {}, end() {} };
const moduleWidgets = () => ({ ...runtime.widgets, 'story-director.arc': createArcWidget({ controller: noPlanner }), 'story-director.behind': createBehindWidget({ reveal: stillReveal }) });

const skip = runtime ? false : skipReason;
const byId = Object.fromEntries(screens.map(screen => [screen.id, screen]));
const formatters = { time: minutes => (Number.isInteger(minutes) ? calendar.format(minutes) : '') };
const squash = text => String(text ?? '').replace(/\s+/g, ' ').trim();

function draw(id, state, { command = null, changes = [], mount = byId[id].mounts[0], queries = makeQueries() } = {}) {
    const { run } = makeRunner(queries);
    const screen = byId[id];
    const doc = installFakeDom();
    doc.head = doc.createElement('head');
    const el = doc.createElement('div');
    el.setAttribute('data-ss-screen', id);
    doc.body.appendChild(el);
    const data = resolveData(screen.data, (name, args) => run(state, name, args));
    assert.equal(data.ok, true);
    const compiled = runtime.compileTemplate(screen.template);
    const warnings = [...compiled.warnings];
    const results = [];
    const view = runtime.renderTemplate(el, compiled, { state, q: data.q, changes, settings: {}, mount, screenId: id, api: {} }, {
        evaluate: runtime.evaluate,
        widgets: moduleWidgets(),
        formatters,
        command,
        onWarn: message => warnings.push(message),
        onResult: result => results.push(result),
    });
    return { el, view, warnings, results, doc };
}

const button = (root, label) => root.querySelectorAll('button').filter(node => squash(node.textContent) === label);

test('every screen compiles and renders without a warning, and its CSS scopes cleanly', { skip }, () => {
    for (const screen of screens) {
        const { warnings } = draw(screen.id, headState());
        assert.deepEqual(warnings, [], screen.id);
        const scoped = runtime.scopeCss(screen.css, screen.id);
        assert.deepEqual(scoped.warnings, [], `${screen.id} css`);
        const prefix = `[data-ss-screen="${screen.id}"]`;
        // Every selector of every rule starts at the screen root.
        for (const match of scoped.css.matchAll(/(^|})\s*([^{}@]+)\{/g)) {
            const selectors = match[2].split(',').map(part => part.trim()).filter(Boolean);
            for (const selector of selectors) assert.ok(selector.startsWith(prefix), `${screen.id}: ${selector}`);
        }
    }
});

test('quests: no Offered list and no buttons (F95); an older chat\'s offer is not drawn', { skip }, () => {
    const { el } = draw(QUESTS_ID, headState());
    assert.equal(el.querySelector('.sd-offer'), null);
    assert.equal(el.querySelector('[data-quest="th_rats0001"]'), null);
    assert.doesNotMatch(squash(el.textContent), /Offered|say you take/);
    assert.equal(el.querySelectorAll('button').length, 0, 'no buttons anywhere on the board');
});

test('quests: active progress is an ss.bar ("Wolves 8/3") with the row\'s status and progress note', { skip }, () => {
    const { el } = draw(QUESTS_ID, headState());
    const [hunt, hides] = el.querySelectorAll('.sd-quest');
    assert.equal(hunt.getAttribute('data-quest'), 'th_wolves01');
    const meter = hunt.querySelector('.sd-bar .ss-bar');
    assert.ok(meter, 'the bar block is drawn');
    assert.equal(squash(meter.querySelector('.ss-bar-label').textContent), 'Wolves 8/3');
    assert.equal(meter.getAttribute('aria-valuenow'), '3');
    assert.equal(meter.getAttribute('aria-valuemax'), '3');
    assert.equal(meter.getAttribute('aria-valuetext'), '8 of 3');
    assert.ok(hunt.classList.contains('sd-met'));
    assert.ok(hunt.classList.contains('sd-ready'));
    assert.equal(squash(hunt.querySelector('.sd-status').textContent), 'Ready to turn in — 8/3 wolves');
    assert.equal(squash(hunt.querySelector('.sd-now').textContent), 'Now: Hunt along the ridge');

    assert.equal(squash(hides.querySelector('.ss-bar-label').textContent), 'Wolf pelt 2/5');
    assert.equal(hides.classList.contains('sd-met'), false);
    assert.equal(squash(hides.querySelector('.sd-status').textContent), 'Not yet: 2/5 wolf pelt');
});

test('quests: met but away says where to turn it in; an untaken quest says so', { skip }, () => {
    const away = makeState({
        threads: [wolves()], beaten: [{ rev: 11, foes: [{ name: 'Wolf', count: 8 }], won: true }], place: { name: 'East Bluff', kind: 'wild' },
    });
    const quest = draw(QUESTS_ID, away).el.querySelector('.sd-quest');
    assert.equal(squash(quest.querySelector('.sd-status').textContent), 'Ready — 8/3 wolves; turn it in at a settlement or where Orsa is.');
    assert.ok(quest.classList.contains('sd-met'));
    assert.equal(quest.classList.contains('sd-ready'), false);
    const untaken = draw(QUESTS_ID, makeState({ threads: [wolves({ taken: null })] })).el.querySelector('.sd-quest');
    assert.equal(squash(untaken.querySelector('.sd-status').textContent), 'Not taken on');
});

test('quests: each row opens its details (F84): goal, progress, terms, rank, giver, dates and history', { skip }, () => {
    const minutes = calendar.parse('June 9, 2025, 8:00 am', { reference: null }).abs;
    const state = makeState({
        minutes,
        threads: [wolves({ taken: { rev: 10, at: minutes }, fields: { goal: 'Clear at least 3 wolves', giver: 'Orsa', step: 'Hunt along the ridge', rank: 'F', due: 'June 20, 2025' }, reward: { amount: 900, each: false, unit: '', text: '900 gold' } })],
        beaten: [{ rev: 11, foes: [{ name: 'Wolf', count: 1 }], won: true }],
    });
    const { el } = draw(QUESTS_ID, state);
    const more = el.querySelector('.sd-quest details.sd-more');
    assert.ok(more, 'a details panel on the row');
    assert.equal(more.hasAttribute('open'), false, 'closed until the reader opens it');
    const facts = Object.fromEntries(more.querySelectorAll('.sd-facts > div').map(row => [squash(row.querySelector('dt').textContent), squash(row.querySelector('dd').textContent)]));
    assert.equal(facts.Goal, 'Clear at least 3 wolves');
    assert.equal(facts.Progress, 'Hunt along the ridge');
    assert.equal(facts.Terms, 'beat 3 wolves; 900 gold (reward clamped to F-rank range: 10–50 gold (clamped from 900 gold)); F-rank');
    assert.equal(facts.Rank, 'F-rank');
    assert.equal(facts.Giver, 'Orsa');
    assert.equal(facts.Due, 'June 20, 2025');
    assert.equal(facts['Taken on'], calendar.format(minutes));
    assert.equal(facts.Ended, undefined);
});

test('quests: finished quests are folded away; an empty board says so', { skip }, () => {
    const { el } = draw(QUESTS_ID, headState());
    const finished = el.querySelector('details.sd-finished');
    assert.ok(finished);
    assert.equal(finished.hasAttribute('open'), false, 'collapsed');
    assert.match(squash(finished.textContent), /Finished 1 Lost Ring Done returned it/);
    const { el: empty } = draw(QUESTS_ID, makeState());
    assert.equal(empty.querySelector('.sd-offers'), null);
    assert.equal(empty.querySelector('details.sd-finished'), null);
    assert.equal(squash(empty.querySelector('.ss-listcard-empty').textContent), 'No quests taken on.');
});

test('quests: rendering again after a turn-in updates the same page', { skip }, () => {
    const { el, view } = draw(QUESTS_ID, headState());
    const { run } = makeRunner();
    const after = headState({ threads: [wolves({ status: 'resolved', ended: { rev: 21, reason: 'paid 8 coin', outcome: 'done' }, rev: 21 })] });
    view.update({ state: after, q: resolveData(byId[QUESTS_ID].data, (name, args) => run(after, name, args)).q, changes: [], settings: {} });
    assert.equal(el.querySelectorAll('.sd-quest').length, 0);
    assert.match(squash(el.querySelector('details.sd-finished').textContent), /East Bluff Wolves Done paid 8 coin/);
});

test('director: the header shows the story time on the chat\'s calendar and the place; offered and ready tags', { skip }, () => {
    const { el } = draw(DIRECTOR_ID, headState());
    assert.equal(squash(el.querySelector('header.sd-clock').textContent), `${calendar.format(at('June 11, 2025, 9:00 am'))} · Bluewatch Village`);
    const { el: unset } = draw(DIRECTOR_ID, makeState({ threads: [wolves()] }));
    assert.equal(unset.querySelector('header.sd-clock'), null, 'no clock line before the story sets the time');
    const held = draw(DIRECTOR_ID, makeState({ threads: [wolves({ ready: { rev: 12 } }), rats({ shown: { turn: 9 } })] })).el;
    // An older chat's offer: tagged "offered" here only (the quiet note), never "held".
    assert.match(squash(held.querySelector('[data-thread="th_rats0001"]').textContent), /offered/);
    assert.doesNotMatch(squash(held.querySelector('[data-thread="th_rats0001"]').textContent), /held/);
    assert.match(squash(held.querySelector('[data-thread="th_wolves01"]').textContent), /ready/);
});

test('director: threads by kind, open first and closed folded, secrets by name, problems newest first', { skip }, () => {
    const { el } = draw(DIRECTOR_ID, headState());
    const kinds = el.querySelectorAll('section.sd-kind').map(node => node.getAttribute('data-kind'));
    // The arc panel, what the reader may see, then behind the scenes (revealed here), then the problems.
    assert.deepEqual(kinds, ['arc', 'quest', 'event', 'agenda', 'clock', 'secret', 'problems']);
    const quests = el.querySelector('section[data-kind="quest"]');
    const open = quests.querySelectorAll(':scope > ul > li').map(node => squash(node.querySelector('.ss-listcard-title').textContent));
    assert.deepEqual(open, ['East Bluff Wolves', 'Tanner Pelts', 'Granary Rats']);
    assert.match(squash(quests.querySelector('[data-thread="th_rats0001"]').textContent), /offered/);
    const closedBox = quests.querySelector('details.sd-closed');
    assert.equal(closedBox.hasAttribute('open'), false);
    assert.match(squash(closedBox.textContent), /Closed 1 Lost Ring done/);
    const agenda = squash(el.querySelector('section[data-kind="agenda"]').textContent);
    assert.match(agenda, /Smuggler Vane moving crates at night At: the docks Next: meet the reeve/);
    const secret = el.querySelector('section[data-kind="secret"] .sd-thread');
    assert.equal(squash(secret.textContent), 'The Reeve Is Bought', 'a secret shows only its name');
    const problems = el.querySelectorAll('.sd-problem').map(node => squash(node.textContent));
    assert.equal(problems.length, 2);
    assert.match(problems[1], /The story time is not set yet/);
    assert.equal(el.querySelector('.sd-empty'), null);
    const { el: none } = draw(DIRECTOR_ID, makeState());
    assert.match(squash(none.textContent), /No arc planned yet\. Plan arc Nothing tracked yet\.$/);
    assert.equal(none.querySelector('.sd-behind'), null, 'nothing behind the scenes: no Reveal panel');
});

test('status card: time, place, goal and step, progress, with what this reply changed marked; no next beat', { skip }, () => {
    const changes = ['/domains/director/time/minutes', '/domains/director/threads/th_wolves01/rev'];
    const { el } = draw(STATUS_CARD_ID, headState(), { changes });
    const rows = el.querySelectorAll('.sd-row').map(row => [row.querySelector('dt').textContent.trim(), squash(row.querySelector('dd').textContent)]);
    assert.deepEqual(rows.slice(0, 3), [
        ['Time', 'June 11, 2025, 09:00 am'],
        ['Place', 'Bluewatch Village · Eastmarch'],
        ['Goal', 'East Bluff Wolves — Clear at least 3 wolves from East Bluff Now: Hunt along the ridge'],
    ]);
    assert.equal(rows[3][0], 'Progress');
    // What comes next is the Director screen's, behind Reveal: a spoiler under the reply (user, beta).
    assert.equal(el.querySelector('.sd-next'), null);
    assert.equal(byId[STATUS_CARD_ID].data.next, undefined);
    assert.equal(rows.some(([label]) => label === 'Next'), false);
    // No atlas place and no weather query here: neither is shown.
    assert.equal(el.querySelector('.sd-coords'), null);
    assert.equal(el.querySelector('.sd-weather'), null);
    assert.equal(squash(el.querySelector('.sd-progress .ss-bar-label').textContent), 'Wolves 8/3');
    assert.ok(el.querySelector('.sd-time').classList.contains('sd-new'));
    assert.ok(el.querySelector('.sd-goal').classList.contains('sd-new'));
    assert.equal(el.querySelector('.sd-place').classList.contains('sd-new'), false);
    assert.ok(el.querySelector('.sd-progress').classList.contains('sd-met'));
    // Nothing tracked: only what there is.
    const { el: bare } = draw(STATUS_CARD_ID, makeState({ place: { name: 'Nowhere' } }));
    assert.deepEqual(bare.querySelectorAll('.sd-row').map(row => row.querySelector('dt').textContent.trim()), ['Place']);
});

test('status card: the place\'s map coordinates when the atlas knows it, and Story Block\'s weather when the story set one', { skip }, () => {
    const queries = {
        ...makeQueries(),
        'atlas.here': () => ({ id: 'pl_guild001', name: 'Bluewatch Village', kind: 'settlement' }),
        'atlas.place': (_state, args) => (args?.id === 'pl_guild001' ? { id: 'pl_guild001', name: 'Bluewatch Village', x: 59.4, y: 110 } : null),
        // The contract of the coming Story Block query (scene.weather → { text } | null, from `~ weather <text>`).
        'scene.weather': () => ({ text: 'Light rain over the sluices' }),
    };
    const { el, warnings } = draw(STATUS_CARD_ID, headState(), { queries });
    assert.deepEqual(warnings, []);
    const rows = el.querySelectorAll('.sd-row').map(row => [row.querySelector('dt').textContent.trim(), squash(row.querySelector('dd').textContent)]);
    assert.deepEqual(rows.slice(0, 3), [
        ['Time', 'June 11, 2025, 09:00 am'],
        ['Place', 'Bluewatch Village · 59, 110 · Eastmarch'],
        ['Weather', 'Light rain over the sluices'],
    ]);
    // Unknown to the atlas, no position, no weather (null): nothing of either, and no error.
    for (const more of [
        { 'atlas.here': () => null, 'scene.weather': () => null },
        { 'atlas.here': () => ({ id: 'pl_guild001' }), 'atlas.place': () => ({ id: 'pl_guild001', x: null, y: 4 }), 'scene.weather': () => ({ text: '  ' }) },
        { 'atlas.here': () => { throw new Error('no atlas'); }, 'scene.weather': () => { throw new Error('older Story Block'); } },
    ]) {
        const { el: plain } = draw(STATUS_CARD_ID, headState(), { queries: { ...makeQueries(), ...more } });
        assert.equal(plain.querySelector('.sd-coords'), null);
        assert.equal(plain.querySelector('.sd-weather'), null);
        assert.equal(squash(plain.querySelector('.sd-place dd').textContent), 'Bluewatch Village · Eastmarch');
    }
});

test('status card: each reply\'s card is drawn from that reply\'s state (stateAt), not the head', { skip }, () => {
    const doc = installFakeDom();
    doc.head = doc.createElement('head');
    const { run, calls } = makeRunner();
    const states = { 1: earlierState(), 3: headState() };
    const changes = { 1: ['/domains/scene/place'], 3: [] };
    const messages = {};
    for (const index of [1, 3]) {
        const message = doc.createElement('div');
        message.className = 'mes';
        message.setAttribute('mesid', String(index));
        const block = doc.createElement('div');
        block.className = 'mes_block';
        message.appendChild(block);
        doc.body.appendChild(message);
        messages[index] = message;
    }
    // The reader's screen settings (extension_settings.storySuite.{screens, cards} live): none yet.
    let reader = {};
    const registry = runtime.createScreens({ reader: () => reader, saveReader: next => { reader = next; } });
    registry.addModule('story-director', part.screens);
    const compiled = new Map();
    const render = (el, screen, scope) => {
        if (!compiled.has(screen.id)) compiled.set(screen.id, runtime.compileTemplate(screen.template));
        return runtime.renderTemplate(el, compiled.get(screen.id), scope, { evaluate: runtime.evaluate, widgets: runtime.widgets, formatters });
    };
    const cards = runtime.createCardMount({
        screens: registry, render, document: doc, IntersectionObserver: null,
        stateAt: index => states[index], headIndex: () => 3, carriers: () => [1, 3],
        changesAt: index => changes[index], messageElement: index => messages[index],
        query: (name, args, state) => run(state, name, args),
    });
    // No `enabled` given: the registry's cardsOn decides, and the status card says `defaultOn: true`.
    assert.equal(registry.cardsOn(STATUS_CARD_ID), true);
    cards.attachAll();
    cards.toggle(1, STATUS_CARD_ID, true);
    cards.toggle(3, STATUS_CARD_ID, true);
    const body = index => messages[index].querySelector('.ss-card-body');
    const text = index => squash(body(index).textContent);

    assert.match(text(1), /June 10, 2025, 06:30 pm/);
    assert.match(text(1), /Mill Road · Eastmarch/);
    assert.match(text(1), /Tanner Pelts — Bring 5 wolf pelts/);
    assert.match(text(1), /Wolf pelt 1\/5/);
    assert.doesNotMatch(text(1), /Bluewatch|Wolves 8\/3|Bandit Raid/);
    assert.ok(body(1).querySelector('.sd-place').classList.contains('sd-new'), 'reply 1 moved the place');

    assert.match(text(3), /June 11, 2025, 09:00 am/);
    assert.match(text(3), /Bluewatch Village/);
    assert.doesNotMatch(text(3), /Harvest Fair|Bandit Raid/, 'no next beat under a reply');
    assert.match(text(3), /Wolves 8\/3/);
    assert.equal(body(3).querySelector('.sd-place').classList.contains('sd-new'), false);
    assert.equal(body(1).getAttribute('data-ss-screen'), STATUS_CARD_ID);

    // Every binding of reply 1's card ran on reply 1's state.
    const forOne = calls.filter(call => call.state === states[1]).map(call => call.name);
    assert.ok(['director.time', 'director.status', 'director.goal', 'quest.progress'].every(name => forOne.includes(name)) && !forOne.includes('director.next'));
    // The reader turns it off: gone from under the replies.
    registry.setCards(STATUS_CARD_ID, false);
    cards.refreshAll({ force: true });
    assert.deepEqual(reader.cards, { [STATUS_CARD_ID]: false });
    assert.ok(messages[1].querySelector('.ss-card') === null && messages[3].querySelector('.ss-card') === null, 'no card once turned off');
    cards.destroy();
});

test('quests: the reward is a pill that says Reward and the amount, as the reader reads it', { skip }, () => {
    const { el } = draw(QUESTS_ID, headState());
    const hunt = el.querySelector('.sd-quest');
    const reward = hunt.querySelector('.sd-reward');
    assert.ok(reward, 'the reward pill is drawn');
    assert.match(squash(reward.textContent), /^Reward \S/);
});

test('director: a ready thread is an outline pill and an offer a soft one, so the two read apart', { skip }, () => {
    const state = makeState({ rev: 20, minutes: at('June 11, 2025, 9:00 am'), threads: [wolves({ ready: { rev: 11 } }), rats()] });
    const { el } = draw(DIRECTOR_ID, state);
    const ready = el.querySelector('.sd-ready');
    assert.ok(ready, 'a ready thread is drawn');
    assert.equal(squash(ready.textContent), 'ready');
    assert.equal(ready.classList.contains('ss-pill-outline'), true);
    const offered = el.querySelector('[data-thread="th_rats0001"] .ss-pill');
    assert.equal(squash(offered.textContent), 'offered');
    assert.equal(offered.classList.contains('ss-pill-soft'), true);
    assert.equal(offered.classList.contains('ss-pill-outline'), false, 'the two are different pills');
});
