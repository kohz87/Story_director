// What other modules and the World screen read: `director.cast` gives only people who have been met (with their pack entry, for NPC State
// Delta's dossier); an unmet person is never named, not even to a module; the numbers and the "Around here" data come as counts.
import test from 'node:test';
import assert from 'node:assert/strict';

import { OPENING, castHost, castSource, createFakeModel, entry, said, settle } from './helpers.js';

const quiet = t => t.mock.method(console, 'warn', () => {});

test('director.cast: the met people only, each with where they are, the last news and the whole pack entry; copies; counts without names', async t => {
    quiet(t);
    const brom = entry('brom', { start: { place: 'Harrow', goal: 'forge', routine: '' }, aliases: ['the smith'], portrait: 'brom.webp', stages: [{ label: 'Wary' }], meters: { preset: 'townsfolk' } });
    const fenna = entry('fenna', { start: { place: 'Bluewatch docks', goal: 'ferry', routine: 'works the night ferry' } });
    const host = await castHost({ source: castSource([brom, fenna]), model: createFakeModel(['~ cast brom | Kesh | selling blades at the Kesh fair']) });
    try {
        assert.deepEqual(host.sdk.query('director.cast'), [], 'no one met yet');
        await host.send('Hello.', said('Dawn.', OPENING));
        await host.send('Look.', said('Smoke.'));
        const met = host.sdk.query('director.cast');
        assert.equal(met.length, 1);
        assert.deepEqual(Object.keys(met[0]).sort(), ['aliases', 'alive', 'doing', 'entry', 'id', 'key', 'lastHeard', 'met', 'name', 'pack', 'where']);
        assert.deepEqual([met[0].key, met[0].pack, met[0].id, met[0].name, met[0].aliases, met[0].alive, met[0].lastHeard], ['ersveil:brom', 'ersveil', 'brom', 'Brom', ['the smith'], true, null]);
        assert.deepEqual(met[0].met, { on: host.head().domains.director.time.minutes, where: 'Harrow' });
        assert.deepEqual(met[0].entry, brom, 'the whole entry, as the pack lists it: portrait, secrets, meters, stages');
        // A copy: changing it changes nothing of the world or the pack.
        try { met[0].name = 'X'; met[0].entry.look = 'X'; } catch { /* frozen is as good */ }
        assert.equal(host.sdk.query('director.cast')[0].name, 'Brom');
        assert.equal(host.sdk.query('director.cast')[0].entry.look, 'weathered');
        // Not Fenna: not her name, not her place, not her number.
        assert.doesNotMatch(JSON.stringify(met), /Fenna|Bluewatch/);
        assert.deepEqual(host.sdk.query('director.cast.counts'), { met: 1, total: 2, unmet: 1 });
        // The news of a met person comes with the planner's batch.
        await host.send('Sleep.', said('Morning.', ['~ time June 4, 1200, 08:00 am']));
        await settle();
        await host.send('Look.', said('Smoke.'));
        const later = host.sdk.query('director.cast')[0];
        assert.deepEqual([later.where, later.doing], ['Kesh', 'selling blades at the Kesh fair']);
        assert.deepEqual(later.lastHeard, { on: host.head().domains.director.time.minutes, text: 'selling blades at the Kesh fair' });
        assert.equal(later.met.where, 'Harrow', 'where they were met is what it was');
        // The pack gone: still met, the entry is not there to give.
        host.source.entries = [fenna];
        assert.equal(host.sdk.query('director.cast')[0].entry, undefined);
    } finally {
        host.close();
    }
});

test('director.cast.view: Around here\'s numbers: met n of N always, how many unmet are at this place only when there are some, the met people\'s news', async t => {
    quiet(t);
    const here = entry('brom', { start: { place: 'Harrow', goal: 'forge', routine: 'at the forge in the evening' } });
    const near = entry('tam', { start: { place: 'Harrow', goal: 'x', routine: 'at the forge in the evening' } });
    const far = entry('sera', { start: { place: 'Gwenmar', goal: 'x', routine: '' } });
    const host = await castHost({ source: castSource([here, near, far]) });
    try {
        assert.equal(host.sdk.query('director.cast.view'), null, 'no one in the world yet');
        await host.send('Hello.', said('Dawn.', OPENING));
        await host.send('Look.', said('Smoke.'));
        // 8:00 am: the forge people are not at the forge yet (their routine is the evening): both are near, neither met.
        let view = host.sdk.query('director.cast.view');
        assert.deepEqual([view.on, view.met, view.total, view.near, view.hasNear, view.hasMet, view.heading, view.packLabel], [true, 0, 3, 2, true, false, 'Harrow · morning', 'Ersveil cast']);
        assert.deepEqual(view.metList, []);
        assert.match(view.note, /^Unmet cast stays hidden\./);
        // The party goes where nobody is: no "near".
        await host.send('Go.', said('The road.', ['~ place Greywater | kind: landmark']));
        view = host.sdk.query('director.cast.view');
        assert.deepEqual([view.near, view.hasNear], [0, false]);
        assert.doesNotMatch(JSON.stringify(view), /Tam|Brom|Sera/);
        host.features.set('story-director.cast', false);
        assert.equal(host.sdk.query('director.cast.view'), null);
    } finally {
        host.close();
    }
});

test('a person met from the cast can be pinned as a key person: the Pin chooser lists them (not the unmet), and once pinned the planner leaves them to the key people track', async t => {
    quiet(t);
    const host = await castHost({
        source: castSource([entry('brom', { start: { place: 'Harrow', goal: 'forge', routine: '' }, aliases: ['the smith'] }), entry('fenna', { start: { place: 'Bluewatch docks', goal: 'f', routine: 'works the night ferry' } })]),
        model: createFakeModel(['~ cast fenna | Elsewhere | gone', '~ cast brom | Elsewhere | gone']),
    });
    try {
        await host.send('Hello.', said('Dawn.', OPENING));
        await host.send('Look.', said('Smoke.'));
        const choices = host.sdk.query('director.keyPeople.view').choices;
        assert.deepEqual(choices.map(choice => [choice.name, choice.source, choice.aliases]), [['Brom', 'cast', ['the smith']]]);
        assert.ok((await host.sdk.command('keypeople.pin', { name: 'Brom', aliases: ['the smith'] })).ok);
        assert.deepEqual(host.sdk.query('director.keyPeople.view').choices, []);
        await host.send('Sleep.', said('Morning.', ['~ time June 4, 1200, 08:00 am']));
        await settle();
        assert.doesNotMatch(host.model.calls.at(-1).prompt, /- brom \|/, 'a key person is not moved by the cast planner');
        assert.match(host.model.calls.at(-1).prompt, /- fenna \|/);
    } finally {
        host.close();
    }
});
