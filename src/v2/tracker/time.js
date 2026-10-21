// Story Director v2, tracker part: the story clock on the reader's calendar (pure).
//
// `director.time.minutes` is v1's story time: minutes since the calendar's epoch (calendar.js).
// The story moves it with a `time` line: `~ time Goldwane 12, 12:45 pm` sets it to a date
// (read as v1 reads the scene's time, the nearest year to the time before), `! time +2h` moves
// it on. The calendar is the reader's (settings section 'Calendar', v1 defaults: Gregorian).

import { PRESETS, makeCalendar, normalizeCalendar } from '../../calendar.js';
import { DEFAULTS } from '../../relevance.js';

const DAY_MINUTES = 1440;

/** The part's settings defaults: v1's calendar and relevance defaults, plain copies. */
export function settingsDefaults() {
    return {
        calendar: structuredClone(PRESETS.gregorian),
        dormantReplies: DEFAULTS.dormantReplies,
        dormantDays: DEFAULTS.dormantDays,
        dueSoonDays: DEFAULTS.dueSoonDays,
    };
}

/** The module's settings as handed to a handler or a view: a function, an object, or nothing. */
export function settingsFrom(source) {
    const value = typeof source === 'function' ? source() : source;
    return { ...settingsDefaults(), ...(value && typeof value === 'object' ? value : {}) };
}

/** The reader's calendar from the module's settings. */
export function calendarOf(settings) {
    return makeCalendar(normalizeCalendar(settings?.calendar ?? PRESETS.gregorian));
}

const UNITS = [
    [/^(?:w|wk|wks|weeks?)$/i, 7 * DAY_MINUTES],
    [/^(?:d|days?)$/i, DAY_MINUTES],
    [/^(?:h|hr|hrs|hours?)$/i, 60],
    [/^(?:m|min|mins|minutes?)$/i, 1],
];
const AMOUNT = /(?:(?<![\d.])(\d+(?:\.\d+)?)|(?<![a-z])(half an?|an?)(?![a-z]))\s*([a-z]+)/gi;

/**
 * Minutes in a written stretch of time: `+2h`, `2 hours`, `+1d 4h`, `an hour and 30 minutes`.
 * A whole number of minutes, or null when the text is not only a stretch of time.
 */
export function durationMinutes(input) {
    const source = String(input ?? '').trim().replace(/^\+\s*/, '').replace(/\b(?:and|later|pass(?:es|ed)?)\b|,|\.(?!\d)/gi, ' ').trim();
    if (!source) return null;
    let total = 0;
    let rest = source;
    for (const match of source.matchAll(AMOUNT)) {
        const unit = UNITS.find(([pattern]) => pattern.test(match[3]));
        if (!unit) return null;
        const amount = match[1] !== undefined ? Number(match[1]) : /^half/i.test(match[2]) ? 0.5 : 1;
        total += amount * unit[1];
        rest = rest.replace(match[0], ' ');
    }
    if (rest.trim() || total <= 0) return null;
    return Math.round(total);
}

/**
 * What a `time` line does to the story time `minutes` (null: not set yet): `{ minutes }`, or
 * `{ error }` in plain words. A date alone runs from its day's start, as v1 reads the scene's
 * time; a bare clock time or part of the day that is earlier than now is the next day's.
 */
export function timeAfter(line, minutes, calendar) {
    const words = [line?.name, line?.text].map(part => String(part ?? '').trim()).filter(Boolean).join(' ');
    if (line?.op === '-' || line?.op === '?') return { error: 'Story time only moves forward or is set: write "! time +2h" or "~ time <date, clock time>".' };
    if (!words) return { error: 'A time line needs a date or a stretch of time.' };
    const known = Number.isInteger(minutes);
    const stretch = durationMinutes(words);
    if (stretch !== null) {
        if (!known) return { error: `The story time is not set yet, so "${words}" cannot move it on; write "~ time <date, clock time>" first.` };
        return { minutes: minutes + stretch };
    }
    const parsed = calendar.parse(words, { reference: known ? minutes : null });
    if (!parsed || !Number.isFinite(parsed.abs)) return { error: `"${words}" is not a date or a stretch of time on this calendar.` };
    let abs = Math.round(parsed.abs);
    // No date written (only "evening", "08:00 am"): the reference's day, or the next one.
    const bare = calendar.parse(words, { reference: null }) === null;
    if (known && bare && abs < minutes) abs += DAY_MINUTES;
    return { minutes: abs };
}
