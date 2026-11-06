// Story Director: resolving the arc planner relative dates (pure).

import { isNumber } from './shared.js';

const DATE_FIELDS = ['on', 'due', 'arrive'];
export const FIRE_FIELDS = ['on', 'due'];

const DAY_MINUTES = 1440;
const UNIT_MINUTES = Object.freeze({ minute: 1, hour: 60, day: DAY_MINUTES, week: 7 * DAY_MINUTES });
const NUMBER_WORDS = Object.freeze({
    a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
    seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
});
const COUNT = `(\\d+(?:\\.\\d+)?|${Object.keys(NUMBER_WORDS).join('|')})`;
const UNIT = '(minute|hour|day|week)s?';
const IN_SPAN = new RegExp(`^in\\s+${COUNT}\\s+${UNIT}(?:\\s+(.+))?$`);
const SPAN_FROM_NOW = new RegExp(`^${COUNT}\\s+${UNIT}\\s+(?:from\\s+now|later)(?:\\s+(.+))?$`);
const DAY_WORDS = Object.freeze({
    today: { days: 0 },
    tonight: { days: 0, time: 'night' },
    tomorrow: { days: 1 },
    'next day': { days: 1 },
    'following day': { days: 1 },
    'day after tomorrow': { days: 2 },
    'next week': { days: 7 },
});
// Longest first, so `day after tomorrow` is not read as `day …`.
const DAY_WORD = new RegExp(`^(?:the\\s+)?(${Object.keys(DAY_WORDS)
    .sort((a, b) => b.length - a.length).join('|')})(?:\\s+(.+))?$`);
// `next morning`, `the following evening`, `this afternoon`: the word must be a time of day,
// which the calendar decides (so a reader's own parts of day work too).
const NEXT_PART = /^(?:the\s+)?(next|following|this)\s+(\p{L}+)$/u;

export function resolveDates(fields, { calendar, now }) {
    const out = { ...fields };
    if (!calendar || !isNumber(now)) return out;
    for (const name of DATE_FIELDS) {
        if (!out[name]) continue;
        const resolved = resolveRelative(out[name], { calendar, now });
        if (resolved !== null) out[name] = resolved;
    }
    return out;
}

// A relative date written as a calendar date, or null when the text is not one (an absolute
// date, or something unreadable, which then stays as written).
export function resolveRelative(value, { calendar, now }) {
    const text = String(value)
        .toLowerCase()
        .replace(/["“”]/g, '')
        .replace(/,/g, ' ')
        .replace(/[.!]+$/, '')
        .replace(/\s+/g, ' ')
        .trim();

    const span = text.match(IN_SPAN) ?? text.match(SPAN_FROM_NOW);
    if (span) {
        const unit = UNIT_MINUTES[span[2]];
        const at = now + Math.round(countOf(span[1]) * unit);
        if (!span[3]) return calendar.format(at, { era: false });
        // A time of day only fits a step of whole days ("in 2 days at dawn").
        if (unit < DAY_MINUTES) return null;
        const timed = timeOnDay(calendar, at, span[3]);
        return timed === null ? null : calendar.format(timed, { era: false });
    }

    const dayWord = text.match(DAY_WORD);
    if (dayWord) {
        const { days, time = null } = DAY_WORDS[dayWord[1]];
        return onDay(calendar, now, days, dayWord[2] ?? time);
    }

    const part = text.match(NEXT_PART);
    if (part) return onDay(calendar, now, part[1] === 'this' ? 0 : 1, part[2]);
    return null;
}

function onDay(calendar, now, days, time) {
    const day = calendar.addDays(now, days);
    // A day without a time stays a whole day ("tomorrow"), the way an absolute date without
    // a time is read; only a span ("in 2 days") keeps the hour of now.
    if (!time) return calendar.format(day, { era: false, time: false });
    const at = timeOnDay(calendar, day, time);
    return at === null ? null : calendar.format(at, { era: false });
}

// `at dusk`, `7 pm`, `in the evening` on the day of `day`. The calendar reads the time, so
// its own parts of day count; anything that is not just a time (a date) is no reading.
function timeOnDay(calendar, day, text) {
    const time = text.replace(/^(?:at|by|around|about|in the|on the)\s+/, '').trim();
    const parsed = calendar.parse(time, { reference: day });
    if (!parsed?.hasTime || String(parsed.text ?? '').trim().toLowerCase() !== time) return null;
    if (calendar.dayIndex(parsed.abs) !== calendar.dayIndex(day)) return null;
    return parsed.abs;
}

function countOf(word) {
    return Object.hasOwn(NUMBER_WORDS, word) ? NUMBER_WORDS[word] : Number(word);
}
