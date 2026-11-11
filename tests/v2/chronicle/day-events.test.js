// Chronicle part: bookkeeping receipts are no event of the day (by receipt type, never by text), and a day's whole event list
// is worked out on demand from the receipts (`eventsOf`, `chronicle.dayEvents`), by the rules the digest's pick uses.

import test from 'node:test';
import assert from 'node:assert/strict';

import { BOOKKEEPING_TYPES } from '../../../src/v2/chronicle/days/shared.js';
import { entryOf, eventsOf, factsOf } from '../../../src/v2/chronicle/days.js';
import { dayEventsQuery, queries } from '../../../src/v2/chronicle/queries.js';

let rev = 0;
const r = (type, summary, fields = {}) => ({ type, module: 'story-block', cause: 'story', summary, narrate: false, data: {}, rev: (rev += 1), ...fields });
const dm = kind => r('capture.dm', `Astra: ${kind}.`, { data: { v2: { result: { kind } } } });
const story = summary => r('capture.item', summary);
const bookkeeping = [
    r('rpg.resolve', 'Tell the settled fight results in order; do not reroll them. | Write [battle] on its own line where the fight is told.', { narrate: true, cause: 'ui' }),
    r('rpg.noroll', 'No roll.'),
    dm('set-health'), dm('set-mana'), dm('set-stamina'),
    r('dm.set', 'Astra: edited.'), r('dm.tick', 'Astra: story time settled.'),
    r('dm.settle', 'Astra: settled at the end of the reply.', { cause: 'system' }),
    r('director.initiative', 'Initiative for the next reply: Mira.', { module: 'story-director', cause: 'system' }),
    // A system receipt that does not narrate is bookkeeping by its flags, whatever its type.
    r('anything.else', 'A silent system step.', { cause: 'system', narrate: false }),
];

test('bookkeeping receipts are neither picked nor counted under "happened", whatever their text', () => {
    const list = [bookkeeping[0], story('You added Cane Sword.'), ...bookkeeping.slice(1), story('Sister Temiwa: trust 12 → 14.')];
    const entry = entryOf(list, 5);
    assert.deepEqual(entry.happened.map(item => item.text), ['You added Cane Sword.', 'Sister Temiwa: trust 12 → 14.']);
    assert.equal(entry.more, 0);
    assert.equal(factsOf([entry]).more, 0);
    assert.ok(['rpg.resolve', 'dm.settle', 'director.initiative'].every(type => BOOKKEEPING_TYPES.has(type)));
});

test('a story event with the narrator note\'s words is still an event: the rule is the receipt, not the text', () => {
    const entry = entryOf([r('capture.item', 'Tell the settled fight results in order; do not reroll them.')], 5);
    assert.equal(entry.happened.length, 1);
});

test('the count behind "more" is story events only', () => {
    const many = Array.from({ length: 45 }, (_, i) => story(`Event ${i}.`));
    const entry = entryOf([...bookkeeping, ...many], 5);
    assert.equal(entry.happened.length + entry.more, 45);
    assert.equal(entry.more, 5, 'a day keeps up to 40 lines');
});

test('eventsOf gives the whole list in chat order, deduplicated, bookkeeping and echoes left out, capped', () => {
    const many = Array.from({ length: 12 }, (_, i) => story(`Event ${i}.`));
    const list = [...bookkeeping, many[0], many[0], ...many.slice(1), r('capture.coin', 'The party receives 5 copper.'), r('capture.item', 'Director: + quest X')];
    assert.deepEqual(eventsOf(list), many.map(item => item.summary));
    assert.equal(eventsOf(list, 5).length, 5);
});

test('chronicle.dayEvents lists that day\'s events from the chat\'s receipts, nothing stored', () => {
    const clock = minutes => r('capture.time', 'Story time.', { module: 'story-director', data: { minutes } });
    const receipts = [clock(10 * 1440), story('Day ten A.'), bookkeeping[3], clock(11 * 1440), story('Day eleven A.'), story('Day eleven B.')];
    const tools = { receipts: () => receipts.map((receipt, index) => ({ index, receipt })) };
    assert.deepEqual(dayEventsQuery({}, { day: 11 }, tools), { day: 11, events: ['Day eleven A.', 'Day eleven B.'] });
    assert.deepEqual(dayEventsQuery({}, { day: 10 }, tools).events, ['Day ten A.']);
    assert.deepEqual(dayEventsQuery({}, { day: 99 }, tools).events, []);
    assert.equal(dayEventsQuery({}, { day: 'x' }, tools), null);
    assert.deepEqual(dayEventsQuery({}, { day: 11 }, null).events, []);
    assert.equal(queries['chronicle.dayEvents'].feature, 'story-director.digest');
});
