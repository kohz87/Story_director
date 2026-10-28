import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

import { part } from '../../../src/v2/atlas/index.js';
import { MAP_SCREEN_ID, mapScreen } from '../../../src/v2/atlas/screen.js';
import { MAP_WIDGET, atlasMapWidget, forgetViews } from '../../../src/v2/atlas/widget.js';
import { validateScreen } from '../../vendor/story-block/src/v2/view/screens.js';
import { installFakeDom } from '../../ui-fake-dom.js';
import { command, makeState, query } from './helpers/fake-ctx.js';

// Story Block's template renderer (SPEC §13.2), used from a Story Block checkout when there is one.
const SB = new URL('../../vendor/story-block/src/v2/', import.meta.url).pathname;
const HAVE_TEMPLATES = ['view/template/index.js', 'view/bind.js', 'events/index.js'].every(file => existsSync(`${SB}${file}`));
const NO_TEMPLATES = HAVE_TEMPLATES ? false : `Story Block's template renderer is not at ${SB}view/template/ (it is not vendored here)`;

const PACK = {
    places: [
        { name: 'Bluewatch Village', region: 'Lakeshore', kind: 'village', x: 10, y: 20 },
        { name: 'Old Weir', region: 'Lakeshore', kind: 'weir', x: 14, y: 26 },
        { name: 'Fenwatch', region: 'Fenmarch', kind: 'castle', x: 60, y: 20 },
    ],
    routes: [{ from: 'Bluewatch Village', to: 'Old Weir', km: 12, hours: 3, kind: 'road' }],
};

test('the Map screen is a valid screen definition holding the atlas Map widget bound to atlas.view', () => {
    assert.deepEqual(part.screens, [mapScreen]);
    assert.equal(mapScreen.id, MAP_SCREEN_ID);
    assert.equal(MAP_SCREEN_ID, 'story-director/map');
    assert.deepEqual([...mapScreen.mounts], ['tab', 'screen']);
    assert.deepEqual(validateScreen(mapScreen), []);
    assert.deepEqual(Object.values(mapScreen.data).map(binding => binding.query), ['atlas.view']);
    for (const binding of Object.values(mapScreen.data)) assert.ok(Object.hasOwn(part.queries, binding.query));
    assert.match(mapScreen.template, /<ss-widget name="story-director\.map" data-props='\{"bind":"q\.view","label":"Map"\}'>/);
    // The widget is the part's own, namespaced by the module id (MODULES §F9), with a render function.
    assert.equal(MAP_WIDGET, 'story-director.map');
    assert.deepEqual(part.widgets, { [MAP_WIDGET]: atlasMapWidget });
    assert.equal(typeof atlasMapWidget.render, 'function');
    assert.deepEqual(atlasMapWidget.validate({ value: {}, label: 'Map' }), []);
    assert.deepEqual(atlasMapWidget.validate({ value: 3, label: 4 }), ['label must be text.', 'value must be the atlas.view data.']);
    // Picking a place writes nothing: the screen gives no onSelect command.
    assert.doesNotMatch(mapScreen.template, /onSelect/);
    assert.deepEqual(part.tabs, []);
});

test('Story Block\'s template renderer draws the real Map widget from atlas.view; a pick shows the trip and writes nothing', { skip: NO_TEMPLATES }, async () => {
    const { compileTemplate, renderTemplate } = await import(`${SB}view/template/index.js`);
    const { conditionEvaluator } = await import(`${SB}view/bind.js`);
    const { compile, evaluate } = await import(`${SB}events/index.js`);
    forgetViews();
    const compiled = compileTemplate(mapScreen.template);
    assert.deepEqual(compiled.warnings, []);
    let state = makeState({ place: 'Bluewatch Village', region: 'The Wide Lands' });
    state = command(state, 'atlas.visit', { name: 'Bluewatch Village', region: 'The Wide Lands' }, { pack: PACK }).state;
    const ran = [];
    const doc = installFakeDom();
    const el = doc.createElement('div');
    doc.body.appendChild(el);
    const view = renderTemplate(el, compiled, { state, q: { view: query(state, 'atlas.view', {}, { pack: PACK }) } }, {
        evaluate: conditionEvaluator({ compile, evaluate }),
        widgets: { [MAP_WIDGET]: atlasMapWidget },
        command: (type, payload) => {
            ran.push({ type, payload });
            return { ok: true };
        },
        api: { query: (name, args) => query(state, name, args, { pack: PACK }) },
    });
    assert.deepEqual(view.warnings, []);
    const root = el.querySelector('.sd-map');
    assert.ok(root, 'the widget drew');
    assert.equal(root.getAttribute('aria-label'), 'Map');
    // It opens on the current place's region (the pack's, not the scene's "The Wide Lands"), with
    // the unvisited pack place drawn and marked; the Region list is All and the regions with places.
    assert.deepEqual(root.querySelectorAll('.sd-map-region option').map(option => option.textContent), ['All', 'Fenmarch', 'Lakeshore']);
    assert.equal(root.querySelector('.sd-map-region select').value, 'region:lakeshore');
    assert.deepEqual(root.querySelectorAll('.sd-map-place').map(node => node.getAttribute('title')), ['Bluewatch Village', 'Old Weir']);
    assert.equal(root.querySelector('.sd-map-place[data-visited="false"]').getAttribute('title'), 'Old Weir');
    // A pick: the details with the trip by known routes (code's figures), and no command run.
    root.querySelector('.sd-map-place[data-visited="false"]').click();
    const details = root.querySelector('.sd-map-details');
    assert.equal(details.hidden, false);
    assert.match(details.textContent, /Old Weir/);
    assert.match(details.textContent, /Weir · Lakeshore/);
    assert.match(details.textContent, /Not visited yet\./);
    assert.match(details.textContent, /From Bluewatch Village: 12 km, 3 h by road\./);
    assert.deepEqual(ran, []);
    view.destroy?.();
});
