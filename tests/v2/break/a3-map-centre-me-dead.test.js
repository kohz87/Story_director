// a3-2 (live: SB + Story Director, fresh chat, or any chat before a place is known): the Map's
// "Centre on where you are" button (.sd-map-me) is shown and enabled, but a click does nothing
// (widget.js toMe: `if (data.current) goTo(data.current)`): a dead control. Expected: disabled
// (or hidden) while there is no current place, enabled once there is one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { atlasMapWidget, forgetViews } from '../../../src/v2/atlas/widget.js';
import { installFakeDom } from '../../ui-fake-dom.js';
import { makeState, query } from '../atlas/helpers/fake-ctx.js';

test('a3-2: with no current place the "Centre on where you are" button is not a dead control', () => {
    forgetViews();
    const doc = installFakeDom();
    const el = doc.createElement('div');
    doc.body.appendChild(el);
    const state = makeState();
    const api = { query: (name, args) => query(state, name, args) };
    const data = query(state, 'atlas.view', {});
    atlasMapWidget.render(el, { value: data, label: 'Map' }, api);
    const me = el.querySelector('.sd-map-me');
    assert.ok(me, 'the button is drawn');
    assert.ok(!data?.current, 'no current place');
    const off = me.hidden === true || me.disabled === true || me.getAttribute('disabled') !== null || me.getAttribute('aria-disabled') === 'true';
    assert.ok(off, 'the button is enabled although a click does nothing');
});
