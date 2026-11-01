// Key people, item 2 (the narrator): the kinds and their one line each, the paragraph of the fixed prompt (the feature's, the same
// bytes every reply), the tail (one line per away key person, soonest return first, within the token budget, "due back" once a back
// date has passed and nobody moved by it), and the token budget as a setting that the host's module budget follows.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createModule } from '../../../src/v2/module.js';
import { presetValue } from '../../vendor/story-block/src/v2/features.js';
import { makeCalendar, PRESETS } from '../../../src/calendar.js';
import { FEATURE, DEFAULT_TOKENS } from '../../../src/v2/keypeople/domain.js';
import { GRAMMAR, STATIC_TEXT, TAIL_HEADER, awayEntries, awayLine, keyTail, tokensOf } from '../../../src/v2/keypeople/note.js';
import { STATIC_KEY, OPENING, keyHost, keyTail as tailOf, pin, said, sent } from './helpers.js';

const calendar = makeCalendar(PRESETS.gregorian);
const DAY = 1440;
const at = (month, day) => calendar.toAbs({ year: 1200, month: month - 1, day });

const slice = {
    pins: { ren: { name: 'Ren', since: 0, rev: 1 }, odda: { name: 'Odda', since: 0, rev: 1 }, fenna: { name: 'Fenna', since: 0, rev: 1 }, mara: { name: 'Mara', since: 0, rev: 1 } },
    away: {
        ren: { name: 'Ren', doing: 'scouting the north road', since: at(6, 3), back: at(6, 9), steps: [{ date: at(6, 5), text: 'reached Wolfmere Outpost' }], rev: 2 },
        odda: { name: 'Odda', doing: 'at the Seal council in Auvoth', since: at(6, 3), back: at(6, 5), steps: [], rev: 2 },
        fenna: { name: 'Fenna', doing: 'on the river', since: at(6, 4), back: null, steps: [{ date: at(6, 6), text: 'a flood upriver.' }], rev: 2 },
        // Away, but no longer pinned: never told.
        ghost: { name: 'Ghost', doing: 'gone', since: at(6, 1), back: at(6, 2), steps: [], rev: 2 },
    },
    gone: {},
    notes: {},
};

test('the grammar: one line each for away and key; the paragraph names no one and no number', () => {
    assert.match(GRAMMAR.away, /^\+ away Name — what they are doing \| back: date/);
    assert.match(GRAMMAR.away, /! away Name/);
    assert.match(GRAMMAR.away, /- away Name when they are back/);
    assert.equal(GRAMMAR.key, '- key Name | died (a key person who dies)');
    assert.doesNotMatch(STATIC_TEXT, /\d/, 'no counts, dates or numbers in the fixed prompt');
    assert.match(STATIC_TEXT, /- key Name \| died/);
    assert.ok(STATIC_TEXT.length < 600, 'a short paragraph');
});

test('the tail lines: who is away, what they do, when due back, the latest step; the order is the soonest return, then the latest step', () => {
    const now = at(6, 4);
    const entries = awayEntries(slice, now);
    assert.deepEqual(entries.map(entry => entry.name), ['Odda', 'Ren', 'Fenna'], 'soonest return first; no date last; the unpinned never');
    assert.equal(awayLine(entries[1], calendar), 'Ren: away, scouting the north road, back June 9; latest: reached Wolfmere Outpost.');
    assert.equal(awayLine(entries[0], calendar), 'Odda: away, at the Seal council in Auvoth, back June 5.');
    assert.equal(awayLine(entries[2], calendar), 'Fenna: away, on the river; latest: a flood upriver.', 'no back date, a step that already ends in a stop');
    // The same date: the latest step goes first.
    const tie = { pins: slice.pins, away: { ren: { ...slice.away.ren, back: at(6, 9) }, odda: { ...slice.away.odda, back: at(6, 9), steps: [{ date: at(6, 8), text: 'a letter' }] } } };
    assert.deepEqual(awayEntries(tie, now).map(entry => entry.name), ['Odda', 'Ren']);
    // A back date that has passed moves nobody: the line says due back, and the person is still away.
    const later = awayEntries(slice, at(6, 10));
    assert.deepEqual(later.map(entry => [entry.name, entry.due]), [['Odda', true], ['Ren', true], ['Fenna', false]]);
    assert.equal(awayLine(later[1], calendar), 'Ren: away, scouting the north road, due back (June 9); latest: reached Wolfmere Outpost.');
    assert.deepEqual(awayEntries({ pins: {}, away: {} }, now), []);
    assert.deepEqual(awayEntries(undefined, now), []);
});

