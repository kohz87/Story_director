// Story Director v2, tracker part: the reader's own edit of the story clock (`director.clock`).
//
// The reader sets the date and time by hand (the Game view's Edit button): `{ year, month, day, minutes }`, month and day
// counted from 1, `minutes` the minutes of that day (0 to 1439). Director checks it on the chat's calendar (leap years
// included) and refuses a bad one with one plain sentence that names the field; nothing is saved then. A good one SETS the
// clock on the reply the reader is looking at, as a `~ time <date>` line does (`ctx.absolute`): a swipe or a delete of that
// reply takes it back, a replay or a reload gives the same clock, and the replies before it are not touched. It may go back
// (a rewind: what hangs on the clock follows it, as it does a story's own earlier `~ time`) and it is not held to the
// longest time jump a story's own lines are (`maxJump`). Only the reader sets it this way (cause `ui`); the story writes
// `~ time` and other rules take time through `director.advance`.

import { MAX_YEAR, calendarOf, packCalendarOf, settingsFrom } from './time.js';

export const CLOCK = 'director.clock';

const isInt = value => Number.isSafeInteger(value);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function fail(ctx, code, message) {
    ctx.fail(code, message);
    // ctx.fail throws; this is only for a ctx that does not.
    const error = new Error(message);
    error.code = code;
    throw error;
}

/** The date and time of story minute `abs` as the editor shows them: `{ year, month, day, minutes }` (month and day from 1). */
export function partsOf(calendar, abs) {
    if (!isInt(abs)) return null;
    try {
        const { year, month, day, minutes } = calendar.fromAbs(abs);
        return { year, month: month + 1, day, minutes };
    } catch {
        return null;
    }
}

// The clock as the Game view's hero writes it (Story Block's `fmt.time`): "6:00 pm", no leading zero.
const clockText = minutes => `${Math.floor(minutes / 60) % 12 || 12}:${String(minutes % 60).padStart(2, '0')} ${minutes < 720 ? 'am' : 'pm'}`;

/**
 * Story minute `abs` written as the hero shows it: "CY 611, Goldwane 12, 7:40 pm" ("Goldwane 12, 611, 7:40 pm" for a calendar
 * without an era); `year: false` leaves out the era and the year ("Goldwane 12, 7:40 pm").
 */
export function heroDate(calendar, abs, { year = true } = {}) {
    const date = calendar.fromAbs(abs);
    const day = `${calendar.config.months[date.month].name} ${date.day}`;
    const dated = !year ? day : calendar.config.era ? `${calendar.config.era} ${date.year}, ${day}` : `${day}, ${date.year}`;
    return `${dated}, ${clockText(date.minutes)}`;
}

/**
 * What is wrong with a date and time on `calendar`, in one plain sentence that names the field, or '' when it is a date there.
 * `{ year, month, day, minutes }` as the command takes them.
 */
export function clockProblem(calendar, input) {
    const fields = ['year', 'month', 'day', 'minutes'];
    if (!isRecord(input) || !fields.every(key => isInt(input[key]))) return 'Pick a date and a time.';
    const { year, month, day, minutes } = input;
    const months = calendar.config.months;
    if (Math.abs(year) > MAX_YEAR) return `Pick a year between -${MAX_YEAR} and ${MAX_YEAR}.`;
    if (month < 1 || month > months.length) return 'Pick a month from the list.';
    if (day < 1) return 'Day must be 1 or more.';
    const days = calendar.daysInMonth(year, month - 1);
    if (day > days) {
        const name = months[month - 1].name;
        // The leap month's length depends on the year, so say which year the count is for.
        const leapMonth = months.length > 1 ? 1 : 0;
        return calendar.config.leapYears && month - 1 === leapMonth ? `${name} has ${days} days in ${year}.` : `${name} has ${days} days.`;
    }
    if (minutes < 0 || minutes > 1439) return 'Pick a time of day.';
    return '';
}

/**
 * `director.clock { year, month, day, minutes }` (cause `ui`): the story clock set to that date and time on the chat's
 * calendar, or a refusal (`INVALID`) naming the field. Works while the clock is unset too.
 */
export function clockCommand(ctx, payload) {
    if (ctx.cause !== 'ui') fail(ctx, 'REFUSED', 'Only you set the story clock by hand; the story sets it with a time line.');
    const settings = settingsFrom(ctx.settings);
    const calendar = calendarOf(settings, packCalendarOf(ctx.query));
    const problem = clockProblem(calendar, payload);
    if (problem) fail(ctx, 'INVALID', problem);
    const { year, month, day, minutes } = payload;
    const abs = calendar.toAbs({ year, month: month - 1, day, minutes });
    if (!isInt(abs)) fail(ctx, 'INVALID', 'Pick a date and a time.');

    const director = ctx.draft('director');
    const before = isInt(director.time?.minutes) ? director.time.minutes : null;
    director.time.minutes = abs;
    // A set, not a move (Story Block's ctx.absolute, SPEC §2.2): kept exact when an earlier reply that moved the clock is
    // deleted, and later moves add on top. An older Story Block without it stores the set as a move.
    if (typeof ctx.absolute === 'function') ctx.absolute('director', '/time/minutes');

    // The short form leaves out the year (and era) while the year did not change, as the Director's own note does.
    const sameYear = before !== null && partsOf(calendar, before)?.year === year;
    const full = heroDate(calendar, abs);
    const short = heroDate(calendar, abs, { year: false });
    return {
        summary: `Clock set to ${sameYear ? short : full}`,
        // The Director note gives the time every reply, and a jump forward is told as While away: nothing more to narrate.
        narrate: false,
        // `edit: true` is what Story Block's reply card lists under "Changed this reply" as the reader's own edit (reply-cards.js replyEdits).
        data: { minutes: abs, from: before, date: full, edit: true },
    };
}
