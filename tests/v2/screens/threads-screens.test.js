// The UI cleanup of Story Director's screens (approved 1-3): one scene header (the Game view's hero draws the place, time and
// weather, so the Director and World screens do not draw them again there), the Director's card grid that never overlaps,
// the world-building threads feature's panels, and the Status card's own title and one-line summary.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../../ui-fake-dom.js';
import { resolveData, runtime, skipReason } from './helpers/runtime.js';
import { at, calendar, headState, makeQueries, makeRunner, makeState, plot, smuggler, thread, wolves } from './helpers/fixtures.js';
import { DIRECTOR_ID, STATUS_CARD_ID, createBehindWidget, planWidget, screens } from '../../../src/v2/screens/index.js';
import { statusExtras, clockText } from '../../../src/v2/screens/queries.js';
import { STATUS_SUMMARY, STATUS_TITLE, statusCardScreen } from '../../../src/v2/screens/status-card.js';
import { BASE_CSS } from '../../../src/v2/screens/style.js';
import { directorScreen } from '../../../src/v2/screens/director.js';
import { worldScreen, createPeopleWidget, foldWidget } from '../../../src/v2/world/index.js';
import { makeCalendar } from '../../../src/calendar.js';
import { createArcWidget } from '../../../src/v2/arc/widget.js';

const skip = runtime ? false : skipReason;
const squash = text => String(text ?? '').replace(/\s+/g, ' ').trim();
const noPlanner = { status: () => ({ available: true, busy: false, draft: null, error: '', hidden: false, arc: null }), subscribe: () => () => {}, plan() {}, end() {} };
const stillReveal = { guard: () => true, revealed: () => true, set() {}, hidden: () => false, subscribe: () => () => {} };

function draw(screen, state, { queries = makeQueries(), q = null, mount = 'screen' } = {}) {
    const { run } = makeRunner(queries);
    const doc = installFakeDom();
    doc.head = doc.createElement('head');
    const el = doc.createElement('div');
    el.setAttribute('data-ss-screen', screen.id);
    el.setAttribute('data-ss-mount', mount);
    doc.body.appendChild(el);
    const data = q ? { ok: true, q } : resolveData(screen.data, (name, args) => run(state, name, args));
    assert.equal(data.ok, true);
    const compiled = runtime.compileTemplate(screen.template);
    const warnings = [...compiled.warnings];
    runtime.renderTemplate(el, compiled, { state, q: data.q, changes: [], settings: {}, mount, screenId: screen.id, api: {} }, {
        evaluate: runtime.evaluate,
        widgets: { ...runtime.widgets, 'story-director.arc': createArcWidget({ controller: noPlanner }), 'story-director.behind': createBehindWidget({ reveal: stillReveal }), 'story-director.people': createPeopleWidget(), 'story-director.plan': planWidget, 'story-director.fold': foldWidget },
        formatters: { time: minutes => (Number.isInteger(minutes) ? calendar.format(minutes) : '') },
        onWarn: message => warnings.push(message),
    });
    return { el, warnings };
}
const kindsOf = el => el.querySelectorAll('section.sd-kind').map(node => node.getAttribute('data-kind'));

const hook = (id, key, then, more = {}) => thread(id, 'hook', key, { then }, { summary: `about ${key}`, ...more });
const cardsOf = el => el.querySelectorAll('section.sd-plan-card').map(node => node.getAttribute('data-kind'));

