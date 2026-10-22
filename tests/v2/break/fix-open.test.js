// The open findings of the beta fuzz and matrix cells, on Story Block's real feature switch and with
// Story Director alone (WAVE rule 11: no RPG Battle). The cells' own tests sit beside this one
// (c1-time-after-middle-delete, c2-time-jump-per-reply, c1-days-date-twice, c2-digest-back-on,
// c2-digest-off-queries); these add what they could not drive: the reader's switch through the host,
// and replay == live after each fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { DIGEST_FEATURE } from '../../../src/v2/chronicle/days.js';
import { needsDigest } from '../../../src/v2/chronicle/digest.js';
import { timeAfter } from '../../../src/v2/tracker/time.js';
import { calendarOf, settingsDefaults } from '../../../src/v2/tracker/time.js';

const DAY = 1440;
const reply = (text, lines = []) => (lines.length ? `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);

async function aloneHost() {
    let host = null;
    const module = createModule({ host: { settings: id => host?.sdk.settings(id) ?? null, substitute: text => host?.sdk.substitute(text) } });
    host = await createHost({ modules: [module] });
    return host;
}

async function sameOnReload(host, where) {
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live, `${where}: rebuild != live`);
    const again = await aloneHost();
    try {
        await again.st.loadChat(structuredClone(host.ctx.chat));
        assert.deepEqual(again.store.problems(), [], `${where}: a fresh load skips nothing`);
        assert.equal(JSON.stringify(again.head().domains), JSON.stringify(host.head().domains), `${where}: fresh replay != live`);
    } finally {
        again.close();
    }
}

// ---- C1-6: the clock is a count ----------------------------------------------------------------

test('C1-6 alone: deleting a middle reply takes its time move back; later moves and the rebuild agree', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await aloneHost();
    try {
        await host.send('Hello.', reply('The road.', ['~ time 3 March 1200, 08:00']));
        const t0 = host.head().domains.director.time.minutes;
        await host.send('Walk.', reply('Two hours.', ['! time +2h']));
        await host.send('Wait.', reply('Three hours.', ['! time +3h']));
        await host.send('Sleep.', reply('A night.', ['! time +10h']));
        const a = host.ctx.chat.length - 5;   // the +2h reply
        await host.st.deleteMessage(a);
        await host.st.deleteMessage(a - 1);
        assert.deepEqual(host.store.problems(), []);
        assert.equal(host.head().domains.director.time.minutes - t0, 13 * 60, 'the +3h and +10h are left');
        await sameOnReload(host, 'after the delete');
    } finally {
        host.close();
    }
});

// ---- C2-5: maxJump per reply -------------------------------------------------------------------

test('C2-5: maxJump holds for the whole reply, from where the reply began; each reply has its own', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await aloneHost();
    try {
        await host.send('Morning.', reply('Dawn.', ['~ time March 3, 1200, 8:00 am']));
        const start = host.head().domains.director.time.minutes;
        await host.send('Wait.', reply('Weeks.', ['! time +20d', '! time +20d', '~ time 12:00 pm']));
        const one = host.head().domains.director.time.minutes;
        assert.equal(one - start, 30 * DAY, 'two +20d lines move 30 days in all; a later clock time moves nothing more');
        const problems = Object.values(host.head().domains.director.problems).filter(problem => problem.kind === 'time');
        assert.ok(problems.some(problem => /past where this reply began/.test(problem.text)), 'a Problem says why');
        await host.send('Wait more.', reply('Weeks again.', ['! time +30d']));
        assert.equal(host.head().domains.director.time.minutes - one, 30 * DAY, 'the next reply has its own 30 days');
        await sameOnReload(host, 'after the held replies');
    } finally {
        host.close();
    }
});

test('C2-5 (pure): timeAfter holds a move to `from` + maxJump, and never takes the clock back', () => {
    const calendar = calendarOf(settingsDefaults());
    const line = text => ({ op: '!', kind: 'time', name: text, text: '', labels: {} });
    const from = 1000 * DAY;
    assert.equal(timeAfter(line('+5d'), from + 28 * DAY, calendar, { maxJump: 30 * DAY, from }).minutes, from + 30 * DAY);
    assert.equal(timeAfter(line('+1d'), from + 28 * DAY, calendar, { maxJump: 30 * DAY, from }).minutes, from + 29 * DAY);
    // Another rule (crafting's director.advance) already took the clock past the limit: it stays.
    assert.equal(timeAfter(line('+1h'), from + 31 * DAY, calendar, { maxJump: 30 * DAY, from }).minutes, from + 31 * DAY);
    // Without `from`, the line alone is held (as before).
    assert.equal(timeAfter(line('+40d'), from, calendar, { maxJump: 30 * DAY }).minutes, from + 30 * DAY);
});

// ---- B-c2-2 / B-c2-3: the digest switch, through the host ---------------------------------------

test('digest off through the reader\'s switch: its queries answer null; back on, the days missed are written', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await aloneHost();
    try {
        host.features.set(DIGEST_FEATURE, false);
        await host.send('Start.', reply('Morning in Harrow.', ['~ time June 3, 1200, 08:00 am', '~ place Harrow', '+ coin 40']));
        await host.send('Sleep.', reply('Night, a day on the road, night again.', ['! time +40h', '~ place Old Weir']));
        await host.send('Wake.', reply('Day three.', ['+ item Bread']));
        for (const name of ['chronicle.days', 'chronicle.day', 'chronicle.dayBoard', 'chronicle.dayFacts']) {
            assert.equal(host.sdk.query(name, { day: 0 }), null, `${name} answers null while the digest is off`);
        }
        const off = host.head().domains.chronicle;
        assert.deepEqual(Object.keys(off.dayFacts ?? {}), [], 'no day facts kept while off');
        assert.ok(off.noted?.[0]?.gap, 'the note marks where the day facts stopped');
        host.features.set(DIGEST_FEATURE, true);
        await host.send('On we go.', reply('Later the same day.', ['! time +1h']));
        const days = host.sdk.query('chronicle.days') ?? [];
        assert.deepEqual(days.map(day => day.date), ['June 3, 1200'], 'the day that ended while off is written');
        assert.match(days[0].line, /to Harrow/);
        assert.match(days[0].line, /40 gold in/);
        assert.equal(host.head().domains.chronicle.noted[0].gap, undefined, 'back on, the gap is closed');
        await host.send('Next day.', reply('Dawn.', ['! time +30h']));
        await host.send('More.', reply('On.'));   // the hook before this reply writes June 5
        assert.deepEqual((host.sdk.query('chronicle.days') ?? []).map(day => day.date), ['June 3, 1200', 'June 5, 1200'], 'and it carries on');
        await sameOnReload(host, 'after the switch');
    } finally {
        host.close();
    }
});

test('needsDigest: nothing written yet, a day the notes began on (or kept facts of) has ended', () => {
    const noted = from => [{ rev: 3, minutes: null, from, settle: null }];
    assert.equal(needsDigest({ noted: noted(10) }, 12), true);
    assert.equal(needsDigest({ noted: noted(12) }, 12), false, 'still the first day');
    assert.equal(needsDigest({ noted: noted(null), dayFacts: { '11.4': { day: 11, count: 1 } } }, 12), true);
    assert.equal(needsDigest({ noted: noted(null) }, 12, { settledDay: 11 }), true, 'as before');
});

test('the Days board gives each day its line without the date (`short`), the line itself keeps it', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await aloneHost();
    try {
        await host.send('Start.', reply('Harrow.', ['~ time June 3, 1200, 08:00 am', '~ place Harrow']));
        await host.send('On.', reply('Next day.', ['! time +1d']));
        await host.send('On.', reply('On.'));
        const [day] = host.sdk.query('chronicle.dayBoard').days;
        assert.equal(day.line, 'June 3, 1200: to Harrow.');
        assert.equal(day.short, 'to Harrow.');
    } finally {
        host.close();
    }
});
