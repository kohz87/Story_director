// Story Director v2, part **keypeople**: the story's dates as this part reads and writes them (pure apart from the
// query it is handed). The chat's calendar comes from the tracker's `director.calendar` (the reader's, else the
// pack's, else Gregorian); a date is a story minute, and a person's `back` is the start of the day they are due.

import { PRESETS, makeCalendar } from '../../calendar.js';
import { durationMinutes } from '../tracker/time.js';

const DAY = 1440;

/** The chat's calendar through `query` (a ctx's, a view's or a query tool's); Gregorian when nothing answers. */
export function calendarFrom(query) {
    try {
        const config = typeof query === 'function' ? query('director.calendar', {}) : null;
        if (config && typeof config === 'object') return makeCalendar(config);
    } catch {
        // No calendar to ask: Gregorian.
    }
    return makeCalendar(PRESETS.gregorian);
}

/** The date of a story minute as the tail and the screens write it: "Goldwane 18" (no year, no clock). '' for null. */
export function dateText(calendar, minutes) {
    if (!Number.isSafeInteger(minutes)) return '';
    try {
        return calendar.format(minutes, { time: false, era: false });
    } catch {
        return '';
    }
}

/** The start of the story day `minutes` falls on. */
export const dayStart = minutes => Math.floor(minutes / DAY) * DAY;

/**
 * What a `back:` label means: a date on the chat's calendar ("Goldwane 18", "June 3, 1200") or a stretch of time from now
 * ("in 6 days", "+2d"), as the start of that day. `{ back }`, or `{ error }` in plain words. `now`: the story clock, or null.
 */
export function readBack(calendar, text, now) {
    const words = String(text ?? '').trim();
    if (!words) return { error: 'back: needs a date.' };
    const shown = words.length > 60 ? `${words.slice(0, 59)}…` : words;
    const stretch = durationMinutes(words.replace(/^in\s+/i, ''));
    if (stretch !== null) {
        if (!Number.isSafeInteger(now)) return { error: `"${shown}" counts from the story time, which is not set yet.` };
        return { back: dayStart(now + stretch) };
    }
    let parsed = null;
    try {
        parsed = calendar.parse(words, { reference: Number.isSafeInteger(now) ? now : null });
    } catch {
        parsed = null;
    }
    if (!parsed || !Number.isFinite(parsed.abs)) return { error: `"${shown}" is not a date on this calendar.` };
    const abs = Math.round(parsed.abs);
    return Number.isSafeInteger(abs) ? { back: dayStart(abs) } : { error: `"${shown}" is not a date on this calendar.` };
}