test('director: the arc, then Beats, the hooks being planned (with Next), Off-screen, Secrets and Problems; no clock, Quests or World list', { skip }, () => {
    const state = headState({ threads: [wolves(), smuggler(), plot(), hook('th_hook0001', 'Toll Audit', 'the wagons are impounded')] });
    const { el, warnings } = draw(directorScreen, state);
    assert.deepEqual(warnings, []);
    assert.deepEqual(kindsOf(el), ['arc', 'hook', 'agenda', 'secret', 'problem']);
    assert.deepEqual(cardsOf(el), ['hook', 'agenda', 'secret', 'problem'], 'no beats in this state; no clocks, Quests or World');
    assert.equal(el.querySelector('header.sd-clock'), null, 'no clock line');
    assert.equal(el.querySelector('section[data-kind="quest"], section[data-kind="event"]'), null, 'no Quests list, no World list');
    assert.match(squash(el.querySelector('.sd-dir-head').textContent), /Director shows spoilers/);
    assert.match(squash(el.querySelector('section[data-kind="hook"]').textContent), /Hooks the story is planning 1 Toll Audit about Toll Audit Next: the wagons are impounded/);
    assert.match(squash(el.querySelector('section[data-kind="agenda"]').textContent), /Smuggler Vane wants: moving crates at night At: the docks · Next: meet the reeve/);
    assert.equal(squash(el.querySelector('section[data-kind="secret"] .sd-thread').textContent), 'The Reeve Is Bought', 'a secret shows only its name');
    assert.equal(el.querySelectorAll('section[data-kind="problem"] .sd-problem').length, 2);
    assert.equal(el.querySelector('.sd-lock'), null, 'no Reveal step');
    // The threads feature off: no beats, off-screen or secrets (nor the problems behind the scenes); the hooks and problems stay.
    const off = { ...makeQueries(), 'director.threads.on': () => null };
    const { el: bare } = draw(directorScreen, state, { queries: { ...off, 'director.plan': (s, args, tools) => makeQueries()['director.plan'](s, args, { ...tools, feature: id => id !== 'story-director.threads' }) } });
    assert.deepEqual(cardsOf(bare), ['hook', 'problem']);
});

test('director: a Clocks card (name, cause → consequence, Due) so a plan of only clocks is never "Nothing planned yet"; problems newest first; Next/At/Due text is drawn', { skip }, () => {
    const clock = thread('th_clock001', 'clock', 'Flood Wall', { due: 'June 9, 1200' }, { summary: 'the rains → the wall fails' });
    const { el, warnings } = draw(directorScreen, headState({ threads: [clock] }));
    assert.deepEqual(warnings, []);
    assert.deepEqual(cardsOf(el), ['clock', 'problem']);
    assert.match(squash(el.querySelector('section[data-kind="clock"]').textContent), /^Clocks 1 Flood Wall the rains → the wall fails Due: June 9, 1200$/);
    assert.equal(el.querySelector('section[data-kind="clock"] .sd-meta').children.length, 1, 'the text sits in a child element (the sheet hides a bare one)');
    const only = makeState({ threads: [clock] });
    assert.equal(makeQueries()['director.plan'](only, {}, { feature: () => true }).any, true);
    assert.equal(draw(directorScreen, only).el.querySelector('.sd-empty'), null, 'no "Nothing planned yet" while a clock exists');
    // Problems: the newest first, so the card's first rows are the latest reply's.
    const plan = makeQueries()['director.plan'](headState(), {}, { feature: () => true });
    assert.deepEqual(plan.problems.map(problem => problem.rev), [19, 18]);
});

test('director: each card shows its first three rows and "+N more" opens it; no inner scroll box; no hideBehind lock', { skip }, () => {
    const many = Array.from({ length: 5 }, (_, n) => hook(`th_hook000${n}`, `Lead ${n}`, `next ${n}`));
    const { el } = draw(directorScreen, headState({ threads: many }));
    const card = () => el.querySelector('section[data-kind="hook"]');
    assert.equal(card().querySelectorAll('li').length, 3);
    const more = card().querySelector('button.sd-more');
    assert.equal(squash(more.textContent), '+ 2 more ›');
    more.click();
    assert.equal(card().querySelectorAll('li').length, 5);
    assert.equal(squash(card().querySelector('button.sd-more').textContent), 'Show less ‹');
    assert.equal(el.querySelector('section[data-kind="agenda"]'), null);
    assert.doesNotMatch(directorScreen.css, /overflow-y: (auto|scroll)|max-height/);
    // The setting `screens.hideBehind` stays (harmless): the plan is shown whatever it says.
    const { run } = makeRunner(makeQueries());
    assert.ok(run(headState(), 'director.plan', {}).secrets.length > 0);
    // The arc panel is told to show everything (no Reveal step on this screen).
    assert.match(directorScreen.template, /name="story-director\.arc" data-props='\{"bind":"q\.arc","open":"true"\}'/);
});

