import test from 'node:test';
import assert from 'node:assert/strict';

import { MAP_CSS, atlasMapWidget, forgetViews, onLayer, readView } from '../../../src/v2/atlas/widget.js';
import { iconFor } from '../../../src/v2/atlas/map.js';
import { KNOWN_LABEL_ZOOM, labelSize } from '../../../src/v2/atlas/view.js';
import { installFakeDom } from '../../ui-fake-dom.js';
import { at, command, makeState, query } from './helpers/fake-ctx.js';

// The screenshot's knot (Ersveil's Bluewatch Village: places a hundredth of a unit apart) inside a
// wider world, a hidden cellar, and a town on another layer.
const PACK = {
    places: [
        { name: 'Bluewatch Village', region: 'Core Cities', kind: 'settlement', x: 64, y: 110 },
        { name: 'Inspection Quay', region: 'Bluewatch Village', kind: 'quay', x: 64.0, y: 109.99, aliases: ['the quay'] },
        { name: 'Watch Granary', region: 'Bluewatch Village', kind: 'storehouse', x: 64.02, y: 109.99, aliases: ['the granary'] },
        { name: 'Watchhouse', region: 'Bluewatch Village', kind: 'watch-fort', x: 64.01, y: 110.02 },
        { name: 'Stray Oar', region: 'Bluewatch Village', kind: 'inn', x: 63.99, y: 110.0 },
        { name: 'Reedmere', region: 'Locks', kind: 'town', x: 50, y: 90 },
        { name: 'Coinwater', region: 'Core Cities', kind: 'city', x: 40, y: 100 },
        { name: 'Smugglers Cellar', region: 'Bluewatch Village', kind: 'cellar', x: 64.015, y: 110.015, hidden: true },
        { name: 'Deep Vault', region: 'Bluewatch Village', layer: 'underground', kind: 'vault', x: 64, y: 110 },
    ],
    routes: [
        { from: 'Bluewatch Village', to: 'Inspection Quay', kind: 'street', km: 0.2, hours: 0.1 },
        { from: 'Bluewatch Village', to: 'Reedmere', kind: 'river', km: 90 },
        { from: 'Coinwater', to: 'Reedmere', kind: 'river', km: 60 },
        { from: 'Bluewatch Village', to: 'Smugglers Cellar', kind: 'stair', km: 0.1 },
    ],
};

function story() {
    let state = makeState({ place: 'Bluewatch Village', kind: 'settlement', region: 'River Confederacy' });
    state = command(state, 'atlas.visit', { name: 'Bluewatch Village', kind: 'settlement', region: 'River Confederacy' }, { pack: PACK }).state;
    state = command(at(state, 'Inspection Quay'), 'atlas.visit', { name: 'Inspection Quay' }, { pack: PACK }).state;
    return at(state, 'Bluewatch Village', { kind: 'settlement', region: 'River Confederacy' });
}

function draw({ state = story(), props = {}, api = null, win = null, value } = {}) {
    forgetViews();
    const doc = installFakeDom();
    if (win) doc.defaultView = win;
    const el = doc.createElement('div');
    doc.body.appendChild(el);
    const queries = [];
    const theApi = api ?? { query: (name, args) => { queries.push({ name, args }); return query(state, name, args, { pack: PACK }); } };
    const data = value === undefined ? query(state, 'atlas.view', {}, { pack: PACK }) : value;
    const handle = atlasMapWidget.render(el, { value: data, label: 'Map', ...props }, theApi);
    const root = el.querySelector('.sd-map');
    const stage = root.querySelector('.sd-map-stage');
    const $ = selector => root.querySelector(selector);
    const $$ = selector => root.querySelectorAll(selector);
    const key = name => stage.dispatch('keydown', { key: name });
    const pointer = (type, id, x, y, extra = {}) => stage.dispatch(type, { pointerId: id, clientX: x, clientY: y, pointerType: 'touch', ...extra });
    const shownLabels = () => $$('.sd-map-label').filter(label => !label.hidden).map(label => label.textContent);
    return { doc, el, root, stage, handle, $, $$, key, pointer, shownLabels, queries, state, data };
}

