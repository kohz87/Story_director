// Story Director v2, chronicle part: digest lines, construction, caps and query output. Pure.

import { bucketDay, trimCats } from '../backlog.js';
import { MAX_DATE, MAX_LINE, MAX_MET, MAX_NAME, MAX_NPCS, MAX_QUESTS, MAX_WHO, MAX_WORLD, cut, flat, isInt } from './shared.js';

// ---- the one line -----------------------------------------------------------------------------

const unitOf = (amount, currency) => {
    const name = flat(currency?.name) || 'coin';
    const plural = flat(currency?.plural) || `${name}s`;
    return `${amount} ${amount === 1 ? name : plural}`;
};
const listed = (items, max = 3) => (items.length > max ? `${items.slice(0, max).join(', ')} and ${items.length - max} more` : items.join(', '));

/** The money of a day as words: "150 marks in, 20 out" ('' when nothing moved). */
export function moneyText(money, currency) {
    const income = isInt(money?.in) ? money.in : 0;
    const spent = isInt(money?.out) ? money.out : 0;
    if (!income && !spent) return '';
    if (income && spent) return `${unitOf(income, currency)} in, ${spent} out`;
    return income ? `${unitOf(income, currency)} in` : `${unitOf(spent, currency)} out`;
}

/** The fights of a day as words: "2 fights (1 won, 1 fled)" ('' when there were none). */
export function fightText(fights) {
    if (!isInt(fights?.count) || fights.count <= 0) return '';
    const parts = ['won', 'lost', 'fled'].filter(word => fights[word] > 0).map(word => `${fights[word]} ${word}`);
    return `${fights.count} ${fights.count === 1 ? 'fight' : 'fights'}${parts.length ? ` (${parts.join(', ')})` : ''}`;
}

/**
 * The day's one line: its date and the facts in a fixed order, at most 200 code points.
 * "June 3, 1200: to Harrow, Old Weir; took on Rat Cellar; finished Lost Ring; 2 fights (2 won); 150 marks in, 20 out; 1 NPC stage moved; 1 world event."
 */
export function dayLine(date, facts, { currency = null } = {}) {
    const parts = [];
    if (facts.places.length) parts.push(`to ${listed(facts.places)}`);
    if (facts.quests.taken.length) parts.push(`took on ${listed(facts.quests.taken)}`);
    if (facts.quests.done.length) parts.push(`finished ${listed(facts.quests.done)}`);
    if (facts.quests.failed.length) parts.push(`failed ${listed(facts.quests.failed)}`);
    if (facts.quests.dropped.length) parts.push(`gave up ${listed(facts.quests.dropped)}`);
    const fought = fightText(facts.fights);
    if (fought) parts.push(fought);
    const paid = moneyText(facts.money, currency);
    if (paid) parts.push(paid);
    if (facts.npcs.length) parts.push(`${facts.npcs.length} NPC ${facts.npcs.length === 1 ? 'stage' : 'stages'} moved`);
    if (facts.world.length) parts.push(`${facts.world.length} world ${facts.world.length === 1 ? 'event' : 'events'}`);
    if (!parts.length) parts.push(facts.happened[0] ? facts.happened[0].replace(/[.!?…]+$/, '') : `${facts.count} ${facts.count === 1 ? 'change' : 'changes'} kept`);
    return cut(`${flat(date) || 'A day'}: ${parts.join('; ')}.`, MAX_LINE);
}

/**
 * The digest kept for a day (full), from its facts. `made`: the receipt revision writing it; `src`:
 * the revisions of the day-facts entries it was made from (it follows them, daysOf), none when it was
 * read from the receipts.
 */
