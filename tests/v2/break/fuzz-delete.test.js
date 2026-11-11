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
// The reader's clock edits (director.clock, own stream): now and then, after a reply, the reader sets the date and time by hand, forward or back
// (a rewind) inside June 1200; the edit rides on that reply, so a delete of it takes it back, a later `~ time` set stays exact and later moves add on top.
// The living cast (own stream): a pack of six people (some with a goal the story touches, some who may die) whose entries change now and
// then (a new version, one added, one gone, the pack switched off and on) and a scripted planner that moves some of them, brings some to the
// party and kills one on a day change; meetings by place follow the scene. A delete often takes the reply that holds the sync, a move, a
// meeting; a later step on a person that reply made is passed over, never a failing block, and the narrator is never told an unmet person.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createFakeModel } from '../../vendor/story-block/testkit/model.js';
import { createModule } from '../../../src/v2/module.js';
import { castPlans } from '../../../src/v2/cast/index.js';
import { PRESETS, makeCalendar } from '../../../src/calendar.js';
import { fakeFightRunner } from '../integration/helpers/fake-fight-runner.js';
import { problemList } from '../../../src/v2/tracker/domain.js';
import { fakeDelta } from '../keypeople/helpers.js';
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

// Near-name quest lines (own stream, so the story's lines stay as they were): a hook, the quest taken on from it under a
// name that only reads near it, and a closing or progress line under a third near spelling ("Cellar-Rat Cull"), all of the
// reply's own. The hook stays live beside the quest, so the line finds two near matches and the quest line's kind settles it.
const NEAR = { hook: 'Rats', quest: 'Cellar-Rats', line: 'Cellar-Rat Cull' };
const TIE = { hook: 'Hunt South', quest: 'Hunt North', line: 'Hunt' };
function nearLines(rn, n) {
    if (!rn.chance(0.4)) return { lines: [] };
    const base = `${word(rn)}${String(n).padStart(2, '0')}77`;
    // (stage73) Now and then a tie: a quest and a hook that match the line equally well ("Hunt North" / "Hunt South" for "Hunt"):
    // the line must stay unclear, both records as they were.
    if (rn.chance(0.3)) {
        return { base, tie: true, lines: [`+ hook ${base} ${TIE.hook} — wolves on the ridge | giver: Fenna | reward: 5 gold`,
            `+ quest ${base} ${TIE.quest} — a job | giver: Fenna | reward: 6 copper | step: Find the trail`, `- quest ${base} ${TIE.line} — done`] };
    }
    const close = rn.chance(0.6);
    const lines = [`+ hook ${base} ${NEAR.hook} — rats under the store | giver: Fenna | reward: 5 gold`,
        `+ quest ${base} ${NEAR.quest} — a job | giver: Fenna | reward: 6 copper | step: Find the key`,
        close ? `- quest ${base} ${NEAR.line} — turned in` : `~ quest ${base} ${NEAR.line} | step: Seal the burrow`];
    return { lines, base, close };
}

