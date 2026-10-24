// r2 B-b3-r2-5/6/7: quests the story closes pay rank-held rewards with no bound per reply, a written
// rank raises a tiny reward to its floor, and `difficulty: nightmare` reaches two ranks above the
// party's (past the one rank a written `rank:` may go). Numbers are read from `quest.ranks`, so the
// test holds for the pack's ladder and the built-in one alike.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { fakeRpgBattle } from '../integration/helpers/fake-rpg.js';

const PACK = readFileSync(new URL('../../fixtures/ersveil-bluewatch.pack.json', import.meta.url), 'utf8');
const reply = (text, lines = []) => `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const wallet = host => host.sdk.query('inventory.wallet', { owner: 'party' }).coin ?? 0;
const ladder = host => host.sdk.query('quest.ranks');

async function ersveilHost() {
    const probe = await createHost({ modules: [fakeRpgBattle(), createModule()] });
    assert.equal((await probe.packs.packs.install(PACK)).ok, true);
    const settings = structuredClone(probe.ctx.extensionSettings.storySuite);
    probe.close();
    const host = await createHost({ modules: [fakeRpgBattle(), createModule()], settings });
    await host.send('We arrive.', reply('Bluewatch.', ['~ place Bluewatch Village | kind: settlement']));
    return host;
}

// Offers made, taken (the Take on command is kept for templates), then closed by the story in one reply.
async function closedInOneReply(host, labels, n = 1) {
    const names = Array.from({ length: n }, (_, i) => `Errand ${String.fromCharCode(65 + i)}`);
    await host.send(`I take ${names.join(', ')}.`, reply('Fenna has errands.', names.map(name => `+ quest ${name} — an errand | giver: Fenna | goal: carry the parcel to the mill ${labels}`)));
    for (const name of names) {
        const thread = host.sdk.query('director.thread', { key: name });
        if (!thread.taken) assert.equal((await host.sdk.command('quest.take', { key: name })).ok, true);
    }
    const before = wallet(host);
    await host.send('All done.', reply('The parcels are delivered.', names.flatMap(name => [`~ quest ${name} | met: yes`, `- quest ${name} — done`])));
    return wallet(host) - before;
}

test('quests the story closes in one reply pay no more than one reply may give (the party rank\'s top)', async () => {
    const host = await ersveilHost();
    try {
        const top = ladder(host)[0].reward[1];
        const paid = await closedInOneReply(host, `| reward: ${top} marks`, 6);
        assert.ok(paid <= top, `one reply closing 6 errands the story alone vouched for paid ${paid} (one reply may give ${top})`);
    } finally { host.close(); }
});

test('a written rank does not raise a smaller reward to its floor', async () => {
    const host = await ersveilHost();
    try {
        const rank = ladder(host)[1];
        const paid = await closedInOneReply(host, `| rank: ${rank.id} | reward: 1 mark`);
        assert.ok(paid <= 1, `"reward: 1 mark" with "rank: ${rank.id}" paid ${paid}`);
    } finally { host.close(); }
});

test('difficulty: nightmare reaches no further than a written rank may (party rank + 1)', async () => {
    const host = await ersveilHost();
    try {
        const next = ladder(host)[1];
        const paid = await closedInOneReply(host, '| difficulty: nightmare | reward: 99999 marks');
        assert.ok(paid <= next.reward[1], `a nightmare errand at level 1 paid ${paid}; a written rank may reach ${next.id} (top ${next.reward[1]})`);
    } finally { host.close(); }
});
