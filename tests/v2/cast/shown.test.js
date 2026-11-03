// A planned meeting counts only if the reply shows the person: after the reply's lines, a person the meeting brought in whose name (or an
// alias, as a whole word) is not in the shown words, and who is in no `+ present` line, has the meeting taken back (`cast.withdraw`).
import test from 'node:test';
import assert from 'node:assert/strict';

import { namedIn } from '../../../src/v2/cast/world.js';
import { OPENING, castCue, castHost, castSource, entry, people, receipts, said, slice, validatorErrors } from './helpers.js';

const TEMIWA = entry('temiwa', { name: 'Sister Temiwa', aliases: ['Temiwa', 'Last Candle'], start: { place: 'Harrow', goal: 'tend the dying', routine: 'at the infirmary by day' } });
const LINE = ['~ place Harrow | kind: settlement'];
const quiet = t => t.mock.method(console, 'warn', () => {});
const notes = host => Object.values(slice(host).notes).filter(item => item.kind === 'met');

async function toMeeting(reply, extra = {}) {
    const host = await castHost({ source: castSource([TEMIWA, ...(extra.more ?? [])]), settings: extra.settings ?? {} });
    await host.send('Hello.', said('Dawn.', OPENING));
    await host.send('Look around.', said(reply, extra.lines ?? LINE));
    return host;
}

test('namedIn: a name or an alias as a whole word, any case; a title alone or a part of a longer word is not enough', () => {
    const person = { name: 'Sister Temiwa', aliases: ['Temiwa', 'Last Candle'] };
    assert.equal(namedIn(person, 'The sister nods.'), false);
    assert.equal(namedIn(person, 'Sister Temiwa nods.'), true);
    assert.equal(namedIn(person, 'sister   temiwa nods.'), true);
    assert.equal(namedIn(person, 'TEMIWA\'s hands shake.'), true);
    assert.equal(namedIn(person, 'The last candle burns.'), true);
    assert.equal(namedIn(person, 'Temiwanda waves.'), false);
    assert.equal(namedIn(person, 'Sisters of the Ash.'), false);
});

test('a reply that does not show the person withdraws the meeting: unmet, no card line, no pace used, no dossier source, and she may come again', async t => {
    quiet(t);
    const host = await toMeeting('Smoke rises over the yard. A sister hurries past.');
    try {
        assert.equal(receipts(host, 'cast.meet').length, 1, 'the narrator was told to bring her in');
        assert.equal(receipts(host, 'cast.withdraw').length, 1);
        assert.equal(people(host)['ersveil:temiwa'].met, null);
        assert.deepEqual(notes(host), [], 'no "Paths crossed"');
        assert.deepEqual(host.sdk.query('director.cast'), [], 'nothing for another module to make a dossier from');
        assert.deepEqual(host.sdk.query('director.cast.counts'), { met: 0, total: 1, unmet: 1 });
        // The pace (one a day) is not used up: the next reply may bring her, and a reply that names her keeps the meeting.
        await host.send('Wait.', said('Sister Temiwa kneels by the well.', LINE));
        assert.equal(people(host)['ersveil:temiwa'].met.why, 'place');
        assert.equal(receipts(host, 'cast.withdraw').length, 1);
        assert.equal(notes(host).length, 1);
        assert.equal(host.sdk.query('director.cast').length, 1);
        assert.deepEqual(validatorErrors(host), []);
        assert.deepEqual(host.store.problems(), []);
    } finally {
        host.close();
    }
});

test('a reply that names her by an alias, or a `+ present` line, keeps the meeting; a title alone does not', async t => {
    quiet(t);
    const alias = await toMeeting('Temiwa looks up from the bowl.');
    try {
        assert.equal(people(alias)['ersveil:temiwa'].met.why, 'place');
        assert.equal(receipts(alias, 'cast.withdraw').length, 0);
    } finally {
        alias.close();
    }
    const present = await toMeeting('A woman in grey stands by the well.', { lines: ['+ present Sister Temiwa'] });
    try {
        assert.equal(people(present)['ersveil:temiwa'].met.why, 'place');
        assert.equal(receipts(present, 'cast.withdraw').length, 0);
    } finally {
        present.close();
    }
    const title = await toMeeting('The Sister hurries by.');
    try {
        assert.equal(people(title)['ersveil:temiwa'].met, null);
    } finally {
        title.close();
    }
});

