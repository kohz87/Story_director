// Key people, item 5 (the contract for NPC State Delta): `director.keyPeople` → [{ name, aliases?, here, away: { doing, since, back, steps:
// [{ date, text }] } | null, removed?: { reason, on } }], read-only frozen copies, the same after a rebuild, null while the feature is off,
// and the same with or without NPC State Delta.
import test from 'node:test';
import assert from 'node:assert/strict';

import { keyPeopleQuery } from '../../../src/v2/keypeople/queries.js';
import { FEATURE } from '../../../src/v2/keypeople/domain.js';
import { OPENING, keyHost, pin, said, unpin } from './helpers.js';


test('the answer: pinned people in the order they were pinned, then those taken off the list; here, away and removed as the contract says', async () => {
    const host = await keyHost();
    try {
        await host.send('Hello.', said('Dawn.', [...OPENING, '+ present Fenna']));
        const clock = host.sdk.query('director.time').minutes;
        await pin(host, 'Ren', { aliases: ['the scout'] });
        await pin(host, 'Fenna');
        await pin(host, 'Odda');
        await host.send('Go.', said('Ren leaves.', ['+ away the scout — scouting the north road | back: June 9, 1200', '! time +1d', '! away Ren — reached Wolfmere Outpost', '! away Ren — a toll gate']));
        await unpin(host, 'Odda');
        const list = host.sdk.query('director.keyPeople');
        assert.deepEqual(list, [
            { name: 'Ren', aliases: ['the scout'], here: false, away: { doing: 'scouting the north road', since: clock, back: clock + 6 * 1440 - 8 * 60, steps: [{ date: clock + 1440, text: 'reached Wolfmere Outpost' }, { date: clock + 1440, text: 'a toll gate' }] } },
            { name: 'Fenna', here: true, away: null },
            { name: 'Odda', here: false, away: null, removed: { reason: 'unpinned', on: clock + 1440 } },
        ]);
        // Copies, frozen as the query makes them (the host hands out its own copy): nothing a caller does reaches the state.
        const made = keyPeopleQuery(host.head(), {}, {});
        assert.equal(Object.isFrozen(made) && Object.isFrozen(made[0]) && Object.isFrozen(made[0].away) && Object.isFrozen(made[0].away.steps) && Object.isFrozen(made[0].aliases), true);
        assert.throws(() => { 'use strict'; made[0].away.doing = 'x'; }, TypeError);
        list[0].away.doing = 'changed by the caller';
        assert.equal(host.sdk.query('director.keyPeople')[0].away.doing, 'scouting the north road');
        assert.equal(host.head().domains.keypeople.away.ren.doing, 'scouting the north road');
        // Present by an alias counts as here; an alias of an away person present in the scene too.
        await host.send('Look.', said('The scout is back in sight.', ['+ present the scout']));
        assert.equal(host.sdk.query('director.keyPeople')[0].here, true);
        // The same after a rebuild.
        const before = JSON.stringify(host.sdk.query('director.keyPeople'));
        host.store.rebuild();
        assert.equal(JSON.stringify(host.sdk.query('director.keyPeople')), before);
    } finally {
        host.close();
    }
});

test('the answer is the same with NPC State Delta there (its present list counts as here), and with a chat that has no key people at all', async () => {
    const host = await keyHost({ delta: { Fenna: {}, Ren: { aliases: ['the scout'] } } });
    try {
        assert.deepEqual(host.sdk.query('director.keyPeople'), [], 'a new chat: nobody');
        await host.send('Hello.', said('Dawn.', OPENING));
        await pin(host, 'Fenna');
        assert.deepEqual(host.sdk.query('director.keyPeople'), [{ name: 'Fenna', here: false, away: null }]);
    } finally {
        host.close();
    }
    // A state with no `keypeople` domain (a chat saved before it existed) reads as nobody; pure, no query needed.
    assert.deepEqual(keyPeopleQuery({ domains: {} }, {}, {}), []);
    assert.deepEqual(keyPeopleQuery(undefined, undefined, undefined), []);
    // NPC State Delta's present list (a query stand-in) marks someone here.
    const state = { domains: { keypeople: { pins: { ren: { name: 'Ren', since: null, rev: 1, aliases: ['the scout'] } }, away: {}, gone: {}, notes: {} } } };
    const tools = { query: name => { if (name === 'npc.present') return ['The Scout']; throw new Error('no such query'); } };
    assert.equal(keyPeopleQuery(state, {}, tools)[0].here, true);
});

test('the query is the feature\'s: it answers null while the feature is off, and again when it is on', async () => {
    const host = await keyHost();
    try {
        await host.send('Hello.', said('Dawn.', OPENING));
        await pin(host, 'Ren');
        host.features.set(FEATURE, false);
        assert.equal(host.sdk.query('director.keyPeople'), null);
        assert.equal(host.sdk.query('director.keyPeople.view'), null);
        host.features.set(FEATURE, true);
        assert.equal(host.sdk.query('director.keyPeople').length, 1);
    } finally {
        host.close();
    }
});

test('the story clock in the answer: minutes, as the other queries give them', async () => {
    const host = await keyHost();
    try {
        await host.send('Hello.', said('Dawn.', OPENING));
        await pin(host, 'Ren');
        await host.send('Go.', said('Ren leaves.', ['+ away Ren — scouting | back: June 9, 1200']));
        const [ren] = host.sdk.query('director.keyPeople');
        assert.equal(ren.away.since, host.sdk.query('director.time').minutes);
        assert.equal(ren.away.back % 1440, 0, 'back is the start of the day');
        assert.equal(Number.isSafeInteger(ren.away.back), true);
    } finally {
        host.close();
    }
});
