// A short delete fuzz for CI (the b1-capture harness's FUZZ_DELETE mode, cut down to Story Director's
// lines): a few seeds of 20 replies, each with a middle exchange deleted twice along the way. After each
// delete every stored block must still apply (no replay-skip Problem), a rebuild must give the live
// state, the head must pass every validator, and at the end a fresh host loading the chat must give
// the same state. Lines only name what their own reply made or what the first reply made (which is
// never deleted), so a skip can only come from bookkeeping one reply keeps for another (B-b1r2-12).
// The first reply's threads are made with every field later lines change: a later reply that changes
// a field only a deleted reply had added is Story Block's to replay (its `replace` finds no key).
// The first reply also opens six world events; later replies resolve or move them, and a delete is
// often of a reply holding a world pick (final soak: a later world line was lost with it) or an NPC
// initiative pick (director.initiative, a slot written whole before the reply).
// Smallfix: quests carry a deadline (`due:`) and some replies jump days, so time.settle lapses threads a
// later delete takes away (its closing is passed over, ctx.ifThere); and after each delete the clock must
// be what the replies left say: `~ time <date>` exact (a set, ctx.absolute), moves added on top. Between replies the
// reader sometimes accepts an arc plan (director.arc.accept, its own names) or ends the arc.
// Trips (feature story-director.trip): from a stream of their own, replies that make a route between the first reply's places, put the scene in one of
// them and set out, delay or stop a trip (`~ trip`); the records are per reply (atlas.trips), so a delete of the reply that set out leaves a later
// delay with nothing to move, never a failing block.
// Lasting changes (chronicle.lasting, a pack's events: tests/v2/chronicle/helpers/lasting-pack.js): a pack whose
// events write and move world events (one chain tried before the first reply has set the clock, so it waits),
// replies whose world lines name them, and the reader's edits of them, from a random stream of their own.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { fakeFightRunner } from '../integration/helpers/fake-fight-runner.js';
import { LASTING_PACK, lastingEdit, lastingLines } from '../chronicle/helpers/lasting-pack.js';

const SEEDS = [1, 2, 3];
const REPLIES = 20;
const DELETE_AT = [10, 16, 20];
// The reply after which the reader adds "copper bit" and "gold" under Settings → Coins: rewards owed then count.
const COINS_AT = 7;

// mulberry32: the fuzz's only randomness.
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

// Record IDs come from crypto: seeded for the run, so a failure replays with its seed.
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

const BASE = ['Base Hook', 'Base Rumour'];
const BASE_PLACES = ['Bluewatch', 'Ridge Fort'];
// World events the first reply opens: more than three stay open, so a world pick (chronicle.surface, on
// the carrier before each reply) runs before nearly every reply, and later replies move them on.
const BASE_WORLD = ['Salt Riots', 'Hill Rains', 'Wolf Winter', 'River Levy', 'Grain Fever', 'Pass Bandits'];
const THREAD_KINDS = ['hook', 'agenda', 'event', 'beat', 'secret'];
const STATES = ['looming', 'ongoing', 'resolved'];
const FUNNY = ['Ro​pe', '‮Rope', 'Rópe', '__proto__', 'constructor', 'x'.repeat(130)];

const SYLLABLES = ['ka', 'vo', 'ru', 'mi', 'te', 'sa', 'lo', 'fen', 'dar', 'qui', 'zo', 'bel', 'nor', 'ith', 'wy', 'gra'];
const word = r => {
    const text = Array.from({ length: 3 }, () => r.pick(SYLLABLES)).join('');
    return text[0].toUpperCase() + text.slice(1);
};

