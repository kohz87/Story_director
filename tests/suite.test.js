// Tests for src/suite.js, the Story Suite handshake shared with Story Block, NPC State Delta
// and RPG Battle: the registry on globalThis (announce, owners, offering, withdraw, listeners,
// taking over an older registry) and isSourceOfTruth for the reader's three choices.
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import { AREAS, SUITE_VERSION, isSourceOfTruth, storySuite } from '../src/suite.js';

// Every test starts with no registry, as on a fresh page.
beforeEach(() => {
    delete globalThis.StorySuite;
});

const director = (more = {}) => ({ id: 'story-director', name: 'Story Director', version: '0.8.0', owns: ['calendar', 'timeline', 'npc'], ...more });
const delta = (more = {}) => ({ id: 'npc-state-delta', name: 'NPC State Delta', version: '1.0.0', owns: ['scene', 'npc', 'calendar', 'stats'], ...more });
const block = (more = {}) => ({ id: 'story-block', name: 'Story Block', version: '0.7.0', owns: ['scene', 'timeline', 'items'], ...more });

test('the first call creates the registry on globalThis; later calls join it', () => {
    assert.equal(globalThis.StorySuite, undefined);
    const suite = storySuite();
    assert.equal(globalThis.StorySuite, suite);
    assert.equal(storySuite(), suite);
    assert.equal(suite.version, SUITE_VERSION);
    assert.equal(suite.areas, AREAS);
    assert.deepEqual(AREAS.npc, ['npc-state-delta', 'story-director']);
    assert.deepEqual(AREAS.calendar, ['story-director', 'npc-state-delta']);
    assert.deepEqual(AREAS.timeline, ['story-director', 'story-block']);
    assert.ok(Object.isFrozen(suite) && Object.isFrozen(AREAS));
    assert.deepEqual(suite.providers(), []);
});

test('announce: stored with its id trimmed, owns as unique strings, enabled unless false', () => {
    const suite = storySuite();
    const api = { calendar: () => ({ era: '', months: [] }) };
    suite.announce({ ...director({ id: ' story-director ', owns: ['calendar', 'calendar', 'npc'] }), api });
    assert.deepEqual(suite.providers(), [{ id: 'story-director', name: 'Story Director', version: '0.8.0', owns: ['calendar', 'npc'], enabled: true, api }]);
    assert.equal(suite.has('story-director'), true);
    assert.equal(suite.api('story-director'), api);
    assert.equal(suite.api('nobody'), null);
    assert.equal(suite.has('nobody'), false);

    // A second announcement replaces the first.
    suite.announce(director({ owns: ['timeline'] }));
    assert.equal(suite.providers().length, 1);
    assert.deepEqual(suite.providers()[0].owns, ['timeline']);
    assert.equal(suite.api('story-director'), null, 'no api shared this time');

    // No id, no announcement.
    suite.announce({ name: 'Nameless', owns: ['npc'] });
    suite.announce(null);
    assert.equal(suite.providers().length, 1);

    // providers() hands out copies.
    suite.providers()[0].owns.push('npc');
    assert.deepEqual(suite.providers()[0].owns, ['timeline']);
});

test('owner: the first in AREAS order that offers the area, whatever the load order', () => {
    for (const order of [[director, delta, block], [block, delta, director]]) {
        delete globalThis.StorySuite;
        const suite = storySuite();
        for (const provider of order) suite.announce(provider());
        assert.equal(suite.owner('npc'), 'npc-state-delta');
        assert.equal(suite.owner('calendar'), 'story-director');
        assert.equal(suite.owner('timeline'), 'story-director');
        assert.equal(suite.owner('scene'), 'story-block');
        assert.equal(suite.owner('rolls'), null, 'nobody offers it');
    }
});

test('owner falls back down the list, then to anyone offering it', () => {
    const suite = storySuite();
    suite.announce(director());
    assert.equal(suite.owner('npc'), 'story-director', 'the next in line while NPC State Delta is away');
    suite.announce(delta());
    assert.equal(suite.owner('npc'), 'npc-state-delta');

    // An extension the table does not list owns an area only when nobody listed offers it.
    suite.announce({ id: 'my-ext', name: 'Mine', owns: ['scene', 'weather'] });
    assert.equal(suite.owner('weather'), 'my-ext');
    assert.equal(suite.owner('scene'), 'npc-state-delta');
    assert.equal(suite.owner('nonsense'), null);
});

test('a provider announced as disabled offers nothing and shares no api', () => {
    const suite = storySuite();
    suite.announce({ ...delta({ enabled: false }), api: { members: () => [] } });
    suite.announce(director());
    assert.equal(suite.has('npc-state-delta'), false);
    assert.equal(suite.api('npc-state-delta'), null);
    assert.equal(suite.owner('npc'), 'story-director');
    assert.deepEqual(suite.offering('npc'), ['story-director']);
    assert.equal(suite.providers().length, 2, 'still listed');
});

test('offering: everyone offering an area, the owner first', () => {
    const suite = storySuite();
    assert.deepEqual(suite.offering('npc'), []);
    suite.announce(director());
    suite.announce(block());
    suite.announce(delta());
    assert.deepEqual(suite.offering('npc'), ['npc-state-delta', 'story-director']);
    assert.deepEqual(suite.offering('timeline'), ['story-director', 'story-block']);
    assert.deepEqual(suite.offering('scene'), ['story-block', 'npc-state-delta']);
    assert.deepEqual(suite.offering('items'), ['story-block']);
});

