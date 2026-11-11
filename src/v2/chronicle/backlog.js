// Story Director v2, chronicle part: the Journal's categories and the [Earlier days] backlog (pure).
//
// classify(entry): the Journal category of one happened line, from its receipt's type (`{ type, text }`, carried
// through the day facts). A stored day with no types (older digests) falls back to the known shapes of its text
// (classifyText), else Events. Bookkeeping ("is here" / "is not here" presence, the key people's "noted" tick, the
// code's own receipts) is its own category, which the Journal does not show.
//
// backlogBlock(input): the optional tail block "[Earlier days]": at most six lines, one per past day, picked by
// relevance (people present now, the current place, open threads), and always the last two past days. A line reads
// "Goldwane 18 (3 days ago): …": the relative day is counted in code from the story clock (agoWords), never by the
// model. Each day gives one line; a thread's several lines of one day keep only the latest, and the body is cut to
// BODY_CHARS, then the people who were there for it (the day's recorded present lists, new days only) follow in brackets: at most three names, then "+N";
// when the block runs over its budget the names go first, lowest-ranked line first. The days come from the Journal's known days (world/journal.js knownDay), so what {{user}} does not
// know (secrets, planner text) never goes in. Nothing on the first day or with no clock. The block is about
// 200 tokens (BACKLOG_CHARS): when space is short, the lowest-ranked lines go first. Pure and deterministic.

import { BOOKKEEPING_TYPES, PRESENCE_TEXT, agoText, cut, dayOf, flat } from './days/shared.js';

export const CATEGORIES = Object.freeze(['met', 'relationships', 'events', 'party', 'items', 'reputation', 'news', 'places', 'bookkeeping']);
export const DEFAULT_CATEGORY = 'events';

// Receipt types by category. Story Block's presence, party, item, money and place receipts; Story Director's
// chronicle and atlas receipts; NPC State Delta's meter and presence receipts (`npc.meters`, `npc.set`, `npc.adjust`,
// `npc.present`); the Block's data-module results (`capture.dm`, `dm.act`) that are not a meter set.
const BY_TYPE = new Map([
    ['capture.present', 'met'], ['scene.present', 'met'], ['npc.present', 'met'],
    ['capture.npc', 'relationships'], ['npc.meters', 'relationships'], ['npc.set', 'relationships'], ['npc.adjust', 'relationships'],
    ['capture.party', 'party'], ['item.equip', 'party'], ['capture.mount', 'party'],
    ['capture.item', 'items'], ['capture.coin', 'items'], ['wallet.receive', 'items'], ['wallet.pay', 'items'], ['wallet.set', 'items'],
    ['inventory.add', 'items'], ['inventory.edit', 'items'], ['inventory.carry', 'items'],
    ['rpg.fight', 'events'], ['capture.you', 'bookkeeping'], ['capture.weather', 'bookkeeping'],
    ['capture.dm', 'reputation'], ['dm.act', 'reputation'],
    ['capture.world', 'news'], ['capture.faction', 'news'], ['chronicle.world', 'news'],
    ['capture.place', 'places'], ['place', 'places'],
    ['atlas.visit', 'bookkeeping'], ['atlas.edit', 'bookkeeping'], ['atlas.focus', 'bookkeeping'], ['npc.tick', 'bookkeeping'],
]);
const PRESENT_TYPES = new Set(['capture.present', 'scene.present', 'npc.present']);

// The text shapes of a stored line without its type (older digests): the first that matches wins.
const SHAPES = [
    [/^Key people: noted/, 'bookkeeping'],
    [/\b(?:is|is not) here\.?$/i, 'bookkeeping'],
    [/\b(?:left the party|is back in the party|bound gear|Gear:)/i, 'party'],
    [/^Lost\b|^Found\b|\b(?:copper|silver|gold)\b/i, 'items'],
    [/\b(?:Adventurer Guild|Fame by region|membership)\b/i, 'reputation'],
    [/^[^:]{1,80}: (?:affection|trust|desire|respect|fear|stage)\b/i, 'relationships'],
    [/^(?:Went to|Took on|Finished|Failed|Gave up)\b/, 'events'],
];

/** The category of a stored line by its text alone (no receipt type): a known shape, else Events. */
export function classifyText(line) {
    const body = flat(line);
    const hit = SHAPES.find(([pattern]) => pattern.test(body));
    return hit ? hit[1] : DEFAULT_CATEGORY;
}

