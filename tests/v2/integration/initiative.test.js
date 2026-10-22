// NPC initiative and the scene-filtered note on a whole Story Block host: the pick is made once before
// a reply (a system step with its own seed) and a swipe, a Re-read or a reload gives the same one; the
// static part is the same bytes every reply, with the initiative line only while its feature is on;
// it works with NPC State Delta (a stand-in answering its queries) and without it.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { FEATURE, INITIATIVE_STATIC } from '../../../src/v2/tracker/initiative.js';

const STATIC_KEY = 'story_suite_static';
const TAIL_KEY = 'story_suite_tail_1';
const sent = (host, key) => host.st.promptLog.filter(entry => entry.key === key && entry.value).map(entry => entry.value);
const reply = (text, lines = []) => (lines.length ? `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);
const picks = host => host.sdk.receipts().filter(entry => entry.receipt.type === 'director.initiative');
const initiativeIn = text => String(text ?? '').split('\n').find(line => line.startsWith('Initiative:')) ?? '';

// NPC State Delta's queries only (a stand-in): who it knows, their dossiers and trust.
function fakeNsd() {
    const dossiers = { Elula: { name: 'Elula', aliases: ['the ferrywoman', 'ferrywoman'], location: 'Harrow' }, Bram: { name: 'Bram', aliases: [], location: 'Kesh' } };
    const find = name => dossiers[Object.keys(dossiers).find(key => key.toLowerCase() === String(name ?? '').toLowerCase()) ?? ''] ?? Object.values(dossiers).find(entry => entry.aliases.includes(String(name ?? '').toLowerCase())) ?? null;
    return {
        id: 'npc-state-delta',
        name: 'NPC State Delta (test stand-in)',
        version: '0.0.0-test',
        queries: {
            'npc.known': () => Object.keys(dossiers),
            'npc.present': () => [],
            'npc.dossier': (_state, args) => find(args?.name),
            'npc.meters': (_state, args) => (find(args?.name) ? { name: find(args.name).name, meters: { trust: 40 } } : null),
        },
    };
}

async function newHost(modules = []) {
    let host = null;
    const module = createModule({ host: { settings: id => host?.sdk.settings(id) ?? null, substitute: text => host?.sdk.substitute(text) } });
    host = await createHost({ modules: [...modules, module] });
    return host;
}

const OPENING = ['~ time June 3, 1200, 08:00 am', '~ place Harrow | kind: settlement', '+ present Elula',
    '+ quest Wolf Contract — wolves at the fold | giver: Elula | goal: Kill 3 wolves | reward: 4 gold',
    '+ hook Herb Run — moonleaf for the healer | giver: Mother Ysolde',
    '+ agenda Bram — moves salt | now: Kesh'];

for (const withNsd of [false, true]) {
    test(`initiative ${withNsd ? 'with' : 'without'} NPC State Delta: one pick per reply, the same after a swipe and a Re-read`, async t => {
        t.mock.method(console, 'warn', () => {});
        const host = await newHost(withNsd ? [fakeNsd()] : []);
        try {
            // With NSD the scene may name her by an alias: her dossier gives the name she goes by.
            const opening = withNsd ? OPENING.map(entry => (entry === '+ present Elula' ? '+ present the ferrywoman' : entry)) : OPENING;
            await host.send('Hello.', reply('Harrow at dawn.', opening));
            await host.send('I look around.', reply('Elula waves.'));
            const line = initiativeIn(sent(host, TAIL_KEY).at(-1));
            assert.equal(line, 'Initiative: Elula may approach You about Wolf Contract.', '{{user}} filled in');
            const tail = sent(host, TAIL_KEY).at(-1);
            // The scene first: the quest of the person present; the hook elsewhere by name; the agenda at Kesh not at all.
            assert.match(tail, /Quests: Wolf Contract/);
            assert.match(tail, /Elsewhere, not in this scene: Herb Run \(hook\)/);
            assert.doesNotMatch(tail, /Bram/);
            const count = picks(host).length;
            assert.equal(count, 1);
            // A swipe of the same reply: no new pick, the same line.
            await host.swipe(reply('Elula waves again.'));
            assert.equal(initiativeIn(sent(host, TAIL_KEY).at(-1)), line);
            assert.equal(picks(host).length, count);
            const slot = structuredClone(host.head().domains.director.initiative);
            // A Re-read of the reply keeps the pick.
            assert.equal((await host.sdk.reread(host.ctx.chat.length - 1)).ok, true);
            assert.deepEqual(host.head().domains.director.initiative, slot);
            // The next reply: Elula cools down (never two replies running), nobody else is there.
            await host.send('And then?', reply('Quiet.'));
            assert.equal(initiativeIn(sent(host, TAIL_KEY).at(-1)), '');
            await host.send('Later.', reply('Still quiet.'));
            assert.equal(initiativeIn(sent(host, TAIL_KEY).at(-1)), line, 'after the cooldown she may again');
            // A rebuild gives the same state (the pick is in the receipts' ops).
            const live = JSON.stringify(host.head());
            host.store.rebuild();
            assert.equal(JSON.stringify(host.head()), live);
        } finally {
            host.close();
        }
    });
}

test('the static part: byte-identical reply to reply, with the initiative line only while the feature is on', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await newHost();
    try {
        await host.send('Hello.', reply('Harrow at dawn.', OPENING));
        await host.send('I look around.', reply('Elula waves.', ['+ hook Night Bell — a bell at night | now: Harrow']));
        await host.send('On.', reply('The day goes on.', ['! time +3h', '- hook Night Bell — it stopped']));
        const statics = sent(host, STATIC_KEY);
        assert.ok(statics.length >= 3);
        assert.equal(new Set(statics).size, 1, 'the same bytes every reply');
        const on = statics[0];
        const lines = on.split('\n');
        const own = lines.filter(line => line.startsWith(INITIATIVE_STATIC.split('{{user}}')[0]));
        assert.equal(own.length, 1, 'the initiative line is there once while on');
        // Off: the line goes (once, for the next reply), the tail has no Initiative line and no pick is made.
        host.features.set(FEATURE, false);
        const before = picks(host).length;
        await host.send('Again.', reply('Elula nods.'));
        await host.send('More.', reply('Elula smiles.'));
        const off = sent(host, STATIC_KEY).slice(-2);
        assert.equal(off[0], off[1]);
        assert.equal(off[0], lines.filter(line => line !== own[0]).join('\n'), 'the same bytes but for the line');
        assert.equal(initiativeIn(sent(host, TAIL_KEY).at(-1)), '');
        assert.equal(picks(host).length, before);
    } finally {
        host.close();
    }
});
