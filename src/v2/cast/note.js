// Story Director v2, part **cast**: what the narrator is told (pure).
//
// Nothing fixed: the narrator writes no cast lines, and an unmet person is never in its text. The one thing it is told is a meeting,
// in the reply it happens in: who comes into the scene (the words of their pack entry that show them: who they are, how they look,
// how they speak, what they want) and why now, so the scene brings them in. Nothing at all while no one is met in this reply, and
// no static text, so a story with no cast in its packs sends the same prompt as before.

import { TAIL_BUDGET, castOn } from './settings.js';
import { cutPoints, isInt, isRecord, slotOf, tables } from './domain.js';
import { whyNarrator } from './apply.js';
import { castOf } from './entries.js';

const FRESH_REPLIES = 2;

/** Whether the meeting recorded in `slot` is for the reply being written now (`at`: the chat's length when it was decided). */
export function meetingFresh(slot, at) {
    const meeting = slotOf(slot);
    return Boolean(meeting) && isInt(at) && isInt(meeting.at) && at >= meeting.at && at < meeting.at + FRESH_REPLIES;
}

const sentence = text => (/[.!?…]$/.test(text) ? text : `${text}.`);
const field = (label, value, max) => {
    const text = cutPoints(value, max);
    return text ? sentence(`${label}: ${text}`) : '';
};

/** One person's cue. */
export function cueOf(person, entry) {
    const raw = entry?.raw ?? {};
    const names = [person.name, ...(Array.isArray(person.aliases) ? person.aliases.slice(0, 2) : [])];
    const parts = [
        `${names[0]}${names.length > 1 ? ` (also ${names.slice(1).join(', ')})` : ''} comes into the scene in this reply. It is their first meeting with {{user}}.`,
        field('Who', raw.about, 240), field('Look', raw.look, 200), field('Voice', raw.voice, 140), field('Manner', raw.personality, 140), field('Wants', entry?.goal, 120),
        field('Why now', whyNarrator(person), 260),
        'Bring them in naturally; do not treat them as known to {{user}} yet.',
    ];
    return parts.filter(Boolean).join(' ');
}

/** `context.tail(view)` → `{ lines, optional }` (SPEC §5): the cue of who crosses the party's path in this reply. */
export function tail(view) {
    if (!castOn(view)) return { lines: [], optional: [] };
    const slice = view?.state?.domains?.cast;
    const meeting = slotOf(slice?.meeting);
    const at = isInt(view?.chat?.length) ? view.chat.length : null;
    if (!meeting || !meetingFresh(slice.meeting, at)) return { lines: [], optional: [] };
    const { people } = tables(slice);
    const cast = castOf(typeof view?.query === 'function' ? (name, args) => view.query(name, args) : null);
    const lines = [];
    for (const key of meeting.keys.slice(0, 2)) {
        const person = isRecord(people[key]) ? people[key] : null;
        if (!person || !isRecord(person.met)) continue;
        lines.push(`[Cast] ${cutPoints(cueOf(person, cast.byKey.get(key)), TAIL_BUDGET * 4 - 8)}`);
    }
    return { lines, optional: [] };
}
