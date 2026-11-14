// The Journal's day head: the date, the "today" pill and "yesterday · N events" on one row, with a centred chevron;
// the one-line summary is inside the fold, once, in body text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { worldScreen } from '../../../src/v2/world/screen.js';

test('a day head: the date, pill and "ago · N events" in one row with a centred chevron; the summary inside, once', () => {
    const template = worldScreen.template;
    assert.match(template, /<summary class="wv-head"><span class="wv-top"><span class="wv-date">\{\{ d\.date \}\}<\/span> <span class="ss-pill" data-if="d\.today">today<\/span> <small class="wv-meta" data-if="d\.meta">\{\{ d\.meta \}\}<\/small><\/span><\/summary>/);
    assert.match(template, /<div class="wv-body">\s*<p class="wv-line" data-if="d\.line">\{\{ d\.line \}\}<\/p>/);
    assert.equal(template.split('{{ d.line }}').length, 2, 'the summary is drawn once');
    const css = worldScreen.css;
    assert.match(css, /\.wv-top \{ display: flex; flex-wrap: wrap;/);
    assert.match(css, /\.wv-head, \.wv-cathead \{ display: flex; align-items: center;/);
    // Today's card opens by default (a bound open); a kind row is 42px on the screen, with a divider between rows, and entries start under the kind's name.
    assert.match(template, /<details class="wv-fold" data-bind-attr="open: d\.today"/);
    assert.match(css, /\.wv-cathead \{[^}]*min-height: calc\(42px \/ var\(--ss-zoomed, 1\)\)/);
    assert.match(css, /\.wv-cat \{ border-top: 1px solid/);
    assert.match(css, /\.wv-items \{[^}]*padding: 0 0 12px 22px/);
    assert.match(css, /summary\.wv-head::before, summary\.wv-cathead::before \{ content: ''/);
});
