// Screens part: the view queries (director.goal, director.next, quest.board) the screens bind to.
// They are built from the Director's own queries through tools.query and read only the state given.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    at, closed, earlierState, fair, headState, makeQueries, makeRunner, makeState, pelts, plot, raid, rats, ring, smuggler, thread, wolves,
} from './helpers/fixtures.js';
import { calendarSetting, createScreensPart, readerWords } from '../../../src/v2/screens/index.js';
import { agendaSteps } from '../../../src/v2/screens/queries.js';
import { toSlot } from '../../../src/v2/slot.js';

const { run } = makeRunner();

test('director.goal is the active quest touched last, never an open offer', () => {
    assert.deepEqual(run(headState(), 'director.goal'), {
        id: 'th_wolves01', key: 'East Bluff Wolves', goal: 'Clear at least 3 wolves from East Bluff', step: 'Hunt along the ridge', giver: 'Orsa', due: '', taken: true,
    });
    // The offer (rev 14) is newer than both quests but is not a goal yet.
    const state = makeState({ threads: [wolves({ rev: 5 }), pelts({ rev: 6 }), rats({ rev: 30 })] });
    assert.equal(run(state, 'director.goal').id, 'th_pelts001');
    // A tie on rev keeps the tracker's order.
    assert.equal(run(makeState({ threads: [pelts({ rev: 4 }), wolves({ rev: 4 })] }), 'director.goal').id, 'th_pelts001');
    // Closed quests and other kinds never count; nothing open is null.
    assert.equal(run(makeState({ threads: [ring(), fair()] }), 'director.goal'), null);
    // A quest without a goal field shows its summary.
    assert.equal(run(makeState({ threads: [thread('th_mill0001', 'quest', 'Old Mill', {}, { summary: 'see what haunts the mill', taken: { rev: 1 } })] }), 'director.goal').goal, 'see what haunts the mill');
});

test('director.next is the open thread whose date comes first; secrets never count', () => {
    const next = run(headState(), 'director.next');
    assert.deepEqual(next, {
        id: 'th_raid0001', key: 'Bandit Raid', kind: 'clock', summary: 'the bandits ride on the mill', field: 'due',
        when: 'June 12, 2025, 8:00 pm', at: at('June 12, 2025, 8:00 pm'), reached: false,
    });
    // The secret is due earlier (June 11) and stays hidden.
    assert.notEqual(next.id, plot().id);
    // Once the time passes the raid, it is the one reached.
    const late = makeState({ minutes: at('June 13, 2025, 7:00 am'), threads: [fair(), raid()] });
    assert.equal(run(late, 'director.next').id, 'th_raid0001');
    assert.equal(run(late, 'director.next').reached, true);
    // A date with no clock time counts for its whole day.
    const fairDay = makeState({ minutes: at('June 14, 2025, 6:00 am'), threads: [fair()] });
    assert.equal(run(fairDay, 'director.next').reached, true);
    // Closed threads, threads with no date and no threads at all give null.
    assert.equal(run(makeState({ threads: [raid(closed('done', 3)), smuggler()] }), 'director.next'), null);
    assert.equal(run(makeState(), 'director.next'), null);
});