const placeButton = (root, name) => root.querySelectorAll('.sd-map-place').find(node => node.getAttribute('title') === name);

test('the controls: search, zoom in and out, fit, centre on me, layers, a focusable map; the bar sits outside the map', () => {
    const { root, stage, $, $$ } = draw();
    const input = $('.sd-map-search input');
    assert.equal(input.getAttribute('type'), 'search');
    assert.match(input.getAttribute('aria-label'), /Find a place/);
    assert.equal($('.sd-map-results').hidden, true);
    for (const [cls, label] of [['zoom-in', 'Zoom in'], ['zoom-out', 'Zoom out'], ['fit', 'Show the whole layer'], ['me', 'Centre on where you are']]) {
        const button = $(`.sd-map-${cls}`);
        assert.ok(button, cls);
        assert.equal(button.tagName, 'BUTTON');
        assert.equal(button.getAttribute('aria-label'), label);
    }
    assert.equal(stage.getAttribute('tabindex'), '0');
    assert.equal(stage.getAttribute('aria-roledescription'), 'map');
    assert.equal(stage.querySelector('.sd-map-tools'), null, 'the controls never cover the map (or the nav under it)');
    // Item 2: All, then only the regions and planes that have places (no Mirelands, no empty chip).
    assert.deepEqual($$('.sd-map-layer').map(chip => chip.textContent), ['All', 'Bluewatch Village', 'Core Cities', 'Locks', 'underground']);
    assert.equal($('.sd-map-layer[aria-pressed="true"]').textContent, 'Core Cities');
    // Item 3: the "you are here" ring is drawn after (above) the places and the labels.
    const children = stage.children.map(child => child.className);
    assert.deepEqual(children, ['sd-map-svg', 'sd-map-places', 'sd-map-labels', 'sd-map-here']);
    assert.equal($('.sd-map-here').hidden, false);
    assert.equal(root.querySelector('.sd-map-legend-card').hidden, false);
});

test('item 1: unvisited places are drawn, marked and small; their names come as the map comes closer, or on hover and focus', () => {
    const { root, $, $$, key, shownLabels, handle } = draw();
    $('.sd-map-layer[data-layer="all"]').click();
    const names = $$('.sd-map-place').map(node => node.getAttribute('title'));
    assert.deepEqual(names, ['Bluewatch Village', 'Inspection Quay', 'Watch Granary', 'Watchhouse', 'Stray Oar', 'Reedmere', 'Coinwater']);
    assert.ok(!names.includes('Smugglers Cellar'), 'a hidden place is not drawn');
    assert.ok(!names.includes('Deep Vault'), 'a plane\'s place is on its own layer');
    const coin = placeButton(root, 'Coinwater');
    assert.equal(coin.getAttribute('data-visited'), 'false');
    assert.match(coin.getAttribute('aria-label'), /Coinwater \(City, Core Cities, not visited\)/);
    assert.equal(coin.classList.contains('sd-map-far'), true, 'far out: a dot');
    assert.ok(!shownLabels().includes('Coinwater'));
    assert.ok(shownLabels().includes('Bluewatch Village'));
    // Hover and focus bring a name back.
    coin.dispatch('pointerover');
    assert.ok(shownLabels().includes('Coinwater'));
    coin.dispatch('pointerout');
    assert.ok(!shownLabels().includes('Coinwater'));
    coin.dispatch('focusin');
    assert.ok(shownLabels().includes('Coinwater'));
    coin.dispatch('focusout');
    // Closer in: icons, then names.
    while (handle.state.view.k / handle.state.fitK < KNOWN_LABEL_ZOOM) key('+');
    assert.equal(coin.classList.contains('sd-map-far'), false);
    root.querySelector('.sd-map-me').click();
    assert.ok(shownLabels().length >= 3, `labels: ${shownLabels()}`);
});

