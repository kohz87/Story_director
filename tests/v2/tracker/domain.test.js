// The `director` domain: initial state, the validator's every rejection, the queries, and the
// part's shape as MODULES §A asks.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { part } from '../../../src/v2/tracker/index.js';
import { makeState, readLine, runCommand, story } from './helpers/fake-ctx.js';

const validate = director => part.domains.director.validate(director, {});

test('the part has the shape MODULES §A names', () => {
    assert.deepEqual(Object.keys(part).sort(), ['commands', 'context', 'domains', 'hooks', 'kinds', 'queries', 'settings', 'tabs']);
    assert.deepEqual(Object.keys(part.domains), ['director']);
    assert.deepEqual(Object.keys(part.queries), ['director.time', 'director.calendar', 'director.threads', 'director.thread']);
    assert.deepEqual(Object.keys(part.commands), ['director.seed']);
    assert.deepEqual(Object.keys(part.hooks), ['beforeGenerate']);
    // The Director screen is the screens part's `story-director/director`.
    assert.deepEqual(part.tabs, []);
    assert.equal(typeof part.context.static, 'function');
    assert.equal(typeof part.context.tail, 'function');
});

test('initial: an empty director, plain JSON, valid; each call a fresh copy', () => {
    const director = part.domains.director.initial();
    assert.deepEqual(director, { time: { minutes: null }, threads: {}, keys: {}, problems: [], turn: { n: 0, reply: null, index: -1, from: null, quests: [], lone: null } });
    assert.deepEqual(JSON.parse(JSON.stringify(director)), director);
    assert.deepEqual(validate(director), []);
    director.threads.x = 1;
    assert.deepEqual(part.domains.director.initial().threads, {});
});

const SAMPLE = story([{ lines: '+ quest Wolf Hunt — Kill ridge wolves | giver: Danique | reward: 4 silver\n+ hook River stranger — who', said: 'I take the wolf hunt.' }, { lines: '- hook River stranger — gone' }]);

test('the validator accepts what capture writes and rejects every malformed part', () => {
    const good = SAMPLE.domains.director;
    assert.deepEqual(validate(good), []);
    const [wolf, river] = Object.keys(good.threads);
    const broken = change => {
        const director = structuredClone(good);
        change(director);
        return validate(director);
    };
    const cases = [
        [d => { d.time.minutes = 1.5; }, /time\.minutes/],
        [d => { d.time = null; }, /time\.minutes/],
        [d => { d.threads = []; }, /threads is not an object/],
        [d => { d.threads[wolf].kind = 'arc'; }, /unknown kind/],
        [d => { d.threads[wolf].key = '  '; }, /has no key/],
        [d => { d.threads[wolf].id = 'th_other000'; }, /bad id/],
        [d => { d.threads[wolf].summary = 3; }, /summary/],
        [d => { d.threads[wolf].fields.giver = 4; }, /fields must hold text/],
        [d => { d.threads[wolf].status = 'superseded'; }, /status/],
        [d => { d.threads[wolf].offer = 'no'; }, /offer/],
        [d => { d.threads[wolf].taken = { rev: 'x' }; }, /taken/],
        [d => { d.threads[river].ended = { rev: 2, reason: '', outcome: 'won' }; }, /ended must/],
        [d => { d.threads[river].ended = null; }, /resolved but ended is empty/],
        [d => { d.threads[wolf].target = { noun: 'wolf', count: -1, kind: 'foes' }; }, /target/],
        [d => { d.threads[wolf].reward = { amount: 2.5, each: false, unit: '', text: '' }; }, /reward/],
        [d => { d.threads[wolf].rev = -1; }, /rev/],
        [d => { d.threads[wolf].track = []; }, /track/],
        [d => { d.keys.ghost = 'th_nothing0'; }, /points at no thread/],
        [d => { delete d.keys['wolf hunt']; }, /missing from director\.keys/],
        [d => { d.problems = Array.from({ length: 101 }, () => ({ rev: 1, kind: 'x', text: 'y' })); }, /at most 100/],
        [d => { d.problems = [{ kind: 'x', text: 'y' }]; }, /rev, kind and text/],
        [d => { d.turn = { n: -1 }; }, /turn is malformed/],
    ];
    for (const [change, message] of cases) {
        const errors = broken(change);
        assert.ok(errors.some(error => message.test(error)), `${message}: ${errors.join(' | ')}`);
    }
    assert.deepEqual(validate(null), ['director is not an object.']);
});

test('a handler that writes another module\'s domain is refused and nothing is saved', () => {
    const run = runCommand(SAMPLE, (ctx, line) => {
        part.kinds.hook.apply(ctx, line);
        ctx.draft('inventory');
    }, readLine('+ hook Ferry — a ferryman'));
    assert.equal(run.ok, false);
    assert.equal(run.code, 'NOT_OWNER');
    assert.equal(run.state, SAMPLE);
});

test('queries: time, threads by kind, status and offer, one thread by key, alias or id; plain copies', () => {
    const state = story([{ lines: '+ quest Ferry Run — row it | giver: Ola', said: 'Hm.' }, { lines: '~ hook Wolf Hunts | step: tracking' }], SAMPLE);
    const threads = args => part.queries['director.threads'](state, args).map(thread => thread.key);
    assert.deepEqual(threads(), ['Wolf Hunt', 'River stranger', 'Ferry Run']);
    assert.deepEqual(threads({ kind: 'quest' }), ['Wolf Hunt', 'Ferry Run']);
    assert.deepEqual(threads({ status: 'resolved' }), ['River stranger']);
    assert.deepEqual(threads({ kind: 'quest', offer: true }), ['Ferry Run']);
    assert.deepEqual(threads({ kind: 'quest', status: 'active', offer: false }), ['Wolf Hunt']);
    const wolf = part.queries['director.thread'](state, { key: 'wolf hunt' });
    assert.equal(wolf.fields.step, 'tracking');
    assert.equal(part.queries['director.thread'](state, { key: 'Wolf Hunts' }).id, wolf.id, 'by a name it was reached by');
    assert.equal(part.queries['director.thread'](state, { id: wolf.id }).key, 'Wolf Hunt');
    assert.equal(part.queries['director.thread'](state, { key: 'nobody' }), null);
    assert.equal(wolf.track, undefined, 'bookkeeping stays inside');
    wolf.fields.step = 'changed';
    assert.equal(state.domains.director.threads[wolf.id].fields.step, 'tracking');
    assert.deepEqual(part.queries['director.time'](makeState()), { minutes: null, text: '' });
    assert.deepEqual(part.queries['director.threads'](makeState(), { kind: 'quest' }), []);
});
