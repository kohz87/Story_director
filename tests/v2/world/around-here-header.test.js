// World, Now: the "Around here" heading is one line. The place is cut with "…" when it is long (the full place is its tooltip) and the time of
// day goes first when the two do not fit; the heading never runs under the Key people card. Drawn by Story Block's template renderer from a fixed
// `q.cast`; a fake DOM has no layout, so the rules that cut the line are pinned in the screen's CSS.
import test from 'node:test';
import assert from 'node:assert/strict';

import { worldScreen } from '../../../src/v2/world/screen.js';
import { conditionEvaluator } from '../../vendor/story-block/src/v2/view/bind.js';
import { compile, evaluate } from '../../vendor/story-block/src/v2/events/index.js';
import { compileTemplate, renderTemplate } from '../../vendor/story-block/src/v2/view/template/index.js';
import { installFakeDom } from '../../ui-fake-dom.js';

const squash = text => String(text ?? '').replace(/\s+/g, ' ').trim();
const LONG = 'Bluewatch Village / Adventurer Guild Office, upper floor, back room';

const world = { today: '', here: { place: null, moved: false, weather: '', hasPeople: false, people: [], chatter: [], nsd: false }, clockSet: true, upcomingDays: 30, hasUpcoming: false, upcoming: [], news: [], hasNews: false, factions: [], hasFactions: false };
const cast = (place, day) => ({
    on: true, total: 14, met: 3, near: 0, hasNear: false, hasMet: false, metList: [], packLabel: 'Ersveil cast', note: 'Unmet cast stays hidden.',
    heading: [place, day].filter(Boolean).join(' · '), place, day, dayText: day ? (place ? `· ${day}` : day) : '',
});

function heading(view) {
    const doc = installFakeDom();
    doc.head = doc.createElement('head');
    const el = doc.createElement('div');
    doc.body.appendChild(el);
    const warnings = [];
    const scope = { state: {}, q: { world, journal: { on: false, hasDays: false, days: [] }, threads: { on: true }, keys: null, cast: view }, draft: { view: 'now' }, settings: {}, mount: 'tab', screenId: 'story-director/world', api: {} };
    renderTemplate(el, compileTemplate(worldScreen.template), scope, { evaluate: conditionEvaluator({ compile, evaluate }), widgets: {}, onWarn: message => warnings.push(message) });
    assert.deepEqual(warnings, []);
    return el.querySelector('.wv-around h4');
}

test('Around here: the place is its own clipped span with the full place as its tooltip, the time of day after it', () => {
    const h4 = heading(cast(LONG, 'morning'));
    const clip = h4.querySelector('.wv-clip');
    assert.equal(clip.getAttribute('title'), LONG);
    assert.equal(squash(clip.textContent), LONG);
    assert.equal(squash(h4.querySelector('.wv-day').textContent), '· morning');
    assert.equal(squash(h4.textContent), `Around here ${LONG} · morning`);
    assert.deepEqual([...h4.querySelector('small').children].map(node => node.className), ['wv-clip', 'wv-day']);
});

test('Around here: a short place reads as before; no time of day, no day part; no place, the time of day alone; nothing, just the words', () => {
    assert.equal(squash(heading(cast('Bluewatch docks', 'evening')).textContent), 'Around here Bluewatch docks · evening');
    const noDay = heading(cast('Harrow', ''));
    assert.equal(squash(noDay.textContent), 'Around here Harrow');
    assert.equal(noDay.querySelector('.wv-day'), null);
    const noPlace = heading(cast('', 'night'));
    assert.equal(squash(noPlace.textContent), 'Around here night');
    assert.equal(noPlace.querySelector('.wv-clip'), null);
    const none = heading(cast('', ''));
    assert.equal(squash(none.textContent), 'Around here');
    assert.equal(none.querySelector('small'), null);
});

test('Around here: text is only ever text (a place name with markup draws no element, and its tooltip is the plain text)', () => {
    const h4 = heading(cast('<img src=x onerror=alert(1)> Quay', 'dawn'));
    assert.equal(h4.querySelectorAll('img').length, 0);
    assert.equal(h4.querySelector('.wv-clip').getAttribute('title'), '<img src=x onerror=alert(1)> Quay');
});

test('Around here: the CSS keeps the words whole, cuts the place with an ellipsis on one line, and lets the time of day go first (never over the next card)', () => {
    const css = worldScreen.css;
    assert.match(css, /\.wv-around \.wv-label \{ min-width: 0; \}/);
    const small = /\.wv-around \.wv-label > small \{([^}]*)\}/.exec(css)?.[1] ?? '';
    for (const rule of ['flex-wrap: wrap', 'min-width: 0', 'max-width: 100%', 'overflow: hidden', 'max-height: 1.3em']) assert.ok(small.includes(rule), `the heading's small has ${rule}`);
    const clip = /\.wv-clip \{([^}]*)\}/.exec(css)?.[1] ?? '';
    for (const rule of ['min-width: 0', 'max-width: 100%', 'overflow: hidden', 'text-overflow: ellipsis', 'white-space: nowrap']) assert.ok(clip.includes(rule), `the place has ${rule}`);
    assert.match(css, /\.wv-day \{ flex: none; white-space: nowrap; \}/);
    // The words themselves (the label) stay on one line and are not the part that gives way.
    assert.match(css, /\.wv-label \{ display: flex; align-items: center; gap: 10px; margin: 0 0 6px; min-width: 0; white-space: nowrap; \}/);
});
