// The one tab's line of views (src/ui/views.js, prototype).
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './ui-fake-dom.js';

const doc = installFakeDom();
const { renderViews } = await import('../src/ui/views.js');

const VIEWS = [{ id: 'quests', label: 'Quests', count: 2 }, { id: 'journal', label: 'Journal', count: 0 }, { id: 'director', label: 'Director', count: 1 }];

test('one line: each view a tab, the current one selected, counts above 0, arrows move', () => {
    const calls = [];
    const nav = renderViews(VIEWS, 'quests', (id, options) => calls.push([id, options?.focus ?? false]));
    doc.body.appendChild(nav);
    const tabs = nav.querySelectorAll('.story-director-view');
    assert.deepEqual(tabs.map(tab => tab.getAttribute('aria-selected')), ['true', 'false', 'false']);
    assert.deepEqual(tabs.map(tab => tab.getAttribute('tabindex')), ['0', '-1', '-1']);
    assert.deepEqual(nav.querySelectorAll('.story-director-view-count').map(node => node.textContent), ['2', '1']);
    assert.equal(nav.querySelectorAll('.story-director-view-sep').length, 2);
    tabs[0].click();
    assert.deepEqual(calls, [], 'the current view does nothing');
    tabs[2].click();
    assert.deepEqual(calls.at(-1), ['director', false]);
    tabs[0].dispatch('keydown', { key: 'ArrowLeft' });
    assert.deepEqual(calls.at(-1), ['director', true], 'left from the first wraps to the last');
    tabs[0].dispatch('keydown', { key: 'ArrowRight' });
    assert.deepEqual(calls.at(-1), ['journal', true]);
});