test('one scene header: the World\'s place, time, weather and region lines are scene lines the Game view\'s hero replaces; the Director has none', { skip }, () => {
    // BASE_CSS: in the Game view (mount `screen`) the lines' display is none; the Story panel's tab (mount `tab`) has no hero and keeps them.
    assert.match(BASE_CSS, /:root\[data-ss-mount="screen"\] \{ --sd-line-display: none; \}/);
    const scoped = runtime.scopeCss(directorScreen.css, DIRECTOR_ID);
    assert.deepEqual(scoped.warnings, []);
    assert.ok(scoped.css.includes('[data-ss-screen="story-director/director"][data-ss-mount="screen"]'), 'the rule styles the screen root itself');
    assert.doesNotMatch(directorScreen.css, /sd-clock|sd-scene-line/, 'the Director draws no clock line');
    // World: Here keeps the people and the trip; the place, the empty-place note, the weather and the date by the switch are scene lines.
    const world = {
        world: { here: { place: { name: 'Harrow', line: 'Harrow · Quay', kind: 'settlement', region: 'Vale' }, moved: true, weather: 'rain', people: [{ name: 'Elula', stance: '', dossier: false, key: 'elula', thought: '' }], present: ['Elula'], chatter: [], nsd: false, hasPeople: true }, news: [], factions: [], upcoming: [], upcomingDays: 30, today: 'June 3, 1200', date: 'June 3, 1200', time: '08:00 am', clockSet: true, hasNews: false, hasFactions: false, hasUpcoming: false, newsCount: 0, factionCount: 0 },
        journal: null, trip: { row: 'Riding to Old Weir' }, threads: { on: true },
    };
    const { el: here, warnings } = draw(worldScreen, {}, { q: world });
    assert.deepEqual(warnings, []);
    const scene = here.querySelectorAll('.wv-scene').map(node => node.className.split(' ')[0]).sort();
    // The "Here" heading is a scene line too (it would sit bare over the people once the place and weather lines are hidden).
    assert.deepEqual(scene, ['ss-label', 'wv-place', 'wv-sub', 'wv-sub', 'wv-weather', 'wv-when']);
    const heading = here.querySelector('.wv-here .wv-label.wv-scene');
    assert.equal(squash(heading.textContent), 'Here');
    assert.equal(squash(here.querySelector('.wv-people-box .sd-fold-head').textContent), 'People here 1', 'the People here fold head stays');
    assert.equal(squash(here.querySelector('.wv-when').textContent), '08:00 am · June 3, 1200', 'the time, then the date');
    assert.ok(!here.querySelector('.wv-road').classList.contains('wv-scene'), 'On the road is not a scene line');
    assert.match(squash(here.querySelector('.wv-here').textContent), /People here 1/);
    assert.equal(here.querySelector('.wv-header .wv-when, .wv-top .wv-when'), null, 'the date is no longer in the header row');
    assert.ok(here.querySelector('.wv-here ss-widget[name="story-director.people"]'), 'the people stay');
    const css = runtime.scopeCss(worldScreen.css, worldScreen.id);
    assert.deepEqual(css.warnings, []);
    assert.match(worldScreen.css, /\.wv-place\.wv-scene, \.wv-weather\.wv-scene \{ display: var\(--sd-line-display, flex\); \}/);
    assert.match(worldScreen.css, /\.sd-empty\.wv-scene, \.wv-when\.wv-scene, \.wv-sub\.wv-scene \{ display: var\(--sd-line-display, block\); \}/);
    assert.match(worldScreen.css, /\.wv-label\.wv-scene \{ display: var\(--sd-line-display, flex\); \}/);
});

test('world: News and events and Factions are drawn only while the threads feature answers; Upcoming stays', { skip }, () => {
    const base = { world: { here: { place: null, moved: false, weather: '', people: [], present: [], chatter: [], nsd: false, hasPeople: false }, news: [], factions: [], upcoming: [], upcomingDays: 30, today: '', clockSet: false, hasNews: false, hasFactions: false, hasUpcoming: false, newsCount: 0, factionCount: 0 }, journal: null, trip: null };
    const sections = el => el.querySelectorAll('section.sd-kind').map(node => node.getAttribute('data-kind'));
    assert.deepEqual(sections(draw(worldScreen, {}, { q: { ...base, threads: null } }).el), ['here', 'upcoming']);
    assert.deepEqual(sections(draw(worldScreen, {}, { q: { ...base, threads: { on: true } } }).el), ['here', 'upcoming', 'news'], 'Factions: only once one is known');
    const known = { ...base, world: { ...base.world, hasFactions: true, factionCount: 1, factions: [{ name: 'Guild', summary: '', area: '', stance: '' }] }, threads: { on: true } };
    assert.deepEqual(sections(draw(worldScreen, {}, { q: known }).el), ['here', 'upcoming', 'news', 'factions']);
    assert.deepEqual(sections(draw(worldScreen, {}, { q: { ...known, threads: null } }).el), ['here', 'upcoming']);
    assert.equal(worldScreen.data.threads.query, 'director.threads.on');
});

