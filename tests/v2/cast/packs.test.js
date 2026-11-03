// A pack's cast changes after the chat began (the pack was updated in Story Studio and imported again, removed or switched off): new
// people join from the current story day at their start and the first reply after says so (no names); an unmet person whose entry changed
// takes the new words and keeps where they are; people met are never touched; an entry that left takes an unmet person quietly and leaves a
// met one in the world; a pack switched off keeps everyone as they are until it is back.
import test from 'node:test';
import assert from 'node:assert/strict';

import { OPENING, castHost, castSource, createFakeModel, entry, people, receipts, said, settle, slice, validatorErrors } from './helpers.js';

const quiet = t => t.mock.method(console, 'warn', () => {});
const at = (id, place) => entry(id, { start: { place, goal: `${id} goal`, routine: '' } });
const v = (item, packVersion) => ({ ...item, packVersion });

test('an update: new people join from today, hidden, with one line on the reply (no names); a changed unmet entry takes the new words and keeps where they are; a met person is untouched; removed: unmet leave, met stay', async t => {
    quiet(t);
    const brom = entry('brom', { start: { place: 'Harrow', goal: 'forge', routine: '' } });
    const source = castSource([brom, at('fenna', 'Bluewatch docks'), at('sera', 'Gwenmar')]);
    const model = createFakeModel(['~ cast fenna | Ashford | upriver for the guild']);
    const host = await castHost({ source, model });
    try {
        await host.send('Hello.', said('Dawn.', OPENING));
        await host.send('Look.', said(`Smoke. ${host.everyone()}`));
        assert.equal(people(host)['ersveil:brom'].met.why, 'place', 'Brom is met');
        await host.send('Sleep.', said('Morning.', ['~ time June 4, 1200, 08:00 am']));
        await settle();
        await host.send('Look.', said(`Smoke. ${host.everyone()}`));
        assert.equal(people(host)['ersveil:fenna'].where, 'Ashford');
        const syncs = receipts(host, 'cast.sync').length;
        // The pack is updated: 1.1.0 -> 1.2.0.
        source.packs[0].version = '1.2.0';
        source.entries = [
            v({ ...brom, name: 'Brom the Smith', look: 'new look' }, '1.2.0'),
            v({ ...at('fenna', 'Bluewatch docks'), name: 'Fenna Marsh' }, '1.2.0'),
            v(at('tam', 'Kesh'), '1.2.0'), v(at('una', 'Ashford'), '1.2.0'),
        ];
        await host.send('Look.', said(`Smoke. ${host.everyone()}`));
        const world = people(host);
        assert.equal(receipts(host, 'cast.sync').length, syncs + 1);
        assert.deepEqual(Object.keys(world).sort(), ['ersveil:brom', 'ersveil:fenna', 'ersveil:tam', 'ersveil:una'], 'Sera\'s entry left: she is gone, quietly');
        assert.deepEqual([world['ersveil:tam'].where, world['ersveil:tam'].met, world['ersveil:tam'].heard], ['Kesh', null, null]);
        assert.equal(world['ersveil:tam'].joined, host.head().domains.director.time.minutes, 'they join at the current story day');
        assert.equal(world['ersveil:fenna'].name, 'Fenna Marsh', 'an unmet person takes the new words');
        assert.deepEqual([world['ersveil:fenna'].where, world['ersveil:fenna'].doing], ['Ashford', 'upriver for the guild'], '... and keeps where they are');
        assert.equal(world['ersveil:brom'].name, 'Brom', 'a met person keeps their words');
        assert.equal(world['ersveil:brom'].ver, '1.2.0');
        // The reply says so, with no names.
        const note = Object.values(slice(host).notes).find(item => item.kind === 'updated');
        assert.deepEqual([note.head, note.tag, note.line], ['Ersveil pack updated', '1.1.0 → 1.2.0', 'Ersveil pack updated: 2 new people now live in the world']);
        assert.equal(note.rest, '2 new people now live in the world from today, hidden until you meet them. 1 unmet person\'s entry changed (kept where they are). People you have met keep their dossiers as they are.');
        assert.doesNotMatch(JSON.stringify(note), /Tam|Una|Fenna/);
        // Once: the next reply adds no step and no line.
        await host.send('Look.', said(`Smoke. ${host.everyone()}`));
        assert.equal(receipts(host, 'cast.sync').length, syncs + 1);
        assert.equal(Object.values(slice(host).notes).filter(item => item.kind === 'updated').length, 1);
        // Brom's entry leaves the pack: he is met, so he stays.
        source.entries = source.entries.filter(item => item.id !== 'brom');
        await host.send('Look.', said(`Smoke. ${host.everyone()}`));
        assert.equal(people(host)['ersveil:brom'].met.why, 'place');
        assert.deepEqual(validatorErrors(host), []);
        assert.deepEqual(host.store.problems(), []);
        // A rebuild agrees.
        const live = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live);
    } finally {
        host.close();
    }
});

