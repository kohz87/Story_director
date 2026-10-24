// RX-E-2 fixed: one story-money budget per reply, kept by Story Block (`inventory.storyBudget`). A quest
// turn-in reads it and counts against it, so a reply's `+ coin` lines and a Finish click after it give at
// most one budget in either order; a turn-in with nothing left is refused and stays ready for the next
// reply. Story Director's own `paid` tally is kept only on a Story Block without the query. Also: the
// reader's `storyCoinPerReply` holds quests, swipes and middle deletes rebuild to what was live, and all
// of it works with Story Block alone (no RPG Battle).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { fakeRpgBattle } from '../integration/helpers/fake-rpg.js';
import { replyTurn } from '../../../src/v2/tracker/domain.js';

const PACK = readFileSync(new URL('../../fixtures/ersveil-bluewatch.pack.json', import.meta.url), 'utf8');
const reply = (text, lines = []) => `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const wallet = host => host.sdk.query('inventory.wallet', { owner: 'party' }).coin ?? 0;
const status = (host, key) => host.sdk.query('director.thread', { key }).status;
const plain = value => JSON.parse(JSON.stringify(value));
const spent = host => host.sdk.query('inventory.storyBudget');

async function ersveil({ rpg = true } = {}) {
    const modules = () => (rpg ? [fakeRpgBattle(), createModule()] : [createModule()]);
    const probe = await createHost({ modules: modules() });
    assert.equal((await probe.packs.packs.install(PACK)).ok, true);
    const settings = structuredClone(probe.ctx.extensionSettings.storySuite);
    probe.close();
    return createHost({ modules: modules(), settings });
}

// A host at Bluewatch with torches and the given story-written torch quests taken on; `top` is the
// party rank's top, one reply's budget.
async function withQuests(names, options) {
    const host = await ersveil(options);
    await host.send('We arrive.', reply('Bluewatch.', ['~ place Bluewatch Village | kind: settlement', `+ item Torch | qty: ${names.length + 1}`]));
    const top = host.sdk.query('quest.ranks')[0].reward[1];
    await host.send('Any work?', reply('Fenna needs torches.', names.map(name => `+ quest ${name} — a torch | giver: Fenna | goal: bring 1 Torch to Fenna | reward: ${top} marks`)));
    for (const name of names) {
        if (!host.sdk.query('director.thread', { key: name }).taken) assert.equal((await host.sdk.command('quest.take', { key: name })).ok, true);
    }
    return { host, top };
}

for (const rpg of [true, false]) {
    const label = rpg ? '' : ' (Story Block alone, no RPG Battle)';

    test(`a + coin line spends the reply's budget: a Finish click after it is refused and stays ready${label}`, async () => {
        const { host, top } = await withQuests(['Torch Run'], { rpg });
        try {
            await host.send('Fenna pays a debt.', reply('Coins.', [`+ coin ${top} | from: Fenna`]));
            assert.deepEqual(spent(host), { budget: top, paid: top, left: 0, vouched: 0 });
            const before = wallet(host);
            const click = await host.sdk.command('quest.finish', { key: 'Torch Run' });
            assert.equal(click.ok, false);
            assert.match(click.message, new RegExp(`One reply pays at most ${top} marks in money the story wrote, quest rewards included \\(${top} marks so far\\); it is ready for the next reply\\.`));
            assert.equal(status(host, 'Torch Run'), 'active');
            assert.equal(host.sdk.query('quest.progress', { key: 'Torch Run' }).finish.budget, true);
            assert.equal(wallet(host), before);
            await host.send('Next day.', reply('Morning.', []));
            assert.equal((await host.sdk.command('quest.finish', { key: 'Torch Run' })).ok, true);
            assert.equal(wallet(host) - before, top, 'the next reply pays it whole');
        } finally { host.close(); }
    });

    test(`a Finish click first, then a Continue writing + coin: one budget in all${label}`, async () => {
        const { host, top } = await withQuests(['Torch Run'], { rpg });
        try {
            await host.send('Fenna waits.', reply('An hour.', []));
            const before = wallet(host);
            assert.equal((await host.sdk.command('quest.finish', { key: 'Torch Run' })).ok, true);
            assert.equal(wallet(host) - before, top);
            await host.cont(reply(' Fenna also pays a debt.', [`+ coin ${top} | from: Fenna`]));
            assert.equal(wallet(host) - before, top);
            assert.equal(replyTurn(host.head().domains.director).paid, 0, 'Story Block keeps the tally; Story Director keeps none of its own');
        } finally { host.close(); }
    });

    test(`story coin alone, a quest alone, and quests across two replies pay as before${label}`, async () => {
        const { host, top } = await withQuests(['Torch Run A', 'Torch Run B'], { rpg });
        try {
            const start = wallet(host);
            await host.send('Fenna pays a debt.', reply('Coins.', [`+ coin ${top} | from: Fenna`]));
            assert.equal(wallet(host) - start, top, 'story coin alone: the whole budget');
            await host.send('Torches.', reply('Here.', []));
            assert.equal((await host.sdk.command('quest.finish', { key: 'Torch Run A' })).ok, true);
            assert.equal(wallet(host) - start, 2 * top, 'a quest alone: its whole reward');
            assert.equal((await host.sdk.command('quest.finish', { key: 'Torch Run B' })).ok, false, 'not two in one reply');
            await host.send('The other.', reply('Here.', []));
            assert.equal((await host.sdk.command('quest.finish', { key: 'Torch Run B' })).ok, true);
            assert.equal(wallet(host) - start, 3 * top, 'the second quest in the next reply');
        } finally { host.close(); }
    });
}

