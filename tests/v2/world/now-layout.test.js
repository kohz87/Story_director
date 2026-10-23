// World, Now: what the reader sees, in order. Drawn by Story Block's template renderer from a fixed `q.world`
// (the query's answer), so the test is about the markup the reader gets, not the data's rules.
import test from 'node:test';
import assert from 'node:assert/strict';

import { WORLD_ID, worldScreen } from '../../../src/v2/world/index.js';
import { conditionEvaluator } from '../../vendor/story-block/src/v2/view/bind.js';
import { compile, evaluate } from '../../vendor/story-block/src/v2/events/index.js';
import { compileTemplate, renderTemplate } from '../../vendor/story-block/src/v2/view/template/index.js';
import { installFakeDom } from '../../ui-fake-dom.js';

const squash = text => String(text ?? '').replace(/\s+/g, ' ').trim();

const world = (more = {}) => ({
    today: 'March 4, 2026, 09:30 am',
    here: {
        place: { name: 'North Cut', kind: 'wild', region: 'Vale' }, moved: true, weather: 'fog and rain',
        hasPeople: true, people: [{ name: 'Elula', key: 'elula', stance: 'Close', thought: '', dossier: false }], chatter: [], nsd: false,
    },
    clockSet: true, upcomingDays: 30, hasUpcoming: true,
    upcoming: [{ kind: 'quest', name: 'Wolf Contract', goal: 'kill 3 wolves', when: 'June 14', label: 'in 3 days', overdue: true }],
    news: [], hasNews: false, newsCount: 0, factions: [], hasFactions: false, factionCount: 0,
    ...more,
});

function draw(now) {
    const doc = installFakeDom();
    doc.head = doc.createElement('head');
    const el = doc.createElement('div');
    el.setAttribute('data-ss-screen', WORLD_ID);
    doc.body.appendChild(el);
    const compiled = compileTemplate(worldScreen.template);
    const draft = { view: 'now' };
    const scope = () => ({ state: {}, q: { world: now, journal: { on: false, hasDays: false, days: [] } }, draft, settings: {}, mount: 'tab', screenId: WORLD_ID, api: {} });
    renderTemplate(el, compiled, scope(), { evaluate: conditionEvaluator({ compile, evaluate }), widgets: {}, onWarn() {} });
    return el;
}

// The section's children in document order, as the reader reads them: the label's words, the place, the weather,
// the people's label and widget, and the line for no one else.
const readingOrder = el => {
    const here = el.querySelector('section[data-kind="here"]');
    return [...here.querySelectorAll('h4, .wv-place, .wv-weather, ss-widget, .sd-empty')].map(node => {
        if (node.tagName === 'SS-WIDGET' || node.tagName === 'ss-widget') return 'widget';
        if (node.tagName === 'H4') return `label:${squash(node.textContent)}`;
        return node.className.split(' ')[0];
    });
};

test('World, Now: Here reads place, weather, then the People here label directly above the people', () => {
    const order = readingOrder(draw(world()));
    assert.deepEqual(order, ['label:Here', 'wv-place', 'wv-weather', 'label:People here 1', 'widget']);
});

test('World, Now: with no one here the People here label is not shown and the line says so', () => {
    const empty = world({ here: { ...world().here, hasPeople: false, people: [], place: { name: 'North Cut' } } });
    const order = readingOrder(draw(empty));
    assert.deepEqual(order, ['label:Here', 'wv-place', 'wv-weather', 'sd-empty']);
    assert.match(squash(draw(empty).querySelector('section[data-kind="here"]').textContent), /No one else is in the scene/);
});

test('World, Now: an overdue Upcoming item says so in a pill, not in a colour', () => {
    const el = draw(world());
    const row = el.querySelector('li.wv-item');
    assert.equal(squash(row.querySelector('.ss-listcard-title').textContent), 'Wolf Contract');
    const pill = [...row.querySelectorAll('.ss-pill')].find(node => squash(node.textContent) === 'overdue');
    assert.ok(pill, 'the overdue pill is drawn');
    assert.equal(row.classList.contains('wv-overdue'), true, 'the row keeps its overdue hook');
});
