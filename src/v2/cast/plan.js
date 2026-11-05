// Story Director v2, part **cast**: the planner that moves the cast off-screen (pure apart from the model call it is handed).
//
// After a day change or a time skip, one model call looks at everyone in the world who can move (unmet and met alike) and answers
// with one short line per change, only where something changed. The answer is a proposal and nothing more (WAVE rule 1): code reads
// only three labels, only for people it named, cuts every part by code points with markup and control characters taken out, caps
// how many lines it keeps, and lets a death through only where the setting or the entry allows one (index.js). Nothing the planner
// writes sets an amount, and unmet people are never in the narrator's text: this prompt is the only place they are described.
//
//   ~ cast ref | place | what they are doing now        (moves on)
//   > cast ref | what in the story pulls them to {{user}}   (their goal brings them to the party; only for people with `drawnTo`)
//   ! cast ref | how they died                         (only for people marked "may die")
//   ? cast ref | "the words that ask for them"        (mode 'sought': the reader's message looks for a kind of person; sought.js checks the words)
//
// The same call, asked only for the `>` lines, judges a goal touched by the story between two days (index.js `touched`).

import { MAX_DOING, MAX_PLACE, MAX_REASON, cutPoints, cutWords, flat } from './domain.js';
import { citedClean, citedIn, citesKind, words } from './sought.js';

export const MAX_ANSWER_CHARS = 8000;
export const MAX_LINES = 60;
/** The most lines of each label one answer keeps. */
export const CAPS = Object.freeze({ move: 16, come: 3, die: 2, seek: 1 });
/** The most people one call describes, and the longest recent story it reads (characters). */
export const MAX_PEOPLE_ASKED = 24;
export const RECENT_CHARS = 3500;
export const MAX_TOKENS = 700;
/** The most people a 'sought' call describes, and the longest message or reply it reads (characters). */
export const MAX_SOUGHT = 8;
export const SOUGHT_CHARS = 1200;

export const SYSTEM = `You run the off-screen cast of an ongoing story between {{user}} and {{char}}. These people live their own lives while {{user}} is somewhere else. You decide only what changes for them, and which of them, if any, are pulled towards {{user}}. You do not write the story, and you never decide what {{user}} does.

## Rules
- Each person has a goal and a routine. As time passes people follow their routine and work towards their goal. Write a line only for a person whose situation really changed; leave the others out.
- Keep it small, true to who they are and in step with the time that passed. Nobody is in two places at once, and travel takes time.
- A person is pulled towards {{user}} only when one of their "drawn to" phrases is touched by the recent story. Say in one sentence what in the story pulls them. When nothing does, write no such line.
- Use a place name from the list when one fits.
- Plain words, a few words to a part. No dialogue, no rewards, no numbers, no commentary, no markdown.`;

const FORMAT = `Answer with only lines, one per change, in this form:
~ cast ref | place | what they are doing now
> cast ref | what in the story pulls them to {{user}}
! cast ref | how they died   (only for a person marked "may die")`;

const JUDGE_FORMAT = `Answer with only lines, in this form, for the people whose drawn-to phrase the recent story touches (none at all is fine):
> cast ref | what in the story pulls them to {{user}}`;

// Mode 'sought': {{user}} may be looking for a kind of person ("a healer or sister around"). The call answers at most one line, and only with
// words that stand in the message or the reply; code refuses any others (sought.js `citedIn`).
export const SOUGHT_SYSTEM = `You run the off-screen cast of an ongoing story between {{user}} and {{char}}. You decide only whether {{user}} is looking for a KIND of person (a healer, a priest, a smith, a guide, a sister...) that one of the people listed fits. You do not write the story, and you never decide what {{user}} does.

## Rules
- Look at {{user}}'s latest message first, then at the story's last reply. Only a request for a kind of person counts: {{user}} asking for, hoping to find, or looking around for such a person. A person merely mentioned or already present does not count.
- Choose a person only when their calling or what is said about them fits the kind asked for. Never choose someone for a loose or doubtful fit.
- Quote the exact words of the message or reply that ask for them, copied letter for letter. Never invent a request or reword it.
- At most one person. When nobody fits, answer nothing.
- Plain words. No commentary, no markdown.`;

const SOUGHT_FORMAT = `Answer with only one line, in this form, or nothing at all:
? cast ref | "the words that ask for them, copied from the message or the reply"`;

const NONE = '(none)';

