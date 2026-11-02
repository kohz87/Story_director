// A delete fuzz for the reader's own clock edits (director.clock), forward and back: replies with deadlines and money that move the clock
// by hours or days, and now and then, after a reply, the reader sets the date and time by hand inside June 1200 (a rewind about half the time).
// Middle exchanges are deleted along the way, often the one holding an edit. After each delete every stored block must still apply, a rebuild
// must give the live state, the World and Journal must read the same after it, the head must pass every validator; before each reply, the
// digests the hook wrote must be consistent with the clock it ran on (none for today or later, every day it lists is there, the caps hold),
// whichever way the clock was set; and a fresh host loading the chat must give the same state. (The cap right after a delete is not asserted:
// replay can lose a cap's removal that a deleted digest made, and the next digest trims again, as the other delete fuzz leaves it.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { PRESETS, makeCalendar } from '../../../src/calendar.js';
import { dayOf, orderedDays, writtenOf } from '../../../src/v2/chronicle/days.js';

const SEEDS = [21, 22, 23];
const REPLIES = 18;
const DELETE_AT = [6, 12, 18];
const CAPS = { FULL: 3, KEEP: 5 };
const GREGORIAN = makeCalendar(PRESETS.gregorian);

function prng(seed) {
    let a = seed >>> 0;
    const next = () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.int = (min, max) => min + Math.floor(next() * (max - min + 1));
    next.pick = list => list[Math.floor(next() * list.length)];
    next.chance = p => next() < p;
    return next;
}

function seedCrypto(seed) {
    const crypto = globalThis.crypto;
    const random = prng(seed ^ 0x9E3779B9);
    const own = { values: Object.hasOwn(crypto, 'getRandomValues'), uuid: Object.hasOwn(crypto, 'randomUUID') };
    const old = { values: crypto.getRandomValues, uuid: crypto.randomUUID };
    crypto.getRandomValues = array => {
        const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
        for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(random() * 256);
        return array;
    };
    crypto.randomUUID = () => {
        const hex = Array.from({ length: 32 }, () => Math.floor(random() * 16).toString(16)).join('');
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
    };
    return () => {
        if (own.values) crypto.getRandomValues = old.values; else delete crypto.getRandomValues;
        if (own.uuid) crypto.randomUUID = old.uuid; else delete crypto.randomUUID;
    };
}

const PLACES = ['Bluewatch', 'Ridge Fort', 'Old Weir', 'Harrow'];

// One reply's lines: money in, a move, a job with a deadline in the first days of June (so a clock set forward lapses it and one set back
// leaves it standing), and the clock moved on by hours or days.
function replyLines(r, n) {
    const lines = [];
    if (r.chance(0.5)) lines.push(`+ coin ${r.int(1, 40)} | from: job ${n}`);
    if (r.chance(0.4)) lines.push(`~ place ${r.pick(PLACES)}`);
    if (r.chance(0.4)) lines.push(`+ hook Job ${n} — a job | giver: Fenna | due: June ${r.int(4, 25)}, 1200`);
    if (r.chance(0.2)) lines.push(`+ world Trouble ${n} — afoot | state: ${r.pick(['looming', 'ongoing'])}`);
    const step = r();
    if (step < 0.45) lines.push(`! time +${r.int(2, 30)}h`);
    else if (step < 0.6) lines.push(`! time +${r.int(1, 3)}d`);
    return lines;
}

