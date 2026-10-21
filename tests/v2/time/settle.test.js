// Deadlines that slip or lapse when story time passes (MODULES §F21), v1 lapses.js rules: the
// hook settles the clock before each reply, time.settle closes what time ran past under one
// claim per thread, and the receipt tells the next reply in v1's words.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeCalendar } from '../../../src/calendar.js';
import { LAPSED_REASON, SLIPPED_REASON } from '../../../src/lapses.js';
import { SETTLE, part } from '../../../src/v2/time/index.js';
import { calendarOf, timeSettings } from '../../../src/v2/time/records.js';
import { DEADLINE_REASON, claimKey } from '../../../src/v2/time/settle.js';
import { CALENDAR, Chat, SETTINGS, makeState, reply, runCommand, thread } from './helpers/fake-ctx.js';
import { slotValue } from '../../../src/v2/slot.js';

const calendar = makeCalendar(CALENDAR);
const at = text => calendar.parse(text).abs;
const settleCommand = part.commands[SETTLE];
const director = state => state.domains.director;

// A chat whose first reply sets the clock at `start` with these Director lines, settled.
function begun(lines, { start = 'Goldwane 12, 08:00 pm', said = null, ...options } = {}) {
    const chat = new Chat(options);
    chat.send();
    chat.answer([`~ time ${start}`, lines].filter(Boolean).join('\n'), { said });
    chat.send();
    return chat;
}

test('the part has no domain, one command, its queries, a hook, a tail and the Time settings', () => {
    assert.deepEqual(Object.keys(part.domains), []);
    assert.deepEqual(Object.keys(part.commands), ['time.settle']);
    assert.deepEqual(Object.keys(part.queries), ['time.overdue', 'time.recap']);
    assert.deepEqual(Object.keys(part.kinds), []);
    assert.equal(typeof part.hooks.beforeGenerate, 'function');
    assert.equal(part.settings.section, 'Time');
    assert.deepEqual(part.settings.defaults, { recapHours: 6, lapses: true });
    assert.deepEqual(Object.keys(part.settings.schema), ['recapHours', 'lapses']);
    // The calendar is the tracker part's setting, read (not shown twice).
    assert.deepEqual(part.settings.reads, { calendar: 'tracker.calendar' });
    assert.equal(part.context.budget, 200);
});

test('the hook settles only when the clock moved (or a deadline waits to lapse)', () => {
    const chat = new Chat();
    // No clock yet: nothing to settle.
    assert.deepEqual(chat.send().committed, []);
    chat.answer('~ time Goldwane 12, 08:00 pm');
    const first = chat.send();
    assert.equal(first.committed.length, 1, 'the first time seen is recorded');
    assert.equal(first.committed[0].narrate, false);
    assert.equal(first.committed[0].summary, 'Story time settled at Goldwane 12, 08:00 pm.');
    assert.deepEqual(slotValue(director(chat.head()).checked), { minutes: at('Goldwane 12, 08:00 pm'), rev: chat.head().meta.rev, lapsed: [], overdue: [], pay: [], due: [] });
    chat.answer('');
    assert.deepEqual(chat.send().committed, [], 'the clock did not move');
    chat.answer('! time +2h');
    assert.equal(chat.send().committed.length, 1);
    assert.equal(slotValue(director(chat.head()).checked).minutes, at('Goldwane 12, 10:00 pm'));
});

test('an offer lapses when the clock passes its deadline, told once in v1\'s words', () => {
    const chat = begun("+ hook Rat Culling — rats in the granary | giver: Danique, the rat-catcher's widow | reward: 5 copper | due: Goldwane 13");
    const offer = thread(chat.head(), 'Rat Culling');
    assert.equal(offer.offer, true);
    chat.answer('! time +1d');
    chat.send();
    assert.equal(thread(chat.head(), 'Rat Culling').status, 'active', 'Goldwane 13 runs to the end of its day');
    chat.answer('! time +4h');
    const { committed } = chat.send();
    assert.equal(committed.length, 1);
    const [receipt] = committed;
    assert.equal(receipt.narrate, true);
    assert.equal(receipt.summary, "Lapsed: Rat Culling (Danique's offer) went to someone else; Danique may mention it.");
    assert.deepEqual(receipt.data.lapsed, [{ id: offer.id, key: 'Rat Culling', kind: 'quest', reason: LAPSED_REASON }]);
    const closed = thread(chat.head(), 'Rat Culling');
    assert.equal(closed.status, 'resolved');
    assert.equal(closed.offer, false);
    assert.deepEqual(closed.ended, { rev: chat.head().meta.rev, reason: 'offer lapsed', outcome: 'failed' });
    assert.equal(chat.head().meta.claims[claimKey(offer.id)], true);
    assert.deepEqual(slotValue(director(chat.head()).checked).lapsed, [offer.id]);
    // Told once: the next reply settles nothing more.
    chat.answer('! time +1h');
    assert.equal(chat.send().committed[0].narrate, false);
});

