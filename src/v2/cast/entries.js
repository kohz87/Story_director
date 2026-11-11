// Story Director v2, part **cast**: what the enabled packs list (Story Block's query `packs.content({ kind: 'cast' })`), the
// scene the party is in, and the plain rules that decide where someone is (pure apart from the queries it is handed).
//
// A pack entry: { pack, packVersion, id, name, aliases?, about, look, voice?, personality?, history?, portrait?, start: { place,
// goal, routine? }, drawnTo?[], meters?, stages?, fields?, secrets?, canDieUnmet? }. Here only the words the world needs to move a
// person and to bring them in are read, cut to size; the entry itself goes to other modules whole, and only after the meeting.

import { hashJson } from '../hash.js';
import { DAY, MAX_ALIASES, MAX_NAME, MAX_PEOPLE, MAX_PLACE, cutPoints, flat, isInt, isRecord, keyOf, personKey } from './domain.js';

const MIN_NAME = 3;

/** Asks a query; `fallback` when there is none, it throws or it answers undefined. */
export function ask(query, name, args = {}, fallback = null) {
    if (typeof query !== 'function') return fallback;
    try {
        const value = query(name, args);
        return value === undefined ? fallback : value;
    } catch {
        return fallback;
    }
}

const SLUG = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

/**
 * One listed entry as the world reads it, or null when it is not one: `{ key, pack, id, name, aliases, ver, place, goal, routine,
 * drawnTo, canDieUnmet, calling, about, raw }` (text cut and flattened; `raw` the entry as listed, for the narrator's cue and other modules, never stored).
 */
export function readEntry(raw) {
    if (!isRecord(raw)) return null;
    const pack = typeof raw.pack === 'string' ? raw.pack.trim() : '';
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    const name = cutPoints(raw.name, MAX_NAME);
    if (!SLUG.test(pack) || !SLUG.test(id) || !keyOf(name)) return null;
    const start = isRecord(raw.start) ? raw.start : {};
    const aliases = [];
    for (const alias of Array.isArray(raw.aliases) ? raw.aliases : []) {
        const clean = cutPoints(alias, MAX_NAME);
        if (keyOf(clean) && keyOf(clean) !== keyOf(name) && !aliases.some(other => keyOf(other) === keyOf(clean))) aliases.push(clean);
        if (aliases.length >= MAX_ALIASES) break;
    }
    return {
        key: personKey(pack, id), pack, id, name, aliases,
        ver: cutPoints(raw.packVersion, MAX_NAME),
        place: cutPoints(start.place, MAX_PLACE),
        goal: cutPoints(start.goal, 160),
        routine: cutPoints(start.routine, 160),
        drawnTo: (Array.isArray(raw.drawnTo) ? raw.drawnTo : []).map(phrase => cutPoints(phrase, 80)).filter(Boolean).slice(0, 6),
        canDieUnmet: raw.canDieUnmet === true,
        // What the reader can seek a person by (sought.js): their calling and who they are, never read by anyone but the planner and the rumor.
        calling: cutPoints(isRecord(raw.fields) ? raw.fields.Calling : '', 100),
        about: cutPoints(raw.about, 400),
        // What the entry says, not which version of the pack it came in: a bump with nothing changed is no change.
        sig: (({ pack: _pack, packVersion: _version, ...own }) => hashJson(own).slice(0, 12))(raw),
        raw,
    };
}

// ---- the pack's places ------------------------------------------------------------------------------------------------------------

const placeKey = value => keyOf(String(value ?? '').replace(/\s*\/\s*/g, ' / '));

/**
 * The pack's places as a matcher: `{ any, match(text) }`. A cast member's `start.place` is written as a place's name, its slug or one of
 * its aliases (any case); `match` gives the place's own name, or null when none fits. `any`: the packs list places at all (when they do
 * not, nothing can be said against a place as written).
 */
export function placeMatcher(query) {
    const list = ask(query, 'packs.content', { kind: 'places' }, null);
    const byKey = new Map();
    for (const place of Array.isArray(list) ? list : []) {
        if (!isRecord(place) || typeof place.name !== 'string') continue;
        const name = cutPoints(place.name, MAX_PLACE);
        const slug = typeof place.id === 'string' ? place.id.slice(place.id.lastIndexOf('/') + 1) : typeof place.slug === 'string' ? place.slug : '';
        for (const word of [name, slug, ...(Array.isArray(place.aliases) ? place.aliases : [])]) {
            const key = placeKey(word);
            if (key && !byKey.has(key)) byKey.set(key, name);
        }
    }
    return { any: byKey.size > 0, match: text => byKey.get(placeKey(text)) ?? null };
}