test('a pack switched off keeps its people as they are (hidden, not moved or met) until it is switched on again; a pack seen for the first time joins without a line', async t => {
    quiet(t);
    const source = castSource([at('fenna', 'Harrow'), at('sera', 'Gwenmar')]);
    const host = await castHost({ source });
    try {
        await host.send('Hello.', said('Dawn.', OPENING));
        await host.send('Look.', said(`Smoke. ${host.everyone()}`));
        assert.equal(Object.values(slice(host).notes).filter(item => item.kind === 'updated').length, 0, 'a first sight is not an update');
        assert.equal(people(host)['ersveil:fenna'].met.why, 'place');
        const kept = JSON.stringify(slice(host));
        source.packs[0].enabled = false;
        source.entries = [];
        await host.send('Next day.', said('Morning.', ['~ time June 4, 1200, 08:00 am']));
        await host.send('Look.', said(`Smoke. ${host.everyone()}`));
        assert.deepEqual(Object.keys(people(host)).sort(), ['ersveil:fenna', 'ersveil:sera'], 'nobody is dropped');
        assert.equal(JSON.stringify(people(host)['ersveil:sera']), JSON.stringify(JSON.parse(kept).people['ersveil:sera']));
        assert.equal(host.sdk.query('director.cast')[0].entry, undefined, 'a met person of a pack that is off has no entry to give');
        // Back on: they are as they were, and no line says the pack was updated.
        source.packs[0].enabled = true;
        source.entries = [at('fenna', 'Harrow'), at('sera', 'Gwenmar')];
        await host.send('Look.', said(`Smoke. ${host.everyone()}`));
        assert.equal(Object.values(slice(host).notes).filter(item => item.kind === 'updated').length, 0);
        assert.ok(host.sdk.query('director.cast')[0].entry);
    } finally {
        host.close();
    }
});

test('a version bump alone is no change: no line, no "entries changed"; with new people the line counts only the entries that were really edited', async t => {
    quiet(t);
    const source = castSource([at('fenna', 'Bluewatch docks'), at('sera', 'Gwenmar')]);
    const host = await castHost({ source });
    try {
        await host.send('Hello.', said('Dawn.', OPENING));
        await host.send('Look.', said(`Smoke. ${host.everyone()}`));
        source.packs[0].version = '1.2.0';
        await host.send('Look.', said(`Smoke. ${host.everyone()}`));
        assert.equal(Object.values(slice(host).notes).filter(item => item.kind === 'updated').length, 0, 'a bump with nothing new says nothing');
        assert.deepEqual(Object.values(people(host)).map(person => person.ver), ['1.2.0', '1.2.0'], 'but the version they were seen at moves on');
        // A bump, one new person, nobody edited.
        source.packs[0].version = '1.3.0';
        source.entries.push(at('tam', 'Kesh'));
        await host.send('Look.', said(`Smoke. ${host.everyone()}`));
        const bump = Object.values(slice(host).notes).find(item => item.kind === 'updated');
        assert.equal(bump.rest, '1 new person now lives in the world from today, hidden until you meet them. People you have met keep their dossiers as they are.');
        // An edit counts, once.
        source.packs[0].version = '1.4.0';
        source.entries = source.entries.map(item => (item.id === 'sera' ? { ...item, look: 'a new look' } : item)).concat([at('una', 'Pearlbank')]);
        await host.send('Look.', said(`Smoke. ${host.everyone()}`));
        const edit = Object.values(slice(host).notes).filter(item => item.kind === 'updated').at(-1);
        assert.match(edit.rest, /^1 new person now lives in the world from today, hidden until you meet them\. 1 unmet person's entry changed \(kept where they are\)\./);
        await host.send('Look.', said(`Smoke. ${host.everyone()}`));
        assert.equal(Object.values(slice(host).notes).filter(item => item.kind === 'updated').length, 2, 'once');
    } finally {
        host.close();
    }
});
