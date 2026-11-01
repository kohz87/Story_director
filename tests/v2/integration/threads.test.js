// The feature `story-director.threads` ("World-building threads", src/v2/threads.js) on a whole Story Block host: what it
// owns (the agenda, event, clock, beat, secret, faction, world, landmark and route kinds, the Pacing, World lines and Under
// [World] paragraphs, the notes' lines about them), that on it changes no byte of the prompt, and that off is the registry's
// normal off: nothing taught or sent, the story's lines of those kinds left out quietly, what is stored kept, replay equal to
// a rebuild, a pack event's lasting change still written.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createHost } from '../../vendor/story-block/testkit/index.js';
import { featureProblems } from '../../vendor/story-block/src/v2/features.js';
import { createModule, storyDirectorModule } from '../../../src/v2/module.js';
import { TAIL_HEADER } from '../../../src/v2/chronicle/note.js';
import { PACING_TEXT, staticText } from '../../../src/v2/tracker/note.js';
import { STATIC_TEXT as WORLD_PARAGRAPHS } from '../../../src/v2/chronicle/note.js';
import { THREADS_FEATURE, THREAD_KINDS_OWNED, ownedKind, threadsOn, withoutOwnedThreads } from '../../../src/v2/threads.js';
import { fakeFightRunner } from './helpers/fake-fight-runner.js';

