// The While away recap (MODULES §F21, v1 0.9.19): after a jump of the story clock of at least
// the reader's threshold, what came due or arrived in the gap is told to the next reply only,
// as one `[While away] …` line in v1's words; the static prompt never changes.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeCalendar } from '../../../src/calendar.js';
import { parseChanges } from '../../../src/changes.js';
import { lapsedOffers, slippedBeats } from '../../../src/lapses.js';
import { AWAY_ARRIVAL, AWAY_CUE, AWAY_DEADLINE, AWAY_RECORD, noteParts } from '../../../src/note.js';
import { classify, estimateTokens } from '../../../src/relevance.js';
import { applyOps, emptyTracker } from '../../../src/tracker.js';
import { part } from '../../../src/v2/time/index.js';
import { AWAY_ARRIVAL_V2, AWAY_DEADLINE_V2, AWAY_RECORD_V2, RECAP_BUDGET, buildRecap, v2Asks } from '../../../src/v2/time/recap.js';
import { standing } from '../../../src/v2/time/settle.js';
import { CALENDAR, Chat, SETTINGS, thread } from './helpers/fake-ctx.js';

const calendar = makeCalendar(CALENDAR);
const at = text => calendar.parse(text).abs;
const director = state => state.domains.director;

const WORLD = [
    '+ event Stray Oar — the inn | then: sacked by the guild | on: Goldwane 13',
    "+ agenda Bond collector — rides out | leg: Shorn → Hollin's Reach 40 B, ride 60/day → 1 | arrive: Goldwane 14",
    '+ beat Ambush at the weir — riders wait | on: Goldwane 14, 09:00 am | encounter: 3 bandit',
    "+ event Saartje's sale — the sale | on: Goldwane 12",
    '+ secret The Heir — Ren is the heir | on: Goldwane 13',
];

// A chat whose first reply sets the clock at `start` with these lines, settled before reply 2.
function begun(lines, { start = 'Goldwane 12, 08:00 pm', ...options } = {}) {
    const chat = new Chat(options);
    chat.send();
    chat.answer([`~ time ${start}`, ...lines].join('\n'));
    chat.send();
    return chat;
}

test('a big jump builds the recap, told in the tail of the next reply', () => {
    const chat = begun(WORLD);
    assert.deepEqual(chat.generate().tail.lines, [], 'no jump yet');
    chat.answer('~ time Goldwane 15, 07:00 am');
    const { committed, tail } = chat.send();
    const line = "[While away] Goldwane 12, 08:00 pm → Goldwane 15, 07:00 am: Stray Oar — sacked by the guild (Goldwane 13) · Ambush at the weir (Goldwane 14, 09:00 am) (fought off-screen: 3 bandit) · Bond collector reached Hollin's Reach (Goldwane 14). "
        + `${AWAY_CUE} ${AWAY_RECORD_V2} ${AWAY_ARRIVAL_V2}`;
    assert.deepEqual(tail, { lines: [line], optional: [] });
    assert.equal(committed[0].data.recap, true);
    assert.equal(committed[0].narrate, false, 'the recap is the tail\'s, not a receipt to tell');
    const recap = part.queries['time.recap'](chat.head());
    assert.deepEqual(recap, {
        fromMinutes: at('Goldwane 12, 08:00 pm'), toMinutes: at('Goldwane 15, 07:00 am'), lines: [line],
        threads: ['Stray Oar', 'Ambush at the weir', 'Bond collector'].map(key => thread(chat.head(), key).id),
        rev: chat.head().meta.rev, at: chat.messages.length,
    });
    assert.ok(!line.includes('Heir'), 'secrets never come up');
    assert.ok(!line.includes('Saartje'), 'what was due before the jump stays on the tracker\'s Due now');
    assert.ok(estimateTokens(line) <= RECAP_BUDGET);
});

test('a small jump builds none; the threshold is the reader\'s (v1: a jump of exactly it counts)', () => {
    // The ambush at Goldwane 14, 09:00 am falls in each gap below.
    const small = begun(WORLD, { start: 'Goldwane 14, 08:00 am' });
    small.answer('! time +2h');
    assert.deepEqual(small.send().tail.lines, []);
    assert.equal(director(small.head()).recap ?? null, null);
    const six = begun(WORLD, { start: 'Goldwane 14, 06:00 am' });
    six.answer('! time +6h');
    assert.equal(six.send().tail.lines.length, 1, 'six hours, the default threshold');
    const day = begun(WORLD, { start: 'Goldwane 14, 06:00 am', settings: { ...SETTINGS, recapHours: 24 } });
    day.answer('! time +12h');
    assert.deepEqual(day.send().tail.lines, [], 'under a 24-hour threshold');
    // A big jump with nothing in the gap: no recap either.
    const quiet = begun(['+ event Fair — the fair | on: Reapwane 20']);
    quiet.answer('! time +3d');
    assert.deepEqual(quiet.send().tail.lines, []);
});

