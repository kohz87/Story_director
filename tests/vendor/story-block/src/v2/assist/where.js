// Where and when, for the Assist safety net (the after-reply extractor): what it is told about the scene's place and the
// story's date and time, and the two checks code makes on its answer. The extractor model tends to invent a name for a place
// the map already has ("Bluewatch Guild Branch" for "Bluewatch Village / Guild Office") and to write a time of day in words
// ("midday", "mid-morning") that no clock reads. So it is given the current place, the known names near it and the story's
// date and time, and told to use a known name and a clock time; code then refuses a `place` line whose name is not a known
// one but plainly means a place the map has, and a `time` line that sets a time without a clock time. A refusal is reported
// as a Problems line on the reply (turn.js captureAssist), never applied. Pure: no DOM, no state.

import { readChatter } from '../extras.js';

// How many known place names the extractor is told (the nearest first), and the longest name told.
export const MAX_NEAR = 20;
export const NAME_CHARS = 80;

const fold = text => String(text ?? '').normalize('NFKC').replace(/['’‘`]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const clip = (text, max) => { const chars = [...String(text ?? '').replace(/\s+/g, ' ').trim()]; return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : chars.join(''); };
const number = value => (typeof value === 'number' && Number.isFinite(value) ? value : null);

// Words that say what kind of place it is, not which: two names sharing only these are two places.
const GENERIC = new Set(['the', 'of', 'and', 'at', 'in', 'on', 'to', 'for', 'old', 'new', 'north', 'south', 'east', 'west', 'upper', 'lower',
    'great', 'little', 'high', 'low', 'village', 'town', 'city', 'road', 'street', 'lane', 'inn', 'tavern', 'house', 'hall', 'gate', 'bridge',
    'market', 'square', 'camp', 'fort', 'tower', 'keep', 'temple', 'church', 'shop', 'store', 'guild', 'office', 'branch', 'room', 'yard',
    'district', 'quarter', 'forest', 'river', 'lake', 'hill', 'hills', 'mountain', 'pass', 'path', 'trail', 'farm', 'mill', 'harbor', 'harbour']);
const tokens = text => fold(text).split(/[^\p{L}\p{N}]+/u).filter(word => word.length >= 3);
const words = text => tokens(text).filter(word => !GENERIC.has(word));

/**
 * The places the map has, read from queries' rows (`{ name, aliases?, region?, x?, y? }`; the atlas's and the packs'), as a
 * list without repeats (by name, case and apostrophes ignored): `[{ name, aliases, region, x, y }]`.
 */
export function mapPlaces(...lists) {
    const seen = new Map();
    for (const list of lists) {
        for (const row of Array.isArray(list) ? list : []) {
            const name = typeof row?.name === 'string' ? row.name.replace(/\s+/g, ' ').trim() : '';
            if (!name || seen.has(fold(name))) continue;
            const aliases = (Array.isArray(row.aliases) ? row.aliases : []).filter(alias => typeof alias === 'string' && alias.trim()).map(alias => alias.trim());
            seen.set(fold(name), { name, aliases, region: typeof row.region === 'string' ? row.region.trim() : '', x: number(row.x), y: number(row.y) });
        }
    }
    return [...seen.values()];
}

// Every spelling the map answers to for one place: its name and aliases, then each side of "Village / Spot".
const whole = place => new Set([place.name, ...place.aliases].map(fold));
const sides = place => new Set([place.name, ...place.aliases].flatMap(text => String(text).split(/\s[\/|]\s|\s—\s/)).map(fold).filter(Boolean));

/** The place of `places` a name means exactly (its name or an alias first, then a side of "A / B"), or null. */
export function knownPlace(places, name) {
    const key = fold(name);
    if (!key) return null;
    return places.find(place => whole(place).has(key)) ?? places.find(place => sides(place).has(key)) ?? null;
}

/**
 * What the extractor is told: `{ here, near, time }`. `here`: the scene's place `{ name, kind, region }` (or null); `near`:
 * the map's place names, those nearest the scene's place first (by the map's coordinates when both have them, else the ones
 * in its region, else the map's order), at most `cap`, never the place itself; `time`: the story's date and time as text.
 */
export function whereNow({ here = null, places = [], time = '' } = {}, { cap = MAX_NEAR } = {}) {
    const name = typeof here?.name === 'string' ? here.name.trim() : '';
    const mine = name ? knownPlace(places, name) : null;
    const region = fold(here?.region || mine?.region || '');
    const distance = place => (mine && mine.x !== null && mine.y !== null && place.x !== null && place.y !== null ? Math.hypot(place.x - mine.x, place.y - mine.y) : Infinity);
    const ranked = places.filter(place => place !== mine && fold(place.name) !== fold(name))
        .map((place, at) => ({ place, at, far: distance(place), same: region && fold(place.region) === region ? 0 : 1 }))
        .sort((a, b) => (a.far - b.far) || (a.same - b.same) || (a.at - b.at));
    return {
        here: name ? { name: clip(name, NAME_CHARS), kind: clip(here?.kind, 40), region: clip(here?.region, NAME_CHARS) } : null,
        near: ranked.slice(0, Math.max(0, cap)).map(item => clip(item.place.name, NAME_CHARS)),
        time: clip(time, 80),
    };
}

// How many open world events and factions the extractor is told, and the longest stance told.
export const MAX_WORLD = 10;
export const STANCE_CHARS = 40;

/**
 * The world the Chronicle already holds, for the safety net's world and faction lines: `{ events, factions }`; the names of
 * the open world events (query rows `{ name }`) and the factions with their stance (`{ name, stance }`), each at most `cap`, names clipped.
 */
export function worldKnown(world, { cap = MAX_WORLD } = {}) {
    const { events = [], factions = [] } = world ?? {};
    const rows = (list, make) => (Array.isArray(list) ? list : []).filter(row => typeof row?.name === 'string' && row.name.trim()).slice(0, Math.max(0, cap)).map(make);
    return {
        events: rows(events, row => clip(row.name, NAME_CHARS)),
        factions: rows(factions, row => ({ name: clip(row.name, NAME_CHARS), stance: clip(row.stance, STANCE_CHARS) })),
    };
}

/** The lines that tell the extractor where and when the scene is (none when nothing is known). */
export function whereLines(around) {
    if (!around) return [];
    const lines = [];
    if (around.time) lines.push(`Story date and time now: ${around.time}`);
    if (around.here) lines.push(`Place now: ${around.here.name}${around.here.kind || around.here.region ? ` (${[around.here.kind, around.here.region].filter(Boolean).join(', ')})` : ''}`);
    if (around.near?.length) lines.push(`Known places near it (use these exact names): ${around.near.join('; ')}`);
    if (around.events?.length) lines.push(`Open world events the story already keeps (to update one, write ~ world with its exact name): ${around.events.join('; ')}`);
    if (around.factions?.length) lines.push(`Factions the story already keeps, with stance (never write a stance for one): ${around.factions.map(item => (item.stance ? `${item.name} (${item.stance})` : item.name)).join('; ')}`);
    return lines;
}

// A clock time written with digits: 9:30, 09:30 am, 9 pm, 21:05.
// (9.30 am too, and the two words that name one exact time: noon and midnight.)
const CLOCK = /(?<![\p{L}\d:.])(?:(?:[01]?\d|2[0-3])[:.][0-5]\d|(?:1[0-2]|0?[1-9])\s?[ap]\.?m\.?|noon|midnight)(?![\p{L}\d])/iu;
// A stretch of time moving the clock on: +2h, 30 minutes, an hour, half an hour.
const STRETCH = /^\+?\s*(?:\d+(?:\.\d+)?|an?|half(?:\s+an?)?|one)\s*(?:minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w)\b/i;

/** Whether `text` holds a clock time (9:30 am, 21:05, 9 pm). */
export const hasClockTime = text => CLOCK.test(String(text ?? ''));

/**
 * Why `line` (parsed: { op, kind, name, text }) may not run as a safety-net line, or '': a `time` line that sets the time of
 * day needs a clock time ("midday", "mid-morning" are not times; "+2h" moves it on and needs none); a `place` line whose name is
 * not one the map answers to but is made only of words one of the map's places has (apart from words like "village" and "guild")
 * is the same place under an invented name.
 * `places` (mapPlaces) may be empty: then only the time is checked. `here`: the scene's place name, always a known name.
 */
export function whereWhy(line, { places = [], here = '' } = {}) {
    const kind = String(line?.kind ?? '').toLowerCase();
    if (kind === 'time' && ['~', '!', '+'].includes(line?.op)) {
        const said = [line?.name, line?.text].filter(part => typeof part === 'string' && part.trim()).join(' ').trim();
        if (STRETCH.test(said) || hasClockTime(said)) return '';
        return `"${clip(said, 60) || 'time'}" has no clock time; write a time like "~ time Goldwane 12, 9:30 am" or "! time +2h" ("midday" and "mid-morning" are not times)`;
    }
    if (kind === 'place' && places.length) {
        const name = String(line?.name ?? '').replace(/\s+/g, ' ').trim();
        if (!name || fold(name) === fold(here) || knownPlace(places, name)) return '';
        // The same place under another name: every distinctive word of the name is one the map's place has too ("Bluewatch Guild
        // Branch" for "Bluewatch Village / Guild Office"). A name with a word of its own ("Auvoth Docks" beside "Auvoth") is a new place.
        const mine = words(name);
        if (mine.length) {
            // (the one that shares the most of the name's words, even the plain ones, and then the shortest name)
            const theirs = place => new Set([place.name, ...place.aliases].flatMap(tokens));
            const shares = place => { const set = theirs(place); return tokens(name).filter(word => set.has(word)).length; };
            // Not when it shares only one word with it and says more ("Silver Lake" beside "Silver Mine" is another place; "Bluewatch"
            // alone is still "Bluewatch Village"), nor when it holds the
            // place's whole name or a side of it and says more ("Silver Mine Road", "Kestrel Pass Outpost": a spot at or by it).
            const phrase = text => ` ${tokens(text).join(' ')} `;
            const holds = place => [...sides(place), ...whole(place)].some(side => tokens(side).length && phrase(name).includes(phrase(side)));
            const found = places.filter(place => { const set = new Set([place.name, ...place.aliases].flatMap(words)); return mine.every(word => set.has(word)); })
                .filter(place => { const set = theirs(place); return (shares(place) >= 2 || tokens(name).every(word => set.has(word))) && !holds(place); })
                .sort((a, b) => (shares(b) - shares(a)) || (a.name.length - b.name.length))[0];
            if (found) return `"${clip(name, 60)}" is not a place name on the map; the map calls this place "${clip(found.name, NAME_CHARS)}"`;
        }
    }
    return '';
}

// A safety-net move is refused only on evidence against the proposed place: the reply's own `+ present ... | at: Place` locates an
// arrival somewhere else. A bare `+ present` or chatter names no place (and `with:` need not list people already at the destination),
// so neither refuses a move. Two places agree when they are the same, one holds the other ("Village" and "Village / Office"),
// or they end in the same spot; siblings ("Village / Market", "Village / Office") do not. Map aliases resolve through `places`.
export function assistPlaceConflict(line, own = [], places = []) {
    if (line?.kind !== 'place' || !['~', '+'].includes(line.op)) return '';
    const arrivals = new Map();
    for (const item of own) {
        if (item.kind !== 'present' || !['+', '-'].includes(item.op)) continue;
        for (const name of String(item.name ?? '').split(',').map(name => name.trim()).filter(Boolean)) {
            if (item.op === '-') arrivals.delete(fold(name));
            else arrivals.set(fold(name), { name, place: item.labels?.place ?? item.labels?.at ?? item.labels?.where ?? '' });
        }
    }
    const map = mapPlaces(places);
    const path = text => String(knownPlace(map, text)?.name ?? text).split(/\s[\/|]\s|\s—\s/).map(fold).filter(Boolean);
    const agree = (a, b) => {
        const [short, long] = a.length <= b.length ? [a, b] : [b, a];
        return short.length > 0 && (short.every((part, at) => part === long[at]) || a.at(-1) === b.at(-1));
    };
    const destination = path(line.name);
    for (const { name, place } of arrivals.values()) {
        if (place && !agree(path(place), destination)) return `the reply places ${name} at ${place}`;
    }
    return '';
}

// Explicit departures already read for this reply win over an Assist place's companion list, including
// people who were already absent. A later explicit arrival cancels the departure.
export function assistDepartures(receipts = []) {
    const left = new Set();
    for (const receipt of receipts) {
        if (receipt?.type !== 'capture.present') continue;
        for (const name of [...(receipt.data?.removed ?? []), ...(receipt.data?.missing ?? [])]) left.add(name.toLowerCase());
        for (const name of receipt.data?.added ?? []) left.delete(name.toLowerCase());
    }
    return [...left];
}
