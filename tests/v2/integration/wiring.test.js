// The whole module on the real Story Block v2 host (tests/vendor/story-block, see its VERSION): the
// tracker, quests, time, atlas and screens parts merged by src/v2/module.js, driven the way SillyTavern
// drives them. Screens and the Map are registered, the scene's place goes on the map through
// beforeGenerate, routes are captured, Finish follows quest.progress's `finish`, the clock starts from
// the Ersveil pack's start date on its calendar, deadlines lapse on the reader's own calendar, and the
// static prompt stays byte-identical throughout.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createHost } from '../../vendor/story-block/testkit/index.js';
import { MODULE_ID, createModule } from '../../../src/v2/module.js';
import { fakeRpgBattle } from './helpers/fake-rpg.js';
import { problemList } from '../../../src/v2/tracker/domain.js';

const STATIC_KEY = 'story_suite_static';
const TAIL_KEY = 'story_suite_tail_1';
const ERSVEIL = readFileSync(new URL('../../fixtures/ersveil-bluewatch.pack.json', import.meta.url), 'utf8');

const reply = (text, lines = []) => (lines.length ? `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);
const sent = (host, key) => host.st.promptLog.filter(entry => entry.key === key && entry.value).map(entry => entry.value);
const receipts = host => host.sdk.receipts().map(entry => entry.receipt);

// The module's queries reach the host's settings and {{user}} through this host's sdk (live: the
// global StoryBlock.sdk, which the testkit does not set).
async function newHost(options = {}) {
    let host = null;
    const module = createModule({ host: { settings: id => host?.sdk.settings(id) ?? null, substitute: text => host?.sdk.substitute(text) } });
    host = await createHost({ modules: [fakeRpgBattle(), module], ...options });
    return host;
}

async function ok(promise) {
    const result = await promise;
    assert.equal(result.ok, true, result.message);
    return result;
}

test('registered whole: the screens and the Map, no hand-built tabs, the status card on by default', async () => {
    const host = await newHost();
    const mine = host.sdk.modules().find(entry => entry.id === MODULE_ID);
    assert.deepEqual(mine.tabs, []);
    const screens = host.registry.screens().filter(screen => screen.moduleId === MODULE_ID);
    assert.deepEqual(screens.map(screen => screen.id).sort(), [
        'story-director/chronicle', 'story-director/days', 'story-director/director', 'story-director/map', 'story-director/quests', 'story-director/status-card', 'story-director/world',
    ]);
    assert.equal(screens.find(screen => screen.id === 'story-director/status-card').defaultOn, true);
    // Every binding of every screen names a query the host answers.
    for (const screen of screens) {
        for (const binding of Object.values(screen.data ?? {})) assert.ok(host.registry.query(binding.query), `${screen.id}: ${binding.query}`);
    }
    host.close();
});

test('the Ersveil pack: its calendar, the clock seeded from its start at the first reply, its places on the map', async () => {
    const host = await newHost();
    const installed = await host.packs.packs.install(ERSVEIL, { origin: 'pack.json' });
    assert.equal(installed.ok, true, JSON.stringify(installed.errors));
    assert.equal(host.sdk.query('director.calendar').era, 'CY');
    assert.deepEqual(host.sdk.query('director.time'), { minutes: null, text: '' });

    await host.send('I wake.', reply('Gulls over the quay.'));
    const seed = receipts(host).find(receipt => receipt.type === 'director.seed');
    assert.ok(seed, 'director.seed was committed before the first reply');
    assert.equal(seed.cause, 'system');
    assert.equal(host.head().meta.claims['clock:seed'], true);
    const time = host.sdk.query('director.time');
    assert.equal(time.text, 'CY 611, Goldwane 12, 06:40 am');
    // Not narrated: the Director note gives the time once something is tracked (below).
    assert.doesNotMatch(sent(host, TAIL_KEY).at(-1) ?? '', /the start of ersveil/);

    // The story moves it on the pack's calendar; no second seed.
    await host.send('Later.', reply('The bells ring noon.', ['~ time Goldwane 12, 12:00 pm']));
    assert.equal(host.sdk.query('director.time').text, 'CY 611, Goldwane 12, 12:00 pm');
    await host.send('On.', reply('Afternoon.', ['! time +2h']));
    assert.equal(host.sdk.query('director.time').text, 'CY 611, Goldwane 12, 02:00 pm');
    // A deadline written on the pack's calendar is read on it from the first day.
    await host.send('Work?', reply('A notice.', ['+ clock Toll — the bridge toll doubles | due: Goldwane 13, 611, 09:00 am']));
    assert.equal(host.sdk.query('director.next').key, 'Toll');
    await host.send('Wait.', reply('Dusk.'));
    assert.match(sent(host, TAIL_KEY).at(-1) ?? '', /Goldwane 12/);
    assert.equal(receipts(host).filter(receipt => receipt.type === 'director.seed').length, 1);

    // The pack's places (records with id, slug, pack) are on the map; a visit takes the pack's data.
    const places = host.sdk.query('atlas.places');
    const packPlace = places.find(place => place.name === 'Bluewatch Village');
    assert.deepEqual([packPlace.source, packPlace.discovered, packPlace.x, packPlace.y], ['pack', false, 64, 110]);
    await host.send('Into the village.', reply('Bluewatch.', ['~ place Bluewatch Village']));
    await host.send('Look.', reply('Nets drying.'));
    const visited = host.sdk.query('atlas.place', { name: 'Bluewatch Village' });
    assert.deepEqual([visited.source, visited.discovered, visited.kind, visited.x, visited.y], ['atlas', true, 'settlement', 64, 110]);
    assert.ok(visited.routes.length > 0, 'the pack\'s routes from it');
    assert.equal(new Set(sent(host, STATIC_KEY)).size, 1);
    host.close();
});

test('the reader\'s own calendar wins over the pack\'s: no seed when the start is not on it', async () => {
    const host = await newHost({ settings: { modules: { [MODULE_ID]: { 'tracker.calendar.preset': 'gregorian' } } } });
    await host.packs.packs.install(ERSVEIL, { origin: 'pack.json' });
    await host.send('I wake.', reply('Morning.'));
    assert.equal(host.sdk.query('director.calendar').preset, 'gregorian');
    assert.equal(host.sdk.query('director.time').minutes, null);
    assert.equal(receipts(host).some(receipt => receipt.type === 'director.seed'), false);
    host.close();
});

test('a custom calendar and a time jump: the deadline lapses and the recap tells the rest, once, not under Due now', async () => {
    const host = await newHost({ settings: { modules: { [MODULE_ID]: {
        'tracker.calendar.preset': 'custom',
        'tracker.calendar.era': 'CY',
        'tracker.calendar.months': [{ name: 'Haywane', days: 30 }, { name: 'Goldwane', days: 30 }, { name: 'Frostwane', days: 30 }],
        'tracker.calendar.week': '',
    } } } });
    await host.send('Evening.', reply('The inn is loud.', [
        '~ time CY 611, Goldwane 3, 08:00 pm',
        '+ hook Rat Culling — rats in the granary | giver: Danique | reward: 5 gold | due: Goldwane 4, 611',
        '+ event Stray Oar — the inn | then: sacked by the guild | on: Goldwane 5, 611',
    ]));
    assert.equal(host.sdk.query('director.time').text, 'CY 611, Goldwane 3, 08:00 pm');
    await host.send('I sleep for days.', reply('You wake stiff.', ['! time +3d']));
    await host.send('What happened?', reply('The square is quiet.'));
    const tail = sent(host, TAIL_KEY).at(-1);
    assert.match(tail, /\[Happened\]\nLapsed: Rat Culling \(Danique's offer\) went to someone else; Danique may mention it\./);
    assert.match(tail, /\[While away\] Goldwane 3, 08:00 pm → Goldwane 6, 08:00 pm: Stray Oar — sacked by the guild/);
    // The recapped event is not repeated under Due now (v1 note.js).
    assert.doesNotMatch(tail, /Due now[^\n]*Stray Oar/);
    const rats = host.sdk.query('director.thread', { key: 'Rat Culling' });
    assert.deepEqual([rats.status, rats.ended.outcome], ['resolved', 'failed']);
    assert.deepEqual(host.sdk.query('time.recap').threads, [host.sdk.query('director.thread', { key: 'Stray Oar' }).id]);

    // The reply after that: the recap is gone and Stray Oar, still open and past its date, is due again.
    await host.send('I walk on.', reply('The road is long.'));
    const later = sent(host, TAIL_KEY).at(-1) ?? '';
    assert.doesNotMatch(later, /\[While away\]/);
    assert.match(later, /Due now[^\n]*Stray Oar/);
    assert.equal(new Set(sent(host, STATIC_KEY)).size, 1);
    host.close();
});

test('the Director screen\'s problems name the reader, not {{user}}', async () => {
    const host = await newHost({ st: { user: 'Astra' } });
    await host.send('Any work?', reply('Fenna has a job.', ['+ hook Granary Rats — Fenna wants the cellar cleared | giver: Fenna | goal: Kill 3 rats']));
    // Giving a quest up is the reader's choice: a story line that does it alone is a Problem naming them.
    await host.send('I look at the sacks.', reply('You seem to give up.', ['- hook Granary Rats — abandoned']));
    const raw = problemList(host.head().domains.director).map(problem => problem.text);
    assert.ok(raw.some(text => text.includes('{{user}}')), 'the stored text keeps v1\'s macro');
    const shown = host.sdk.query('director.problems').map(problem => problem.text);
    assert.ok(shown.some(text => /is Astra's choice/.test(text)), shown.join(' | '));
    assert.ok(shown.every(text => !text.includes('{{user}}')));
    host.close();
});