test('told once: to the reply after the jump and its swipes, not to the reply after that', () => {
    const chat = begun(WORLD);
    chat.answer('~ time Goldwane 15, 07:00 am');
    const told = chat.send().tail.lines;
    assert.equal(told.length, 1);
    // The reply comes, with lines of its own; a swipe of it is told the recap again.
    chat.answer('+ hook River stranger — a man by the water');
    assert.deepEqual(chat.swipe().tail.lines, told);
    assert.equal(thread(chat.head(), 'River stranger'), null, 'the swiped reply\'s lines are gone');
    // A Regenerate (the reply deleted first) too.
    chat.answer('');
    chat.deleteLast();
    assert.deepEqual(chat.generate().tail.lines, told);
    // The next reply: the recap is cleared by the settle written to the reply before it.
    chat.answer('+ hook River stranger — a man by the water');
    const next = chat.send();
    assert.deepEqual(next.tail.lines, []);
    assert.equal(next.committed.length, 1);
    assert.equal(director(chat.head()).recap, null);
    assert.equal(part.queries['time.recap'](chat.head()), null);
    // And nothing after that.
    chat.answer('');
    assert.deepEqual(chat.send(), { committed: [], tail: { lines: [], optional: [] }, lines: [] });
});

test('told once even when the reply after the jump changed nothing', () => {
    const chat = begun(WORLD);
    chat.answer('~ time Goldwane 15, 07:00 am');
    assert.equal(chat.send().tail.lines.length, 1);
    chat.answer('');
    assert.deepEqual(chat.send().tail.lines, []);
});

test('without the chat\'s length, a later receipt is what makes the recap old', () => {
    const chat = begun(WORLD);
    chat.answer('~ time Goldwane 15, 07:00 am');
    chat.send();
    const state = chat.head();
    const view = (s, length) => ({ state: s, settings: () => SETTINGS, chat: length === undefined ? {} : { length } });
    const recap = director(state).recap;
    assert.equal(part.context.tail({ state, settings: () => SETTINGS, chat: {} }).lines.length, 1);
    const later = { ...state, meta: { ...state.meta, rev: state.meta.rev + 1 } };
    assert.deepEqual(part.context.tail(view(later)).lines, []);
    assert.equal(part.hooks.beforeGenerate(view(later)).commands.length, 1);
    // With the length known, it decides.
    assert.equal(part.context.tail(view(later, recap.at + 1)).lines.length, 1);
});

test('a jump that brings too much is cut to about 200 tokens, the rest counted', () => {
    const many = Array.from({ length: 30 }, (_, i) => `+ event Market stall ${i + 1} of the long harbour row — trade | then: the stall keeper packs up and leaves for the winter quarters | on: Goldwane 13`);
    // Over two replies: one reply adds at most 16 new threads (B-b1-capture-13).
    const chat = begun(many.slice(0, 15));
    chat.answer(many.slice(15).join('\n'));
    chat.send();
    chat.answer('~ time Goldwane 15, 07:00 am');
    const [line] = chat.send().tail.lines;
    assert.ok(estimateTokens(line) <= RECAP_BUDGET, String(estimateTokens(line)));
    const shown = (line.match(/Market stall/g) ?? []).length;
    assert.ok(shown >= 1 && shown < 30);
    assert.match(line, new RegExp(`And ${30 - shown} more\\. ${AWAY_CUE.replace(/[{}.]/g, '\\$&')}`));
    assert.equal(director(chat.head()).recap.threads.length, shown);
});

test('a quest deadline that passed in the gap asks the story in v2\'s lines', () => {
    const chat = new Chat();
    chat.send();
    chat.answer('~ time Goldwane 12, 08:00 pm\n+ quest Bounty on Kettle Jack — bring him in alive | giver: Warden Hale | goal: bring him in alive | due: Goldwane 14', { said: 'I take the bounty on Kettle Jack.' });
    chat.send();
    chat.answer('~ time Goldwane 15, 07:00 am');
    const [line] = chat.send().tail.lines;
    assert.match(line, /: Bounty on Kettle Jack — deadline Goldwane 14, 11:59 pm passed \(bring him in alive\)\./);
    assert.ok(line.endsWith(`${AWAY_RECORD_V2} ${AWAY_DEADLINE_V2}`));
    assert.equal(thread(chat.head(), 'Bounty on Kettle Jack').status, 'active', 'overdue, within its grace');
});

