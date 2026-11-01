// The UI cleanup of Story Director's screens (approved 1-3): one scene header (the Game view's hero draws the place, time and
// weather, so the Director and World screens do not draw them again there), the Director's card grid that never overlaps,
// the world-building threads feature's panels, and the Status card's own title and one-line summary.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../../ui-fake-dom.js';
import { resolveData, runtime, skipReason } from './helpers/runtime.js';
import { at, calendar, headState, makeQueries, makeRunner, makeState } from './helpers/fixtures.js';
import { DIRECTOR_ID, STATUS_CARD_ID, createBehindWidget, screens } from '../../../src/v2/screens/index.js';
import { statusExtras, clockText } from '../../../src/v2/screens/queries.js';
import { STATUS_SUMMARY, STATUS_TITLE, statusCardScreen } from '../../../src/v2/screens/status-card.js';
import { BASE_CSS } from '../../../src/v2/screens/style.js';
import { directorScreen } from '../../../src/v2/screens/director.js';
import { worldScreen, createPeopleWidget } from '../../../src/v2/world/index.js';
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
        widgets: { ...runtime.widgets, 'story-director.arc': createArcWidget({ controller: noPlanner }), 'story-director.behind': createBehindWidget({ reveal: stillReveal }), 'story-director.people': createPeopleWidget() },
        formatters: { time: minutes => (Number.isInteger(minutes) ? calendar.format(minutes) : '') },
        onWarn: message => warnings.push(message),
    });
    return { el, warnings };
}
const kindsOf = el => el.querySelectorAll('section.sd-kind').map(node => node.getAttribute('data-kind'));

test('director: the World card and the Behind panel (Off-screen, Clocks, Beats, Secrets) are drawn only while the threads feature answers', { skip }, () => {
    const off = { ...makeQueries(), 'director.threads.on': () => null, 'director.behind': () => null };
    const { el, warnings } = draw(directorScreen, headState(), { queries: off });
    assert.deepEqual(warnings, []);
    assert.deepEqual(kindsOf(el), ['arc', 'quest', 'problems'], 'quests, hooks and the arc stay; no World card, no behind the scenes');
    assert.equal(el.querySelector('.sd-behind'), null);
    const { el: on } = draw(directorScreen, headState());
    assert.deepEqual(kindsOf(on), ['arc', 'quest', 'event', 'agenda', 'clock', 'secret', 'problems']);
    assert.equal(directorScreen.data.threads.query, 'director.threads.on');
});

