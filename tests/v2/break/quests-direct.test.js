// Quests go straight to active (user decision, Story Suite v2 live test): the story writes `+ quest` when
// {{user}} accepts a job, and the quest is active and taken on at once. There is no Offered list and no
// accept step; a job the story only mentions (`+ hook … | giver | reward`) stays an open thread of the
// story. An older chat's offers still load and are shown nowhere. Replay equals live after swipes and
// middle deletes, and Story Director alone (no RPG Battle) works the same.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { fakeRpgBattle } from '../integration/helpers/fake-rpg.js';

const TAIL_KEY = 'story_suite_tail_1';
const said = (text, lines = []) => (lines.length ? `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);
const quest = (host, key) => host.sdk.query('director.thread', { key });
const tails = host => host.st.promptLog.filter(entry => entry.key === TAIL_KEY && entry.value).map(entry => entry.value);

// Rebuilt from what is stored, and loaded fresh into another host, the state is the live one.
async function replayIsLive(host, modules, where) {
    assert.deepEqual(host.store.problems(), [], `${where}: every block applies`);
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live, `${where}: rebuild != live`);
    const again = await createHost({ modules: modules() });
    try {
        await again.st.loadChat(structuredClone(host.ctx.chat));
        assert.deepEqual(again.store.problems(), [], `${where}: a fresh load skips nothing`);
        assert.equal(JSON.stringify(again.head().domains), JSON.stringify(host.head().domains), `${where}: fresh load != live`);
    } finally {
        again.close();
    }
}

// The stored chat as an older Story Director wrote it: the hook's thread kept as an offer (a quest thread,
// `offer: true`, held until reply 1), in the reply's own ops and in its swipe's copy.
function asOlderChat(chat, key) {
    const out = structuredClone(chat);
    let patched = 0;
    for (const message of out) {
        const stores = [message.extra, ...(message.swipe_info ?? []).map(info => info?.extra)];
        for (const extra of stores) {
            for (const op of extra?.storySuite?.ops ?? []) {
                if (op.op === 'add' && op.value?.key === key && /^\/domains\/director\/threads\//.test(op.path)) {
                    op.value = { ...op.value, kind: 'quest', offer: true, shown: { turn: 1 }, track: { ...op.value.track, was: 'hook' } };
                    patched += 1;
                }
            }
        }
    }
    assert.ok(patched > 0, 'the older chat has its offer');
    return out;
}

const HOOK = '+ hook Herb Run — moonleaf for the healer | giver: Mother Ysolde | reward: 5 gold';

for (const [name, modules] of [['with RPG Battle', () => [fakeRpgBattle(), createModule()]], ['Story Director alone', () => [createModule()]]]) {
    test(`${name}: an older chat with an offer loads; it is shown nowhere; + quest takes it on; swipes and a middle delete replay as live`, async t => {
        t.mock.method(console, 'warn', () => {});
        const made = await createHost({ modules: modules() });
        await made.send('Any work?', said('Mother Ysolde mentions moonleaf.', ['~ place Bluewatch | kind: settlement', '+ present Mother Ysolde', HOOK]));
        await made.send('I look around.', said('Market stalls.', ['+ hook River stranger — who pulled Ren out']));
        const older = asOlderChat(made.ctx.chat, 'Herb Run');
        made.close();

        const host = await createHost({ modules: modules() });
        try {
            await host.st.loadChat(older);
            assert.deepEqual(host.store.problems(), [], 'the older chat loads whole');
            const offer = quest(host, 'Herb Run');
            assert.deepEqual([offer.kind, offer.offer, offer.taken], ['quest', true, null]);
            // Shown nowhere: no Offered list, no active quest, no tail line, no "accept" Problem.
            const board = host.sdk.query('quest.board');
            assert.deepEqual([board.offers, board.active, board.finished], [undefined, [], []]);
            assert.ok(!host.sdk.query('director.problems').some(problem => problem.kind === 'offered'));
            await host.send('Hm.', 'You think.');
            assert.doesNotMatch(tails(host).at(-1) ?? '', /Quest offers|take them on|turns them down/);

            // The story has {{user}} accept it: + quest makes it the quest, taken on at that reply.
            await host.send('Fine, I\'ll gather it.', said('Ysolde hands you a basket.', ['+ quest Herb Run — moonleaf | goal: bring 5 moonleaf']));
            const index = host.store.headIndex();
            const taken = quest(host, 'Herb Run');
            assert.deepEqual([taken.kind, taken.offer, taken.status], ['quest', false, 'active']);
            assert.equal(taken.taken.rev, host.store.at(index).meta.rev);
            assert.deepEqual(host.sdk.query('quest.board').active.map(entry => entry.key), ['Herb Run']);
            await replayIsLive(host, modules, 'taken');

            // A swipe without the line: the older offer again, shown nowhere; back to the first swipe: taken.
            await host.swipe('Ysolde shrugs.');
            assert.deepEqual([quest(host, 'Herb Run').offer, quest(host, 'Herb Run').taken], [true, null]);
            assert.deepEqual(host.sdk.query('quest.board').active, []);
            await host.st.swipeTo(index, 0);
            assert.deepEqual(quest(host, 'Herb Run').taken, taken.taken);

            // Later replies, then a middle exchange deleted (the "Hm." one): nothing later fails to apply.
            await host.send('On.', said('A new job, taken.', ['+ quest Wolf Cull — wolves | giver: Orsa | goal: Kill 2 wolves | reward: 4 gold', HOOK.replace('Herb Run', 'Ferry Run')]));
            await host.send('Then?', said('Quiet.', ['~ quest Wolf Cull | progress: tracking']));
            const chat = host.ctx.chat;
            const hm = chat.findIndex(message => message.is_user && message.mes === 'Hm.');
            await host.st.deleteMessage(hm + 1);
            await host.st.deleteMessage(hm);
            assert.deepEqual([quest(host, 'Herb Run').offer, Boolean(quest(host, 'Herb Run').taken)], [false, true]);
            assert.deepEqual([quest(host, 'Wolf Cull').offer, Boolean(quest(host, 'Wolf Cull').taken)], [false, true]);
            assert.equal(quest(host, 'Ferry Run').kind, 'hook', 'a job only mentioned stays a hook');
            await replayIsLive(host, modules, 'after the middle delete');

            // Abandoning still works, in the reader's words.
            await host.send('I give up on the wolf cull.', said('You head home.', ['- quest Wolf Cull — abandoned']));
            assert.equal(quest(host, 'Wolf Cull').ended.outcome, 'abandoned');
            assert.equal(host.sdk.query('quest.board').finished[0].outcomeText, 'Given up');
            await replayIsLive(host, modules, 'abandoned');
        } finally {
            host.close();
        }
    });
}

test('Story Director alone: a dating-sim quest is active at once, judged by the story and paid once within the reply budget', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ modules: [createModule()] });
    try {
        await host.send('Hi, Mira.', said('Mira smiles: would you help with the festival lanterns?', ['~ place Harrow | kind: settlement', '+ present Mira',
            '+ hook Festival Lanterns — Mira wants help | giver: Mira | reward: 10 gold']));
        assert.equal(quest(host, 'Festival Lanterns').kind, 'hook');
        assert.deepEqual(host.sdk.query('quest.board').active, []);
        await host.send('Of course.', said('Mira beams.', ['+ quest Festival Lanterns — hang the lanterns with Mira | giver: Mira | goal: hang the lanterns before dusk | reward: 10 gold']));
        const lanterns = quest(host, 'Festival Lanterns');
        assert.deepEqual([lanterns.kind, lanterns.offer, Boolean(lanterns.taken)], ['quest', false, true]);
        assert.match(host.sdk.query('quest.details', { id: lanterns.id }).terms.level, /no character level is known/);
        await host.send('Done!', said('The square glows; Mira pays you.', ['~ quest Festival Lanterns | met: yes', '- quest Festival Lanterns — turned in']));
        const paid = host.sdk.query('inventory.wallet', {}).coin ?? 0;
        assert.ok(paid > 0 && paid <= 10, `paid ${paid}`);
        assert.equal(quest(host, 'Festival Lanterns').ended.outcome, 'done');
        // Said again, it pays nothing more.
        await host.send('Thanks.', said('Mira laughs.', ['- quest Festival Lanterns — turned in']));
        assert.equal(host.sdk.query('inventory.wallet', {}).coin ?? 0, paid);
    } finally {
        host.close();
    }
});
