// The narrator's time line shows what a clock time looks like (USER 2 Nov: models wrote `~ time midday`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { GRAMMAR } from '../../../src/v2/tracker/note.js';

test('the time grammar line gives a clock-time example', () => {
    assert.match(GRAMMAR.time, /^~ time <date, clock time such as 9:30 am> \(the scene's time\)/);
});