test('the tail is cut to the token budget: the rest are left out of that reply; the header counts; no budget, nothing is told', () => {
    const now = at(6, 4);
    const all = keyTail(slice, { now, calendar, budget: 300 });
    assert.deepEqual(all.lines.slice(1).map(line => line.split(':')[0]), ['Odda', 'Ren', 'Fenna']);
    assert.equal(all.lines[0], TAIL_HEADER);
    assert.equal(all.left, 0);
    assert.equal(all.tokens, Math.ceil(all.lines.join('\n').length / 4));
    // Room for the header and the first line only: the others are left out (still tracked).
    const first = Math.ceil([TAIL_HEADER, all.lines[1]].join('\n').length / 4);
    const two = keyTail(slice, { now, calendar, budget: first });
    assert.deepEqual(two.lines.slice(1).map(line => line.split(':')[0]), ['Odda']);
    assert.equal(two.left, 2);
    assert.ok(two.tokens <= first);
    // Not even one fits (or the budget is 0): no header either.
    assert.deepEqual(keyTail(slice, { now, calendar, budget: 5 }), { lines: [], tokens: 0, left: 3 });
    assert.deepEqual(keyTail(slice, { now, calendar, budget: 0 }).lines, []);
    // A budget with no upper limit.
    assert.equal(keyTail(slice, { now, calendar, budget: 100000 }).lines.length, 4);
    assert.deepEqual([tokensOf({}), tokensOf({ tokens: 50 }), tokensOf({ tokens: 99999 }), tokensOf({ tokens: -1 }), tokensOf({ tokens: 'x' }), tokensOf({ tokens: 0 })], [DEFAULT_TOKENS, 50, 99999, DEFAULT_TOKENS, DEFAULT_TOKENS, 0]);
});

test('on the host: the tail tells each away key person once a reply, and nobody who is back, not pinned or unpinned', async () => {
    const host = await keyHost();
    try {
        await host.send('Hello.', said('Dawn.', OPENING));
        await host.send('Quiet.', 'Nothing.');
        assert.equal(tailOf(host), '', 'nobody away: nothing is told');
        await pin(host, 'Ren');
        await pin(host, 'Odda');
        await host.send('Go.', said('They leave.', ['+ away Ren — scouting the north road | back: June 9, 1200', '+ away Odda — at the council | back: June 5, 1200']));
        await host.send('News.', said('A rider.', ['! away Ren — reached Wolfmere Outpost']));
        assert.equal(tailOf(host), [TAIL_HEADER, 'Odda: away, at the council, back June 5.', 'Ren: away, scouting the north road, back June 9.'].join('\n'));
        await host.send('Next.', 'Quiet again.');
        assert.equal(tailOf(host), [TAIL_HEADER, 'Odda: away, at the council, back June 5.', 'Ren: away, scouting the north road, back June 9; latest: reached Wolfmere Outpost.'].join('\n'));
        // Past the back date: due back, still away; nobody is moved by the date.
        await host.send('Days.', said('Days pass.', ['! time +3d']));
        await host.send('Next.', 'Quiet.');
        assert.equal(tailOf(host), [TAIL_HEADER, 'Odda: away, at the council, due back (June 5).', 'Ren: away, scouting the north road, back June 9; latest: reached Wolfmere Outpost.'].join('\n'));
        assert.deepEqual(Object.keys(host.head().domains.keypeople.away).sort(), ['odda', 'ren']);
        // Odda returns; Ren is unpinned: neither is told.
        await host.send('Home.', said('Odda arrives.', ['- away Odda']));
        await host.sdk.command('keypeople.unpin', { name: 'Ren' });
        await host.send('Next.', 'Quiet.');
        assert.equal(tailOf(host), '');
    } finally {
        host.close();
    }
});