/**
 * The cast the enabled packs list: `{ listed, entries, byKey, packs }`. `listed`: whether the packs could be asked at all (a missing
 * or throwing query is no answer: nobody is dropped on silence). `entries`: in the packs' order, a key once. `packs`: the enabled
 * packs, `{ id: { name, version } }` (from the entries, and `packs.list` when it answers); `enabled`: their ids (a disabled pack is
 * not in it, so its people are kept as they are, hidden, until it is enabled again).
 */
export function castOf(query) {
    const out = { listed: false, entries: [], byKey: new Map(), packs: {}, enabled: new Set(), places: { any: false, match: () => null } };
    const list = ask(query, 'packs.content', { kind: 'cast' }, null);
    if (!Array.isArray(list)) return out;
    out.listed = true;
    for (const raw of list) {
        const entry = readEntry(raw);
        if (!entry || out.byKey.has(entry.key) || out.entries.length >= MAX_PEOPLE) continue;
        out.entries.push(entry);
        out.byKey.set(entry.key, entry);
        out.packs[entry.pack] ??= { name: entry.pack, version: entry.ver };
        out.enabled.add(entry.pack);
    }
    // Where each person starts, as the pack's place (by name, slug or alias). A place the pack does not have leaves them unplaced ('') until the
    // planner places them; with no places to check against it stays as written.
    const places = placeMatcher(query);
    out.places = places;
    for (const entry of out.entries) entry.place = places.any ? places.match(entry.place) ?? '' : entry.place;
    const installed = ask(query, 'packs.list', {}, null);
    for (const pack of Array.isArray(installed) ? installed : []) {
        if (!isRecord(pack) || typeof pack.id !== 'string') continue;
        if (pack.enabled === false) continue;
        const name = shortName(cutPoints(pack.name, MAX_NAME));
        // The version the entries were listed at wins (they are the pack's own); the pack list's fills in where they give none.
        out.packs[pack.id] = { name: name || pack.id, version: out.packs[pack.id]?.version || cutPoints(pack.version, MAX_NAME) };
        out.enabled.add(pack.id);
    }
    return out;
}

/** A pack's name without a trailing parenthetical, as NPC State Delta writes it: "Ersveil (open world)" is "Ersveil". */
export const shortName = name => String(name ?? '').replace(/\s*\([^)]*\)\s*$/, '').trim() || String(name ?? '').trim();

/** The name a pack goes by in words ("Ersveil"): its listed name, else its id. */
export const packName = (cast, pack) => cast?.packs?.[pack]?.name || pack;

// ---- where the party is ------------------------------------------------------------------------------------------------

const normalize = value => flat(value).toLowerCase();

/** Whether two place names are the same place, the way v1 reads them: one holds the other (at least three letters). */
export function samePlace(a, b) {
    const one = normalize(a);
    const two = normalize(b);
    if (one.length < MIN_NAME || two.length < MIN_NAME) return false;
    return one === two || one.includes(two) || two.includes(one);
}

/** The place and region the party is in: `{ place, region }` (the atlas's, else Story Block's scene), '' for none. */
export function partyPlace(query, state) {
    const atlas = ask(query, 'atlas.here', {}, null);
    const scene = ask(query, 'scene.place', {}, null) ?? state?.domains?.scene?.place ?? null;
    return {
        place: cutPoints(flat(atlas?.name) || flat(scene?.name), MAX_PLACE),
        region: cutPoints(flat(atlas?.region) || flat(scene?.region), MAX_PLACE),
    };
}

/** Whether someone at `where` is at the party's place (or in its region). */
export const atParty = (where, party) => Boolean(where) && (samePlace(where, party?.place) || samePlace(where, party?.region));

/** The names of the people in the scene now (Story Block's present list, NPC State Delta's), as keys. */
export function presentKeys(query, state) {
    const out = new Set();
    const lists = [ask(query, 'scene.present', {}, null) ?? state?.domains?.scene?.present, ask(query, 'npc.present', {}, null)];
    for (const list of lists) {
        for (const entry of Array.isArray(list) ? list : []) {
            const key = keyOf(typeof entry === 'string' ? entry : entry?.name);
            if (key) out.add(key);
        }
    }
    return out;
}

/**
 * Everyone the reply's own scene lines (`+ present`, a place's `with`, its own safety-net lines) had in the scene at any point, as keys:
 * the added names and the list after each line. A previous reply's late lines (`assist: 'late'`) are not this reply's.
 */
