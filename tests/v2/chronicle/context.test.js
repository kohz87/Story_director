// Chronicle part: what the model is told. The static part is fixed bytes; the tail holds at most
// three open events picked by code, the same for the same reply, favouring the least recently
// shown and the ones near the scene, each with how long since its last news; the beforeGenerate
// hook records the pick once per reply.

import test from 'node:test';
import assert from 'node:assert/strict';

import { GRAMMAR, STATIC_TEXT, TAIL_BUDGET, TAIL_HEADER, chronicleTail } from '../../../src/v2/chronicle/note.js';
import { SURFACE, TAIL_EVENTS, beforeGenerate, hashUnit, nearness, pickEvents, pickFresh, tailPick } from '../../../src/v2/chronicle/pick.js';
import { agoText } from '../../../src/v2/chronicle/queries.js';
import { part } from '../../../src/v2/chronicle/index.js';
import { createModule } from '../../../src/v2/module.js';
import { memoQueries } from '../../../src/v2/module/contexts.js';
import { BACKLOG_BUDGET, BACKLOG_STATIC, DIGEST_TAIL_BUDGET, backlogLines } from '../../../src/v2/chronicle/digest.js';
import { BACKLOG_CHARS, BACKLOG_LINES, BACKLOG_TAG, agoWords, backlogBlock } from '../../../src/v2/chronicle/backlog.js';
import { clockAt, command, eventNamed, lines, makeState, replay, runCommand, sceneAt, viewOf } from './helpers/fake-ctx.js';
import { seenOf, surfacedOf } from '../../../src/v2/chronicle/domain.js';

