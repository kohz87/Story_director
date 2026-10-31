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
    assert.deepEqual(rows.map(([label]) => label), ['Time', 'Place', 'Goal']);
    assert.deepEqual(rows[0], ['Time', 'June 11, 2025, 09:00 am']);
    assert.deepEqual(rows[1], ['Place', 'Bluewatch Village · Eastmarch']);
    // The goal row holds the progress bar (its text is the bar's own label, not part of the goal line).
    assert.ok(rows[2][1].startsWith('East Bluff Wolves — Clear at least 3 wolves from East Bluff Now: Hunt along the ridge'), rows[2][1]);
    // What comes next is the Director screen's, behind Reveal: a spoiler under the reply (user, beta).
    assert.equal(el.querySelector('.sd-next'), null);
    assert.equal(byId[STATUS_CARD_ID].data.next, undefined);
    assert.equal(rows.some(([label]) => label === 'Next'), false);
    // No atlas place and no weather query here: neither is shown.
    assert.equal(el.querySelector('.sd-coords'), null);
    assert.equal(el.querySelector('.sd-weather'), null);
    assert.ok(el.querySelector('.sd-time').classList.contains('sd-new'));
    assert.ok(el.querySelector('.sd-goal').classList.contains('sd-new'));
    assert.equal(el.querySelector('.sd-place').classList.contains('sd-new'), false);
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
    // Time, Weather, Place, Coordinates (its own row; the place does not carry the coordinates any more).
    assert.deepEqual(rows.slice(0, 4), [
        ['Time', 'June 11, 2025, 09:00 am'],
        ['Weather', 'Light rain over the sluices'],
        ['Place', 'Bluewatch Village · Eastmarch'],
        ['Coordinates', '59, 110'],
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

test('status card: a Travel row (icon fa-route) after Coordinates while a trip is on, that reply\'s trip; left out with none or with the feature off', { skip }, () => {
    const now = at('June 11, 2025, 9:00 am');
    const leg = (from, to, km, days, start) => ({ from, to, km, kind: 'frontier road', days, start, arrive: start + days * 1440 });
    const withTrip = (minutes, state = headState()) => ({
        ...state,
        domains: {
            ...state.domains,
            director: { ...state.domains.director, time: { minutes } },
            atlas: {
                places: {}, routes: {}, keys: {}, focus: null,
                trips: { '21.0': { kind: 'go', at: now, rev: 21, to: 'Wolfmere Outpost', by: 'foot', mode: 'foot', pace: 20, unit: 'day', mount: '', short: false, setOut: now, legs: [leg('Bluewatch Village', "Hollin's Reach", 100, 5, now), leg("Hollin's Reach", 'Wolfmere Outpost', 60, 3, now + 5 * 1440)] } },
            },
        },
    });
    const queries = { ...makeQueries(), 'atlas.here': () => ({ id: 'pl_guild001', name: 'Bluewatch Village', kind: 'settlement' }), 'atlas.place': () => ({ id: 'pl_guild001', x: 64, y: 110 }) };
    const rowsOf = el => el.querySelectorAll('.sd-row').map(row => [row.querySelector('dt').textContent.trim(), squash(row.querySelector('dd').textContent)]);
    const { el, warnings } = draw(STATUS_CARD_ID, withTrip(now + 2 * 1440), { queries });
    assert.deepEqual(warnings, []);
    const rows = rowsOf(el);
    assert.deepEqual(rows.map(([label]) => label), ['Time', 'Place', 'Coordinates', 'Travel', 'Goal']);
    assert.deepEqual(rows[3], ['Travel', "Bluewatch Village → Hollin's Reach → Wolfmere Outpost · on foot, 20 km/day · leg 1 of 2 · arrive Wolfmere Outpost June 19"]);
    assert.ok(el.querySelector('.sd-travel i').classList.contains('fa-route'));
    // Arrived: the row says so; the place has moved on elsewhere: no row.
    assert.deepEqual(rowsOf(draw(STATUS_CARD_ID, withTrip(now + 9 * 1440), { queries }).el).find(([label]) => label === 'Travel'), ['Travel', 'Arrived at Wolfmere Outpost, June 19']);
    const moved = withTrip(now + 9 * 1440);
    moved.domains.scene = { ...moved.domains.scene, place: { name: 'Eastmarch Keep', kind: '', region: '' } };
    assert.equal(draw(STATUS_CARD_ID, moved, { queries }).el.querySelector('.sd-travel'), null);
    // A feature that is off answers null (Story Block's feature tag on the query): no row, no warning.
    const off = draw(STATUS_CARD_ID, withTrip(now + 2 * 1440), { queries: { ...queries, 'atlas.trip': () => null } });
    assert.deepEqual(off.warnings, []);
    assert.equal(off.el.querySelector('.sd-travel'), null);
    assert.equal(draw(STATUS_CARD_ID, headState(), { queries }).el.querySelector('.sd-travel'), null, 'no trip');
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
    assert.doesNotMatch(text(1), /Bluewatch|Wolves 8\/3|Bandit Raid/);
    assert.ok(body(1).querySelector('.sd-place').classList.contains('sd-new'), 'reply 1 moved the place');

    assert.match(text(3), /June 11, 2025, 09:00 am/);
    assert.match(text(3), /Bluewatch Village/);
    assert.doesNotMatch(text(3), /Harvest Fair|Bandit Raid/, 'no next beat under a reply');
    assert.equal(body(3).querySelector('.sd-place').classList.contains('sd-new'), false);
    assert.equal(body(1).getAttribute('data-ss-screen'), STATUS_CARD_ID);

    // Every binding of reply 1's card ran on reply 1's state.
    const forOne = calls.filter(call => call.state === states[1]).map(call => call.name);
    assert.ok(['director.time', 'director.status', 'director.goal'].every(name => forOne.includes(name)) && !forOne.includes('director.next'));
    // The reader turns it off: gone from under the replies.
    registry.setCards(STATUS_CARD_ID, false);
    cards.refreshAll({ force: true });
    assert.deepEqual(reader.cards, { [STATUS_CARD_ID]: false });
    assert.ok(messages[1].querySelector('.ss-card') === null && messages[3].querySelector('.ss-card') === null, 'no card once turned off');
    cards.destroy();
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

test('status card rows: a row with no value is left out; no box of its own (the rows sit in the fold)', { skip }, () => {
    const queries = {
        ...makeQueries(),
        'atlas.here': () => null,
        'scene.weather': () => null,
    };
    // Nothing known but the time: one row, no goal, no weather, no coordinates, no place.
    const { el: timeOnly } = draw(STATUS_CARD_ID, makeState({ minutes: at('June 11, 2025, 9:00 am') }), { queries });
    assert.deepEqual(timeOnly.querySelectorAll('.sd-row').map(row => row.querySelector('dt').textContent.trim()), ['Time']);
    // The full card: the five fields in order, with the goal's progress inside its row.
    const { el } = draw(STATUS_CARD_ID, headState());
    assert.deepEqual(el.querySelectorAll('.sd-row').map(row => row.querySelector('dt').textContent.trim()), ['Time', 'Place', 'Goal']);
    // No box: the list is not a glass or bordered panel; the labels are muted small caps; the values are body text.
    const dl = el.querySelector('dl.sd-status');
    assert.ok(dl, 'the card is a definition list');
    assert.equal(dl.classList.contains('ss-glass'), false, 'no second glass box inside the fold');
    assert.equal(/ss-glass|ss-tile|ss-card/.test(dl.className), false);
    const css = byId[STATUS_CARD_ID].css;
    assert.match(css, /\.sd-status \{[^}]*background: none;[^}]*border: 0;[^}]*box-shadow: none;/);
    assert.match(css, /\.sd-status \{[^}]*gap: 6px 14px;/, 'six pixels between the rows');
    assert.match(css, /\.sd-row > dt \{[^}]*font-variant: small-caps;[^}]*color: color-mix\(in srgb, var\(--sd-text\) 80%, transparent\);/);
    assert.match(css, /\.sd-row > dd \{[^}]*color: var\(--sd-text\);/);
    // A changed value reads in the accent's text tone (4.5:1 or more), not the accent itself.
    assert.match(css, /\.sd-new > dd \{ color: var\(--sd-accent-text\); \}/);
    // An unset clock: no Time row, the place and goal still shown.
    const { el: noClock } = draw(STATUS_CARD_ID, headState({ minutes: null }));
    assert.deepEqual(noClock.querySelectorAll('.sd-row').map(row => row.querySelector('dt').textContent.trim()), ['Place', 'Goal']);
});
