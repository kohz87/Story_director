// The meeting cue and the rumor are pinned lines (`{ text, keep: true }` from beforeGenerate): a tail over Story Block's budget keeps them,
// where the cast's own tail lines used to be the first cut. Each generation type; never twice; replay == live.
import test from 'node:test';
import assert from 'node:assert/strict';

import { OPENING, castHost, castSource, createFakeModel, entry, people, receipts, said, sent, settle, validatorErrors, TAIL_KEY } from './helpers.js';

const quiet = t => t.mock.method(console, 'warn', () => {});
const castLinesOf = host => (sent(host, TAIL_KEY).at(-1) ?? '').split('\n').filter(line => line.startsWith('[Cast]'));
const BROM = entry('brom', { start: { place: 'Harrow', goal: 'forge', routine: '' } });
const TEMIWA = entry('temiwa', {
    name: 'Sister Temiwa', aliases: ['Temiwa'], about: 'A fox-eared saintess candidate cast out to the frontier: its sarcastic healer.', fields: { Calling: 'Saintess candidate, healer' },
    start: { place: 'Kesh', goal: 'Serve.', routine: 'Watchhouse infirmary by day' },
});

test('a tail far over its budget still carries the meeting cue (once), for a send; the plain scene lines are what goes', async t => {
    quiet(t);
    const host = await castHost({ source: castSource([BROM]), hostSettings: { tailBudget: 20 } });
    try {
        await host.send('Hello.', said('Dawn in Harrow.', OPENING));
        await host.send('Look.', said(`Smoke. ${host.everyone()}`));
        assert.equal(people(host)['ersveil:brom'].met.why, 'place');
        const lines = castLinesOf(host);
        assert.equal(lines.length, 1, 'once');
        assert.match(lines[0], /^\[Cast\] Brom comes into the scene in this reply\./);
        assert.equal((sent(host, TAIL_KEY).at(-1) ?? '').split('[Cast] Brom comes').length - 1, 1, 'never twice in the prompt');
        assert.deepEqual(validatorErrors(host), []);
    } finally {
        host.close();
    }
});

test('the rumor line survives the same pressure', async t => {
    quiet(t);
    const model = createFakeModel([], { fallback: call => (/People who might fit/.test(call.prompt) ? '? cast temiwa | "a healer"' : '') });
    const host = await castHost({ source: castSource([TEMIWA]), model, hostSettings: { tailBudget: 20 } });
    try {
        await host.send('Hello.', said('Dawn in Harrow.', OPENING));
        await host.send('Is there a healer around?', said('Nobody answers.'));
        await settle();
        await host.send('I look around.', said('Harrow is quiet.'));
        const lines = castLinesOf(host);
        assert.equal(lines.length, 1);
        assert.match(lines[0], /^\[Cast\] People here know of a saintess candidate, healer/);
        assert.doesNotMatch(lines[0], /Temiwa/);
    } finally {
        host.close();
    }
});

test('a swipe and a regenerate are told the same cue again; a Continue is told it too (no new step); a quiet generation is told nothing', async t => {
    quiet(t);
    const host = await castHost({ source: castSource([BROM]), hostSettings: { tailBudget: 20 } });
    try {
        await host.send('Hello.', said('Dawn in Harrow.', OPENING));
        await host.send('Look.', said(`Smoke. ${host.everyone()}`));
        const cue = castLinesOf(host);
        assert.equal(cue.length, 1);
        await host.swipe(said(`Another take. ${host.everyone()}`));
        assert.deepEqual(castLinesOf(host), cue, 'a swipe keeps who you meet: the cue is there again');
        await host.regenerate(said(`Once more. ${host.everyone()}`));
        assert.deepEqual(castLinesOf(host), cue, 'a regenerate too');
        const steps = host.sdk.receipts().filter(item => item.receipt.type.startsWith('cast.')).length;
        await host.cont(said(' And on.'));
        assert.deepEqual(castLinesOf(host), cue, 'a Continue is the same reply: told again, once');
        assert.equal(host.sdk.receipts().filter(item => item.receipt.type.startsWith('cast.')).length, steps, 'and commits no step');
        const before = sent(host, TAIL_KEY).length;
        await host.quiet('x');
        assert.deepEqual(sent(host, TAIL_KEY).slice(before).flatMap(text => text.split('\n')).filter(line => line.startsWith('[Cast]')), [], 'a quiet generation gets no cue');
        // Replay == live.
        const live = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live);
        assert.deepEqual(validatorErrors(host), []);
    } finally {
        host.close();
    }
});

test('with the cast off nothing is pinned or told', async t => {
    quiet(t);
    const host = await castHost({ source: castSource([BROM]), settings: { 'cast.on': false } });
    try {
        await host.send('Hello.', said('Dawn in Harrow.', OPENING));
        await host.send('Look.', said(`Smoke. ${host.everyone()}`));
        assert.deepEqual(castLinesOf(host), []);
        assert.equal(receipts(host, 'cast.meet').length, 0);
    } finally {
        host.close();
    }
});
