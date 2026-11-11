// What the narrator is sent, and the cast on its own: with no cast in any pack the prompt is byte for byte what it was; the cast adds
// no fixed text and no change-line kind; the one cue is a meeting's, in its reply; Lean keeps the feature; the cast works without a model
// (people meet by place) and without NPC State Delta.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createModule, PARTS } from '../../../src/v2/module.js';
import { presetValue } from '../../vendor/story-block/src/v2/features.js';
import { cueOf, tail, meetingFresh } from '../../../src/v2/cast/note.js';
import { FEATURE } from '../../../src/v2/cast/domain.js';
import { TAIL_BUDGET } from '../../../src/v2/cast/settings.js';
import { OPENING, STATIC_KEY, TAIL_KEY, castCue, castHost, castSource, entry, people, receipts, said, sent, settle, syncCast } from './helpers.js';

const quiet = t => t.mock.method(console, 'warn', () => {});

test('with no cast in the packs the prompt is byte for byte what it was without the cast part: the same fixed text and tail over a chat with time jumps; no step, no state', async t => {
    quiet(t);
    const without = createModule({ parts: PARTS.filter(([id]) => id !== 'cast') });
    const chat = [['Hello.', said('Dawn.', OPENING)], ['Look.', said('Smoke.')], ['Sleep.', said('Morning.', ['~ time June 5, 1200, 08:00 am'])], ['On.', said('Road.', ['~ place Kesh | kind: town', '! time +3h'])], ['Again.', said('Quiet.')]];
    const run = async (modules, { cast = true } = {}) => {
        const host = cast ? await castHost({ source: castSource([]) }) : await (await import('../../vendor/story-block/testkit/index.js')).createHost({ modules, settings: { features: { 'story-director.pulse': false } } });
        try {
            for (const [text, reply] of chat) await host.send(text, reply);
            return { statics: sent(host, STATIC_KEY), tails: sent(host, TAIL_KEY), steps: host.sdk.receipts().filter(item => item.receipt.type.startsWith('cast.')).length, head: host.head() };
        } finally {
            host.close();
        }
    };
    const plain = await run([without], { cast: false });
    const living = await run([], { cast: true });
    assert.deepEqual(living.statics, plain.statics, 'the fixed text');
    assert.deepEqual(living.tails, plain.tails, 'the tail');
    assert.equal(living.steps, 0);
    assert.deepEqual(living.head.domains.cast, { people: {}, notes: {}, day: null, meeting: null }, 'nothing is kept');
});

test('the cast adds no fixed text and no change-line kind; the module\'s tail budget gains the cue\'s', () => {
    const def = createModule();
    const base = createModule({ parts: PARTS.filter(([id]) => id !== 'cast') });
    assert.deepEqual(Object.keys(def.capture.kinds), Object.keys(base.capture.kinds), 'the narrator writes no cast lines');
    assert.equal(def.context.static(), base.context.static());
    assert.equal(def.context.budget, base.context.budget + TAIL_BUDGET);
    assert.deepEqual((def.context.parts ?? []).map(part => part.feature), (base.context.parts ?? []).map(part => part.feature));
    assert.ok(def.hooks.beforeGenerate.timeoutMs >= 15000, 'the hook is given time to wait for the planner');
});

test('Lean keeps it: no preset speaks for the feature; it is its own switch', () => {
    const feature = createModule().features.find(entry_ => entry_.id === FEATURE);
    for (const preset of ['lean', 'standard', 'full']) assert.equal(presetValue(feature, preset), true, preset);
    assert.equal(feature.presets, undefined);
    assert.equal(feature.default, true);
    assert.equal(feature.label, 'The cast');
});