// One reply's lines: new things under names of its own, then changes to its own or the first reply's.
function replyLines(r, n) {
    const own = [];
    const quests = [];
    const lines = [];
    // One made-up word per name, all of one length: no name reads as near another (v1's near keys
    // match shared words and a word inside another), so a line never reaches another reply's thread.
    let made = 0;
    const name = () => `${word(r)}${String(n).padStart(2, '0')}${String((made += 1)).padStart(2, '0')}`;
    for (let i = r.int(1, 6); i > 0; i -= 1) {
        const roll = r();
        if (roll < 0.35) {
            const key = name();
            own.push(key);
            lines.push(`+ ${r.pick(THREAD_KINDS)} ${key} — something${r.chance(0.3) ? ` | giver: ${r.pick(['Fenna', 'Brom'])}` : ''}`);
        } else if (roll < 0.5) {
            const key = name();
            own.push(key);
            // Often only mentioned first (a hook with its giver and pay), then accepted in the same reply:
            // the + quest makes the hook the quest, active and taken on at once.
            if (r.chance(0.4)) lines.push(`+ hook ${key} — a job on offer | giver: Fenna | reward: ${r.int(1, 30)} gold`);
            // Now and then in a coin word the chat cannot count until the Coins are set (COINS_AT): the turn-in
            // leaves it owed (quest.payOwed pays it once the coins count it, in a later reply).
            const pay = r.chance(0.35) ? `${r.int(1, 30)} copper bits` : `${r.int(1, 30)} gold`;
            lines.push(`+ quest ${key} — a job | giver: Fenna | goal: Find the ${key} | reward: ${pay}${r.chance(0.7) ? ` | due: June ${r.int(3, 7)}, 1200` : ''}`);
            quests.push(key);
        } else if (roll < 0.62) {
            const from = r.chance(0.5) ? r.pick(BASE_PLACES) : name();
            lines.push(r.chance(0.5) ? `+ route ${from} — ${name()} | hours: ${r.int(1, 9)} | kind: ${r.pick(['road', 'trail'])}` : `+ landmark ${name()} | region: Vale | kind: ${r.pick(['town', 'ruin'])}`);
        } else if (roll < 0.72) {
            const key = name();
            lines.push(`+ world ${key} — afoot | state: ${r.pick(STATES)}`);
            if (r.chance(0.4)) lines.push(`~ world ${key} | state: ${r.pick(STATES)}`);
        } else if (roll < 0.76) {
            // A world line on one of the first reply's events: resolved or moved on (it writes the pick's
            // rounds by key only, so a deleted pick before it never makes it fail).
            lines.push(r.chance(0.5) ? `- world ${r.pick(BASE_WORLD)} — it ends` : `~ world ${r.pick(BASE_WORLD)} | state: ${r.pick(['looming', 'ongoing'])}`);
        } else if (roll < 0.84) {
            lines.push(r.chance(0.6) ? `! time +${r.int(1, 30)}h` : r.chance(0.5) ? `! time +${r.int(2, 4)}d` : SET_LINE);
        } else if (roll < 0.92) {
            lines.push(r.pick([`? hook ${name()} — who`, '+ hook', `? hook ${r.pick(FUNNY)} — odd`, `~ quest ${name()} | met: yes`]));
        } else {
            lines.push(`~ hook ${r.pick(BASE)} | now: ${name()}`);
        }
    }
    // A quest turned in on the story's word, the giver arriving after the turn-in line (or not at all): it
    // waits for where the reply ends up, and is paid or refused by a later Director line or the step
    // before the next reply (quest.settle). Or written as a line that does not close it ("Fenna pays you"),
    // which the afterCapture step turns in from where things stand; and the story's own `+ coin` for it now
    // and then, before or after, counted as the reward or taken back (never paid twice).
    if (quests.length && r.chance(0.4)) {
        const key = r.pick(quests);
        lines.push(`~ quest ${key} | met: yes`, r.chance(0.7) ? `- quest ${key} — turned in` : `~ quest ${key} — Fenna pays you`);
        if (r.chance(0.6)) lines.push(r.chance(0.5) ? '+ present Fenna' : `~ place ${r.pick(BASE_PLACES)} | kind: town`);
        if (r.chance(0.5)) lines.push(`! time +${r.int(1, 3)}h`);
        if (r.chance(0.3)) lines.push(`+ coin ${r.int(1, 20)}`);
    }
    for (const key of own) {
        if (r.chance(0.3)) lines.push(`~ hook ${key} | now: nearby`);
        if (r.chance(0.2)) lines.push(`- hook ${key} — it passed`);
    }
    return lines;
}

// A reply's trip lines (own stream): routes from both of the first reply's places to a waypoint of the reply's own (so there is a way to go from
// wherever the scene is; routes of the reply's own, as the other lines' routes are, so a delete never takes what a later route line changes), then a
// trip, a delay or a stop. The scene starts at Bluewatch (the first reply). Reply 4 always sets out, so every seed has a trip to delete around.
function tripLines(rt, n) {
    const forced = n === 4;
    if (!forced && !rt.chance(0.35)) return [];
    const roll = forced ? 0 : rt();
    if (roll < 0.5) {
        const stop = `Wayside${n}`;
        return [`+ route ${BASE_PLACES[0]} — ${stop} | hours: ${rt.int(6, 40)} | kind: road`, `+ route ${BASE_PLACES[1]} — ${stop} | hours: ${rt.int(6, 40)} | kind: road`,
            `~ trip ${stop} | by: ${rt.pick(['foot', 'riding', 'wagon'])}${rt.chance(0.25) ? ` | via: ${BASE_PLACES[0]}` : ''}`,
            ...(forced || rt.chance(0.5) ? [`~ trip delay: ${rt.int(1, 3)} hours`] : [])];
    }
    if (roll < 0.8) return [`~ trip delay: ${rt.int(1, 20)} ${rt.pick(['hours', 'days'])}${rt.chance(0.5) ? ' | because: a lame horse' : ''}`];
    return ['~ trip stop'];
}

