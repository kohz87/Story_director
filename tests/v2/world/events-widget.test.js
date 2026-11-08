// World part: the Journal's "Show all N events" button: it loads the day's whole list on tap (one query, with the day), shows it,
// folds on the next tap; a day's total counts story events; names the reader must not know are left out of the list.

import test from 'node:test';
import assert from 'node:assert/strict';

import { EVENTS_QUERY, eventsWidget } from '../../../src/v2/world/events-widget.js';
import { EVENTS_WIDGET, journalEvents, knownDay, part, worldScreen } from '../../../src/v2/world/index.js';
import { installFakeDom } from '../../ui-fake-dom.js';

const mount = (props, events) => {
    const doc = installFakeDom();
    const el = doc.createElement('div');
    doc.body.appendChild(el);
    const asked = [];
    const api = { query: (name, args) => { asked.push([name, args]); return { events: typeof events === 'function' ? events() : events }; } };
    const handle = eventsWidget.render(el, props, api);
    return { el, handle, asked };
};
const texts = node => node.children.map(child => child.textContent);

test('the button says Show all N events and loads nothing until tapped', () => {
    const { el, asked } = mount({ day: '12', total: '48' }, ['A', 'B']);
    const [button, list] = el.children;
    assert.equal(button.textContent, 'Show all 48 events');
    assert.equal(list.hidden, true);
    assert.deepEqual(asked, []);
});

test('a tap loads that day\'s list under the card, the next tap folds it', () => {
    const { el, asked } = mount({ day: '12', total: '48' }, ['A', 'B', 'C']);
    const [button, list] = el.children;
    button.click();
    assert.deepEqual(asked, [[EVENTS_QUERY, { day: 12 }]]);
    assert.deepEqual(texts(list), ['A', 'B', 'C']);
    assert.equal(list.hidden, false);
    assert.equal(button.textContent, 'Hide the 3 events');
    button.click();
    assert.equal(list.hidden, true);
    assert.equal(list.children.length, 0);
    assert.equal(button.textContent, 'Show all 48 events');
});

test('an empty answer says so, and an update while open asks again', () => {
    let events = [];
    const { el, handle, asked } = mount({ day: '3', total: '2' }, () => events);
    const [button, list] = el.children;
    button.click();
    assert.match(texts(list)[0], /left in the chat/);
    events = ['Z'];
    handle.update({ day: '3', total: '2' });
    assert.deepEqual(texts(list), ['Z']);
    assert.equal(asked.length, 2);
});

test('the Journal template draws the button only while a day has more, and the part registers the widget and the query', () => {
    assert.match(worldScreen.template, new RegExp(`name="${EVENTS_WIDGET}"[^>]*data-if="d.more"`));
    assert.doesNotMatch(worldScreen.template, /and \{\{ d\.more \}\} more/);
    assert.ok(part.widgets[EVENTS_WIDGET]);
    assert.equal(part.queries['director.journal.events'].feature, part.features[0].id);
});

test('knownDay gives the total of the pick and the rest; the list leaves out hidden names', () => {
    const day = knownDay({ day: 1, date: 'D', happened: ['a', 'b'], more: 5 }, { words: [], behind: [] });
    assert.equal(day.total, 7);
    const tools = { query: (name) => (name === 'chronicle.dayEvents' ? { events: ['Plain.', 'Tell of Kessa.'] } : null) };
    assert.deepEqual(journalEvents({}, { day: 4 }, tools), { day: 4, events: ['Plain.', 'Tell of Kessa.'] });
    assert.deepEqual(journalEvents({}, { day: '4' }, tools).day, 4);
    assert.equal(journalEvents({}, { day: 'x' }, tools), null);
});
