import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

import { part } from '../../../src/v2/atlas/index.js';
import { MAP_SCREEN_ID, mapScreen } from '../../../src/v2/atlas/screen.js';
import { validateScreen } from './vendor/story-block/src/v2/view/screens.js';
import { installFakeDom } from '../../ui-fake-dom.js';
import { command, lines, makeState, placeNamed, query } from './helpers/fake-ctx.js';

// Story Block's template renderer (SPEC §13.2), used from a Story Block checkout when there is one.
const SB = new URL('../../vendor/story-block/src/v2/', import.meta.url).pathname;
const HAVE_TEMPLATES = ['view/template/index.js', 'view/bind.js', 'events/index.js'].every(file => existsSync(`${SB}${file}`));
const NO_TEMPLATES = HAVE_TEMPLATES ? false : `Story Block's template renderer is not at ${SB}view/template/ (it is not vendored here)`;

test('the Map screen is a valid screen definition for the tab and the full screen', () => {
    assert.deepEqual(part.screens, [mapScreen]);
    assert.equal(mapScreen.id, MAP_SCREEN_ID);
    assert.equal(MAP_SCREEN_ID, 'story-director/map');
    assert.deepEqual([...mapScreen.mounts], ['tab', 'screen']);
    assert.deepEqual(validateScreen(mapScreen), []);
    assert.deepEqual(Object.values(mapScreen.data).map(binding => binding.query).sort(), ['atlas.map', 'atlas.selected']);
    for (const binding of Object.values(mapScreen.data)) assert.ok(Object.hasOwn(part.queries, binding.query));
    assert.match(mapScreen.template, /<ss-widget name="ss\.map" data-props='\{"bind":"q\.map","onSelect":"atlas\.focus"/);
    assert.deepEqual(part.tabs, []);
});

function atlasState() {
    let state = makeState({ place: 'Bluewatch Village' });
    state = command(state, 'atlas.visit', { name: 'Bluewatch Village', kind: 'village', region: 'Lakeshore' }).state;
    return lines(state, '+ route Bluewatch Village — Old Weir | hours: 2 | kind: road').state;
}

test('the template draws ss.map bound to q.map, and a click on a place runs atlas.focus', { skip: NO_TEMPLATES }, async () => {
    const { compileTemplate, renderTemplate } = await import(`${SB}view/template/index.js`);
    const { conditionEvaluator } = await import(`${SB}view/bind.js`);
    const { compile, evaluate } = await import(`${SB}events/index.js`);
    const compiled = compileTemplate(mapScreen.template);
    assert.deepEqual(compiled.warnings, []);

    let state = atlasState();
    const scopeOf = current => ({ state: current, q: { map: query(current, 'atlas.map'), selected: query(current, 'atlas.selected') } });
    const drawn = [];
    const ran = [];
    const widgets = {
        'ss.map': {
            render(el, props, api) {
                drawn.push({ props, api });
                el.textContent = `map of ${props.value.nodes.length}`;
                return { update: next => drawn.push({ props: next, api }), destroy() {} };
            },
        },
    };
    const doc = installFakeDom();
    const el = doc.createElement('div');
    doc.body.appendChild(el);
    const view = renderTemplate(el, compiled, scopeOf(state), {
        evaluate: conditionEvaluator({ compile, evaluate }),
        widgets,
        command: (type, payload) => {
            ran.push({ type, payload });
            const run = command(state, type, payload);
            if (run.ok) state = run.state;
            return { ok: run.ok };
        },
    });
    assert.deepEqual(view.warnings, []);
    assert.equal(drawn.length, 1);
    const { props, api } = drawn[0];
    assert.deepEqual(props.value, query(state, 'atlas.map'));
    assert.equal(props.onSelect, 'atlas.focus');
    assert.equal(props.fog, 'unknown');
    assert.equal(el.querySelector('.atlas-place'), null);

    // The widget runs onSelect with { node } on a click; the picked place shows under the map.
    const weir = placeNamed(state, 'old weir').id;
    await api.command(props.onSelect, { node: weir });
    assert.deepEqual(ran, [{ type: 'atlas.focus', payload: { node: weir } }]);
    assert.equal(state.domains.atlas.focus, weir);
    view.update(scopeOf(state));
    assert.deepEqual(view.warnings, []);
    const panel = el.querySelector('.atlas-place');
    assert.ok(panel);
    assert.match(panel.textContent, /Old Weir/);
    assert.match(panel.textContent, /not visited/);
    assert.match(panel.textContent, /Bluewatch Village by road, 2 h/);

    // Close clears the pick.
    el.querySelector('.atlas-clear').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(ran.at(-1), { type: 'atlas.focus', payload: { node: null } });
    assert.equal(state.domains.atlas.focus, null);
    view.update(scopeOf(state));
    assert.equal(el.querySelector('.atlas-place'), null);
});