const DAY = 1440;
const surface = (state, payload, options = {}) => runCommand(state, part.commands[SURFACE], payload, { cause: 'system', ...options });
const tailOf = (state, options) => chronicleTail(viewOf(state, options));
const names = (state, ids) => ids.map(id => state.domains.chronicle.events[id].name);
const shown = tail => tail.lines.slice(1).map(text => text.match(/^- ([^(:.]+?)(?: \(|:|\.)/)[1]);

function sixEvents() {
    const block = ['Border War', 'Red Plague', 'Dragon Calamity', 'Grain Shortage', 'Long Winter', 'Guild Strike']
        .map((name, i) => `+ world ${name} — trouble number ${i + 1}`).join('\n');
    return lines(makeState({ minutes: DAY }), block).state;
}

test('the static part is the same bytes whatever the state; it names no event, count or time', () => {
    // The lean diet: the paragraphs and the grammar are taught only while the story keeps a world event or a faction (env.chronicle).
    const empty = part.context.static({ chronicle: true });
    const busy = (() => { const state = sixEvents(); chronicleTail(viewOf(state)); return part.context.static({ chronicle: true }); })();
    assert.equal(empty, busy);
    assert.equal(empty, STATIC_TEXT);
    assert.equal(part.context.static({ chronicle: false }), '');
    assert.equal(part.kinds.world.grammar, GRAMMAR.world, 'the world and faction line is always taught');
    assert.equal(STATIC_TEXT.split('\n').length, 2);
    assert.doesNotMatch(STATIC_TEXT, /\d/);
    assert.match(GRAMMAR.world, /^\+ world Name — /);
    assert.match(GRAMMAR.world, /; \+ faction Name — /);
    assert.equal(GRAMMAR.faction, '', 'the faction has no line of its own: the world line carries it');
    assert.deepEqual(Object.keys(part.kinds).sort(), ['faction', 'world']);
    assert.equal(part.context.budget, TAIL_BUDGET + DIGEST_TAIL_BUDGET + BACKLOG_BUDGET);
});

test('no open event, no tail; three or fewer open: all of them, with their place and the last news', () => {
    assert.deepEqual(tailOf(makeState()), { lines: [], optional: [] });
    let state = lines(makeState({ minutes: DAY }), '+ world Siege — over | state: resolved').state;
    assert.deepEqual(tailOf(state).lines, []);
    state = lines(state, '+ world Dragon Calamity — awakens near Dragonfang. | place: Dragonfang\n+ world Red Plague — coughing in the docks | state: looming').state;
    state = clockAt(state, 4 * DAY + 120);
    const tail = tailOf(state);
    assert.equal(tail.lines[0], TAIL_HEADER);
    assert.deepEqual(tail.lines.slice(1).sort(), [
        '- Dragon Calamity (Dragonfang): awakens near Dragonfang. Last news 3 days ago.',
        '- Red Plague: coughing in the docks. Last news 3 days ago.',
    ]);
    assert.deepEqual(tail.optional, []);
    // Without a clock, no "last news".
    const unset = lines(makeState(), '+ world Red Plague — coughing').state;
    assert.deepEqual(tailOf(unset).lines, [TAIL_HEADER, '- Red Plague: coughing.']);
});

test('the same state and reply always give the same three; the tail stays within its budget', () => {
    const state = sixEvents();
    const first = tailOf(state);
    assert.equal(first.lines.length, 1 + TAIL_EVENTS);
    for (let i = 0; i < 5; i += 1) assert.deepEqual(tailOf(state), first);
    assert.ok(first.lines.join('\n').length <= TAIL_BUDGET * 4);
    // Long names and summaries are cut, never past the budget.
    const long = lines(makeState({ minutes: DAY }), Array.from({ length: 5 }, (_, i) => `+ world ${'W'.repeat(70)}${i} — ${'very long words '.repeat(18)} | place: ${'P'.repeat(70)}`).join('\n')).state;
    const tail = tailOf(long);
    assert.ok(tail.lines.join('\n').length <= TAIL_BUDGET * 4, tail.lines.join('\n').length);
    assert.ok(tail.lines.length >= 2);
});

test('chronicle.surface rotates: each pick favours the events shown least recently', () => {
    let state = sixEvents();
    const picks = [];
    for (let round = 1; round <= 4; round += 1) {
        const run = surface(state, { at: round * 2 }, { seed: 100 + round });
        assert.equal(run.ok, true, run.message);
        state = run.state;
        picks.push(surfacedOf(state.domains.chronicle).ids);
        assert.equal(state.domains.chronicle.round, round);
        assert.equal(run.result.narrate, false);
        // The tail shows exactly the recorded pick for that reply.
        assert.deepEqual(shown(tailOf(state, { at: round * 2 })), names(state, picks.at(-1)));
    }
    // Six events, three a reply: the second pick is the three the first left out, and so on.
    assert.equal(new Set([...picks[0], ...picks[1]]).size, 6);
    assert.equal(new Set([...picks[1], ...picks[2]]).size, 6);
    assert.deepEqual(new Set(picks[2]), new Set(picks[0]));
    // Replay of the ops gives the same picks (Story Block replays ops, it never runs the command again).
    const again = surface(sixEvents(), { at: 2 }, { seed: 101 });
    assert.deepEqual(surfacedOf(again.state.domains.chronicle), { at: 2, round: 1, ids: picks[0] });
    assert.deepEqual(replay(sixEvents(), [again]), again.state);
});

test('events near the scene are favoured: the same place, then a route away, then the same region', () => {
    const atlas = { routes: { Harrow: ['Old Weir'] }, regions: { Harrow: 'Lakeshore', Bluewatch: 'Lakeshore', Dragonfang: 'Peaks' } };
    let state = lines(makeState({ minutes: DAY, place: 'Harrow' }), [
        '+ world Far Trouble — far | place: Dragonfang',
        '+ world Weir Flood — the weir breaks | place: near the Old Weir',
        '+ world Lake Fever — sickness | place: Bluewatch',
        '+ world Harrow Riots — riots | place: Harrow',
        '+ world Nowhere War — war',
    ].join('\n')).state;
    const near = nearness((name, args) => viewOf(state, { atlas }).query(name, args), 'Harrow');
    assert.deepEqual(['Harrow', 'near the Old Weir', 'Bluewatch', 'Dragonfang', ''].map(near), [3, 2, 1, 0, 0]);
    const run = surface(state, { at: 2 }, { atlas });
    assert.deepEqual(names(run.state, surfacedOf(run.state.domains.chronicle).ids), ['Harrow Riots', 'Weir Flood', 'Lake Fever']);
    // Without the atlas only the same place counts.
    const plain = surface(state, { at: 2 });
    assert.equal(names(plain.state, surfacedOf(plain.state.domains.chronicle).ids)[0], 'Harrow Riots');
    // A pick or two later the far ones come round, the near one still often.
    state = run.state;
    const next = surface(state, { at: 4 }, { atlas, seed: 9 });
    assert.ok(names(next.state, surfacedOf(next.state.domains.chronicle).ids).includes('Far Trouble'));
    assert.ok(names(next.state, surfacedOf(next.state.domains.chronicle).ids).includes('Nowhere War'));
    // The scene moved: the tail fallback (no recorded pick for this reply) follows it.
    const moved = sceneAt(next.state, 'Dragonfang');
    assert.equal(shown(tailOf(moved, { at: 40, atlas }))[0], 'Far Trouble');
});

test('the beforeGenerate hook: a pick only with more than three open, once per reply (a swipe keeps it)', () => {
    const few = lines(makeState(), '+ world A — a\n+ world B — b\n+ world C — c').state;
    assert.equal(beforeGenerate(viewOf(few, { at: 4 })), undefined, 'three open: all are shown, nothing to choose');
    assert.equal(beforeGenerate(viewOf(makeState(), { at: 4 })), undefined);
    const state = sixEvents();
    assert.deepEqual(beforeGenerate(viewOf(state, { at: 4 })), { commands: [{ type: SURFACE, payload: { at: 4 } }] });
    assert.equal(beforeGenerate({ state, chat: {} }), undefined, 'no chat length: the tail picks by hash instead');
    const picked = surface(state, { at: 4 }).state;
    // The reply being swiped or regenerated (the chat holds it, or not yet): the pick stands.
    assert.equal(beforeGenerate(viewOf(picked, { at: 4 })), undefined);
    assert.equal(beforeGenerate(viewOf(picked, { at: 5 })), undefined);
    assert.deepEqual(shown(tailOf(picked, { at: 5 })), shown(tailOf(picked, { at: 4 })));
    // The next reply: a new pick.
    assert.deepEqual(beforeGenerate(viewOf(picked, { at: 6 })), { commands: [{ type: SURFACE, payload: { at: 6 } }] });
    assert.equal(pickFresh(null, 4), false);
    assert.equal(pickFresh({ at: 4 }, 3), false);
});

test('a recorded pick whose event has ended since is topped up; the hashed fallback is stable per rev', () => {
    let state = surface(sixEvents(), { at: 2 }).state;
    const [first] = surfacedOf(state.domains.chronicle).ids;
    const ended = lines(state, `- world ${state.domains.chronicle.events[first].name} — over`).state;
    const ids = tailPick(ended.domains.chronicle, { at: 2, rev: ended.meta.rev });
    assert.equal(ids.length, TAIL_EVENTS);
    assert.ok(!ids.includes(first));
    assert.deepEqual(ids.slice(0, 2), surfacedOf(state.domains.chronicle).ids.slice(1));
    // The hashed pick: the same for the same rev.
    state = sixEvents();
    assert.deepEqual(tailPick(state.domains.chronicle, { rev: 7 }), tailPick(state.domains.chronicle, { rev: 7 }));
    assert.equal(hashUnit('7:ev_00000001'), hashUnit('7:ev_00000001'));
    assert.ok(hashUnit('a') >= 0 && hashUnit('a') < 1);
    assert.deepEqual(pickEvents(state.domains.chronicle, { round: 1, limit: 0 }), []);
});

test('chronicle.surface is the hook\'s, not a click\'s; a bad "at" is refused', () => {
    const state = sixEvents();
    const click = command(state, SURFACE, { at: 2 });
    assert.deepEqual([click.ok, click.code], [false, 'REFUSED']);
    const bad = surface(state, { at: -1 });
    assert.deepEqual([bad.ok, bad.code], [false, 'INVALID']);
    // A pick for no open event records an empty pick without fault.
    const none = surface(makeState(), { at: 2 });
    assert.deepEqual([none.ok, surfacedOf(none.state.domains.chronicle).ids], [true, []]);
});

test('"how long ago" in plain words', () => {
    assert.deepEqual([0, 59, 60, 23 * 60, DAY, 3 * DAY, 13 * DAY, 20 * DAY, 90 * DAY, 800 * DAY].map(agoText), [
        'this hour', 'this hour', '1 h ago', '23 h ago', '1 day ago', '3 days ago', '13 days ago', '2 weeks ago', '3 months ago', '2 years ago',
    ]);
    assert.equal(agoText(-5), '');
    assert.equal(agoText(null), '');
    const state = lines(makeState({ minutes: DAY }), '+ world Red Plague — coughing').state;
    assert.equal(eventNamed(state, 'Red Plague').updated, DAY);
});

// ---- [Earlier days] (spec items 8 and 9) -------------------------------------------------------------------------------------

const pastDay = (day, extra = {}) => ({ day, date: `Goldwane ${day}`, short: `a quiet day ${day}.`, happened: [], eventLines: [], search: `Goldwane ${day}`, ...extra });

test('8: [Earlier days]: nothing on a first day or with no clock; "N days ago" counted in code; newest day first; one line per day', () => {
    assert.deepEqual(backlogBlock({ days: [pastDay(20)], now: 20 * DAY + 600 }), [], 'today only: nothing yet');
    assert.deepEqual(backlogBlock({ days: [pastDay(19)], now: null }), []);
    assert.deepEqual([0, 1, 3, 13].map(agoWords), ['today', 'yesterday', '3 days ago', '13 days ago']);
    const block = backlogBlock({ days: [pastDay(18, { eventLines: ['Astra failed to deliver the salt'] }), pastDay(19), pastDay(20)], now: 21 * DAY });
    assert.equal(block[0], BACKLOG_TAG);
    assert.deepEqual(block.slice(1), ['Goldwane 20 (yesterday): a quiet day 20.', 'Goldwane 19 (2 days ago): a quiet day 19.']);
    assert.ok(!block.join('\n').includes('Goldwane 18'), 'a third-last day with nothing to do with the scene stays out');
});

test('8: relevance: people present, the current place and open threads pull an older day in; the last two days are always in; at most 6 lines and about 200 tokens', () => {
    const days = [
        pastDay(10, { eventLines: ['Derk blamed Astra for the salt'], search: 'Goldwane 10 • Derk blamed Astra for the salt' }),
        pastDay(11, { eventLines: ['Camped at Charcoal Pits'], search: 'Goldwane 11 • Camped at Charcoal Pits' }),
        pastDay(12, { eventLines: ['Grey Ledger sealed the tally'], search: 'Goldwane 12 • Grey Ledger sealed the tally' }),
        pastDay(13, { eventLines: ['Nothing to do with it'], search: 'Goldwane 13 • nothing' }),
        pastDay(18), pastDay(19),
    ];
    const lines = block => block.slice(1).map(line => line.split(':')[0]);
    assert.deepEqual(lines(backlogBlock({ days, now: 20 * DAY, present: ['Derk'], place: 'Charcoal Pits', threads: ['Grey Ledger'] })), ['Goldwane 19 (yesterday)', 'Goldwane 18 (2 days ago)', 'Goldwane 10 (10 days ago)', 'Goldwane 11 (9 days ago)', 'Goldwane 12 (8 days ago)'].sort((a, b) => Number(b.match(/\d+/)[0]) - Number(a.match(/\d+/)[0])));
    assert.ok(!backlogBlock({ days, now: 20 * DAY, present: ['Derk'] }).join('\n').includes('Goldwane 13'));
    // The cap: many relevant days, at most BACKLOG_LINES lines and BACKLOG_CHARS characters.
    const many = Array.from({ length: 30 }, (_, i) => pastDay(i, { eventLines: [`Derk did thing ${i} ${'x'.repeat(120)}`], search: `Derk ${i}` }));
    const big = backlogBlock({ days: many, now: 40 * DAY, present: ['Derk'] });
    assert.ok(big.length - 1 <= BACKLOG_LINES);
    assert.ok(big.join('\n').length <= BACKLOG_CHARS + 2);
    assert.equal(backlogBlock({ days: many, now: 40 * DAY, present: ['Derk'] }).join('\n'), big.join('\n'), 'deterministic');
});

test('8: the per-thread rule: the Journal\'s one row per thread feeds the block, and the line reads "date (N days ago): …"', () => {
    const day = pastDay(18, { eventLines: ['Perimeter Sweep (finished, 2 steps today): the basilisk bled out.'], search: 'Perimeter Sweep' });
    const block = backlogBlock({ days: [day], now: 21 * DAY, threads: ['Perimeter Sweep'] });
    assert.deepEqual(block, [BACKLOG_TAG, 'Goldwane 18 (3 days ago): Perimeter Sweep (finished, 2 steps today): the basilisk bled out.']);
});

test('8: backlogLines reads the Journal\'s known days (never a hidden line), the scene and the open threads; nothing while the digest is off', () => {
    const journal = { days: [pastDay(18, { eventLines: ['Derk blamed Astra'], search: 'Derk' }), pastDay(19)] };
    const query = (name) => ({
        'director.journal': journal, 'director.time': { minutes: 20 * DAY }, 'scene.place': { name: 'Bluewatch' }, 'scene.present': [{ name: 'Derk' }], 'npc.present': ['Torka'],
        'director.threads': [{ key: 'Salt run', status: 'active' }, { key: 'Old', status: 'resolved' }],
    }[name] ?? null);
    const view = { state: { domains: { chronicle: {}, director: { time: { minutes: 20 * DAY } } } }, query, feature: () => true };
    const lines = backlogLines(view);
    assert.equal(lines[0], BACKLOG_TAG);
    assert.match(lines[1], /^Goldwane 19 \(yesterday\)/);
    assert.match(lines.join('\n'), /Goldwane 18 \(2 days ago\): Derk blamed Astra/);
    assert.deepEqual(backlogLines({ ...view, feature: () => false }), []);
    assert.deepEqual(backlogLines({ ...view, query: () => null }), []);
});

test('8: backlogLines is worked out once per prompt build (the memoized query), and again for the next build', () => {
    let reads = 0;
    const query = name => { if (name === 'director.journal') reads++; return { 'director.journal': { days: [pastDay(19)] }, 'director.time': { minutes: 20 * DAY } }[name] ?? null; };
    const view = { state: { domains: { chronicle: {}, director: { time: { minutes: 20 * DAY } } } }, query, feature: () => true };
    const build = memoQueries(view);
    const first = backlogLines(build);
    first.push('mutated');
    assert.deepEqual(backlogLines(build), backlogLines(build));
    assert.equal(backlogLines(build).includes('mutated'), false);
    assert.equal(reads, 1);
    backlogLines(memoQueries(view));
    assert.equal(reads, 2);
    // a view that is not a build's memo is never kept
    backlogLines(view); backlogLines(view);
    assert.equal(reads, 4);
});

test('8: the module learns "Earlier days" once per head and follows the feature, the settings, the packs and the head', () => {
    let reads = 0;
    let on = true;
    let packs = [];
    const journal = { days: [pastDay(19)] };
    const view = (state, extra = {}) => ({
        state, feature: () => on, settings: () => ({}),
        query: name => { if (name === 'director.journal') reads++; return { 'director.journal': journal, 'director.time': { minutes: 20 * DAY }, 'packs.list': packs }[name] ?? null; },
        ...extra,
    });
    const make = () => ({ domains: { chronicle: {}, director: { time: { minutes: 20 * DAY } } } });
    const def = createModule({ parts: [['chronicle', part]] });
    const taught = () => def.context.parts.some(entry => entry.static?.() === BACKLOG_STATIC);
    const head = make();
    def.hooks.beforeGenerate(view(head));
    assert.equal(taught(), true);
    const after = reads;
    def.hooks.beforeGenerate(view(head));
    assert.equal(reads, after);
    on = false;
    def.hooks.beforeGenerate(view(head));
    assert.equal(taught(), false);
    on = true;
    def.hooks.beforeGenerate(view(head));
    assert.equal(taught(), true);
    packs = [{ id: 'p' }];
    const before = reads;
    def.hooks.beforeGenerate(view(head));
    assert.equal(reads > before, true);
    const again = reads;
    def.hooks.beforeGenerate(view(make()));
    assert.equal(reads > again, true);
    journal.days = [];
    def.hooks.beforeGenerate(view(make()));
    assert.equal(taught(), false);
});

test('9: the one static sentence is taught only while the block has lines (env.backlog), under the digest feature', () => {
    const inline = part.context.inline[0];
    assert.equal(inline.feature, 'story-director.digest');
    assert.equal(inline.static({ backlog: false }), '');
    assert.equal(inline.static({}), '');
    assert.equal(inline.static({ backlog: true }), BACKLOG_STATIC);
    assert.doesNotMatch(BACKLOG_STATIC, /\d/);
    assert.equal(part.context.static({ chronicle: false }), '', 'the world paragraph\'s own gate is untouched');
});

// ---- [Earlier days]: who was there ---------------------------------------------------------------------------------------------

test('witnesses: a backlog line names who was there, three names then "+N"; a day stored without them reads as before', () => {
    const days = [
        pastDay(18, { eventLines: ['Astra signed the ledger with the wrong seal'], eventWho: [['Bregje', 'Torka', 'Dag', 'Eli', 'Fay']] }),
        pastDay(19, { eventLines: ['Camped by the ford'], eventWho: [['Bregje']] }),
        pastDay(20, { eventLines: ['Crossed the ford'] }),
    ];
    const named = backlogBlock({ days: [pastDay(19, { eventLines: ['Astra signed the ledger with the wrong seal'], eventWho: [['Bregje', 'Torka', 'Dag', 'Eli', 'Fay']] }), pastDay(20)], now: 21 * DAY, present: ['Astra'] });
    assert.equal(named[2], 'Goldwane 19 (2 days ago): Astra signed the ledger with the wrong seal (Bregje, Torka, Dag +2)');
    const old = backlogBlock({ days: [pastDay(19, { eventLines: ['Astra signed the ledger with the wrong seal'] }), pastDay(20)], now: 21 * DAY, present: ['Astra'] });
    assert.equal(old[2], 'Goldwane 19 (2 days ago): Astra signed the ledger with the wrong seal', 'an old day has no names');
    assert.equal(backlogBlock({ days: [pastDay(19, { eventLines: ['Astra signed'], eventWho: [['Bregje', 'Torka']] }), pastDay(20)], now: 21 * DAY, present: ['Astra'] })[2], 'Goldwane 19 (2 days ago): Astra signed (Bregje, Torka)');
    assert.deepEqual(backlogBlock({ days, now: 21 * DAY, present: ['Astra'] }), backlogBlock({ days, now: 21 * DAY, present: ['Astra'] }), 'deterministic');
});

test('witnesses: over the budget the plain lines are fitted first, then names go back on from the top; names alone never cost a line', () => {
    const long = 'Astra weighed the long grey ledger against the wrong seal twice and wrote it down';
    const days = [11, 12, 13, 14, 15, 16].map(day => pastDay(day, { eventLines: [`${long} ${day}`], eventWho: [['Bregje', 'Torka', 'Dag', 'Eli']], search: `Astra ${day}` }));
    const plainOnly = backlogBlock({ days: days.map(day => ({ ...day, eventWho: undefined })), now: 20 * DAY, present: ['Astra'] });
    const block = backlogBlock({ days, now: 20 * DAY, present: ['Astra'] });
    assert.ok(block.join('\n').length <= BACKLOG_CHARS);
    assert.equal(block.length, plainOnly.length, 'names never push a line out');
    const named = block.slice(1).map(line => line.endsWith('+1)'));
    assert.ok(named[0], 'the top line keeps its names while there is room');
    assert.ok(named.every((has, index) => has || named.slice(index).every(later => !later)), 'names are lost from the end of the ranking first');
    // Plain lines that together run over the budget still leave room for names on the surviving ones.
    const body = 'x'.repeat(90);
    const tight = [11, 12, 13, 14, 15, 16].map(day => pastDay(day, { eventLines: [`Astra ${body} ${day}`], eventWho: [['Bregje']], search: `Astra ${day}` }));
    const out = backlogBlock({ days: tight, now: 20 * DAY, present: ['Astra'] });
    assert.ok(out.join('\n').length <= BACKLOG_CHARS);
    assert.ok(out.slice(1).some(line => line.endsWith('(Bregje)')), 'not every name is stripped when there is room');
});
