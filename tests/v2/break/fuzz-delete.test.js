// A short delete fuzz for CI (the b1-capture harness's FUZZ_DELETE mode, cut down to Story Director's
// lines): a few seeds of 20 replies, each with a middle exchange deleted twice along the way. After each
// delete every stored block must still apply (no replay-skip Problem), a rebuild must give the live
// state, the head must pass every validator, and at the end a fresh host loading the chat must give
// the same state. Lines only name what their own reply made or what the first reply made (which is
// never deleted), so a skip can only come from bookkeeping one reply keeps for another (B-b1r2-12).
// The first reply's threads are made with every field later lines change: a later reply that changes
// a field only a deleted reply had added is Story Block's to replay (its `replace` finds no key).
// The first reply also opens six world events; later replies resolve or move them, and a delete is
// often of a reply holding a world pick (final soak: a later world line was lost with it).
// Smallfix: quests carry a deadline (`due:`) and some replies jump days, so time.settle lapses threads a
// later delete takes away (its closing is passed over, ctx.ifThere); and after each delete the clock must
// be what the replies left say: `~ time <date>` exact (a set, ctx.absolute), moves added on top. Between replies the
// reader sometimes accepts an arc plan (director.arc.accept, its own names) or ends the arc.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { fakeRpgBattle } from '../integration/helpers/fake-rpg.js';

const SEEDS = [1, 2, 3];
const REPLIES = 20;
const DELETE_AT = [10, 16, 20];

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
            lines.push(`+ quest ${key} — a job | giver: Fenna | goal: Find the ${key} | reward: ${r.int(1, 30)} gold${r.chance(0.7) ? ` | due: June ${r.int(3, 7)}, 1200` : ''}`);
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
    // before the next reply (quest.settle).
    if (quests.length && r.chance(0.4)) {
        const key = r.pick(quests);
        lines.push(`~ quest ${key} | met: yes`, `- quest ${key} — turned in`);
        if (r.chance(0.6)) lines.push(r.chance(0.5) ? '+ present Fenna' : `~ place ${r.pick(BASE_PLACES)} | kind: town`);
        if (r.chance(0.5)) lines.push(`! time +${r.int(1, 3)}h`);
    }
    for (const key of own) {
        if (r.chance(0.3)) lines.push(`~ hook ${key} | now: nearby`);
        if (r.chance(0.2)) lines.push(`- hook ${key} — it passed`);
    }
    return lines;
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
        const host = await createHost({ modules: [fakeRpgBattle(), createModule()] });
        try {
            await host.send('Hello.', said('The road.', ['~ time June 3, 1200, 08:00 am', ...BASE.map(key => `+ hook ${key} — an old tale | now: the inn`),
                ...BASE_PLACES.map(place => `+ landmark ${place} | region: Vale | kind: town`),
                ...BASE_WORLD.map(key => `+ world ${key} — afoot | state: ongoing`)]));
            const start = host.head().domains.director.time.minutes;
            const times = new Map();
            const clock = () => host.head().domains.director.time.minutes;
            for (let n = 1; n <= REPLIES; n += 1) {
                const lines = replyLines(r, n);
                await host.send(r.chance(0.3) ? 'I take the job.' : `On we go (${n}).`, said(`Reply ${n}.`, lines));
                times.set(host.ctx.chat.at(-1), timeOf(lines));
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
                if (!DELETE_AT.includes(n)) continue;
                // A middle exchange in the first half (so many replies come after it): never the first.
                const chat = host.ctx.chat;
                const users = chat.map((message, i) => (message.is_user ? i : -1)).filter(i => i > 2 && i < chat.length / 2);
                // Often one whose reply holds a world pick (chronicle.surface) with replies after it.
                const picks = host.sdk.receipts().filter(entry => entry.receipt.type === 'chronicle.surface').map(entry => entry.index);
                const picked = users.filter(i => picks.includes(i + 1));
                // Or one whose reply made a quest a later settle lapsed (its closing is then passed over).
                const lapsed = new Set(host.sdk.receipts().filter(entry => entry.receipt.type === 'time.settle').flatMap(entry => entry.receipt.data?.lapsed ?? []).map(entry => entry.key));
                const lapsedHere = users.filter(i => [...lapsed].some(key => chat[i + 1]?.mes?.includes?.(`+ quest ${key} `)));
                const user = lapsedHere.length && r.chance(0.6) ? r.pick(lapsedHere) : picked.length && r.chance(0.5) ? r.pick(picked) : r.pick(users);
                await host.st.deleteMessage(user + 1);
                await host.st.deleteMessage(user);
                const where = `seed ${seed}, reply ${n}, deleted ${user}`;
                assert.deepEqual(host.store.problems().map(problem => problem.why ?? problem.message), [], `${where}: a later block no longer applies`);
                const live = JSON.stringify(host.head());
                host.store.rebuild();
                assert.equal(JSON.stringify(host.head()), live, `${where}: rebuild != live`);
                assert.deepEqual(validatorErrors(host), [], where);
                assert.equal(clock(), expectedClock(host.ctx.chat, times, start), `${where}: the clock`);
            }
            await host.send('And then?', 'Quiet.');
            assert.deepEqual(validatorErrors(host), [], `seed ${seed}: the head state`);
            const again = await createHost({ modules: [fakeRpgBattle(), createModule()] });
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
