// B-b5b-robust-7: Story Director's own change-line parser (src/changes.js, used by the v2 tracker capture,
// src/v2/tracker/capture.js:104) is quadratic on a long run of spaces in a line, like Story Block's capture.js.
//   changes.js:69  KEY_DASH /\s*[—–]\s*|\s+-(?:\s+|$)/
//   changes.js:73  LABELLED /^(\p{L}[\p{L}\p{N}'’ -]*?)\s*:(?:\s+|$)(.*)$/su
//   changes.js:197 body.split(/\s*\|\s*/)
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChanges } from '../../../src/changes.js';

const SPACES = ' '.repeat(20_000);
function ms(fn) {
    const start = process.hrtime.bigint();
    fn();
    return Number(process.hrtime.bigint() - start) / 1e6;
}

test('B-b5b-robust-7: parseChanges stays linear on a hook line with a long run of spaces in its key', () => {
    assert.ok(ms(() => parseChanges(`+ hook Lost Cat${SPACES}x — find it | giver: Elke`)) < 100, 'KEY_DASH (changes.js:69) and the | split (changes.js:197)');
});

test('B-b5b-robust-7: parseChanges stays linear on a label with a long run of spaces', () => {
    assert.ok(ms(() => parseChanges(`+ hook Lost Cat — find it | giver${SPACES}x`)) < 100, 'LABELLED (changes.js:73)');
});
