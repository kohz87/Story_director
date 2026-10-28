// rx-ui (beta rolling break, user priority "modules stand alone"): Story Director without example fight runner
// (a dating sim) still tells the model about fights in its fixed prompt part: the beat grammar asks for
// "encounter: the foes, for a fight" and the Director fields list "encounter". Nothing keeps fights in
// such a chat, so these lines point the story at a mechanic that is not there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { fakeFightRunner } from '../integration/helpers/fake-fight-runner.js';

const staticOf = host => host.st.promptLog.filter(entry => entry.key === 'story_suite_static' && entry.value).at(-1)?.value ?? '';

test('Story Director alone: the fixed prompt does not ask for encounters or fights', async () => {
    const host = await createHost({ modules: [createModule()] });
    try {
        await host.send('I meet Fenna.', 'Fenna smiles.\n<Changes>\n~ place Bluewatch Village | kind: settlement\n</Changes>');
        const text = staticOf(host);
        assert.ok(text.includes('+ beat'), 'the beat line is there');
        assert.doesNotMatch(text, /encounter|\bfight\b|\bfoes?\b/i, 'the fixed prompt still asks for fights');
    } finally {
        host.close();
    }
});

test('Story Director alone: a due beat with foes does not tell the story to stop at the first blow (nothing resolves the fight)', async () => {
    const host = await createHost({ modules: [createModule()] });
    try {
        const block = lines => `<Changes>\n${lines.join('\n')}\n</Changes>`;
        await host.send('a', `Fenna smiles.\n${block(['~ place Bluewatch Village | kind: settlement', '~ time June 3, 1200, 08:00', '+ beat Ambush — bandits on the road | on: June 3, 1200, 09:00 | encounter: 3 Bandit'])}`);
        await host.send('b', `Time goes by.\n${block(['! time +2h'])}`);
        await host.send('c', `On the road.\n${block(['~ place Old Road | kind: wild'])}`);
        const tails = host.st.promptLog.filter(entry => entry.key === 'story_suite_tail_1' && entry.value).map(entry => entry.value);
        const stuck = tails.filter(text => /first blow|resolved outside the story/.test(text));
        assert.equal(stuck.length, 0, `the tail tells the story to stop at the first blow and wait for a fight nobody runs:\n${stuck.at(-1)}`);
    } finally {
        host.close();
    }
});

test('with a combat module the beat keeps its encounter field (control)', async () => {
    const host = await createHost({ modules: [fakeFightRunner(), createModule()] });
    try {
        await host.send('Hi.', 'Hello.\n<Changes>\n~ place Bluewatch Village | kind: settlement\n</Changes>');
        assert.match(staticOf(host), /encounter/);
    } finally {
        host.close();
    }
});