test('item 3: shown labels never overlap one another, in the knot of places, at every zoom step', () => {
    const { $, $$, key, handle } = draw();
    $('.sd-map-layer[data-layer="all"]').click();
    $('.sd-map-me').click();
    for (let step = 0; step < 12; step += 1) {
        const boxes = $$('.sd-map-label').filter(label => !label.hidden).map(label => ({
            text: label.textContent, x: parseFloat(label.style.left), y: parseFloat(label.style.top), ...labelSize(label.textContent),
        }));
        for (const [i, a] of boxes.entries()) {
            for (const b of boxes.slice(i + 1)) {
                const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
                assert.ok(!overlap, `"${a.text}" and "${b.text}" overlap at zoom ${handle.state.view.k}`);
            }
        }
        key(step < 6 ? '-' : '+');
    }
});

test('keyboard: + and − zoom, the arrows pan, 0 fits; other keys are left alone', () => {
    const { key, handle, stage } = draw();
    const start = handle.state.view;
    key('+');
    assert.ok(Math.abs(handle.state.view.k - start.k * 1.5) < 1e-9);
    key('-');
    assert.ok(Math.abs(handle.state.view.k - start.k) < 1e-9);
    key('=');
    key('_');
    assert.ok(Math.abs(handle.state.view.k - start.k) < 1e-9);
    key('+');
    key('ArrowRight');
    assert.ok(handle.state.view.cx > start.cx, 'the right arrow shows what is to the right');
    key('ArrowUp');
    assert.ok(handle.state.view.cy < start.cy, 'the up arrow shows what is above');
    key('0');
    assert.deepEqual(handle.state.view, start, '0 fits the layer again');
    key('Home');
    assert.deepEqual(handle.state.view, start);
    const other = stage.dispatch('keydown', { key: 'q' });
    assert.equal(other.defaultPrevented, false);
    assert.equal(stage.dispatch('keydown', { key: '+' }).defaultPrevented, true);
    // Zoom stays inside its limits however often it is pressed.
    for (let i = 0; i < 40; i += 1) key('-');
    assert.equal(handle.state.view.k, handle.state.limits.min);
    for (let i = 0; i < 200; i += 1) key('+');
    assert.equal(handle.state.view.k, handle.state.limits.max);
    // And panning never leaves the world.
    for (let i = 0; i < 500; i += 1) key('ArrowLeft');
    const left = handle.state.view.cx;
    key('ArrowLeft');
    assert.equal(handle.state.view.cx, left);
});

test('buttons: zoom in and out about the centre, fit all, centre on me (zoomed to set it apart, with its details)', () => {
    const { $, handle } = draw();
    const fit = handle.state.view;
    $('.sd-map-zoom-in').click();
    assert.equal(handle.state.view.cx, fit.cx);
    assert.ok(handle.state.view.k > fit.k);
    $('.sd-map-zoom-out').click();
    $('.sd-map-zoom-out').click();
    assert.ok(handle.state.view.k < fit.k);
    $('.sd-map-fit').click();
    assert.deepEqual(handle.state.view, fit);
    $('.sd-map-me').click();
    const here = $('.sd-map-here');
    assert.equal(here.hidden, false);
    assert.equal(parseFloat(here.style.left), 320, 'centred on the current place (640 × 480 stage)');
    assert.equal(parseFloat(here.style.top), 240);
    assert.ok(handle.state.view.k >= fit.k * 2);
    assert.equal(handle.state.picked, $('.sd-map-place[aria-current="location"]').getAttribute('data-id'));
    assert.match($('.sd-map-details').textContent, /You are here\./);
});

