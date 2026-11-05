// Story Director v2, part **cast**: the rules that decide who moves and who crosses the party's path (pure apart from the queries
// a frame is built from). No dice: a meeting follows from place and routine, or from a goal the story touched.
//
// * The cast moves only when the story day changes or a stretch of time passes (`dueMove`): one batch, from the story minute the
//   cast was last moved to the clock now.
// * A first meeting (`chooseMeetings`), at most one a reply, never during a fight, within the "new faces at most" pace:
//   - by place: the party is at the person's place while their routine has them there (their entry's `routine` names a time of
//     day; one that names none holds at any hour; a person who has moved away from their start has no routine to keep);
//   - by goal: the planner judged that a phrase of their `drawnTo` is touched by the story and cites the reason.
//   - sought: the reader's message looked for a kind of person and the planner named this one, citing words that stand in the message (or
//     the story's last reply) as whole words (plan.js, sought.js): met at once when they are at the party's place, else a RUMOR (no meeting:
//     `chooseRumor`, one line that describes them and never names them, told once until they move).
//   Goal meetings come first (they carry a reason the story gave), then sought, then place meetings in the order people joined the world.
// * A meeting counts only if the reply shows the person (`unshown`, after the reply: `cast.withdraw`): the narration (not its hidden
//   comments) names them (name or alias, whole word) or a `+ present` line does; else they stay unmet, the pace is not used up and
//   they may come again later. Someone met in the story is no planned meeting and is never withdrawn.
// * People the narrator already has in the scene (present), people the reader pinned as Key people, the dead and people whose pack
//   is not enabled now are left alone.

import { sha256 } from '../hash.js';
import { atParty, routineHolds, samePlace } from './entries.js';
import { kindTouches, rumorText } from './sought.js';
import { DAY, FACES, DEFAULT_FACES, dayAt, dayOf, isAlive, isInt, isMet, isRecord, keysOfPerson, peopleOf, slotOf, tables } from './domain.js';

/** A stretch of time that moves the cast even inside one day: six story hours. */
export const SKIP_MINUTES = 360;
/** People one reply may bring. */
export const PER_REPLY = 1;

/** What moves the cast now: `{ from, to, reset }` or null. `reset`: the clock went back (a rewind), so the cast only follows it. */
export function dueMove(slice, now) {
    const at = dayAt(slice);
    if (!isInt(now) || at === null) return null;
    if (now < at) return { from: at, to: now, reset: true };
    if (dayOf(now) > dayOf(at) || now - at >= SKIP_MINUTES) return { from: at, to: now, reset: false };
    return null;
}

/** A short fingerprint of who is in the world (keys and join minutes): in-flight plans are told apart by it, chat from chat. */
export const fingerprint = (slice, chatId = '') => sha256(JSON.stringify([chatId, peopleOf(slice).map(person => [person.key, person.joined])])).slice(0, 12);

export const batchKey = (print, due) => `batch|${print}|${due.from}|${due.to}`;
export const judgeKey = (print, now) => `judge|${print}|${dayOf(now)}`;

/**
 * Everyone who can be moved: alive, their entry readable now, not in the scene, not pinned as Key people, joined before `to`.
 * The most stale first. Each: `{ key, ref, person, entry, met, mayDie }`.
 */