test('director.next reads dates on the reader\'s calendar from the settings', () => {
    const calendar = {
        preset: 'custom', era: '', leapYears: false, week: [],
        months: [{ name: 'Goldwane', days: 30 }, { name: 'Haywane', days: 30 }],
    };
    // Without the tracker's director.calendar the screens read the setting they are given …
    const { 'director.calendar': _calendar, ...queries } = makeQueries({ settings: () => ({ calendar }) });
    const custom = makeRunner(queries).run;
    const threads = [
        thread('th_feast001', 'event', 'Feast', { on: 'Haywane 2' }),
        thread('th_toll0001', 'clock', 'Toll', { due: 'Goldwane 20' }),
    ];
    const next = custom(makeState({ threads }), 'director.next');
    assert.equal(next.key, 'Toll');
    // The module's own settings hold the tracker's calendar namespaced and flat (src/v2/module.js).
    const flat = { 'tracker.calendar.preset': 'custom', 'tracker.calendar.months': calendar.months, 'tracker.calendar.week': [], 'tracker.dormantDays': 30 };
    const { 'director.calendar': _flat, ...flatQueries } = makeQueries();
    const fromModule = makeRunner({ ...flatQueries, ...createScreensPart({ settings: () => flat }).queries }).run;
    assert.equal(fromModule(makeState({ threads }), 'director.next').key, 'Toll');
    assert.deepEqual(calendarSetting(flat), { preset: 'custom', months: calendar.months, week: [] });
    assert.equal(calendarSetting({ 'tracker.dormantDays': 30 }), null);
    assert.equal(calendarSetting(null), null);
    // Settings that cannot be read fall back to the Gregorian calendar instead of failing.
    const broken = makeRunner({ ...flatQueries, ...createScreensPart({ settings: () => { throw new Error('no sdk'); } }).queries }).run;
    assert.equal(broken(headState(), 'director.next').id, 'th_raid0001');
    // … and with it, the chat's calendar: here the enabled pack's (the tracker's default preset `pack`).
    const pack = { pack: 'ersveil', era: 'CY', months: calendar.months, start: null };
    const withPack = makeRunner({ ...makeQueries(), 'packs.calendar': () => pack }).run;
    assert.equal(withPack(makeState({ threads }), 'director.next').key, 'Toll');
    assert.equal(run(makeState({ threads }), 'director.next'), null, 'Goldwane is no Gregorian month');
});

test('director.problems: v1\'s {{user}} through the host\'s substitute, else "you" with the verb put right', () => {
    const problems = [
        { rev: 3, kind: 'offered', text: '"Rats" was offered, not taken on: it stays an offer until {{user}} accepts it.' },
        { rev: 4, kind: 'not-chosen', text: '"Rats" stays open: giving it up or turning it down is {{user}}\'s choice, and their message did not make it.' },
        { rev: 5, kind: 'done-offer', text: '"Rats" was offered and the story says it is done: it is a quest {{user}} finished.' },
    ];
    const state = makeState({ problems });
    const plain = run(state, 'director.problems').map(problem => problem.text);
    // An older chat's "was offered" is not shown: there is nothing to accept any more.
    assert.deepEqual(plain, [
        '"Rats" stays open: giving it up or turning it down is your choice, and your message did not make it.',
        '"Rats" was offered and the story says it is done: it is a quest you finished.',
    ]);
    const queries = makeQueries();
    const named = queries['director.problems'](state, {}, { query: () => null, substitute: text => text.replace(/\{\{user\}\}/g, 'Astra') });
    assert.equal(named[0].text, '"Rats" stays open: giving it up or turning it down is Astra\'s choice, and their message did not make it.');
    assert.deepEqual(named.map(problem => [problem.rev, problem.kind]), [[4, 'not-chosen'], [5, 'done-offer']]);
    // A substitute that leaves the macro, or throws, still reads "you".
    assert.match(queries['director.problems'](state, {}, { substitute: text => text })[1].text, /a quest you finished/);
    assert.match(queries['director.problems'](state, {}, { substitute: () => { throw new Error('x'); } })[1].text, /a quest you finished/);
    assert.equal(readerWords('until {{user}} accepts it'), 'until you accept it');
    assert.equal(readerWords('Ask {{User}}.'), 'Ask you.');
    assert.deepEqual(run(makeState(), 'director.problems'), []);
});