test('the prompt: the paragraph is there while the feature is on, the same bytes every reply whatever the state, and off it is gone', async () => {
    const host = await keyHost();
    try {
        await host.send('Hello.', said('Dawn.', OPENING));
        await host.send('Go.', 'On.');
        await pin(host, 'Ren');
        await host.send('Go.', said('Ren leaves.', ['+ away Ren — scouting | back: June 9, 1200']));
        await host.send('Go.', said('A step.', ['! away Ren — reached the ridge']));
        const statics = sent(host, STATIC_KEY);
        assert.ok(statics.length >= 4);
        assert.equal(new Set(statics).size, 1, 'byte-identical reply to reply, with key people pinned, away and moving');
        const paragraph = host.sdk.substitute(STATIC_TEXT);
        assert.ok(statics[0].includes(paragraph));
        for (const line of Object.values(GRAMMAR)) assert.ok(statics[0].includes(line), line);
        host.features.set(FEATURE, false);
        await host.send('Go.', 'Off.');
        await host.send('Go.', 'Off still.');
        const off = sent(host, STATIC_KEY).slice(-2);
        assert.equal(off[0], off[1]);
        assert.ok(!off[0].includes(paragraph));
        for (const line of Object.values(GRAMMAR)) assert.ok(!off[0].includes(line), `${line} is gone`);
        assert.equal(tailOf(host), '', 'off: nothing in the tail either');
        assert.equal(off[0], statics[0].replace(`${paragraph}\n`, '').split('\n').filter(line => !Object.values(GRAMMAR).includes(line)).join('\n'));
    } finally {
        host.close();
    }
});

test('Lean keeps it: no preset speaks for the feature; it is its own switch, not the world-building threads\'', () => {
    const feature = createModule().features.find(entry => entry.id === FEATURE);
    for (const preset of ['lean', 'standard', 'full']) assert.equal(presetValue(feature, preset), true, preset);
    assert.equal(feature.presets, undefined);
});

test('the token budget is a setting without an upper limit, and the host\'s module budget follows it', () => {
    const def = createModule();
    const schema = def.settings.schema;
    assert.deepEqual([schema['keypeople.cap'].label, schema['keypeople.tokens'].label], ['How many key people', 'Narrator budget for key people (tokens)']);
    assert.equal(schema['keypeople.cap'].min, 0);
    assert.equal(schema['keypeople.tokens'].max, undefined, 'no upper limit');
    assert.equal(schema['keypeople.tokens'].feature, FEATURE);
    assert.deepEqual([def.settings.defaults['keypeople.cap'], def.settings.defaults['keypeople.tokens']], [10, 300]);
    assert.match(schema['keypeople.cap'].help, /in Lean too/);
    assert.match(schema['keypeople.tokens'].help, /No upper limit/);
    // The module's budget is the fixed ones and the setting.
    let stored = {};
    const own = createModule({ host: { settings: () => stored } });
    const base = own.context.budget;
    stored = { 'keypeople.tokens': 800 };
    assert.equal(own.context.budget, base + 500);
    stored = { 'keypeople.tokens': 0 };
    assert.equal(own.context.budget, base - 300);
    stored = { 'keypeople.tokens': 'x' };
    assert.equal(own.context.budget, base, 'a setting that is no number is the default');
});

test('on the host: a smaller budget tells fewer away people, a larger one is not cut by the module', async () => {
    const people = ['Ren', 'Odda', 'Fenna', 'Brom'];
    const run = async settings => {
        const host = await keyHost({ settings });
        try {
            await host.send('Hello.', said('Dawn.', OPENING));
            for (const name of people) await pin(host, name);
            await host.send('Go.', said('They leave.', people.map((name, i) => `+ away ${name} — doing something that takes a while on the road number ${i} | back: June ${9 + i}, 1200`)));
            await host.send('Next.', 'Quiet.');
            const budget = host.registry.contexts().find(entry => entry.moduleId === 'story-director').budget;
            const lines = tailOf(host).split('\n');
            return { told: lines.slice(1).map(line => line.split(':')[0]), budget, lines };
        } finally {
            host.close();
        }
    };
    const all = await run({});
    assert.deepEqual(all.told, people, 'the default 300 tokens tell all four');
    const room = Math.ceil(all.lines.slice(0, 3).join('\n').length / 4);
    assert.deepEqual((await run({ 'keypeople.tokens': room })).told, ['Ren', 'Odda'], 'the header and two lines fit exactly');
    assert.deepEqual((await run({ 'keypeople.tokens': room - 1 })).told, ['Ren'], 'one token less and the second is left out');
    assert.deepEqual((await run({ 'keypeople.tokens': 0 })).told, []);
    const wide = await run({ 'keypeople.tokens': 900 });
    const normal = await run({});
    assert.equal(wide.budget - normal.budget, 600, 'the host reads the module budget from the setting');
    assert.deepEqual(wide.told, people);
});
