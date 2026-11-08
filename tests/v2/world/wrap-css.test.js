// The Journal and the Hooks list keep their text inside their cards: the rules the screenshots of 8 Nov asked for.

import test from 'node:test';
import assert from 'node:assert/strict';

import { worldScreen } from '../../../src/v2/world/index.js';
import { directorScreen } from '../../../src/v2/screens/director.js';

const rule = (css, selector) => css.split('\n').find(line => line.startsWith(selector)) ?? '';

test('Journal lines wrap inside the card, grid children may shrink, section rules stop at the card edge', () => {
    const css = worldScreen.css;
    assert.match(rule(css, '.wv-journal, .wv-journal li'), /overflow-wrap: anywhere/);
    assert.match(rule(css, '.wv, .wv-journal'), /minmax\(0, 1fr\)/);
    assert.match(rule(css, '.wv-fold, .wv-part'), /min-width: 0/);
    assert.match(rule(css, '.wv-part .wv-label'), /overflow: hidden/);
    assert.match(rule(css, '.wv-find-label') + rule(css, '.wv-journal, .wv-journal li'), /wv-find-label/);
});

test('the hook status pill keeps its width beside the name; the description wraps under it', () => {
    const css = directorScreen.css;
    assert.match(rule(css, '.sd-tags .ss-pill'), /white-space: nowrap/);
    assert.match(rule(css, '.sd-tags {'), /flex: none/);
    assert.match(rule(css, '.sd-thread .ss-listcard-main'), /min-width: 0/);
    assert.doesNotMatch(css, /max-width: 42%/);
});