test('touch and mouse: a drag pans, a tap picks, a drag ending on a place does not pick, a pinch zooms about its middle', () => {
    const { root, stage, pointer, handle, $ } = draw();
    $('.sd-map-layer[data-layer="all"]').click();
    const fit = handle.state.view;
    // A drag of 40 px to the right.
    pointer('pointerdown', 1, 100, 100);
    pointer('pointermove', 1, 120, 100);
    pointer('pointermove', 1, 140, 100);
    assert.ok(Math.abs(handle.state.view.cx - (fit.cx - 40 / fit.k)) < 1e-9);
    assert.equal(stage.classList.contains('sd-map-dragging'), true);
    pointer('pointerup', 1, 140, 100);
    assert.equal(stage.classList.contains('sd-map-dragging'), false);
    // The click that ends a drag on a place picks nothing.
    const reed = placeButton(root, 'Reedmere');
    reed.click();
    assert.equal(handle.state.picked, '');
    // A tap (a few pixels of jitter) picks and does not pan.
    const before = handle.state.view;
    pointer('pointerdown', 2, 300, 300);
    pointer('pointermove', 2, 302, 301);
    pointer('pointerup', 2, 302, 301);
    assert.deepEqual(handle.state.view, before);
    reed.click();
    assert.equal(handle.state.picked, reed.getAttribute('data-id'));
    assert.equal($('.sd-map-details').hidden, false);
    // A pinch: two fingers moving apart about (320, 240) zoom in by their spread, the middle staying put.
    $('.sd-map-fit').click();
    pointer('pointerdown', 3, 300, 240);
    pointer('pointerdown', 4, 340, 240);
    pointer('pointermove', 4, 380, 240);
    pointer('pointermove', 3, 260, 240);
    assert.ok(Math.abs(handle.state.view.k / fit.k - 3) < 1e-6, `pinched to ${handle.state.view.k / fit.k}`);
    // A third finger changes nothing and breaks nothing; lifting all of them ends it.
    pointer('pointerdown', 5, 10, 10);
    const pinched = handle.state.view;
    pointer('pointermove', 5, 50, 50);
    assert.deepEqual(handle.state.view, pinched);
    for (const id of [3, 4, 5]) pointer('pointercancel', id, 0, 0);
    // A move with no finger down, a right mouse button: ignored.
    pointer('pointermove', 9, 500, 500);
    assert.deepEqual(handle.state.view, pinched);
    pointer('pointerdown', 6, 100, 100, { pointerType: 'mouse', button: 2 });
    pointer('pointermove', 6, 300, 300, { pointerType: 'mouse' });
    assert.deepEqual(handle.state.view, pinched);
});

test('wheel: zooms about the pointer and stops the page from scrolling; huge deltas stay inside the limits', () => {
    const { stage, handle } = draw();
    const fit = handle.state.view;
    const event = stage.dispatch('wheel', { deltaY: -200, deltaMode: 0, clientX: 320, clientY: 240 });
    assert.equal(event.defaultPrevented, true);
    assert.ok(handle.state.view.k > fit.k);
    assert.ok(Math.abs(handle.state.view.cx - fit.cx) < 1e-9, 'about the pointer at the centre');
    stage.dispatch('wheel', { deltaY: -1e7, deltaMode: 0, clientX: 10, clientY: 10 });
    assert.equal(handle.state.view.k, handle.state.limits.max);
    stage.dispatch('wheel', { deltaY: 1e7, deltaMode: 1, clientX: 10, clientY: 10 });
    assert.equal(handle.state.view.k, handle.state.limits.min);
    stage.dispatch('wheel', { deltaY: 'nonsense', clientX: 10, clientY: 10 });
    assert.equal(handle.state.view.k, handle.state.limits.min);
});

