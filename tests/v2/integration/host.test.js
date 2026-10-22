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
    '+ quest Granary Rats — Fenna wants the cellar cleared | giver: Fenna | goal: Kill 3 cellar rats | reward: 2 silver each',
];

test('a reply\'s + quest is active at once; fights, Finish pays integers once and claims the fights', async () => {
    const host = await newHost();
    await host.send('Hello.', 'You reach Bluewatch.');
    // A fight before the quest never counts.
    await ok(host.sdk.command('combat.win', { foes: [{ name: 'Cellar Rat', count: 5 }] }));
    await host.send('Any work in Bluewatch?', reply('Fenna looks up from the sacks. "Rats," she says, and you agree.', OFFER));
    let rats = quest(host, 'Granary Rats');
    assert.equal(rats.kind, 'quest');
    assert.equal(rats.offer, false);
    assert.equal(rats.status, 'active');
    assert.ok(rats.taken.rev > 0, 'taken on at its reply');
    assert.deepEqual(rats.target, { noun: 'cellar rats', count: 3, kind: 'foes' });
    assert.deepEqual(rats.reward, { amount: 2, each: true, unit: '', text: '2 silver each' });
    assert.equal(host.sdk.query('scene.place').kind, 'settlement');
    assert.equal(host.sdk.query('quest.progress', { key: 'Granary Rats' }).have, 0);
    // No accept step: taking it on again is refused.
    assert.equal((await host.sdk.command('quest.take', { key: 'Granary Rats' })).code, 'REFUSED');

    assert.equal((await host.sdk.command('quest.finish', { key: 'Granary Rats' })).code, 'NOT_ENOUGH');
    const first = await ok(host.sdk.command('combat.win', { foes: [{ name: 'Cellar Rat', count: 2 }] }));
    const second = await ok(host.sdk.command('combat.win', { foes: [{ name: 'Cellar Rat Swarm', count: 1 }, { name: 'Bandit', count: 1 }] }));
    assert.deepEqual(host.sdk.query('quest.progress', { key: 'Granary Rats' }), { have: 3, need: 3, met: true, ready: false, countable: true, source: 'fights', noun: 'cellar rats', label: 'Cellar rats 3/3', reason: '', finish: { ok: true, reason: '' } });

    const finish = await ok(host.sdk.command('quest.finish', { key: 'Granary Rats' }));
    assert.equal(finish.receipt.summary, 'Astra turns in Granary Rats: 3 cellar rats beaten (target 3), 6 gold paid.');
    assert.deepEqual(wallet(host), { coin: 6 });
    assert.deepEqual(claims(host), [`beaten:${first.receipt.rev}`, `beaten:${second.receipt.rev}`, `quest:${rats.id}:paid`].sort());
    assert.equal(quest(host, 'Granary Rats').ended.outcome, 'done');
    // XP through RPG Battle's party.grantXp, called by Story Director.
    assert.deepEqual(host.head().domains.party.xpLog, [{ quest: rats.id, amount: 25, caller: MODULE_ID }]);
    // Once only.
    assert.equal((await host.sdk.command('quest.finish', { key: 'Granary Rats' })).code, 'REFUSED');
    assert.deepEqual(wallet(host), { coin: 6 });

    // The next reply is told the turn-in with code's numbers.
    await host.send('I count the coins.', 'Six gold pieces clink into your palm.');
    assert.match(sentValues(host, TAIL_KEY).at(-1), /\[Happened\][\s\S]*Astra turns in Granary Rats: 3 cellar rats beaten \(target 3\), 6 gold paid\./);
    host.close();
});

test('one fight pays one kill quest; an item quest counts the inventory on its own', async () => {
    const host = await newHost();
    await host.send('Work?', reply('Two notices and a pelt order.', [
        '~ place Bluewatch | kind: settlement',
        '+ quest Rat Bounty — the granary | goal: Kill 2 rats | reward: 5 gold',
        '+ quest Cellar Cull — the cellar | goal: Kill 2 rats | reward: 3 gold',
        '+ quest Pelt Order — the tanner | goal: Bring 2 rat pelts | reward: 1 gold each',
    ]));
    for (const key of ['Rat Bounty', 'Cellar Cull', 'Pelt Order']) assert.ok(quest(host, key).taken, key);
    const fight = await ok(host.sdk.command('combat.win', { foes: [{ name: 'Rat', count: 2 }] }));
    // The same fight's loot: two pelts, from the story.
    await host.send('I skin them.', reply('Two pelts.', ['+ item Rat Pelt | qty: 2']));
    assert.equal(host.sdk.query('quest.progress', { key: 'Cellar Cull' }).have, 2, 'both kill quests see the fight until one is turned in');

    await ok(host.sdk.command('quest.finish', { key: 'Rat Bounty' }));
    assert.equal(host.sdk.query('quest.progress', { key: 'Cellar Cull' }).have, 0);
    assert.equal((await host.sdk.command('quest.finish', { key: 'Cellar Cull' })).code, 'NOT_ENOUGH');
    const pelts = await ok(host.sdk.command('quest.finish', { key: 'Pelt Order' }));
    assert.equal(pelts.receipt.summary, 'Astra turns in Pelt Order: 2 rat pelts handed over (target 2), 2 gold paid.');
    assert.deepEqual(wallet(host), { coin: 7 });
    assert.deepEqual(host.sdk.query('inventory.items'), []);
    assert.ok(claims(host).includes(`beaten:${fight.receipt.rev}`));
    host.close();
});

