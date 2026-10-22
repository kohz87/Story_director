// a3-3 (live: SB + Story Director only, a non-RPG dating sim): with no fight runner, Story Director's
// prompt and screens never speak of fights (WAVE rule 11) — but its "Day digest" feature, shown in the
// Story Suite settings → Features, still describes itself as writing "places, quests, fights, money, …".
// Live: Mira (dating sim) chat, open Suite → Features → Story Director: "...(places, quests, fights,
// money, NPC stages, world news)...". Expected: the description follows the module set (no "fights"
// without a fight runner), as the beat grammar does (GRAMMAR_ALONE).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';

test('a3-3: Story Director alone: no feature description speaks of fights', async () => {
    let host = null;
    const module = createModule({ host: { settings: id => host?.sdk.settings(id) ?? null, substitute: text => host?.sdk.substitute(text) } });
    host = await createHost({ modules: [module] });
    const list = typeof host.sdk.features === 'function' ? host.sdk.features() : [];
    assert.ok(list.length > 0, 'features are listed');
    const said = list.filter(f => f.moduleId === 'story-director')
        .map(f => `${f.id}: ${[f.label, f.describe, f.description, f.help].filter(Boolean).join(' ')}`)
        .filter(text => /\bfights?\b|\bcombat\b|\bfoes?\b/i.test(text));
    assert.deepEqual(said, [], `fight wording with no fight runner: ${said.join(' | ')}`);
});
