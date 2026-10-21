// B-b3-18 / B-b3-19: a quest pays what the model wrote. The `reward:` label is paid as written
// (5,000,000 marks for two cellar rats; Ersveil's own "Granary Rats" pays 50 and rank F tops out
// at 400 — F87's clamp to the rank range is not in quest.finish), and an `xp:` label becomes
// party.grantXp's amount as written (250,000 XP: a level-1 character to the level cap in one quest).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { fakeRpgBattle } from '../integration/helpers/fake-rpg.js';

const PACK = readFileSync(new URL('../../fixtures/ersveil-bluewatch.pack.json', import.meta.url), 'utf8');
const reply = (text, lines = []) => `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const wallet = host => host.sdk.query('inventory.wallet', { owner: 'party' }).coin ?? 0;

async function ersveilHost() {
    const probe = await createHost({ modules: [fakeRpgBattle(), createModule()] });
    assert.equal((await probe.packs.packs.install(PACK)).ok, true);
    const settings = structuredClone(probe.ctx.extensionSettings.storySuite);
    probe.close();
    return createHost({ modules: [fakeRpgBattle(), createModule()], settings });
}

async function turnedIn(line) {
    const host = await ersveilHost();
    await host.send('I take the rat job.', reply('Fenna pins the notice.', ['~ place Bluewatch Village | kind: settlement', line]));
    const quest = host.sdk.query('director.thread', { key: 'Granary Rats' });
    if (!quest.taken) assert.equal((await host.sdk.command('quest.take', { key: 'Granary Rats' })).ok, true);
    assert.equal((await host.sdk.command('combat.win', { foes: [{ name: 'Cellar Rat', count: 2 }] })).ok, true);
    const before = wallet(host);
    const done = await host.sdk.command('quest.finish', { key: 'Granary Rats' });
    assert.equal(done.ok, true, done.message);
    return { host, paid: wallet(host) - before };
}

test('a quest reward the model wrote is held inside the rank range (Ersveil rank F: 50–400 marks)', async () => {
    const { host, paid } = await turnedIn('+ quest Granary Rats — the cellar | giver: Fenna | goal: Kill 2 cellar rats | reward: 5000000 marks');
    try {
        assert.ok(paid <= 400, `quest.finish paid ${paid} marks for two cellar rats`);
    } finally { host.close(); }
});

test('a quest\'s xp: label does not set the XP: quests pay XP by difficulty', async () => {
    const { host } = await turnedIn('+ quest Granary Rats — the cellar | giver: Fenna | goal: Kill 2 cellar rats | reward: 50 marks | xp: 250000');
    try {
        const log = host.head().domains.party.xpLog;
        assert.equal(log.length, 1);
        assert.ok(log[0].amount <= 100, `party.grantXp was asked for ${log[0].amount} XP from the quest's xp: label`);
    } finally { host.close(); }
});
