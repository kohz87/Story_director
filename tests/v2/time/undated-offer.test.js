// Offers with no deadline lapse UNDATED_OFFER_DAYS (3) story days after the later of when they were offered
// and when the story last mentioned them (a line that touches them), closing as a deadline lapse does:
// "- Key — offer lapsed", claimed `lapse:<thread id>`, written ifThere, at the first settle at or after that
// minute. Dated offers and accepted quests keep their rules. Story time only.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LAPSED_REASON, UNDATED_OFFER_DAYS } from '../../../src/lapses.js';
import { part } from '../../../src/v2/time/index.js';
import { claimKey } from '../../../src/v2/time/settle.js';
import { Chat, SETTINGS, thread } from './helpers/fake-ctx.js';

const OFFER = '+ hook Herb run — moonleaf | giver: Mother Ysolde | reward: 5 copper';

// A chat whose first reply sets the clock at `start` with these Director lines, settled.
function begun(lines, { start = 'Goldwane 12, 08:00 pm', ...options } = {}) {
    const chat = new Chat(options);
    chat.send();
    chat.answer([`~ time ${start}`, lines].filter(Boolean).join('\n'));
    chat.send();
    return chat;
}
// The next reply moves the clock to `when`, then the hook settles it.
const goTo = (chat, when, lines = '') => {
    chat.answer([`~ time ${when}`, lines].filter(Boolean).join('\n'));
    return chat.send();
};
const status = (chat, key = 'Herb run') => thread(chat.head(), key).status;

test('the span is three story days', () => {
    assert.equal(UNDATED_OFFER_DAYS, 3);
});

test('an undated offer lapses exactly three days after it was offered, claimed once', () => {
    const chat = begun(OFFER);
    const id = thread(chat.head(), 'Herb run').id;
    assert.equal(thread(chat.head(), 'Herb run').fields.due, undefined);
    goTo(chat, 'Goldwane 15, 07:59 pm');
    assert.equal(status(chat), 'active', 'one minute short');
    const { committed } = goTo(chat, 'Goldwane 15, 08:00 pm');
    assert.deepEqual(committed[0].data.lapsed.map(entry => [entry.key, entry.reason]), [['Herb run', LAPSED_REASON]]);
    const closed = thread(chat.head(), 'Herb run');
    assert.equal(closed.status, 'resolved');
    assert.deepEqual([closed.ended.reason, closed.ended.outcome], [LAPSED_REASON, 'failed']);
    assert.equal(closed.offer, false);
    assert.ok(chat.head().meta.claims[claimKey(id)], 'the lapse is claimed');
    // Nothing is closed twice, however much time passes.
    const later = goTo(chat, 'Reapwane 5, 09:00 am');
    assert.deepEqual(later.committed.flatMap(run => run.data.lapsed ?? []), []);
});

test('it closes at the first settle after that minute, not before the clock gets there', () => {
    const chat = begun(OFFER);
    const { committed } = goTo(chat, 'Goldwane 20, 09:00 am');
    assert.equal(committed[0].data.lapsed.length, 1);
    assert.equal(status(chat), 'resolved');
});

test('a mention starts the clock over: seen later, it lapses later', () => {
    const chat = begun(OFFER);
    goTo(chat, 'Goldwane 14, 09:00 pm', '~ hook Herb run | now: still wanted');
    assert.equal(status(chat), 'active');
    goTo(chat, 'Goldwane 17, 08:59 pm');
    assert.equal(status(chat), 'active', 'three days from the offer would have closed it by now');
    goTo(chat, 'Goldwane 17, 09:00 pm');
    assert.equal(status(chat), 'resolved', 'three days from the mention');
});

test('an offer mentioned on day 2.9 survives to 5.9', () => {
    const chat = begun(OFFER, { start: 'Goldwane 12, 00:00 am' });
    // 2.9 days after it was offered: 2 days and 21 hours 36 minutes.
    goTo(chat, 'Goldwane 14, 09:36 pm', '~ hook Herb run | now: still wanted');
    assert.equal(status(chat), 'active');
    goTo(chat, 'Goldwane 17, 09:35 pm');
    assert.equal(status(chat), 'active', 'day 5.9 is short of 2.9 + 3');
    goTo(chat, 'Goldwane 17, 09:36 pm');
    assert.equal(status(chat), 'resolved');
});

