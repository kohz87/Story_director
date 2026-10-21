// Story Director v2, quests part: how far a quest is, and whether it can be turned in here.
// Pure. The evidence comes through `sources` (other modules' queries: RPG Battle's
// `combat.foesBeaten`, Story Block's `inventory.items`), so the same rules serve a command
// (through ctx.query), the `quest.progress` query and the tab (through view.query).

import { nameMatches, nounFor } from './parse.js';

const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();

/** Runs a query, or gives `fallback` when it is not registered or fails (its module is off). */
export function tryQuery(query, name, args, fallback = undefined) {
    if (typeof query !== 'function') return fallback;
    try {
        const value = query(name, args);
        return value === undefined ? fallback : value;
    } catch {
        return fallback;
    }
}

/** Foes beaten after `sinceRev`, flattened to `[{ name, count }]`; null when no fights module answers. */
function foesSince(query, sinceRev) {
    const list = tryQuery(query, 'combat.foesBeaten', { sinceRev }, null);
    if (!Array.isArray(list)) return null;
    // Either beaten entries `{ rev, foes: [{ name, count }], won }` (MODULES §B3) or foes already flat.
    return list.flatMap(entry => {
        if (Array.isArray(entry?.foes)) {
            if (entry.won === false) return [];
            if (Number.isInteger(entry.rev) && Number.isInteger(sinceRev) && entry.rev <= sinceRev) return [];
            return entry.foes;
        }
        return [entry];
    }).map(foe => ({ name: text(foe?.name), count: Number.isSafeInteger(foe?.count) && foe.count > 0 ? foe.count : 1 }))
        .filter(foe => foe.name);
}

/** Stacks `[{ stack, name, qty }]` the party holds; null when no inventory answers. */
function stacksHeld(query) {
    const list = tryQuery(query, 'inventory.items', {}, null);
    if (!Array.isArray(list)) return null;
    return list.map(item => ({
        stack: text(item?.stack ?? item?.id),
        name: text(item?.name ?? item?.def?.name),
        qty: Number.isSafeInteger(item?.qty) && item.qty > 0 ? item.qty : 0,
    })).filter(item => item.name && item.qty > 0)
        .sort((a, b) => (a.stack < b.stack ? -1 : a.stack > b.stack ? 1 : 0));
}

/**
 * A `query(name, args)` over a bare State, for the `quest.progress` query when the host gives a
 * query no way to call other queries: it reads the documented layouts (MODULES §B3 `combat.beaten`,
 * SPEC §7 `inventory.stacks`/`defs`) read-only.
 */
export function stateQuery(state) {
    const domains = state?.domains ?? {};
    return (name, args = {}) => {
        if (name === 'combat.foesBeaten') {
            const beaten = domains.combat?.beaten;
            if (!Array.isArray(beaten)) throw new Error('no combat');
            return beaten.filter(entry => !Number.isInteger(args.sinceRev) || entry.rev > args.sinceRev);
        }
        if (name === 'inventory.items') {
            const inventory = domains.inventory;
            if (!inventory?.stacks) throw new Error('no inventory');
            return Object.values(inventory.stacks).map(stack => ({ ...stack, name: inventory.defs?.[stack.def]?.name ?? '' }));
        }
        throw new Error(`unknown query ${name}`);
    };
}

/**
 * Progress of a quest thread: `{ have, need, met, source, noun, reason, stacks }`.
 * `source` is 'fights' or 'inventory' (null without a target). Fights count only after
 * `taken.rev`; a quest never taken on here counts none (its fights could predate it).
 * `stacks` (items only) lists what a turn-in would hand over, in order.
 */
export function progressOf(thread, query) {
    const target = thread?.target;
    if (!target) return { have: 0, need: 0, met: false, source: null, noun: '', reason: 'No target code can count; the story decides when it is done.' };
    const need = target.count;
    const noun = target.noun;
    if (target.kind === 'items') {
        const held = stacksHeld(query);
        if (!held) return { have: 0, need, met: false, source: 'inventory', noun, reason: 'The inventory is not available.' };
        const matching = held.filter(item => nameMatches(noun, item.name));
        const have = matching.reduce((sum, item) => sum + item.qty, 0);
        const met = have >= need;
        return { have, need, met, source: 'inventory', noun, reason: met ? '' : `Need ${need - have} more ${nounFor(target, need - have)}.`, stacks: matching };
    }
    if (!thread.taken) return { have: 0, need, met: false, source: 'fights', noun, reason: 'Fights count from when it is taken on.' };
    const foes = foesSince(query, thread.taken.rev);
    if (!foes) return { have: 0, need, met: false, source: 'fights', noun, reason: 'No battle record (RPG Battle is not running).' };
    const have = foes.filter(foe => nameMatches(noun, foe.name)).reduce((sum, foe) => sum + foe.count, 0);
    const met = have >= need;
    return { have, need, met, source: 'fights', noun, reason: met ? '' : `Need ${need - have} more ${nounFor(target, need - have)}.` };
}

/** "Wolves 8/3". */
export function progressLabel(thread, progress) {
    if (!thread?.target) return '';
    const noun = nounFor(thread.target, 2);
    return `${noun.replace(/^./, c => c.toUpperCase())} ${progress.have}/${progress.need}`;
}

const nameWords = name => text(name).toLowerCase().split(/[^\p{L}\p{N}'-]+/u).filter(Boolean);
function samePersonName(a, b) {
    const x = nameWords(a);
    const y = nameWords(b);
    if (!x.length || !y.length) return false;
    const [short, long] = x.length <= y.length ? [x, y] : [y, x];
    for (let start = 0; start + short.length <= long.length; start += 1) {
        if (short.every((word, i) => long[start + i] === word)) return true;
    }
    return false;
}

/**
 * The place rule for a turn-in: in a settlement (`scene.place.kind`), or with the giver in
 * `scene.present` (whole-word names: "Fenna" is "Fenna the miller"). `{ ok, reason }`.
 */
export function placeRule(thread, scene) {
    const kind = text(scene?.place?.kind).toLowerCase();
    if (kind === 'settlement') return { ok: true, reason: '' };
    const giver = text(thread?.fields?.giver);
    if (giver && (scene?.present ?? []).some(name => samePersonName(giver, name))) return { ok: true, reason: '' };
    return { ok: false, reason: giver ? `Turn it in at a settlement or where ${giver} is.` : 'Turn it in at a settlement.' };
}

/** Plain lists the Quests tab and the tail use: open offers, active quests, finished ones (latest first). */
export function questLists(director) {
    const quests = Object.values(director?.threads ?? {}).filter(thread => thread?.kind === 'quest');
    const byKey = (a, b) => text(a.key).localeCompare(text(b.key)) || (a.id < b.id ? -1 : 1);
    const open = thread => thread.status === 'active' && !thread.ended;
    return {
        offers: quests.filter(thread => open(thread) && thread.offer && !thread.taken).sort(byKey),
        active: quests.filter(thread => open(thread) && !(thread.offer && !thread.taken)).sort(byKey),
        finished: quests.filter(thread => !open(thread))
            .sort((a, b) => (b.ended?.rev ?? b.rev ?? 0) - (a.ended?.rev ?? a.rev ?? 0) || byKey(a, b)),
    };
}