/** A person as the planner reads them: `{ ref, name, goal, routine, where, doing, drawnTo, met, mayDie }`. */
function personLine(person) {
    const parts = [
        `${person.ref} | ${cutPoints(person.name, 60)}`,
        person.goal ? `goal: ${cutPoints(person.goal, 120)}` : '',
        person.routine ? `routine: ${cutPoints(person.routine, 100)}` : '',
        `now at: ${cutPoints(person.where, MAX_PLACE) || 'unknown'}`,
        person.doing ? `doing: ${cutWords(person.doing, MAX_DOING)}` : '',
        person.drawnTo?.length ? `drawn to: ${person.drawnTo.map(phrase => cutPoints(phrase, 80)).join('; ')}` : '',
        person.kind ? `calling: ${cutPoints(person.kind.calling, 100) || 'none'} | about: ${cutPoints(person.kind.lead, 100)}` : '',
        person.met ? 'has met them' : 'has not met them',
        person.mayDie ? 'may die' : '',
    ];
    return `- ${parts.filter(Boolean).join(' | ')}`;
}

/**
 * The call's `{ system, prompt }`. `mode`: 'batch' (moves, comes, deaths) or 'judge' (comes only). `people` are the ones asked about (at
 * most MAX_PEOPLE_ASKED, the caller's order); `elapsed` the time that passed in words; `places` the world's place names.
 */
export function castRequest({ mode = 'batch', people = [], now = '', elapsed = '', place = '', places = [], recent = '', texts = null } = {}) {
    if (mode === 'sought') return soughtRequest({ people, now, place, texts });
    const list = people.slice(0, MAX_PEOPLE_ASKED).map(personLine);
    const body = [
        `Now: ${flat(now) || 'unknown'}${elapsed ? ` (${flat(elapsed)} since the cast last moved)` : ''}`,
        `{{user}} is at: ${flat(place) || 'unknown'}`,
        `Places of this world: ${places.slice(0, 30).map(name => cutPoints(name, MAX_PLACE)).join(', ') || NONE}`,
        '',
        'The cast:',
        list.join('\n') || NONE,
        '',
        'Recent story:',
        String(recent ?? '').slice(-RECENT_CHARS).trim() || NONE,
        '',
        mode === 'judge' ? JUDGE_FORMAT : FORMAT,
    ].join('\n');
    return { system: SYSTEM, prompt: body };
}

/** The 'sought' call: the unmet people who might fit (`kind`: calling and lead, no more) and the two texts it reads (`texts`: { reader, reply }). */
function soughtRequest({ people, now, place, texts }) {
    const cut = value => String(value ?? '').slice(-SOUGHT_CHARS).trim() || NONE;
    const body = [
        `Now: ${flat(now) || 'unknown'}`,
        `{{user}} is at: ${flat(place) || 'unknown'}`,
        '',
        'People who might fit (none of them has met {{user}}):',
        people.slice(0, MAX_SOUGHT).map(personLine).join('\n') || NONE,
        '',
        "{{user}}'s latest message:",
        cut(texts?.reader),
        '',
        "The story's last reply:",
        cut(texts?.reply),
        '',
        SOUGHT_FORMAT,
    ].join('\n');
    return { system: SOUGHT_SYSTEM, prompt: body };
}

// ---- reading the answer --------------------------------------------------------------------------------------------------

