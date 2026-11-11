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
import { fakeFightRunner } from './helpers/fake-fight-runner.js';
import { problemList } from '../../../src/v2/tracker/domain.js';
import { BACKLOG_STATIC } from '../../../src/v2/chronicle/digest.js';
// The static part without the one sentence that explains [Earlier days] (taught once a past day is told, module/create.js `backlog`).
const bare = text => String(text).split('\n').filter(line => line !== BACKLOG_STATIC).join('\n');
import { leaderQuery, problemsQuery, swayQuery, validateRipples } from '../../../src/v2/ripples/index.js';

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
    host = await createHost({ modules: [fakeFightRunner(), module], ...options });
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
    assert.deepEqual(host.sdk.query('director.time'), { minutes: null, text: '', parts: null });

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
    assert.equal(new Set(sent(host, STATIC_KEY).map(bare)).size, 1);
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
    assert.equal(new Set(sent(host, STATIC_KEY).map(bare)).size, 1);
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

// ---- Ripples: a hidden sway per pack power (src/v2/ripples), derived from the head state, nothing stored ----

const TABLE = {
    powers: [
        { id: 'wendhild', name: 'Princess Wendhild', aliases: ['Wendhild'], base: 40, factions: ['Wendhild'], givers: ['Sir Lothar'], npcs: [{ name: 'Lothar', weight: 2 }], standing: 'wen' },
        { id: 'corvin', name: 'Prince Corvin', base: 35, givers: ['Corvin'] },
        { id: 'hasse', name: 'Lord Hasse', base: 35, givers: ['Hasse'] },
    ],
    standingModule: 'pack.test/standing',
    worldDirections: [{ event: 'Grain Levy', favours: 'corvin' }],
};
const thread = (key, giver, outcome, difficulty = '') => ({ kind: 'quest', key, summary: '', fields: { giver, difficulty }, status: 'resolved', ended: { outcome } });
const toolsOf = ({ threads = [], events = [], receipts = [], chat = {}, section = TABLE } = {}) => ({
    query: (name, args) => ({
        'packs.ripples': () => section,
        'director.threads': () => threads,
        'chronicle.events': () => events,
        'dataModules.view': () => ({ chat }),
    })[name]?.(args),
    receipts: () => receipts,
});
const problemsQueryOf = section => problemsQuery(DIRECTOR, {}, toolsOf({ section }));
const DIRECTOR = { domains: { director: { time: { minutes: 100 } } } };
const sway = (state, tools, powers) => Object.fromEntries(swayQuery(state, { powers }, tools).map(row => [row.id, row.sway]));
const fight = name => ({ receipt: { type: 'rpg.fight', data: { v2: { result: { fight: { groups: [{ name, count: 2, level: 1 }] } } } } } });

test('ripples: the table is validated; a bad section is ignored with a Problem, never a crash', () => {
    for (const bad of [5, 'x', [], { powers: 'no' }, { powers: [] }, { powers: [{ id: 'A b', name: 'x', base: 1 }] }]) {
        const result = validateRipples(bad);
        assert.equal(result.table, null);
        assert.ok(result.problems.length > 0);
    }
    assert.deepEqual(validateRipples(undefined), { table: null, problems: [] });
    assert.equal(swayQuery(DIRECTOR, {}, toolsOf({ section: { powers: 'no' } })).length, 0, 'a bad section: no rows');
});

test('ripples: each signal (quest done/great/failed/abandoned, world direction, standing, board fight) moves the named power', () => {
    const t = (over) => sway(DIRECTOR, toolsOf(over));
    assert.deepEqual(t({}), { wendhild: 40, corvin: 35, hasse: 35 }, 'no deeds: the base');
    assert.equal(t({ threads: [thread('Escort', 'Sir Lothar', 'done')] }).wendhild, 44, 'done: +4 small');
    assert.equal(t({ threads: [thread('Levy', 'Sir Lothar', 'done', 'hard')] }).wendhild, 48, 'hard: +8 great');
    assert.equal(t({ threads: [thread('Escort', 'Sir Lothar', 'failed')] }).wendhild, 37, 'failed: -3');
    assert.equal(t({ threads: [thread('Escort', 'Sir Lothar', 'abandoned')] }).wendhild, 39, 'abandoned: -1');
    assert.equal(t({ threads: [thread('Escort', 'Sir Lothar', 'declined')] }).wendhild, 40, 'declined: nothing');
    assert.equal(t({ threads: [{ ...thread('Escort', 'Sir Lothar', 'done'), status: 'active', ended: null }] }).wendhild, 40, 'open quests: nothing');
    const levy = { id: 'e1', name: 'Grain Levy', factions: [{ name: 'Wendhild' }], open: false };
    assert.deepEqual(t({ events: [levy] }), { wendhild: 36, corvin: 43, hasse: 35 }, 'a resolved event: the favoured +8, a touched faction -4');
    assert.equal(t({ events: [{ ...levy, open: true }] }).corvin, 35, 'an open event counts nothing');
    assert.equal(t({ chat: { wen: 6 } }).wendhild, 46, 'standing: its key\'s value');
    assert.equal(t({ receipts: [fight('two Lothar guards')] }).wendhild, 36, 'a won fight against its people: -2 x weight 2');
    assert.equal(t({ receipts: [{ receipt: { type: 'rpg.fight', data: {} } }] }).wendhild, 40, 'a receipt with no fight record: nothing');
});

