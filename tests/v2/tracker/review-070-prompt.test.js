import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { staticText, GRAMMAR } from '../../../src/v2/tracker/note.js';
import { createHost } from '../../vendor/story-block/testkit/host.js';
import { createModule } from '../../../src/v2/module.js';

// Frozen main baseline (43c9768): also available in shallow and lone CI clones.
const main = JSON.parse(readFileSync(new URL('./fixtures/non-quest-prompt.json', import.meta.url), 'utf8'));
for (const fights of [false, true]) test(`non-quest prompt bytes equal main (fights ${fights}), also after reload and rebuild`, async t => {
    const h = await createHost({ modules: [createModule()] }); t.after(() => h.close());
    const check = () => {
        assert.equal(staticText({ fights }), main.text[Number(fights)]);
        for (const [kind, grammar] of Object.entries(GRAMMAR)) assert.equal(grammar, main.grammar[kind], kind);
    };
    await h.send('Walk.', 'A quiet road.'); check();
    await h.st.loadChat(structuredClone(h.ctx.chat)); check(); h.store.rebuild(); check();
});
