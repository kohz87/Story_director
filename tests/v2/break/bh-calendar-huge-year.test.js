// A date written with an enormous year (model prose: "Goldwane 5, 99999999999999999999") used to be parsed
// and then hang `fromAbs` / `format` forever (the year search stopped moving past the exact integers).
// Run in a child process with a time limit, since the old failure was a hang, not a throw.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { makeCalendar } from '../../../src/calendar.js';

const calendarUrl = new URL('../../../src/calendar.js', import.meta.url).href;

test('a huge written year is not a date, and formatting one ends at once', () => {
    const script = `
        import { makeCalendar } from ${JSON.stringify(calendarUrl)};
        const c = makeCalendar('gregorian');
        const out = [];
        for (const year of ['99999999999999999999', '1000000000000000000', '-99999999999999999999']) {
            const parsed = c.parse('March 5, ' + year);
            out.push(parsed === null || Math.abs(parsed.year) <= 1e9 ? 'ok' : 'huge year parsed');
            try { c.format(parsed?.abs ?? 1e300); } catch { /* a RangeError is fine; a hang is not */ }
        }
        console.log(JSON.stringify(out));`;
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { timeout: 5000, encoding: 'utf8' });
    assert.equal(run.error, undefined, 'finished inside the time limit');
    assert.equal(run.status, 0, run.stderr);
    assert.equal(JSON.parse(run.stdout.trim().split('\n').pop()).includes('huge year parsed'), false);
});

test('a year within reach still parses and formats', () => {
    const c = makeCalendar('gregorian');
    const parsed = c.parse('March 5, 999999');
    assert.equal(parsed.year, 999999);
    assert.equal(c.format(parsed.abs, { time: false }), 'March 5, 999999');
    assert.throws(() => c.fromAbs(1e300), RangeError);
});
