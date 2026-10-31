// Chronicle part: `chronicle.lasting`, a pack event's lasting change to the world. Only a pack event's
// step may write it (`ctx.caller` is `event:<id>`); the entry it writes is locked against the story's own
// `world` lines (a summary may be added to, the state may not move) but not against the reader's edits or
// another lasting change; `keep` holds up to two open entries in every reply's tail; `since` and `updated`
// are the Director's clock (null while it is not set); an entry no pack event wrote has none of the new
// fields, so older chats validate and answer as they did.

import test from 'node:test';
import assert from 'node:assert/strict';

import { MAX_KEPT, initialChronicle, keptEvents, validateChronicle } from '../../../src/v2/chronicle/domain.js';
import { TAIL_HEADER, chronicleTail } from '../../../src/v2/chronicle/note.js';
import { pickEvents, tailPick } from '../../../src/v2/chronicle/pick.js';
import { entryOf } from '../../../src/v2/chronicle/days.js';
import { clockAt, command, eventNamed, line, lines, makeState, query, replay, runCommand, viewOf } from './helpers/fake-ctx.js';
import { part } from '../../../src/v2/chronicle/index.js';

const DAY = 1440;
const BY = 'event:the-seventh-seal-fails';
const SEAL = {
    name: 'Seventh seal failed', state: 'ongoing', place: 'Auvoth', factions: ['Adventurer Guild', 'Sealwardens'],
    summary: 'The seal over Auvoth has failed.', keep: true,
};
const lasting = (state, payload, options = {}) => runCommand(state, part.commands['chronicle.lasting'], payload, { cause: 'system', caller: BY, ...options });
const must = run => { assert.equal(run.ok, true, run.message); return run; };
const shown = tail => tail.lines.slice(1).map(text => text.match(/^- ([^(:.]+?)(?: \(|:|\.)/)[1]);

test('only a pack event may call it: a button, a reply line, another module or a bare "event:" is refused, nothing saved', () => {
    const state = makeState({ minutes: DAY });
    const click = runCommand(state, part.commands['chronicle.lasting'], SEAL, { cause: 'ui' });
    const story = runCommand(state, part.commands['chronicle.lasting'], SEAL, { cause: 'story' });
    const system = runCommand(state, part.commands['chronicle.lasting'], SEAL, { cause: 'system' });
    const module = lasting(state, SEAL, { caller: 'story-director' });
    const bare = lasting(state, SEAL, { caller: 'event:' });
    for (const run of [click, story, system, module, bare]) {
        assert.deepEqual([run.ok, run.code], [false, 'REFUSED']);
        assert.equal(run.state, state, 'nothing saved');
    }
    // The command bus does not expose it as a change line kind either: `world` and `faction` are the only ones.
    assert.deepEqual(Object.keys(part.kinds).sort(), ['faction', 'world']);
});

test('a payload that is not { name, state, summary?, place?, factions?, keep? } within the caps is INVALID', () => {
    const state = makeState({ minutes: DAY });
    const bad = [
        undefined, null, 'text', [],
        { state: 'ongoing' },
        { name: '', state: 'ongoing' },
        { name: '   ', state: 'ongoing' },
        { name: 7, state: 'ongoing' },
        { name: 'x'.repeat(81), state: 'ongoing' },
        { name: 'Fine' },
        { name: 'Fine', state: 'smouldering' },
        { name: 'Fine', state: 'ongoing', summary: 'x'.repeat(241) },
        { name: 'Fine', state: 'ongoing', summary: 5 },
        { name: 'Fine', state: 'ongoing', place: 'x'.repeat(81) },
        { name: 'Fine', state: 'ongoing', place: ['Auvoth'] },
        { name: 'Fine', state: 'ongoing', factions: 'Guild' },
        { name: 'Fine', state: 'ongoing', factions: ['a', 'b', 'c', 'd', 'e'] },
        { name: 'Fine', state: 'ongoing', factions: ['x'.repeat(81)] },
        { name: 'Fine', state: 'ongoing', factions: [''] },
        { name: 'Fine', state: 'ongoing', factions: [3] },
        { name: 'Fine', state: 'ongoing', keep: 'yes' },
        { name: 'Fine', state: 'ongoing', aka: ['Other'] },
    ];
    for (const payload of bad) {
        const run = lasting(state, payload);
        assert.deepEqual([run.ok, run.code], [false, 'INVALID'], JSON.stringify(payload));
        assert.equal(run.state, state);
    }
    // The caps themselves are fine.
    must(lasting(state, { name: 'x'.repeat(80), state: 'looming', summary: 'y'.repeat(240), place: 'z'.repeat(80), factions: ['a', 'b', 'c', 'd'] }));
});

test('it creates the entry: fields as given, since and updated from the clock, the event that wrote it, and keep', () => {
    const state = makeState({ minutes: 10 * DAY });
    const run = must(lasting(state, SEAL));
    const event = eventNamed(run.state, 'Seventh seal failed');
    assert.match(event.id, /^ev_[0-9a-z]{8}$/);
    assert.deepEqual({ ...event, id: undefined }, {
        id: undefined, name: 'Seventh seal failed', summary: 'The seal over Auvoth has failed.', state: 'ongoing', since: 10 * DAY, updated: 10 * DAY,
        place: 'Auvoth', factions: ['Adventurer Guild', 'Sealwardens'], aka: [], rev: 1, by: BY, keep: true,
    });
    assert.equal(run.result.summary, 'World: Seventh seal failed (Auvoth) is now ongoing — The seal over Auvoth has failed.');
    assert.equal(run.result.narrate, false);
    assert.equal(run.result.data.created, true);
    assert.deepEqual(validateChronicle(run.state.domains.chronicle), []);
    assert.ok(run.ops.every(op => op.path.startsWith('/domains/chronicle/') || op.path === '/meta/rev'));
    // Without keep (or with keep: false) the entry has no keep field; only what was given is written.
    const plain = must(lasting(state, { name: 'Quiet change', state: 'looming', keep: false }));
    assert.deepEqual({ ...eventNamed(plain.state, 'Quiet change'), id: undefined }, {
        id: undefined, name: 'Quiet change', summary: '', state: 'looming', since: 10 * DAY, updated: 10 * DAY, place: '', factions: [], aka: [], rev: 1, by: BY,
    });
});

test('it updates the entry with that name (any case) or a name it had; what is left out stays; updated moves, since stays', () => {
    let state = must(lasting(makeState({ minutes: DAY }), SEAL)).state;
    state = clockAt(state, 5 * DAY);
    const run = must(lasting(state, { name: 'seventh SEAL failed', state: 'resolved', summary: 'The seal was mended.' }, { caller: 'event:the-seal-is-mended' }));
    assert.equal(Object.keys(run.state.domains.chronicle.events).length, 1);
    const event = eventNamed(run.state, 'Seventh seal failed');
    assert.deepEqual([event.state, event.summary, event.place, event.factions, event.since, event.updated, event.rev, event.by, event.keep],
        ['resolved', 'The seal was mended.', 'Auvoth', ['Adventurer Guild', 'Sealwardens'], DAY, 5 * DAY, 2, 'event:the-seal-is-mended', true]);
    assert.equal(run.result.summary, 'World: Seventh seal failed (Auvoth) has ended — The seal was mended.');
    // The reader renamed it: the pack's old name still finds it, and the entry keeps the reader's name.
    const renamed = must(command(run.state, 'chronicle.edit', { id: event.id, name: 'The Failing Seal' }));
    const again = must(lasting(renamed.state, { name: 'Seventh seal failed', state: 'ongoing', keep: false }, { caller: 'event:the-seal-breaks-again' }));
    assert.equal(Object.keys(again.state.domains.chronicle.events).length, 1);
    const back = again.state.domains.chronicle.events[event.id];
    assert.deepEqual([back.name, back.state, back.keep, back.by], ['The Failing Seal', 'ongoing', undefined, 'event:the-seal-breaks-again']);
    // The same change twice changes nothing: updated and rev stay.
    const same = must(lasting(again.state, { name: 'The Failing Seal', state: 'ongoing' }, { caller: 'event:the-seal-breaks-again' }));
    assert.equal(same.result.summary, 'World: The Failing Seal is unchanged.');
    assert.equal(same.state.domains.chronicle.events[event.id].rev, back.rev);
    assert.deepEqual(validateChronicle(again.state.domains.chronicle), []);
});

test('a world event the story made becomes a lasting one when a pack event writes it', () => {
    let state = line(makeState({ minutes: DAY }), '+ world Seventh seal failed — rumours | state: looming').state;
    assert.equal(eventNamed(state, 'Seventh seal failed').by, undefined);
    state = must(lasting(state, SEAL)).state;
    assert.equal(Object.keys(state.domains.chronicle.events).length, 1);
    assert.equal(eventNamed(state, 'Seventh seal failed').by, BY);
});

test('the chronicle keeps its caps: a new entry when 60 are open is refused, and the oldest resolved ones go', () => {
    let state = makeState({ minutes: DAY });
    for (let i = 0; i < 60; i += 1) state = must(lasting(state, { name: `Change ${i}`, state: 'ongoing' }, { seed: i + 1 })).state;
    const refused = lasting(state, { name: 'One more', state: 'ongoing' });
    assert.deepEqual([refused.ok, refused.code], [false, 'REFUSED']);
    state = must(lasting(state, { name: 'Change 0', state: 'resolved' })).state;
    state = must(lasting(state, { name: 'One more', state: 'ongoing' })).state;
    assert.equal(Object.keys(state.domains.chronicle.events).length, 60);
    assert.equal(eventNamed(state, 'Change 0'), undefined, 'the resolved one made room');
    assert.ok(eventNamed(state, 'One more'));
});

test('the lock: a world line may add to the summary and move the place, never the state; the card says so', () => {
    const state = must(lasting(makeState({ minutes: DAY }), SEAL)).state;
    const resolve = must(line(state, '~ world Seventh seal failed | state: resolved — the Guild mended it'));
    const event = eventNamed(resolve.state, 'Seventh seal failed');
    assert.equal(event.state, 'ongoing');
    assert.equal(event.summary, 'The seal over Auvoth has failed. the Guild mended it');
    assert.equal(event.by, BY);
    assert.equal(resolve.result.summary, 'World: Seventh seal failed stays ongoing (set by the world\'s timeline); changed: summary.');
    assert.equal(resolve.result.data.held, true);

    // `-` is a state change too; a line that only wants the state changed changes nothing.
    const end = must(line(state, '- world Seventh seal failed'));
    assert.equal(eventNamed(end.state, 'Seventh seal failed').state, 'ongoing');
    assert.equal(end.result.summary, 'World: Seventh seal failed stays ongoing (set by the world\'s timeline).');
    assert.equal(end.ops.filter(op => op.path.startsWith('/domains/chronicle/events/')).length, 0, 'no state written');
    const loom = must(line(state, '~ world Seventh seal failed | state: looming'));
    assert.equal(eventNamed(loom.state, 'Seventh seal failed').state, 'ongoing');

    // Place, factions and a summary that does not change the state go through, with no "stays" on the card.
    const moved = must(line(state, '~ world Seventh seal failed — the Sealwardens flee | place: Harrow | factions: Sealwardens | state: ongoing'));
    const after = eventNamed(moved.state, 'Seventh seal failed');
    assert.deepEqual([after.place, after.factions, after.summary, after.state], ['Harrow', ['Sealwardens'], 'The seal over Auvoth has failed. the Sealwardens flee', 'ongoing']);
    assert.doesNotMatch(moved.result.summary, /stays/);
    // The same words twice are not added twice.
    const twice = must(line(moved.state, '~ world Seventh seal failed — the Sealwardens flee'));
    assert.equal(eventNamed(twice.state, 'Seventh seal failed').summary, after.summary);
    assert.deepEqual(validateChronicle(twice.state.domains.chronicle), []);

    // A resolved lasting entry stays resolved too: the story cannot reopen it.
    const mended = must(lasting(state, { name: 'Seventh seal failed', state: 'resolved' }, { caller: 'event:the-seal-is-mended' })).state;
    const reopen = must(line(mended, '~ world Seventh seal failed | state: ongoing'));
    assert.equal(eventNamed(reopen.state, 'Seventh seal failed').state, 'resolved');
    assert.match(reopen.result.summary, /stays resolved \(set by the world's timeline\)/);
});

test('the lock keeps a long summary inside its cap when a world line adds to it', () => {
    const state = must(lasting(makeState({ minutes: DAY }), { name: 'Long tale', state: 'ongoing', summary: 'word '.repeat(48).trim() })).state;
    const run = must(line(state, `~ world Long tale — ${'new '.repeat(20).trim()}`));
    const event = eventNamed(run.state, 'Long tale');
    assert.ok(event.summary.length <= 300);
    assert.ok(event.summary.endsWith('new new new'));
    assert.match(event.summary, /^word word.*… new/);
    assert.deepEqual(validateChronicle(run.state.domains.chronicle), []);
});

test('the reader may change anything, and clear the lock and the keep; only a pack event locks', () => {
    const state = must(lasting(makeState({ minutes: DAY }), SEAL)).state;
    const id = eventNamed(state, 'Seventh seal failed').id;
    // The edit moves state and name past the lock, and keeps the entry locked.
    const edited = must(command(state, 'chronicle.edit', { id, name: 'The Sealing', state: 'resolved', summary: 'Mended by hand.' }));
    const event = edited.state.domains.chronicle.events[id];
    assert.deepEqual([event.name, event.state, event.summary, event.by, event.keep], ['The Sealing', 'resolved', 'Mended by hand.', BY, true]);
    // The lock can be cleared: the story's lines move the state again.
    const open = must(command(edited.state, 'chronicle.edit', { id, state: 'ongoing', locked: false, keep: false }));
    const free = open.state.domains.chronicle.events[id];
    assert.deepEqual([free.state, free.by, free.keep], ['ongoing', undefined, undefined]);
    assert.equal(open.result.summary, 'The Sealing: ongoing, no longer locked, no longer kept in mind.');
    const moved = must(line(open.state, '~ world The Sealing | state: resolved — done'));
    assert.equal(eventNamed(moved.state, 'The Sealing').state, 'resolved');
    // keep alone, locked alone.
    const kept = must(command(open.state, 'chronicle.edit', { id, keep: true }));
    assert.equal(kept.state.domains.chronicle.events[id].keep, true);
    const unlocked = must(command(state, 'chronicle.edit', { id, locked: false }));
    assert.deepEqual([unlocked.state.domains.chronicle.events[id].by, unlocked.state.domains.chronicle.events[id].keep], [undefined, true]);
    // Nothing the reader can write locks an entry; the flags are only for events.
    for (const payload of [{ id, locked: true }, { id, keep: 'yes' }]) {
        const run = command(state, 'chronicle.edit', payload);
        assert.deepEqual([run.ok, run.code], [false, 'INVALID'], JSON.stringify(payload));
    }
    const faction = must(line(state, '+ faction Sealwardens — the keepers')).state;
    const fid = Object.keys(faction.domains.chronicle.factions)[0];
    assert.equal(command(faction, 'chronicle.edit', { id: fid, keep: true }).code, 'INVALID');
    // And the reader may take the entry out.
    const gone = must(command(state, 'chronicle.remove', { id }));
    assert.deepEqual(Object.keys(gone.state.domains.chronicle.events), []);
});

test('another chronicle.lasting may change anything of a locked entry, state included', () => {
    let state = must(lasting(makeState({ minutes: DAY }), SEAL)).state;
    state = must(lasting(state, { name: 'Seventh seal failed', state: 'resolved' }, { caller: 'event:one' })).state;
    state = must(lasting(state, { name: 'Seventh seal failed', state: 'looming', place: '', factions: [] }, { caller: 'event:two' })).state;
    const event = eventNamed(state, 'Seventh seal failed');
    assert.deepEqual([event.state, event.place, event.factions, event.by], ['looming', '', [], 'event:two']);
});

test('the Director\'s clock not set: since and updated are null, and a delay counted from it never comes due', () => {
    let state = must(lasting(makeState(), SEAL)).state;
    const event = eventNamed(state, 'Seventh seal failed');
    assert.deepEqual([event.since, event.updated], [null, null]);
    assert.deepEqual(validateChronicle(state.domains.chronicle), []);
    for (const minutes of [0, DAY]) assert.equal(query(state, 'chronicle.passed', { name: 'Seventh seal failed', minutes }), false);
    // The clock starts later: still no `since` to count from.
    state = clockAt(state, 400 * DAY);
    assert.equal(query(state, 'chronicle.passed', { name: 'Seventh seal failed', minutes: DAY }), false);
    assert.equal(query(state, 'chronicle.event', { name: 'Seventh seal failed' }).since, null);
});

test('chronicle.passed: true once the clock is `minutes` past the event\'s since; false for anything else', () => {
    const state = must(lasting(makeState({ minutes: 3 * DAY }), SEAL)).state;
    const passed = (now, args) => query(clockAt(state, now), 'chronicle.passed', args);
    assert.equal(passed(4 * DAY - 1, { name: 'Seventh seal failed', minutes: DAY }), false);
    assert.equal(passed(4 * DAY, { name: 'Seventh seal failed', minutes: DAY }), true);
    assert.equal(passed(3 * DAY, { name: 'seventh seal FAILED', minutes: 0 }), true);
    assert.equal(passed(9 * DAY, { id: eventNamed(state, 'Seventh seal failed').id, minutes: 2 * DAY }), true);
    assert.equal(passed(9 * DAY, { name: 'No such change', minutes: 0 }), false);
    for (const minutes of [undefined, null, -1, 1.5, '1440']) assert.equal(passed(9 * DAY, { name: 'Seventh seal failed', minutes }), false);
    // A world event the story made counts the same way, and through a name it had.
    const told = must(line(clockAt(makeState(), 2 * DAY), '+ world Border War — raids')).state;
    assert.equal(query(clockAt(told, 3 * DAY), 'chronicle.passed', { name: 'Border War', minutes: DAY }), true);
});

test('the queries say which entries are locked or kept, and only those; older entries answer as they did', () => {
    let state = line(makeState({ minutes: DAY }), '+ world Border War — raids').state;
    state = must(lasting(state, SEAL)).state;
    const [seal, war] = query(state, 'chronicle.events', {}).sort((a, b) => (a.name < b.name ? 1 : -1));
    assert.equal(seal.name, 'Seventh seal failed');
    assert.deepEqual([seal.locked, seal.keep], [true, true]);
    assert.equal(Object.hasOwn(war, 'locked'), false);
    assert.equal(Object.hasOwn(war, 'keep'), false);
    assert.equal(query(state, 'chronicle.event', { name: 'Seventh seal failed' }).since, DAY);
    // News and the Chronicle screen read the same queries: the entry is there like any world event, open first.
    assert.deepEqual(query(state, 'chronicle.board', {}).open.map(event => event.name).sort(), ['Border War', 'Seventh seal failed']);
});

test('older chats: an entry with neither field validates, a bad `by` or `keep` does not; nothing new is written unless the command runs', () => {
    const state = lines(makeState({ minutes: DAY }), '+ world Border War — raids\n~ world Border War | state: resolved — a truce').state;
    for (const event of Object.values(state.domains.chronicle.events)) assert.deepEqual(Object.keys(event), ['id', 'name', 'summary', 'state', 'since', 'updated', 'place', 'factions', 'aka', 'rev']);
    assert.deepEqual(validateChronicle(state.domains.chronicle), []);
    assert.deepEqual(Object.keys(initialChronicle()), ['events', 'factions', 'seen', 'seenAt', 'round', 'surfaced', 'days', 'written', 'dayFacts', 'noted', 'questLog']);
    const id = Object.keys(state.domains.chronicle.events)[0];
    for (const extra of [{ by: 'story' }, { by: 7 }, { by: 'event:' }, { keep: false }, { keep: 'yes' }, { other: 1 }]) {
        const slice = structuredClone(state.domains.chronicle);
        Object.assign(slice.events[id], extra);
        assert.notDeepEqual(validateChronicle(slice), [], JSON.stringify(extra));
    }
    for (const extra of [{ by: BY }, { by: 'event:a.b/c:d-e' }, { keep: true }, { by: BY, keep: true }]) {
        const slice = structuredClone(state.domains.chronicle);
        Object.assign(slice.events[id], extra);
        assert.deepEqual(validateChronicle(slice), [], JSON.stringify(extra));
    }
});

// ---- keep in mind ----------------------------------------------------------------------------------

function crowd(count, { minutes = DAY } = {}) {
    const block = Array.from({ length: count }, (_, i) => `+ world Trouble ${i + 1} — number ${i + 1}`).join('\n');
    return lines(makeState({ minutes }), block).state;
}

test('keep: the two most recently updated kept open entries take seats first, within the three; a resolved one is not kept', () => {
    let state = crowd(6);
    // Three kept entries, updated on different days: only the newest two are held.
    for (const [i, name] of ['Seal A', 'Seal B', 'Seal C'].entries()) {
        state = clockAt(state, (2 + i) * DAY);
        state = must(lasting(state, { name, state: 'ongoing', keep: true, summary: `kept ${name}` }, { seed: 20 + i })).state;
    }
    assert.equal(MAX_KEPT, 2);
    assert.deepEqual(keptEvents(state.domains.chronicle).map(event => event.name), ['Seal C', 'Seal B']);
    // Many more open than seats: every pick has both kept entries, and the third seat is the best of the rest.
    for (let round = 0; round < 20; round += 1) {
        const ids = pickEvents(state.domains.chronicle, { round, jitter: id => (id.charCodeAt(5) % 10) / 10 });
        assert.equal(ids.length, 3);
        assert.deepEqual(ids.slice(0, 2).map(id => state.domains.chronicle.events[id].name), ['Seal C', 'Seal B']);
    }
    const tail = chronicleTail(viewOf(state));
    assert.equal(tail.lines[0], TAIL_HEADER);
    assert.deepEqual(shown(tail).slice(0, 2), ['Seal C', 'Seal B']);
    assert.equal(tail.lines.length, 4, 'header and three events at most');
    // The oldest kept one keeps nothing: it is a plain open entry among the rest.
    assert.equal(keptEvents(state.domains.chronicle).some(event => event.name === 'Seal A'), false);

    // A kept entry that resolves is not held; the next most recent takes its seat.
    state = clockAt(state, 9 * DAY);
    state = must(lasting(state, { name: 'Seal C', state: 'resolved' }, { seed: 30 })).state;
    assert.deepEqual(keptEvents(state.domains.chronicle).map(event => event.name), ['Seal B', 'Seal A']);
    assert.equal(eventNamed(state, 'Seal C').keep, true, 'the flag stays; a resolved entry is simply not in the tail');
    assert.equal(shown(chronicleTail(viewOf(state))).includes('Seal C'), false);
});

test('keep: with three or fewer open, all are shown, the kept ones first; an entry the reader un-keeps loses its seat', () => {
    let state = lines(makeState({ minutes: DAY }), '+ world Border War — raids\n+ world Red Plague — coughing').state;
    state = clockAt(state, 3 * DAY);
    state = must(lasting(state, SEAL)).state;
    assert.deepEqual(shown(chronicleTail(viewOf(state)))[0], 'Seventh seal failed');
    assert.equal(shown(chronicleTail(viewOf(state))).length, 3);
    const id = eventNamed(state, 'Seventh seal failed').id;
    state = clockAt(state, 4 * DAY);
    state = must(command(state, 'chronicle.edit', { id, keep: false })).state;
    assert.deepEqual(keptEvents(state.domains.chronicle), []);
});

test('keep: a pick already made for this reply still holds the kept entries, even one marked after it', () => {
    let state = crowd(5);
    const surface = runCommand(state, part.commands['chronicle.surface'], { at: 10 }, { cause: 'system' });
    state = surface.state;
    const picked = state.domains.chronicle.surfaced[0]?.ids ?? state.domains.chronicle.surfaced.ids;
    state = clockAt(state, 2 * DAY);
    const left = Object.values(state.domains.chronicle.events).find(event => !picked.includes(event.id));
    state = must(command(state, 'chronicle.edit', { id: left.id, keep: true })).state;
    const ids = tailPick(state.domains.chronicle, { at: 10, rev: 1 });
    assert.equal(ids.length, 3);
    assert.equal(ids[0], left.id);
});

test('without keep a pick is exactly what it was: the same ids, in the same order, for the same seeds', () => {
    const state = crowd(7);
    const before = pickEvents(state.domains.chronicle, { round: 3, jitter: id => (id.charCodeAt(6) % 10) / 10 });
    const withLasting = must(lasting(state, { name: 'Plain change', state: 'resolved' })).state;
    assert.deepEqual(pickEvents(withLasting.domains.chronicle, { round: 3, jitter: id => (id.charCodeAt(6) % 10) / 10 }), before);
    assert.deepEqual(keptEvents(withLasting.domains.chronicle), []);
});

// ---- replay -----------------------------------------------------------------------------------------

test('replay of the ops equals the state they built (create, update, world line held, reader edit)', () => {
    const initial = makeState({ minutes: DAY });
    const runs = [];
    let state = initial;
    const step = run => { must(run); runs.push(run); state = run.state; };
    step(lasting(state, SEAL));
    step(line(state, '~ world Seventh seal failed | state: resolved — the Guild mended it', { seed: 9 }));
    step(lasting(clockAt(state, 3 * DAY), { name: 'Seventh seal failed', state: 'resolved', keep: false }, { caller: 'event:the-seal-is-mended', seed: 11 }));
    step(command(state, 'chronicle.edit', { id: eventNamed(state, 'Seventh seal failed').id, state: 'looming', locked: false }));
    const rebuilt = replay(initial, runs);
    assert.deepEqual(rebuilt.domains.chronicle, state.domains.chronicle);
    assert.deepEqual(validateChronicle(rebuilt.domains.chronicle), []);
});

// ---- the Journal ------------------------------------------------------------------------------------

test('the Journal\'s world line of a day: a pack event\'s lasting change is told like a world line of that reply', () => {
    const state = must(lasting(makeState({ minutes: DAY }), SEAL, { seed: 4 })).state;
    const fire = { rev: 1, type: 'events.fire', cause: 'system', narrate: true, summary: 'The seventh seal has failed.', data: { event: 'the-seventh-seal-fails', then: ['chronicle.lasting'] } };
    const rev = state.domains.chronicle.events[eventNamed(state, 'Seventh seal failed').id].rev;
    assert.equal(rev, 1);
    // Through the query the note reads: the entry the event wrote at that revision, by that event.
    const noted = part.queries['chronicle.noteFacts'](state, { after: 0, minutes: DAY }, { receipts: () => [{ index: 0, receipt: fire }] });
    assert.deepEqual(noted.entries[0].entry.world, [{ id: eventNamed(state, 'Seventh seal failed').id, text: 'World: Seventh seal failed (Auvoth) is ongoing — The seal over Auvoth has failed.' }]);
    const facts = entryOf([fire], 1, { lasting: r => (r === 1 ? [{ id: 'ev_x', by: BY, text: 'World: Seventh seal failed (Auvoth) is ongoing — The seal over Auvoth has failed.' }] : []) });
    assert.deepEqual(facts.world, [{ id: 'ev_x', text: 'World: Seventh seal failed (Auvoth) is ongoing — The seal over Auvoth has failed.' }]);
    assert.deepEqual(facts.happened, [{ text: 'The seventh seal has failed.', told: true }], 'the cue is still a thing that happened');
    // Not for another event's step, nor without the lasting step, nor for a receipt of another revision.
    const other = { ...fire, data: { event: 'another', then: ['chronicle.lasting'] } };
    assert.deepEqual(entryOf([other], 1, { lasting: () => [{ id: 'ev_x', by: BY, text: 'x' }] }).world, []);
    const without = { ...fire, data: { event: 'the-seventh-seal-fails', then: ['wallet.receive'] } };
    assert.deepEqual(entryOf([without], 1, { lasting: () => [{ id: 'ev_x', by: BY, text: 'x' }] }).world, []);
    assert.deepEqual(entryOf([fire], 1).world, [], 'no lasting reader, as before');
});
