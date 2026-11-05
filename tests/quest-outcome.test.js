// questOutcome (src/tracker.js): how a closed quest ended, read from its reason. v2's thread conversion
// (src/v2/tracker/convert.js outcomeOf) writes it as thread.ended.outcome. Moved here from the v1 Journal's tests.
import test from 'node:test';
import assert from 'node:assert/strict';

import { questOutcome } from '../src/tracker.js';

test('questOutcome reads a closed quest\'s reason', () => {
    const quest = reason => ({ kind: 'quest', status: 'resolved', resolved: { reason } });
    assert.equal(questOutcome(quest('turned in, paid')), 'done');
    assert.equal(questOutcome(quest('expired, too late')), 'failed');
    assert.equal(questOutcome(quest('gave up on it')), 'abandoned');
    assert.equal(questOutcome({ ...quest('merged'), status: 'superseded' }), null);
    assert.equal(questOutcome({ kind: 'hook', status: 'resolved', resolved: { reason: 'done' } }), null);
});
