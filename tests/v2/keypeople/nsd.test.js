// Key people, item 3 (removal): with NPC State Delta, a pinned person it has archived or lost (a death) leaves the list before the
// next reply, with the reason on record; read only (nothing is ever written to it); without it, the story's `- key Name | died` and
// the reader's Unpin are the ways. Two ways to ask it: its Story Suite api (`npcs()` and `npcProfiles()`) and its queries.
import test from 'node:test';
import assert from 'node:assert/strict';

import { nsdVerdicts } from '../../../src/v2/keypeople/nsd.js';
import { OPENING, keyHost, pin, said, slice, validatorErrors } from './helpers.js';

const pinned = names => ({ pins: Object.fromEntries(names.map(name => [name.toLowerCase(), { name, since: null, rev: 1 }])), away: {}, gone: {}, notes: {} });

// Delta's Story Suite api: `npcs()` every tracked dossier (archived ones too), `npcProfiles()` those neither archived nor dead.
function fakeApi({ npcs = [], profiles = null } = {}) {
    return {
        npcs: () => npcs.map(npc => ({ ...npc })),
        npcProfiles: () => (profiles ?? npcs.filter(npc => !npc.archived && !npc.dead)).map(npc => ({ id: npc.id, name: npc.name, aliases: npc.aliases ?? [], present: false, role: '', summary: '' })),
    };
}
const withSuite = (api, fn) => async (...args) => {
    const was = globalThis.StorySuite;
    globalThis.StorySuite = { api: id => (id === 'npc-state-delta' ? api : null) };
    try {
        return await fn(...args);
    } finally {
        if (was === undefined) delete globalThis.StorySuite; else globalThis.StorySuite = was;
    }
};

test('the verdicts by Delta\'s Story Suite api: archived there is "archived", tracked but missing from the profiles is "died", the rest stay', () => {
    const api = fakeApi({ npcs: [
        { id: 'np_1', name: 'Mara', aliases: ['the miller'], archived: true },
        { id: 'np_2', name: 'Brom', dead: true },
        { id: 'np_3', name: 'Ren', aliases: ['the scout'] },
    ] });
    const slice_ = pinned(['Mara', 'Brom', 'Ren', 'Odda']);
    assert.deepEqual(nsdVerdicts(slice_, { api }), {
        released: [{ name: 'Mara', reason: 'archived' }, { name: 'Brom', reason: 'died' }],
        known: [{ name: 'Ren' }],
    });
    // By an alias; a person Delta has never tracked ("Odda") is left alone.
    assert.deepEqual(nsdVerdicts({ pins: { scout: { name: 'The Scout', since: null, rev: 1, aliases: ['Ren'] } }, away: {}, gone: {}, notes: {} }, { api }).known, [{ name: 'The Scout' }]);
    // Delta's dossiers not loaded yet, or Delta off: nothing is said, so nobody is released.
    assert.deepEqual(nsdVerdicts(slice_, { api: fakeApi({ npcs: [] }) }), { released: [], known: [] });
    // Already noted as known: not told again.
    assert.deepEqual(nsdVerdicts({ pins: { ren: { name: 'Ren', since: null, rev: 1, nsd: true } }, away: {}, gone: {}, notes: {} }, { api }).known, []);
    assert.deepEqual(nsdVerdicts(pinned([]), { api }), { released: [], known: [] });
    // A broken api says nothing.
    assert.deepEqual(nsdVerdicts(slice_, { api: { npcs: () => { throw new Error('x'); }, npcProfiles: () => [] } }), { released: [], known: [] });
});

