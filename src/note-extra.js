// Story Director: the note's header, no-weekday line and distance lines (pure).
//
// These smaller sections moved out of note.js; note.js re-exports their public names.
import { ITEM_SEPARATOR, notePart } from './note-format.js';

export function header(selection, calendar) {
    const parts = ['Story Director'];
    const now = selection?.now;
    if (calendar && typeof now === 'number' && Number.isFinite(now)) {
        // (0.9.21) Today's weekday leads the date when the world has a week.
        const day = typeof calendar.weekday === 'function' ? calendar.weekday(now) : '';
        parts.push(day ? `${day}, ${calendar.format(now)}` : calendar.format(now));
    }
    if (selection?.place) parts.push(selection.place);
    return `[${parts.join(ITEM_SEPARATOR)}]`;
}

/** The note's header for a selection ("[Story Director · date · place]"), for a note with no other part (v2's tail). */
export const noteHeader = header;

// (0.9.22) The places the story or the reader just named, by the world pack's roads: about 12
// tokens a place, and a few more when the reply said a time far off the map.
export const DISTANCES_OFF = 'Keep to these when the trip comes up again.';
const MODE_WORDS = Object.freeze({ foot: 'foot', ride: 'riding', wagon: 'wagon', boat: 'boat' });

function daysText(days) {
    return days < 3 ? String(Math.round(days * 2) / 2) : String(Math.round(days));
}

function distanceItem({ place, fastest, slowest, said }) {
    const low = daysText(fastest.days);
    const high = daysText(slowest.days);
    const how = low === high || fastest.mode === slowest.mode
        ? `${low} ${low === '1' || Number(low) < 1 ? 'day' : 'days'} by ${MODE_WORDS[fastest.mode] ?? fastest.mode}`
        : `${low}–${high} days (${MODE_WORDS[fastest.mode] ?? fastest.mode} to ${MODE_WORDS[slowest.mode] ?? slowest.mode})`;
    return `${place} ${how}${said ? `, not ${said.text}` : ''}`;
}

export function distancesLine(distances, from) {
    const list = (distances ?? []).filter(entry => entry?.place && entry.fastest && entry.slowest);
    if (!list.length || !from) return '';
    const off = list.some(entry => entry.said);
    return `Distances from ${from}: ${list.map(distanceItem).join(ITEM_SEPARATOR)}.${off ? ` ${DISTANCES_OFF}` : ''}`;
}

// (0.9.21) About 20 tokens after the header, only for a calendar with no week: without it a
// model gives deadlines as "Friday noon", which no one in the world can count to.
export const NO_WEEKDAYS = 'This world has no weekdays: name a day by its date ({{date}}), never Monday to Sunday.';

export function noWeekLine(selection, calendar) {
    const now = selection?.now;
    // A real custom calendar only (makeCalendar's config names its preset; Gregorian has a week).
    if (calendar?.config?.preset !== 'custom' || (calendar.config.week ?? []).length) return '';
    if (typeof now !== 'number' || !Number.isFinite(now) || typeof calendar.format !== 'function') return '';
    return NO_WEEKDAYS.replace('{{date}}', calendar.format(calendar.addDays(now, 2), { time: false, era: false }));
}