test('the cue: who they are and why now, from the pack entry; cut to the budget; only the reply they come in (and its swipes), only for the met, and not at all when off', () => {
    const raw = entry('fenna', { aliases: ['the ferrywoman'], about: 'A'.repeat(500), look: 'tall', voice: 'dry', personality: 'wary', start: { place: 'Docks', goal: 'keep the ferry', routine: 'works the night ferry' } });
    const person = { name: 'Fenna', aliases: ['the ferrywoman'], where: 'Docks', doing: 'works the night ferry', met: { why: 'place', where: 'Docks', reason: '' } };
    const cue = cueOf(person, { raw, goal: 'keep the ferry' });
    assert.match(cue, /^Fenna \(also the ferrywoman\) comes into the scene in this reply\. It is their first meeting with \{\{user\}\}\. Who: A+… Look: tall\. Voice: dry\. Manner: wary\. Wants: keep the ferry\. Why now: Works the night ferry, they are at Docks, the place of this scene\. Bring them in naturally; do not treat them as known to \{\{user\}\} yet\.$/);
    assert.ok(!cue.includes('Hidden thing'), 'a secret is never in the cue');
    const slot = [{ at: 6, keys: ['ersveil:fenna'], rev: 3 }];
    assert.deepEqual([meetingFresh(slot, 6), meetingFresh(slot, 7), meetingFresh(slot, 8), meetingFresh(slot, 5), meetingFresh(null, 6), meetingFresh(slot, null)], [true, true, false, false, false, false]);
    const view = (more = {}) => ({
        state: { domains: { cast: { people: { 'ersveil:fenna': { ...person, met: { on: 1, ...person.met } }, 'ersveil:sera': { name: 'Sera', met: null } }, notes: {}, day: null, meeting: slot } } },
        chat: { length: 6 }, feature: () => true, settings: () => ({}), query: name => (name === 'packs.content' ? [raw] : null), ...more,
    });
    const lines = tail(view()).lines;
    assert.equal(lines.length, 1);
    assert.ok(lines[0].startsWith('[Cast] Fenna (also the ferrywoman) comes into the scene'));
    assert.ok(Array.from(lines[0]).length <= TAIL_BUDGET * 4, 'within the cue\'s budget');
    assert.deepEqual(tail(view({ chat: { length: 9 } })).lines, [], 'a later reply is told nothing');
    assert.deepEqual(tail(view({ feature: () => false })).lines, [], 'off');
    assert.deepEqual(tail(view({ settings: () => ({ on: false }) })).lines, []);
    assert.deepEqual(tail({ state: { domains: {} }, chat: { length: 6 } }).lines, [], 'an older chat');
    assert.doesNotMatch(lines.join('\n'), /Sera/);
});

test('without a model the world still meets by place and nobody moves; a Continue commits nothing; without NPC State Delta nothing is missed', async t => {
    quiet(t);
    // A host whose Story Block has no model call: the module is built without one.
    let host = null;
    const module = createModule({ host: { settings: id => host?.sdk.settings(id) ?? null, substitute: text => host?.sdk.substitute(text) } });
    const { createHost } = await import('../../vendor/story-block/testkit/index.js');
    host = await createHost({ modules: [module] });
    const source = castSource([entry('brom', { start: { place: 'Harrow', goal: 'forge', routine: '' } }), entry('fenna', { start: { place: 'Kesh', goal: 'x', routine: '' } })]);
    await syncCast(host, source);
    try {
        await host.send('Hello.', said('Dawn.', OPENING));
        await host.send('Look.', said(`Smoke. Brom, Fenna`));
        assert.equal(people(host)['ersveil:brom'].met.why, 'place');
        await host.send('Sleep.', said('Morning.', ['~ time June 4, 1200, 08:00 am']));
        await host.send('Look.', said(`Smoke. Brom, Fenna`));
        assert.equal(people(host)['ersveil:fenna'].where, 'Kesh', 'no planner: no one moved');
        assert.equal(receipts(host, 'cast.advance').length, 0, 'and no step says they did');
        // A Continue (the same reply goes on) commits no step of its own.
        const steps = host.sdk.receipts().filter(item => item.receipt.type.startsWith('cast.')).length;
        await host.cont(said(' And on.'));
        assert.equal(host.sdk.receipts().filter(item => item.receipt.type.startsWith('cast.')).length, steps);
        assert.equal(castCue(host).includes('Fenna'), false);
    } finally {
        host.close();
    }
});

// ---- the cue with real-length entries ------------------------------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { castOf } from '../../../src/v2/cast/entries.js';
import { whyNarrator } from '../../../src/v2/cast/apply.js';