/** The Journal category of one happened line: `entry` is `{ type, text }` (a receipt's type and its summary); by type when known, else by text. */
export function classify(entry) {
    const type = typeof entry?.type === 'string' ? entry.type : '';
    const body = flat(entry?.text);
    if (type && BOOKKEEPING_TYPES.has(type)) return 'bookkeeping';
    if (PRESENT_TYPES.has(type) && PRESENCE_TEXT.test(body)) return 'bookkeeping';
    if (type === 'npc.tick' && !/^Key people: /.test(body)) return 'bookkeeping';
    if (type && BY_TYPE.has(type)) return BY_TYPE.get(type);
    return classifyText(body);
}

/** A stored line's kind tag `"<type|-> [thread]"` as `{ type, thread }`. */
export function parseTag(tag) {
    const [type = '', thread = ''] = String(tag ?? '').split(' ');
    return { type: type === '-' ? '' : type, thread };
}

/**
 * A day's lines by category (only those with lines, bookkeeping left out): `{ met, relationships, events, party, items, reputation, news }`.
 * Takes a digest-like `{ happened, tags, met, npcs, world, cats }`: a short day's (`brief`) own `cats` are returned as they are; else the happened
 * lines are sorted by their tag's receipt type (an older day has no tags: by the shape of the text), the met names, the NPC stage lines
 * (relationships) and the world lines (news) go to theirs.
 */
export function bucketDay(day) {
    const out = {};
    const add = (cat, line) => {
        const text = flat(line);
        if (text) (out[cat] ??= []).push(text);
    };
    if (day?.brief === true && isRecord(day?.cats)) return Object.fromEntries(Object.entries(day.cats).filter(([cat, lines]) => CATEGORIES.includes(cat) && Array.isArray(lines)).map(([cat, lines]) => [cat, lines.map(flat).filter(Boolean)]));
    list(day?.met).forEach(name => add('met', name));
    list(day?.happened).forEach((line, index) => {
        const cat = classify({ type: parseTag(day?.tags?.[index]).type, text: line });
        if (cat !== 'bookkeeping' && cat !== 'places') add(cat === 'met' ? 'events' : cat, line);
    });
    list(day?.npcs).forEach(line => add('relationships', line));
    list(day?.world).forEach(line => add('news', line));
    return out;
}

const CATS_CHARS = 900;
const CATS_LINE = 80;
const CATS_PER_KIND = 40;
/** `cats` cut to about a kilobyte for a short day: each line to CATS_LINE characters, lines dropped from the end past CATS_CHARS in all. */
export function trimCats(cats) {
    const out = {};
    let used = 0;
    for (const cat of CATEGORIES) {
        for (const line of (cats?.[cat] ?? []).slice(0, CATS_PER_KIND)) {
            const text = cut(line, CATS_LINE);
            if (used + text.length > CATS_CHARS) return out;
            (out[cat] ??= []).push(text);
            used += text.length;
        }
    }
    return out;
}

// ---- the [Earlier days] block --------------------------------------------------------------------