const said = (text, lines) => `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>`;

// The clock the replies left say, without replaying anything: the first reply sets June 3, 08:00 am
// (`start`), `SET_LINE` sets June 9, 10:00 am, each move adds on top, held to the longest jump (30 days)
// from where its reply began, as applyTimeLine does.
const SET_LINE = '~ time June 9, 1200, 10:00 am';
const SET_AFTER = (6 * 24 + 2) * 60;
const MAX_JUMP = 30 * 24 * 60;
const timeOf = lines => lines.map(line => {
    if (line === SET_LINE) return { set: true };
    const move = /^! time \+(\d+)([hd])$/.exec(line);
    return move ? { move: Number(move[1]) * (move[2] === 'd' ? 1440 : 60) } : null;
}).filter(Boolean);
function expectedClock(chat, times, start) {
    let clock = start;
    for (const message of chat) {
        const from = clock;
        for (const step of times.get(message) ?? []) {
            if (step.set) clock = start + SET_AFTER;
            else clock = Math.min(clock + step.move, Math.max(clock, from + MAX_JUMP));
        }
    }
    return clock;
}

function validatorErrors(host) {
    const state = host.head();
    const out = [];
    for (const name of Object.keys(state.domains)) {
        const validate = host.registry.validator(name);
        if (typeof validate === 'function') out.push(...(validate(state.domains[name], state) ?? []).map(error => `${name}: ${error}`));
    }
    return out;
}