test('a taken quest past its deadline is overdue first, then fails once the grace is gone', () => {
    const chat = begun('+ quest Bounty on Kettle Jack — bring him in alive | giver: Warden Hale | goal: bring him in alive | due: Goldwane 13', { said: 'I take the bounty on Kettle Jack.' });
    const quest = thread(chat.head(), 'Bounty on Kettle Jack');
    assert.equal(quest.offer, false, 'the reader took it on');
    chat.answer('~ time Goldwane 14, 09:00 am');
    let { committed } = chat.send();
    assert.equal(committed[0].narrate, false, 'overdue is the story\'s to tell (Due now), not a lapse');
    assert.deepEqual(committed[0].data.overdue, [quest.id]);
    assert.deepEqual(part.queries['time.overdue'](chat.head()).overdue.map(entry => entry.key), ['Bounty on Kettle Jack']);
    assert.equal(thread(chat.head(), 'Bounty on Kettle Jack').status, 'active');
    // Two story days past the end of Goldwane 13: the time ran out on it.
    chat.answer('~ time Goldwane 16, 12:01 am');
    ({ committed } = chat.send());
    assert.equal(committed[0].summary, 'Failed: Bounty on Kettle Jack (by Goldwane 13, 11:59 pm) — the deadline passed and the time ran out on it; mention it only where it fits.');
    assert.deepEqual(thread(chat.head(), 'Bounty on Kettle Jack').ended, { rev: chat.head().meta.rev, reason: DEADLINE_REASON, outcome: 'failed' });
    const overdue = part.queries['time.overdue'](chat.head());
    assert.deepEqual(overdue.lapsed.map(entry => [entry.key, entry.reason]), [['Bounty on Kettle Jack', 'deadline passed']]);
    assert.deepEqual(overdue.overdue, []);
});

test('a quest whose work is done and only the pay waits is never failed (v1 waitsForPay)', () => {
    const chat = begun('+ quest Lone Grey Wolf — the wolf at the fold | giver: Bailiff | step: turn in voucher at the bailiff hatch | due: Goldwane 13, 12:00 pm', { said: 'I take the wolf job.' });
    const quest = thread(chat.head(), 'Lone Grey Wolf');
    chat.answer('~ time Goldwane 20, 09:00 am');
    const { committed } = chat.send();
    assert.equal(committed[0].narrate, false);
    assert.deepEqual(committed[0].data.lapsed, []);
    assert.deepEqual(committed[0].data.pay, [quest.id]);
    assert.equal(thread(chat.head(), 'Lone Grey Wolf').status, 'active');
    assert.deepEqual(part.queries['time.overdue'](chat.head()).pay.map(entry => entry.key), ['Lone Grey Wolf']);
});

test('a quest whose target is met (the quests part) waits only for its turn-in: not failed either', () => {
    const progress = { 'quest.progress': (state, { id }) => ({ have: 3, need: 3, met: thread(state, 'Wolf Hunt')?.id === id, source: 'fights' }) };
    const chat = begun('+ quest Wolf Hunt — wolves on the ridge | giver: Danique | goal: kill 3 wolves | due: Goldwane 13', { said: 'I take the wolf hunt.', extraQueries: progress });
    chat.answer('~ time Goldwane 20, 09:00 am');
    const { committed } = chat.send();
    assert.deepEqual(committed[0].data.lapsed, []);
    assert.equal(committed[0].data.pay.length, 1);
    // Without the query (no quests part), the same quest fails.
    const bare = begun('+ quest Wolf Hunt — wolves on the ridge | giver: Danique | goal: kill 3 wolves | due: Goldwane 13', { said: 'I take the wolf hunt.' });
    bare.answer('~ time Goldwane 20, 09:00 am');
    assert.equal(bare.send().committed[0].data.lapsed[0].reason, DEADLINE_REASON);
});