export function movable(slice, cast, { to = null, present = new Set(), pinned = new Set(), unmetDie = false } = {}) {
    const out = [];
    for (const person of peopleOf(slice)) {
        const entry = cast.byKey.get(person.key);
        if (!entry || !isAlive(person)) continue;
        if (isInt(to) && isInt(person.since) && person.since >= to) continue;
        const keys = keysOfPerson(person);
        if (keys.some(key => present.has(key) || pinned.has(key))) continue;
        const met = isMet(person);
        out.push({ key: person.key, person, entry, met, mayDie: !met && (unmetDie || entry.canDieUnmet === true) });
    }
    out.sort((a, b) => (a.person.since ?? -Infinity) - (b.person.since ?? -Infinity) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    // A ref is the entry's id when it is the only one in this list, else the whole key.
    const ids = new Map();
    for (const item of out) ids.set(item.entry.id.toLowerCase(), (ids.get(item.entry.id.toLowerCase()) ?? 0) + 1);
    for (const item of out) item.ref = ids.get(item.entry.id.toLowerCase()) > 1 ? item.key.toLowerCase() : item.entry.id.toLowerCase();
    return out;
}

/** The planner's view of a movable person. */
export const askedAbout = item => ({
    ref: item.ref, name: item.person.name, goal: item.entry.goal, routine: item.entry.routine, where: item.person.where, doing: item.person.doing,
    drawnTo: item.met ? [] : item.entry.drawnTo, met: item.met, mayDie: item.mayDie,
});

/** `refs` (ref → key) of a list of movable people. */
export const refsOf = list => new Map(list.map(item => [item.ref, item.key]));

// ---- the pace --------------------------------------------------------------------------------------------------------------------

/** The pace setting: `{ count, days }`. */
export function paceOf(settings) {
    return FACES[settings?.faces] ?? FACES[DEFAULT_FACES];
}

/** How many new faces the pace still allows at story minute `now` (people met on the same story day, or in the last `days` days). */
export function roomLeft(slice, now, pace) {
    // Someone the story already had in the scene (`why: 'story'`) is no new face: they do not use up the pace.
    const met = peopleOf(slice).filter(person => isMet(person) && person.met.why !== 'story');
    const recent = met.filter(person => {
        const on = person.met.on;
        if (!isInt(on) || !isInt(now)) return true;
        return pace.days === 1 ? dayOf(on) === dayOf(now) : on > now - pace.days * DAY;
    });
    return Math.max(0, pace.count - recent.length);
}

// ---- who crosses the party's path ---------------------------------------------------------------------------------------------------

/**
 * The people who meet the party in the reply about to be written, `[{ key, why: 'place' | 'goal', reason }]` (at most PER_REPLY, none
 * during a fight or when the pace allows no more). `comes`: the planner's `[{ key, reason }]`; `sought`: its checked `[{ key, words }]`.
 */
export function chooseMeetings(slice, cast, { now = null, party = {}, comes = [], sought = [], fight = false, pace, present = new Set(), pinned = new Set() } = {}) {
    if (fight) return [];
    const place = party?.place ?? '';
    let room = Math.min(PER_REPLY, roomLeft(slice, now, pace));
    if (room <= 0) return [];
    const eligible = movable(slice, cast, { present, pinned }).filter(item => !item.met);
    const picks = [];
    for (const come of comes) {
        const item = eligible.find(candidate => candidate.key === come.key);
        if (!item || !item.entry.drawnTo.length || picks.some(pick => pick.key === item.key)) continue;
        picks.push({ key: item.key, why: 'goal', reason: come.reason, place });
        if (picks.length >= room) return picks;
    }
    room -= picks.length;
    // Someone the reader sought who is at this place (and whose routine has them here): they come, with the reader's own words as the reason.
    for (const ask of sought) {
        if (room <= 0) break;
        const item = eligible.find(candidate => candidate.key === ask.key);
        if (!item || picks.some(pick => pick.key === item.key) || !atParty(item.person.where, party)) continue;
        if (samePlace(item.person.where, item.entry.place) && !routineHolds(item.entry.routine, now)) continue;
        picks.push({ key: item.key, why: 'sought', reason: ask.words, place });
        room -= 1;
    }
    const byJoin = [...eligible].sort((a, b) => (a.person.joined ?? -Infinity) - (b.person.joined ?? -Infinity) || (a.key < b.key ? -1 : 1));
    for (const item of byJoin) {
        if (room <= 0) break;
        if (picks.some(pick => pick.key === item.key) || !atParty(item.person.where, party)) continue;
        // Their routine only binds them at their start: someone who has moved on is where they are now.
        const home = samePlace(item.person.where, item.entry.place);
        if (home && !routineHolds(item.entry.routine, now)) continue;
        picks.push({ key: item.key, why: 'place', reason: '' });
        room -= 1;
    }
    return picks;
}

/**
 * A sought person who is elsewhere: `{ key, where, text }` or null. A rumor and no meeting (nobody comes, the pace is not used): never during a
 * fight, never when a meeting is made in this reply (one cue a reply), never someone present or pinned, someone met or dead, someone already
 * heard of at the place they are still at, or someone who has no place or is at the party's (they come, or wait). The text describes them and
 * never names them (sought.js); with no way to say it without the name, no rumor.
 */
export function chooseRumor(slice, cast, { party = {}, sought = [], fight = false, met = [], present = new Set(), pinned = new Set() } = {}) {
    if (fight || met.length) return null;
    const eligible = movable(slice, cast, { present, pinned }).filter(item => !item.met);
    for (const ask of sought) {
        const item = eligible.find(candidate => candidate.key === ask.key);
        if (!item || !item.person.where || atParty(item.person.where, party)) continue;
        const told = slotOf(item.person.rumored);
        if (told && told.where === item.person.where) continue;
        const text = rumorText(item.entry, { where: item.person.where, home: samePlace(item.person.where, item.entry.place) });
        if (text) return { key: item.key, where: item.person.where, text };
    }
    return null;
}

/** The unmet, living, placed people (not in the scene, not pinned) the reader's `text` may be asking for, by their calling: the planner's list. */
export function seekable(slice, cast, { present = new Set(), pinned = new Set(), text = '' } = {}) {
    return movable(slice, cast, { present, pinned }).filter(item => !item.met && item.person.where && kindTouches(item.entry, text));
}

// Story Block's present list drops a leading article ("the scout" is listed as "scout"), so an alias is matched with it too.
const bare = key => key.replace(/^(?:the|a|an)\s+/, '');

/**
 * The unmet people of the packs' cast the story already has in the scene under their name or an alias (`present`: keys): they are met at
 * that moment, "met in the story", as `{ key, why: 'story', reason: '', place }` (no cue: the narrator has them already).
 */
export function metInTheStory(slice, cast, { present = new Set(), party = {} } = {}) {
    return peopleOf(slice)
        .filter(person => !isMet(person) && isAlive(person) && cast.byKey.has(person.key) && keysOfPerson(person).some(key => present.has(key) || present.has(bare(key))))
        .map(person => ({ key: person.key, why: 'story', reason: '', place: party?.place ?? '' }));
}

// ---- the reply shows the person ----------------------------------------------------------------------------------------------------

const escapeRe = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whether `text` (the reply's shown words, hidden comments out) names the person: their name or one of their aliases as a whole word,
 * in any case. A title alone ("Sister") is not a name, and a name inside a longer word is not the name.
 */
export function namedIn(person, text) {
    const said = String(text ?? '');
    if (!said) return false;
    const names = [person?.name, ...(Array.isArray(person?.aliases) ? person.aliases : [])].map(name => String(name ?? '').trim()).filter(Boolean);
    return names.some(name => new RegExp(`(?<![\\p{L}\\p{N}_])${name.split(/\s+/).map(escapeRe).join('\\s+')}(?![\\p{L}\\p{N}_])`, 'iu').test(said));
}

/**
 * The people the meeting recorded for reply `index` brought in who the reply did not show, as keys: `slice.meeting` is for that reply, the
 * person was met by it (their `rev` is the meeting's) for place or goal (someone met in the story is never withdrawn), and neither the
 * shown `text` names them nor `present` (keys of the scene's present list, `+ present` lines) does.
 */
export function unshown(slice, { index = null, text = '', present = new Set() } = {}) {
    const meeting = slotOf(slice?.meeting);
    if (!meeting || !isInt(index) || meeting.at !== index) return [];
    const { people } = tables(slice);
    const out = [];
    for (const key of meeting.keys) {
        const person = isRecord(people[key]) ? people[key] : null;
        if (!person || !isMet(person) || person.met.why === 'story' || person.met.rev !== meeting.rev) continue;
        if (namedIn(person, text) || keysOfPerson(person).some(name => present.has(name) || present.has(bare(name)))) continue;
        out.push(key);
    }
    return out;
}

/** Unmet, living people in the world's pack whose place is the party's now: how many "may cross your path here". */
export function nearCount(slice, cast, { party = {}, present = new Set(), pinned = new Set() } = {}) {
    return movable(slice, cast, { present, pinned }).filter(item => !item.met && atParty(item.person.where, party)).length;
}