test('the reader\'s storyCoinPerReply holds quest turn-ins; coin lines first leave the first turn-in what is left', async () => {
    const { host, top } = await withQuests(['Torch Run A', 'Torch Run B']);
    try {
        const budget = Math.floor(top / 2);
        host.settings.set('story-block', 'storyCoinPerReply', budget);
        await host.send('Torches.', reply('Here.', ['+ coin 1 | from: Fenna']));
        assert.deepEqual(spent(host), { budget, paid: 1, left: budget - 1, vouched: 0 });
        const before = wallet(host);
        const first = await host.sdk.command('quest.finish', { key: 'Torch Run A' });
        assert.equal(first.ok, true, 'the reply\'s first turn-in is paid what its coin lines left');
        assert.deepEqual(first.receipt.data.paid, { amount: budget - 1, owed: top });
        assert.deepEqual(spent(host), { budget, paid: budget, left: 0, vouched: budget - 1 });
        const second = await host.sdk.command('quest.finish', { key: 'Torch Run B' });
        assert.equal(second.ok, false, 'nothing left: the second waits');
        assert.match(second.message, new RegExp(`at most ${budget} marks`));
        assert.equal(status(host, 'Torch Run B'), 'active');
        await host.send('Next.', reply('Here.', []));
        const done = await host.sdk.command('quest.finish', { key: 'Torch Run B' });
        assert.equal(done.ok, true);
        assert.deepEqual(done.receipt.data.paid, { amount: budget, owed: top }, 'held to the reader\'s budget');
        assert.equal(wallet(host) - before, 2 * budget - 1);
    } finally { host.close(); }
});

test('a second turn-in that does not fit what the first left waits, though something is left', async () => {
    const { host, top } = await withQuests(['Torch Run A', 'Torch Run B']);
    try {
        await host.send('Torches.', reply('Here.', []));
        host.settings.set('story-block', 'storyCoinPerReply', top + 1);
        assert.equal((await host.sdk.command('quest.finish', { key: 'Torch Run A' })).ok, true);
        assert.deepEqual(spent(host), { budget: top + 1, paid: top, left: 1, vouched: top });
        const second = await host.sdk.command('quest.finish', { key: 'Torch Run B' });
        assert.equal(second.ok, false);
        assert.equal(status(host, 'Torch Run B'), 'active');
    } finally { host.close(); }
});

test('a swipe takes a Finish click\'s spend back with its reply; a rebuild equals live', async () => {
    const { host, top } = await withQuests(['Torch Run']);
    try {
        await host.send('Fenna waits.', reply('An hour.', []));
        const before = wallet(host);
        assert.equal((await host.sdk.command('quest.finish', { key: 'Torch Run' })).ok, true);
        await host.swipe(reply('Another hour.', [`+ coin ${top} | from: Fenna`]));
        assert.equal(status(host, 'Torch Run'), 'active', 'the click went with the old swipe');
        assert.equal(wallet(host) - before, top, 'the new swipe\'s coin line has the whole budget');
        assert.equal((await host.sdk.command('quest.finish', { key: 'Torch Run' })).ok, false, 'and the click now finds it spent');
        const live = plain(host.head());
        host.store.rebuild();
        assert.deepEqual(plain(host.head()), live);
    } finally { host.close(); }
});

test('deleting a middle reply keeps a later reply\'s spend; a rebuild equals live', async () => {
    const { host, top } = await withQuests(['Torch Run A', 'Torch Run B']);
    try {
        await host.send('A.', reply('Coins.', [`+ coin ${top - 1} | from: Fenna`]));
        const a = host.store.headIndex();
        await host.send('B.', reply('Torches.', []));
        assert.equal((await host.sdk.command('quest.finish', { key: 'Torch Run A' })).ok, true);
        const coin = wallet(host);
        await host.st.deleteMessage(a);
        await host.st.deleteMessage(a - 1);
        assert.deepEqual(host.store.problems(), []);
        assert.equal(wallet(host), coin - (top - 1));
        assert.equal(status(host, 'Torch Run A'), 'resolved');
        assert.deepEqual(spent(host), { budget: top, paid: top, left: 0, vouched: top });
        assert.equal((await host.sdk.command('quest.finish', { key: 'Torch Run B' })).ok, false, 'B still spent its budget');
        const live = plain(host.head());
        host.store.rebuild();
        assert.deepEqual(plain(host.head()), live);
    } finally { host.close(); }
});