test('the static part is byte-identical whatever the state; only the tail changes', () => {
    const before = part.context.static();
    assert.equal(before, '');
    assert.equal(part.context.static.length, 0);
    const chat = begun(WORLD);
    chat.answer('~ time Goldwane 15, 07:00 am');
    const { tail } = chat.send();
    assert.equal(tail.lines.length, 1);
    assert.equal(part.context.static(), before);
    assert.deepEqual(part.context.tail({ state: undefined }), { lines: [], optional: [] });
});

// ---- v1 parity: the same story in v1's tracker and in v2's threads -------------------------

const V1_LINES = [
    '+ event Stray Oar — the inn | then: sacked by the guild | on: Goldwane 13',
    "+ agenda Bond collector — rides out | leg: Shorn → Hollin's Reach 40 B, ride 60/day → 1 | arrive: Goldwane 14",
    '+ beat Ambush at the weir — riders wait | on: Goldwane 14, 09:00 am | encounter: 3 bandit',
    '+ beat Guards sack the Stray Oar — the guild moves | on: Goldwane 10',
    '+ hook Rat Culling — rats in the granary | giver: Danique | reward: 5 copper | due: Goldwane 11',
    '+ hook Herb run — moonleaf | giver: Mother Ysolde | reward: 5 copper | due: Goldwane 20',
    '+ clock Graves — the dead rise | due: Goldwane 14',
];

function v1Tracker(lines) {
    const parsed = parseChanges(lines.join('\n'));
    assert.deepEqual(parsed.errors, []);
    return applyOps(emptyTracker(), parsed.ops, { message: 1 }).tracker;
}

test('v1 parity: the same beats slip and the same offers lapse', () => {
    const v1 = v1Tracker(V1_LINES);
    const chat = begun(V1_LINES, { start: 'Goldwane 9, 08:00 am' });
    for (const now of ['Goldwane 11, 09:00 am', 'Goldwane 12, 09:00 am', 'Goldwane 13, 09:00 am', 'Goldwane 21, 09:00 am']) {
        const options = { calendar, now: at(now) };
        const expected = [...slippedBeats(v1, options), ...lapsedOffers(v1, options)].map(record => record.key).sort();
        const got = standing(director(chat.head()), { calendar, now: at(now) }).lapses.map(({ id }) => director(chat.head()).threads[id].key).sort();
        assert.deepEqual(got, expected, now);
    }
});

test('v1 parity: the recap is v1\'s While away for a twelve-hour jump, in v2\'s forms', () => {
    const v1 = v1Tracker(V1_LINES);
    const from = at('Goldwane 12, 08:00 pm');
    const to = at('Goldwane 15, 07:00 am');
    const selection = classify(v1, { calendar, now: to, message: 1 });
    const away = noteParts(selection, { calendar, previousTime: from }).find(entry => entry.label === 'While away').text;
    const chat = begun(V1_LINES, { start: 'Goldwane 9, 08:00 am' });
    const built = buildRecap(director(chat.head()), { calendar, from, to, minMinutes: 6 * 60 });
    assert.deepEqual(built.lines, [`[While away] ${v2Asks(away.replace(/^While away \((.+?)\): /, '$1: '))}`]);
    // v2's forms replace v1's bare-key asks, and only those.
    assert.equal(v2Asks(`${AWAY_RECORD} ${AWAY_ARRIVAL} ${AWAY_DEADLINE}`), `${AWAY_RECORD_V2} ${AWAY_ARRIVAL_V2} ${AWAY_DEADLINE_V2}`);
    // A shorter jump than v1's twelve hours: the same items v1 picks for that gap, the span from the jump's start.
    const short = buildRecap(director(chat.head()), { calendar, from: at('Goldwane 14, 06:00 am'), to: at('Goldwane 14, 01:00 pm'), minMinutes: 6 * 60 });
    assert.equal(short.lines[0], `[While away] Goldwane 14, 06:00 am → Goldwane 14, 01:00 pm: Ambush at the weir (Goldwane 14, 09:00 am) (fought off-screen: 3 bandit). ${AWAY_CUE} ${AWAY_RECORD_V2}`);
});
