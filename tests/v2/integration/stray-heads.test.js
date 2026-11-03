// A change line of a family-member kind written outside <Changes> is still taken, as in 2.9.3 (the lean diet gave those kinds no grammar line
// of their own). Story Block reads a kind spec's `heads` (a release after the vendored copy), so this uses a stand-in that honours them the way
// the host will: the heads of the grammar lines, plus every kind's `heads`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createModule } from '../../../src/v2/module.js';
import { grammarHeads, strayLines } from '../../vendor/story-block/src/v2/capture.js';

const def = createModule();
// What the host's contexts() would hand grammarHeads: the kinds with a grammar line or with heads.
function standInHeads() {
    const entries = Object.entries(def.capture.kinds).map(([kind, spec]) => ({ kind, grammar: typeof spec.grammar === 'string' ? spec.grammar : '', heads: spec.heads ?? [] }));
    const heads = grammarHeads(entries.filter(entry => entry.grammar));
    for (const entry of entries) for (const head of entry.heads) heads.add(head);
    return heads;
}
const STRAYS = {
    event: '+ event Fair — the fair | on: June 14, 1200, 08:00 am',
    clock: '+ clock Flood — the levee breaks | due: June 8, 1200, 08:00 am | shown: sign',
    beat: '+ beat Storm — a storm | on: June 5, 1200, 08:00 am',
    secret: '+ secret Heir — the lost heir',
    quest: '+ quest Wolf Hunt — kill wolves | goal: kill 3 wolves | giver: Danique',
    faction: '+ faction Guild — the guild | area: docks | stance: wary',
    landmark: '+ landmark Old Weir | region: the river | kind: ruin',
    trip: '~ trip Harrow | by: foot | via: Old Weir',
};

test('the eight family-member kinds carry heads, and a stray line of each is taken', () => {
    const heads = standInHeads();
    for (const [kind, line] of Object.entries(STRAYS)) {
        assert.ok(def.capture.kinds[kind].heads?.length, `${kind} has heads`);
        const out = strayLines(`Dawn.\n\n${line}\n\nMore story.`, heads);
        assert.equal(out.taken.length, 1, `${kind}: ${JSON.stringify(out)}`);
        assert.deepEqual(out.problems, [], kind);
    }
    // Without the heads (the vendored host today) the lines are not taken: the regression this closes.
    const plain = grammarHeads(Object.entries(def.capture.kinds).map(([kind, spec]) => ({ kind, grammar: typeof spec.grammar === 'string' ? spec.grammar : '' })).filter(entry => entry.grammar));
    assert.equal(strayLines(`Dawn.\n\n${STRAYS.event}\n\nMore.`, plain).taken.length, 0);
});
