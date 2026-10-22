// Break round, cell 2 (features off): with `story-director.digest` off, "off means fully off"
// (Story Block MODULES §F100, features.js): queries of an off feature answer null. The digest's command
// and Days screen carry `feature: 'story-director.digest'`, but its four queries do not, so with the
// feature off `chronicle.days` / `chronicle.day` / `chronicle.dayBoard` / `chronicle.dayFacts` still
// answer (the kept digests, the Days board, a full receipt walk) to any module or screen that asks.
// Checked on the merged module definition, the way tests/v2/chronicle/digest.test.js checks the command
// and the screen (the vendored Story Block in tests/vendor predates features, so the registry's
// null-answering cannot be driven from here).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createModule } from '../../../src/v2/module.js';
import { DIGEST_FEATURE } from '../../../src/v2/chronicle/days.js';

const DIGEST_QUERIES = ['chronicle.days', 'chronicle.day', 'chronicle.dayBoard', 'chronicle.dayFacts'];

test('every digest-only query is marked with the digest feature (so it answers null while the feature is off)', () => {
    const def = createModule({ host: { settings: () => null, substitute: text => text } });
    assert.ok((def.features ?? []).some(feature => feature.id === DIGEST_FEATURE), 'the module declares the digest feature');
    const unmarked = DIGEST_QUERIES.filter(name => typeof def.queries?.[name] === 'function' && def.queries[name].feature !== DIGEST_FEATURE);
    assert.deepEqual(unmarked, [], `queries still answering with the digest off: ${unmarked.join(', ')}`);
});