for (const seed of SEEDS) {
    test(`delete fuzz, seed ${seed}: ${REPLIES} replies with middle deletes replay cleanly`, async t => {
        t.mock.method(console, 'warn', () => {});
        const restore = seedCrypto(seed);
        const r = prng(seed);
        const ra = prng(seed ^ 0xA5C);
        const rl = prng(seed ^ 0x1A57);
        const rt = prng(seed ^ 0x7121);
        const host = await createHost({ modules: [fakeFightRunner(), createModule()] });
        try {
            assert.equal((await host.packs.packs.install(LASTING_PACK, { origin: 'pack.json' })).ok, true);
            await host.send('Hello.', said('The road.', ['~ time June 3, 1200, 08:00 am', `~ place ${BASE_PLACES[0]} | kind: town`, ...BASE.map(key => `+ hook ${key} — an old tale | now: the inn`),
                ...BASE_PLACES.map(place => `+ landmark ${place} | region: Vale | kind: town`),
                ...BASE_WORLD.map(key => `+ world ${key} — afoot | state: ongoing`)]));
            const start = host.head().domains.director.time.minutes;
            const times = new Map();
            const clock = () => host.head().domains.director.time.minutes;
            for (let n = 1; n <= REPLIES; n += 1) {
                const lines = [...replyLines(r, n), ...lastingLines(rl), ...tripLines(rt, n)];
                await host.send(r.chance(0.3) ? 'I take the job.' : `On we go (${n}).`, said(`Reply ${n}.`, lines));
                times.set(host.ctx.chat.at(-1), timeOf(lines));
                if (n === COINS_AT) host.settings.set('story-block', 'coins', [{ name: 'copper bit', plural: 'copper bits', value: 1 }, { name: 'gold', value: 100 }]);
                assert.equal(clock(), expectedClock(host.ctx.chat, times, start), `seed ${seed}, reply ${n}: the clock (live)`);
                // The reader's arc commands (own random stream, so the story's lines stay as they were): an
                // accepted plan of its own names now and then, and sometimes End arc.
                if (ra.chance(0.3)) {
                    const plan = [`ARC: Arc${n} — the tide turns`, `BEAT: Beat${n}a — a bell | place: the quay`, `BEAT: Beat${n}b — a storm | after: Beat${n}a`, `AGENDA: Agent${n} — schemes | now: the docks`, `SECRET: Secret${n} — hidden`].join('\n');
                    const accepted = await host.sdk.command('director.arc.accept', { plan });
                    assert.ok(accepted.ok, accepted.message);
                } else if (ra.chance(0.15) && host.sdk.query('director.arc')?.current?.active) {
                    assert.ok((await host.sdk.command('director.arc.end', {})).ok);
                }
                const edit = lastingEdit(rl, host, n);
                if (edit) assert.ok((await host.sdk.command('chronicle.edit', edit)).ok, `seed ${seed}, reply ${n}: the reader's edit`);
                if (!DELETE_AT.includes(n)) continue;
                // A middle exchange in the first half (so many replies come after it): never the first.
                const chat = host.ctx.chat;
                const users = chat.map((message, i) => (message.is_user ? i : -1)).filter(i => i > 2 && i < chat.length / 2);
                // Often one whose reply holds a world pick (chronicle.surface) or an NPC initiative pick
                // (director.initiative: Fenna gives jobs and is now and then present) with replies after it.
                const picks = host.sdk.receipts().filter(entry => entry.receipt.type === 'chronicle.surface').map(entry => entry.index);
                // The initiative step is kept on the reader's message before the reply it is for.
                const initiative = host.sdk.receipts().filter(entry => entry.receipt.type === 'director.initiative').map(entry => entry.index);
                const picked = users.filter(i => picks.includes(i + 1) || initiative.includes(i));
                // Or one whose reply made a quest a later settle lapsed (its closing is then passed over).
                const lapsed = new Set(host.sdk.receipts().filter(entry => entry.receipt.type === 'time.settle').flatMap(entry => entry.receipt.data?.lapsed ?? []).map(entry => entry.key));
                const lapsedHere = users.filter(i => [...lapsed].some(key => chat[i + 1]?.mes?.includes?.(`+ quest ${key} `)));
                const user = lapsedHere.length && r.chance(0.6) ? r.pick(lapsedHere) : picked.length && r.chance(0.5) ? r.pick(picked) : r.pick(users);
                // A reward owed that was paid since (thread.owed.paid): deleting the reply that closed the quest takes the
                // payment's block with it (it depends on the debt), which Story Block reports as skipped, so it is
                // not "a later block no longer applies" for any other reason.
                const closedHere = Object.values(host.head().domains.director.threads).filter(thread => thread.owed?.paid && String(chat[user + 1]?.mes).includes(`- quest ${thread.key} `));
                await host.st.deleteMessage(user + 1);
                await host.st.deleteMessage(user);
                const where = `seed ${seed}, reply ${n}, deleted ${user}`;
                const skipped = host.store.problems().map(problem => problem.why ?? problem.message);
                if (closedHere.length) assert.ok(skipped.length <= closedHere.length * 2 + 1, `${where}: only the payments of the deleted turn-in are skipped (${skipped.join(' / ')})`);
                else assert.deepEqual(skipped, [], `${where}: a later block no longer applies`);
                const live = JSON.stringify(host.head());
                host.store.rebuild();
                assert.equal(JSON.stringify(host.head()), live, `${where}: rebuild != live`);
                assert.deepEqual(validatorErrors(host), [], where);
                assert.equal(clock(), expectedClock(host.ctx.chat, times, start), `${where}: the clock`);
            }
            await host.send('And then?', 'Quiet.');
            assert.deepEqual(validatorErrors(host), [], `seed ${seed}: the head state`);
            assert.ok(host.sdk.receipts().some(entry => entry.receipt.type === 'events.fire' && entry.receipt.data?.then?.includes('chronicle.lasting')), `seed ${seed}: a pack event wrote a lasting change`);
            const summaries = host.sdk.receipts().map(entry => entry.receipt.summary ?? '');
            const tripsMade = summaries.filter(text => /^On the road to /.test(text)).length;
            assert.ok(tripsMade >= 1, `seed ${seed}: the fuzz set out on a trip`);
            t.diagnostic(`seed ${seed}: trips set out ${tripsMade}, delayed ${summaries.filter(text => /is delayed/.test(text)).length}, stopped ${summaries.filter(text => /^The trip to .* ends/.test(text)).length}`);
            t.diagnostic(`seed ${seed}: pack events that fired: ${[...new Set(host.sdk.receipts().filter(entry => entry.receipt.type === 'events.fire').map(entry => entry.receipt.data?.event?.split('/')[1]))].join(', ')}`);
            const again = await createHost({ modules: [fakeFightRunner(), createModule()] });
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