test('search: tolerant, unvisited places marked "not visited", hidden ones never found; picking moves, switches layer and shows details', () => {
    const { $, $$, handle } = draw();
    const input = $('.sd-map-search input');
    input.value = 'GRANERY';
    input.dispatch('input');
    assert.equal($('.sd-map-results').hidden, false);
    assert.deepEqual($$('.sd-map-result').map(row => row.textContent), ['Watch GranaryBluewatch Village · not visited']);
    input.value = 'the quay';
    input.dispatch('input');
    assert.deepEqual($$('.sd-map-result-name').map(row => row.textContent), ['Inspection Quay']);
    input.value = 'cellar';
    input.dispatch('input');
    assert.deepEqual($$('.sd-map-result'), []);
    assert.match($('.sd-map-results').textContent, /No place by that name/);
    // Enter takes the best hit: Reedmere is on another layer (Locks), so the map goes there.
    input.value = 'reedmer';
    input.dispatch('input');
    const enter = input.dispatch('keydown', { key: 'Enter' });
    assert.equal(enter.defaultPrevented, true);
    assert.equal(handle.state.layer, 'region:locks');
    assert.equal($('.sd-map-layer[aria-pressed="true"]').textContent, 'Locks');
    const reed = $$('.sd-map-place').find(node => node.getAttribute('title') === 'Reedmere');
    assert.equal(handle.state.picked, reed.getAttribute('data-id'));
    assert.equal(reed.classList.contains('sd-map-picked'), true);
    assert.equal($('.sd-map-results').hidden, true);
    assert.match($('.sd-map-details').textContent, /Reedmere.*Town · Locks.*Not visited yet\..*From Bluewatch Village: 90 km, .* by river\./);
    // A result clicked: the knot's granary, zoomed so its neighbours stand apart; on "All" it stays on All.
    $('.sd-map-layer[data-layer="all"]').click();
    input.value = 'granary';
    input.dispatch('input');
    $('.sd-map-result').click();
    assert.equal(handle.state.layer, '');
    assert.ok(handle.state.view.k > handle.state.fitK * 100, 'deep enough to part the village\'s streets');
    // Escape clears the box.
    input.dispatch('keydown', { key: 'Escape' });
    assert.equal(input.value, '');
    assert.equal($('.sd-map-results').hidden, true);
    // Enter with nothing found does nothing.
    input.value = 'zzzz';
    input.dispatch('input');
    assert.equal(input.dispatch('keydown', { key: 'Enter' }).defaultPrevented, false);
});

test('details: the trip from the query (sync or async), "No known route" without one, nothing without a query; Close and Escape', async () => {
    const { root, $, queries } = draw();
    $('.sd-map-layer[data-layer="all"]').click();
    placeButton(root, 'Reedmere').click();
    assert.deepEqual(queries.at(-1), { name: 'atlas.place', args: { id: placeButton(root, 'Reedmere').getAttribute('data-id') } });
    assert.match($('.sd-map-trip').textContent, /From Bluewatch Village: 90 km/);
    placeButton(root, 'Coinwater').click();
    assert.match($('.sd-map-trip').textContent, /From Bluewatch Village: 150 km/);
    $('.sd-map-close').click();
    assert.equal($('.sd-map-details').hidden, true);
    // A layer with no route from here.
    $('.sd-map-layer[data-layer="region:bluewatch village"]').click();
    placeButton(root, 'Watchhouse').click();
    assert.equal($('.sd-map-trip').textContent, 'No known route from where you are.');
    root.querySelector('.sd-map-stage').dispatch('keydown', { key: 'Escape' });
    assert.equal($('.sd-map-details').hidden, true);
    // An async query, a throwing one, none at all.
    const state = story();
    const slow = draw({ api: { query: (name, args) => Promise.resolve(query(state, name, args, { pack: PACK })) } });
    placeButton(slow.root, 'Coinwater').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.match(slow.$('.sd-map-trip').textContent, /From Bluewatch Village: 150 km/);
    const broken = draw({ api: { query: () => { throw new Error('down'); } } });
    placeButton(broken.root, 'Coinwater').click();
    assert.equal(broken.$('.sd-map-trip').textContent, 'No known route from where you are.');
    const bare = draw({ api: {} });
    placeButton(bare.root, 'Coinwater').click();
    assert.match(bare.$('.sd-map-details').textContent, /Coinwater/);
});

