// r3 B-b3-r3-1: the per-reply budget on quests the story alone vouches for (r2-5) held only when the
// story closed them. With `~ quest X | met: yes` (F83: the quest shows Ready) and the reader's Finish
// (quest.finish from a click), an errand written `rank: S` was paid one rank above the party's (E's top,
// 230, for a level-1 party) and Story Block's per-reply budget never saw it. Now a quest turned in on the
// story's word alone is held to the party's own rank (ranks.js STORY_RANKS_ABOVE): six errands one
// reply called met pay the party rank's top, once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { fakeRpgBattle } from '../integration/helpers/fake-rpg.js';

const PACK = readFileSync(new URL('../../fixtures/ersveil-bluewatch.pack.json', import.meta.url), 'utf8');
const reply = (text, lines = []) => `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const wallet = host => host.sdk.query('inventory.wallet', { owner: 'party' }).coin ?? 0;

test('errands one reply calls met, finished by clicks, pay the party rank\'s top once, not the written rank\'s', async () => {
    const probe = await createHost({ modules: [fakeRpgBattle(), createModule()] });
    assert.equal((await probe.packs.packs.install(PACK)).ok, true);
    const settings = structuredClone(probe.ctx.extensionSettings.storySuite);
    probe.close();
    const host = await createHost({ modules: [fakeRpgBattle(), createModule()], settings });
    try {
        await host.send('We arrive.', reply('Bluewatch.', ['~ place Bluewatch Village | kind: settlement']));
        const top = host.sdk.query('quest.ranks')[0].reward[1];
        const names = Array.from({ length: 6 }, (_, i) => `Errand ${String.fromCharCode(65 + i)}`);
        await host.send(`I take ${names.join(', ')}.`, reply('Fenna has errands.', names.map(name => `+ quest ${name} — an errand | giver: Fenna | goal: carry the parcel to the mill | rank: S | reward: 99999 marks`)));
        for (const name of names) {
            if (!host.sdk.query('director.thread', { key: name }).taken) assert.equal((await host.sdk.command('quest.take', { key: name })).ok, true);
        }
        const before = wallet(host);
        await host.send('All delivered.', reply('The parcels are delivered.', names.map(name => `~ quest ${name} | met: yes`)));
        for (const name of names) await host.sdk.command('quest.finish', { key: name });
        const paid = wallet(host) - before;
        assert.equal(paid, top, `six errands vouched for by one reply paid ${paid} once finished by clicks (one reply may give ${top})`);
    } finally { host.close(); }
});
