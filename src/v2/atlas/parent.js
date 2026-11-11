// Story Director v2, atlas part: a place's parent and its coordinates (pure).
//
// A place the story names as part of another ("Auvoth (Southern Gatehouse)", "Auvoth / Pale Market", "Pale Market in Auvoth",
// "Bluewatch Watchhouse") sits in that parent. parentOf reads the parent from the name; the parent resolves through the joined
// world (worldOf's `{ places, find }`), and the caller creates it when it does not. childOffset gives a child a small fixed offset
// from its parent (the angle from a hash of the child's key, so the same on every read and replay). regionAnchor gives a place with
// no parent the middle of the placed places of its region. placeLine writes "Town · Spot". settlePlace and tidyPlaces are the two
// writers: they save `parent` and x/y on atlas places (the caller's ensurePlace makes a missing parent). Nothing reads
// a clock or a random source. The caller keeps a pack place as it is: parentOf splits any name it is given.

import { childOffset, keyOf, orderedPlaces, revOf, round3 as round } from './domain.js';
import { packPlace, worldOf } from './world.js';

export { childOffset };

// The name as the atlas keeps it: trimmed, inner spaces once.
const tidy = value => String(value ?? '').trim().replace(/\s+/g, ' ');
// Words that join a spot to a town ("Pale Market in Auvoth").
const JOINER = /^(in|at|of)$/i;
// Words that only say what a place is ("(settlement)", "(village, region)"): a bracket of them describes the place, it names no parent.
const KIND_WORD = /^(?:settlement|village|town|city|hamlet|district|region|ward|quarter|area|outskirts|province|county|realm|capital|farm|homestead|camp|outpost)$/i;

/**
 * The parent of a place name, or null. `world`: worldOf's `{ places, find }` (`find` takes a name, an alias or an id).
 * Rules, the first that gives a parent wins: "X / Y", "X (Y)", "Y in|at|of X" (X must resolve), and a name that starts with a known
 * place name and a space (the longest whole-word prefix; an alias works). In "X / Y" and "X (Y)" the first part is the parent, unless
 * only the second resolves ("Guild Office / Bluewatch Village", "Lime-Shed (Salt-and-Ash Yard)"): then the second is; a parent no part
 * resolves to is made from the first. A bracket with a comma or only kind words ("(settlement, Bluewatch)") describes the place and
 * is left out; the in- and prefix rules read the name without it. A known place with no parent of its own
 * (a name `find` answers to, without a `parent` field) is not split by the prefix rule, so "Bluewatch Village" stays whole.
 * Returns `{ text, part, parent, rule }`: `text` the parent's name (the world's when it resolves, else as written), `part` the
 * child's own part, `parent` the resolved place or null, `rule` 'slash' | 'paren' | 'in' | 'prefix'.
 */