const THINK_BLOCK = /<(think|thinking|reasoning)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const THINK_CLOSE = /<\/(?:think|thinking|reasoning)\s*>/gi;
const DECORATION = /^(?:#{1,6}\s+|>\s+(?=[~>!?])|(?:[*•+-]|\d{1,2}[.)])\s+)+/;
const LINE = /^([~>!?])\s*cast\s+(.+)$/i;
const FENCE = /^(?:```|~~~)/;

// A part as one plain line: markup out, a separator the line form reads never survives inside it.
const part = (value, points) => cutWords(String(value ?? '').replace(/<[^>]*>/g, '').replace(/\*\*|__|`/g, '').replace(/\s[|—–]\s/g, ' ').replace(/\|/g, '/'), points);
const refOf = value => String(value ?? '').replace(/^[\s"'`*_[(]+|[\s"'`*_\])]+$/g, '').toLowerCase();

/**
 * The answer read strictly. `refs`: Map of a ref (lower case) → the key of a person who may be named. `allow`: { come: Set of keys,
 * die: Set of keys } (who a `>` or `!` line may name). Returns `{ moves: [{ key, where, doing }], comes: [{ key, reason }], died:
 * [{ key, text }], sought?: [{ key, words }] }` (`sought` only when a `?` line passed): at most CAPS of each, a person once per label, nothing for a ref it does not know.
 */
export function readCast(text, { refs = new Map(), allow = {}, texts = [] } = {}) {
    const out = { moves: [], comes: [], died: [] };
    let clean = String(text ?? '').slice(0, MAX_ANSWER_CHARS).replace(THINK_BLOCK, '');
    const closes = [...clean.matchAll(THINK_CLOSE)];
    if (closes.length) clean = clean.slice(closes.at(-1).index + closes.at(-1)[0].length);
    const seen = { move: new Set(), come: new Set(), die: new Set(), seek: new Set() };
    for (const raw of clean.split(/\r?\n/).slice(0, MAX_LINES)) {
        const trimmed = raw.trim();
        if (!trimmed || FENCE.test(trimmed)) continue;
        const match = LINE.exec(trimmed.replace(DECORATION, ''));
        if (!match) continue;
        const bits = match[2].split('|').map(bit => bit.trim());
        const key = refs.get(refOf(bits[0]));
        if (!key) continue;
        const label = match[1];
        if (label === '~') {
            if (seen.move.has(key) || out.moves.length >= CAPS.move) continue;
            // One part is what they do; two are where and what.
            const where = bits.length >= 3 ? part(bits[1], MAX_PLACE) : '';
            const doing = part(bits.length >= 3 ? bits.slice(2).join(' / ') : bits[1], MAX_DOING);
            if (!where && !doing) continue;
            seen.move.add(key);
            out.moves.push({ key, where, doing });
        } else if (label === '>') {
            if (!allow.come?.has(key) || seen.come.has(key) || out.comes.length >= CAPS.come) continue;
            const reason = part(bits.slice(1).join(' / '), MAX_REASON - 60);
            if (!reason) continue;
            seen.come.add(key);
            out.comes.push({ key, reason: /[.!?…]$/.test(reason) ? reason : `${reason}.` });
        } else if (label === '?') {
            // A request the planner says it read: its words must stand in the message or the reply (whole words), else it is refused.
            const cited = citedClean(bits.slice(1).join(' / '));
            if (!allow.seek?.has(key) || seen.seek.has(key) || (out.sought?.length ?? 0) >= CAPS.seek || !citedIn(cited, texts) || (allow.kind?.has(key) && !citesKind(allow.kind.get(key), cited))) continue;
            seen.seek.add(key);
            (out.sought ??= []).push({ key, words: cited });
        } else {
            if (!allow.die?.has(key) || seen.die.has(key) || out.died.length >= CAPS.die) continue;
            seen.die.add(key);
            out.died.push({ key, text: part(bits.slice(1).join(' / '), MAX_DOING) });
        }
    }
    return out;
}

// ---- a goal the story touched ------------------------------------------------------------------------------------------------

/**
 * Whether the recent story touches one of a person's `drawnTo` phrases: all the telling words of a short phrase, two thirds of a longer
 * one, each as a whole word (a plural or a past tense with the same first five letters counts). A cheap check in code, so the planner
 * is asked about a goal only when the story came near it.
 */
export function touches(drawnTo, recent) {
    const have = new Set(words(recent));
    const stems = new Set([...have].map(word => word.slice(0, 5)));
    for (const phrase of Array.isArray(drawnTo) ? drawnTo : []) {
        const need = [...new Set(words(phrase))];
        if (!need.length) continue;
        const found = need.filter(word => have.has(word) || have.has(`${word}s`) || have.has(`${word}es`) || (word.length >= 5 && stems.has(word.slice(0, 5)))).length;
        if (found >= (need.length <= 2 ? need.length : Math.ceil((need.length * 2) / 3))) return true;
    }
    return false;
}

// ---- plans in flight ---------------------------------------------------------------------------------------------------------------

/**
 * The plans being asked for or already answered, by key. A plan is asked for after a reply (when the model's connection is free) and
 * used before the next one; a swipe, a Re-read or a second look at the same key finds the same answer, so who the cast brings does not
 * change with a rewrite of the scene. In memory only (a reload asks again). `size`: how many are kept.
 */
export function createPlans({ size = 24, timer = { setTimeout, clearTimeout } } = {}) {
    const held = new Map();
    const trim = () => { while (held.size > size) held.delete(held.keys().next().value); };
    return {
        /** Starts `run()` for `key` unless it is there already. Returns the entry `{ status: 'pending' | 'done' | 'failed', result, promise }`. */
        start(key, run) {
            if (held.has(key)) return held.get(key);
            const entry = { status: 'pending', result: null, promise: null };
            entry.promise = Promise.resolve().then(run).then(result => { entry.status = 'done'; entry.result = result; }, () => { entry.status = 'failed'; });
            held.set(key, entry);
            trim();
            return entry;
        },
        peek: key => held.get(key) ?? null,
        /** The entry for `key` once it has settled, or as it is after `ms` (still 'pending'). Null when there is none. */
        async settled(key, ms) {
            const entry = held.get(key);
            if (!entry) return null;
            if (entry.status !== 'pending' || !(ms > 0)) return entry;
            let timeout = null;
            await Promise.race([entry.promise, new Promise(resolve => { timeout = timer.setTimeout(resolve, ms); })]);
            timer.clearTimeout(timeout);
            return entry;
        },
        /** Every plan in flight has settled (for tests). */
        async idle() { await Promise.all([...held.values()].map(entry => entry.promise)); },
        clear: () => held.clear(),
        get size() { return held.size; },
    };
}
