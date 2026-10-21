// B4-11: a kill quest's per-unit reward is paid for every foe beaten since it was taken on, not
// for the target: "Kill 1 wolf | reward: 50 gold each" pays 600 gold after four fights of three
// wolves. RPG Battle lets one encounter line hold up to 54 foes (6 rows × 9), so the size of the
// fights the story writes, not the quest, sets the coin (invariant 3; F87 holds a reward inside
// its rank's range, and does hold this total with `rank: F`, but a quest written without a rank, or with
// `difficulty: easy`, is paid as written).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { fakeRpgBattle } from '../integration/helpers/fake-rpg.js';

const reply = (text, lines = []) => (lines.length ? `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);

for (const extra of ['', ' | difficulty: easy']) test(`B4-11: a per-unit kill reward pays for the target, not for every kill after it (quest line${extra || ' without rank'})`, async () => {
    const host = await createHost({ modules: [fakeRpgBattle(), createModule()] });
    try {
        await host.send('Any work?', reply('Fenna: a wolf took a lamb.', [
            '~ place Bluewatch | kind: settlement', '+ present Fenna',
            '+ quest Lone Wolf — one wolf took a lamb | giver: Fenna | goal: Kill 1 wolf | reward: 50 gold each' + extra,
        ]));
        assert.equal((await host.sdk.command('quest.take', { key: 'Lone Wolf' })).ok, true);
        for (let n = 0; n < 4; n += 1) assert.equal((await host.sdk.command('combat.win', { foes: [{ name: 'Wolf', count: 3 }] })).ok, true);
        const done = await host.sdk.command('quest.finish', { key: 'Lone Wolf' });
        assert.equal(done.ok, true, done.message);
        const paid = host.sdk.query('inventory.wallet', { owner: 'party' }).coin ?? 0;
        assert.ok(paid <= 50, `a 1-wolf quest at 50 each paid ${paid}: ${done.receipt.summary}`);
    } finally {
        host.close();
    }
});