test('director.problems: a Problem about a missing goal goes once that is no longer so; one about an offer always', () => {
    const problems = [
        { rev: 3, kind: 'offered', key: 'Granary Rats', text: '"Granary Rats" was offered, not taken on: it stays an offer until {{user}} accepts it.' },
        { rev: 3, kind: 'offered', key: 'East Bluff Wolves', text: '"East Bluff Wolves" was offered, not taken on.' },
        { rev: 4, kind: 'no-goal', key: 'Miller Trouble', text: '"Miller Trouble" has no goal.' },
        { rev: 4, kind: 'no-goal', key: 'Old Mill', text: '"Old Mill" has no goal.' },
        { rev: 5, kind: 'time', text: 'The story time is not set yet.' },
    ];
    const vague = thread('th_vague001', 'quest', 'Miller Trouble', {}, { summary: 'help the miller', taken: { rev: 2 } });
    const given = thread('th_mill0001', 'quest', 'Old Mill', { goal: 'see what haunts the mill' }, { taken: { rev: 2 } });
    const state = makeState({ threads: [rats(), wolves(), vague, given], problems });
    assert.deepEqual(run(state, 'director.problems').map(problem => [problem.kind, problem.rev]), [['no-goal', 4], ['time', 5]],
        'the offers (an older chat\'s) and the mill with its goal are left out');
    // A different module's quest projection cannot override the story's goal field.
    const queries = makeQueries();
    const result = queries['director.problems'](state, {}, { query: () => ({ hasGoal: false }) });
    assert.equal(result.length, 2);
});

test('director.plan: an agenda carries its step progress, place and "arriving within the hour"; one without the pulse\'s fields carries none', () => {
    const fields = { now: 'at the pump', then: 'a; b; c', stepAt: '3', stepOf: '4', stepSince: String(at('June 10, 2025, 9:00 am')), where: 'Bluewatch Village', arrive: 'June 11, 2025, 9:30 am' };
    const agenda = thread('th_bregje01', 'agenda', 'Bregje', fields, { summary: 'manage the desk alone' });
    const plain = thread('th_joren001', 'agenda', 'Joren', { now: 'on the road' }, { summary: 'deliver the tallow' });
    const plan = run(makeState({ minutes: at('June 11, 2025, 9:00 am'), threads: [agenda, plain] }), 'director.plan');
    assert.deepEqual(plan.agendas.map(item => item.steps), [
        { at: 3, of: 4, line: 'step 3 of 4 · since June 10', place: 'Bluewatch Village', arriving: true },
        null,
    ]);
    // An arrival more than an hour away (or already past) is not "within the hour"; no step fields and no place is no progress at all.
    const calendar = { format: minutes => `d${minutes}`, parse: () => null };
    assert.equal(agendaSteps({ arrive: 'x' }, { calendar, now: 100 }), null);
    assert.equal(agendaSteps({ ...fields, arrive: 'June 11, 2025, 11:00 am' }, { calendar: makeState().calendar ?? undefined, now: at('June 11, 2025, 9:00 am') })?.arriving ?? false, false);
    assert.deepEqual(agendaSteps({ stepAt: '2' }, { calendar, now: 0 }), { at: 2, of: 0, line: 'step 2', place: '', arriving: false });
});

test('pulse.view: this reply\'s roll as a row, the earlier rows newest first (not this roll), the table pill, the settings; null is the feature\'s (off)', () => {
    const part = createScreensPart({ settings: { 'pulse.mode': 'quiet', 'pulse.showUnderReply': true } });
    assert.equal(part.queries['pulse.view'].feature, 'story-director.pulse');
    const results = [{ at: 2, clock: 1, kind: 'SKIP', skipped: 'quiet', text: '' }, { at: 4, clock: 2, kind: 'CALM', d20: 1, table: 'duo', text: '' }];
    const base = makeState({ threads: [thread('th_a0000001', 'agenda', 'A', { now: 'x' }, {}), thread('th_b0000001', 'agenda', 'B', { now: 'y' }, {})] });
    const state = { ...base, domains: { ...base.domains, director: { ...base.domains.director, pulse: toSlot({ results }), pulseQuiet: toSlot({ on: true }) } } };
    const view = part.queries['pulse.view'](state, {}, {});
    assert.deepEqual([view.mode, view.quiet, view.card, view.show, view.rollAt, view.count, view.table], ['quiet', true, true, true, 4, 1, 'duo · 2 away']);
    assert.deepEqual(view.recent.map(row => [row.die, row.label, row.text]), [['—', 'Skipped', 'quiet scene']]);
    // Off hides the card; no results yet is an empty card; the setting reads the module's flat key or the part's own.
    assert.equal(createScreensPart({ settings: { mode: 'off' } }).queries['pulse.view'](state, {}, {}).card, false);
    const empty = createScreensPart({ settings: {} }).queries['pulse.view'](base, {}, {});
    assert.deepEqual([empty.mode, empty.quiet, empty.show, empty.now, empty.rollAt, empty.table], ['lively', false, false, null, -1, '']);
});

