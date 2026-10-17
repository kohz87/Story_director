// The Quests tab against the fake DOM: groups by type, rows, deadline marks, Finished fold.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, texts } from './ui-fake-dom.js';

const doc = installFakeDom();
const { renderQuests } = await import('../src/ui/quests.js');

function quest(key, fields = {}, more = {}) {
    return {
        key, id: key.toLowerCase(), kind: 'quest', status: 'active',
        fields: { desc: '', now: '', then: '', on: '', due: '', shown: '', leg: '', arrive: '', place: '', people: '', type: '', giver: '', goal: '', reward: '', step: '', ...fields },
        extra: {}, resolved: null, ...more,
    };
}

function render(options) {
    const pane = doc.createElement('div');
    doc.body.appendChild(pane);
    renderQuests(pane, options);
    return pane;
}

const subText = node => node.querySelector('span').textContent;

test('grouped by type in a fixed order, untyped last; plural and singular types are one group', () => {
    const pane = render({ quests: [
        quest('Herb run', { goal: 'twelve moonleaf' }),
        quest('Wolf pelts', { type: 'bounties', reward: '2 silver each' }),
        quest('Kettle Jack', { type: 'bounty', goal: 'bring him in alive' }),
        quest('The Drowned Crown', { type: 'main', goal: 'find the crown' }),
        quest('Mill wheel', { type: 'odd job' }),
    ] });
    const groups = pane.querySelectorAll('.story-director-section.is-quest-group');
    assert.deepEqual(groups.map(group => subText(group.querySelector('.story-director-sub'))), ['Main', 'Bounties', 'Odd job', 'Quests']);
    assert.deepEqual(texts(groups[1], '.story-director-record-key'), ['Wolf pelts', 'Kettle Jack']);
    assert.equal(groups[1].querySelector('.story-director-count').textContent, '2');
});

test('rows for goal, step, giver, reward, deadline and place; deadline marks', () => {
    const jack = quest('Kettle Jack', { type: 'bounty', goal: 'bring him in alive', step: 'cornered at the weir', giver: 'Warden Hale', reward: '40 crowns', due: 'Haywane 30', place: 'Weir road' });
    const late = quest('Herb run', { goal: 'twelve moonleaf', due: 'Haywane 2' });
    const pane = render({
        quests: [jack, late],
        status: record => (record.id === 'herb run' ? 'overdue' : 'soon'),
        formatDate: value => `${value} · in 3 days`,
    });
    const [first, second] = pane.querySelectorAll('.story-director-record');
    const rows = [...first.querySelectorAll('dt')].map((dt, index) => [dt.textContent, first.querySelectorAll('dd')[index].textContent]);
    assert.deepEqual(rows, [['goal', 'bring him in alive'], ['step', 'cornered at the weir'], ['giver', 'Warden Hale'], ['reward', '40 crowns'], ['deadline', 'Haywane 30 · in 3 days'], ['place', 'Weir road']]);
    assert.match(first.textContent, /deadline soon/);
    assert.ok(second.classList.contains('is-overdue'));
    assert.match(second.textContent, /deadline passed/);
});

test('finished quests fold away with how they ended; empty state explains quests', () => {
    const done = quest('Rat cellar', {}, { status: 'resolved', resolved: { message: 9, reason: 'cleared, paid 5 copper' } });
    const pane = render({ quests: [], finished: [done] });
    const fold = pane.querySelector('details.story-director-fold.is-finished');
    assert.equal(fold.open, false);
    assert.match(fold.textContent, /Rat cellar/);
    assert.match(fold.textContent, /cleared, paid 5 copper/);
    assert.match(pane.querySelector('.story-director-empty-text').textContent, /No open quests/);
});

test('every quest shows its difficulty, normal when the story gave none', () => {
    const pane = render({ quests: [
        quest('Kettle Jack', { type: 'bounty', difficulty: 'hard' }),
        quest('Drowned Crown', { type: 'main', difficulty: 'nightmare' }),
        quest('Herb run', { difficulty: 'easy' }),
        quest('Rat cellar', {}),
        quest('Odd one', { difficulty: 'Deadly!' }),
    ] });
    const tags = pane.querySelectorAll('.story-director-tag.is-difficulty');
    assert.deepEqual(tags.map(tag => tag.textContent), ['nightmare', 'hard', 'easy', 'normal', 'nightmare']);
    assert.ok(tags[1].classList.contains('is-hard'));
    assert.ok(tags[0].classList.contains('is-nightmare'));
    // In the head, next to the key, not as a row.
    assert.ok(![...pane.querySelectorAll('dt')].some(dt => dt.textContent === 'difficulty'));
});
