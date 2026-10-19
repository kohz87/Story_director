// (0.9.19) The Journal tab against the fake DOM: days newest first, items, the empty state,
// the Earlier days fold, and text drawn as text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, texts } from './ui-fake-dom.js';

const doc = installFakeDom();
const { renderJournal } = await import('../src/ui/journal.js');

function render(data) {
    const pane = doc.createElement('div');
    doc.body.appendChild(pane);
    renderJournal(pane, data);
    return pane;
}

const item = (type, how, key, more = {}) => ({ type, how, kind: type === 'event' ? 'beat' : type, key, text: '', message: 0, time: null, ...more });
const day = (label, items, key = label) => ({ key, label, day: null, items });

test('the empty state says what will land here', () => {
    const pane = render({ days: [] });
    assert.equal(pane.querySelector('.story-director-empty-text').textContent, 'Nothing recorded yet…');
    assert.match(pane.querySelector('.story-director-empty-hint').textContent, /only planned stays out/);
    assert.equal(pane.querySelector('.story-director-section'), null);
    assert.ok(render().querySelector('.story-director-journal .story-director-empty'), 'no data at all draws the same');
});

test('a day is a section headed by its date and count; items show key, tag and what happened', () => {
    const pane = render({ days: [
        day('CY 611, Haywane 13', [
            item('place', 'visited', 'Heron Ford'),
            item('event', 'fired', 'Ford ambush', { text: 'bandits burst from the reeds' }),
            item('quest', 'taken', 'Kettle Jack', { text: 'bring him in alive', giver: 'Warden Hale' }),
            item('quest', 'failed', 'Herb run', { text: 'the moonleaf wilted' }),
        ]),
        day('CY 611, Haywane 12', [item('event', 'sign', 'Smoke')]),
    ] });
    const sections = pane.querySelectorAll('.story-director-section.is-journal-day');
    assert.deepEqual(sections.map(section => section.querySelector('.story-director-sub span').textContent), ['CY 611, Haywane 13', 'CY 611, Haywane 12']);
    assert.equal(sections[0].querySelector('.story-director-count').textContent, '4');
    assert.deepEqual(texts(sections[0], '.story-director-record-key'), ['Heron Ford', 'Ford ambush', 'Kettle Jack', 'Herb run']);
    const [place, fired, taken, failed] = sections[0].querySelectorAll('.story-director-record.is-journal-item');
    assert.ok(place.classList.contains('is-place'));
    assert.match(place.textContent, /first visit/);
    assert.equal(fired.querySelector('.story-director-tag'), null, 'what happened needs no tag');
    assert.equal(fired.querySelector('.story-director-journal-text').textContent, 'bandits burst from the reeds');
    assert.equal(taken.querySelector('.story-director-tag').textContent, 'quest taken on');
    assert.equal(taken.querySelector('.story-director-quest-meta-part.is-giver').textContent, 'Warden Hale');
    assert.ok(failed.classList.contains('is-failed'));
    assert.equal(failed.querySelector('.story-director-tag').textContent, 'quest failed');
    const sign = sections[1].querySelector('.story-director-record');
    assert.equal(sign.querySelector('.story-director-tag').textContent, 'a sign');
    assert.equal(sign.querySelector('.story-director-journal-text'), null, 'no empty text line');
});

test('older days fold away under Earlier days, and the fold stays open once opened', () => {
    const days = Array.from({ length: 9 }, (_, index) => day(`Haywane ${20 - index}`, [item('event', 'fired', `Beat ${index}`)]));
    const pane = render({ days });
    const open = pane.querySelectorAll(':scope > .story-director-journal > .story-director-section');
    assert.equal(open.length, 7);
    const fold = pane.querySelector('details.story-director-fold.is-journal-earlier');
    assert.equal(fold.open, false);
    assert.equal(fold.querySelector('.story-director-count').textContent, '2');
    assert.deepEqual(texts(fold, '.story-director-record-key'), ['Beat 7', 'Beat 8']);
    fold.open = true;
    fold.dispatch('toggle');
    assert.equal(render({ days }).querySelector('details.is-journal-earlier').open, true);
    fold.open = false;
    fold.dispatch('toggle');
});

test('model-written text is drawn as text, an undated day is marked', () => {
    const pane = render({ days: [day('Undated', [item('event', 'closed', '<b>Old</b> thread', { text: '<img src=x onerror=alert(1)>' })], 'undated')] });
    assert.ok(pane.querySelector('.story-director-section.is-undated'));
    assert.equal(pane.querySelector('.story-director-record-key').textContent, '<b>Old</b> thread');
    assert.equal(pane.querySelector('.story-director-journal-text').textContent, '<img src=x onerror=alert(1)>');
    assert.equal(pane.querySelector('b'), null);
    assert.equal(pane.querySelector('img'), null);
});
