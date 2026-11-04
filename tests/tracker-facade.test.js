// Tests for the src/tracker.js facade: every name it exported before the word and "said" helpers
// moved to src/tracker-words.js and src/tracker-said.js is still exported from the old path, and
// nothing else is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as tracker from '../src/tracker.js';
import * as words from '../src/tracker-words.js';
import * as said from '../src/tracker-said.js';

const BEFORE_SPLIT = [
    'waitsForPay',
    'looksFinished',
    'givenUpIn',
    'isOffer',
    'offersChosenIn',
    'emptyTracker',
    'keyWords',
    'nearMatches',
    'applyOps',
    'markSeen',
    'replay',
    'untrackedCorrections',
    'questOutcome',
    'findRecord',
    'activeRecords',
    'questsDoneIn',
];

test('tracker.js still exports every name it exported before the split', () => {
    for (const name of BEFORE_SPLIT) assert.equal(typeof tracker[name], 'function', name);
});

test('tracker.js exports no other names', () => {
    assert.deepEqual(Object.keys(tracker).sort(), [...BEFORE_SPLIT].sort());
});

test('the moved names are the same functions as in the new files', () => {
    assert.equal(tracker.keyWords, words.keyWords);
    assert.equal(tracker.nearMatches, words.nearMatches);
    for (const name of ['waitsForPay', 'looksFinished', 'givenUpIn', 'isOffer', 'offersChosenIn']) assert.equal(tracker[name], said[name], name);
});
