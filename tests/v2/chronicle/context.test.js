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
import { clockAt, command, eventNamed, lines, makeState, replay, runCommand, sceneAt, viewOf } from './helpers/fake-ctx.js';

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
    const empty = part.context.static();
    const busy = (() => { const state = sixEvents(); chronicleTail(viewOf(state)); return part.context.static(); })();
    assert.equal(empty, busy);
    assert.equal(empty, STATIC_TEXT);
    assert.equal(STATIC_TEXT.split('\n').length, 2);
    assert.doesNotMatch(STATIC_TEXT, /\d/);
    assert.match(GRAMMAR.world, /^\+ world Name — /);
    assert.match(GRAMMAR.faction, /^\+ faction Name — /);
    assert.deepEqual(Object.keys(part.kinds).sort(), ['faction', 'world']);
    assert.equal(part.context.budget, TAIL_BUDGET);
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
        picks.push(state.domains.chronicle.surfaced.ids);
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
    assert.deepEqual(again.state.domains.chronicle.surfaced, { at: 2, round: 1, ids: picks[0] });
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
    assert.deepEqual(names(run.state, run.state.domains.chronicle.surfaced.ids), ['Harrow Riots', 'Weir Flood', 'Lake Fever']);
    // Without the atlas only the same place counts.
    const plain = surface(state, { at: 2 });
    assert.equal(names(plain.state, plain.state.domains.chronicle.surfaced.ids)[0], 'Harrow Riots');
    // A pick or two later the far ones come round, the near one still often.
    state = run.state;
    const next = surface(state, { at: 4 }, { atlas, seed: 9 });
    assert.ok(names(next.state, next.state.domains.chronicle.surfaced.ids).includes('Far Trouble'));
    assert.ok(names(next.state, next.state.domains.chronicle.surfaced.ids).includes('Nowhere War'));
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
    const [first] = state.domains.chronicle.surfaced.ids;
    const ended = lines(state, `- world ${state.domains.chronicle.events[first].name} — over`).state;
    const ids = tailPick(ended.domains.chronicle, { at: 2, rev: ended.meta.rev });
    assert.equal(ids.length, TAIL_EVENTS);
    assert.ok(!ids.includes(first));
    assert.deepEqual(ids.slice(0, 2), state.domains.chronicle.surfaced.ids.slice(1));
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
    assert.deepEqual([none.ok, none.state.domains.chronicle.surfaced.ids], [true, []]);
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
