// Story Director on the real Story Block v2 host (the vendored runtime and testkit in
// tests/vendor/story-block/): Story Block's core module, a stand-in RPG Battle and this module,
// driven the way SillyTavern drives them (messages, replies with <Changes> blocks, swipes,
// deletes, UI commands).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule, MODULE_ID } from '../../../src/v2/module.js';
import { fakeRpgBattle } from './helpers/fake-rpg.js';

const STATIC_KEY = 'story_suite_static';
const TAIL_KEY = 'story_suite_tail_1';

const newHost = (options = {}) => createHost({ modules: [fakeRpgBattle(), createModule()], ...options });
const reply = (text, lines = []) => (lines.length ? `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);
const quest = (host, key) => host.sdk.query('director.thread', { key });
const claims = host => Object.keys(host.head().meta.claims).sort();
const wallet = host => host.sdk.query('inventory.wallet', { owner: 'party' });
const sentValues = (host, key) => host.st.promptLog.filter(entry => entry.key === key && entry.value).map(entry => entry.value);

async function ok(promise) {
    const result = await promise;
    assert.equal(result.ok, true, result.message);
    return result;
}

// The reply where Fenna's job is accepted: `+ quest` makes it active at once.
const OFFER = [
    '~ place Bluewatch | kind: settlement',
    '+ present Fenna',
    '+ quest Granary Rats — Fenna wants the cellar cleared | giver: Fenna | goal: Kill 3 cellar rats | reward: 2 gold each',
];


test('~ time sets the story clock and ! time moves it on, on the reader\'s calendar setting', async () => {
    const host = await newHost();
    await host.send('Morning.', reply('Dawn over the weir.', ['~ time March 3, 8:00 am', '+ hook River stranger — who pulled Ren out']));
    const start = host.sdk.query('director.time').minutes;
    assert.ok(Number.isInteger(start));
    await host.send('We walk.', reply('Two hours on the road.', ['! time +2h']));
    assert.equal(host.sdk.query('director.time').minutes, start + 120);
    assert.match(sentValues(host, TAIL_KEY).at(-1) ?? '', /March 3/);

    // The calendar is the reader's (namespaced settings of part tracker).
    const values = host.settings(MODULE_ID);
    assert.equal(values['tracker.calendar.preset'], 'pack', 'the pack\'s calendar when a pack has one, else Gregorian');
    assert.equal(values['tracker.dormantReplies'], 15);
    const custom = await newHost({ settings: { modules: { [MODULE_ID]: {
        'tracker.calendar.preset': 'custom',
        'tracker.calendar.months': [{ name: 'Haywane', days: 30 }, { name: 'Goldwane', days: 30 }],
    } } } });
    await custom.send('Morning.', reply('Market day.', ['~ time Goldwane 12, 12:45 pm']));
    const minutes = custom.sdk.query('director.time').minutes;
    assert.ok(Number.isInteger(minutes));
    assert.equal(minutes % 1440, 12 * 60 + 45);
    // A bad time line is the Director's Problem, not an error, and changes nothing.
    await custom.send('Later.', reply('Hm.', ['- time yesterday']));
    assert.equal(custom.sdk.query('director.time').minutes, minutes);
    host.close();
    custom.close();
});

test('the static prompt is byte-identical reply after reply, with the Director\'s kinds and rules', async () => {
    const host = await newHost();
    await host.send('Any work?', reply('Fenna has a job.', OFFER));
    await host.send('Onward.', reply('Hours pass.', ['~ time March 3, 8:00 am', '+ hook River stranger — who pulled Ren out']));
    await host.send('Again.', 'More.');
    const statics = sentValues(host, STATIC_KEY);
    assert.equal(statics.length, 3);
    assert.equal(new Set(statics).size, 1);
    const tails = sentValues(host, TAIL_KEY);
    assert.notEqual(tails[0], tails.at(-1), 'the tail changes with the state');

    const text = statics[0];
    assert.match(text, /~ time <date, clock time>/);
    assert.match(text, /Director lines:/);
    // No offers to accept: a hook is an open thread, and + quest is written once the reader accepts.
    assert.doesNotMatch(text, /a job only offered: \+ hook with giver, reward/);
    // Another chat with other state sends the same bytes.
    const other = await newHost();
    await other.send('Hi.', 'Hello.');
    assert.equal(sentValues(other, STATIC_KEY)[0], text);
    host.close();
    other.close();
});

test('the module registers whole: screens instead of tabs, settings fields, capture kinds, queries', async () => {
    const host = await newHost();
    const mine = host.sdk.modules().find(entry => entry.id === MODULE_ID);
    assert.equal(mine.version, '2.0.0-beta.2');
    assert.deepEqual(mine.tabs, [], 'the hand-built tabs are gone: the screens show quests, threads and the map');
    assert.deepEqual([...mine.kinds].sort(), ['agenda', 'beat', 'clock', 'event', 'faction', 'hook', 'landmark', 'route', 'secret', 'time', 'world']);
    assert.deepEqual([...mine.commands].sort(), ['atlas.dangerSet', 'atlas.edit', 'atlas.focus', 'atlas.placeBind', 'atlas.placeRegion', 'atlas.region', 'atlas.visit', 'chronicle.digest', 'chronicle.edit', 'chronicle.note', 'chronicle.remove', 'chronicle.surface', 'chronicle.threadOutcome', 'director.advance', 'director.arc.accept', 'director.arc.end', 'director.arc.update', 'director.initiative', 'director.seed', 'threads.accept', 'threads.close', 'threads.intent', 'threads.link', 'threads.offer', 'threads.questWrite', 'time.settle']);
    assert.deepEqual(host.sdk.query('director.time'), { minutes: null, text: '' });
    assert.deepEqual(host.registry.screens().filter(screen => screen.moduleId === MODULE_ID).map(screen => screen.id), [
        'story-director/map', 'story-director/chronicle', 'story-director/world', 'story-director/days', 'story-director/quests', 'story-director/director', 'story-director/status-card',
    ]);
    const defs = host.registry.settingsDefs().find(entry => entry.moduleId === MODULE_ID);
    assert.deepEqual(Object.keys(defs.schema).sort(), [
        'arc.autoAccept', 'arc.genre', 'arc.keepNote', 'arc.lowThreads', 'arc.maxTokens', 'arc.note', 'arc.profile', 'arc.recent', 'arc.stallDays', 'arc.trigger',
        'atlas.map.east', 'atlas.map.era', 'atlas.map.kmPerUnit', 'atlas.map.north', 'atlas.map.roadFactor',
        'chronicle.digestDays', 'chronicle.digestKeep', 'chronicle.digestTail',
        'screens.hideBehind', 'time.lapses', 'time.recapHours',
        'tracker.calendar.era', 'tracker.calendar.leapYears', 'tracker.calendar.months', 'tracker.calendar.preset', 'tracker.calendar.week',
        'tracker.dormantDays', 'tracker.dormantReplies', 'tracker.dueSoonDays', 'tracker.elsewhere', 'tracker.initiativeCooldown', 'tracker.maxJump',
        'world.upcomingDays',
    ]);
    assert.equal(defs.schema['tracker.calendar.preset'].label, 'Calendar: Calendar');
    assert.deepEqual(defs.schema['tracker.calendar.preset'].options, ['pack', 'gregorian', 'custom']);
    assert.equal(defs.schema['atlas.map.north'].label, 'Map: North is');
    assert.deepEqual(defs.schema['atlas.map.north'].options, ['up', 'down']);
    host.close();
});