test('ripples: caps (per signal, then per power), ties by pack order, determinism', () => {
    const many = Array.from({ length: 6 }, (_, n) => thread(`Job ${n}`, 'Sir Lothar', 'done', 'hard'));
    assert.equal(sway(DIRECTOR, toolsOf({ threads: many })).wendhild, 52, 'quests stop at the signal cap 12');
    const all = toolsOf({ threads: many, chat: { wen: 50 }, receipts: Array.from({ length: 9 }, () => fight('Lothar')) });
    assert.equal(sway(DIRECTOR, all).wendhild, 56, '12 + 10 - 6 = 16, within the power cap 20');
    const tools = toolsOf();
    assert.equal(leaderQuery(DIRECTOR, { among: ['corvin', 'hasse'], pick: 'top' }, tools), 'corvin', 'a tie: pack order, top');
    assert.equal(leaderQuery(DIRECTOR, { among: ['corvin', 'hasse'], pick: 'bottom' }, tools), 'corvin', 'a tie: pack order, bottom');
    assert.equal(leaderQuery(DIRECTOR, { among: ['wendhild', 'corvin', 'hasse'], pick: 'bottom' }, tools), 'corvin');
    assert.equal(leaderQuery(DIRECTOR, { pick: 'top' }, tools), 'wendhild');
    assert.deepEqual(swayQuery(DIRECTOR, {}, tools), swayQuery(structuredClone(DIRECTOR), {}, toolsOf()), 'the same state, the same answer');
    assert.deepEqual(swayQuery(DIRECTOR, { powers: ['hasse'] }, tools).map(row => row.id), ['hasse'], '`powers` narrows the rows');
});

test('ripples: the reasons say why ("finished ... for Sir Lothar"), biggest first', () => {
    const rows = swayQuery(DIRECTOR, {}, toolsOf({ threads: [thread('Escort', 'Sir Lothar', 'done'), thread('Grain Levy', 'Sir Lothar', 'done', 'hard')] }));
    assert.deepEqual(rows[0].reasons.map(reason => [reason.kind, reason.delta, reason.text]), [
        ['quest', 8, 'finished Grain Levy for Sir Lothar'], ['quest', 4, 'finished Escort for Sir Lothar'],
    ]);
});

test('ripples: null cases (no table, no Director, no clock, a bad pick, nothing among)', () => {
    const tools = toolsOf();
    assert.equal(leaderQuery(DIRECTOR, { pick: 'top' }, toolsOf({ section: null })), null, 'no table');
    assert.deepEqual(swayQuery(DIRECTOR, {}, toolsOf({ section: null })), []);
    assert.equal(leaderQuery({ domains: {} }, { pick: 'top' }, tools), null, 'no Director');
    assert.deepEqual(swayQuery({ domains: {} }, {}, tools), []);
    assert.equal(leaderQuery({ domains: { director: { time: { minutes: null } } } }, { pick: 'top' }, tools), null, 'no clock');
    assert.equal(leaderQuery(DIRECTOR, { pick: 'middle' }, tools), null, 'a bad pick');
    assert.equal(leaderQuery(DIRECTOR, { among: ['nobody'], pick: 'top' }, tools), null, 'nothing among');
    assert.equal(leaderQuery(DIRECTOR, { pick: 'top' }, {}), null, 'no tools');
});

