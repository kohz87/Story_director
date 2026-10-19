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
const MAX_PLACES = 4;

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

/** The quickest and the slowest way from `from` to `to` by the pack's roads, or null. */
export function tripRange(pack, from, to) {
    if (!pack || !from || !to || from === to || pack.era === 'modern' || pack.rules?.unit === 'hour') return null;
    const trips = TRIP_MODES.map(mode => {
        const plan = planRoute(pack, from, to, { mode });
        return plan && Number.isFinite(plan.days) && plan.days > 0 ? { mode: plan.mode, days: plan.days, km: plan.km } : null;
    }).filter(Boolean);
    if (!trips.length) return null;
    const fastest = trips.reduce((best, trip) => (trip.days < best.days ? trip : best));
    const slowest = trips.reduce((worst, trip) => (trip.days > worst.days ? trip : worst));
    return { fastest, slowest, km: fastest.km };
}

// Sentences, a closing quote kept with its sentence: '…three days downstream." Auvoth…'.
const sentencesOf = text => String(text ?? '').replace(/\s+/g, ' ').split(/(?<=[.!?…]["”’']?)\s+(?=["“'‘(]?[\p{Lu}\d])/u);

/**
 * The distances for the next note: each place on the pack's roads that `texts` name (the
 * latest reply first, then the reader's message), other than `here`, with its quickest and
 * slowest trip, and what the reply said when that is far off (`said`). At most four.
 * [{ place, fastest: { mode, days }, slowest: { mode, days }, said: { days, text } | null }]
 */
export function distancesFor(pack, here, { reply = '', message = '' } = {}) {
    const from = here ? placesIn(pack, here)[0] ?? null : null;
    if (!pack || !from) return [];
    const out = new Map();
    for (const [text, checks] of [[reply, true], [message, false]]) {
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
