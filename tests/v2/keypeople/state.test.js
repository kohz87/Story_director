// Key people, item 1 (the state): who is pinned, each pinned person's away record, who was taken off the list and why, on a real
// Story Block host. The reader's Pin and Unpin ride the latest reply; the story's `away` and `key` lines write the rest; a swipe, a
// delete in the middle, a rebuild and a reload give the same state as living through it.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { DEFAULT_CAP, DEFAULT_TOKENS, FEATURE, findPin, initialKeyPeople, validateKeyPeople } from '../../../src/v2/keypeople/domain.js';
import { OPENING, keyHost, pin, said, slice, unpin, validatorErrors } from './helpers.js';

test('the domain: empty to begin with, a validator for each table, a person found by name or alias, never guessed', () => {
    assert.deepEqual(initialKeyPeople(), { pins: {}, away: {}, gone: {}, notes: {} });
    assert.deepEqual(validateKeyPeople(initialKeyPeople()), []);
    const whole = {
        pins: { ren: { name: 'Ren', since: null, rev: 3, aliases: ['the scout'], nsd: true } },
        away: { ren: { name: 'Ren', doing: 'scouting', since: 100, back: 2880, steps: [{ date: 200, text: 'reached the ridge' }], rev: 4 } },
        gone: { mara: { name: 'Mara', reason: 'died', on: 300, rev: 5 } },
        notes: { kn_00000001: { sid: 'sr_a', kind: 'back', name: 'Ren', head: 'Ren is back', rest: '.', lead: true, rev: 6 } },
    };
    assert.deepEqual(validateKeyPeople(whole), []);
    for (const [bad, why] of [
        [{ ...whole, pins: { ren: { name: 'Ren', since: 'x', rev: 3 } } }, 'pins'],
        [{ ...whole, pins: { other: { name: 'Ren', since: null, rev: 3 } } }, 'a pin kept under another key'],
        [{ ...whole, away: { ren: { ...whole.away.ren, steps: [{ date: 1 }] } } }, 'a step with no text'],
        [{ ...whole, gone: { mara: { name: 'Mara', reason: 'bored', on: null, rev: 1 } } }, 'a reason that is none of them'],
        [{ ...whole, notes: { kn_00000001: { ...whole.notes.kn_00000001, kind: 'x' } } }, 'a note of no kind'],
        [{ pins: {}, away: {}, gone: {} }, 'a table missing'],
        [{ ...whole, extra: {} }, 'an unknown field'],
    ]) assert.notDeepEqual(validateKeyPeople(bad), [], why);
    assert.equal(findPin(whole, 'REN').key, 'ren', 'any case');
    assert.equal(findPin(whole, 'the Scout').key, 'ren', 'by an alias');
    assert.equal(findPin(whole, 'Renata'), null, 'never guessed');
    assert.equal(findPin({}, 'Ren'), null, 'an older state with no key people');
    assert.equal(DEFAULT_CAP, 10);
    assert.equal(DEFAULT_TOKENS, 300);
});

