// World part: a Journal day stored before bookkeeping was left out of the digest is shown without the fight board's narrator note,
// and the Journal's day card never shares a class with the Around-here time-of-day chip (whose nowrap once ran every line off the card).

import test from 'node:test';
import assert from 'node:assert/strict';

import { knownDay, worldScreen } from '../../../src/v2/world/index.js';
import { isNarratorNote } from '../../../src/v2/world/journal.js';

const none = { words: [], behind: [] };

test('an old stored day drops the narrator note from what happened and from its total', () => {
    const day = knownDay({
        day: 1, date: 'D', count: 3, more: 2,
        happened: [
            'You added Cane Sword.',
            'Tell the settled fight results in order; do not reroll them. | Write [battle] on its own line where the fight is told.',
            'Tell the approach, then the settled fight results in order; do not reroll them.',
        ],
    }, none);
    assert.deepEqual(day.happened, ['You added Cane Sword.']);
    assert.equal(day.total, 3);
    assert.equal(day.hasHappened, true);
    assert.ok(!day.search.includes('reroll'));
});

test('a story line that only mentions fights stays', () => {
    const day = knownDay({ day: 1, date: 'D', happened: ['The guard tells the settled fight results to the crowd.'] }, none);
    assert.equal(day.happened.length, 1);
});

test('the day card class carries no nowrap rule', () => {
    assert.ok(!/\.wv-day\s*\{[^}]*nowrap/.test(worldScreen.css));
    assert.match(worldScreen.css, /\.wv-daytime \{[^}]*nowrap/);
});

test('an old day also drops the older roll planner note', () => {
    assert.equal(isNarratorNote('[Rolls] Code rolled these. Tell them as given, and never invent a roll. Astra — Obscure (DEX), normal: SUCCESS (17 vs 15)'), true);
    assert.equal(isNarratorNote('[Rolls] Code rolled these and has already moved the bars they hit'), true);
    assert.equal(isNarratorNote('Rolls were good today, the boar fell.'), false);
});