test('the verdicts by Delta\'s queries: a pinned person it knew and no longer lists is "archived", a dossier that says deceased is "died"', () => {
    const lists = { known: ['Ren', 'Brom'], dossiers: { Ren: { name: 'Ren', lifeState: 'alive' }, Brom: { name: 'Brom', lifeState: 'deceased' } } };
    const query = (name, args) => {
        if (name === 'npc.known') return lists.known;
        if (name === 'npc.dossier') return lists.dossiers[args.name] ?? null;
        throw new Error('no such query');
    };
    const make = (name, more = {}) => ({ name, since: null, rev: 1, ...more });
    const state = { pins: { ren: make('Ren'), brom: make('Brom'), mara: make('Mara', { nsd: true }), odda: make('Odda') }, away: {}, gone: {}, notes: {} };
    assert.deepEqual(nsdVerdicts(state, { query }), {
        released: [{ name: 'Brom', reason: 'died' }, { name: 'Mara', reason: 'archived' }],
        known: [{ name: 'Ren' }],
    });
    // "Odda" was never known to Delta: never released. An empty answer (not loaded): nobody is.
    lists.known = [];
    assert.deepEqual(nsdVerdicts(state, { query, loaded: () => false }), { released: [], known: [] });
    assert.deepEqual(nsdVerdicts(state, { query: () => { throw new Error('no Delta'); } }), { released: [], known: [] });
    assert.deepEqual(nsdVerdicts(state, {}), { released: [], known: [] });
});

test('on the host, by queries: Delta notes who it knows, then archives and loses people; they leave the list with the reason, once, in one step before the reply', async t => {
    t.mock.method(console, 'warn', () => {});
    const people = { Ren: { aliases: ['the scout'] }, Mara: {}, Brom: {}, Odda: {} };
    const host = await keyHost({ delta: people });
    try {
        await host.send('Hello.', said('Dawn.', OPENING));
        for (const name of ['Ren', 'Mara', 'Brom', 'Odda', 'Stranger']) assert.equal((await pin(host, name)).ok, true, name);
        await host.send('Go.', said('Mara leaves.', ['+ away Mara — at the quarry | back: June 9, 1200', '+ away Ren — scouting | back: June 9, 1200']));
        // The next reply: Delta's people are noted as known (one step), the stranger never is.
        await host.send('Next.', 'Quiet.');
        assert.deepEqual(Object.entries(slice(host).pins).filter(([, entry]) => entry.nsd).map(([key]) => key), ['ren', 'mara', 'brom', 'odda']);
        const syncs = () => host.sdk.receipts().filter(entry => entry.receipt.type === 'keypeople.sync');
        assert.equal(syncs().length, 1);
        await host.send('Next.', 'Quiet.');
        assert.equal(syncs().length, 1, 'nothing new to say: no step');
        // Mara is archived in Delta (it no longer lists her), Brom is dead there.
        delete people.Mara;
        people.Brom.lifeState = 'deceased';
        await host.send('Next.', 'Quiet.');
        assert.equal(syncs().length, 2);
        assert.deepEqual(Object.keys(slice(host).pins).sort(), ['odda', 'ren', 'stranger']);
        assert.equal(slice(host).gone.mara.reason, 'archived');
        assert.equal(slice(host).gone.brom.reason, 'died');
        assert.equal(slice(host).away.mara, undefined, 'her away record goes with the pin');
        assert.match(syncs().at(-1).receipt.summary, /Mara is no longer a key person \(archived in NPC State Delta\)\. Brom is no longer a key person \(died/);
        assert.deepEqual(Object.values(slice(host).notes).slice(-2).map(note => note.head).sort(), ['Brom is no longer a key person', 'Mara is no longer a key person']);
        // Nothing is written to Delta, and nobody away is touched.
        assert.deepEqual(host.sdk.receipts().filter(entry => entry.receipt.module === 'npc-state-delta'), []);
        assert.equal(slice(host).away.ren.doing, 'scouting');
        // A swipe of the reply goes through the same step: no duplicate, the same state.
        const before = JSON.stringify(slice(host));
        await host.swipe('Quiet, another take.');
        assert.equal(JSON.stringify(slice(host).pins), JSON.stringify(JSON.parse(before).pins));
        assert.equal(syncs().length, 2);
        // A rebuild and a delete of the reply that held the step: the next reply says it again, and the state is valid throughout.
        const live = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live);
        assert.deepEqual(validatorErrors(host), []);
        assert.deepEqual(host.store.problems(), []);
    } finally {
        host.close();
    }
});

