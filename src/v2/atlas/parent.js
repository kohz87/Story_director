// Story Director v2, atlas part: a place's parent and its coordinates (pure).
//
// A place the story names as part of another ("Auvoth (Southern Gatehouse)", "Auvoth / Pale Market", "Pale Market in Auvoth",
// "Bluewatch Watchhouse") sits in that parent. parentOf reads the parent from the name; the parent resolves through the joined
// world (worldOf's `{ places, find }`), and the caller creates it when it does not. childOffset gives a child a small fixed offset
// from its parent (the angle from a hash of the child's key, so the same on every read and replay). regionAnchor gives a place with
// no parent the middle of the placed places of its region. placeLine writes "Town · Spot". settlePlace and tidyPlaces are the two
// writers: they save `parent` and x/y on atlas places (the caller's ensurePlace makes a missing parent). Nothing reads
// a clock or a random source. The caller keeps a pack place as it is: parentOf splits any name it is given.

import { keyOf, orderedPlaces, revOf } from './domain.js';
import { packPlace, worldOf } from './world.js';

// A rounded number: coordinates stay the same across engines and reads.
const round = value => Math.round(value * 1000) / 1000;
// The name as the atlas keeps it: trimmed, inner spaces once.
const tidy = value => String(value ?? '').trim().replace(/\s+/g, ' ');
// Words that join a spot to a town ("Pale Market in Auvoth").
const JOINER = /^(in|at|of)$/i;
// A child's ring: radius 0.3, 0.4 or 0.5 units around its parent (the pack's districts sit a few tenths apart).
const RING_BASE = 0.3;
const RING_STEPS = 3;
const RING_STEP = 0.1;

/**
 * The parent of a place name, or null. `world`: worldOf's `{ places, find }` (`find` takes a name, an alias or an id).
 * Rules, the first that gives a parent wins: "X / Y", "X (Y)", "Y in|at|of X" (X must resolve), and a name that starts with a known
 * place name and a space (the longest whole-word prefix; an alias works). A known place with no parent of its own
 * (a name `find` answers to, without a `parent` field) is not split by the prefix rule, so "Bluewatch Village" stays whole.
 * Returns `{ text, part, parent, rule }`: `text` the parent's name (the world's when it resolves, else as written), `part` the
 * child's own part, `parent` the resolved place or null, `rule` 'slash' | 'paren' | 'in' | 'prefix'.
 */
export function parentOf(name, world) {
    const text = tidy(name);
    if (!keyOf(text) || typeof world?.find !== 'function') return null;
    const words = text.split(' ');
    const self = world.find(text);
    // Each candidate: the parent's text, the child's part, the rule, and whether the parent must resolve.
    const candidates = [];
    const slash = text.match(/^(.+?) \/ (.+)$/);
    if (slash) candidates.push({ parentText: slash[1], part: slash[2], rule: 'slash', mustResolve: false });
    const paren = text.match(/^(.+?)\s*\(([^()]+)\)$/);
    if (paren) candidates.push({ parentText: paren[1], part: paren[2], rule: 'paren', mustResolve: false });
    for (let at = 1; at < words.length - 1; at++) {
        if (JOINER.test(words[at])) candidates.push({ parentText: words.slice(at + 1).join(' '), part: words.slice(0, at).join(' '), rule: 'in', mustResolve: true });
    }
    if (!(self && !self.parent)) {
        for (let count = words.length - 1; count >= 1; count--) {
            candidates.push({ parentText: words.slice(0, count).join(' '), part: words.slice(count).join(' '), rule: 'prefix', mustResolve: true });
        }
    }
    for (const candidate of candidates) {
        const parent = world.find(candidate.parentText) ?? null;
        if (candidate.mustResolve && !parent) continue;
        if (!keyOf(candidate.parentText) || !keyOf(candidate.part) || keyOf(candidate.parentText) === keyOf(candidate.part)) continue;
        return { text: parent?.name ?? candidate.parentText, part: tidy(candidate.part), parent, rule: candidate.rule };
    }
    return null;
}

/**
 * The offset `{ dx, dy }` of a child from its parent's point, for the child's key (`keyOf` of its name). Deterministic: FNV-1a of the
 * key picks the angle and the ring (0.3, 0.4 or 0.5 units). Same key, same offset, on every read and replay.
 */