test('one scene header: the Director\'s clock line and the World\'s place, weather and date lines are scene lines the Game view\'s hero replaces', { skip }, () => {
    // BASE_CSS: in the Game view (mount `screen`) the lines' display is none; the Story panel's tab (mount `tab`) has no hero and keeps them.
    assert.match(BASE_CSS, /:root\[data-ss-mount="screen"\] \{ --sd-line-display: none; \}/);
    const scoped = runtime.scopeCss(directorScreen.css, DIRECTOR_ID);
    assert.deepEqual(scoped.warnings, []);
    assert.ok(scoped.css.includes('[data-ss-screen="story-director/director"][data-ss-mount="screen"]'), 'the rule styles the screen root itself');
    assert.match(directorScreen.css, /\.sd-clock \{ display: var\(--sd-line-display, block\);/);
    const { el } = draw(directorScreen, headState(), { mount: 'tab' });
    const header = el.querySelector('header.sd-clock');
    assert.ok(header.classList.contains('sd-scene-line'), 'still in the page for the Story panel');
    assert.match(squash(header.textContent), /Bluewatch Village/);
    // World: Here keeps the people and the trip; the place, the empty-place note, the weather and the date by the switch are scene lines.
    const world = {
        world: { here: { place: { name: 'Harrow', kind: 'settlement', region: '' }, moved: false, weather: 'rain', people: [{ name: 'Elula', stance: '', dossier: false, key: 'elula', thought: '' }], present: ['Elula'], chatter: [], nsd: false, hasPeople: true }, news: [], factions: [], upcoming: [], upcomingDays: 30, today: 'June 3, 1200', clockSet: true, hasNews: false, hasFactions: false, hasUpcoming: false, newsCount: 0, factionCount: 0 },
        journal: null, trip: { row: 'Riding to Old Weir' }, threads: { on: true },
    };
    const { el: here, warnings } = draw(worldScreen, {}, { q: world });
    assert.deepEqual(warnings, []);
    const scene = here.querySelectorAll('.wv-scene').map(node => node.className.split(' ')[0]).sort();
    assert.deepEqual(scene, ['wv-place', 'wv-weather', 'wv-when']);
    assert.ok(!here.querySelector('.wv-road').classList.contains('wv-scene'), 'On the road is not a scene line');
    assert.match(squash(here.querySelector('.wv-here').textContent), /People here 1/);
    assert.ok(here.querySelector('.wv-here ss-widget[name="story-director.people"]'), 'the people stay');
    const css = runtime.scopeCss(worldScreen.css, worldScreen.id);
    assert.deepEqual(css.warnings, []);
    assert.match(worldScreen.css, /\.wv-place\.wv-scene, \.wv-weather\.wv-scene \{ display: var\(--sd-line-display, flex\); \}/);
    assert.match(worldScreen.css, /\.sd-empty\.wv-scene, \.wv-when\.wv-scene \{ display: var\(--sd-line-display, block\); \}/);
});

test('world: News and events and Factions are drawn only while the threads feature answers; Upcoming stays', { skip }, () => {
    const base = { world: { here: { place: null, moved: false, weather: '', people: [], present: [], chatter: [], nsd: false, hasPeople: false }, news: [], factions: [], upcoming: [], upcomingDays: 30, today: '', clockSet: false, hasNews: false, hasFactions: false, hasUpcoming: false, newsCount: 0, factionCount: 0 }, journal: null, trip: null };
    const sections = el => el.querySelectorAll('section.sd-kind').map(node => node.getAttribute('data-kind'));
    assert.deepEqual(sections(draw(worldScreen, {}, { q: { ...base, threads: null } }).el), ['here', 'upcoming']);
    assert.deepEqual(sections(draw(worldScreen, {}, { q: { ...base, threads: { on: true } } }).el), ['here', 'upcoming', 'news', 'factions']);
    assert.equal(worldScreen.data.threads.query, 'director.threads.on');
});

test('the Director\'s card grid sizes itself to its own width at every width: no viewport breakpoint, columns that never go under the room, every card in its own cell', () => {
    for (const grid of ['.sd-director', '.sd-behind']) {
        const rule = new RegExp(`${grid.replace('.', '\\.')} \\{ display: grid;[^}]*grid-template-columns: repeat\\(auto-fill, minmax\\(min\\(100%, 320px\\), 1fr\\)\\); align-items: start; \\}`);
        assert.match(directorScreen.css, rule, grid);
    }
    assert.doesNotMatch(directorScreen.css.slice(BASE_CSS.length), /@media/, 'one rule for every width');
    assert.match(directorScreen.css, /\.sd-director > \* \{ min-width: 0; \}/);
    assert.match(directorScreen.css, /\.sd-director > ss-widget \{ display: block; \}/);
    assert.match(directorScreen.css, /\.sd-empty, \.sd-clock, \.sd-wide \{ grid-column: 1 \/ -1; \}/);
    assert.match(directorScreen.css, /\.sd-unlocked, \.sd-lock, \.sd-behind \.sd-problems-box \{ grid-column: 1 \/ -1; \}/);
    // Both wide widgets span the whole row, so a card is never beside the Behind panel's own grid.
    assert.equal((directorScreen.template.match(/class="sd-wide"/g) ?? []).length, 2);
});

test('status card: its title is "Where things stand" and its own summary slot reads "<clock time>, <place>"', () => {
    assert.equal(STATUS_TITLE, 'Where things stand');
    assert.equal(statusCardScreen.title, 'Where things stand');
    assert.equal(statusCardScreen.summary, STATUS_SUMMARY);
    assert.equal(STATUS_SUMMARY, '{{ q.status.summary }}');
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