test('a pick writes nothing unless the screen asks: then onSelect runs with { node }', () => {
    const ran = [];
    const state = story();
    const { root } = draw({ props: { onSelect: 'atlas.focus' }, api: { command: (type, payload) => { ran.push({ type, payload }); return Promise.reject(new Error('refused')); }, query: (n, a) => query(state, n, a, { pack: PACK }) } });
    placeButton(root, 'Coinwater').click();
    assert.deepEqual(ran, [{ type: 'atlas.focus', payload: { node: placeButton(root, 'Coinwater').getAttribute('data-id') } }]);
    const quiet = draw();
    placeButton(quiet.root, 'Coinwater').click();
    assert.equal(quiet.handle.state.picked, placeButton(quiet.root, 'Coinwater').getAttribute('data-id'));
});

test('reduced motion: moves jump; otherwise they ease over animation frames to the same place', () => {
    const frames = [];
    const motion = { matches: false };
    const win = {
        requestAnimationFrame: fn => frames.push(fn),
        cancelAnimationFrame: () => {},
        matchMedia: query => (query.includes('reduced-motion') ? motion : { matches: false }),
    };
    const eased = draw({ win });
    eased.$('.sd-map-me').click();
    assert.ok(frames.length > 0, 'an eased move asks for frames');
    for (let time = 0, guard = 0; frames.length && guard < 100; guard += 1, time += 50) frames.shift()(time);
    const target = eased.handle.state.view;
    motion.matches = true;
    frames.length = 0;
    const still = draw({ win });
    still.$('.sd-map-me').click();
    assert.equal(frames.length, 0, 'no frames under reduced motion');
    assert.deepEqual(still.handle.state.view, target, 'the same place, reached at once');
});

test('the view is the reader\'s: kept per layer while the page lives, kept across state updates, never in the state', () => {
    const state = story();
    const first = draw({ state });
    first.key('+');
    first.key('ArrowRight');
    const mine = first.handle.state.view;
    // Another layer and back: each keeps its own view.
    first.$('.sd-map-layer[data-layer="all"]').click();
    assert.notDeepEqual(first.handle.state.view, mine);
    first.$('.sd-map-layer[data-layer="region:core cities"]').click();
    assert.deepEqual(first.handle.state.view, mine);
    // A state update (the story visits the granary) keeps the layer, pan and zoom.
    const next = command(at(state, 'Watch Granary'), 'atlas.visit', { name: 'Watch Granary' }, { pack: PACK }).state;
    first.handle.update({ value: query(next, 'atlas.view', {}, { pack: PACK }), label: 'Map' });
    assert.equal(first.handle.state.layer, 'region:core cities');
    assert.ok(Math.abs(first.handle.state.view.k - mine.k) < 1e-9);
    assert.ok(Math.abs(first.handle.state.view.cx - mine.cx) < 1e-9);
    // The granary (now where you are) is on its own region's layer: no ring on this one.
    assert.equal(first.root.querySelector('.sd-map-place[aria-current="location"]'), null);
    assert.equal(first.root.querySelector('.sd-map-here').hidden, true);
    // Nothing of it reached the story state.
    assert.deepEqual(next.domains.atlas.focus, null);
    assert.deepEqual(state.domains.atlas.focus, null);
    // Destroyed and drawn again on this page: the same view comes back (forgetViews runs in draw(), so redo by hand).
    const doc = first.doc;
    first.handle.destroy();
    assert.equal(first.el.querySelector('.sd-map'), null);
    const el = doc.createElement('div');
    const again = atlasMapWidget.render(el, { value: query(state, 'atlas.view', {}, { pack: PACK }) }, {});
    assert.equal(again.state.layer, 'region:core cities');
    assert.ok(Math.abs(again.state.view.k - mine.k) < 1e-9);
    const other = atlasMapWidget.render(el, { value: query(state, 'atlas.view', {}, { pack: PACK }), viewKey: 'elsewhere' }, {});
    assert.notDeepEqual(other.state.view, mine);
});

