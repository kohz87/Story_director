// B-b5b-robust-7: Story Director's own change-line parser (src/changes.js, used by the v2 tracker capture,
// src/v2/tracker/capture.js:104) is quadratic on a long run of spaces in a line, like Story Block's capture.js.
//   changes.js:69  KEY_DASH /\s*[—–]\s*|\s+-(?:\s+|$)/
//   changes.js:73  LABELLED /^(\p{L}[\p{L}\p{N}'’ -]*?)\s*:(?:\s+|$)(.*)$/su
//   changes.js:197 body.split(/\s*\|\s*/)
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChanges } from '../../../src/changes.js';

const SMALL = 5_000;
const LARGE = 20_000;
const RUNS = 3;

function ms(fn) {
    const start = process.hrtime.bigint();
    fn();
    return Number(process.hrtime.bigint() - start) / 1e6;
}

/** The fastest of RUNS timings: a load spike only ever adds time, so the minimum is the parser's own cost. */
function best(fn) {
    let fastest = Infinity;
    for (let i = 0; i < RUNS; i += 1) fastest = Math.min(fastest, ms(fn));
    return fastest;
}

/**
 * Linear, not quadratic. The same line with four times the run of spaces should take about four times as long
 * (a quadratic scan takes about sixteen times as long), so the test fails when the large parse is over 8x the
 * small one. The 2 ms floor stops sub-millisecond timings from failing on noise alone. No absolute time is
 * asserted, so a loaded machine cannot fail the test by being slow.
 */
function assertLinear(line, where) {
    parseChanges(line(LARGE)); // warm up the JIT before timing
    const small = best(() => parseChanges(line(SMALL)));
    const large = best(() => parseChanges(line(LARGE)));
    assert.ok(large < 8 * small + 2, `${where}: ${LARGE} spaces took ${large.toFixed(3)} ms, ${SMALL} spaces took ${small.toFixed(3)} ms`);
}

test('B-b5b-robust-7: parseChanges stays linear on a hook line with a long run of spaces in its key', () => {
    assertLinear(spaces => `+ hook Lost Cat${' '.repeat(spaces)}x — find it | giver: Elke`, 'KEY_DASH (changes.js:69) and the | split (changes.js:197)');
});

test('B-b5b-robust-7: parseChanges stays linear on a label with a long run of spaces', () => {
    assertLinear(spaces => `+ hook Lost Cat — find it | giver${' '.repeat(spaces)}x`, 'LABELLED (changes.js:73)');
});