export function childOffset(key) {
    let hash = 0x811c9dc5;
    for (const char of String(key ?? '')) {
        hash ^= char.codePointAt(0);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    const angle = (hash / 4294967296) * 2 * Math.PI;
    const radius = RING_BASE + ((hash >>> 8) % RING_STEPS) * RING_STEP;
    return { dx: round(Math.cos(angle) * radius), dy: round(Math.sin(angle) * radius) };
}

/**
 * The middle `{ x, y }` of the placed places (finite x and y) whose region is `region` (compared by key), or null when there are none.
 * `places`: `[{ region, x, y }]`. The caller falls back to the last scene place, then to no coordinates.
 */
export function regionAnchor(places, region) {
    const want = keyOf(region);
    if (!want) return null;
    const placed = (Array.isArray(places) ? places : []).filter(place => keyOf(place?.region) === want && Number.isFinite(place.x) && Number.isFinite(place.y));
    if (!placed.length) return null;
    const sum = placed.reduce((acc, place) => ({ x: acc.x + place.x, y: acc.y + place.y }), { x: 0, y: 0 });
    return { x: round(sum.x / placed.length), y: round(sum.y / placed.length) };
}

/**
 * The place line "Town · Spot": the parent's name, then the child's own part ("Auvoth · Southern Gatehouse"). The town alone when the
 * place has no parent ("Auvoth"). `place`: `{ name }`; `world`: as for parentOf.
 */
export function placeLine(place, world) {
    const name = tidy(place?.name);
    const found = parentOf(name, world);
    return found ? `${found.text} · ${found.part}` : name;
}

const pointOf = place => (Number.isFinite(place?.x) && Number.isFinite(place?.y) ? { x: place.x, y: place.y } : null);
const around = (anchor, key) => {
    const { dx, dy } = childOffset(key);
    return { x: round(anchor.x + dx), y: round(anchor.y + dy) };
};

// The newest visited place that has a point (the scene's place before this one), or null; ties go to the later one.
function previousPlace(atlas, world, skip) {
    let best = null;
    for (const own of orderedPlaces(atlas)) {
        const seen = world.find(own.id);
        if (own.id === skip || !own.discovered || !pointOf(seen)) continue;
        if (!best || own.rev >= best.rev) best = { rev: own.rev, point: pointOf(seen) };
    }
    return best?.point ?? null;
}

// Rule 2 without a parent: the middle of the placed places of the region, else next to the previous place, else null.
function looseSpot(atlas, world, place) {
    const others = world.places.filter(other => other.id !== place.id && !other.hidden);
    const anchor = regionAnchor(others, place.region) ?? previousPlace(atlas, world, place.id);
    return anchor ? around(anchor, keyOf(place.name)) : null;
}

/**
 * Gives the atlas place `place` its `parent` and saved coordinates (rules 1 and 2): a parent from its name (made with `ensure`, the
 * caller's ensurePlace, when the story named a parent the map lacks) and the parent's point plus the child's fixed offset; with no
 * parent the region's middle, else the previous place, else nothing. Leaves a pack place, a place with coordinates or a parent, as
 * it is. `canMake`: whether the atlas has room for one more place. Returns whether anything changed.
 */
export function settlePlace(atlas, ctx, pack, place, { ensure, canMake = true } = {}) {
    if (!place || place.x !== undefined || place.parent !== undefined || packPlace(pack, place.name)) return false;
    const world = worldOf(atlas, pack);
    const apart = { find: ref => { const found = world.find(ref); return found?.id === place.id ? null : found; } };
    const found = parentOf(place.name, apart);
    const host = found?.parent ?? null;
    if (found && (host || canMake)) {
        let own = host?.atlasId ? atlas.places[host.atlasId] : null;
        let point = pointOf(host);
        if (!own) {
            const made = ensure(atlas, ctx, pack, host?.name ?? found.text, { discovered: false, region: place.region });
            own = made.place;
            if (made.created && !host) {
                point = looseSpot(atlas, worldOf(atlas, pack), own);
                if (point) Object.assign(own, point);
            }
            point ??= pointOf(own);
        }
        place.parent = own.id;
        // A place inside a town is in the town's region (the map shows it on the same layer).
        if (!place.region) place.region = host?.region || own.region || '';
        if (point) Object.assign(place, around(point, keyOf(place.name)));
        return true;
    }
    const spot = looseSpot(atlas, world, place);
    if (!spot) return false;
    Object.assign(place, spot);
    return true;
}

/** "Tidy the map": settlePlace for each visited atlas place that has no coordinates and no parent. Returns how many changed. */
export function tidyPlaces(atlas, ctx, pack, options) {
    let count = 0;
    for (const own of orderedPlaces(atlas)) {
        const place = atlas.places[own.id];
        if (!place?.discovered || !settlePlace(atlas, ctx, pack, place, options)) continue;
        place.rev = revOf(ctx);
        count += 1;
    }
    return count;
}