test('on the host, by the Story Suite api: archived or dead there leaves the list; Delta not loaded yet releases nobody', withSuite(null, async t => {
    t.mock.method(console, 'warn', () => {});
    const npcs = [{ id: 'np_1', name: 'Mara', archived: false }, { id: 'np_2', name: 'Brom' }, { id: 'np_3', name: 'Ren' }];
    const api = fakeApi({ npcs: [] });
    globalThis.StorySuite = { api: () => api };
    const host = await keyHost();
    try {
        await host.send('Hello.', said('Dawn.', OPENING));
        for (const name of ['Mara', 'Brom', 'Ren']) await pin(host, name);
        await host.send('Next.', 'Quiet.');
        assert.deepEqual(Object.keys(slice(host).pins), ['mara', 'brom', 'ren'], 'Delta says nothing yet: nobody is released');
        // Loaded: Mara is archived, Brom is tracked but not in the profiles (dead), Ren is fine.
        api.npcs = () => [{ ...npcs[0], archived: true }, npcs[1], npcs[2]];
        api.npcProfiles = () => [{ id: 'np_3', name: 'Ren', aliases: [] }];
        await host.send('Next.', 'Quiet.');
        assert.deepEqual(Object.keys(slice(host).pins), ['ren']);
        assert.deepEqual([slice(host).gone.mara.reason, slice(host).gone.brom.reason], ['archived', 'died']);
        assert.equal(slice(host).pins.ren.nsd, true, 'known to Delta now');
        assert.deepEqual(validatorErrors(host), []);
        const live = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live);
    } finally {
        host.close();
    }
}));

test('without NPC State Delta nothing is asked and nothing changes; the story\'s death line and Unpin are the ways', async () => {
    const was = globalThis.StorySuite;
    delete globalThis.StorySuite;
    const host = await keyHost();
    try {
        await host.send('Hello.', said('Dawn.', OPENING));
        await pin(host, 'Mara');
        await host.send('Next.', 'Quiet.');
        await host.send('Next.', 'Quiet.');
        assert.deepEqual(Object.keys(slice(host).pins), ['mara']);
        assert.deepEqual(host.sdk.receipts().filter(entry => entry.receipt.type === 'keypeople.sync'), []);
        await host.send('Oh.', said('She falls.', ['- key Mara | died']));
        assert.deepEqual(Object.keys(slice(host).pins), []);
    } finally {
        host.close();
        if (was !== undefined) globalThis.StorySuite = was;
    }
});

test('the sync step is the system\'s: a click or the story cannot send it, and a bad payload is refused', async () => {
    const host = await keyHost();
    try {
        await host.send('Hello.', said('Dawn.', OPENING));
        await pin(host, 'Mara');
        const click = await host.sdk.command('keypeople.sync', { who: [{ name: 'Mara', reason: 'died' }] });
        assert.equal(click.ok, false);
        assert.equal(click.code, 'REFUSED');
        assert.deepEqual(Object.keys(slice(host).pins), ['mara']);
        for (const payload of [{ who: [{ name: 'Mara', reason: 'unpinned' }] }, { who: 'Mara' }, { extra: 1 }, { known: [1] }]) {
            let out;
            try { out = await host.bus.run('keypeople.sync', payload, { cause: 'system', state: host.head() }); } catch (error) { out = { ok: false, code: error?.code }; }
            assert.notEqual(out?.ok, true, JSON.stringify(payload));
        }
        assert.deepEqual(Object.keys(slice(host).pins), ['mara']);
    } finally {
        host.close();
    }
});