export function seenKeys(receipts) {
    const out = new Set();
    for (const receipt of Array.isArray(receipts) ? receipts : []) {
        if (!receipt || receipt.type !== 'capture.present' || receipt.assist === 'late') continue;
        const data = receipt.data ?? {};
        for (const list of [data.added, data.present]) {
            for (const name of Array.isArray(list) ? list : []) {
                const key = keyOf(name);
                if (key) out.add(key);
            }
        }
    }
    return out;
}

// ---- the routine ----------------------------------------------------------------------------------------------------------

// The hours (from, to; a range may wrap midnight) each word of the day stands for. A routine that names none holds at any hour.
const PARTS = [
    [/\b(?:dawn|sunrise|daybreak|first light)\b/i, 4, 8],
    [/\b(?:morning|mornings|forenoon)\b/i, 6, 12],
    [/\b(?:noon|midday|lunchtime)\b/i, 11, 14],
    [/\b(?:afternoon|afternoons)\b/i, 12, 18],
    [/\b(?:dusk|sunset|twilight)\b/i, 17, 21],
    [/\b(?:evening|evenings|nightfall)\b/i, 17, 23],
    [/\b(?:night|nights|nightly|midnight|overnight|after dark)\b/i, 20, 5],
    [/\b(?:daytime|by day|during the day|day shift)\b/i, 6, 18],
];
const inRange = (hour, from, to) => (from <= to ? hour >= from && hour < to : hour >= from || hour < to);

/** The routine's hours: a list of [from, to] pairs, or null when it names no time of day. */
export function routineHours(routine) {
    const hours = PARTS.filter(([pattern]) => pattern.test(String(routine ?? ''))).map(([, from, to]) => [from, to]);
    return hours.length ? hours : null;
}

/**
 * Whether the routine has someone at their place at story minute `now`: true when it names no time of day, or the clock is not
 * set (nothing can be said against it), else when the hour is inside one of its ranges.
 */
export function routineHolds(routine, now) {
    const hours = routineHours(routine);
    if (!hours || !isInt(now)) return true;
    const hour = Math.floor((((now % DAY) + DAY) % DAY) / 60);
    return hours.some(([from, to]) => inRange(hour, from, to));
}


// ---- a fight ---------------------------------------------------------------------------------------------------------------

const ENDED = /^(?:ended|over|done|finished|won|lost|fled|resolved|closed|victory|defeat|escaped|surrendered)$/i;

/**
 * Whether a Lean RPG fight is open in `state`: a Foes block (a data module with the role `foes`) with a live slot: a name, a count above
 * 0 and health above 0. This is Story Block's own reading (lean-rpg/read.js `foesOf` + gate.js `fightLive`; it offers no query for it):
 * a slot is filled with a name and a count above 0, and live when its `hurt` (Classic: the stage index, Standard: the blocks left; a
 * whole number either way, a missing or other value reads 0) is above 0. A slot at 0 is Down; a block of Down groups only is a won fight.
 * The narrator never empties a slot, it only sets health, so the filled slot of a won fight stays.
 */
export function leanFight(state) {
    const domain = state?.domains?.dataModules;
    if (!isRecord(domain) || !isRecord(domain.active)) return false;
    for (const id of Object.keys(domain.active)) {
        const definition = domain.pins?.[domain.active[id]?.hash]?.definition;
        const fields = domain.instances?.[id]?.chat?.fields;
        if (!isRecord(definition) || definition.role !== 'foes' || !isRecord(fields)) continue;
        for (let slot = 1; slot <= 4; slot += 1) {
            if (typeof fields[`foe${slot}`] === 'string' && fields[`foe${slot}`].trim() && Number.isSafeInteger(fields[`count${slot}`]) && fields[`count${slot}`] > 0
                && Number.isSafeInteger(fields[`hurt${slot}`]) && fields[`hurt${slot}`] > 0) return true;
        }
    }
    return false;
}

/**
 * Whether a fight is on now: a module that runs fights answers `combat.session` with a session that has not ended, or the Lean RPG has a
 * live foe on its Foes block (`state`, and `leanOn`: its feature is on).
 */
export function fightOn(query, state = null, { leanOn = true } = {}) {
    const session = ask(query, 'combat.session', {}, null);
    if (isRecord(session) && !ENDED.test(typeof session.status === 'string' ? session.status.trim() : '')) return true;
    return leanOn && leanFight(state);
}