export const BACKLOG_TAG = '[Earlier days]';
/** At most this many day lines. */
export const BACKLOG_LINES = 6;
/** About 200 tokens: Story Block counts a token as four characters. */
export const BACKLOG_CHARS = 800;
/** The last past days are always in (when they have anything to tell). */
export const ALWAYS_DAYS = 2;
/** A day's body (its relevant lines) cut to this many characters. */
export const BODY_CHARS = 100;
/** A line names at most this many of the people who were there, then "+N". */
export const WITNESS_NAMES = 3;
// Relevance: a present person or the current place counts more than an open thread.
const WEIGHT = Object.freeze({ person: 2, place: 2, thread: 1 });

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const list = value => (Array.isArray(value) ? value.map(flat).filter(Boolean) : []);
const escapeRe = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A name as a whole word (letters and digits bound it), any case.
function mentions(haystack, name) {
    if (!name) return false;
    return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(name)}(?![\\p{L}\\p{N}])`, 'iu').test(haystack);
}

/** The relative day of `days` days before today, in words (the story clock's own count; agoText beyond a day). */
export function agoWords(days) {
    if (!Number.isSafeInteger(days) || days < 0) return '';
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    return agoText(days * 1440);
}

// The relevance of a text to the scene: its present people, its place and its open threads, weighted.
function relevanceOf(haystack, rel) {
    let score = 0;
    for (const name of rel.present) if (mentions(haystack, name)) score += WEIGHT.person;
    if (rel.place && mentions(haystack, rel.place)) score += WEIGHT.place;
    for (const name of rel.threads) if (mentions(haystack, name)) score += WEIGHT.thread;
    return score;
}

// A thread's key: its first three words (lower case, punctuation gone), so one thread's lines of a day are one.
const threadKey = line => flat(line).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').split(' ').slice(0, 3).join(' ');

// The day's body: its latest line per thread, the lines that touch the scene (or the day's own line when none does), two at most.
// `who`: the people there for those lines (the recorded present lists of the day; a day stored before them has none).
function bodyOf(day, rel) {
    const latest = new Map();
    // The Journal's own event rows are already one per thread (knownDay `eventLines`); a day without them keeps its latest line per thread by the line's first words.
    const rows = Array.isArray(day.eventLines) ? { lines: day.eventLines, who: day.eventWho } : { lines: day.happened, who: day.happenedWho };
    list(rows.lines).forEach((line, index) => {
        const key = threadKey(line);
        latest.delete(key);
        latest.set(key, { line, who: list(Array.isArray(rows.who?.[index]) ? rows.who[index] : []) });
    });
    const touching = [...latest.values()].filter(item => relevanceOf(item.line, rel) > 0);
    const parts = touching.length ? touching : [{ line: flat(day.short), who: [] }].filter(item => item.line);
    const shown = parts.slice(0, 2);
    const body = cut(shown.map(item => item.line).join('; '), BODY_CHARS);
    return { body, who: [...new Set(shown.flatMap(item => item.who))] };
}

// The witnesses as a suffix: at most three names, then "+N" for the rest ("(Bregje, Torka, Dag +2)"); '' for none.
export function witnessText(who) {
    const names = [...new Set(list(who))];
    if (!names.length) return '';
    const shown = names.slice(0, WITNESS_NAMES).join(', ');
    return ` (${shown}${names.length > WITNESS_NAMES ? ` +${names.length - WITNESS_NAMES}` : ''})`;
}

// The days' text to match names against: the Journal's own search text, else their lines joined.
const haystackOf = day => (typeof day.search === 'string' ? day.search : [day.short, ...list(day.happened), ...list(day.met), ...list(day.npcs), ...list(day.world)].join(' • '));

/**
 * The block's lines, or [] when there is nothing to tell. `days`: the Journal's known days (knownDay shape: day, date, short,
 * happened, search); `now`: the story clock in minutes; `present`: the names in the scene now; `place`: the current place's name;
 * `threads`: the names of the open quests and threads. Returns [BACKLOG_TAG, …day lines], newest day first.
 */
export function backlogBlock({ days = [], now = null, present = [], place = '', threads = [] } = {}) {
    if (!Number.isSafeInteger(now)) return [];
    const today = dayOf(now);
    const rel = { present: list(present), place: flat(place), threads: list(threads) };
    const past = (Array.isArray(days) ? days : []).filter(day => isRecord(day) && Number.isSafeInteger(day.day) && day.day < today).sort((a, b) => b.day - a.day);
    if (!past.length) return [];
    const always = past.slice(0, ALWAYS_DAYS);
    const rest = past.slice(ALWAYS_DAYS)
        .map(day => ({ day, score: relevanceOf(haystackOf(day), rel) }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score || b.day.day - a.day.day)
        .map(item => item.day);
    // Priority order: the last two days, then the most relevant; a line that does not fit is skipped, so the lowest-ranked go first.
    const ranked = [];
    for (const day of [...always, ...rest]) {
        if (ranked.length >= BACKLOG_LINES) break;
        const { body, who } = bodyOf(day, rel);
        if (!body) continue;
        const date = flat(day.date) || `Day ${day.day}`;
        const ago = agoWords(today - day.day);
        const plain = `${date}${ago ? ` (${ago})` : ''}: ${body}`;
        ranked.push({ day: day.day, plain, line: `${plain}${witnessText(who)}` });
    }
    // The budget is unchanged: the names go first, from the lowest-ranked line up, before any line is skipped.
    const size = items => items.reduce((sum, item) => sum + 1 + item.line.length, BACKLOG_TAG.length);
    for (let index = ranked.length - 1; index >= 0 && size(ranked) > BACKLOG_CHARS; index -= 1) ranked[index].line = ranked[index].plain;
    const block = [];
    let used = BACKLOG_TAG.length;
    for (const item of ranked) {
        if (block.length >= BACKLOG_LINES) break;
        if (used + 1 + item.line.length > BACKLOG_CHARS) continue;
        block.push(item);
        used += 1 + item.line.length;
    }
    if (!block.length) return [];
    return [BACKLOG_TAG, ...block.sort((a, b) => b.day - a.day).map(item => item.line)];
}
