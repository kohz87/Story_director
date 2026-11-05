// The reader seeks a kind of person ("a healer or sister around"): the cast answers. The planner (its own model call, mode 'sought') may say an
// unmet person is sought, citing the reader's words; code checks the words stand in the message or the reply. At the party's place the person
// comes in ("sought"); elsewhere the narrator hears a rumor that describes them and never names them, told once until they move.
import test from 'node:test';
import assert from 'node:assert/strict';

import { applyRumor, applySync, planSync, syncPayload } from '../../../src/v2/cast/apply.js';
import { DAY, initialCast, validateCast } from '../../../src/v2/cast/domain.js';
import { castOf, readEntry } from '../../../src/v2/cast/entries.js';
import { citedIn, rumorText } from '../../../src/v2/cast/sought.js';
import { chooseMeetings, chooseRumor, paceOf } from '../../../src/v2/cast/world.js';
import { readCast } from '../../../src/v2/cast/plan.js';
import { OPENING, castCue, castHost, castSource, createFakeModel, entry, people, receipts, said, sent, settle, slice, validatorErrors, TAIL_KEY } from './helpers.js';

const castFor = (...entries) => castOf((name, args) => (name === 'packs.content' && args?.kind === 'cast' ? entries : name === 'packs.list' ? [{ id: 'ersveil', name: 'Ersveil', version: '1.1.0', enabled: true }] : null));

const quiet = t => t.mock.method(console, 'warn', () => {});

const temiwa = (place, more = {}) => entry('temiwa', {
    name: 'Sister Temiwa', aliases: ['Temiwa', 'Last Candle'],
    about: 'A fox-eared saintess candidate cast out to the frontier: its sarcastic healer and the keeper of its dead.',
    fields: { Calling: 'Saintess candidate, healer' },
    start: { place, goal: 'Serve out the posting.', routine: 'Watchhouse infirmary by day; the yard at night.' },
    ...more,
});

// The planner: a sought call (it lists "People who might fit") is answered by `sought(call)`; any other by `other`.
const planner = ({ sought = () => '', other = () => '' } = {}) => createFakeModel([], { fallback: call => (/People who might fit/.test(call.prompt) ? sought(call) : other(call)) });
const soughtCalls = model => model.calls.filter(call => /People who might fit/.test(call.prompt));
const ASK = 'Is there a healer or a sister around?';
const tailOf = host => (sent(host, TAIL_KEY).at(-1) ?? '').split('\n');
const castLines = host => tailOf(host).filter(line => line.startsWith('[Cast]'));

/** The story so far: the opening reply, then the reader asks; the planner answers after that reply and is used by the next one. */
async function asked(options, text = ASK, reply = 'Nobody answers.') {
    const host = await castHost(options);
    await host.send('Hello.', said('Dawn in Harrow.', OPENING));
    await host.send(text, said(reply));
    await settle();
    return host;
}

test('the words a planner cites must stand in the message as whole words; a made-up phrase, a part of a word or a bare filler is refused', () => {
    assert.equal(citedIn('a healer', ['Is there a healer or a sister around?']), true);
    assert.equal(citedIn('"A HEALER"', ['is there a healer around']), true, 'quotes and case do not matter');
    assert.equal(citedIn('a healer or a sister', ['Is there a healer or a sister around?']), true);
    assert.equal(citedIn('a priest', ['Is there a healer around?']), false, 'made up');
    assert.equal(citedIn('heal', ['Is there a healer around?']), false, 'part of a word');
    assert.equal(citedIn('healers', ['Is there a healer around?']), false);
    assert.equal(citedIn('a', ['a healer']), false, 'too short to mean anything');
    assert.equal(citedIn('a smith', ['the story', 'We need a smith.']), true, 'the story\'s last reply counts too');
    const refs = new Map([['temiwa', 'ersveil:temiwa'], ['other', 'ersveil:other']]);
    const read = text => readCast(text, { refs, allow: { seek: new Set(['ersveil:temiwa']) }, texts: ['I need a healer.', ''] });
    assert.deepEqual(read('? cast temiwa | "a healer"').sought, [{ key: 'ersveil:temiwa', words: 'a healer' }]);
    assert.equal(read('? cast temiwa | "a blacksmith"').sought, undefined, 'words not in the message');
    assert.equal(read('? cast other | "a healer"').sought, undefined, 'a person that was not offered');
    assert.equal(read('? cast ghost | "a healer"').sought, undefined, 'a ref it was not given');
    assert.equal(read('? cast temiwa | "a healer"\n? cast temiwa | "healer"').sought.length, 1, 'once');
});

