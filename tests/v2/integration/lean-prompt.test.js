// The Director's prompt diet (3 Nov): one grammar line per family, the rare kinds taught only while the story uses them, the check rule
// said once, and not while Story Block's RPG is on without a fight module. The lines the parser reads are the same as before: every kind is still written, kept and replayed.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { rareKindsUsed } from '../../../src/v2/rare.js';
import { fakeFightRunner } from './helpers/fake-fight-runner.js';

const STATIC_KEY = 'story_suite_static';
const sent = (host, key) => host.st.promptLog.filter(entry => entry.key === key && entry.value).map(entry => entry.value);
const reply = (text, lines = []) => (lines.length ? `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);
const director = host => host.registry.contexts().find(entry => entry.moduleId === 'story-director');
// The Director's whole fixed prompt: its grammar lines, then its rules.
const promptOf = host => [...director(host).kinds.map(kind => kind.grammar).filter(Boolean), director(host).static()].join('\n');
const newHost = async (modules = []) => createHost({ modules: [...modules, createModule()] });

const EVERY_KIND = ['~ time June 3, 1200, 08:00 am', '~ place Harrow | kind: settlement', '+ present Elula',
    '+ clock Flood — the levee breaks | due: June 8, 1200, 08:00 am | shown: sign',
    '+ quest Wolf Hunt — kill wolves | goal: kill 3 wolves | giver: Danique | due: June 9, 1200, 08:00 am',
    '+ hook Herb Run — moonleaf for the healer | giver: Mother Ysolde',
    '+ agenda Bram — moves salt | now: Kesh', '+ secret Heir — the lost heir', '+ beat Storm — a storm | on: June 5, 1200, 08:00 am',
    '+ event Fair — the fair | on: June 14, 1200, 08:00 am',
    '+ world Plague — coughing in the docks | state: ongoing | place: Harrow', '+ faction Guild — the guild | area: docks | stance: wary',
    '+ route Harrow — Old Weir | hours: 2 | kind: road', '+ landmark Old Weir | region: the river | kind: ruin'];

test('a quiet story: the Director prompt is one line per family and well under the old 3,100 characters', async () => {
    for (const modules of [[], [fakeFightRunner()]]) {
        const host = await newHost(modules);
        try {
            await host.send('Hello.', reply('Dawn.', ['~ time June 3, 1200, 08:00 am']));
            await host.send('Again.', 'More.');
            const text = promptOf(host);
            // 2,100: the World pulse's one static sentence (feature `story-director.pulse`, on by default) and the names part's `+ person` line
            // (feature `story-director.names`, on by default since the first real run) are in it.
            assert.ok(text.length < 2100, `${text.length} characters`);
            assert.match(text, /^\+ agenda\|event\|clock\|beat\|secret Name — summary/m);
            assert.match(text, /^\+ hook\|quest Name — /m);
            assert.match(text, /^~ time <date, clock time/m);
            // The rare kinds are not taught to a story that uses none of them.
            assert.doesNotMatch(text, /\+ route|\+ landmark|~ trip|World lines|\[World\]/);
            // The world and faction line is always taught, one line, so the first world event can be recorded.
            assert.match(text, /^\+ world Name — .*; \+ faction Name — /m);
            // The statics of the replies are the same bytes (the cache keeps its prefix).
            assert.equal(new Set(sent(host, STATIC_KEY)).size, 1);
        } finally {
            host.close();
        }
    }
});

test('the check rule is said once; Story Block\'s RPG (its planner asks for the checks) leaves it out, unless a fight module runs', async () => {
    const alone = await newHost();
    const withRpg = await newHost();
    const withFights = await newHost([fakeFightRunner()]);
    withRpg.features.set('story-block.rpg', true);
    try {
        for (const host of [alone, withRpg, withFights]) {
            await host.send('Hello.', reply('Dawn.'));
            await host.send('Again.', 'More.');
        }
        const text = promptOf(alone);
        assert.equal(text.match(/\? check/g).length, 1, 'one line');
        assert.match(text, /^\? check <skill or stat> — .* \(no result: code rolls once, .*\[Happened\].* not rolled again\)$/m);
        assert.doesNotMatch(text, /Checks:/);
        assert.doesNotMatch(promptOf(withRpg), /check/i);
        assert.doesNotMatch(promptOf(withRpg), /Checks:/);
        // With a fight module (rpg_battle) the line is taught as it always was.
        assert.equal(promptOf(withFights).match(/\? check/g).length, 1);
        // The head stays either way: a check line is read, with the RPG on and with it off, with no grammar line to teach it.
        await withRpg.send('Check.', reply('He tries.', ['? check athletics — jump the gap | dc: hard']));
        assert.ok(withRpg.sdk.receipts().some(entry => /check/.test(entry.receipt.type)));
        await withFights.send('Check.', reply('He tries.', ['? check athletics — jump the gap | dc: hard']));
        assert.ok(withFights.sdk.receipts().some(entry => /check/.test(entry.receipt.type)));
        // Written in the story just before the block, with the RPG on (no grammar line): still taken.
        await withRpg.send('Check.', 'She eyes the lock.\n\n? check lockpicking — open the door | dc: hard\n\n<Changes>\n~ time 9:30 am\n</Changes>');
        assert.equal(withRpg.sdk.receipts().filter(entry => /check/.test(entry.receipt.type)).length, 2, 'a stray check line is taken');
    } finally {
        alone.close();
        withRpg.close();
        withFights.close();
    }
});

test('the heads are fixed: a route line written in the story is taken with no map, and a Re-read after a route exists takes the same lines', async () => {
    const host = await newHost();
    try {
        const stray = 'He rode out.\n\n+ route Oakvale — Brindle Ford | hours: 3 | kind: road\n\n<Changes>\n~ time June 3, 1200, 08:00 am\n</Changes>';
        // No map yet: the route grammar is not taught, and the line is read all the same.
        assert.doesNotMatch(promptOf(host), /\+ route/);
        await host.send('Go.', stray);
        assert.equal(Object.keys(host.head().domains.atlas.routes).length, 1, 'the stray route line is taken');
        assert.deepEqual(host.store.problems(), []);
        // The map is on now, so the grammar is taught; a rebuild (Re-read) reads the very same lines to the same state.
        await host.send('On.', 'The day.');
        assert.match(promptOf(host), /\+ route/);
        const live = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live);
    } finally {
        host.close();
    }
});

test('a landmark the story wrote (a place it made, of any kind) turns on the route and landmark grammar', async () => {
    const host = await newHost();
    try {
        await host.send('Go.', reply('Ruins ahead.', ['~ time June 3, 1200, 08:00 am', '+ landmark Old Weir | region: the river | kind: ruin']));
        assert.deepEqual(host.store.problems(), []);
        await host.send('On.', 'The day.');
        assert.match(promptOf(host), /\+ route Place — Other Place .*; \+ landmark Name \| region/);
    } finally {
        host.close();
    }
});

test('route, landmark, trip and the World paragraphs are taught from the reply after the story keeps one, and every family line is still read', async () => {
    const host = await newHost();
    try {
        await host.send('Hello.', reply('Dawn.', EVERY_KIND));
        const problems = host.store.problems();
        assert.deepEqual(problems, []);
        const head = host.head().domains;
        assert.deepEqual(Object.values(head.director.threads).map(thread => thread.kind).sort(), ['agenda', 'beat', 'clock', 'event', 'hook', 'quest', 'secret']);
        assert.deepEqual(Object.values(head.chronicle.events).map(event => event.name), ['Plague']);
        assert.deepEqual(Object.values(head.chronicle.factions).map(faction => faction.name), ['Guild']);
        assert.equal(Object.keys(head.atlas.routes).length, 1);
        // The next prompt teaches the world, faction, route, landmark and trip lines and the two World paragraphs.
        await host.send('Go on.', 'The day.');
        const text = promptOf(host);
        for (const line of [/^\+ route Place — Other Place .*; \+ landmark Name \| region/m, /^~ trip Place \| by: /m, /World lines are for what changes the wider world/, /Events under \[World\] are under way/]) assert.match(text, line);
        const statics = sent(host, STATIC_KEY);
        assert.doesNotMatch(statics[0], /\+ route|~ trip|World lines/);
        assert.match(statics.at(-1), /World lines/);
        // A rebuild reads the same lines to the same state.
        const live = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live);
    } finally {
        host.close();
    }
});

test('rareKindsUsed reads the state and the packs: a world event or faction, a route, a landmark', () => {
    const view = (domains, query) => ({ state: { domains }, ...(query ? { query } : {}) });
    assert.deepEqual(rareKindsUsed(view({})), { chronicle: false, map: false, routes: false });
    assert.deepEqual(rareKindsUsed(view({ chronicle: { events: {}, factions: {} }, atlas: { places: { a: { kind: 'settlement' } }, routes: {} } })), { chronicle: false, map: false, routes: false });
    assert.equal(rareKindsUsed(view({ chronicle: { events: { e: {} } } })).chronicle, true);
    assert.equal(rareKindsUsed(view({ chronicle: { factions: { f: {} } } })).chronicle, true);
    assert.deepEqual(rareKindsUsed(view({ atlas: { routes: { r: {} } } })), { chronicle: false, map: true, routes: true });
    assert.deepEqual(rareKindsUsed(view({ atlas: { places: { p: { kind: 'landmark' } } } })), { chronicle: false, map: true, routes: false });
    assert.deepEqual(rareKindsUsed(view({ atlas: { places: { p: { kind: 'ruin', made: 3 } } } })), { chronicle: false, map: true, routes: false }, 'a place the story made');
    const pack = name => (name === 'packs.content' ? [{ from: 'A', to: 'B', km: 10, kind: 'road' }] : []);
    assert.equal(rareKindsUsed(view({}, (name, args) => (args?.kind === 'routes' ? pack(name) : []))).routes, true, 'a pack\'s road');
    assert.deepEqual(rareKindsUsed(view({}, () => { throw new Error('no packs'); })), { chronicle: false, map: false, routes: false });
});