test('withdraw: gone from every answer; an unknown id changes nothing', () => {
    const suite = storySuite();
    suite.announce(director({ api: {} }));
    suite.announce(delta());
    let calls = 0;
    suite.onChange(() => { calls += 1; });
    suite.withdraw('npc-state-delta');
    assert.equal(calls, 1);
    assert.equal(suite.has('npc-state-delta'), false);
    assert.equal(suite.owner('npc'), 'story-director');
    suite.withdraw('npc-state-delta');
    suite.withdraw('nobody');
    assert.equal(calls, 1, 'nothing to withdraw, nobody woken');
    suite.withdraw('story-director');
    assert.deepEqual(suite.providers(), []);
    assert.equal(suite.api('story-director'), null);
});

test('onChange: every announcement wakes the listeners; unsubscribe stops it; one failing listener spares the rest', () => {
    const suite = storySuite();
    const seen = [];
    const stop = suite.onChange(() => seen.push(suite.owner('npc')));
    suite.announce(director());
    suite.announce(delta());
    assert.deepEqual(seen, ['story-director', 'npc-state-delta']);
    stop();
    suite.announce(block());
    assert.equal(seen.length, 2);

    const warn = console.warn;
    const warnings = [];
    console.warn = (...args) => warnings.push(args);
    try {
        let after = 0;
        suite.onChange(() => { throw new Error('broken'); });
        suite.onChange(() => { after += 1; });
        suite.withdraw('story-block');
        assert.equal(after, 1);
        assert.equal(warnings.length, 1);
        assert.match(String(warnings[0][0]), /Story Suite/);
    } finally {
        console.warn = warn;
    }
});

test('an older registry is taken over with its providers and listeners; a newer one is kept', () => {
    const provider = { ...block(), owns: ['scene'], enabled: true };
    let woken = 0;
    const listener = () => { woken += 1; };
    const older = { version: 0, snapshot: () => [['story-block', provider]], listenersSnapshot: () => [listener] };
    globalThis.StorySuite = older;
    const suite = storySuite();
    assert.notEqual(suite, older);
    assert.equal(globalThis.StorySuite, suite);
    assert.equal(suite.version, SUITE_VERSION);
    assert.equal(suite.has('story-block'), true);
    assert.equal(suite.owner('scene'), 'story-block');
    suite.announce(director());
    assert.equal(woken, 1, 'the old listener still hears');

    // Something without a version (or a broken one) is replaced from nothing.
    globalThis.StorySuite = { version: 'old' };
    assert.deepEqual(storySuite().providers(), []);

    const newer = { version: SUITE_VERSION + 1, owner: () => 'someone' };
    globalThis.StorySuite = newer;
    assert.equal(storySuite(), newer);
});

test('isSourceOfTruth alone: every choice works like Automatic', () => {
    const suite = storySuite();
    suite.announce(director());
    for (const choice of ['auto', 'mine', 'theirs']) {
        for (const area of ['calendar', 'timeline', 'npc']) assert.equal(isSourceOfTruth('story-director', area, choice), true, `${area}, ${choice}`);
    }
    // Not even offering it, and nobody else does: still ours to keep.
    assert.equal(isSourceOfTruth('story-director', 'stats', 'auto'), true);
    assert.equal(isSourceOfTruth('story-director', 'stats', 'theirs'), true);
    assert.equal(isSourceOfTruth('story-director', 'npc'), true, 'auto by default');
});

test('isSourceOfTruth with NPC State Delta: auto follows the table, mine keeps it, theirs gives it away', () => {
    const suite = storySuite();
    suite.announce(director());
    suite.announce(delta());
    // npc: NPC State Delta is the specialist.
    assert.equal(isSourceOfTruth('story-director', 'npc', 'auto'), false);
    assert.equal(isSourceOfTruth('story-director', 'npc', 'mine'), true);
    assert.equal(isSourceOfTruth('story-director', 'npc', 'theirs'), false);
    assert.equal(isSourceOfTruth('npc-state-delta', 'npc', 'auto'), true);
    // calendar: Story Director is.
    assert.equal(isSourceOfTruth('story-director', 'calendar', 'auto'), true);
    assert.equal(isSourceOfTruth('story-director', 'calendar', 'theirs'), false);
    assert.equal(isSourceOfTruth('npc-state-delta', 'calendar', 'auto'), false);
    assert.equal(isSourceOfTruth('npc-state-delta', 'calendar', 'mine'), true);
    // timeline: nobody else offers it, so even "the other one" keeps it here.
    assert.equal(isSourceOfTruth('story-director', 'timeline', 'theirs'), true);
    // An explicit registry may be passed in.
    assert.equal(isSourceOfTruth('story-director', 'npc', 'auto', suite), false);

    // NPC State Delta switched off: Story Director is next in line again.
    suite.announce(delta({ enabled: false }));
    assert.equal(isSourceOfTruth('story-director', 'npc', 'auto'), true);
    assert.equal(isSourceOfTruth('story-director', 'npc', 'theirs'), true);
});

test('isSourceOfTruth when Story Director gives an area to the other one by not offering it', () => {
    const suite = storySuite();
    suite.announce(director({ owns: ['calendar', 'npc'] }));
    suite.announce(block());
    // Story Block takes the timeline on its Automatic, and Story Director knows it is not the source.
    assert.equal(isSourceOfTruth('story-block', 'timeline', 'auto'), true);
    assert.equal(isSourceOfTruth('story-director', 'timeline', 'theirs'), false);
    assert.equal(isSourceOfTruth('story-director', 'timeline', 'mine'), true);
});