test('sought at the same place: she comes in as a meeting why "sought", with the reader\'s words, the cue and the card line; the pace is used', async t => {
    quiet(t);
    const model = planner({ sought: () => '? cast temiwa | "a healer or a sister"' });
    const host = await asked({ source: castSource([temiwa('Harrow')]), model });
    try {
        // The planner is told the message, the story's last reply and who might fit (calling and who they are, no more), and answers in its own form.
        assert.equal(soughtCalls(model).length, 1);
        const call = soughtCalls(model)[0];
        assert.match(call.prompt, /- temiwa \| Sister Temiwa \| .*calling: Saintess candidate, healer \| about: /);
        assert.match(call.prompt, /latest message:\nIs there a healer or a sister around\?/);
        assert.match(call.prompt, /last reply:\nNobody answers\./);
        assert.match(call.prompt, /\? cast ref \| "the words that ask for them/);
        assert.doesNotMatch(call.prompt, /Hidden thing|Never said|weathered|drawn to/);
        assert.equal(people(host)['ersveil:temiwa'].met, null, 'not yet: the answer is used by the next reply');
        await host.send('I look around.', said(`Sister Temiwa looks up from the cots. ${host.everyone()}`));
        const person = people(host)['ersveil:temiwa'];
        assert.deepEqual([person.met.why, person.met.reason, person.met.where], ['sought', 'a healer or a sister', 'Harrow']);
        assert.match(castCue(host), /^\[Cast\] Sister Temiwa \(also Temiwa, Last Candle\) comes into the scene in this reply\./);
        assert.match(castCue(host), /Why now: You asked for "a healer or a sister"; they are at Harrow, the place of this scene\./);
        const note = Object.values(slice(host).notes).find(item => item.kind === 'met');
        assert.deepEqual([note.head, note.line], ['Paths crossed: Sister Temiwa', 'Paths crossed: Sister Temiwa — you sought “a healer or a sister”']);
        assert.match(note.rest, /^Why: You sought “a healer or a sister”, and Sister Temiwa is at Harrow\. No roll\./);
        assert.equal(receipts(host, 'cast.rumor').length, 0);
        assert.deepEqual(validatorErrors(host), []);
        assert.deepEqual(host.store.problems(), []);
    } finally {
        host.close();
    }
});

test('sought but the cited words are not in the message or the reply: refused, nobody comes, nothing is told', async t => {
    quiet(t);
    const model = planner({ sought: () => '? cast temiwa | "a mighty priest"' });
    const host = await asked({ source: castSource([temiwa('Kesh')]), model });
    try {
        assert.equal(soughtCalls(model).length, 1);
        await host.send('I look around.', said(`Quiet. ${host.everyone()}`));
        assert.equal(people(host)['ersveil:temiwa'].met, null);
        assert.equal(people(host)['ersveil:temiwa'].rumored, undefined);
        assert.deepEqual(castLines(host), []);
        assert.equal(receipts(host, 'cast.meet').length + receipts(host, 'cast.rumor').length, 0);
    } finally {
        host.close();
    }
});

test('a message that cannot be asking for her kind does not even ask the planner, whatever the story\'s reply says', async t => {
    quiet(t);
    const model = planner({ sought: () => '? cast temiwa | "the road"' });
    const host = await asked({ source: castSource([temiwa('Harrow')]), model }, 'Let us walk down the road.', 'A healer, a sister, a saintess candidate and a candle pass by, tired and cold, behind a long grey veil.');
    try {
        assert.equal(soughtCalls(model).length, 0);
        await host.send('I look around.', said('Quiet.'));
        assert.equal(people(host)['ersveil:temiwa'].met, null);
    } finally {
        host.close();
    }
});

test('sought elsewhere: a rumor, not a meeting; the tail describes her with no name or alias, the card says "Heard of", and it is told once', async t => {
    quiet(t);
    const model = planner({ sought: () => '? cast temiwa | "a healer"' });
    const host = await asked({ source: castSource([temiwa('Kesh')]), model });
    try {
        await host.send('I look around.', said('Harrow is quiet.'));
        const person = people(host)['ersveil:temiwa'];
        assert.equal(person.met, null, 'nobody came');
        assert.deepEqual(person.rumored.map(({ where, at }) => [where, at]), [['Kesh', host.ctx.chat.length - 1]]);
        const lines = castLines(host);
        assert.equal(lines.length, 1);
        assert.match(lines[0], /^\[Cast\] People here know of a saintess candidate, healer, at Watchhouse infirmary by day in Kesh\.$/);
        // Nothing in the whole prompt names her.
        const everything = [...sent(host, 'story_suite_static'), ...sent(host, TAIL_KEY)].join('\n');
        assert.doesNotMatch(everything, /Temiwa|Last Candle/i);
        const note = Object.values(slice(host).notes).find(item => item.kind === 'heard');
        assert.equal(note.head, 'Heard of: a saintess candidate, healer, at Watchhouse infirmary by day in Kesh');
        assert.doesNotMatch(JSON.stringify([note, receipts(host, 'cast.rumor').map(item => item.receipt)]), /Temiwa|Last Candle/i);
        assert.equal(receipts(host, 'cast.meet').length, 0);
        // It is told in that reply only, and not again while she is where she was.
        await host.send('I ask once more for a healer.', said('Nothing.'));
        await settle();
        await host.send('And again.', said('Still nothing.'));
        assert.deepEqual(castLines(host), []);
        assert.equal(receipts(host, 'cast.rumor').length, 1);
        assert.equal(soughtCalls(model).length >= 2, true, 'the planner answered again; code did not tell it twice');
        assert.deepEqual(validatorErrors(host), []);
        assert.deepEqual(host.store.problems(), []);
    } finally {
        host.close();
    }
});

test('a rumor is told again after she moves', async t => {
    quiet(t);
    const model = planner({
        sought: () => '? cast temiwa | "a healer"',
        other: call => (/\ntemiwa\b|- temiwa/.test(call.prompt) ? '~ cast temiwa | Ashford | tending the road dead' : ''),
    });
    const host = await asked({ source: castSource([temiwa('Kesh')]), model });
    try {
        await host.send('I look around.', said('Quiet.'));
        assert.equal(receipts(host, 'cast.rumor').length, 1);
        // A day passes: the cast moves her, then the reader asks again.
        await host.send('Sleep.', said('Morning.', ['~ time June 4, 1200, 08:00 am']));
        await settle();
        await host.send('Where would I find a healer?', said('Nobody says.'));
        await settle();
        await host.send('Hm.', said('Quiet.'));
        assert.equal(people(host)['ersveil:temiwa'].where, 'Ashford');
        assert.equal(receipts(host, 'cast.rumor').length, 2, 'told again, for the new place');
        assert.match(castLines(host).join('\n') || 'none', /none|know of a saintess candidate, healer.*Ashford/);
        assert.deepEqual(people(host)['ersveil:temiwa'].rumored.map(item => item.where), ['Ashford']);
    } finally {
        host.close();
    }
});

test('a live fight: nobody is sought in and no rumor is told', async t => {
    quiet(t);
    for (const place of ['Harrow', 'Kesh']) {
        const model = planner({ sought: () => '? cast temiwa | "a healer"' });
        const host = await asked({ source: castSource([temiwa(place)]), model, queries: { 'combat.session': () => ({ status: 'active', round: 2 }) } });
        try {
            await host.send('I look around.', said(`Blades ring. ${host.everyone()}`));
            assert.equal(soughtCalls(model).length, 1);
            assert.equal(people(host)['ersveil:temiwa'].met, null, `${place}: no meeting`);
            assert.equal(people(host)['ersveil:temiwa'].rumored, undefined, `${place}: no rumor`);
            assert.deepEqual(castLines(host), []);
        } finally {
            host.close();
        }
    }
});

test('the pace: one new face a day; a second sought person waits (and, being here, is no rumor)', async t => {
    quiet(t);
    const second = entry('brandt', {
        name: 'Brandt', about: 'A dour smith.', fields: { Calling: 'Smith, farrier' }, start: { place: 'Harrow', goal: 'Shoe the horses.', routine: 'the forge by day' },
    });
    const first = entry('lena', { name: 'Lena', about: 'A quiet scout.', fields: { Calling: 'Scout' }, start: { place: 'Harrow', goal: 'Watch the road.', routine: 'the road by day' } });
    let answer = '? cast lena | "a scout"';
    const model = planner({ sought: () => answer });
    const host = await castHost({ source: castSource([first, second]), model });
    try {
        await host.send('Hello.', said('Dawn in Harrow.', OPENING));
        await host.send('I need a scout.', said('Nobody.'));
        await settle();
        await host.send('I look around.', said(`Lena nods. ${host.everyone()}`));
        assert.equal(people(host)['ersveil:lena'].met.why, 'sought');
        answer = '? cast brandt | "a smith"';
        await host.send('I also need a smith.', said('Nobody.'));
        await settle();
        await host.send('I look around.', said(`Brandt grunts. ${host.everyone()}`));
        assert.equal(people(host)['ersveil:brandt'].met, null, 'a day allows one new face');
        assert.equal(people(host)['ersveil:brandt'].rumored, undefined, 'he is here: no rumor either');
        assert.equal(Object.values(people(host)).filter(person => person.met).length, 1);
    } finally {
        host.close();
    }
});

test('a reply that does not show the sought person takes the meeting back: unmet, no card line, and a later request may bring her again', async t => {
    quiet(t);
    const model = planner({ sought: () => '? cast temiwa | "a healer or a sister"' });
    const host = await asked({ source: castSource([temiwa('Harrow')]), model });
    try {
        await host.send('I look around.', said('Nobody comes. The cots are empty.'));
        assert.equal(people(host)['ersveil:temiwa'].met, null, 'the reply did not show her');
        assert.equal(Object.values(slice(host).notes).filter(item => item.kind === 'met').length, 0);
        assert.ok(receipts(host, 'cast.withdraw').length >= 1);
        await host.send('Please, a healer or a sister?', said('Quiet.'));
        await settle();
        await host.send('I look around.', said(`Sister Temiwa appears. ${host.everyone()}`));
        assert.equal(people(host)['ersveil:temiwa'].met.why, 'sought');
    } finally {
        host.close();
    }
});

test('a swipe, a Re-read and a rebuild keep the decision (a meeting and a rumor); the planner is not asked again', async t => {
    quiet(t);
    for (const place of ['Harrow', 'Kesh']) {
        const model = planner({ sought: () => '? cast temiwa | "a healer or a sister"' });
        const host = await asked({ source: castSource([temiwa(place)]), model });
        try {
            await host.send('I look around.', said(`Sister Temiwa is here. ${host.everyone()}`));
            const calls = model.calls.length;
            const plain = () => JSON.stringify(people(host), (key, value) => (key === 'rev' ? undefined : value));
            const before = plain();
            const lines = castLines(host);
            assert.equal(lines.length, 1, `${place}: told once`);
            await host.swipe(said(`Another take: Sister Temiwa is here. ${host.everyone()}`));
            assert.equal(model.calls.length, calls, `${place}: the planner is not asked again by a swipe`);
            assert.equal(plain(), before, `${place}: the same world`);
            assert.deepEqual(castLines(host), lines, `${place}: the same line`);
            const afterSwipe = JSON.stringify(host.head());
            assert.equal((await host.sdk.reread(host.ctx.chat.length - 1)).ok, true);
            assert.equal(JSON.stringify(host.head()), afterSwipe, `${place}: a Re-read keeps the steps`);
            host.store.rebuild();
            assert.equal(JSON.stringify(host.head()), afterSwipe, `${place}: a rebuild gives the live state`);
            assert.deepEqual(validatorErrors(host), []);
        } finally {
            host.close();
        }
    }
});

test('deleting the reply that held the decision takes it back: she is unmet and unheard-of again', async t => {
    quiet(t);
    for (const place of ['Harrow', 'Kesh']) {
        const model = planner({ sought: () => '? cast temiwa | "a healer or a sister"' });
        const host = await asked({ source: castSource([temiwa(place)]), model });
        try {
            await host.send('I look around.', said(`Sister Temiwa is here. ${host.everyone()}`));
            assert.equal(Boolean(people(host)['ersveil:temiwa'].met || people(host)['ersveil:temiwa'].rumored), true);
            // The decision is stored on the reply before the one it is for: delete that reply, the reader's message after it and the reply itself.
            for (let n = 0; n < 3; n += 1) await host.st.deleteMessage(host.ctx.chat.length - 1);
            const person = people(host)['ersveil:temiwa'];
            assert.notEqual(person.met?.why, 'sought', `${place}: no longer sought in`);
            assert.equal(person.rumored ?? null, null, `${place}: not rumored`);
            assert.deepEqual(validatorErrors(host), []);
            assert.deepEqual(host.store.problems(), []);
        } finally {
            host.close();
        }
    }
});

test('the rules in code: sought comes after a goal arrival and before a place meeting; never the present or the pinned; a rumor only when nobody was brought in', () => {
    const entries = [
        entry('ana', { start: { place: 'Harrow', goal: 'g', routine: '' } }),
        temiwa('Harrow', { start: { place: 'Harrow', goal: 'g', routine: '' } }),
        entry('di', { start: { place: 'Kesh', goal: 'g', routine: '' }, drawnTo: ['her brother\'s killer'], name: 'Di', fields: { Calling: 'Scout' } }),
    ];
    const cast = castFor(...entries);
    const slice = initialCast();
    applySync(slice, syncPayload(planSync(slice, cast, { now: 7 * DAY })), { now: 7 * DAY, rev: 1 });
    const party = { place: 'Harrow', region: '' };
    const pace = paceOf({ faces: 'day2' });
    const sought = [{ key: 'ersveil:temiwa', words: 'a healer' }];
    const pick = (more = {}) => chooseMeetings(slice, cast, { now: 7 * DAY + 9 * 60, party, pace, sought, ...more }).map(item => `${item.key.split(':')[1]}:${item.why}`);
    assert.deepEqual(pick(), ['temiwa:sought'], 'sought before the place meeting of Ana (one a reply)');
    assert.deepEqual(pick({ comes: [{ key: 'ersveil:di', reason: 'x' }] }), ['di:goal'], 'a goal arrival first');
    assert.deepEqual(pick({ sought: [] }), ['ana:place']);
    assert.deepEqual(pick({ present: new Set(['sister temiwa']) }), ['ana:place'], 'in the scene already');
    assert.deepEqual(pick({ pinned: new Set(['temiwa']) }), ['ana:place'], 'pinned (by an alias)');
    assert.deepEqual(pick({ fight: true }), []);
    // Elsewhere: no meeting, a rumor, once per place.
    const there = { place: 'Kesh', region: '' };
    assert.deepEqual(pick({ party: there }), ['di:place'], 'only Di is at Kesh; Temiwa is not');
    const rumor = chooseRumor(slice, cast, { party: there, sought });
    assert.equal(rumor.key, 'ersveil:temiwa');
    assert.doesNotMatch(rumor.text, /Temiwa|Last Candle/i);
    assert.equal(chooseRumor(slice, cast, { party: there, sought, fight: true }), null);
    assert.equal(chooseRumor(slice, cast, { party: there, sought, met: [{ key: 'ersveil:di' }] }), null, 'one cue a reply');
    assert.equal(chooseRumor(slice, cast, { party: there, sought, present: new Set(['temiwa']) }), null);
    assert.equal(chooseRumor(slice, cast, { party, sought }), null, 'she is here: she comes, she is not talked about');
    assert.equal(chooseRumor(slice, cast, { party: there, sought: [{ key: 'ersveil:ghost', words: 'a healer' }] }), null);
    applyRumor(slice, { at: 4, who: [rumor] }, { now: 7 * DAY, rev: 2 });
    assert.deepEqual(slice.people['ersveil:temiwa'].rumored, [{ on: 7 * DAY, where: 'Harrow', at: 4, rev: 2 }]);
    assert.equal(chooseRumor(slice, cast, { party: there, sought }), null, 'told once');
    slice.people['ersveil:temiwa'].where = 'Ashford';
    assert.equal(chooseRumor(slice, cast, { party: there, sought }).where, 'Ashford', 'told again once she has moved');
    slice.people['ersveil:temiwa'].met = { on: 7 * DAY, where: 'Kesh', why: 'sought', reason: 'x', rev: 3 };
    assert.equal(chooseRumor(slice, cast, { party: there, sought }), null, 'once met she is no rumor');
    slice.people['ersveil:temiwa'].met = null;
    slice.people['ersveil:temiwa'].alive = false;
    assert.equal(chooseRumor(slice, cast, { party: there, sought }), null, 'the dead are not talked about');
    assert.deepEqual(validateCast(slice), []);
});

test('the rumor never carries the name, an alias or a name-like word of the entry; with nothing to say without it there is none', () => {
    const read = more => readEntry({ pack: 'ersveil', packVersion: '1', ...temiwa('Harrow', more) });
    assert.equal(rumorText(read(), { where: 'Kesh' }), 'People here know of a saintess candidate, healer, found in Kesh.');
    assert.equal(rumorText(read(), { where: 'Harrow', home: true }), 'People here know of a saintess candidate, healer, at Watchhouse infirmary by day in Harrow.');
    // A calling that carries a name is left out, and so is an about sentence that does (the next sentence's opening phrase stands in).
    assert.equal(rumorText(read({ fields: { Calling: 'Temiwa the Last Candle' }, about: 'Temiwa is a healer. A sarcastic mender of the frontier: the Flame sister.' }), { where: 'Kesh' }), 'People here know of a sarcastic mender of the frontier, found in Kesh.');
    assert.equal(rumorText(read({ fields: {}, about: 'Sister Temiwa heals.' }), { where: 'Kesh' }), '', 'nothing left to say');
    // No calling: who they are comes from the opening noun phrase of `about` (not the clause after its last colon, not a lone adjective).
    const ysmeth = { name: 'Ysmeth', aliases: [], fields: {}, about: 'A dwelf rune-collar artificer, enslaved when you meet her: the Grey Ledger holds her as collateral on a debt.', start: { place: 'Chainmarket', goal: 'g', routine: 'The Ledger\'s collar forge by day' } };
    assert.equal(rumorText(read(ysmeth), { where: 'Chainmarket' }), 'People here know of a dwelf rune-collar artificer, found in Chainmarket.');
    assert.equal(rumorText(read({ ...ysmeth, about: 'Proud, prickly and hiding behind her hair.' }), { where: 'Chainmarket' }), '', 'adjectives are not a person');
    assert.equal(rumorText(read({ ...ysmeth, fields: { Calling: 'Knife-grinder' }, about: 'An elf freed by the Broken Chain, who grinds knives.' }), { where: 'Chainmarket' }), 'People here know of a Knife-grinder (elf freed by the Broken Chain), found in Chainmarket.');
    assert.equal(rumorText(read(), { where: 'Temiwa Rest' }), 'People here know of a saintess candidate, healer.', 'a place that carries the name is left out');
    assert.equal(rumorText(read({ start: { place: 'Kesh', goal: 'g', routine: 'Temiwa\'s chapel by day' } }), { where: 'Kesh', home: true }), 'People here know of a saintess candidate, healer, found in Kesh.', 'a routine part with the name is left out');
    assert.ok(Array.from(rumorText(read({ fields: { Calling: 'x'.repeat(90) } }), { where: 'Kesh' })).length <= 240);
});

test('the sought step is part of the cast feature: off, nothing is asked or told', async t => {
    quiet(t);
    const model = planner({ sought: () => '? cast temiwa | "a healer or a sister"' });
    const host = await asked({ source: castSource([temiwa('Kesh')]), model, settings: { 'cast.on': false } });
    try {
        await host.send('I look around.', said('Quiet.'));
        assert.equal(model.calls.length, 0);
        assert.deepEqual(castLines(host), []);
    } finally {
        host.close();
    }
});