test('Pin and Unpin: the reader\'s own commands on the latest reply; the story cannot pin; the cap holds; an unpinned person is on record with the reason', async () => {
    const host = await keyHost({ settings: { 'keypeople.cap': 2 } });
    try {
        assert.deepEqual(slice(host), initialKeyPeople(), 'a new chat starts empty');
        await host.send('Hello.', said('Dawn.', OPENING));
        const first = await pin(host, 'Ren', { aliases: ['the scout', 'Ren'] });
        assert.equal(first.ok, true, first.message);
        assert.deepEqual(slice(host).pins.ren, { name: 'Ren', since: host.sdk.query('director.time').minutes, rev: first.receipt.rev, aliases: ['the scout'] });
        assert.equal(first.receipt.data.edit, true, 'a reader\'s edit on the reply');
        // Pinned again, by name or by alias: nothing changes.
        const again = await pin(host, 'the scout');
        assert.equal(again.ok, true);
        assert.match(again.receipt.summary, /already a key person/);
        assert.deepEqual(Object.keys(slice(host).pins), ['ren']);
        assert.equal((await pin(host, 'Odda')).ok, true);
        // The cap (a setting): the third is refused with a sentence, nothing is written.
        const third = await pin(host, 'Fenna');
        assert.equal(third.ok, false);
        assert.equal(third.code, 'LIMITED');
        assert.match(third.message, /can have 2 key people/);
        host.settings.set('story-director', 'keypeople.cap', 1);
        assert.match((await pin(host, 'Fenna')).message, /can have 1 key person; unpin/);
        host.settings.set('story-director', 'keypeople.cap', 2);
        assert.deepEqual(Object.keys(slice(host).pins), ['ren', 'odda']);
        // Not a name, not a payload.
        assert.equal((await pin(host, '   ')).ok, false);
        assert.equal((await host.sdk.command('keypeople.pin', { name: 'X', extra: 1 })).ok, false);
        assert.equal((await host.sdk.command('keypeople.pin', {})).ok, false);
        // The story and the system cannot pin or unpin (cause story / system).
        for (const cause of ['story', 'system']) {
            let refused;
            try { refused = await host.bus.run('keypeople.pin', { name: 'Fenna' }, { cause, state: host.head() }); } catch (error) { refused = { ok: false, code: error?.code, message: error?.message }; }
            assert.notEqual(refused?.ok, true, cause);
            assert.match(`${refused?.code ?? ''} ${refused?.message ?? ''}`, /REFUSED|Only you pin/, cause);
        }
        // Unpin: off the list, on record with the reason.
        const gone = await unpin(host, 'Odda');
        assert.equal(gone.ok, true, gone.message);
        assert.deepEqual(Object.keys(slice(host).pins), ['ren']);
        assert.deepEqual(slice(host).gone.odda, { name: 'Odda', reason: 'unpinned', on: host.sdk.query('director.time').minutes, rev: gone.receipt.rev });
        assert.equal((await unpin(host, 'Odda')).ok, false, 'not a key person any more');
        assert.equal((await unpin(host, 'Nobody')).code, 'NOT_FOUND');
        // Pinned again, the record of the removal goes.
        assert.equal((await pin(host, 'Odda')).ok, true);
        assert.deepEqual(slice(host).gone, {});
        assert.deepEqual(validatorErrors(host), []);
    } finally {
        host.close();
    }
});

test('the story\'s lines: a pinned person goes away, takes steps, returns; only a pinned person may be away', async () => {
    const host = await keyHost();
    try {
        await host.send('Hello.', said('Dawn.', OPENING));
        await pin(host, 'Ren', { aliases: ['the scout'] });
        // Not pinned: a plain refusal in the Problems list, nothing written.
        await host.send('Go.', said('Odda leaves.', ['+ away Odda — at the Seal council | back: June 20, 1200']));
        assert.deepEqual(slice(host).away, {});
        assert.match(host.turn.problems().map(problem => problem.message ?? problem.why ?? String(problem)).join(' '), /Odda is not a key person/);

        await host.send('Go.', said('Ren leaves.', ['+ away the scout — scouting the north road | back: June 9, 1200']));
        const clock = host.sdk.query('director.time').minutes;
        const away = slice(host).away.ren;
        assert.deepEqual([away.name, away.doing, away.since, away.back, away.steps], ['Ren', 'scouting the north road', clock, clock + 6 * 1440 - 8 * 60, []]);
        // A step on the timeline, with the clock then; the same step twice is one.
        await host.send('On.', said('News.', ['! time +1d', '! away Ren — reached Wolfmere Outpost']));
        await host.send('On.', said('More news.', ['! away Ren — reached Wolfmere Outpost']));
        assert.deepEqual(slice(host).away.ren.steps, [{ date: clock + 1440, text: 'reached Wolfmere Outpost' }]);
        // A change of plan: what they do and when they are due back.
        await host.send('On.', said('A letter.', ['~ away Ren — held at the border | back: June 12, 1200']));
        assert.deepEqual([slice(host).away.ren.doing, slice(host).away.ren.back], ['held at the border', clock + 9 * 1440 - 8 * 60]);
        // Only a step with words, only for someone away.
        await host.send('On.', said('Nothing.', ['! away Ren', '! away Odda — somewhere', '- away Odda']));
        assert.equal(slice(host).away.ren.steps.length, 1);
        // Back: the record goes, and the reply's note says so.
        await host.send('Home.', said('Ren is back.', ['! time +2d', '- away Ren']));
        assert.deepEqual(slice(host).away, {});
        const note = Object.values(slice(host).notes).at(-1);
        assert.deepEqual([note.kind, note.name, note.head, note.lead], ['back', 'Ren', 'Ren is back', true]);
        assert.equal(note.rest, 'from held at the border (key person, away June 3 – June 6).');
        assert.deepEqual(Object.keys(slice(host).pins), ['ren'], 'still a key person');
        // The same day: one date, not "June 6 – June 6".
        await pin(host, 'Odda');
        await host.send('Go.', said('Odda leaves.', ['+ away Odda — at the mill']));
        await host.send('Back.', said('Odda is back.', ['- away Odda']));
        assert.equal(Object.values(slice(host).notes).at(-1).rest, 'from at the mill (key person, away June 6).');
        assert.deepEqual(validatorErrors(host), []);
    } finally {
        host.close();
    }
});