test('her name only inside a hidden comment is not shown', async t => {
    quiet(t);
    const host = await toMeeting('Smoke rises. <!-- Sister Temiwa is thought of here -->');
    try {
        assert.equal(people(host)['ersveil:temiwa'].met, null);
    } finally {
        host.close();
    }
});

test('a goal arrival that the reply does not show goes back to where she was', async t => {
    quiet(t);
    const sera = entry('sera', { start: { place: 'Gwenmar', goal: 'find the killer', routine: '' }, drawnTo: ['the man you fought at the weir'] });
    const model = (await import('./helpers.js')).createFakeModel([], { fallback: ({ prompt }) => (/sera/i.test(prompt) ? '> cast sera | the story reached her' : '') });
    const host = await castHost({ source: castSource([sera]), model });
    try {
        await host.send('Hello.', said('Dawn. The man you fought at the weir.', OPENING));
        await host.send('Next.', said('The man you fought at the weir bleeds.', LINE));
        await host.send('Next.', said('The man you fought at the weir groans.', LINE));
        const person = people(host)['ersveil:sera'];
        if (person.met) {
            assert.equal(person.met.why, 'goal');
            assert.equal(receipts(host, 'cast.withdraw').length > 0, true);
        }
        assert.equal(person.met, null, 'withdrawn');
        assert.equal(person.where, 'Gwenmar', 'back where she was');
    } finally {
        host.close();
    }
});

test('swipe: a new swipe may show her or not; a Re-read decides again; a rebuild equals live', async t => {
    quiet(t);
    const host = await toMeeting('Smoke rises.');
    try {
        assert.equal(people(host)['ersveil:temiwa'].met, null);
        await host.swipe(said('Sister Temiwa kneels by the well.', LINE));
        assert.equal(people(host)['ersveil:temiwa'].met.why, 'place', 'the new swipe shows her: met as before');
        assert.equal(notes(host).length, 1);
        assert.match(castCue(host), /Sister Temiwa \(also/);
        const shown = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), shown);
        await host.swipe(said('Only smoke.', LINE));
        assert.equal(people(host)['ersveil:temiwa'].met, null, 'the next swipe does not');
        assert.deepEqual(notes(host), []);
        assert.match(castCue(host), /Sister Temiwa \(also/, 'the cue is for the rewritten reply as before');
        const gone = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), gone);
        assert.deepEqual(validatorErrors(host), []);
    } finally {
        host.close();
    }
});

test('Re-read of a reply whose text no longer shows her withdraws the meeting; of one that shows her again meets her again', async t => {
    quiet(t);
    const host = await toMeeting('Sister Temiwa kneels by the well.');
    try {
        const index = host.ctx.chat.length - 1;
        assert.equal(people(host)['ersveil:temiwa'].met.why, 'place');
        const message = host.ctx.chat[index];
        const original = message.mes;
        message.mes = original.replace('Sister Temiwa', 'A sister');
        if (Array.isArray(message.swipes)) message.swipes[message.swipe_id] = message.mes;
        assert.equal((await host.sdk.reread(index)).ok, true);
        assert.equal(people(host)['ersveil:temiwa'].met, null);
        assert.deepEqual(notes(host), []);
        const withdrawn = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), withdrawn, 'rebuild == live');
        message.mes = original;
        if (Array.isArray(message.swipes)) message.swipes[message.swipe_id] = original;
        assert.equal((await host.sdk.reread(index)).ok, true);
        assert.equal(people(host)['ersveil:temiwa'].met.why, 'place');
        assert.equal(notes(host).length, 1);
        assert.deepEqual(validatorErrors(host), []);
    } finally {
        host.close();
    }
});

test('someone met in the story is never withdrawn', async t => {
    quiet(t);
    const host = await castHost({ source: castSource([entry('temiwa', { name: 'Sister Temiwa', aliases: ['Temiwa'], start: { place: 'Elsewhere', goal: 'tend the dying', routine: '' } })]) });
    try {
        await host.send('Hello.', said('Dawn.', OPENING));
        await host.send('Look.', said('Sister Temiwa is here.', ['+ present Sister Temiwa']));
        await host.send('Look.', said('Sister Temiwa nods.', LINE));
        assert.equal(people(host)['ersveil:temiwa'].met.why, 'story');
        await host.send('Look.', said('Smoke.', LINE));
        assert.equal(people(host)['ersveil:temiwa'].met.why, 'story');
        assert.equal(receipts(host, 'cast.withdraw').length, 0);
    } finally {
        host.close();
    }
});