test('beats slip after their date and two days; clocks, events and agendas that came due are marked due', () => {
    const chat = begun([
        '+ beat Guards sack the Stray Oar — the guild moves | on: Goldwane 13',
        '+ beat Riders — they come | on: Goldwane 13',
        '+ clock Graves — the dead rise | due: Goldwane 14',
        '+ event Fair — the spring fair | then: the fair opens | on: Goldwane 14',
        '+ agenda Geva — plots | now: the court | then: files the warrant | on: Goldwane 14, 06:00 pm',
        '+ secret The Heir — Ren is the heir | on: Goldwane 13',
    ].join('\n'));
    // `!` alone clears a beat's date: it played out.
    chat.answer('! beat Riders — the riders come');
    chat.send();
    chat.answer('~ time Goldwane 14, 08:00 pm');
    let { committed } = chat.send();
    const keys = ids => ids.map(id => director(chat.head()).threads[id].key);
    assert.deepEqual(committed[0].data.lapsed, []);
    assert.deepEqual(keys(committed[0].data.due), ['Guards sack the Stray Oar', 'Graves', 'Fair', 'Geva']);
    chat.answer('~ time Goldwane 16, 09:00 am');
    ({ committed } = chat.send());
    assert.deepEqual(committed[0].data.lapsed.map(entry => [entry.key, entry.reason]), [['Guards sack the Stray Oar', SLIPPED_REASON]]);
    assert.equal(committed[0].summary, 'Slipped: Guards sack the Stray Oar (Goldwane 13) — it happened off-screen or not at all; mention it only where it fits.');
    assert.equal(thread(chat.head(), 'Riders').status, 'active', 'a fired beat never slips');
    assert.equal(thread(chat.head(), 'Graves').status, 'active', 'a clock is the story\'s to fire');
    assert.equal(thread(chat.head(), 'The Heir').status, 'active');
});

test('a beat the story touched once its day came is taken as played out', () => {
    const chat = begun('+ beat Riders — they come | on: Goldwane 13');
    chat.answer('~ time Goldwane 13, 10:00 am\n! beat Riders — the riders come | now: at the ford');
    chat.send();
    chat.answer('~ time Goldwane 25, 09:00 am');
    assert.deepEqual(chat.send().committed[0].data.lapsed, []);
    // A new date after that is a new appointment, and it can slip.
    chat.answer('~ beat Riders | on: Goldwane 28');
    chat.send();
    chat.answer('~ time Reapwane 2, 09:00 am');
    assert.deepEqual(chat.send().committed[0].data.lapsed.map(entry => entry.key), ['Riders']);
});

test('claims: a thread time already closed on this line of history is not closed again', () => {
    const chat = begun('+ hook Rat Culling — rats | giver: Danique | reward: 5 copper | due: Goldwane 13');
    const id = thread(chat.head(), 'Rat Culling').id;
    chat.answer('~ time Goldwane 15, 09:00 am');
    chat.send();
    const after = chat.head();
    // The story writes the job open again (a hand edit): time does not close it a second time.
    const reopened = structuredClone(after);
    Object.assign(reopened.domains.director.threads[id], { status: 'active', ended: null, offer: true });
    const run = runCommand(reopened, settleCommand, { at: 20 });
    assert.equal(run.ok, true);
    assert.deepEqual(run.result.data.lapsed, []);
    assert.equal(run.state.domains.director.threads[id].status, 'active');
    // And the hook does not keep asking for it.
    const view = { state: { ...run.state }, settings: () => SETTINGS, chat: { length: 20 } };
    assert.deepEqual(part.hooks.beforeGenerate(view).commands, []);
    // Settling twice on the same time closes nothing twice.
    const twice = runCommand(after, settleCommand, { at: 20 });
    assert.deepEqual(twice.result.data.lapsed, []);
    assert.equal(twice.state.domains.director.threads[id].ended.rev, after.domains.director.threads[id].ended.rev);
});

test('a deadline that waits to lapse is settled even when the clock did not move', () => {
    const chat = begun('');
    chat.answer('~ time Goldwane 15, 09:00 am');
    chat.send();
    // An offer written with a deadline already gone, the clock unchanged.
    chat.answer('+ hook Herb run — moonleaf | giver: Mother Ysolde | reward: 5 copper | due: Goldwane 13');
    const { committed } = chat.send();
    assert.deepEqual(committed[0].data.lapsed.map(entry => entry.key), ['Herb run']);
});

test('with lapses off nothing closes: what would have is overdue or due', () => {
    const chat = begun('+ hook Rat Culling — rats | giver: Danique | reward: 5 copper | due: Goldwane 13\n+ beat Riders — they come | on: Goldwane 13', { settings: { ...SETTINGS, lapses: false } });
    chat.answer('~ time Goldwane 20, 09:00 am');
    const { committed } = chat.send();
    assert.deepEqual(committed[0].data.lapsed, []);
    assert.equal(committed[0].data.overdue.length, 1);
    assert.equal(committed[0].data.due.length, 1);
    assert.equal(thread(chat.head(), 'Rat Culling').status, 'active');
    assert.deepEqual(Object.keys(chat.head().meta.claims), []);
    assert.ok(chat.head().domains.director.recap, 'the jump got its recap');
    // The next reply only clears the recap; after that nothing waits to lapse.
    chat.answer('');
    const next = chat.send().committed;
    assert.equal(next.length, 1);
    assert.equal(chat.head().domains.director.recap, null);
    assert.deepEqual(next[0].data.lapsed, []);
    chat.answer('');
    assert.deepEqual(chat.send().committed, [], 'nothing waits to lapse');
});

