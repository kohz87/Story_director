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
// * A goal pulls someone only with a real link (`linkOf`: the party's place is a place their goal names, an open thread names them or
//   their faction as giver or people, or the party carries what their goal needs); a word the goal and the scene share is none. And
//   someone can arrive only if they are in the party's area or the story time since they were placed covers the atlas trip (`canBeHere`,
//   no known route = far). A linked person who is too far sets out instead (`sortComes`: a journey, `person.coming`, landing after the
//   real trip time, dropped when the link goes). The pulse's chance meeting and the planner's moves follow the same reach rule.
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

// ---- who can be here, and who is really drawn ----------------------------------------------------------------------------------

const fold = text => String(text ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const noArticle = text => fold(text).replace(/^(?:the|a|an)\s+/, '');
/** Whether `text` holds `phrase` as whole words (an article in front of the phrase is left out; under four letters never). */
export const holds = (text, phrase) => {
    const want = noArticle(phrase);
    return want.length >= 4 && ` ${fold(text)} `.includes(` ${want} `);
};
const heads = text => [...new Set([String(text ?? '').trim(), ...String(text ?? '').split(/\s*\/\s*/).map(part => part.trim())])].filter(Boolean);

/**
 * Days of travel from the place `where` to the party's place: 0 when they are in one area (the party's place or region, or the same
 * town before a "/"), null when nothing says how far it is. `travel(from, to)` → days or null (the atlas's trip, atlas.travel).
 */
export function daysBetween(where, party, travel) {
    if (!where || !party?.place) return null;
    if (atParty(where, party) || samePlace(heads(where)[1] ?? where, heads(party.place)[1] ?? party.place)) return 0;
    if (typeof travel !== 'function') return null;
    for (const from of heads(where)) {
        for (const to of heads(party.place)) {
            let days = null;
            try { days = travel(from, to); } catch { days = null; }
            if (Number.isFinite(days) && days >= 0) return days;
        }
    }
    return null;
}

/** The story minute a person with no `since` of their own has been placed since: the first the cast knew (`day.first`, new chats), else its current day (so far people stay far). */
export const placedOf = slice => (isInt(slotOf(slice?.day)?.first) ? slotOf(slice.day).first : dayAt(slice));

/** Whether the person can be at the party's place now: they are in its area, or the story time since they were last placed (`since`, else `placed`: the cast's own day) covers the trip. No route: far. */
export function canBeHere(person, party, { now = null, travel = null, placed = null } = {}) {
    const days = daysBetween(person?.where, party, travel);
    if (days === null) return false;
    if (days === 0) return true;
    const since = isInt(person?.since) ? person.since : placed;
    return isInt(since) && isInt(now) && now - since >= Math.ceil(days * DAY);
}

/**
 * Why their goal really leads to the party, or '' (a word the goal or a drawn-to phrase shares with the scene is no link). `place`: the party's
 * place or region is a place their drawn-to phrases name; `thread`: an open thread (a secret never counts) names them, or one of their
 * phrases (their faction, a person they follow), in its key, giver or people; `carried`: a phrase is something the party carries.
 * `links`: `{ threads: [{ key, fields }], items: [name] }`.
 */
export function linkOf(item, party, { threads = [], items = [] } = {}) {
    const phrases = item.entry?.drawnTo ?? [];
    if (phrases.some(phrase => atParty(phrase, party))) return 'place';
    const own = [item.person.name, ...(Array.isArray(item.person.aliases) ? item.person.aliases : [])];
    for (const thread of threads) {
        const said = [thread.key, ...String(thread.fields?.giver ?? '').split(','), ...String(thread.fields?.people ?? '').split(',')];
        if (said.some(text => own.some(name => holds(text, name)) || phrases.some(phrase => holds(text, phrase)))) return 'thread';
    }
    if (items.some(name => phrases.some(phrase => noArticle(phrase) === noArticle(name) && noArticle(name).length >= 4))) return 'carried';
    return '';
}

/**
 * What a goal pull comes to now. `comes`: the planner's `[{ key, reason }]`. Returns `{ meet, start, stop, land }`: `meet`, the comes of people
 * who may arrive (linked and here or in time); `start`, `[{ key, to, arrive, reason }]` for the linked who are too far (not for no route:
 * unknown is far and has no time to give); `stop`, the keys whose journey has lost its link; `land`, `[{ key, where, doing }]` for journeys
 * whose time is up. `links`/`travel` as above; a person already on a journey does not start another.
 */
export function sortComes(slice, cast, { comes = [], party = {}, now = null, travel = null, links = {}, present = new Set(), pinned = new Set() } = {}) {
    const out = { meet: [], start: [], stop: [], land: [] };
    const all = movable(slice, cast, { present, pinned }).filter(item => !item.met);
    for (const item of all) {
        const trip = slotOf(item.person.coming);
        if (!trip) continue;
        if (!linkOf(item, party, links)) out.stop.push(item.key);
        else if (isInt(now) && now >= trip.arrive) out.land.push({ key: item.key, where: trip.to, doing: 'came looking for you' });
    }
    for (const come of comes) {
        const item = all.find(candidate => candidate.key === come.key);
        if (!item || !item.entry.drawnTo.length || !linkOf(item, party, links) || out.meet.some(pick => pick.key === come.key) || out.start.some(pick => pick.key === come.key)) continue;
        if (canBeHere(item.person, party, { now, travel, placed: placedOf(slice) })) { out.meet.push(come); continue; }
        const days = daysBetween(item.person.where, party, travel);
        if (days === null || slotOf(item.person.coming) || !isInt(now)) continue;
        out.start.push({ key: item.key, to: party.place, arrive: now + Math.max(1, Math.ceil(days * DAY)), reason: come.reason });
    }
    return out;
}

/**
 * The unmet people a chance meeting may bring (the pulse): not present, not pinned, the pace has room, and they can be here (`canBeHere`: in the
 * party's area, or the time since they were placed covers the atlas trip; no route = far); someone at their start keeps their routine, as for a
 * place meeting. Each is `{ ...movable item, here }`, `here`: already at the party's place (met by place; anyone else is met by their way there).
 */
export function chanceCandidates(slice, cast, { party = {}, now = null, travel = null, present = new Set(), pinned = new Set(), pace = paceOf({}) } = {}) {
    if (roomLeft(slice, now, pace) <= 0) return [];
    return movable(slice, cast, { present, pinned }).filter(item => !item.met && canBeHere(item.person, party, { now, travel, placed: placedOf(slice) })
        && !(atParty(item.person.where, party) && samePlace(item.person.where, item.entry.place) && !routineHolds(item.entry.routine, now)))
        .map(item => ({ ...item, here: atParty(item.person.where, party) }));
}

/** Whether a planner move of `person` (not an unplaced one) to `where` at story minute `to` is possible: the trip fits the time since they were placed; no route is allowed except onto the party's place. */
export function moveFits(person, where, { party = {}, to = null, travel = null, placed = null } = {}) {
    if (!person?.where) return true;   // unplaced: nowhere to travel from
    const days = daysBetween(person?.where, { place: where, region: '' }, travel);
    if (days === null) return !atParty(where, party);
    const since = isInt(person?.since) ? person.since : placed;
    return days === 0 || !isInt(since) || !isInt(to) || to - since >= Math.ceil(days * DAY);
}

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
 * shown `text` names them nor `present` (keys of the scene's present list at the end) does, nor, for a meeting marked `seen`, `seen` (everyone the reply's scene lines had present at any point).
 */
export function unshown(slice, { index = null, text = '', present = new Set(), seen = new Set() } = {}) {
    const meeting = slotOf(slice?.meeting);
    if (!meeting || !isInt(index) || meeting.at !== index) return [];
    const { people } = tables(slice);
    const out = [];
    // A meeting made with `seen` also counts who the reply had in the scene at any point, by a name only that person has (a label two
    // people share, "the captain", shows neither).
    const sharing = new Map();
    for (const other of Object.values(people)) if (isRecord(other)) for (const name of new Set(keysOfPerson(other))) sharing.set(name, (sharing.get(name) ?? 0) + 1);
    const wasSeen = person => meeting.seen === 1 && keysOfPerson(person).some(name => sharing.get(name) === 1 && (seen.has(name) || seen.has(bare(name))));
    for (const key of meeting.keys) {
        const person = isRecord(people[key]) ? people[key] : null;
        if (!person || !isMet(person) || person.met.why === 'story' || person.met.rev !== meeting.rev) continue;
        if (namedIn(person, text) || wasSeen(person) || keysOfPerson(person).some(name => present.has(name) || present.has(bare(name)))) continue;
        out.push(key);
    }
    return out;
}

/** Unmet, living people in the world's pack whose place is the party's now: how many "may cross your path here". */
export function nearCount(slice, cast, { party = {}, present = new Set(), pinned = new Set() } = {}) {
    return movable(slice, cast, { present, pinned }).filter(item => !item.met && atParty(item.person.where, party)).length;
}