test('pulse.quiet: the header switch\'s state ({ on }) under the pulse feature, null while the pulse is off; the part declares the one header control; localSwitch is the stand-alone path', () => {
    const part = createScreensPart({ settings: { 'pulse.mode': 'lively' } });
    assert.equal(part.queries['pulse.quiet'].feature, 'story-director.pulse');
    assert.deepEqual(part.headerControls, [{ id: 'quiet', label: 'Quiet scene', icon: '🌙', query: 'pulse.quiet', command: 'director.pulse.quiet', feature: 'story-director.pulse' }]);
    const base = makeState({});
    const on = { ...base, domains: { ...base.domains, director: { ...base.domains.director, pulseQuiet: toSlot({ on: true }) } } };
    assert.deepEqual(part.queries['pulse.quiet'](on, {}, {}), { on: true });
    assert.deepEqual(part.queries['pulse.quiet'](base, {}, {}), { on: false });
    assert.equal(createScreensPart({ settings: { mode: 'off' } }).queries['pulse.quiet'](on, {}, {}), null, 'mode Off: no pill');
    // No host to ask: the Director tab keeps its own switch. A host whose modules carry a headerControls list takes it over; an older host's do not.
    assert.equal(part.queries['pulse.view'](base, {}, {}).localSwitch, true);
    const before = globalThis.StoryBlock;
    try {
        globalThis.StoryBlock = { sdk: { modules: () => [{ id: 'story-block', headerControls: [] }] } };
        assert.equal(part.queries['pulse.view'](base, {}, {}).localSwitch, false);
        globalThis.StoryBlock = { sdk: { modules: () => [{ id: 'story-block' }] } };
        assert.equal(part.queries['pulse.view'](base, {}, {}).localSwitch, true);
        globalThis.StoryBlock = { sdk: { modules: () => { throw new Error('not yet'); } } };
        assert.equal(part.queries['pulse.view'](base, {}, {}).localSwitch, true, 'a host that cannot be asked: the switch stays');
        globalThis.StoryBlock = { sdk: { modules: () => [{ id: 'story-block', headerControls: [] }] } };
        assert.equal(createScreensPart({ settings: { mode: 'off' } }).queries['pulse.view'](base, {}, {}).localSwitch, false, 'mode Off: no switch anywhere');
    } finally {
        if (before === undefined) delete globalThis.StoryBlock; else globalThis.StoryBlock = before;
    }
});

test('director.older and the Behind view count the older finished threads the fold summarised (CX item 5)', () => {
    const base = makeState({ threads: [wolves({ rev: 5 })] });
    const record = (n, kind, key, goal) => ({ id: `th_old0000${n}`, kind, key, outcome: 'done', order: n, ...(goal ? { goal: true } : {}) });
    const folded = { 7: { rev: 7, items: [record(1, 'quest', 'Old Rats'), record(2, 'hook', 'Old Hook'), record(3, 'secret', 'Old Vault'), record(4, 'agenda', 'Old Walk'), record(5, 'event', 'Old Feast', true)] } };
    const state = { ...base, domains: { ...base.domains, director: { ...base.domains.director, folded } } };
    // The Quests footer counts what the screen drew as cards (a quest, or any thread with a goal: here the quest and the goal event); the Director footer the rest.
    assert.deepEqual(run(state, 'director.older'), { quests: 2, other: 3, total: 5 });
    assert.equal(run(state, 'director.behind').older, 2);
    // A key a live thread has again is read from that thread, not counted as older.
    const remade = { ...state, domains: { ...state.domains, director: { ...state.domains.director, keys: { ...state.domains.director.keys, 'old rats': 'th_new00001' } } } };
    assert.deepEqual(run(remade, 'director.older'), { quests: 1, other: 3, total: 4 });
    assert.deepEqual(run(makeState({ threads: [wolves({ rev: 5 })] }), 'director.older'), { quests: 0, other: 0, total: 0 });
});
