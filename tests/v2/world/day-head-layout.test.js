// The Journal's day head: the date and the "today so far" pill on the first line, the summary on its own
// line below in body text (4px between the lines, wrapping normally), not one run-on line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { worldScreen } from '../../../src/v2/world/screen.js';

test('a day head: the date and pill in one row, the summary below it in body text', () => {
    const template = worldScreen.template;
    assert.match(template, /<span class="wv-top"><span class="wv-date">\{\{ d\.date \}\}<\/span> <span class="ss-pill" data-if="d\.today">today so far<\/span><\/span> <span class="wv-line">\{\{ d\.short \}\}<\/span>/);
    const css = worldScreen.css;
    assert.match(css, /\.wv-top \{ display: flex; flex-wrap: wrap;/);
    assert.match(css, /\.wv-line \{ display: block; margin-top: 4px; color: var\(--sd-text\); \}/);
});
