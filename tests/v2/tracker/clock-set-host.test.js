// The reader's edit of the story clock (`director.clock`) on a whole Story Block host: it rides on the reply the reader is
// looking at, so a swipe or a delete of that reply takes it back and the replies after it keep their own moves exact; a replay,
// a rebuild and a fresh load give the same clock; a pack's own calendar (Ersveil) is the one it is checked on; and a clock set
// back (a rewind) is followed by deadlines and by the cast's routines as it is by the story's own earlier `~ time`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { replyEdits } from '../../vendor/story-block/src/v2/reply-cards.js';
import { castPlans } from '../../../src/v2/cast/index.js';
import { OPENING, castHost, castSource, entry, people, receipts as castReceipts, said, settle, slice, validatorErrors as castValidatorErrors } from '../cast/helpers.js';

const ERSVEIL = readFileSync(new URL('../../fixtures/ersveil-bluewatch.pack.json', import.meta.url), 'utf8');
const TAIL_KEY = 'story_suite_tail_1';
const reply = (text, lines = []) => (lines.length ? `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);
const sent = (host, key) => host.st.promptLog.filter(entry => entry.key === key && entry.value).map(entry => entry.value);
const quiet = t => t.mock.method(console, 'warn', () => {});

async function newHost(options = {}) {
    let host = null;
    const module = createModule({ host: { settings: id => host?.sdk.settings(id) ?? null, substitute: text => host?.sdk.substitute(text) } });
    host = await createHost({ modules: [module], ...options });
    return host;
}

const clock = host => host.sdk.query('director.time');
const set = (host, year, month, day, minutes = 0) => host.sdk.command('director.clock', { year, month, day, minutes });
async function mustSet(host, ...args) {
    const result = await set(host, ...args);
    assert.equal(result.ok, true, result.message);
    return result;
}

function validatorErrors(host) {
    const state = host.head();
    return Object.keys(state.domains).flatMap(name => (host.registry.validator(name)?.(state.domains[name], state) ?? []).map(error => `${name}: ${error}`));
}

async function deleteExchange(host, text) {
    const at = host.ctx.chat.findIndex(message => message.is_user && message.mes === text);
    assert.ok(at > 0, `no message "${text}"`);
    await host.st.deleteMessage(at + 1);
    await host.st.deleteMessage(at);
}

// Replay == live == a fresh load of the same chat.
async function sameEverywhere(host, where, { pack = null } = {}) {
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live, `${where}: rebuild != live`);
    assert.deepEqual(host.store.problems(), [], `${where}: a block no longer applies`);
    assert.deepEqual(validatorErrors(host), [], where);
    const again = await newHost();
    try {
        if (pack) assert.equal((await again.packs.packs.install(pack, { origin: 'pack.json' })).ok, true);
        await again.st.loadChat(structuredClone(host.ctx.chat));
        assert.deepEqual(again.store.problems(), [], `${where}: a fresh load skips nothing`);
        assert.equal(JSON.stringify(again.head().domains), JSON.stringify(host.head().domains), `${where}: reload != live`);
        assert.deepEqual(clock(again), clock(host), `${where}: the reloaded clock`);
    } finally {
        again.close();
    }
}

test('the edit is a receipt on the head reply: the clock reads it at once, the parts give it back, the status card has its line', async t => {
    quiet(t);
    const host = await newHost();
    try {
        await host.send('Hello.', reply('The road.', ['~ time March 3, 1200, 08:00 am']));
        const sets = await mustSet(host, 1200, 3, 5, 10 * 60);
        assert.equal(sets.receipt.type, 'director.clock');
        assert.equal(sets.receipt.cause, 'ui');
        assert.equal(sets.receipt.summary, 'Clock set to March 5, 10:00 am');
        assert.equal(sets.receipt.narrate, false);
        // Story Block's reply card lists a receipt as the reader's edit by `data.edit`: the tile reads the receipt's own line.
        assert.equal(sets.receipt.data.edit, true);
        assert.deepEqual(replyEdits({ receipts: host.sdk.receipts().filter(entry => entry.index === host.ctx.chat.length - 1).map(entry => entry.receipt) }), [{ text: 'Clock set to March 5, 10:00 am' }]);
        assert.deepEqual(clock(host), { minutes: sets.receipt.data.minutes, text: 'March 5, 1200, 10:00 am', parts: { year: 1200, month: 3, day: 5, minutes: 600 } });
        // The next reply's note and the story's own moves start from the edited clock.
        await host.send('We walk.', reply('Two hours on foot.', ['! time +2h']));
        assert.equal(clock(host).text, 'March 5, 1200, 12:00 pm');
        assert.deepEqual(host.store.problems(), []);
        assert.deepEqual(validatorErrors(host), []);
        // The card's Time row follows the clock by itself.
        assert.equal(host.sdk.query('director.status').summary.includes('12:00 pm'), true);
        // A year later is a set too; nothing holds it to the longest time jump of a story line.
        await mustSet(host, 1201, 3, 5, 0);
        assert.equal(clock(host).text, 'March 5, 1201, 12:00 am');
    } finally {
        host.close();
    }
});

test('a refusal saves nothing: the clock, the receipts and the head are as they were', async t => {
    quiet(t);
    const host = await newHost();
    try {
        await host.send('Hello.', reply('The road.', ['~ time March 3, 1200, 08:00 am']));
        const before = JSON.stringify(host.head());
        const receiptsBefore = host.sdk.receipts().length;
        for (const [payload, message] of [
            [{ year: 1201, month: 2, day: 29, minutes: 0 }, 'February has 28 days in 1201.'],
            [{ year: 1200, month: 2, day: 30, minutes: 0 }, 'February has 29 days in 1200.'],
            [{ year: 1200, month: 4, day: 31, minutes: 0 }, 'April has 30 days.'],
            [{ year: 1200, month: 4 }, 'Pick a date and a time.'],
            [{ year: 1200, month: 4, day: 3, minutes: 2000 }, 'Pick a time of day.'],
        ]) {
            const result = await host.sdk.command('director.clock', payload);
            assert.deepEqual([result.ok, result.message], [false, message]);
        }
        assert.equal(JSON.stringify(host.head()), before);
        assert.equal(host.sdk.receipts().length, receiptsBefore);
        // The story cannot write it: a line of the model is not the reader's click.
        const story = await host.bus.command('director.clock', { year: 1200, month: 4, day: 3, minutes: 0 }, { cause: 'story' });
        assert.equal(story.ok, false);
        assert.equal(JSON.stringify(host.head()), before);
    } finally {
        host.close();
    }
});

test('swipe: swiping the reply that holds the edit takes it back, and its other swipe keeps its own clock', async t => {
    quiet(t);
    const host = await newHost();
    try {
        await host.send('Hello.', reply('The road.', ['~ time March 3, 1200, 08:00 am']));
        await host.send('We walk.', reply('Two hours on foot.', ['! time +2h']));
        const walked = clock(host).minutes;
        await mustSet(host, 1200, 3, 20, 0);
        assert.equal(clock(host).text, 'March 20, 1200, 12:00 am');
        await host.swipe(reply('A different two hours.', ['! time +3h']));
        assert.equal(clock(host).minutes, walked + 60, 'the edit rode on the swiped reply: gone; this swipe moves 3h from the first reply\'s clock');
        assert.deepEqual(host.store.problems(), []);
        await sameEverywhere(host, 'swipe');
        // The reader edits again on the new swipe; the story goes on from there.
        await mustSet(host, 1200, 4, 1, 60);
        await host.send('On.', reply('On.', ['! time +1h']));
        assert.equal(clock(host).text, 'April 1, 1200, 02:00 am');
        await sameEverywhere(host, 'swipe, edit, next reply');
    } finally {
        host.close();
    }
});

test('middle delete: deleting the edited reply takes its edit back; later moves, and a later edit, keep their own', async t => {
    quiet(t);
    const host = await newHost();
    try {
        await host.send('Hello.', reply('The road.', ['~ time March 3, 1200, 08:00 am']));
        const start = clock(host).minutes;
        await host.send('We walk.', reply('Two hours on foot.', ['! time +2h']));
        await mustSet(host, 1200, 3, 9, 12 * 60);
        await host.send('We wait.', reply('Three hours pass.', ['! time +3h']));
        assert.equal(clock(host).text, 'March 9, 1200, 03:00 pm');
        await host.send('We rest.', reply('Slept.', ['! time +1h']));
        await mustSet(host, 1200, 3, 12, 0);
        await host.send('Later.', reply('Later.', ['! time +30m']));
        assert.equal(clock(host).text, 'March 12, 1200, 12:30 am');
        await sameEverywhere(host, 'before the delete');

        // The reply with the first edit goes: its +2h goes with it; the +3h and +1h before the second edit are what is left.
        await deleteExchange(host, 'We walk.');
        assert.deepEqual(host.store.problems(), []);
        assert.equal(clock(host).text, 'March 12, 1200, 12:30 am', 'the later edit is a set: exact');
        await sameEverywhere(host, 'after deleting the first edit\'s reply');

        // Then the reply holding the later edit: the clock is the first reply\'s plus the moves left (+3h, +1h, +30m).
        await deleteExchange(host, 'We rest.');
        assert.deepEqual(host.store.problems(), []);
        assert.equal(clock(host).minutes, start + 3 * 60 + 30, 'both edits are gone; the +3h and the +30m are added on the first reply\'s clock');
        await sameEverywhere(host, 'after deleting the second edit\'s reply');
    } finally {
        host.close();
    }
});

test('Ersveil: the pack\'s months and era are the ones checked and written; replay and reload agree', async t => {
    quiet(t);
    const host = await newHost();
    try {
        assert.equal((await host.packs.packs.install(ERSVEIL, { origin: 'pack.json' })).ok, true);
        await host.send('I wake.', reply('Gulls over the quay.'));
        assert.equal(clock(host).text, 'CY 611, Goldwane 12, 06:40 am', 'seeded from the pack\'s start');
        assert.deepEqual(clock(host).parts, { year: 611, month: 5, day: 12, minutes: 400 });
        const months = host.sdk.query('director.calendar').months.map(month => month.name);
        assert.deepEqual(months, ['Dawnwane', 'Rainmoot', 'Greengale', 'Highsun', 'Goldwane', 'Haywane', 'Emberwane', 'Nightfall', 'Frostfall', 'Deepwinter', 'Icewane', 'Yearsend']);

        const refused = await set(host, 611, 5, 31, 0);
        assert.deepEqual([refused.ok, refused.message], [false, 'Goldwane has 30 days.']);
        assert.equal((await set(host, 611, 13, 1, 0)).message, 'Pick a month from the list.', 'twelve months, not the Gregorian twelve with Gregorian lengths');
        const incomplete = await host.sdk.command('director.clock', { year: 611, month: 5, day: 14 });
        assert.deepEqual([incomplete.ok, incomplete.message], [false, 'Pick a date and a time.']);
        assert.equal(clock(host).text, 'CY 611, Goldwane 12, 06:40 am', 'nothing saved');

        const sets = await mustSet(host, 611, 5, 14, 18 * 60);
        assert.equal(sets.receipt.summary, 'Clock set to Goldwane 14, 6:00 pm', 'era and year left out while the year is the same');
        assert.equal(sets.receipt.data.date, 'CY 611, Goldwane 14, 6:00 pm');
        assert.equal(clock(host).text, 'CY 611, Goldwane 14, 06:00 pm', 'director.time keeps its own words (the prompt note is built from them)');
        // The Status card's Time row is display only and reads as the hero does.
        assert.equal(host.sdk.query('director.status').when, 'CY 611, Goldwane 14, 6:00 pm');
        assert.equal(host.sdk.query('director.status').summary.startsWith('6:00 pm'), true);
        await host.send('Dusk.', reply('Dusk falls.'));
        // A change of year (Yearsend 30 is the last day: no leap days on Ersveil) writes year and era in.
        const year = await mustSet(host, 612, 12, 30, 1439);
        assert.equal(year.receipt.summary, 'Clock set to CY 612, Yearsend 30, 11:59 pm');
        await host.send('Midnight.', reply('The bells.', ['! time +1m']));
        assert.deepEqual(clock(host).parts, { year: 613, month: 1, day: 1, minutes: 0 });
        assert.equal(clock(host).text, 'CY 613, Dawnwane 1, 12:00 am');
        // The story's own date lines read the edited clock on the pack's calendar.
        await host.send('Later.', reply('Later.', ['~ time Dawnwane 20, 613, 09:00 am']));
        assert.equal(clock(host).text, 'CY 613, Dawnwane 20, 09:00 am');
        assert.deepEqual(host.store.problems(), []);
        await sameEverywhere(host, 'Ersveil', { pack: ERSVEIL });
        // Deleting the reply that holds the year change takes it back; the story's later set is exact.
        await deleteExchange(host, 'Dusk.');
        assert.equal(clock(host).text, 'CY 613, Dawnwane 20, 09:00 am');
        await sameEverywhere(host, 'Ersveil after the year change is deleted', { pack: ERSVEIL });
        await deleteExchange(host, 'Later.');
        await deleteExchange(host, 'Midnight.');
        assert.equal(clock(host).text, 'CY 611, Goldwane 14, 06:00 pm', 'the first edit is on the first reply, which is still there');
        await sameEverywhere(host, 'Ersveil after deletes', { pack: ERSVEIL });
    } finally {
        host.close();
    }
});

test('a rewind and a deadline: the deadline follows the clock back; what time already closed stays closed; going on again closes the next one once', async t => {
    quiet(t);
    const host = await newHost();
    try {
        await host.send('Evening.', reply('The inn is loud.', [
            '~ time June 3, 1200, 08:00 pm',
            '+ hook Rat Culling — rats in the granary | giver: Danique | reward: 5 gold | due: June 4, 1200',
            '+ hook Well Watch — the wells need watching | giver: Brom | due: June 8, 1200',
            '+ event Stray Oar — the inn | then: sacked by the guild | on: June 5, 1200',
        ]));
        const thread = key => host.sdk.query('director.thread', { key });
        const tailNow = () => sent(host, TAIL_KEY).at(-1) ?? '';
        // A first quiet reply: the time part has settled the clock once, so the next jump has a start to be told from.
        await host.send('Settle.', reply('Quiet.'));

        // Forward: the reader moves the clock to June 6; the next reply is told what slipped and what came due.
        await mustSet(host, 1200, 6, 6, 8 * 60);
        await host.send('What now?', reply('The square is quiet.'));
        assert.match(tailNow(), /Lapsed: Rat Culling \(Danique's offer\) went to someone else/);
        assert.match(tailNow(), /\[While away\] June 3, 08:00 pm → June 6, 08:00 am: Stray Oar/);
        assert.deepEqual([thread('Rat Culling').status, thread('Rat Culling').ended.reason], ['resolved', 'offer lapsed']);
        assert.equal(thread('Well Watch').status, 'active');
        assert.deepEqual(host.sdk.query('time.overdue').lapsed.map(item => item.key), ['Rat Culling']);

        // Back: the clock is set to June 2, before every deadline. Nothing is told of a jump, nothing is overdue.
        await mustSet(host, 1200, 6, 2, 9 * 60);
        await host.send('Hold on.', reply('Hold on.'));
        assert.equal(clock(host).text, 'June 2, 1200, 09:00 am');
        assert.doesNotMatch(tailNow(), /While away|Lapsed|Slipped|Failed/);
        assert.equal(host.sdk.query('time.recap'), null);
        const settled = host.sdk.query('time.overdue');
        assert.equal(settled.minutes, clock(host).minutes, 'the settle follows the clock back');
        assert.deepEqual([settled.overdue, settled.pay, settled.due], [[], [], []]);
        assert.equal(thread('Rat Culling').status, 'resolved', 'what time closed already is history: it stays closed, claimed once');
        assert.equal(thread('Well Watch').status, 'active');
        assert.deepEqual(host.store.problems(), []);

        // On again, past Well Watch's deadline: it lapses (once), Rat Culling is not told again.
        await mustSet(host, 1200, 6, 10, 9 * 60);
        await host.send('Days later.', reply('Days later.'));
        assert.match(tailNow(), /Lapsed: Well Watch \(Brom's offer\)/);
        assert.doesNotMatch(tailNow(), /Rat Culling/);
        assert.equal(thread('Well Watch').status, 'resolved');
        await host.send('And?', reply('Quiet.'));
        assert.doesNotMatch(tailNow(), /Lapsed|While away/);
        assert.deepEqual(host.store.problems(), []);
        await sameEverywhere(host, 'rewind and deadline');
    } finally {
        host.close();
    }
});

test('swiping the reply that holds a forward edit and its lapse gives the deadline back, as a swipe of a story\'s own jump does', async t => {
    quiet(t);
    const host = await newHost();
    try {
        await host.send('Evening.', reply('The inn is loud.', [
            '~ time June 3, 1200, 08:00 pm',
            '+ hook Rat Culling — rats in the granary | giver: Danique | reward: 5 gold | due: June 4, 1200',
        ]));
        await mustSet(host, 1200, 6, 9, 0);
        await host.send('Well?', reply('Morning.'));
        const rats = () => host.sdk.query('director.thread', { key: 'Rat Culling' });
        assert.equal(rats().status, 'resolved');
        // The edit and the lapse live on the first reply; swiping it puts both back.
        await host.st.deleteMessage(host.ctx.chat.length - 1);
        await host.st.deleteMessage(host.ctx.chat.length - 1);
        await host.swipe(reply('The inn is quiet.', ['~ time June 3, 1200, 08:00 pm', '+ hook Rat Culling — rats in the granary | giver: Danique | reward: 5 gold | due: June 4, 1200']));
        assert.equal(rats().status, 'active');
        assert.equal(clock(host).text, 'June 3, 1200, 08:00 pm');
        assert.equal(host.head().meta.claims[`lapse:${rats().id}`], undefined);
        await sameEverywhere(host, 'swipe gives the deadline back');
    } finally {
        host.close();
    }
});

test('a rewind and the cast: the routine is read on the rewound clock, the cast only follows the clock back (no planner call), and a day on again moves it', async t => {
    quiet(t);
    const FENNA = entry('fenna', { start: { place: 'Bluewatch docks', goal: 'keep the night ferry running', routine: 'works the night ferry' } });
    const host = await castHost({ source: castSource([FENNA]), settings: { 'cast.faces': 'day2' } });
    try {
        await host.send('Hello.', said('Dawn.', OPENING));
        await host.send('Look around.', said('Smoke rises.'));
        // To the docks at noon: the ferry is not running, she is not there to meet.
        await host.send('Go to the docks.', said('The docks.', ['~ place Bluewatch docks | kind: landmark', '~ time June 3, 1200, 12:00 pm']));
        await host.send('Wait.', said('Gulls.'));
        assert.equal(people(host)['ersveil:fenna'].met, null, 'at noon the ferry is not running');
        const planned = host.model.calls.length;

        // Two days on, at noon again: the cast moves (the planner is asked), and she is still not at the docks at noon.
        await mustSet(host, 1200, 6, 5, 12 * 60);
        await host.send('Wait.', said('More gulls.'));
        await settle();
        assert.equal(host.model.calls.length, planned + 1, 'a day change moved the cast: one planner call');
        await host.send('Still waiting.', said('Still gulls.'));
        assert.equal(people(host)['ersveil:fenna'].met, null);
        const calls = host.model.calls.length;
        const moved = castReceipts(host, 'cast.advance').length;
        assert.equal(slice(host).day[0].at, host.head().domains.director.time.minutes, 'the cast\'s day is the clock now');

        // Back to the night of June 3: the cast only follows the clock back, with no planner call and no move.
        await mustSet(host, 1200, 6, 3, 21 * 60 + 30);
        const backTo = host.head().domains.director.time.minutes;
        await host.send('Wait for the ferry.', said('Lamps are lit.'));
        await settle();
        assert.equal(host.model.calls.length, calls, 'a rewind asks no one');
        assert.equal(castReceipts(host, 'cast.advance').length, moved + 1, 'one step that only moves the cast\'s minute');
        const step = castReceipts(host, 'cast.advance').at(-1).receipt;
        assert.deepEqual([step.summary, step.data], ['The cast: nothing changed.', { moved: 0, died: 0 }]);
        assert.equal(slice(host).day[0].at, backTo, 'the cast\'s minute followed the clock back');
        // Her routine is read on the rewound clock: it is night, the party is at the docks, she is there.
        assert.equal(people(host)['ersveil:fenna'].met?.why, 'place', 'at night the ferry runs');
        assert.equal(people(host)['ersveil:fenna'].met?.on, backTo);
        assert.deepEqual(castValidatorErrors(host), []);
        assert.deepEqual(host.store.problems(), []);

        // On again over the day change: the cast moves again, once.
        await mustSet(host, 1200, 6, 4, 9 * 60);
        await host.send('Morning.', said('Morning.'));
        await settle();
        assert.equal(host.model.calls.length, calls + 1, 'a new day moves the cast again');
        await host.send('Still morning.', said('Still morning.'));
        assert.equal(castReceipts(host, 'cast.advance').length, moved + 2);
        assert.equal(slice(host).day[0].at, host.head().domains.director.time.minutes);
        assert.deepEqual(host.store.problems(), []);
        const live = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live, 'rebuild == live');
    } finally {
        castPlans.clear();
        host.close();
    }
});
