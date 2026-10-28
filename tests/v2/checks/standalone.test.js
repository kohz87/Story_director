// Standalone checks on the real host with nothing but Story Block and Story Director: a fresh chat rolls the story's check and
// Assist's pre-roll for the player before any character is set; a chat saved by Story Director 2.1.1 (its policy still carries
// the retired `rbActors`) keeps its actor and history, takes new edits and checks, and every rebuild, reload, swipe, delete and
// Re-read gives the live state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFakeModel, createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';

const OLD = JSON.parse(readFileSync(new URL('../../fixtures/checks-2.1.1-chat.json', import.meta.url), 'utf8'));
const CHECK = '? check Stealth — sneak past the guard | dc: hard';
const ok = out => assert.equal(out.ok, true, JSON.stringify(out));
const log = host => Object.values(host.head().domains.checks.log);

/** The head after a full rebuild and in a host that loads the saved chat are the live head. */
async function sameEverywhere(host, t) {
    const live = structuredClone(host.head());
    host.store.rebuild();
    assert.deepEqual(host.head(), live, 'a rebuild gives the live state');
    const loaded = await createHost({ modules: [createModule()], st: { chat: structuredClone(host.ctx.chat), extensionSettings: structuredClone(host.ctx.extensionSettings) } });
    t.after(() => loaded.close());
    assert.deepEqual(loaded.head().domains, live.domains, 'a reload gives the live state');
    assert.deepEqual(loaded.head().meta.claims, live.meta.claims);
    assert.deepEqual(host.store.problems(), []);
}

test('a fresh chat: the story\'s check and Assist\'s pre-roll roll for the player with no character set', async t => {
    const model = createFakeModel([], { fallback: CHECK });
    const host = await createHost({ modules: [createModule()], callModel: model, settings: { modules: { 'story-block': { assistClassifier: true } } } });
    t.after(() => host.close());
    await host.send('I sneak past the guard.', `You slip by.\n<Changes>\n${CHECK}\n</Changes>`);
    assert.equal(model.calls.length, 1, 'the pre-roll asked the classifier');
    assert.deepEqual(host.turn.problems(), []);
    const receipts = host.ctx.chat.flatMap(message => message.extra?.storySuite?.receipts ?? []);
    assert.match(receipts.find(receipt => receipt.type === 'assist.precheck').summary, /^You try Stealth: d20 \d+ \+0 = \d+ against 20/);
    assert.match(receipts.find(receipt => receipt.type === 'capture.check').summary, /^You try Stealth/);
    assert.deepEqual(log(host).map(check => [check.actor, check.mod]), [[null, 0], [null, 0]]);
    assert.deepEqual(host.sdk.query('checks.policy', {}).actors, {});
    await sameEverywhere(host, t);

    // The reader sets a character afterwards; the next check uses it.
    const policy = host.sdk.query('checks.policy', {});
    ok(await host.sdk.command('checks.actor', { write: 'wr_00000001', name: 'Mara', bonuses: { DEX: 2 }, expectedHash: policy.hash }));
    await host.send('Again, past the second guard.', `You slip by again.\n<Changes>\n? check Stealth — sneak past the second guard | dc: hard\n</Changes>`);
    assert.deepEqual(log(host).at(-1).mod, 2);
    await host.swipe(`This time he turns.\n<Changes>\n? check Stealth — duck behind the cart | dc: normal\n</Changes>`);
    assert.equal(log(host).at(-1).dc, 15);
    await sameEverywhere(host, t);
});

test('a standalone checks chat saved by 2.1.1: the actor and history stay, edits and checks work, and replay gives the live state', async t => {
    const host = await createHost({ modules: [createModule()], st: { chat: structuredClone(OLD.chat) } });
    t.after(() => host.close());
    const policy = host.sdk.query('checks.policy', {});
    const [mara] = Object.values(policy.actors);
    assert.deepEqual([mara.name, mara.bonuses, policy.defaultActor], ['Mara', { DEX: 2 }, mara.id]);
    assert.equal(log(host).length, 1, 'the check it rolled is kept');
    assert.deepEqual(host.store.problems(), []);

    // An edit after the upgrade: accepted, the actor id kept, the retired field gone with this first write.
    ok(await host.sdk.command('checks.actor', { write: 'wr_00000002', id: mara.id, name: 'Mara', bonuses: { DEX: 3 }, expectedHash: policy.hash }));
    assert.equal(Object.hasOwn(host.head().domains.checks.policy, 'rbActors'), false);
    assert.deepEqual(host.sdk.query('checks.policy', {}).actors[mara.id].bonuses, { DEX: 3 });
    await host.send('I sneak past the second guard.', `You slip by.\n<Changes>\n? check Stealth — sneak past the second guard | dc: hard\n</Changes>`);
    assert.deepEqual(host.turn.problems(), []);
    assert.deepEqual([log(host).length, log(host).at(-1).actor, log(host).at(-1).mod], [2, mara.id, 3]);
    await sameEverywhere(host, t);

    // Re-read the new reply with another check; swipe it; delete the old reply in the middle.
    const at = host.ctx.chat.length - 1;
    await host.st.editMessage(at, `You slip by.\n<Changes>\n? check Stealth — climb the wall instead | dc: normal\n</Changes>`);
    ok(await host.turn.reread(at));
    assert.equal(log(host).at(-1).dc, 15);
    await sameEverywhere(host, t);
    await host.swipe(`He sees you.\n<Changes>\n? check Stealth — hide in the hay | dc: easy\n</Changes>`);
    assert.equal(log(host).at(-1).dc, 10);
    await sameEverywhere(host, t);
    await host.st.deleteMessage(2);
    assert.equal(host.sdk.query('checks.policy', {}).actors[mara.id].name, 'Mara', 'the actor outlives the old reply');
    await sameEverywhere(host, t);
});