test('the story\'s + quest takes a quest on whatever the message said; kills count from that reply; + hook makes no quest', async () => {
    const host = await newHost();
    await host.send('What work is there?', reply('Danique pins a notice: wolves on the ridge, five gold.', [
        '~ place Ridgefold | kind: settlement',
        '+ hook Wolf Hunt — wolves on the ridge | giver: Danique | reward: 5 gold',
    ]));
    // Only mentioned: an open thread of the story, no quest, no Offered entry, nothing to accept.
    assert.equal(quest(host, 'Wolf Hunt').kind, 'hook');
    assert.deepEqual(host.sdk.query('quest.board').active, []);
    assert.equal(host.sdk.query('quest.board').offers, undefined);
    await ok(host.sdk.command('combat.win', { foes: [{ name: 'Wolf', count: 2 }] }));

    await host.send('Hm, wolves.', reply('You tell Danique you will do it.', ['+ quest Wolf Hunt — wolves on the ridge | goal: Kill 2 wolves']));
    const hunt = quest(host, 'Wolf Hunt');
    const captured = host.store.at(host.store.headIndex());
    assert.deepEqual([hunt.kind, hunt.offer], ['quest', false]);
    assert.equal(hunt.taken.rev, captured.meta.rev, 'taken at the capture receipt of the reply that wrote + quest');
    assert.deepEqual(hunt.target, { noun: 'wolves', count: 2, kind: 'foes' });
    assert.equal(host.sdk.query('quest.progress', { key: 'Wolf Hunt' }).have, 0, 'the fight before it was taken on does not count');
    assert.deepEqual(host.sdk.query('quest.board').active.map(entry => entry.key), ['Wolf Hunt']);

    await ok(host.sdk.command('combat.win', { foes: [{ name: 'Grey Wolf', count: 2 }] }));
    await ok(host.sdk.command('quest.finish', { key: 'Wolf Hunt' }));
    assert.deepEqual(wallet(host), { coin: 5 });

    // The first message of a chat, or one that says nothing of the job: the story's + quest still takes it.
    const other = await newHost();
    await other.send('Hello.', reply('A notice.', ['+ quest Wolf Hunt — wolves | goal: Kill 2 wolves']));
    assert.ok(quest(other, 'Wolf Hunt').taken);
    host.close();
    other.close();
});

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

test('swipe and delete take a reply\'s quests, takes and payouts back; replay equals rebuild', async () => {
    const host = await newHost();
    await host.send('Any work?', reply('Fenna has a job.', OFFER));
    const offerIndex = host.store.headIndex();
    const takenAt = quest(host, 'Granary Rats').taken;
    await host.send('Let me think.', 'You think it over.');
    await ok(host.sdk.command('combat.win', { foes: [{ name: 'Cellar Rat', count: 3 }] }));
    await ok(host.sdk.command('quest.finish', { key: 'Granary Rats' }));
    assert.deepEqual(wallet(host), { coin: 6 });

    // Rebuilt from what is stored, the state is the same.
    const head = structuredClone(host.head());
    host.store.rebuild();
    assert.deepEqual(host.head(), head);

    // The fight and the payout were on the last reply: deleting it takes them back; the quest stays active.
    await host.st.deleteMessage(host.store.headIndex());
    assert.equal(host.store.headIndex(), offerIndex);
    const rats = quest(host, 'Granary Rats');
    assert.deepEqual([rats.offer, rats.status, rats.taken], [false, 'active', takenAt]);
    assert.deepEqual(wallet(host), {});
    assert.deepEqual(claims(host), []);

    // A swipe of the accepting reply without the + quest: no quest; back to the first swipe: active again.
    await host.st.deleteMessage(host.ctx.chat.length - 1);   // the reader's message after it
    await host.swipe('Fenna shrugs. Nothing today.');
    assert.equal(quest(host, 'Granary Rats'), null);
    await host.st.swipeTo(offerIndex, 0);
    assert.deepEqual(quest(host, 'Granary Rats').taken, takenAt);
    host.close();
});