test('a back date that cannot be read is told as a Problem and left out; a stretch of time counts from the story clock', async () => {
    const host = await keyHost();
    try {
        await host.send('Hello.', said('Dawn.', OPENING));
        await pin(host, 'Ren');
        await host.send('Go.', said('Ren leaves.', ['+ away Ren — scouting | back: when the moon is full']));
        assert.equal(slice(host).away.ren.back, null);
        assert.match(host.turn.problems().map(problem => problem.message ?? String(problem)).join(' '), /not a date on this calendar/);
        await host.send('Go.', said('A letter.', ['~ away Ren | back: in 6 days']));
        const clock = host.sdk.query('director.time').minutes;
        assert.equal(slice(host).away.ren.back, Math.floor((clock + 6 * 1440) / 1440) * 1440);
        assert.equal(slice(host).away.ren.doing, 'scouting', 'what they do is kept when the line gives no words');
    } finally {
        host.close();
    }
});

test('"- key Name | died": the story records a death, the pin goes with its reason; nothing else takes someone off the list from the story', async () => {
    const host = await keyHost();
    try {
        await host.send('Hello.', said('Dawn.', OPENING));
        await pin(host, 'Ren');
        await pin(host, 'Mara');
        await host.send('Go.', said('They leave.', ['+ away Ren — scouting | back: June 9, 1200', '+ away Mara — at the quarry']));
        // Not a death: refused, quietly; nothing changes.
        await host.send('Hm.', said('Mara waves.', ['- key Mara', '- key Mara | gone north', '+ key Mara']));
        assert.deepEqual(Object.keys(slice(host).pins), ['ren', 'mara']);
        const said_ = host.turn.problems().map(problem => problem.message ?? String(problem)).join(' ');
        assert.match(said_, /leaves the key list only when they die/);
        await host.send('Oh no.', said('The roof gives way.', ['! time +2d', '- key Mara | died']));
        assert.deepEqual(Object.keys(slice(host).pins), ['ren']);
        assert.deepEqual(slice(host).away.mara, undefined, 'the away record goes with the pin');
        assert.equal(slice(host).gone.mara.reason, 'died');
        assert.equal(slice(host).gone.mara.on, host.sdk.query('director.time').minutes);
        const note = Object.values(slice(host).notes).at(-1);
        assert.deepEqual([note.kind, note.head, note.rest], ['gone', 'Mara is no longer a key person', '(died, June 5).']);
        // A person who is not pinned cannot be away afterwards either.
        await host.send('Ghost.', said('Mara?', ['+ away Mara — somewhere']));
        assert.deepEqual(Object.keys(slice(host).away), ['ren']);
    } finally {
        host.close();
    }
});