test('a mention after the offer was already mentioned counts from the latest', () => {
    const chat = begun(OFFER);
    goTo(chat, 'Goldwane 14, 08:00 pm', '~ hook Herb run | now: still wanted');
    goTo(chat, 'Goldwane 16, 08:00 pm', '~ hook Herb run | now: asked again');
    goTo(chat, 'Goldwane 18, 11:00 pm');
    assert.equal(status(chat), 'active');
    goTo(chat, 'Goldwane 19, 08:00 pm');
    assert.equal(status(chat), 'resolved');
});

test('dated offers keep the deadline rule, whatever else is on the board', () => {
    const chat = begun([OFFER, '+ hook Rat Culling — rats | giver: Danique | reward: 5 copper | due: Goldwane 20'].join('\n'));
    goTo(chat, 'Goldwane 16, 09:00 am');
    assert.equal(status(chat), 'resolved', 'the undated offer lapsed');
    assert.equal(status(chat, 'Rat Culling'), 'active', 'the dated one waits for its own deadline');
    goTo(chat, 'Goldwane 20, 11:58 pm');
    assert.equal(status(chat, 'Rat Culling'), 'active');
    goTo(chat, 'Goldwane 20, 11:59 pm');
    assert.equal(status(chat, 'Rat Culling'), 'resolved');
});

test('accepted quests are unchanged: an undated quest taken on never lapses by this rule', () => {
    const chat = begun('+ quest Wolves — giver: Hobb | reward: 4 silver | goal: Kill the wolves');
    goTo(chat, 'Reapwane 10, 09:00 am');
    assert.equal(status(chat, 'Wolves'), 'active');
    assert.equal(thread(chat.head(), 'Wolves').offer, false, 'taken on, not an offer');
});

test('a plain hook (no giver, no reward) is not an offer: nothing lapses it', () => {
    const chat = begun('+ hook River stranger — who pulled Ren out');
    goTo(chat, 'Reapwane 10, 09:00 am');
    assert.equal(status(chat, 'River stranger'), 'active');
});

test('with lapses off an undated offer stays open and is not marked overdue', () => {
    const chat = begun(OFFER, { settings: { ...SETTINGS, lapses: false } });
    const { committed } = goTo(chat, 'Goldwane 20, 09:00 am');
    assert.deepEqual(committed[0].data.lapsed, []);
    assert.deepEqual(committed[0].data.overdue, []);
    assert.equal(status(chat), 'active');
    assert.deepEqual(Object.keys(chat.head().meta.claims), []);
});

test('the receipt and the While away recap tell the lapse as a dated one is told', () => {
    const dated = begun(`${OFFER} | due: Goldwane 13`);
    const told = goTo(dated, 'Goldwane 15, 09:00 pm').committed[0].summary;
    const chat = begun(OFFER);
    const { committed } = goTo(chat, 'Goldwane 15, 09:00 pm');
    assert.equal(committed[0].summary, told);
    assert.match(committed[0].summary, /Herb run/);
    // The While away recap of the jump is the same for both (a lapse is told by the receipt, not listed in the recap).
    assert.deepEqual(part.queries['time.recap'](chat.head()), part.queries['time.recap'](dated.head()));
});

test('swiping or deleting the reply where time passed takes the lapse and its claim back', () => {
    const chat = begun(OFFER);
    const before = chat.head();
    const id = thread(before, 'Herb run').id;
    chat.answer('~ time Goldwane 16, 09:00 am');
    chat.send();
    assert.equal(status(chat), 'resolved');
    chat.messages.pop();
    chat.swipe();
    assert.deepEqual(chat.head(), before);
    assert.equal(chat.head().meta.claims[claimKey(id)], undefined);
    // The swipe stays short of the span (and mentions the offer): nothing lapses.
    goTo(chat, 'Goldwane 14, 08:00 pm', '~ hook Herb run | now: still wanted');
    assert.equal(status(chat), 'active');
    // Past the span from that mention, it lapses on this line again; deleting that reply reopens it.
    goTo(chat, 'Goldwane 17, 08:00 pm');
    assert.equal(status(chat), 'resolved');
    chat.messages.pop();
    chat.deleteLast();
    assert.equal(status(chat), 'active');
});

test('an offer with no known time to count from is left alone, and the hook does not keep asking', () => {
    const chat = begun(OFFER);
    const state = structuredClone(chat.head());
    const id = thread(state, 'Herb run').id;
    const track = state.domains.director.threads[id].track;
    delete track.created;
    delete track.seen;
    chat.setHead(state);
    goTo(chat, 'Reapwane 10, 09:00 am');
    assert.equal(status(chat), 'active');
    const view = chat.view();
    assert.deepEqual(part.hooks.beforeGenerate(view).commands, []);
});