// (stage73) Offers with no deadline (own stream): a hook with a giver and a reward and no `due:`, offered and then now and then
// kept open by a later reply's line that touches it (the first reply's two offers, which no delete takes, are mentioned now and
// then, so the lapse clock starts over), and a jump of days now and then so some lapse (UNDATED_OFFER_DAYS). A reply's own offers
// are never named by a later reply (a delete would take the thing the line names).
const BASE_OFFERS = ['Wharf Haul', 'Mill Repair'];
function offerLines(ro, n, made) {
    const lines = [];
    if (ro.chance(0.55)) {
        const key = `${word(ro)}${String(n).padStart(2, '0')}55`;
        made.push(key);
        lines.push(`+ hook ${key} — a job on offer | giver: Brom | reward: ${ro.int(1, 30)} gold`);
    }
    if (ro.chance(0.4)) {
        offerMentions += 1;
        lines.push(`~ hook ${ro.pick(BASE_OFFERS)} | now: still wanted`);
    }
    if (ro.chance(0.25)) lines.push(`! time +${ro.int(1, 4)}d`);
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

// Key people (own stream): the first reply's people are pinned by the reader after it (so on a reply never deleted); later the reader pins and
// unpins now and then (on whatever reply is the latest, which a delete may take), and the replies' lines send people away, add steps, change
// their plans, bring them back, and now and then record a death. A line may name someone no longer pinned (it is refused, quietly) or whose
// away record a deleted reply made (a step then has nothing to join: passed over on replay, never a failing block). A stand-in for NPC State
// Delta lists the base people and loses one now and then (archived there): the sync step takes it off the list before the next reply, and the
// tell step after that reply's lines writes its card line on the reply (a delete may take either; a swipe of the reply says it again).
const KEY_BASE = ['Ren', 'Odda', 'Fenna'];
function keyLines(rk, host, n) {
    const pinned = Object.values(host.head().domains.keypeople?.pins ?? {}).map(entry => entry.name);
    const pool = [...KEY_BASE, ...pinned, `Gone${n}`];
    const lines = [];
    for (let i = rk.int(0, 3); i > 0; i -= 1) {
        const who = rk.pick(pool);
        const roll = rk();
        if (roll < 0.3) lines.push(`+ away ${who} — on the road number ${n} | back: June ${rk.int(4, 28)}, 1200`);
        else if (roll < 0.5) lines.push(`! away ${who} — reached stop ${n}.${i}`);
        else if (roll < 0.65) lines.push(`~ away ${who} — held up | back: June ${rk.int(4, 28)}, 1200`);
        else if (roll < 0.85) lines.push(`- away ${who}`);
        else if (roll < 0.9) lines.push(`- key ${who} | died`);
        else lines.push(`- key ${who}`);
    }
    return lines;
}
async function keyEdits(rk, host, n, delta) {
    if (rk.chance(0.3)) {
        const known = Object.keys(delta);
        if (known.length) delete delta[rk.pick(known)];
    }
    if (rk.chance(0.2)) delta[rk.pick([...KEY_BASE, `Key${n}`])] ??= {};
    if (rk.chance(0.25)) await host.sdk.command('keypeople.pin', { name: `Key${n}` });
    const pinned = Object.values(host.head().domains.keypeople?.pins ?? {}).map(entry => entry.name);
    if (pinned.length && rk.chance(0.12)) await host.sdk.command('keypeople.unpin', { name: rk.pick(pinned) });
    if (rk.chance(0.1)) await host.sdk.command('keypeople.pin', { name: rk.pick([...KEY_BASE, `Key${n}`]) });
}

// Names (feature story-director.names, own stream): replies declare people now and then, some again (the same person), some with an overused
// name or a near spelling; the part's `names.seen` / `names.told` steps and its refusals must replay the same after a delete or a swipe.
const NAME_POOL = ['Corst', 'Hald', 'Wenna', 'Joost', 'Elara', 'Bregje', 'Bregja', 'Odda', 'Maaike'];
const nameLines = (rn, n) => (rn.chance(0.6) ? [`+ person ${rn.chance(0.2) ? `Extra${n}` : rn.pick(NAME_POOL)} | look: scar ${n} | flaw: proud`] : []);

const said = (text, lines) => `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>`;

// The cast (own stream): six people at the first reply's places and one elsewhere; `drawnTo` words that every reply's text holds, so the
// story "touches" them; two may die. The pack's entries and version change now and then (castEdits); the scripted planner (castAnswer) moves
// some people, brings one whose goal was touched and now and then kills one who may die.
const CAST_PLACES = [...BASE_PLACES, 'Wayside4', 'Kesh'];
const castEntry = (id, rc, version) => ({
    pack: 'ersveil', packVersion: version, id, name: id[0].toUpperCase() + id.slice(1), about: `${id} is somebody.`, look: 'weathered',
    start: { place: rc.pick(CAST_PLACES), goal: `${id} goal`, routine: rc.pick(['', 'works the night ferry', 'at the forge in the morning', 'sells wares by day']) },
    drawnTo: rc.chance(0.4) ? ['the reply'] : [], canDieUnmet: rc.chance(0.3), fields: { Calling: callingOf(id) },
});
const CAST_IDS = ['aino', 'borka', 'cael', 'dren', 'eska', 'fotu'];
// A calling each person can be sought by ("Is there a ferryman around?"): the reader asks for one now and then and the scripted planner names the person.
const CALLINGS = { aino: 'ferryman', borka: 'scout', cael: 'smith', dren: 'healer', eska: 'priest', fotu: 'guide' };
const callingOf = id => CALLINGS[id] ?? 'tinker';
const SOUGHT_ASK = ['ferryman', 'scout', 'smith', 'healer', 'priest', 'guide', 'tinker', 'cartographer', 'cartographer', 'cartographer'];
// Ylva is the one the replies name when she is asked for (a meeting counts only if the reply shows the person), so a sought meeting survives.
// She is not one of CAST_IDS: the guard that no prompt names an unmet person holds for the others; a rumor must not name her either.
const ylvaEntry = version => ({ pack: 'ersveil', packVersion: version, id: 'ylva', name: 'Ylva', about: 'Ylva is somebody.', look: 'weathered', fields: { Calling: 'cartographer' }, start: { place: BASE_PLACES[0], goal: 'ylva goal', routine: '' }, drawnTo: [] });
let soughtRumors = 0;
let soughtMeetings = 0;
function castEdits(rc, source, n) {
    if (!rc.chance(0.3)) return;
    const roll = rc();
    if (roll < 0.3) {
        source.version = `1.${n}.0`;
        source.entries = source.entries.map(entryOf => ({ ...entryOf, packVersion: source.version, ...(rc.chance(0.3) ? { name: `${entryOf.name}${n}` } : {}) }));
    } else if (roll < 0.55) source.entries.push(castEntry(`late${n}`, rc, source.version));
    else if (roll < 0.75 && source.entries.length > 2) source.entries.splice(rc.int(0, source.entries.length - 1), 1);
    else source.enabled = !source.enabled;
}
function castAnswer(rc, rs) {
    return call => {
        // A 'sought' call: the person whose calling the reader's message names (most of the time), by the words of the message.
        if (/People who might fit/.test(call.prompt)) {
            const message = /latest message:\n([^\n]*)/.exec(call.prompt)?.[1] ?? '';
            for (const match of String(call.prompt).matchAll(/^- (\S+) \|[^\n]*calling: ([^|\n]+?) \|/gm)) {
                if (message.toLowerCase().includes(match[2].toLowerCase()) && rs.chance(0.85)) return `? cast ${match[1]} | "${match[2]}"`;
            }
            return '';
        }
        const lines = [];
        for (const match of String(call.prompt).matchAll(/^- (\S+) \| ([^|\n]+)(\|[^\n]*)?$/gm)) {
            const [, ref, , rest = ''] = match;
            if (rc.chance(0.5)) lines.push(`~ cast ${ref} | ${rc.pick(CAST_PLACES)} | doing thing ${rc.int(1, 99)}`);
            if (/drawn to/.test(rest) && /has not met/.test(rest) && rc.chance(0.5)) lines.push(`> cast ${ref} | the story reached them ${rc.int(1, 99)}`);
            if (/may die/.test(rest) && rc.chance(0.2)) lines.push(`! cast ${ref} | an accident`);
        }
        return lines.join('\n');
    };
}

// The clock the replies left say, without replaying anything: the first reply sets June 3, 08:00 am
// (`start`), `SET_LINE` sets June 9, 10:00 am, each move adds on top, held to the longest jump (30 days)
// from where its reply began, as applyTimeLine does.
const SET_LINE = '~ time June 9, 1200, 10:00 am';
const SET_AFTER = (6 * 24 + 2) * 60;
const MAX_JUMP = 30 * 24 * 60;
const GREGORIAN = makeCalendar(PRESETS.gregorian);
// A reader's edit of the clock: a date in June 1200 (day, minutes of the day), as the command takes it and as the model reads it.
const editOf = rr => {
    const day = rr.int(1, 28);
    const minutes = rr.int(0, 1439);
    return { payload: { year: 1200, month: 6, day, minutes }, abs: GREGORIAN.toAbs({ year: 1200, month: 5, day, minutes }) };
};
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
            if (step.edit !== undefined) clock = step.edit;
            else if (step.set) clock = start + SET_AFTER;
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

// Near-name quest lines that settled on the quest (counted over all seeds, asserted after them).
let nearPicks = 0;
let nearLinesMade = 0;
let tieLinesMade = 0;
// Undated offers (counted over all seeds): lines that mention one again, and those time closed as lapsed.
let offerMentions = 0;
let undatedLapsed = 0;

for (const seed of SEEDS) {
    test(`delete fuzz, seed ${seed}: ${REPLIES} replies with middle deletes replay cleanly`, async t => {
        t.mock.method(console, 'warn', () => {});
        const restore = seedCrypto(seed);
        const r = prng(seed);
        const ra = prng(seed ^ 0xA5C);
        const rl = prng(seed ^ 0x1A57);
        const rt = prng(seed ^ 0x7121);
        const rk = prng(seed ^ 0x4B50);
        const rc = prng(seed ^ 0xCA57);
        const rs = prng(seed ^ 0x50C7);
        const re = prng(seed ^ 0xC10C);
        const rn = prng(seed ^ 0x4EA2);
        const ro = prng(seed ^ 0x0FFE);
        const madeOffers = [...BASE_OFFERS];
        const source = { version: '1.0.0', enabled: true, entries: [] };
        source.entries = [...CAST_IDS.map(id => castEntry(id, rc, source.version)), ylvaEntry(source.version)];
        castPlans.clear();
        let host = null;
        const delta = Object.fromEntries(KEY_BASE.map(name => [name, {}]));
        const module = createModule({ host: { settings: id => host?.sdk.settings(id) ?? null, substitute: text => host?.sdk.substitute(text), callModel: request => host.sdk.callModel(request), chat: () => host.ctx.chat } });
        host = await createHost({ modules: [fakeFightRunner(), fakeDelta(delta), module], callModel: createFakeModel([], { fallback: castAnswer(rc, rs) }), settings: { features: { 'story-director.names': true }, modules: { 'story-director': { 'cast.faces': 'day2', 'cast.unmetDie': rc.chance(0.5) } } } });
        // The cast is a real pack, installed (and switched on or off) as the fuzz edits it.
        const installCast = async () => {
            const pack = { id: 'ersveil', version: source.version, name: 'Ersveil', requires: { storyBlock: '^2' }, content: { cast: source.entries.map(({ pack: _pack, packVersion: _version, ...own }) => ({ ...own, start: Object.fromEntries(Object.entries(own.start).filter(([key, value]) => key !== 'routine' || value)) })) } };
            assert.equal((await host.packs.packs.install(JSON.stringify(pack), { origin: 'cast-fuzz' })).ok, true);
            await host.packs.packs.setEnabled('ersveil', source.enabled);
        };
        await installCast();
        try {
            assert.equal((await host.packs.packs.install(LASTING_PACK, { origin: 'pack.json' })).ok, true);
            await host.send('Hello.', said('The road.', ['~ time June 3, 1200, 08:00 am', `~ place ${BASE_PLACES[0]} | kind: town`, ...BASE.map(key => `+ hook ${key} — an old tale | now: the inn`),
                ...BASE_OFFERS.map(key => `+ hook ${key} — a job on offer | giver: Brom | reward: 8 gold`),
                ...BASE_PLACES.map(place => `+ landmark ${place} | region: Vale | kind: town`),
                ...BASE_WORLD.map(key => `+ world ${key} — afoot | state: ongoing`)]));
            for (const name of KEY_BASE) assert.ok((await host.sdk.command('keypeople.pin', { name })).ok);
            const start = host.head().domains.director.time.minutes;
            const times = new Map();
            let editsMade = 0;
            let sought = '';
            const clock = () => host.head().domains.director.time.minutes;
            for (let n = 1; n <= REPLIES; n += 1) {
                const near = nearLines(rn, n);
                const lines = [...replyLines(r, n), ...near.lines, ...lastingLines(rl), ...tripLines(rt, n), ...keyLines(rk, host, n), ...nameLines(rk, n), ...offerLines(ro, n, madeOffers)];
                const seeking = rs.chance(0.6) ? rs.pick(SOUGHT_ASK) : '';
                // The planner's answer is used by the reply after the one it was asked about: the reply after a request for her names her too.
                const names = seeking === 'cartographer' || sought === 'cartographer';
                sought = seeking;
                await host.send(seeking ? `Is there a ${seeking} around (${n})?` : r.chance(0.3) ? 'I take the job.' : `On we go (${n}).`, said(`Reply ${n}.${names ? ' Ylva nods.' : ''}`, lines));
                if (host.head().domains.cast.people['ersveil:ylva']?.met?.why === 'sought') soughtMeetings += 1;
                if (near.tie) {
                    tieLinesMade += 1;
                    const director = host.head().domains.director;
                    const quest = Object.values(director.threads).find(thread => thread.key === `${near.base} ${TIE.quest}`);
                    const hook = Object.values(director.threads).find(thread => thread.key === `${near.base} ${TIE.hook}`);
                    assert.ok(quest && hook, `seed ${seed}, reply ${n}: the tie's hook and quest exist`);
                    assert.equal(quest.status, 'active', `seed ${seed}, reply ${n}: a tie leaves the quest open`);
                    assert.equal(hook.status, 'active', `seed ${seed}, reply ${n}: a tie leaves the hook open`);
                    const unclear = problemList(director).find(problem => problem.kind === 'unknown-key' && problem.key === `${near.base} ${TIE.line}`);
                    assert.ok(unclear, `seed ${seed}, reply ${n}: the tie is reported as unclear`);
                    assert.deepEqual(unclear.candidates.slice().sort(), [quest.key, hook.key].sort());
                } else if (near.base) {
                    // The line read as the quest (a near-key note), not the hook beside it: the quest took it, the hook is as it was.
                    nearLinesMade += 1;
                    const director = host.head().domains.director;
                    const named = `${near.base} ${NEAR.line}`;
                    const quest = Object.values(director.threads).find(thread => thread.key === `${near.base} ${NEAR.quest}`);
                    const hook = Object.values(director.threads).find(thread => thread.key === `${near.base} ${NEAR.hook}`);
                    assert.ok(quest && hook, `seed ${seed}, reply ${n}: the hook and the quest exist`);
                    assert.equal(hook.status, 'active', `seed ${seed}, reply ${n}: the hook is left alone`);
                    assert.ok(problemList(director).some(problem => problem.kind === 'near-key' && problem.key === named), `seed ${seed}, reply ${n}: "${named}" read as a near key`);
                    assert.equal(director.keys[named.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()], quest.id, `seed ${seed}, reply ${n}: the name is the quest's alias`);
                    if (near.close) assert.equal(quest.status, 'resolved', `seed ${seed}, reply ${n}: the quest was closed`);
                    else assert.equal(quest.fields.step, 'Seal the burrow', `seed ${seed}, reply ${n}: the quest took the step`);
                    nearPicks += 1;
                }
                await castPlans.idle();
                castEdits(rc, source, n);
                await installCast();
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
                await keyEdits(rk, host, n, delta);
                // The reader sets the clock by hand now and then, forward or back; the model follows (a set, exact).
                if (re.chance(0.3)) {
                    const edit = editOf(re);
                    const done = await host.sdk.command('director.clock', edit.payload);
                    assert.ok(done.ok, `seed ${seed}, reply ${n}: ${done.message}`);
                    times.get(host.ctx.chat.at(-1)).push({ edit: edit.abs });
                    editsMade += 1;
                    assert.equal(clock(), expectedClock(host.ctx.chat, times, start), `seed ${seed}, reply ${n}: the clock after the reader's edit`);
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
            assert.ok(editsMade >= 1, `seed ${seed}: the reader set the clock by hand`);
            t.diagnostic(`seed ${seed}: clock edits ${editsMade}`);
            assert.ok(host.sdk.receipts().some(entry => entry.receipt.type === 'events.fire' && entry.receipt.data?.then?.includes('chronicle.lasting')), `seed ${seed}: a pack event wrote a lasting change`);
            const summaries = host.sdk.receipts().map(entry => entry.receipt.summary ?? '');
            const tripsMade = summaries.filter(text => /^On the road to /.test(text)).length;
            assert.ok(tripsMade >= 1, `seed ${seed}: the fuzz set out on a trip`);
            const castDone = summaries.filter(text => /^(The cast|Paths crossed)/.test(text));
            soughtRumors += host.sdk.receipts().filter(entry => entry.receipt.type === 'cast.rumor').length;
            t.diagnostic(`seed ${seed}: rumors ${host.sdk.receipts().filter(entry => entry.receipt.type === 'cast.rumor').length}, sought meetings seen so far ${soughtMeetings}`);
            assert.ok(castDone.length >= 1, `seed ${seed}: the cast joined the world`);
            const world = Object.values(host.head().domains.cast.people);
            t.diagnostic(`seed ${seed}: cast steps ${castDone.length} (met ${castDone.filter(text => /^Paths crossed/.test(text)).length}, moved ${castDone.filter(text => /moved on/.test(text)).length}), people ${world.length}, met ${world.filter(person => person.met).length}, dead ${world.filter(person => !person.alive).length}`);
            // The narrator hears of the cast only in a meeting's cue (a meeting a later delete took back was still told then): no other text of any prompt names them.
            const told = host.st.promptLog.filter(entry => entry.value).flatMap(entry => String(entry.value).split('\n')).filter(line => !line.startsWith('[Cast]'));
            // A rumor describes; it never names (it is a [Cast] line too, so it is checked on its own).
            const rumors = host.st.promptLog.filter(entry => entry.value).flatMap(entry => String(entry.value).split('\n')).filter(line => line.startsWith('[Cast] People here know of'));
            for (const id of [...CAST_IDS, 'ylva']) assert.ok(!rumors.some(line => new RegExp(`\\b${id}\\d*\\b`, 'i').test(line)), `seed ${seed}: ${id} is named in a rumor`);
            for (const id of CAST_IDS) assert.ok(!told.some(line => new RegExp(`\\b${id}\\d*\\b`, 'i').test(line)), `seed ${seed}: ${id} is named outside a meeting's cue`);
            const keyDone = summaries.filter(text => /^Key person: /.test(text));
            assert.ok(keyDone.length >= 1, `seed ${seed}: the fuzz sent a key person away`);
            t.diagnostic(`seed ${seed}: key people receipts ${keyDone.length} (away ${keyDone.filter(text => / is away/.test(text)).length}, back ${keyDone.filter(text => / is back/.test(text)).length}, steps ${keyDone.filter(text => /^Key person: \w+, /.test(text)).length}, died ${keyDone.filter(text => /died/.test(text)).length}, archived in Delta ${keyDone.filter(text => /archived in NPC State Delta/.test(text)).length}), lines told ${Object.values(host.head().domains.keypeople.notes).filter(note => note.key !== undefined).length}, pinned now ${Object.keys(host.head().domains.keypeople.pins).length}`);
            t.diagnostic(`seed ${seed}: trips set out ${tripsMade}, delayed ${summaries.filter(text => /is delayed/.test(text)).length}, stopped ${summaries.filter(text => /^The trip to .* ends/.test(text)).length}`);
            t.diagnostic(`seed ${seed}: pack events that fired: ${[...new Set(host.sdk.receipts().filter(entry => entry.receipt.type === 'events.fire').map(entry => entry.receipt.data?.event?.split('/')[1]))].join(', ')}`);
            undatedLapsed += host.sdk.receipts().filter(entry => entry.receipt.type === 'time.settle')
                .flatMap(entry => entry.receipt.data?.lapsed ?? []).filter(entry => madeOffers.includes(entry.key)).length;
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

test('delete fuzz: the reader sought a kind of person and the cast answered (a meeting, a rumor) in the seeds', () => {
    assert.ok(soughtMeetings > 0, 'a person the reader sought came in');
    assert.ok(soughtRumors > 0, 'a person the reader sought who was elsewhere was heard of');
});

test('delete fuzz: near-name quest lines were reached, and settled on the quest', t => {
    t.diagnostic(`near-name quest lines ${nearLinesMade}, settled on the quest ${nearPicks}`);
    assert.ok(nearPicks > 0, 'the narrowing picked a quest at least once');
    assert.equal(nearPicks, nearLinesMade);
});

test('delete fuzz: tied near-name quest lines were reached, and stayed unclear', t => {
    t.diagnostic(`tied quest lines ${tieLinesMade}`);
    assert.ok(tieLinesMade > 0, 'a tie was made at least once');
});

test('delete fuzz: offers with no deadline were mentioned again, and time closed some as lapsed', t => {
    t.diagnostic(`undated offers mentioned again ${offerMentions}, lapsed ${undatedLapsed}`);
    assert.ok(offerMentions > 0, 'an undated offer was mentioned again at least once');
    assert.ok(undatedLapsed > 0, 'an undated offer lapsed at least once');
});
