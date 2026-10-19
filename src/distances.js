// Story Director: how far the places the story talks about really are (pure).
//
// (0.9.22) A reply that names a place on the world pack's roads and says how long the trip
// takes ("Ninebarge Crossing … three days downstream") is checked against the routes. The
// next note gives the real figures for the places the story or the reader just named, and
// says when what the story said is far off, so the next reply keeps to the map.

import { placesIn, planRoute } from './routes.js';

// The ways a pre-modern trip goes, fastest first in the usual case; the slowest is on foot.
const TRIP_MODES = Object.freeze(['boat', 'ride', 'wagon', 'foot']);
// A said time this far outside the routes' range is wrong, not a rounding.
const TOO_SHORT = 0.5;
const TOO_LONG = 2;
// (0.9.23) The places in play the note gives distances for, at most.
const MAX_PLACES = 6;

const NUMBER_WORDS = Object.freeze({
    a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
    eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, few: 3, couple: 2,
});
const UNIT_DAYS = Object.freeze({ day: 1, week: 7, fortnight: 14, month: 30 });
const COUNT = `\\d+(?:\\.\\d+)?|${Object.keys(NUMBER_WORDS).join('|')}`;
// "three days", "a week's ride", "half a day", and spans: "a day or two", "two to four days", "3-5 days".
const DURATION = new RegExp(`\\b(half\\s+a|${COUNT})[\\s-]+(day|week|fortnight|month)s?\\s+or\\s+(${COUNT})\\b|\\b(half\\s+a|${COUNT})(?:\\s*(?:or|to|-|–)\\s*(${COUNT}))?[\\s-]+(day|week|fortnight|month)s?(?:'s?|’s?)?\\b`, 'i');

const countOf = word => {
    const key = String(word ?? '').toLowerCase().replace(/\s+/g, ' ');
    return key === 'half a' ? 0.5 : Number.isFinite(Number(key)) ? Number(key) : NUMBER_WORDS[key];
};

/**
 * A travel time said in `sentence`, in days: `{ days, most, text }`, `most` the top of a span
 * ("a day or two": 1 and 2), or null. "three days", "a week's ride", "half a day", "3-5 days".
 */
export function saidDuration(sentence) {
    const m = DURATION.exec(String(sentence ?? ''));
    if (!m) return null;
    const [low, high, unit] = m[1] !== undefined ? [m[1], m[3], m[2]] : [m[4], m[5], m[6]];
    const first = countOf(low);
    const second = high === undefined ? first : countOf(high);
    if (!Number.isFinite(first) || first <= 0 || !Number.isFinite(second)) return null;
    const per = UNIT_DAYS[unit.toLowerCase()];
    return { days: Math.min(first, second) * per, most: Math.max(first, second) * per, text: m[0].trim() };
}

// Routes per pack, worked out once: the note asks for the same few on every reply.
const RANGES = new WeakMap();

/** The quickest and the slowest way from `from` to `to` by the pack's roads, or null. */
export function tripRange(pack, from, to) {
    if (!pack || !from || !to || from === to || pack.era === 'modern' || pack.rules?.unit === 'hour') return null;
    if (!RANGES.has(pack)) RANGES.set(pack, new Map());
    const known = RANGES.get(pack);
    const key = `${from}\u0000${to}`;
    if (!known.has(key)) known.set(key, planRange(pack, from, to));
    return known.get(key);
}

function planRange(pack, from, to) {
    const trips = TRIP_MODES.map(mode => {
        const plan = planRoute(pack, from, to, { mode });
        return plan && Number.isFinite(plan.days) && plan.days > 0 ? { mode: plan.mode, days: plan.days, km: plan.km } : null;
    }).filter(Boolean);
    if (!trips.length) return null;
    const fastest = trips.reduce((best, trip) => (trip.days < best.days ? trip : best));
    const slowest = trips.reduce((worst, trip) => (trip.days > worst.days ? trip : worst));
    return { fastest, slowest, km: fastest.km, trips };
}