test('ripples on the real host: registered, sway follows the replies and is the same after a rebuild and a delete', async t => {
    t.mock.method(console, 'warn', () => {});
    let host = null;
    const module = createModule({ host: { settings: id => host?.sdk.settings(id) ?? null, substitute: text => host?.sdk.substitute(text) } });
    host = await createHost({ modules: [fakeFightRunner(), module] });
    // Story Block's own packs part answers `packs.ripples` now; hand it an enabled pack that carries the table.
    t.mock.method(host.packs.packs, 'packs', () => [{ id: 'fake-pack', ripples: TABLE }]);
    t.after(() => host.close());
    const rows = () => host.sdk.query('ripples.sway', {}).map(row => [row.id, row.sway]);
    assert.ok(host.registry.query('ripples.leader'), 'the leader query is registered');
    assert.equal(host.sdk.query('ripples.leader', { pick: 'top' }), null, 'no clock yet: no leader');
    await host.send('Hello.', reply('The road.', ['~ time 3 March 1200, 08:00', '+ quest Grain Levy — bring grain | giver: Sir Lothar | goal: grain | difficulty: hard']));
    assert.deepEqual(rows(), [['wendhild', 40], ['corvin', 35], ['hasse', 35]], 'an open quest counts nothing');
    await host.send('Done.', reply('Delivered.', ['- quest Grain Levy — done']));
    const after = rows();
    assert.equal(after[0][1], 48, 'finished: +8');
    assert.equal(host.sdk.query('ripples.leader', { among: ['wendhild', 'corvin', 'hasse'], pick: 'bottom' }), 'corvin');
    host.store.rebuild();
    assert.deepEqual(rows(), after, 'a rebuild gives the same sway');
    const a = host.ctx.chat.length - 1;
    await host.st.deleteMessage(a);
    await host.st.deleteMessage(a - 1);
    assert.deepEqual(rows(), [['wendhild', 40], ['corvin', 35], ['hasse', 35]], 'deleting the reply that finished it takes the sway back');
    assert.deepEqual(host.store.problems(), []);
});

test('ripples: a quest scores for the one power it served; fights lower; whole words; direction by ending; base; problems; receipts bound', () => {
    const t = over => sway(DIRECTOR, toolsOf(over));
    const expose = { ...thread('Expose Lord Hasse', 'Sir Lothar', 'done'), summary: 'proof of Hasse\'s smuggling' };
    assert.deepEqual(t({ threads: [expose] }), { wendhild: 44, corvin: 35, hasse: 35 }, 'the giver\'s power only, not the target');
    const three = { ...thread('Court intrigue', '', 'done'), summary: 'Corvin, Hasse and Wendhild all want it' };
    assert.deepEqual(t({ threads: [three] }), { wendhild: 40, corvin: 35, hasse: 35 }, 'three claimants named, no giver: none');
    assert.equal(t({ threads: [{ ...thread('Escort', '', 'done'), summary: 'for Corvin' }] }).corvin, 39, 'no giver: the one power the summary names');
    assert.equal(t({ threads: [thread('Hunt with the Chasseurs', 'Old Mag', 'done')] }).hasse, 35, 'Chasseurs is not Hasse');
    const levy = { id: 'e1', name: 'Grain Levy', aka: ['Grain Levy'], summary: 'the granaries burned', factions: [], open: false };
    const dir = { ...TABLE, worldDirections: [{ event: 'grain levy', favours: 'corvin', unless: ['burned'] }] };
    assert.equal(t({ events: [levy], section: dir }).corvin, 27, 'ended against the favoured power: -8');
    assert.equal(t({ events: [{ ...levy, summary: 'the grain arrived' }], section: dir }).corvin, 43, 'ended well: +8');
    assert.equal(t({ events: [{ ...levy, name: 'Hunger', summary: 'ok' }], section: dir }).corvin, 43, 'matched by aka, folded');
    assert.equal(t({ chat: { wen: 36 }, section: { ...TABLE, powers: [{ ...TABLE.powers[0], standingBase: 30 }, ...TABLE.powers.slice(1)] } }).wendhild, 46, 'standing: the change since the base');
    const bad = { ...TABLE, powers: [...TABLE.powers, { id: 'Bad Id', name: 'x', base: 1 }] };
    assert.ok(problemsQueryOf(bad).length > 0 && problemsQueryOf(TABLE).length === 0, 'the table\'s Problems are reported');
    const late = [{ index: 1, receipt: fight('Lothar').receipt }, { index: 5, receipt: fight('Lothar').receipt }];
    const bounded = { ...toolsOf({ receipts: late }), reply: { index: 3 } };
    assert.equal(sway(DIRECTOR, bounded).wendhild, 36, 'only the fight up to the queried reply');
});
