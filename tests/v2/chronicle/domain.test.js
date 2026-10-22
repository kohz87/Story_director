// Chronicle part: the `chronicle` domain's shape, validator, caps and pruning.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    MAX_EVENTS, MAX_FACTIONS, MAX_RESOLVED, findIn, initialChronicle, keyOf, orderedEvents, prune, seenOf, surfacedOf, validateChronicle,
} from '../../../src/v2/chronicle/domain.js';

const event = (n, over = {}) => ({
    id: `ev_${String(n).padStart(8, '0')}`, name: `Event ${n}`, summary: '', state: 'ongoing', since: null, updated: null,
    place: '', factions: [], aka: [], rev: n, ...over,
});
const faction = (n, over = {}) => ({ id: `fa_${String(n).padStart(8, '0')}`, name: `Faction ${n}`, summary: '', area: '', stance: '', aka: [], rev: n, ...over });
const withEvents = list => ({ ...initialChronicle(), events: Object.fromEntries(list.map(entry => [entry.id, entry])) });

test('the initial chronicle is valid and empty', () => {
    assert.deepEqual(initialChronicle(), { events: {}, factions: {}, seen: [{}], round: 0, surfaced: null, days: {}, written: null, dayFacts: {}, noted: null, questLog: {} });
    assert.deepEqual(validateChronicle(initialChronicle()), []);
});

test('a well-formed chronicle passes; each broken field is named', () => {
    const good = { ...withEvents([event(1, { since: 600, updated: 660, place: 'Dragonfang', factions: ['Ashen Court'] })]), factions: { [faction(1).id]: faction(1) } };
    good.seen = { [event(1).id]: 1 };
    good.round = 1;
    good.surfaced = { at: 4, round: 1, ids: [event(1).id] };
    assert.deepEqual(validateChronicle(good), []);

    const cases = [
        [{ ...good, events: { ev_bad: event(1, { id: 'ev_bad' }) } }, /bad id/],
        [withEvents([event(1, { state: 'smouldering' })]), /state must be one of: looming, ongoing, resolved/],
        [withEvents([event(1, { since: 1.5 })]), /since must be story minutes or null/],
        [withEvents([event(1, { name: '' })]), /needs a name/],
        [withEvents([event(1, { summary: 'x'.repeat(301) })]), /summary must be text of at most 300/],
        [withEvents([event(1, { factions: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] })]), /factions must be a list of at most 6/],
        [withEvents([event(1, { extra: 1 })]), /unknown field "extra"/],
        [withEvents([event(1), event(2, { name: 'event 1' })]), /Two events are called "event 1"/],
        [{ ...initialChronicle(), factions: { fa_00000001: faction(1, { stance: 5 }) } }, /stance must be text/],
        [{ ...initialChronicle(), seen: [{ x: 0 }] }, /seen\["x"\] is for no event/],
        [{ ...initialChronicle(), seen: [{}, {}] }, /seen is not an object/],
        [{ ...withEvents([event(1)]), seen: { ev_00000001: 3 } }, /must be a round so far/],
        [{ ...initialChronicle(), surfaced: { at: 1, round: 0, ids: ['x'] } }, /surfaced must be null or/],
        [{ ...initialChronicle(), round: -1 }, /round must be a whole number/],
        [{ ...initialChronicle(), notes: [] }, /unknown field "notes"/],
        ['nope', /not an object/],
    ];
    for (const [slice, pattern] of cases) assert.match(validateChronicle(slice).join(' '), pattern);
});

test('the caps hold in the validator: events, resolved events and factions', () => {
    const many = withEvents(Array.from({ length: MAX_EVENTS + 1 }, (_, i) => event(i + 1)));
    assert.match(validateChronicle(many).join(' '), new RegExp(`at most ${MAX_EVENTS} events`));
    const resolved = withEvents(Array.from({ length: MAX_RESOLVED + 1 }, (_, i) => event(i + 1, { state: 'resolved' })));
    assert.match(validateChronicle(resolved).join(' '), new RegExp(`at most ${MAX_RESOLVED} resolved`));
    const factions = { ...initialChronicle(), factions: Object.fromEntries(Array.from({ length: MAX_FACTIONS + 1 }, (_, i) => [faction(i + 1).id, faction(i + 1)])) };
    assert.match(validateChronicle(factions).join(' '), new RegExp(`at most ${MAX_FACTIONS} factions`));
});

test('prune drops resolved events oldest first beyond the caps, and their seen marks', () => {
    const list = [
        ...Array.from({ length: MAX_RESOLVED + 2 }, (_, i) => event(i + 1, { state: 'resolved', rev: 100 - i })),
        event(90, { rev: 1 }),
    ];
    const chronicle = withEvents(list);
    chronicle.seen = { [event(90).id]: 0 };
    const gone = prune(chronicle);
    // The two with the lowest rev went (rev 100 - 33, 100 - 32), never the open one.
    assert.deepEqual(gone, [`Event ${MAX_RESOLVED + 2}`, `Event ${MAX_RESOLVED + 1}`]);
    assert.equal(Object.values(chronicle.events).filter(entry => entry.state === 'resolved').length, MAX_RESOLVED);
    assert.ok(chronicle.events[event(90).id]);
    assert.deepEqual(validateChronicle(chronicle), []);

    // Beyond MAX_EVENTS in all, resolved ones go first even under the resolved cap.
    const full = withEvents([...Array.from({ length: MAX_EVENTS - 1 }, (_, i) => event(i + 1)), event(70, { state: 'resolved' }), event(71, { state: 'resolved', rev: 200 })]);
    assert.deepEqual(prune(full), ['Event 70']);
    assert.equal(Object.keys(full.events).length, MAX_EVENTS);
});

test('names are found by key and by a name they had; open events sort first, newest news first', () => {
    const chronicle = withEvents([
        event(1, { name: "The King's War", aka: ['Border War'], updated: 100 }),
        event(2, { name: 'Red Plague', state: 'resolved', updated: 900 }),
        event(3, { name: 'Dragon Calamity', updated: 500 }),
        event(4, { name: 'Quiet Unrest', state: 'looming', updated: null }),
    ]);
    assert.equal(keyOf("  The  King’s War "), 'the kings war');
    assert.equal(findIn(chronicle.events, 'the kings war').id, event(1).id);
    assert.equal(findIn(chronicle.events, 'BORDER WAR').id, event(1).id);
    assert.equal(findIn(chronicle.events, event(3).id).name, 'Dragon Calamity');
    assert.equal(findIn(chronicle.events, 'Nothing'), null);
    assert.deepEqual(orderedEvents(chronicle).map(entry => entry.name), ['Dragon Calamity', "The King's War", 'Quiet Unrest', 'Red Plague']);
});