const said = (text, lines) => (lines.length ? `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);

function validatorErrors(host) {
    const state = host.head();
    return Object.keys(state.domains).flatMap(name => (host.registry.validator(name)?.(state.domains[name], state) ?? []).map(error => `${name}: ${error}`));
}

const settings = { modules: { 'story-director': { 'chronicle.digestDays': CAPS.FULL, 'chronicle.digestKeep': CAPS.KEEP } } };

for (const seed of SEEDS) {
    test(`clock edit fuzz, seed ${seed}: edits forward and back, middle deletes, replay equals live`, async t => {
        t.mock.method(console, 'warn', () => {});
        const restore = seedCrypto(seed);
        const r = prng(seed);
        const re = prng(seed ^ 0xC10C);
        let edits = 0;
        let rewinds = 0;
        const host = await createHost({ modules: [createModule()], settings });
        try {
            await host.send('Hello.', said('The road.', ['~ time June 3, 1200, 08:00 am', '~ place Bluewatch', '+ coin 5']));
            for (let n = 1; n <= REPLIES; n += 1) {
                await host.send(`On we go (${n}).`, said(`Reply ${n}.`, replyLines(r, n)));
                const head = host.head();
                const today = dayOf(head.domains.director.time.minutes);
                // The digests the hook wrote just now were written on the clock before this reply, set either way.
                const written = writtenOf(head.domains.chronicle);
                const kept = orderedDays(head.domains.chronicle);
                if (written) {
                    const have = new Set(kept.map(day => day.day));
                    for (const day of written.days) assert.ok(have.has(day), `seed ${seed}, reply ${n}: day ${day} is missing`);
                    for (const day of have) assert.ok(day <= written.through, `seed ${seed}, reply ${n}: day ${day} has not ended`);
                    assert.ok(written.through <= today, `seed ${seed}, reply ${n}: digests through day ${written.through}, the clock is on day ${today}`);
                }
                assert.ok(kept.length <= CAPS.KEEP, `seed ${seed}, reply ${n}: ${kept.length} days kept`);
                assert.ok(kept.filter(day => !day.brief).length <= CAPS.FULL, `seed ${seed}, reply ${n}: too many whole days`);
                // The reader sets the clock by hand now and then: any day of June, any minute of it.
                if (re.chance(0.4)) {
                    const day = re.int(1, 28);
                    const minutes = re.int(0, 1439);
                    const before = head.domains.director.time.minutes;
                    const done = await host.sdk.command('director.clock', { year: 1200, month: 6, day, minutes });
                    assert.ok(done.ok, `seed ${seed}, reply ${n}: ${done.message}`);
                    const abs = GREGORIAN.toAbs({ year: 1200, month: 5, day, minutes });
                    assert.equal(host.head().domains.director.time.minutes, abs, `seed ${seed}, reply ${n}: the clock is what the reader set`);
                    edits += 1;
                    if (abs < before) rewinds += 1;
                }
                if (!DELETE_AT.includes(n)) continue;
                const chat = host.ctx.chat;
                const users = chat.map((message, i) => (message.is_user ? i : -1)).filter(i => i > 2 && i < chat.length - 2);
                // Often the exchange whose reply holds an edit.
                const edited = host.sdk.receipts().filter(entry => entry.receipt.type === 'director.clock').map(entry => entry.index);
                const holding = users.filter(i => edited.includes(i + 1));
                const user = holding.length && r.chance(0.7) ? r.pick(holding) : r.pick(users);
                await host.st.deleteMessage(user + 1);
                await host.st.deleteMessage(user);
                const where = `seed ${seed}, reply ${n}, deleted ${user}`;
                assert.deepEqual(host.store.problems().map(problem => problem.why ?? problem.message), [], `${where}: a later block no longer applies`);
                const live = JSON.stringify(host.head());
                const shown = JSON.stringify([host.sdk.query('director.world'), host.sdk.query('director.journal'), host.sdk.query('director.time')]);
                host.store.rebuild();
                assert.equal(JSON.stringify(host.head()), live, `${where}: rebuild != live`);
                assert.equal(JSON.stringify([host.sdk.query('director.world'), host.sdk.query('director.journal'), host.sdk.query('director.time')]), shown, `${where}: World, Journal and the clock after a rebuild`);
                assert.deepEqual(validatorErrors(host), [], where);
            }
            assert.ok(edits >= 3 && rewinds >= 1, `seed ${seed}: ${edits} edits, ${rewinds} of them back`);
            t.diagnostic(`seed ${seed}: clock edits ${edits}, back ${rewinds}`);
            await host.send('And then?', said('Quiet.', ['! time +1d']));
            await host.send('Rest.', 'Quiet.');
            assert.deepEqual(validatorErrors(host), [], `seed ${seed}: the head state`);
            const again = await createHost({ modules: [createModule()], settings });
            try {
                await again.st.loadChat(structuredClone(host.ctx.chat));
                assert.deepEqual(again.store.problems(), [], `seed ${seed}: a fresh load skips nothing`);
                assert.equal(JSON.stringify(again.head().domains), JSON.stringify(host.head().domains), `seed ${seed}: fresh replay != live`);
            } finally {
                again.close();
            }
        } finally {
            host.close();
            restore();
        }
    });
}
