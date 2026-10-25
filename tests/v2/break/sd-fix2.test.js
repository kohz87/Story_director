// Coordinator decisions after the break rounds ("code sets numbers"): a rank the story writes is at most
// the party's own (one above it until RX-E-1), and a thread's summary is at most 600 characters.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SUMMARY_CHARS, capSummary } from '../../../src/v2/tracker/capture.js';
import { lastProblems, makeState, reply, thread } from '../tracker/helpers/fake-ctx.js';
import { problemList } from '../../../src/v2/tracker/domain.js';

test('a thread summary is cut to 600 characters at a space, with a Problem', () => {
    const long = Array.from({ length: 300 }, (_, i) => `word${i}`).join(' ');
    const state = reply(makeState(), `+ hook Long Tale — ${long}`).state;
    const tale = thread(state, 'Long Tale');
    assert.ok(tale.summary.length <= SUMMARY_CHARS, String(tale.summary.length));
    assert.match(tale.summary, /word\d+…$/, 'cut after a whole word');
    assert.ok(long.startsWith(tale.summary.slice(0, -1)));
    assert.equal(lastProblems(state).at(-1).kind, 'long-summary');
    // Changing the thread again keeps it within the limit; a short summary is left as written.
    const again = reply(state, `~ hook Long Tale — ${long} and more`).state;
    assert.ok(thread(again, 'Long Tale').summary.length <= SUMMARY_CHARS);
    assert.equal(capSummary('short'), 'short');
    assert.equal(capSummary('x'.repeat(2000)).length, SUMMARY_CHARS, 'no space: a hard cut');
});