export function parentOf(name, world) {
    const full = tidy(name);
    if (!keyOf(full) || typeof world?.find !== 'function') return null;
    const paren = full.match(/^(.+?)\s*\(([^()]+)\)$/);
    const note = Boolean(paren) && (paren[2].includes(',') || paren[2].trim().split(/\s+/).every(word => KIND_WORD.test(word)));
    const text = note ? tidy(paren[1]) : full;
    const words = text.split(' ');
    const self = world.find(full) ?? world.find(text);
    // Each candidate: the parent's text and place (null when it does not resolve), the child's part, the rule, and whether the parent must resolve.
    const candidates = [];
    const pair = (outer, inner, rule) => {
        const first = world.find(outer) ?? null;
        const second = world.find(inner) ?? null;
        const swap = !first && second;
        candidates.push({ parentText: swap ? inner : outer, part: swap ? outer : inner, parent: swap ? second : first, rule, mustResolve: false });
    };
    const slash = text.match(/^(.+?) \/ (.+)$/);
    if (slash) pair(slash[1], slash[2], 'slash');
    if (paren && !note) pair(paren[1], paren[2], 'paren');
    for (let at = 1; at < words.length - 1; at++) {
        if (!JOINER.test(words[at])) continue;
        const parentText = words.slice(at + 1).join(' ');
        candidates.push({ parentText, part: words.slice(0, at).join(' '), parent: world.find(parentText) ?? null, rule: 'in', mustResolve: true });
    }
    if (!(self && !self.parent)) {
        for (let count = words.length - 1; count >= 1; count--) {
            const parentText = words.slice(0, count).join(' ');
            candidates.push({ parentText, part: words.slice(count).join(' '), parent: world.find(parentText) ?? null, rule: 'prefix', mustResolve: true });
        }
    }
    for (const candidate of candidates) {
        if (candidate.mustResolve && !candidate.parent) continue;
        if (!keyOf(candidate.parentText) || !keyOf(candidate.part) || keyOf(candidate.parentText) === keyOf(candidate.part)) continue;
        return { text: candidate.parent?.name ?? tidy(candidate.parentText), part: tidy(candidate.part), parent: candidate.parent, rule: candidate.rule };
    }
    return null;
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
 * place has no parent ("Auvoth"). `place`: `{ name, parent? }` (a saved `parent` id wins over the name's); `world`: as for parentOf.
 */
export function placeLine(place, world) {
    const name = tidy(place?.name);
    const found = parentOf(name, world);
    const saved = place?.parent && typeof world?.find === 'function' ? world.find(place.parent) : null;
    if (saved && saved.id !== place.id) return `${saved.name} · ${found?.parent?.id === saved.id ? found.part : name}`;
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
 * Gives the atlas place `place` its `parent` and saved coordinates (rules 1 and 2): a parent from its saved `parent` or its name (made
 * with `ensure`, the caller's ensurePlace, when the story named a parent the map lacks) and the parent's point plus the child's fixed
 * offset; with no parent the region's middle, else the previous place, else nothing. A parent with no point is placed first. Coordinates
 * it gives are marked `auto` (a pack's win over them, a reader's edit clears the mark). Leaves a pack place and a place that has
 * coordinates as it is. `canMake`: whether the atlas has room for one more place. Returns whether anything changed.
 */
export function settlePlace(atlas, ctx, pack, place, { ensure, canMake = true, seen = new Set() } = {}) {
    if (!place || place.x !== undefined || packPlace(pack, place.name) || seen.has(place.id)) return false;
    seen.add(place.id);
    const world = worldOf(atlas, pack);
    const apart = { find: ref => { const found = world.find(ref); return found?.id === place.id ? null : found; } };
    const saved = place.parent ? apart.find(place.parent) : null;
    const found = saved ? { parent: saved, text: saved.name } : parentOf(place.name, apart);
    if (found && (found.parent || canMake)) {
        let own = found.parent?.atlasId ? atlas.places[found.parent.atlasId] : null;
        if (!own) {
            const made = ensure(atlas, ctx, pack, found.parent?.name ?? found.text, { discovered: false, region: place.region });
            own = made.place;
            const spot = made.created && !found.parent ? looseSpot(atlas, worldOf(atlas, pack), own) : null;
            if (spot) Object.assign(own, spot, { auto: true });
        } else if (!pointOf(world.find(own.id))) settlePlace(atlas, ctx, pack, own, { ensure, canMake, seen });
        const point = pointOf(worldOf(atlas, pack).find(own.id));
        place.parent = own.id;
        // A place inside a town is in the town's region (the map shows it on the same layer).
        if (!place.region) place.region = found.parent?.region || own.region || '';
        if (point) Object.assign(place, around(point, keyOf(place.name)), { auto: true });
        place.rev = revOf(ctx);
        return true;
    }
    const spot = looseSpot(atlas, world, place);
    if (!spot) return false;
    Object.assign(place, spot, { auto: true });
    place.rev = revOf(ctx);
    return true;
}

/**
 * "Tidy the map": settlePlace for each visited atlas place that has no coordinates, a parent before its children. Returns how many got
 * coordinates (a place that only learns its parent is not counted: nothing can be drawn for it yet).
 */
export function tidyPlaces(atlas, ctx, pack, options) {
    const seen = new Set();
    let count = 0;
    for (const own of orderedPlaces(atlas)) {
        const place = atlas.places[own.id];
        if (!place?.discovered || place.x !== undefined) continue;
        if (settlePlace(atlas, ctx, pack, place, { ...options, seen }) && place.x !== undefined) count += 1;
    }
    return count;
}