export function makeDigest(day, facts, { date = '', currency = null, made = 0, revs = [], src = null } = {}) {
    const sorted = [...revs].filter(isInt).sort((a, b) => a - b);
    const sources = Array.isArray(src) ? [...new Set(src.filter(isInt))].sort((a, b) => a - b) : [];
    return {
        day,
        date: cut(date, MAX_DATE),
        line: dayLine(date, facts, { currency }),
        brief: false,
        count: facts.count,
        happened: [...facts.happened],
        // Each line's kind, parallel to `happened` (its receipt type, then its thread id); absent when no line has one.
        ...(Array.isArray(facts.tags) && facts.tags.some(Boolean) ? { tags: facts.tags.slice(0, facts.happened.length) } : {}),
        // Who was there at each line, parallel to `happened` (new days only; absent when no line has anyone).
        ...(Array.isArray(facts.who) && facts.who.some(names => names?.length) ? { who: facts.who.slice(0, facts.happened.length).map(names => (Array.isArray(names) ? names.slice(0, MAX_WHO) : [])) } : {}),
        more: facts.more,
        places: [...facts.places],
        quests: { taken: [...facts.quests.taken], done: [...facts.quests.done], failed: [...facts.quests.failed], dropped: [...facts.quests.dropped] },
        fights: { ...facts.fights },
        money: { ...facts.money },
        npcs: [...facts.npcs],
        world: [...facts.world],
        ...(Array.isArray(facts.met) && facts.met.length ? { met: facts.met.slice(0, MAX_MET) } : {}),
        revs: sorted.length ? [sorted[0], sorted.at(-1)] : [],
        made,
        ...(sources.length ? { src: sources } : {}),
    };
}

/** An older day kept short: its date, its line, how many things it held and a compact list of them by kind (`cats`, at most about 1 KB: the Journal's search still reaches it). */
export function briefOf(digest) {
    const cats = trimCats(bucketDay(digest));
    return { day: digest.day, date: digest.date, line: digest.line, brief: true, count: digest.count, made: digest.made, ...(Object.keys(cats).length ? { cats } : {}) };
}

/**
 * The caps on `days` (a `{ [day]: Digest }` map): the newest `full` days stay whole, older ones are
 * kept short, and beyond `keep` the oldest go. → `{ [day]: Digest | null }`: what changes (null: drop).
 */
export function capDays(days, { full, keep }) {
    const order = Object.values(days).sort((a, b) => b.day - a.day);
    const changes = {};
    order.forEach((digest, index) => {
        if (index >= keep) changes[digest.day] = null;
        else if (index >= full && !digest.brief) changes[digest.day] = briefOf(digest);
    });
    return changes;
}

// ---- what the queries give ---------------------------------------------------------------------

/** A digest as the queries give it: a plain copy, with the money in words. */
export function digestOut(digest, { currency = null, substitute = value => value } = {}) {
    const sub = value => flat(substitute(value));
    const base = { day: digest.day, date: digest.date, line: sub(digest.line), brief: digest.brief, count: digest.count, made: digest.made };
    if (digest.brief) {
        return {
            ...base, cats: digest.cats ? JSON.parse(JSON.stringify(digest.cats)) : {}, happened: [], more: 0, places: [], quests: { taken: [], done: [], failed: [], dropped: [] },
            fights: { count: 0, won: 0, lost: 0, fled: 0 }, money: { in: 0, out: 0 }, npcs: [], world: [], met: [], revs: [],
            moneyText: '', fightText: '',
        };
    }
    return {
        ...base,
        happened: digest.happened.map(sub),
        tags: Array.isArray(digest.tags) ? [...digest.tags] : [],
        who: Array.isArray(digest.who) ? digest.who.map(names => [...names]) : [],
        more: digest.more,
        places: [...digest.places],
        quests: { taken: [...digest.quests.taken], done: [...digest.quests.done], failed: [...digest.quests.failed], dropped: [...digest.quests.dropped] },
        fights: { ...digest.fights },
        money: { ...digest.money },
        npcs: [...digest.npcs],
        world: digest.world.map(sub),
        met: Array.isArray(digest.met) ? [...digest.met] : [],
        revs: [...digest.revs],
        moneyText: moneyText(digest.money, currency),
        fightText: fightText(digest.fights),
    };
}