test('the Director\'s layout is one column of cards at every width: the plan cards size themselves to the room, no viewport breakpoint', () => {
    assert.match(directorScreen.css, /\.sd-director \{ display: grid;[^}]*grid-template-columns: minmax\(0, 1fr\); align-items: start; \}/);
    assert.match(directorScreen.css, /\.sd-behind \{ display: grid;[^}]*grid-template-columns: repeat\(auto-fill, minmax\(min\(100%, 320px\), 1fr\)\); align-items: start; \}/);
    assert.doesNotMatch(directorScreen.css.slice(BASE_CSS.length), /@media/, 'one rule for every width');
    assert.match(directorScreen.css, /\.sd-director > \* \{ min-width: 0; \}/);
    assert.match(directorScreen.css, /\.sd-director > ss-widget \{ display: block; \}/);
    assert.match(directorScreen.css, /\.sd-empty, \.sd-wide \{ grid-column: 1 \/ -1; \}/);
    assert.equal((directorScreen.template.match(/class="sd-wide"/g) ?? []).length, 3, 'the arc, the plan and the Ripples card span the whole row');
});

test('status card: its title is "Where things stand" and its own summary slot reads "<clock time>, <place>"', () => {
    assert.equal(STATUS_TITLE, 'Where things stand');
    assert.equal(statusCardScreen.title, 'Where things stand');
    assert.equal(statusCardScreen.summary, STATUS_SUMMARY);
    // A key person's return or removal this reply leads the line (tests/v2/keypeople/screens.test.js draws it); the rest is the summary.
    assert.ok(STATUS_SUMMARY.endsWith('{{ q.status.summary }}'));
    assert.deepEqual(statusCardScreen.data.status, { query: 'director.status' });
    assert.deepEqual(statusCardScreen.mounts, ['card']);
    const tools = { query: () => null };
    const day = { time: calendar.parse('June 11, 2025, 1:30 pm', { reference: null }).abs };
    const state = (minutes, place) => ({ domains: { director: { time: { minutes } }, scene: { place: { name: place } } } });
    assert.equal(statusExtras(state(day.time, 'Bluewatch Village'), {}, tools).summary, '1:30 pm, Bluewatch Village');
    assert.equal(statusExtras(state(day.time, ''), {}, tools).summary, '1:30 pm', 'no place yet');
    assert.equal(statusExtras(state(null, 'Bluewatch Village'), {}, tools).summary, 'Bluewatch Village', 'no clock yet');
    assert.equal(statusExtras(state(null, ''), {}, tools).summary, '', 'nothing set: no summary');
    for (const [text, clock] of [['June 11, 2025, 12:00 am', '12:00 am'], ['June 11, 2025, 12:05 pm', '12:05 pm'], ['June 11, 2025, 9:00 am', '9:00 am'], ['June 11, 2025, 11:59 pm', '11:59 pm']]) {
        assert.equal(clockText(calendar, at(text)), clock, text);
    }
    // Any calendar: the pack's months and era do not matter, only the time of day.
    const custom = makeCalendar({ preset: 'custom', era: 'CY', months: [{ name: 'Dawnwane', days: 30 }, { name: 'Goldwane', days: 30 }] });
    assert.equal(clockText(custom, custom.toAbs({ year: 611, month: 1, day: 12, minutes: 13 * 60 + 30 })), '1:30 pm');
    // The place is cut by code points, never inside a character.
    const long = statusExtras(state(day.time, `${'🗼'.repeat(100)}`), {}, tools).summary;
    assert.equal(Array.from(long).length, 80);
    assert.ok(long.endsWith('…'));
    // The same text is what the card's own template reads.
    const { run } = makeRunner(makeQueries());
    assert.equal(run(headState(), 'director.status').summary, `${'9:00 am'}, Bluewatch Village`);
    assert.ok(screens.some(screen => screen.id === STATUS_CARD_ID && screen.summary === STATUS_SUMMARY));
});