test('odd data: nothing, junk, duplicates, missing coordinates, dangling routes, a current place not drawn', () => {
    // Nothing usable: drawn without a throw, as an empty map with its note.
    for (const value of [null, [], 'map', 7, {}, { places: 'x', routes: 3, layers: {}, current: 9 }]) {
        const { $, handle } = draw({ value });
        assert.ok(handle, String(value));
        assert.equal($('.sd-map-empty').hidden, false);
    }
    const empty = draw({ value: { places: [] } });
    assert.equal(empty.$('.sd-map-empty').hidden, false);
    assert.equal(empty.$('.sd-map-stage').hidden, true);
    assert.equal(empty.$('.sd-map-layers').hidden, true);
    empty.$('.sd-map-me').click();
    empty.key('+');
    const odd = draw({
        value: {
            places: [
                { id: 'a', name: 'Alpha', x: 0, y: 0, visited: true }, { id: 'a', name: 'Alpha again', x: 9, y: 9 },
                { id: '', name: 'No id' }, null, 5, { id: 'b', name: '', x: NaN, y: 3 }, { id: 'c', name: 'Gamma', x: 'far', y: null },
                { id: 'd', name: 'Delta', x: 0, y: 0, visited: true, icon: 'javascript:alert(1)' },
            ],
            routes: [{ from: 'a', to: 'b' }, { from: 'a', to: 'zz' }, { from: 'a', to: 'a' }, null],
            layers: [{ id: 'region:ghost', name: 'Ghost' }, { id: '' }],
            current: 'nowhere',
            layer: 'region:ghost',
            orient: 'sideways',
        },
    });
    assert.deepEqual(odd.$$('.sd-map-place').map(node => node.getAttribute('title')), ['Alpha', 'b', 'Gamma', 'Delta']);
    assert.deepEqual(odd.$$('.sd-map-layer').map(chip => chip.textContent), ['All']);
    assert.equal(odd.$('.sd-map-here').hidden, true);
    assert.equal(odd.$$('.sd-map-route').length, 1);
    assert.match(odd.$$('.sd-map-place i').at(-1).className, /fa-location-dot/, 'an unsafe icon falls back');
    // Two places on one spot, everything zoomable and pannable without a NaN anywhere.
    odd.key('+');
    odd.key('ArrowDown');
    odd.$('.sd-map-me').click();
    for (const value of Object.values(odd.handle.state.view)) assert.ok(Number.isFinite(value));
    for (const node of odd.$$('.sd-map-place')) assert.doesNotMatch(node.style.left, /NaN/);
    // readView and onLayer on their own.
    assert.deepEqual(readView(null).places, []);
    assert.equal(onLayer({ plane: '', layer: 'region:x' }, ''), true);
    assert.equal(onLayer({ plane: 'deep', layer: 'plane:deep' }, ''), false);
    assert.equal(onLayer({ plane: 'deep', layer: 'plane:deep' }, 'plane:deep'), true);
    assert.equal(iconFor('quay'), 'fa-anchor');
});

test('a huge pack: 2000 places draw, and 50 pans and zooms repaint, in reasonable time', () => {
    const places = Array.from({ length: 2000 }, (_, i) => ({ id: `p${i}`, name: `Place ${i}`, x: (i % 50) * 2, y: Math.floor(i / 50) * 2, visited: i % 10 === 0, kind: 'village', icon: 'fa-house', layer: '', plane: '', region: '', aliases: [] }));
    const routes = Array.from({ length: 1999 }, (_, i) => ({ from: `p${i}`, to: `p${i + 1}`, kind: 'road', known: false }));
    const started = process.hrtime.bigint();
    const { key, $$, $, handle } = draw({ value: { places, routes, layers: [], current: 'p0' } });
    for (let i = 0; i < 25; i += 1) {
        key('+');
        key('ArrowLeft');
    }
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    assert.equal($$('.sd-map-place').length, 2000);
    assert.ok(ms < 15000, `took ${ms} ms`);
    const input = $('.sd-map-search input');
    input.value = 'place 1999';
    input.dispatch('input');
    assert.equal($('.sd-map-result-name').textContent, 'Place 1999');
    assert.ok(handle.state.view.k > handle.state.fitK);
});

