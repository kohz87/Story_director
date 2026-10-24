// The delete fuzz with day crossings (the day digest, feature story-director.digest): replies that move
// the clock by hours or days (time lines and crafting's director.advance), with money, places, items
// and world lines, and middle exchanges deleted along the way. After each delete every stored block must still apply, a rebuild must give the live
// state and every validator must pass; after the next reply every day the digests had is there again
// and none is for today or later; the caps hold throughout; the World screen and its Journal read the same
// after a rebuild; a fresh load gives the live state. Some
// deletes are inside a day that already has its digest: the digest follows the facts left.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { fakeRpgBattle } from '../integration/helpers/fake-rpg.js';
import { fakeCraft } from '../time/helpers/fake-craft.js';
import { DIGEST, dayOf, entriesByDay, orderedDays, writtenOf } from '../../../src/v2/chronicle/days.js';

// Seeds 11–12 keep few days (older ones go short, which a later digest rewrites); 13–14 keep them
// whole, so a delete leaves a gap a later digest lists.
const SEEDS = [11, 12, 13, 14];
const REPLIES = 24;
const DELETE_AT = [8, 14, 20, 24];

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

// One reply's lines: money in (never out, so a deleted reply's money never leaves a later payment
// short), a move, an item of its own, a world line of its own, and the clock moved on by hours or days.
function replyLines(r, n) {
    const lines = [];
    if (r.chance(0.5)) lines.push(`+ coin ${r.int(1, 40)} | from: job ${n}`);
    if (r.chance(0.4)) lines.push(`~ place ${r.pick(PLACES)}`);
    if (r.chance(0.3)) lines.push(`+ item Trinket ${n}`);
    if (r.chance(0.2)) lines.push(`+ world Trouble ${n} — afoot | state: ${r.pick(['looming', 'ongoing'])}`);
    // Someone new in the scene every third reply (the digest's `met`; no draw, so the seeds' stories stay as they were).
    if (n % 3 === 0) lines.push(`+ present Visitor ${n}`);
    // Crafting moves the clock through director.advance (sometimes twice for one cause: held to once).
    if (r.chance(0.3)) lines.push(`! craft Tool ${n} | hours: ${r.int(1, 30)}`);
    if (r.chance(0.1)) lines.push(`! craft Spare ${n} | hours: ${r.int(1, 5)}`);
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

function capsHold(host, where, { FULL, KEEP }) {
    const days = orderedDays(host.head().domains.chronicle);
    assert.ok(days.length <= KEEP, `${where}: ${days.length} days kept`);
    assert.ok(days.filter(day => !day.brief).length <= FULL, `${where}: too many whole days`);
}

// A whole digest made from its day's entries follows them: each of its sources is a kept entry of
// that day, and its count is theirs (a reply of the day deleted after it was written is not in it).
function digestsFollow(host, where) {
    const chronicle = host.head().domains.chronicle;
    const byDay = entriesByDay(chronicle);
    for (const digest of orderedDays(chronicle)) {
        if (digest.brief || !digest.src) continue;
        const kept = new Map((byDay.get(digest.day) ?? []).map(item => [item.rev, item.entry]));
        assert.ok(digest.src.every(rev => kept.has(rev)), `${where}: day ${digest.day} lists a source that is gone`);
        assert.equal(digest.count, digest.src.reduce((sum, rev) => sum + kept.get(rev).count, 0), `${where}: day ${digest.day} does not follow its facts`);
    }
}

// The exchanges whose reply holds a note of a day that already has its digest (a middle delete inside it).
function insideDigested(host, users) {
    const sources = new Set(orderedDays(host.head().domains.chronicle).flatMap(digest => digest.src ?? []));
    const notes = host.sdk.receipts().filter(entry => entry.receipt.type === 'chronicle.note' && sources.has(entry.receipt.rev)).map(entry => entry.index);
    return users.filter(i => notes.includes(i + 1));
}

const settingsOf = ({ FULL, KEEP }) => ({ modules: { 'story-director': { 'chronicle.digestDays': FULL, 'chronicle.digestKeep': KEEP } } });

for (const seed of SEEDS) {
    test(`delete fuzz with day crossings, seed ${seed}: digests follow deletes, replay equals live`, async t => {
        t.mock.method(console, 'warn', () => {});
        const restore = seedCrypto(seed);
        const r = prng(seed);
        const whole = seed > 12;
        const caps = whole ? { FULL: 60, KEEP: 60 } : { FULL: 3, KEEP: 5 };
        const settings = settingsOf(caps);
        let gone = 0;
        let insideDeletes = 0;
        const host = await createHost({ modules: [fakeRpgBattle(), createModule(), fakeCraft()], settings });
        try {
            await host.send('Hello.', said('The road.', ['~ time June 3, 1200, 08:00 am', '~ place Bluewatch', '+ coin 5']));
            for (let n = 1; n <= REPLIES; n += 1) {
                await host.send(`On we go (${n}).`, said(`Reply ${n}.`, replyLines(r, n)));
                const head = host.head();
                const today = dayOf(head.domains.director.time.minutes);
                const written = writtenOf(head.domains.chronicle);
                // Before this reply the hook wrote what was due: every day it had is there, none for today.
                if (written) {
                    const kept = new Set(orderedDays(head.domains.chronicle).map(day => day.day));
                    for (const day of written.days) assert.ok(kept.has(day), `seed ${seed}, reply ${n}: day ${day} is missing`);
                    for (const day of kept) assert.ok(day <= written.through, `seed ${seed}, reply ${n}: a day not ended yet`);
                    assert.ok(written.through <= today);
                }
                capsHold(host, `seed ${seed}, reply ${n}`, caps);
                if (!DELETE_AT.includes(n)) continue;
                const chat = host.ctx.chat;
                const users = chat.map((message, i) => (message.is_user ? i : -1)).filter(i => i > 2 && i < chat.length - 2);
                // Mostly an exchange whose reply carries a digest with a later one after it: the later
                // digest still lists the day, which must be written again.
                const carriers = host.sdk.receipts().filter(entry => entry.receipt.type === DIGEST).map(entry => entry.index);
                const carrying = users.filter(i => carriers.includes(i + 1) && carriers.at(-1) !== i + 1);
                // Or one inside a day that already has its digest: the digest follows what is left.
                const inside = insideDigested(host, users);
                const pick = r();
                const user = inside.length && pick < 0.4 ? r.pick(inside) : carrying.length && pick < 0.8 ? r.pick(carrying) : r.pick(users);
                if (inside.includes(user)) insideDeletes += 1;
                await host.st.deleteMessage(user + 1);
                await host.st.deleteMessage(user);
                const where = `seed ${seed}, reply ${n}, deleted ${user}`;
                assert.deepEqual(host.store.problems().map(problem => problem.why ?? problem.message), [], `${where}: a later block no longer applies`);
                const live = JSON.stringify(host.head());
                const shown = JSON.stringify([host.sdk.query('director.world'), host.sdk.query('director.journal')]);
                host.store.rebuild();
                assert.equal(JSON.stringify(host.head()), live, `${where}: rebuild != live`);
                assert.equal(JSON.stringify([host.sdk.query('director.world'), host.sdk.query('director.journal')]), shown, `${where}: World and Journal after a rebuild`);
                assert.deepEqual(validatorErrors(host), [], where);
                capsHold(host, where, caps);
                digestsFollow(host, where);
                const after = writtenOf(host.head().domains.chronicle);
                const have = new Set(orderedDays(host.head().domains.chronicle).map(day => day.day));
                if (after) gone += after.days.filter(day => !have.has(day)).length;
            }
            if (whole) assert.ok(gone > 0, `seed ${seed}: no delete took a written day away`);
            digestsFollow(host, `seed ${seed}: the head`);
            t.diagnostic(`seed ${seed}: ${insideDeletes} deletes inside a digested day`);
            await host.send('And then?', said('Quiet.', ['! time +1d']));
            await host.send('Rest.', 'Quiet.');
            assert.ok(host.sdk.receipts().some(entry => entry.receipt.type === DIGEST), `seed ${seed}: days were written`);
            assert.ok(host.sdk.query('chronicle.days').length > 0);
            assert.deepEqual(validatorErrors(host), [], `seed ${seed}: the head state`);
            const again = await createHost({ modules: [fakeRpgBattle(), createModule(), fakeCraft()], settings });
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
