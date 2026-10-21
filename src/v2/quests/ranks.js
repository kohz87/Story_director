// Story Director v2, quests part: the rank ladder (F86) and rewards held inside a rank's range (F87).
// Pure. The suite keeps one ladder: the enabled packs' `ranks` content when they have one (complete,
// rewards included), else RPG Battle's level tiers (`party.ranks`, rewards added here by place on the
// ladder), else the built-in F to S ladder. A quest's `rank:` (or `difficulty:` when it names a rank)
// is matched against whichever ladder is in use. A quest from a pack takes the pack's rank. A quest with
// no rank gets one from its difficulty (defaultRank, B-b4-10 / B-b3-18), so every reward is held inside
// some rank's range.

import { tryQuery } from './progress.js';

const clean = value => String(value ?? '').normalize('NFKC').replace(/[*_`]+/g, '').replace(/\s+/g, ' ').trim();

// Rewards by place on a ladder, in whole units of the chat's one currency: the first rank pays about
// 10 to 50, each rank after it about four and a half times the one before (two significant digits).
const FIRST_REWARD = Object.freeze([10, 50]);
const STEP = 4.5;

function roughly(value) {
    if (value < 100) return Math.round(value / 5) * 5;
    const scale = 10 ** (Math.floor(Math.log10(value)) - 1);
    return Math.round(value / scale) * scale;
}

/** The reward range `[lo, hi]` of the rank at `index` (0 = the lowest) on a ladder with no rewards of its own. */
export function rewardByPlace(index) {
    if (!Number.isSafeInteger(index) || index <= 0) return [...FIRST_REWARD];
    return [rewardByPlace(index - 1)[1], roughly(FIRST_REWARD[1] * STEP ** index)];
}

// The built-in ladder, for a level cap of about 60.
const DEFAULT_LEVELS = [[1, 5], [6, 12], [13, 20], [21, 30], [31, 40], [41, 50], [51, 60]];
export const DEFAULT_RANKS = Object.freeze(['F', 'E', 'D', 'C', 'B', 'A', 'S'].map((id, index) => Object.freeze({
    id, title: `${id}-rank`, levels: Object.freeze(DEFAULT_LEVELS[index]), reward: Object.freeze(rewardByPlace(index)),
})));

const isPair = value => Array.isArray(value) && value.length === 2 && value.every(n => Number.isSafeInteger(n) && n >= 0) && value[0] <= value[1];

// A record's own id: the pack's slug (`pack.<pack>/<slug>` → `<slug>`; a short letter slug in capitals,
// as ranks are written: `d` → `D`), RPG Battle's id as it is.
function rankId(record) {
    const own = clean(record.rank ?? record.short);
    if (own) return own;
    const raw = clean(record.slug) || clean(record.id).replace(/^pack\.[^/]*\//, '');
    return /^[a-z]{1,3}$/.test(raw) ? raw.toUpperCase() : raw;
}

/**
 * A ladder from a list of records (`{ id, title?, levels?, reward? }`, a pack's or RPG Battle's), lowest
 * first: records without an id (or with one already seen) are left out; missing or bad levels are the
 * built-in band at that place (null past it); a missing or bad reward is given one by place
 * (`withRewards: false` always gives them by place). Null when nothing is left.
 */
export function ladderFrom(list, { withRewards = true } = {}) {
    if (!Array.isArray(list)) return null;
    const out = [];
    for (const record of list) {
        if (!record || typeof record !== 'object') continue;
        const id = rankId(record);
        if (!id || out.some(rank => rank.id.toLowerCase() === id.toLowerCase())) continue;
        const own = Array.isArray(record.levels) ? record.levels.map(Number) : null;
        const levels = isPair(own) ? own : DEFAULT_LEVELS[out.length] ?? null;
        const given = Array.isArray(record.reward) ? record.reward.map(Number) : null;
        const reward = withRewards && isPair(given) ? given : rewardByPlace(out.length);
        out.push({ id, title: clean(record.title ?? record.name) || id, levels: levels ? [...levels] : null, reward: [...reward] });
    }
    return out.length ? out : null;
}

// `packs.content({ kind: 'ranks' })` lists every enabled pack's ladder one after another, each record
// tagged with its `pack`: the first pack with any records is the chat's ladder.
function firstPack(list) {
    if (!Array.isArray(list)) return null;
    const first = list.find(record => record && typeof record === 'object');
    if (!first) return null;
    return list.filter(record => record && typeof record === 'object' && record.pack === first.pack);
}

/**
 * `quest.ranks` → `[{ id, title, levels: [lo, hi] | null, reward: [lo, hi] }]`, lowest first: the first
 * enabled pack's `ranks` content, else RPG Battle's `party.ranks` with rewards by place, else
 * DEFAULT_RANKS. Plain copies.
 */
export function ranksOf(query) {
    const packs = ladderFrom(firstPack(tryQuery(query, 'packs.content', { kind: 'ranks' }, null)));
    if (packs) return packs;
    const party = ladderFrom(tryQuery(query, 'party.ranks', {}, null), { withRewards: false });
    if (party) return party;
    return DEFAULT_RANKS.map(rank => ({ ...rank, levels: [...rank.levels], reward: [...rank.reward] }));
}

// "D", "d-rank", "Rank D", "D rank", "Soul Class II" read the same way: lower case, the word rank set aside.
const words = value => clean(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter(word => word && word !== 'rank');

/**
 * The rank a written value names on `ladder`, or null: by id or title, ignoring case and the word "rank";
 * a value that is only the end of a title ("II" for "Soul Class II") names it too. Exact matches first.
 */
export function rankNamed(value, ladder) {
    const want = words(value).join(' ');
    if (!want || !Array.isArray(ladder)) return null;
    const exact = ladder.find(rank => words(rank.id).join(' ') === want || words(rank.title).join(' ') === want);
    if (exact) return exact;
    return ladder.find(rank => {
        const title = words(rank.title);
        const tail = want.split(' ');
        return tail.length < title.length && tail.every((word, i) => title[title.length - tail.length + i] === word);
    }) ?? null;
}

/** A quest thread's rank on `ladder`: its `rank:` field, else its `difficulty:` when that names a rank. */
export function rankOf(thread, ladder) {
    for (const field of ['rank', 'difficulty']) {
        const found = rankNamed(thread?.fields?.[field], ladder);
        if (found) return found;
    }
    return null;
}

/**
 * How far from the party's own rank a quest's difficulty puts it when it names no rank: easy one rank
 * below, normal the party's, hard one above, nightmare two above (held to the ends of the ladder).
 */
export const DIFFICULTY_STEPS = Object.freeze({ easy: -1, normal: 0, hard: 1, nightmare: 2 });

/**
 * The rank a quest that names none is paid as: the party's rank on `ladder` (the rank whose levels hold
 * `level`, the player character's level; above every band, the highest band below it; the lowest rank
 * when the level is not known) moved by DIFFICULTY_STEPS for `difficulty` (easy, normal, hard,
 * nightmare; anything else is normal). Null only for an empty ladder.
 */
export function defaultRank(ladder, difficulty, level = null) {
    if (!Array.isArray(ladder) || !ladder.length) return null;
    let base = 0;
    if (Number.isSafeInteger(level) && level > 0) {
        const at = ladder.findIndex(rank => rank.levels && level >= rank.levels[0] && level <= rank.levels[1]);
        if (at >= 0) base = at;
        else ladder.forEach((rank, index) => { if (rank.levels && rank.levels[1] < level) base = index; });
    }
    const step = Object.hasOwn(DIFFICULTY_STEPS, difficulty) ? DIFFICULTY_STEPS[difficulty] : 0;
    return ladder[Math.min(ladder.length - 1, Math.max(0, base + step))];
}

/** How many ranks above the party's own (defaultRank's base) a rank the story writes may be. */
export const WRITTEN_RANKS_ABOVE = 1;

/**
 * The rank a quest is paid as: `{ rank, by, said? }`, `by` one of 'pack' (its pack quest's `rank` or
 * `letter`), 'written' (its own `rank:`, or a `difficulty:` that names a rank) or 'difficulty'
 * (defaultRank). `pack` is the quest's pack record or null; `level` the player character's level.
 * Code sets the numbers: a written rank more than WRITTEN_RANKS_ABOVE above the party's own is held
 * there, and `said` is the rank the story wrote. A pack's rank is not held.
 */
export function questRank(thread, ladder, { pack = null, level = null, difficulty = 'normal' } = {}) {
    const fromPack = pack ? rankNamed(pack.rank ?? pack.letter ?? '', ladder) : null;
    if (fromPack) return { rank: fromPack, by: 'pack' };
    const written = rankOf(thread, ladder);
    if (written) {
        const most = Math.min(ladder.length - 1, ladder.indexOf(defaultRank(ladder, 'normal', level)) + WRITTEN_RANKS_ABOVE);
        return ladder.indexOf(written) > most ? { rank: ladder[most], by: 'written', said: written } : { rank: written, by: 'written' };
    }
    const rank = defaultRank(ladder, difficulty, level);
    return { rank, by: rank ? 'difficulty' : null };
}

/** "220–1000 gold". */
export function rangeText(rank, currency) {
    return `${rank.reward[0]}–${rank.reward[1]} ${currency}`;
}

/**
 * A total reward held inside its rank's range: `{ total, held }`, `held` true when it was moved. A reward
 * of nothing in money (0, or no amount) is left as it is: "reward: none" is not raised to the range.
 * `capOnly`: only the top of the range holds (a rank the quest's difficulty gave, not one it names: a
 * small reward the story wrote is not raised).
 */
export function holdReward(total, rank, { capOnly = false } = {}) {
    if (!rank || !Number.isSafeInteger(total) || total <= 0) return { total, held: false };
    const [lo, hi] = rank.reward;
    const kept = Math.min(hi, capOnly ? total : Math.max(lo, total));
    return { total: kept, held: kept !== total };
}

/** "the story said S-rank; held to D-rank for a level-12 party". */
export function rankHeldText(said, rank, level) {
    const party = Number.isSafeInteger(level) ? `a level-${level} party` : 'a party whose level is not known';
    return `the story said ${said.title}; held to ${rank.title} for ${party}`;
}

/** "reward clamped to D-rank range: 220–1000 gold (clamped from 5000 gold)". */
export function heldText(rank, said, currency) {
    return `reward clamped to ${rank.title} range: ${rangeText(rank, currency)} (clamped from ${said})`;
}
