// Story Director v2, part **cast**: what the narrator is told (pure).
//
// Nothing fixed: the narrator writes no cast lines, and an unmet person is never in its text. The one thing it is told is a meeting,
// in the reply it happens in: who comes into the scene (the words of their pack entry that show them: who they are, how they look,
// how they speak, what they want) and why now, so the scene brings them in. Nothing at all while no one is met in this reply, and
// no static text, so a story with no cast in its packs sends the same prompt as before.

import { TAIL_BUDGET, castOn } from './settings.js';
import { cutWords, isInt, isRecord, slotOf, tables } from './domain.js';
import { whyNarrator } from './apply.js';
import { castOf } from './entries.js';

const FRESH_REPLIES = 2;

/** Whether the meeting recorded in `slot` is for the reply being written now (`at`: the chat's length when it was decided). */
export function meetingFresh(slot, at) {
    const meeting = slotOf(slot);
    return Boolean(meeting) && isInt(at) && isInt(meeting.at) && at >= meeting.at && at < meeting.at + FRESH_REPLIES;
}

const sentence = text => (/[.!?…]$/.test(text) ? text : `${text}.`);

// The descriptive fields in the order they are kept, each with the most it may take.
const FIELDS = [['Who', 'about', 240], ['Look', 'look', 200], ['Voice', 'voice', 140], ['Manner', 'personality', 140]];
const CLOSING = 'Bring them in naturally; do not treat them as known to {{user}} yet.';
const WHY_MAX = 260;

/**
 * One person's cue, at most `room` characters. What matters comes first and always survives whole: who comes (the name), why now (the
 * reason the story gave, or where they are) and how to bring them in; the descriptive fields (who they are, how they look, how they
 * speak, their manner, what they want) fill what is left, each cut at a word, and a field with no room is left out.
 */
export function cueOf(person, entry, room = TAIL_BUDGET * 4 - 8 - '[Cast] '.length) {
    const raw = entry?.raw ?? {};
    const names = [person.name, ...(Array.isArray(person.aliases) ? person.aliases.slice(0, 2) : [])];
    const intro = `${names[0]}${names.length > 1 ? ` (also ${names.slice(1).join(', ')})` : ''} comes into the scene in this reply. It is their first meeting with {{user}}.`;
    const why = sentence(`Why now: ${cutWords(whyNarrator(person), WHY_MAX)}`);
    let left = room - [intro, why, CLOSING].reduce((sum, part) => sum + Array.from(part).length + 1, 0);
    const kept = [];
    for (const [label, key, max] of [...FIELDS, ['Wants', null, 120]]) {
        const value = key === null ? entry?.goal : raw[key];
        const flatText = cutWords(value, max);
        if (!flatText) continue;
        // `Label: ` and the full stop are the field's own; a field needs room for a few words at least.
        const overhead = label.length + 3;
        if (left - overhead < 24) continue;
        const text = sentence(`${label}: ${cutWords(flatText, left - overhead - 1)}`);
        kept.push(text);
        left -= Array.from(text).length + 1;
    }
    return [intro, ...kept, why, CLOSING].join(' ');
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
        lines.push(`[Cast] ${cueOf(person, cast.byKey.get(key))}`);
    }
    return { lines, optional: [] };
}