test('replay: a swipe, a Re-read, a delete in the middle, a rebuild and a reload all give the live state', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await keyHost();
    try {
        await host.send('Hello.', said('Dawn.', [...OPENING, '+ hook Anything — keeps the reply busy']));
        await pin(host, 'Ren');
        await pin(host, 'Odda');
        await host.send('Go.', said('Ren leaves.', ['+ away Ren — scouting | back: June 9, 1200']));
        await host.send('News.', said('A rider.', ['! away Ren — reached the ridge', '+ away Odda — at the council']));
        await host.send('Later.', said('More.', ['! away Odda — the vote is close', '- away Ren']));
        await host.send('Again.', said('Quiet.', ['~ away Odda | back: June 14, 1200']));
        const check = async where => {
            const live = JSON.stringify(host.head());
            host.store.rebuild();
            assert.equal(JSON.stringify(host.head()), live, `${where}: rebuild != live`);
            assert.deepEqual(host.store.problems(), [], `${where}: nothing is skipped`);
            assert.deepEqual(validatorErrors(host), [], where);
            const again = await createHost({ modules: [createModule()], st: { chat: structuredClone(host.ctx.chat), extensionSettings: structuredClone(host.ctx.extensionSettings) } });
            try {
                assert.equal(JSON.stringify(again.head().domains.keypeople), JSON.stringify(host.head().domains.keypeople), `${where}: a reload gives the live state`);
            } finally {
                again.close();
            }
        };
        await check('after the replies');
        // A swipe of the last reply takes its lines back and writes the new ones.
        const before = JSON.stringify(slice(host).away);
        await host.swipe(said('Another take.', ['~ away Odda | back: June 20, 1200']));
        assert.notEqual(JSON.stringify(slice(host).away), before);
        await check('after a swipe');
        // A Re-read of the reply before it writes its lines again, once.
        assert.equal((await host.turn.reread(host.ctx.chat.length - 3)).ok, true);
        assert.equal(slice(host).away.ren, undefined, 'back once, not twice');
        assert.deepEqual(slice(host).away.odda.steps.map(step => step.text), ['the vote is close']);
        await check('after a Re-read');
        // The reply that sent Ren away is deleted in the middle: what came after still applies (the step has no record to join and is
        // passed over, the return finds nothing to remove), and a rebuild and a reload agree.
        await host.st.deleteMessage(4);
        await host.st.deleteMessage(3);
        await check('after a delete in the middle');
        assert.equal(slice(host).away.ren, undefined);
    } finally {
        host.close();
    }
});

test('the feature: on by default with no preset (Lean keeps it), not part of the World-building threads; off means fully off and nothing stored is lost', async () => {
    const host = await keyHost();
    try {
        const def = host.sdk.modules().find(entry => entry.id === 'story-director');
        assert.ok(def.kinds.includes('away') && def.kinds.includes('key'));
        const feature = createModule().features.find(entry => entry.id === FEATURE);
        assert.deepEqual([feature.label, feature.default, feature.presets], ['Key people', true, undefined]);
        assert.ok(feature.describe.length <= 240 && feature.label.length <= 60);
        const kinds = createModule().capture.kinds;
        assert.deepEqual([kinds.away.feature, kinds.key.feature], [FEATURE, FEATURE], 'its own feature, not the threads');
        await host.send('Hello.', said('Dawn.', OPENING));
        await pin(host, 'Ren');
        await host.send('Go.', said('Ren leaves.', ['+ away Ren — scouting | back: June 9, 1200']));
        const stored = JSON.stringify(host.head().domains.keypeople);
        host.features.set(FEATURE, false);
        // Off: the commands are refused, a line of the kinds is left out quietly, queries are gone, the state is kept.
        assert.equal((await pin(host, 'Odda')).code, 'FEATURE_OFF');
        assert.equal((await unpin(host, 'Ren')).code, 'FEATURE_OFF');
        await host.send('Go.', said('Odda leaves.', ['+ away Odda — elsewhere', '- away Ren']));
        assert.equal(JSON.stringify(host.head().domains.keypeople), stored, 'what is stored stays');
        assert.deepEqual(host.turn.problems().filter(problem => problem.code !== 'FEATURE_OFF' || problem.quiet !== true), [], 'the lines of the kinds are a quiet FEATURE_OFF, no refusal');
        assert.equal(host.sdk.query('director.keyPeople'), null, 'the contract query answers null while it is off');
        assert.equal(host.sdk.query('director.keyPeople.on'), null);
        // On again: it is all there, and a rebuild agrees.
        host.features.set(FEATURE, true);
        assert.equal(host.sdk.query('director.keyPeople')[0].name, 'Ren');
        const live = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live);
    } finally {
        host.close();
    }
});
