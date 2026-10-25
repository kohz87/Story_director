import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { staticText, GRAMMAR } from '../../../src/v2/tracker/note.js';
import { createHost } from '../../vendor/story-block/testkit/host.js';
import { createModule } from '../../../src/v2/module.js';

const source = execFileSync('git', ['show', 'origin/main:src/v2/tracker/note.js'], { encoding: 'utf8' })
    .replace(/(from\s*['"])(\.[^'"]+)(['"])/g, (_, a, b, c) => a + new URL(b, new URL('../../../src/v2/tracker/note.js', import.meta.url)).href + c);
const main = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
for (const fights of [false, true]) test(`non-quest prompt bytes equal main (fights ${fights}), also after reload and rebuild`, async t => {
    const h = await createHost({ modules: [createModule()] }); t.after(() => h.close());
    const check = () => {
        assert.equal(staticText({ fights }), main.staticText({ fights }));
        for (const [kind, grammar] of Object.entries(GRAMMAR)) assert.equal(grammar, main.GRAMMAR[kind], kind);
    };
    await h.send('Walk.', 'A quiet road.'); check();
    await h.st.loadChat(structuredClone(h.ctx.chat)); check(); h.store.rebuild(); check();
});
