// The Director tab, smoke test on the fake DOM: threads grouped by kind, then the problems.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { installFakeDom, texts } from '../../ui-fake-dom.js';
import { part } from '../../../src/v2/tracker/index.js';
import { makeState, story } from './helpers/fake-ctx.js';

test('the Director tab lists threads by kind, open first, and the problems newest first', () => {
    const doc = installFakeDom();
    const el = doc.createElement('div');
    doc.body.appendChild(el);
    const tab = part.tabs[0];
    tab.render(el, { state: makeState(), settings: {} }, {});
    assert.deepEqual(texts(el, 'p'), ['Nothing tracked yet.']);

    const state = story([
        { lines: '+ quest Wolf Hunt — Kill ridge wolves | giver: Danique\n+ quest Herb run — moonleaf | giver: Ysolde\n+ hook River stranger — who pulled Ren out\n+ secret The Heir — Ren is the heir', said: 'I take the wolf hunt.' },
        { lines: '- quest Wolf Hunt — done, Danique paid\n~ hook Footing | now: a room' },
    ]);
    tab.render(el, { state, settings: {} }, {});
    assert.deepEqual(texts(el, 'section h4'), ['Quests', 'Hooks', 'Secrets', 'Problems']);
    assert.deepEqual(texts(el, 'p'), []);
    assert.deepEqual(texts(el, 'section[data-kind="quest"] li'), ['Herb run (offered) — moonleaf', 'Wolf Hunt — Kill ridge wolves [done]']);
    assert.deepEqual(texts(el, 'section[data-kind="hook"] li'), ['River stranger — who pulled Ren out', 'Footing — a room']);
    assert.deepEqual(texts(el, 'section[data-kind="secret"] li'), ['The Heir'], 'a secret by its name only');
    assert.deepEqual(texts(el, 'section[data-kind="problems"] li'), [
        '"Footing" was not tracked; added as a hook (write "+ kind Key" to set its kind).',
        '"Herb run" was offered, not taken on: it stays an offer until {{user}} accepts it.',
    ]);
    // Rendering again replaces what was there.
    tab.render(el, { state, settings: {} }, {});
    assert.equal(el.querySelectorAll('div.sd-director').length, 1);
});