// Delta's page api says whether its dossiers are loaded (`NPCStateDelta.uiStatus().hydrationStatus`, `isEnabled()`).
const withPageApi = (status, fn) => async (...args) => {
    const was = globalThis.NPCStateDelta;
    globalThis.NPCStateDelta = { isEnabled: () => status.enabled !== false, uiStatus: () => ({ hydrationStatus: status.hydration }) };
    try {
        return await fn(...args);
    } finally {
        if (was === undefined) delete globalThis.NPCStateDelta; else globalThis.NPCStateDelta = was;
    }
};
const syncs = host => host.sdk.receipts().filter(entry => entry.receipt.type === 'keypeople.sync');

test('the only dossier archived: the key person leaves the list when Delta says its dossiers are loaded, and not while it is off or loading', async t => {
    t.mock.method(console, 'warn', () => {});
    const status = { hydration: 'ready' };
    await withPageApi(status, async () => {
        const people = { Ren: {} };
        const host = await keyHost({ delta: people });
        try {
            await host.send('Hello.', said('Dawn.', OPENING));
            await pin(host, 'Ren');
            await host.send('Next.', 'Quiet.');
            assert.equal(slice(host).pins.ren.nsd, true, 'known to Delta');
            assert.match(slice(host).pins.ren.npc, /^np_/, 'with its identity');
            // Delta's dossiers are not loaded (the list is empty): nobody is released on silence.
            delete people.Ren;
            status.hydration = 'loading';
            await host.send('Next.', 'Quiet.');
            assert.deepEqual(Object.keys(slice(host).pins), ['ren']);
            // Delta off: the same.
            status.hydration = 'ready';
            status.enabled = false;
            await host.send('Next.', 'Quiet.');
            assert.deepEqual(Object.keys(slice(host).pins), ['ren']);
            // Loaded and on, and its only dossier gone: archived.
            status.enabled = true;
            await host.send('Next.', 'Quiet.');
            assert.deepEqual(Object.keys(slice(host).pins), []);
            assert.equal(slice(host).gone.ren.reason, 'archived');
            assert.equal(syncs(host).length, 2);
            assert.deepEqual(validatorErrors(host), []);
        } finally {
            host.close();
        }
    })();
});

test('a confirmed death that Delta archived reads "died" (its dossier by id says deceased), not "archived"; a person never known to Delta stays', async t => {
    t.mock.method(console, 'warn', () => {});
    const people = { Ren: {}, Odda: {} };
    const archived = {};
    const host = await keyHost({ delta: people, archived });
    try {
        await host.send('Hello.', said('Dawn.', OPENING));
        await pin(host, 'Ren');
        await pin(host, 'Odda');
        await pin(host, 'Stranger');
        await host.send('Next.', 'Quiet.');
        // Ren dies and is archived (another dossier remains), Odda is archived the ordinary way.
        archived.Ren = { lifeState: 'deceased' };
        archived.Odda = {};
        delete people.Ren;
        delete people.Odda;
        people.Brom = {};
        await host.send('Next.', 'Quiet.');
        assert.deepEqual(Object.keys(slice(host).pins), ['stranger']);
        assert.deepEqual([slice(host).gone.ren.reason, slice(host).gone.odda.reason], ['died', 'archived']);
    } finally {
        host.close();
    }
});

test('a dossier renamed in Delta (the same identity) stays pinned', async t => {
    t.mock.method(console, 'warn', () => {});
    const people = { Ren: { id: 'np_ren00001' }, Odda: {} };
    const host = await keyHost({ delta: people });
    try {
        await host.send('Hello.', said('Dawn.', OPENING));
        await pin(host, 'Ren');
        await host.send('Next.', 'Quiet.');
        assert.equal(slice(host).pins.ren.npc, 'np_ren00001');
        people.Renard = people.Ren;
        delete people.Ren;
        await host.send('Next.', 'Quiet.');
        await host.send('Next.', 'Quiet.');
        assert.deepEqual(Object.keys(slice(host).pins), ['ren'], 'a rename is not an archive');
        assert.deepEqual(slice(host).gone, {});
        // Archived under the new name: it goes.
        delete people.Renard;
        await host.send('Next.', 'Quiet.');
        assert.deepEqual(Object.keys(slice(host).pins), []);
    } finally {
        host.close();
    }
});