const REAL = JSON.parse(readFileSync(new URL('../../fixtures/ersveil-cast.json', import.meta.url), 'utf8')).map(item => ({ pack: 'ersveil', packVersion: '2.2.1', ...item }));
const CLOSING = 'Bring them in naturally; do not treat them as known to {{user}} yet.';

test('the cue keeps why now and how to bring them in whole for every real-length entry, a goal meeting and a place meeting alike; the descriptive fields give way', () => {
    const cast = castOf((name, args) => (name === 'packs.content' ? (args?.kind === 'cast' ? structuredClone(REAL) : []) : null));
    assert.equal(cast.entries.length, 12);
    const room = TAIL_BUDGET * 4 - 8 - '[Cast] '.length;
    let longest = 0;
    for (const entry_ of cast.entries) {
        for (const met of [
            { why: 'goal', where: 'Bluewatch Village', reason: 'Someone is asking about Master Somner and the questions reached them on the road, so they came to find out who.' },
            { why: 'place', where: entry_.place, reason: '' },
        ]) {
            const person = { name: entry_.name, aliases: entry_.aliases, where: entry_.place, doing: 'Dawn to noon at the inspection quay', met };
            const cue = cueOf(person, entry_);
            longest = Math.max(longest, Array.from(cue).length);
            assert.ok(Array.from(cue).length <= room, `${entry_.name}: ${Array.from(cue).length} characters`);
            assert.ok(cue.includes(`Why now: ${whyNarrator(person)}`), `${entry_.name} (${met.why}): the reason is whole`);
            assert.ok(cue.endsWith(CLOSING), `${entry_.name}: the closing sentence is last and whole`);
            assert.match(cue, /^[^.]+ comes into the scene in this reply\. It is their first meeting with \{\{user\}\}\./);
        }
    }
    assert.ok(longest > room * 0.8, 'the real entries do fill the cue');
});

test('on the host: Siebert comes by his goal with the story\'s reason, Tansy by place; the narrator\'s line holds each reason and the closing sentence', async t => {
    quiet(t);
    const { createFakeModel } = await import('./helpers.js');
    const pick = ids => REAL.filter(item => ids.includes(item.id)).map(({ pack: _pack, packVersion: _version, ...own }) => own);
    const host = await castHost({
        source: castSource(pick(['siebert-maas', 'tansy-millrace'])),
        settings: { 'cast.faces': 'day2' },
        model: createFakeModel(['> cast siebert-maas | someone is asking about Master Somner at the inn and the news reached him on the north road']),
    });
    try {
        await host.send('Hello.', said('Day.', ['~ time June 3, 1200, 06:30 pm', '~ place Bluewatch Village | kind: settlement']));
        await host.send('Look.', said('Dusk.', []));
        // Tansy first (her routine has her at the quay after dusk), by place.
        const tansy = castCue(host);
        assert.match(tansy, /^\[Cast\] Tansy Millrace/);
        assert.match(tansy, /Why now: They are at Bluewatch Village, the place of this scene\. Bring them in naturally; do not treat them as known to You yet\.$/);
        await host.send('Next day.', said('Morning, and talk of someone asking about Master Somner.', ['~ time June 4, 1200, 08:00 am']));
        await settle();
        await host.send('Look.', said(`Smoke. ${host.everyone()}`));
        const cue = castCue(host);
        assert.match(cue, /^\[Cast\] Siebert Maas/);
        assert.match(cue, /Why now: Someone is asking about Master Somner at the inn and the news reached him on the north road\. Their own goal brings them to You\./);
        assert.ok(cue.endsWith(CLOSING.replace('{{user}}', 'You')));
        assert.ok(Array.from(cue).length <= TAIL_BUDGET * 4 - 8);
        // Where he is: with the party, not at his start.
        assert.equal(people(host)['ersveil:siebert-maas'].where, 'Bluewatch Village');
        assert.equal(people(host)['ersveil:siebert-maas'].met.where, 'Bluewatch Village');
        assert.equal(host.sdk.query('director.cast').find(person => person.id === 'siebert-maas').where, 'Bluewatch Village');
    } finally {
        host.close();
    }
});
