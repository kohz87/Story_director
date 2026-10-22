// rx-economy RX-E-2 (after #91): one reply's story money is held twice over. Story Block's per-reply
// coin budget (the party rank's top) holds the reply's own `+ coin` lines and the quests it closes
// itself; Story Director's `director.turn.now.paid` holds Finish clicks after the reply. Neither sees
// the other, so a reply that writes `+ coin <top>` and leaves a story-written quest met for a click
// gives the party twice the party rank's top (800 marks at level 1 with Ersveil; 2 × 50 here).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { fakeRpgBattle } from '../integration/helpers/fake-rpg.js';

const PACK = readFileSync(new URL('../../fixtures/ersveil-bluewatch.pack.json', import.meta.url), 'utf8');
const reply = (text, lines = []) => `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const wallet = host => host.sdk.query('inventory.wallet', { owner: 'party' }).coin ?? 0;

async function hostWithPack() {
    const probe = await createHost({ modules: [fakeRpgBattle(), createModule()] });
    assert.equal((await probe.packs.packs.install(PACK)).ok, true);
    const settings = structuredClone(probe.ctx.extensionSettings.storySuite);
    probe.close();
    return createHost({ modules: [fakeRpgBattle(), createModule()], settings });
}

for (const order of ['coin line, then the click', 'the click, then a coin line']) {
    test(`one reply's + coin and a Finish click after it share one budget (${order})`, async () => {
        const host = await hostWithPack();
        try {
            await host.send('We arrive.', reply('Bluewatch.', ['~ place Bluewatch Village | kind: settlement', '+ item Torch | qty: 2']));
            const top = host.sdk.query('quest.ranks')[0].reward[1];
            await host.send('Any work?', reply('Fenna needs a torch.', [`+ quest Torch Run — a torch | giver: Fenna | goal: bring 1 Torch to Fenna | reward: ${top} marks`]));
            if (!host.sdk.query('director.thread', { key: 'Torch Run' }).taken) assert.equal((await host.sdk.command('quest.take', { key: 'Torch Run' })).ok, true);
            const before = wallet(host);
            if (order.startsWith('coin')) {
                await host.send('Fenna pays a debt.', reply('Coins.', [`+ coin ${top} | from: Fenna`, '! time +1h']));
                await host.sdk.command('quest.finish', { key: 'Torch Run' });
            } else {
                await host.send('Fenna waits.', reply('An hour.', ['! time +1h']));
                await host.sdk.command('quest.finish', { key: 'Torch Run' });
                // The click is attached to the head reply; a swipe-free next reply's coin is a new reply's.
                // Same reply: a continue adds the coin line to the reply the click was made on.
                await host.cont(reply(' Fenna also pays a debt.', [`+ coin ${top} | from: Fenna`]));
            }
            const gained = wallet(host) - before;
            assert.ok(gained <= top, `one reply gave ${gained} in story money (+ coin ${top} and a ${top} quest by click); one reply may give ${top}`);
        } finally { host.close(); }
    });
}