// A dense cluster: three places a few pixels apart at the fit zoom, with a far one so the fit stays small.
const CLUSTER = {
    places: [
        { name: 'Alpha', region: 'Dense', kind: 'town', x: 0, y: 0 },
        { name: 'Bravo', region: 'Dense', kind: 'town', x: 12, y: 0 },
        { name: 'Charlie', region: 'Dense', kind: 'inn', x: 6, y: 6 },
        { name: 'Far Away', region: 'Dense', kind: 'city', x: 400, y: 0 },
    ],
    routes: [],
};

function clusterDraw(win) {
    const state = makeState({ place: 'Alpha', kind: 'town', region: 'Dense' });
    return draw({ state, win, value: query(state, 'atlas.view', {}, { pack: CLUSTER }) });
}

test('phone taps: the dot keeps its size, its tap area is 44px (CSS), and in a dense cluster the tap picks the nearest dot', () => {
    const phone = { matchMedia: q => ({ matches: q === '(pointer: coarse)' }) };
    const { doc, root, handle } = clusterDraw(phone);
    const css = MAP_CSS;
    assert.match(css, /@media \(pointer: coarse\) \{\s*\.sd-map \.sd-map-place::before \{[^}]*width: 44px; height: 44px;/);
    // The dots themselves are unchanged on a phone (no size rule inside the coarse block).
    assert.doesNotMatch(css.slice(css.indexOf('@media (pointer: coarse)')), /\.sd-map-place \{[^}]*width/);

    const dot = name => root.querySelectorAll('.sd-map-place').find(node => node.getAttribute('title') === name);
    const at = node => ({ x: parseFloat(node.style.left), y: parseFloat(node.style.top) });
    const alpha = dot('Alpha');
    const bravo = dot('Bravo');
    const a = at(alpha);
    const b = at(bravo);
    const gap = Math.hypot(a.x - b.x, a.y - b.y);
    assert.ok(gap > 0 && gap < 44, `the fixture is a dense cluster (${gap.toFixed(1)}px apart)`);

    // The browser gave the tap to Alpha's square, but the tap is 3px from Bravo's dot: Bravo.
    const towardAlpha = { x: b.x + 3 * (a.x - b.x) / gap, y: b.y + 3 * (a.y - b.y) / gap };
    alpha.dispatch('click', { clientX: towardAlpha.x, clientY: towardAlpha.y });
    assert.equal(handle.state.picked, bravo.getAttribute('data-id'));
    // And the reverse: given to Bravo's square, 3px from Alpha's dot: Alpha.
    const towardBravo = { x: a.x + 3 * (b.x - a.x) / gap, y: a.y + 3 * (b.y - a.y) / gap };
    bravo.dispatch('click', { clientX: towardBravo.x, clientY: towardBravo.y });
    assert.equal(handle.state.picked, alpha.getAttribute('data-id'));
    // A tap on a dot's own centre picks that dot, whichever square got it.
    bravo.dispatch('click', { clientX: b.x, clientY: b.y });
    assert.equal(handle.state.picked, bravo.getAttribute('data-id'));
});

test('desktop: no tap area, a click picks the place it landed on, as before', () => {
    const fine = { matchMedia: q => ({ matches: false }) };
    const { root, handle } = clusterDraw(fine);
    const dot = name => root.querySelectorAll('.sd-map-place').find(node => node.getAttribute('title') === name);
    const alpha = dot('Alpha');
    const bravo = dot('Bravo');
    const a = { x: parseFloat(alpha.style.left), y: parseFloat(alpha.style.top) };
    const b = { x: parseFloat(bravo.style.left), y: parseFloat(bravo.style.top) };
    const gap = Math.hypot(a.x - b.x, a.y - b.y);
    const towardBravo = { x: a.x + 3 * (b.x - a.x) / gap, y: a.y + 3 * (b.y - a.y) / gap };
    alpha.dispatch('click', { clientX: towardBravo.x, clientY: towardBravo.y });
    assert.equal(handle.state.picked, alpha.getAttribute('data-id'));
});
