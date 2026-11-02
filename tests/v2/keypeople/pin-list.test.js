// Key people, the Pin list: it stays inside the card (a max height, scrolling there), and opening it keeps the card in view by moving its own
// scroller only (screens/scroll.js, the same maths as Story Block's view/scroll.js revealIn): never scrollIntoView, never a bare focus(),
// never the page. A fake DOM has no layout, so the boxes below are given the numbers a browser would measure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { worldScreen } from '../../../src/v2/world/screen.js';
import { keyPeopleWidget } from '../../../src/v2/keypeople/widget.js';
import { revealIn, scrollerOf, zoomOf } from '../../../src/v2/screens/scroll.js';
import { revealIn as hostRevealIn } from '../../vendor/story-block/src/v2/view/scroll.js';
import { installFakeDom } from '../../ui-fake-dom.js';

const VIEW = {
    on: true, cap: 10, count: 1, countText: '1 of 10', limitText: '', full: false, hasPeople: true,
    people: [{ key: 'ren', name: 'Ren', here: false, away: false, due: false, status: 'Not here', doing: '', last: '', back: '' }],
    choices: Array.from({ length: 12 }, (_, index) => ({ name: `Person ${index}`, aliases: [], source: 'cast', nsd: false })),
    tokens: 0, budget: 300, note: 'The note.',
};

const box = (top, height) => ({ top, height, bottom: top + height, left: 0, right: 300, width: 300 });

// body > scroller (the game view's body) > card (.wv-key) > the widget's element; `scrollIntoView` and `focus` are traps.
function setup({ scroll = true, cardTop = 350, cardHeight = 350 } = {}) {
    const doc = installFakeDom();
    doc.head = doc.createElement('head');
    const calls = [];
    if (scroll) doc.defaultView = { getComputedStyle: node => ({ overflowY: node.className.includes('ss-gameview-body') ? 'auto' : 'visible' }) };
    doc.documentElement = doc.createElement('html');
    const scroller = doc.createElement('div');
    scroller.className = 'ss-gameview-body';
    const card = doc.createElement('section');
    card.className = 'wv-key';
    const el = doc.createElement('div');
    for (const node of [scroller, card, el, doc.body, doc.documentElement]) {
        node.scrollIntoView = () => calls.push('scrollIntoView');
        node.focus = () => calls.push('focus');
    }
    doc.body.appendChild(scroller);
    scroller.appendChild(card);
    card.appendChild(el);
    Object.assign(scroller, { scrollHeight: 1500, clientHeight: 400, scrollTop: 0, getBoundingClientRect: () => box(0, 400) });
    card.getBoundingClientRect = () => box(cardTop - scroller.scrollTop, cardHeight);
    const handle = keyPeopleWidget.render(el, { value: VIEW }, { command: async () => ({ ok: true }) });
    return { doc, scroller, card, el, handle, calls };
}

test('opening + Pin brings the card into view by moving its own scroller; nothing else moves and nothing is focused', () => {
    const { doc, scroller, el, calls } = setup();
    el.querySelector('.wv-key-pin').click();
    assert.ok(el.querySelector('.wv-key-choices'), 'the list is open');
    // The card's bottom (700) was below the scroller's (400): it moves up by the bottom's distance less the 8px margin.
    assert.equal(scroller.scrollTop, 700 - (400 - 8));
    assert.deepEqual(calls, [], 'no scrollIntoView, no focus');
    assert.equal(doc.activeElement, null);
    assert.equal(doc.body.scrollTop ?? 0, 0);
});

test('a card already in view is left where it is; Close and a redraw while it is open do not move it either', () => {
    const inView = setup({ cardTop: 20, cardHeight: 200 });
    inView.el.querySelector('.wv-key-pin').click();
    assert.equal(inView.scroller.scrollTop, 0);
    const { scroller, el, handle } = setup();
    el.querySelector('.wv-key-pin').click();
    const opened = scroller.scrollTop;
    assert.ok(opened > 0);
    scroller.scrollTop = 40;
    handle.update({ value: VIEW });
    assert.equal(scroller.scrollTop, 40, 'a redraw of the open list does not pull the reader back');
    el.querySelector('.wv-key-pin').click();
    assert.equal(el.querySelector('.wv-key-choices'), null, 'closed');
    assert.equal(scroller.scrollTop, 40);
});

test('a card taller than the room has its top at the top; one above the view comes down; no scroller (no layout) does nothing and does not throw', () => {
    const tall = setup({ cardTop: 350, cardHeight: 900 });
    tall.el.querySelector('.wv-key-pin').click();
    assert.equal(tall.scroller.scrollTop, 350 - 8);
    const above = setup({ cardTop: -200, cardHeight: 200 });
    above.el.querySelector('.wv-key-pin').click();
    assert.equal(above.scroller.scrollTop, -200 - 8);
    const bare = setup({ scroll: false });
    assert.doesNotThrow(() => bare.el.querySelector('.wv-key-pin').click());
    assert.equal(bare.scroller.scrollTop, 0);
    assert.ok(bare.el.querySelector('.wv-key-choices'));
});

test('the scroll helper does what Story Block\'s revealIn does for the same boxes (nearest and start), and finds only a real scroller', () => {
    for (const [block, cardTop, cardHeight] of [['nearest', 350, 350], ['nearest', 20, 100], ['nearest', -50, 100], ['nearest', 350, 900], ['start', 250, 100], ['start', 5, 100]]) {
        const mine = setup({ cardTop, cardHeight });
        const host = setup({ cardTop, cardHeight });
        const a = revealIn(mine.scroller, mine.card, block);
        const b = hostRevealIn(host.scroller, host.card, block);
        assert.equal(mine.scroller.scrollTop, host.scroller.scrollTop, `${block} ${cardTop}/${cardHeight}`);
        assert.equal(a, b);
    }
    const { scroller, card, doc } = setup();
    assert.equal(scrollerOf(card), scroller);
    scroller.scrollHeight = 400;
    assert.equal(scrollerOf(card), null, 'a box with nothing more to show is not a scroller');
    assert.equal(scrollerOf(doc.body), null, 'never the page');
    assert.equal(zoomOf(scroller), 1);
    assert.equal(revealIn(null, null), false);
});

test('the Pin list: a max height that follows the screen (32vh, at most 260px), scrolling inside the card, not chaining into the page', () => {
    const rule = /\.wv-key-choices \{([^}]*)\}/.exec(worldScreen.css)?.[1] ?? '';
    for (const part of ['max-height: min(260px, 32vh)', 'overflow-y: auto', 'overscroll-behavior: contain', 'min-width: 0']) assert.ok(rule.includes(part), part);
});

test('Story Director never scrolls with scrollIntoView and never calls a bare focus()', () => {
    const files = [];
    const walk = dir => { for (const name of readdirSync(dir)) { const path = join(dir, name); if (statSync(path).isDirectory()) walk(path); else if (name.endsWith('.js')) files.push(path); } };
    walk(new URL('../../../src', import.meta.url).pathname);
    assert.ok(files.length > 50);
    for (const file of files) {
        const code = readFileSync(file, 'utf8').split('\n').filter(line => !line.trim().startsWith('//') && !line.trim().startsWith('*')).join('\n');
        assert.doesNotMatch(code, /\.scrollIntoView\s*\(/, file);
        assert.doesNotMatch(code, /\.focus\(\s*\)/, file);
    }
});