const TAIL_KEY = 'story_suite_tail_1';
const sent = (host, key) => host.st.promptLog.filter(entry => entry.key === key && entry.value).map(entry => entry.value);
const reply = (text, lines = []) => (lines.length ? `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);
const fixture = name => JSON.parse(readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), 'utf8'));
const OWNED_KINDS = ['agenda', 'event', 'clock', 'beat', 'secret', 'world', 'faction', 'route', 'landmark'];

async function newHost({ features = {}, modules = [] } = {}) {
    let host = null;
    const module = createModule({ host: { settings: id => host?.sdk.settings(id) ?? null, substitute: text => host?.sdk.substitute(text), feature: id => host?.sdk.feature(id) } });
    host = await createHost({ modules: [...modules, module], settings: { features } });
    return host;
}
const tailOf = host => sent(host, TAIL_KEY).at(-1) ?? '';
const contextOf = host => host.registry.contexts().find(entry => entry.moduleId === 'story-director');

const OPENING = ['~ time June 3, 1200, 08:00 am', '~ place Harrow | kind: settlement', '+ present Elula',
    '+ clock Flood — the levee breaks | due: June 8, 1200 | shown: sign',
    '+ quest Wolf Hunt — kill wolves | goal: kill 3 wolves | giver: Danique | due: June 9, 1200',
    '+ hook Herb Run — moonleaf for the healer | giver: Mother Ysolde',
    '+ agenda Bram — moves salt | now: Kesh', '+ secret Heir — the lost heir', '+ beat Storm — a storm | on: June 5, 1200',
    '+ event Fair — the fair | on: June 14, 1200',
    '+ world Plague — coughing in the docks | state: ongoing | place: Harrow', '+ faction Guild — the guild | area: docks | stance: wary',
    '+ route Harrow — Old Weir | hours: 2 | kind: road', '+ landmark Old Weir | region: the river | kind: ruin'];

test('the feature: declared, on by default, out of the Lean preset; initiative and trip too; the owned kinds carry it and nothing else does', () => {
    const def = storyDirectorModule;
    const threads = def.features.find(feature => feature.id === THREADS_FEATURE);
    assert.equal(THREADS_FEATURE, 'story-director.threads');
    assert.deepEqual([threads.label, threads.default, threads.presets], ['World-building threads', true, { lean: false }]);
    assert.ok(threads.describe.length <= 240 && threads.label.length <= 60);
    assert.deepEqual(def.features.find(feature => feature.id === 'story-director.initiative').presets, { lean: false });
    assert.deepEqual(def.features.find(feature => feature.id === 'story-director.trip').presets, { lean: false });
    // Every other feature of the module omits `presets` (it follows its default in every preset).
    for (const feature of def.features.filter(entry => !['story-director.threads', 'story-director.initiative', 'story-director.trip'].includes(entry.id))) assert.equal(feature.presets, undefined, feature.id);
    assert.deepEqual(featureProblems(def), [], 'the feature tags all name declared features');
    const tagged = Object.entries(def.capture.kinds).filter(([, spec]) => spec.feature === THREADS_FEATURE).map(([kind]) => kind).sort();
    assert.deepEqual(tagged, [...OWNED_KINDS].sort());
    for (const kind of ['quest', 'hook', 'time', 'check']) assert.equal(def.capture.kinds[kind].feature, undefined, kind);
    assert.deepEqual([...THREAD_KINDS_OWNED].sort(), ['agenda', 'beat', 'clock', 'event', 'secret']);
    assert.deepEqual(['agenda', 'quest', 'hook'].map(ownedKind), [true, false, false]);
    // The tail's and the queries' reading of the feature: on unless the host says it is off.
    assert.deepEqual([threadsOn({}), threadsOn({ feature: id => id !== THREADS_FEATURE }), threadsOn({ feature: () => true }), threadsOn({ feature: () => { throw new Error('x'); } })], [true, false, true, true]);
    const stripped = withoutOwnedThreads({ time: 1, threads: { a: { kind: 'quest' }, b: { kind: 'clock' }, c: { kind: 'hook' } } });
    assert.deepEqual(Object.keys(stripped.threads), ['a', 'c']);
    // The paragraphs it owns are context parts under it, in the place they always had.
    assert.deepEqual(def.context.parts.filter(part => part.feature === THREADS_FEATURE).map(part => part.static()), [PACING_TEXT, WORLD_PARAGRAPHS]);
});

test('on: the static part and the kinds are what they always were, byte for byte; off: the three paragraphs and the nine grammar lines are gone', async () => {
    const on = await newHost();
    const off = await newHost({ features: { [THREADS_FEATURE]: false } });
    try {
        const was = fixture('prompt-threads-on.json');
        const now = fixture('prompt-threads-off.json');
        const got = { static: contextOf(on).static(), kinds: contextOf(on).kinds };
        assert.deepEqual(got, was, 'with the feature on the prompt is unchanged');
        const gone = { static: contextOf(off).static(), kinds: contextOf(off).kinds };
        assert.deepEqual(gone, now);
        for (const paragraph of [PACING_TEXT, ...WORLD_PARAGRAPHS.split('\n')]) {
            assert.ok(got.static.includes(paragraph));
            assert.ok(!gone.static.includes(paragraph));
        }
        assert.deepEqual(gone.kinds.map(entry => entry.kind), ['check', 'hook', 'quest', 'time', 'trip']);
        assert.deepEqual(got.kinds.map(entry => entry.kind).filter(kind => !gone.kinds.some(entry => entry.kind === kind)).sort(), [...OWNED_KINDS].sort());
        // What stays: the Director lines, the fields, the write-only line and the checks line.
        assert.ok(gone.static.startsWith(staticText({ threads: false }).split('\n')[0]));
        assert.match(gone.static, /Fields: now, then/);
        assert.match(gone.static, /Checks: write \? check/);
        // The figure for the report: the Story Director part with the feature off is 684 characters, 171 tokens, shorter (the whole
        // fixed prompt with every other feature on its default: Story Block's 1310 tokens fall to 886).
        assert.equal(Math.ceil(got.static.length / 4) - Math.ceil(gone.static.length / 4), 171);
    } finally {
        on.close();
        off.close();
    }
});

test('off: lines of the owned kinds are left out quietly, quests, hooks, time and checks work, and replay equals a rebuild', async () => {
    const host = await newHost({ features: { [THREADS_FEATURE]: false } });
    try {
        await host.send('Hello.', reply('Dawn.', OPENING));
        const director = host.head().domains.director;
        assert.deepEqual(Object.values(director.threads).map(thread => [thread.kind, thread.key]).sort(), [['hook', 'Herb Run'], ['quest', 'Wolf Hunt']]);
        assert.equal(host.sdk.query('director.time').minutes !== null, true, '~ time works');
        assert.equal(host.head().domains.scene.place.name, 'Harrow');
        assert.deepEqual(host.head().domains.chronicle.events, {});
        assert.deepEqual(host.head().domains.chronicle.factions, {});
        assert.deepEqual(host.head().domains.atlas.routes ?? {}, {});
        assert.deepEqual(host.store.problems(), []);
        await host.send('Check.', reply('He tries.', ['? check athletics — jump the gap | dc: hard']));
        assert.ok(host.sdk.receipts().some(entry => entry.receipt.type === 'capture.check' || /check/.test(entry.receipt.type)), 'a check line is still read');
        const live = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live, 'rebuild equals live');
        // Back on, a Re-read of the same lines would write them; the lines left out are not remembered as written.
        assert.equal(Object.values(host.head().domains.director.threads).length, 2);
    } finally {
        host.close();
    }
});

test('off after on: all of it is kept, the notes tell nothing of it, and on again brings it back', async () => {
    const host = await newHost();
    try {
        await host.send('Hello.', reply('Dawn.', OPENING));
        await host.send('Go on.', reply('Day.'));
        const onTail = tailOf(host);
        for (const label of ['Clocks:', 'Beats:', 'Do not reveal: Heir', TAIL_HEADER]) assert.ok(onTail.includes(label), label);
        const stored = JSON.stringify(host.head().domains);
        host.features.set(THREADS_FEATURE, false);
        assert.equal(JSON.stringify(host.head().domains), stored, 'switching it off touches no state');
        await host.send('Again.', reply('Again.'));
        const offTail = tailOf(host);
        for (const word of ['Clocks:', 'Beats:', 'Off-screen:', 'Do not reveal', '[World]', 'Plague', 'Flood', 'Storm', 'Bram', 'Heir', 'Fair']) assert.ok(!offTail.includes(word), word);
        assert.match(offTail, /Elsewhere, not in this scene: Wolf Hunt \(quest\) · Herb Run \(hook\)/, 'quests and hooks are still told');
        assert.match(offTail, /\[Story Director · /);
        const director = host.head().domains.director;
        assert.deepEqual(Object.values(director.threads).map(thread => thread.kind).sort(), ['agenda', 'beat', 'clock', 'event', 'hook', 'quest', 'secret']);
        assert.equal(Object.keys(host.head().domains.chronicle.events).length, 1);
        assert.equal(Object.keys(host.head().domains.chronicle.factions).length, 1);
        const live = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live, 'replay equals a rebuild while off');
        // The fixed prompt answers the switch: its owned paragraphs are in the registry's context only while on.
        assert.ok(!contextOf(host).static().includes(PACING_TEXT));
        host.features.set(THREADS_FEATURE, true);
        assert.ok(contextOf(host).static().includes(PACING_TEXT));
        await host.send('Back.', reply('Back.'));
        const backTail = tailOf(host);
        for (const label of ['Clocks:', 'Beats:', 'Do not reveal: Heir', TAIL_HEADER]) assert.ok(backTail.includes(label), label);
    } finally {
        host.close();
    }
});

test('the While away recap leaves out the owned kinds while off, and is made again from what is left', async () => {
    const jump = async (off = false) => {
        const host = await newHost();
        await host.send('Hello.', reply('Dawn.', OPENING));
        if (off) host.features.set(THREADS_FEATURE, false);
        await host.send('Jump.', reply('Days pass.', ['~ time June 12, 1200, 09:00 am']));
        return host;
    };
    const on = await jump();
    try {
        await on.send('After.', reply('After.'));
        const line = tailOf(on).split('\n').find(entry => entry.startsWith('[While away]'));
        assert.match(line, /Flood/);
        assert.match(line, /Wolf Hunt/);
    } finally { on.close(); }
    const host = await jump(true);
    try {
        await host.send('After.', reply('After.'));
        const tail = tailOf(host);
        const line = tail.split('\n').find(entry => entry.startsWith('[While away]')) ?? '';
        assert.match(line, /Wolf Hunt/, 'the quest that fell due is still told');
        assert.doesNotMatch(tail, /Flood|Storm|Fair/);
    } finally { host.close(); }
    // Only owned kinds fell due: no recap line at all.
    const only = await newHost();
    try {
        await only.send('Hello.', reply('Dawn.', ['~ time June 3, 1200, 08:00 am', '+ clock Flood — the levee breaks | due: June 8, 1200']));
        await only.send('Jump.', reply('Days pass.', ['~ time June 12, 1200, 09:00 am']));
        only.features.set(THREADS_FEATURE, false);
        await only.send('After.', reply('After.'));
        assert.doesNotMatch(tailOf(only), /While away|Flood/);
    } finally { only.close(); }
});

test('off: a pack event\'s lasting world change is still written (Ersveil\'s calendar), the Chronicle line stays out of the notes, and a rebuild agrees', async () => {
    const base = JSON.parse(readFileSync(new URL('../../fixtures/ersveil-bluewatch.pack.json', import.meta.url), 'utf8'));
    const pack = JSON.stringify({
        id: 'ersveil-lasting', version: '1.0.0', name: 'Ersveil lasting', requires: { storyBlock: '^2', capabilities: ['chronicle-lasting'] },
        calendar: base.calendar, start: { scene: { place: { name: 'Bluewatch Village', kind: 'settlement', region: 'River Confederacy' } } },
        content: { events: [
            { id: 'river-rising', when: 'true', once: true, cue: 'The river rises.', then: [{ command: 'chronicle.lasting', payload: { name: 'River flood', state: 'looming', place: 'Bluewatch Village', summary: 'The river is rising.', keep: true } }] },
            { id: 'river-floods', after: 'river-rising', once: true, when: "query('chronicle.passed', { name: 'River flood', minutes: 1440 })", cue: 'The river floods.', then: [{ command: 'chronicle.lasting', payload: { name: 'River flood', state: 'ongoing' } }] },
        ] },
    });
    const host = await newHost({ features: { [THREADS_FEATURE]: false }, modules: [fakeFightRunner()] });
    try {
        const installed = await host.packs.packs.install(pack, { origin: 'pack.json' });
        assert.equal(installed.ok, true, JSON.stringify(installed.errors));
        await host.send('Begin.', reply('Morning.'));
        await host.send('Go on.', reply('Later.'));
        await host.send('Wait.', reply('Rain.'));
        const flood = host.sdk.query('chronicle.event', { name: 'River flood' });
        assert.ok(flood, 'the pack event wrote the world entry with the feature off');
        assert.deepEqual([flood.state, flood.place, flood.locked, flood.keep], ['looming', 'Bluewatch Village', true, true]);
        assert.ok(!tailOf(host).includes(TAIL_HEADER), 'the [World] lines are the feature\'s');
        await host.send('A day.', reply('A day passes.', ['! time +1d']));
        await host.send('Check.', reply('Check.'));
        assert.equal(host.sdk.query('chronicle.event', { name: 'River flood' }).state, 'ongoing', 'the delayed event wrote its step too');
        const live = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live, 'rebuild equals live');
        host.features.set(THREADS_FEATURE, true);
        await host.send('Look.', reply('Look.'));
        assert.ok(tailOf(host).includes(TAIL_HEADER), 'on again, the entry is under way in the notes');
    } finally {
        host.close();
    }
});

test('off: the Chronicle tab, the Behind widget, the Reveal setting and the screens\' threads queries are gone; on they are there', async () => {
    const on = await newHost();
    const off = await newHost({ features: { [THREADS_FEATURE]: false } });
    try {
        const has = (host, id) => host.registry.screens().some(screen => screen.id === id);
        assert.deepEqual([has(on, 'story-director/chronicle'), has(off, 'story-director/chronicle')], [true, false]);
        assert.deepEqual([has(on, 'story-director/director'), has(off, 'story-director/director'), has(off, 'story-director/world'), has(off, 'story-director/quests')], [true, true, true, true]);
        assert.deepEqual([on.registry.widgets().some(w => w.name === 'story-director.behind'), off.registry.widgets().some(w => w.name === 'story-director.behind')], [true, false]);
        assert.deepEqual([on.sdk.query('director.threads.on'), off.sdk.query('director.threads.on')], [{ on: true }, null]);
        await on.send('Hello.', reply('Dawn.', OPENING));
        assert.ok(on.sdk.query('director.behind').total > 0);
        assert.equal(off.sdk.query('director.behind'), null);
        const field = host => host.registry.settingsDefs().find(def => def.moduleId === 'story-director').schema['screens.hideBehind'];
        assert.equal(field(on).feature, THREADS_FEATURE);
        // The Upcoming list of the World screen has no events while off, quests, hooks and holidays stay.
        const upcoming = host => host.sdk.query('director.world').upcoming.map(item => item.kind).sort();
        assert.ok(upcoming(on).includes('event'));
        on.features.set(THREADS_FEATURE, false);
        assert.ok(!upcoming(on).includes('event'));
        assert.ok(upcoming(on).includes('quest'));
    } finally {
        on.close();
        off.close();
    }
});

test('chronicle.surface (the pick of the [World] events) is not made while off', async () => {
    const lines = ['~ time June 3, 1200, 08:00 am', ...[1, 2, 3, 4, 5].map(n => `+ world Event ${n} — thing ${n} | state: ongoing`)];
    for (const [features, expected] of [[{}, true], [{ [THREADS_FEATURE]: false }, false]]) {
        const host = await newHost({ features });
        try {
            await host.send('Hello.', reply('Dawn.', features[THREADS_FEATURE] === false ? [...lines, '+ hook Anything — to keep the reply busy'] : lines));
            if (features[THREADS_FEATURE] === false) {
                host.features.set(THREADS_FEATURE, true);
                await host.send('Again.', reply('Day.', lines.slice(1)));
                host.features.set(THREADS_FEATURE, false);
            }
            const before = host.sdk.receipts().filter(entry => entry.receipt.type === 'chronicle.surface').length;
            await host.send('Next.', reply('Day.'));
            const after = host.sdk.receipts().filter(entry => entry.receipt.type === 'chronicle.surface').length;
            assert.equal(after > before, expected, JSON.stringify(features));
        } finally {
            host.close();
        }
    }
});