// Sentences, a closing quote kept with its sentence: '…three days downstream." Auvoth…'.
const sentencesOf = text => String(text ?? '').replace(/\s+/g, ' ').split(/(?<=[.!?…]["”’']?)\s+(?=["“'‘(]?[\p{Lu}\d])/u);

/**
 * The distances for the next note: the places in play on the pack's roads, other than `here`,
 * each with its quickest and slowest trip, and what the latest reply said when that is far off
 * (`said`). (0.9.23) In play, in this order until there are six: named in the reader's message,
 * in the latest reply, in an open record (`records`, one text each), in the recent chat
 * (`recent`, newest first).
 * [{ place, fastest: { mode, days }, slowest: { mode, days }, said: { days, most, text } | null }]
 */
export function distancesFor(pack, here, { reply = '', message = '', records = [], recent = [] } = {}) {
    const from = here ? placesIn(pack, here)[0] ?? null : null;
    if (!pack || !from) return [];
    const out = new Map();
    const sources = [[message, false], [reply, true], ...[...records, ...recent].map(text => [text, false])];
    for (const [text, checks] of sources) {
        for (const sentence of sentencesOf(text)) {
            const named = placesIn(pack, sentence).filter(name => name !== from);
            for (const place of named) {
                if (out.size >= MAX_PLACES && !out.has(place)) continue;
                const range = out.get(place)?.range ?? tripRange(pack, from, place);
                if (!range) continue;
                // A time is read as this place's only when the sentence names no other.
                const said = checks && named.length === 1 ? saidDuration(sentence) : null;
                const wrong = said && (said.most < range.fastest.days * TOO_SHORT || said.days > range.slowest.days * TOO_LONG) ? said : null;
                const before = out.get(place);
                out.set(place, { place, range, said: before?.said ?? wrong });
            }
        }
    }
    return [...out.values()].map(({ place, range, said }) => ({ place, fastest: range.fastest, slowest: range.slowest, said }));
}

// (0.9.24) The way a sentence says the trip goes: "downstream", "a day's ride", "on foot".
const MODE_HINTS = Object.freeze([
    ['boat', /\b(?:barge|boat|downstream|upstream|downriver|upriver|by river|sail(?:s|ed|ing)?|ferry|pole[sd]?|row(?:s|ed|ing)?)\b/i],
    ['ride', /\b(?:ride|riding|horse(?:back)?|mounted|gallop)\b/i],
    ['wagon', /\b(?:wagon|cart|caravan|convoy)\b/i],
    ['foot', /\b(?:walk(?:s|ed|ing)?|on foot|march(?:es|ed|ing)?|hike)\b/i],
]);

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function wordsFor(n) {
    if (n < 20) return ONES[n];
    if (n < 100) return `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${ONES[n % 10]}` : ''}`;
    return String(n);
}

/** A trip of `days` the way a storyteller says it: "half a day", "a day", "two and a half days", "twenty-two days". */
export function daysInWords(days) {
    if (days < 0.75) return 'half a day';
    if (days < 1.25) return 'a day';
    if (days < 3) {
        const whole = Math.floor(days + 0.25);
        const half = days - whole >= 0.25;
        return `${wordsFor(whole)}${half ? ' and a half' : ''} days`;
    }
    return `${wordsFor(Math.round(days))} days`;
}

/**
 * (0.9.24) The travel times the reply just written gets wrong, checked the moment it arrives:
 * [{ place, from, said, fastest, slowest, mode, days, fix }] where `mode` and `days` are the
 * trip the sentence means ("downstream": by boat; else the quickest) and `fix` the words to
 * put in place of `said.text` ("twenty-two days").
 */
export function wrongDistances(pack, here, reply) {
    const from = here ? placesIn(pack, here)[0] ?? null : null;
    if (!pack || !from) return [];
    const out = [];
    // Only the story the reader sees: never a hidden block's own text.
    for (const sentence of sentencesOf(String(reply ?? '').replace(/<!--[\s\S]*?-->/g, ' '))) {
        const named = placesIn(pack, sentence).filter(name => name !== from);
        if (named.length !== 1) continue;
        const said = saidDuration(sentence);
        const range = said ? tripRange(pack, from, named[0]) : null;
        if (!range || !(said.most < range.fastest.days * TOO_SHORT || said.days > range.slowest.days * TOO_LONG)) continue;
        const hinted = MODE_HINTS.find(([, pattern]) => pattern.test(sentence))?.[0];
        const trip = range.trips.find(entry => entry.mode === hinted) ?? range.fastest;
        const possessive = /['’]s?$/.test(said.text);
        out.push({
            place: named[0], from, said, fastest: range.fastest, slowest: range.slowest,
            mode: trip.mode, days: trip.days, fix: `${daysInWords(trip.days)}${possessive ? '’' : ''}`,
        });
    }
    return out;
}

const ENVELOPE = /<!--[\s\S]*?-->/g;

/**
 * `text` with `said` (a duration as the story wrote it) replaced by `fix`, at its first place
 * outside the hidden envelopes after `place` is named, else its first place outside them.
 * Null when it is not there.
 */
export function withFixedDistance(text, { place, said, fix }) {
    const source = String(text ?? '');
    const hidden = [...source.matchAll(ENVELOPE)].map(m => [m.index, m.index + m[0].length]);
    const visible = at => !hidden.some(([start, end]) => at >= start && at < end);
    const find = (needle, from = 0) => {
        const lower = source.toLowerCase();
        for (let at = lower.indexOf(needle.toLowerCase(), from); at >= 0; at = lower.indexOf(needle.toLowerCase(), at + 1)) {
            if (visible(at)) return at;
        }
        return -1;
    };
    const named = find(place);
    let at = named >= 0 ? find(said.text, named) : -1;
    if (at < 0) at = find(said.text);
    if (at < 0) return null;
    return `${source.slice(0, at)}${fix}${source.slice(at + said.text.length)}`;
}
