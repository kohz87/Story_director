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

test('a card: goal, next step, one quiet line of giver, reward, deadline and place; deadline marks (0.9.11)', () => {
    const jack = quest('Kettle Jack', { type: 'bounty', goal: 'bring him in alive', step: 'cornered at the weir', giver: 'Warden Hale', reward: '40 crowns', due: 'Haywane 30', place: 'Weir road' });
    const late = quest('Herb run', { goal: 'twelve moonleaf', due: 'Haywane 2' });
    const pane = render({
        quests: [jack, late],
        status: record => (record.id === 'herb run' ? 'overdue' : 'soon'),
        formatDate: value => `${value} · in 3 days`,
    });
    const [first, second] = pane.querySelectorAll('.story-director-record');
    assert.equal(first.querySelector('.story-director-quest-goal').textContent, 'bring him in alive');
    assert.equal(first.querySelector('.story-director-quest-step').textContent, 'cornered at the weir');
    const meta = first.querySelectorAll('.story-director-quest-meta-part');
    assert.deepEqual(meta.map(part => [part.getAttribute('title'), part.textContent]), [['giver', 'Warden Hale'], ['reward', '40 crowns'], ['deadline', 'Haywane 30 · in 3 days'], ['place', 'Weir road']]);
    assert.equal(first.querySelector('dl'), null, 'no label rows');
    assert.match(first.textContent, /deadline soon/);
    assert.ok(second.classList.contains('is-overdue'));
    assert.match(second.textContent, /deadline passed/);
    assert.equal(second.querySelector('.story-director-quest-step'), null);
});

test('the description leads when there is no goal, and sits last, cut short, when there is (0.9.11)', () => {
    const pane = render({ quests: [
        quest('The bond', { goal: 'pay the bond', desc: 'A long tale of debts owed to the Glassdock collector and the reasons behind them.' }),
        quest('Sheepfold Wolves', { desc: 'drive the wolves off' }),
        quest('Same', { goal: 'one thing', desc: 'one thing' }),
    ] });
    const [bond, wolves, same] = pane.querySelectorAll('.story-director-record');
    assert.equal(bond.querySelector('.story-director-quest-goal').textContent, 'pay the bond');
    const desc = bond.querySelector('.story-director-quest-desc');
    assert.match(desc.textContent, /Glassdock collector/);
    assert.ok(!desc.classList.contains('is-open'));
    desc.click();
    assert.ok(desc.classList.contains('is-open'));
    assert.equal(wolves.querySelector('.story-director-quest-goal').textContent, 'drive the wolves off');
    assert.equal(wolves.querySelector('.story-director-quest-desc'), null);
    assert.equal(same.querySelector('.story-director-quest-desc'), null);
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

test('difficulty in the head, unless it is normal (0.9.11)', () => {
    const pane = render({ quests: [
        quest('Kettle Jack', { type: 'bounty', difficulty: 'hard' }),
        quest('Drowned Crown', { type: 'main', difficulty: 'nightmare' }),
        quest('Herb run', { difficulty: 'easy' }),
        quest('Rat cellar', {}),
        quest('Odd one', { difficulty: 'Deadly!' }),
    ] });
    const tags = pane.querySelectorAll('.story-director-tag.is-difficulty');
    assert.deepEqual(tags.map(tag => tag.textContent), ['nightmare', 'hard', 'easy', 'nightmare']);
    assert.ok(tags[1].classList.contains('is-hard'));
    assert.ok(tags[0].classList.contains('is-nightmare'));
    assert.ok(!/normal/.test(pane.textContent));
});

test('Abandon gives a quest up after asking twice; no Done or Failed: the story closes quests (0.9.5)', () => {
    const calls = [];
    const pane = render({ quests: [quest('Sheep-killer', { goal: 'kill the wolf' }), quest('Herb run')], onAbandon: id => calls.push(id) });
    const first = () => pane.querySelector('.story-director-record.is-quest');
    const flag = () => first().querySelector('.story-director-record-head .story-director-quest-abandon');
    assert.equal(flag().textContent, '', 'a quiet flag in the key line');
    assert.match(flag().getAttribute('title'), /Abandon Sheep-killer/);
    assert.equal(pane.querySelector('.story-director-quest-done, .story-director-quest-failed'), null);
    first().querySelector('.story-director-quest-abandon').click();
    assert.deepEqual(calls, [], 'the first click only asks');
    assert.equal(first().querySelector('.story-director-quest-abandon').textContent, 'Abandon?');
    first().querySelector('.story-director-quest-abandon').click();
    assert.deepEqual(calls, ['sheep-killer']);
    assert.equal(render({ quests: [quest('Herb run')] }).querySelector('.story-director-quest-abandon'), null, 'none without a handler');
});

test('jobs only offered fold away under Offered, with no buttons (0.9.15)', () => {
    const offer = quest('Wolf Hunt', { goal: 'kill ridge wolves', giver: 'Danique', reward: '4 silver', difficulty: 'hard' }, { kind: 'hook' });
    const pane = render({ quests: [quest('The bond', { type: 'main', goal: 'pay it off' })], offered: [offer], onAbandon: () => {} });
    const fold = pane.querySelector('details.story-director-fold.is-offered');
    assert.ok(fold);
    assert.equal(fold.open, false);
    assert.equal(subText(fold.querySelector('.story-director-sub')), 'Offered');
    assert.equal(fold.querySelector('.story-director-count').textContent, '1');
    const card = fold.querySelector('.story-director-record.is-offered');
    assert.equal(card.querySelector('.story-director-quest-goal').textContent, 'kill ridge wolves');
    assert.equal(card.querySelector('button'), null, 'no Abandon, no Take it');
    assert.equal(card.querySelector('.story-director-tag.is-difficulty'), null);
    assert.match(fold.textContent, /Say in the story that your character takes one on, or turns it down/);
    // The open quest keeps its Abandon flag.
    assert.ok(pane.querySelector('.story-director-section .story-director-quest-abandon'));
    assert.equal(render({ quests: [] }).querySelector('.is-offered'), null);
});