test('re-narrating a turn-in does not pay twice; the swiped reply is told it again', async () => {
    const host = await newHost();
    await host.send('Any work?', reply('Fenna has a job.', OFFER));
    await ok(host.sdk.command('combat.win', { foes: [{ name: 'Cellar Rat', count: 3 }] }));
    await ok(host.sdk.command('quest.finish', { key: 'Granary Rats' }));
    await host.send('I take the coins.', 'Coins.');
    await host.swipe('Coins, again.');
    assert.match(sentValues(host, TAIL_KEY).at(-1), /turns in Granary Rats/);
    assert.deepEqual(wallet(host), { coin: 6 });
    host.close();
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
    assert.match(text, /\+ quest Name — a job You accepted/, '{{user}} is the reader\'s name');
    assert.match(text, /~ time <date, clock time>/);
    assert.match(text, /Director lines:/);
    assert.match(text, /Quest rewards: when a quest is turned in/);
    assert.match(text, /~ quest Name \| met: yes/);
    assert.match(text, /A passer-by is only a passer-by/);
    // No offers to accept: a hook is an open thread, and + quest is written once the reader accepts.
    assert.match(text, /\+ hook Name — an open thread or lead \(a job only offered stays in the story; \+ quest once You accepts it\)/);
    assert.doesNotMatch(text, /a job only offered: \+ hook with giver, reward/);
    // Another chat with other state sends the same bytes.
    const other = await newHost();
    await other.send('Hi.', 'Hello.');
    assert.equal(sentValues(other, STATIC_KEY)[0], text);
    host.close();
    other.close();
});

test('refusals through the host save nothing and use REFUSED for rule refusals', async () => {
    const host = await newHost();
    await host.send('Any work?', reply('Out on the moor, a job.', [
        '~ place The Moor | kind: wild',
        '+ quest Moor Wolves — wolves | giver: Orsa | goal: Kill 1 wolf | reward: 4 gold',
    ]));
    const before = structuredClone(host.head());
    assert.equal((await host.sdk.command('quest.take', { key: 'Moor Wolves' })).code, 'REFUSED', 'already taken on by its + quest');
    assert.equal((await host.sdk.command('quest.finish', { key: 'Moor Wolves' })).code, 'NOT_ENOUGH');
    assert.equal((await host.sdk.command('quest.take', { key: 'Nobody' })).code, 'NOT_FOUND');
    assert.equal((await host.sdk.command('quest.decline', { key: 'Moor Wolves' })).code, 'UNKNOWN_COMMAND');
    assert.deepEqual(host.head(), before);
    await ok(host.sdk.command('combat.win', { foes: [{ name: 'Wolf', count: 1 }] }));
    const afterFight = structuredClone(host.head());
    const away = await host.sdk.command('quest.finish', { key: 'Moor Wolves' });
    assert.equal(away.code, 'REFUSED');
    assert.match(away.message, /settlement or where Orsa is/);
    assert.deepEqual(host.head(), afterFight, 'no claim, no payout');
    host.close();
});

test('the module registers whole: screens instead of tabs, settings fields, capture kinds, queries', async () => {
    const host = await newHost();
    const mine = host.sdk.modules().find(entry => entry.id === MODULE_ID);
    assert.equal(mine.version, '2.0.0-alpha.1');
    assert.deepEqual(mine.tabs, [], 'the hand-built tabs are gone: the screens show quests, threads and the map');
    assert.deepEqual([...mine.kinds].sort(), ['agenda', 'beat', 'clock', 'event', 'faction', 'hook', 'landmark', 'quest', 'route', 'secret', 'time', 'world']);
    assert.deepEqual([...mine.commands].sort(), ['atlas.edit', 'atlas.focus', 'atlas.visit', 'chronicle.digest', 'chronicle.edit', 'chronicle.note', 'chronicle.remove', 'chronicle.surface', 'director.advance', 'director.seed', 'quest.abandon', 'quest.finish', 'quest.take', 'time.settle']);
    assert.deepEqual(host.sdk.query('director.time'), { minutes: null, text: '' });
    assert.deepEqual(host.registry.screens().filter(screen => screen.moduleId === MODULE_ID).map(screen => screen.id), [
        'story-director/map', 'story-director/chronicle', 'story-director/days', 'story-director/quests', 'story-director/director', 'story-director/status-card', 'story-director/hud',
    ]);
    const defs = host.registry.settingsDefs().find(entry => entry.moduleId === MODULE_ID);
    assert.deepEqual(Object.keys(defs.schema).sort(), [
        'atlas.map.east', 'atlas.map.era', 'atlas.map.kmPerUnit', 'atlas.map.north', 'atlas.map.roadFactor',
        'chronicle.digestDays', 'chronicle.digestKeep', 'chronicle.digestTail',
        'quests.followLadder', 'time.lapses', 'time.recapHours',
        'tracker.calendar.era', 'tracker.calendar.leapYears', 'tracker.calendar.months', 'tracker.calendar.preset', 'tracker.calendar.week',
        'tracker.dormantDays', 'tracker.dormantReplies', 'tracker.dueSoonDays', 'tracker.maxJump',
    ]);
    assert.equal(defs.schema['tracker.calendar.preset'].label, 'Calendar: Calendar');
    assert.deepEqual(defs.schema['tracker.calendar.preset'].options, ['pack', 'gregorian', 'custom']);
    assert.equal(defs.schema['atlas.map.north'].label, 'Map: North is');
    assert.deepEqual(defs.schema['atlas.map.north'].options, ['up', 'down']);
    host.close();
});