test('swiping or deleting the reply where time passed takes the lapses (and their claims) back', () => {
    const chat = begun('+ hook Rat Culling — rats | giver: Danique | reward: 5 copper | due: Goldwane 13');
    const before = chat.head();
    chat.answer('~ time Goldwane 15, 09:00 am');
    chat.send();
    const id = thread(chat.head(), 'Rat Culling').id;
    assert.equal(thread(chat.head(), 'Rat Culling').status, 'resolved');
    // The settle was written to the reply where the time passed: swiping it takes all back.
    chat.messages.pop();
    chat.swipe();
    assert.deepEqual(chat.head(), before, 'the state is the one before that reply');
    assert.equal(thread(chat.head(), 'Rat Culling').status, 'active');
    assert.equal(chat.head().meta.claims[claimKey(id)], undefined);
    // The new swipe keeps time short of the deadline: nothing lapses.
    chat.answer('! time +1h');
    chat.send();
    assert.equal(thread(chat.head(), 'Rat Culling').status, 'active');
    // A later reply runs past it again: the claim is free on this line, so it lapses here.
    chat.answer('~ time Goldwane 15, 09:00 am');
    chat.send();
    assert.equal(thread(chat.head(), 'Rat Culling').status, 'resolved');
    // Deleting that reply takes it back too.
    chat.messages.pop();
    chat.deleteLast();
    assert.equal(thread(chat.head(), 'Rat Culling').status, 'active');
});

test('time.settle: refusals and bad payloads save nothing', () => {
    const empty = makeState();
    const refused = runCommand(empty, settleCommand, {});
    assert.deepEqual([refused.ok, refused.code], [false, 'REFUSED']);
    assert.equal(refused.state, empty);
    const chat = begun('');
    const head = chat.head();
    for (const payload of [{ at: -1 }, { at: 1.5 }, { at: '3' }, { rev: -2 }, { rev: 'x' }]) {
        const run = runCommand(head, settleCommand, payload);
        assert.deepEqual([run.ok, run.code], [false, 'INVALID'], JSON.stringify(payload));
        assert.equal(run.state, head);
    }
    // No director domain: the hook asks for nothing.
    assert.deepEqual(part.hooks.beforeGenerate({ state: { meta: { rev: 0 }, domains: {} } }), { lines: [], commands: [] });
});

test('without ctx.rev the receipt\'s revision is the one the hook expected', () => {
    const chat = begun('+ hook Rat Culling — rats | giver: Danique | reward: 5 copper | due: Goldwane 13', { rev: false });
    chat.answer('~ time Goldwane 15, 09:00 am');
    chat.send();
    const head = chat.head();
    assert.equal(slotValue(director(head).checked).rev, head.meta.rev);
    assert.equal(thread(head, 'Rat Culling').ended.rev, head.meta.rev);
});

test('the hook\'s command is in Story Block\'s cue form, with the chat length and the expected rev', () => {
    const chat = begun('');
    chat.answer('! time +1h');
    const view = chat.view(7);
    assert.deepEqual(part.hooks.beforeGenerate(view), { lines: [], commands: [{ type: 'time.settle', payload: { at: 7, rev: view.state.meta.rev + 1 } }] });
});

test('settings: the part\'s own values, the tracker\'s calendar, defaults for anything else', () => {
    assert.deepEqual(timeSettings(() => ({ recapHours: 12, lapses: false, calendar: CALENDAR })), { recapHours: 12, lapses: false, calendar: CALENDAR });
    assert.deepEqual(timeSettings({ tracker: { calendar: CALENDAR } }).calendar, CALENDAR);
    assert.deepEqual(timeSettings(() => { throw new Error('no settings'); }), { recapHours: 6, lapses: true, calendar: null });
    assert.deepEqual(timeSettings({ recapHours: 0, lapses: 'yes' }), { recapHours: 6, lapses: true, calendar: null });
    assert.equal(calendarOf({}).format(calendarOf({}).parse('June 3, 1200, 08:00 am').abs), 'June 3, 1200, 08:00 am');
});
