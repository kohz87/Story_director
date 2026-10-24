// Story Director v2, part **world**: the Journal, the World screen's second view (pure, worked out on read).
//
// One entry per story day, newest first: where {{user}} went, who they met, the news they learned, the
// quests they took on and finished (failed, gave up), the fights and money of the day, NPC State Delta's
// stage moves, and what else the story was told. It is the day digest's data (chronicle/days.js, feature
// `story-director.digest`, through `chronicle.dayBoard`), which the Days screen showed before, plus the day
// still under way ("today so far", and a day just ended whose digest is not written yet), read from the
// same day-facts entries the digest will be written from (`chronicle.dayFacts`, and the receipts since the
// last note through `chronicle.noteFacts`), so nothing new is stored. Only what {{user}} knows (known.js): a line naming
// a secret or an arc, or an arc planner's own line in an older digest, is left out. While the digest is off
// the Journal says so and shows nothing.

import { boardDay } from '../chronicle/queries.js';
import { dayLine, dayOf, digestOut, entriesByDay, factsOf, makeDigest, notedOf, rangeDays } from '../chronicle/days.js';
import { calendarFrom, hiddenNames, namesHidden, nowFrom, queryOf, tryQuery } from './known.js';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isInt = value => Number.isSafeInteger(value);
const list = value => (Array.isArray(value) ? value.filter(item => typeof item === 'string') : []);

const substituteOf = tools => (typeof tools?.substitute === 'function' ? value => {
    try {
        const out = tools.substitute(value);
        return typeof out === 'string' ? out : String(value ?? '');
    } catch {
        return String(value ?? '');
    }
} : value => String(value ?? ''));

// The days not written yet (the day under way, and a day just ended whose digest the next reply writes),
// from the day-facts entries kept for them and the receipts since the last note (`chronicle.noteFacts`,
// what the next note will keep): as their digests will be written. `written`: the days the board has.
function pending(state, tools, { calendar, now, written }) {
    const chronicle = state?.domains?.chronicle;
    const byDay = entriesByDay(chronicle);
    const fresh = new Map();
    const noted = notedOf(chronicle);
    const plan = tryQuery(queryOf(tools), 'chronicle.noteFacts', { after: isInt(noted?.rev) ? noted.rev : null, minutes: isInt(noted?.minutes) ? noted.minutes : null }, null);
    for (const item of Array.isArray(plan?.entries) ? plan.entries : []) {
        if (!isInt(item?.day) || !isRecord(item.entry) || !(item.entry.count > 0)) continue;
        if (!fresh.has(item.day)) fresh.set(item.day, []);
        fresh.get(item.day).push(item.entry);
    }
    const days = [...new Set([...byDay.keys(), ...fresh.keys()])].filter(day => !written.has(day) && (!isInt(now) || day <= dayOf(now))).sort((a, b) => b - a);
    if (!days.length) return [];
    const dayOfRev = rangeDays(byDay);
    const currency = tryQuery(queryOf(tools), 'inventory.currency', {}, null);
    const out = [];
    for (const day of days) {
        const entries = [...(byDay.get(day) ?? []).map(item => item.entry), ...(fresh.get(day) ?? [])];
        const facts = factsOf(entries, { state, day, dayOfRev });
        if (!facts.count) continue;
        let date = '';
        try { date = calendar.format(day * 1440, { time: false }); } catch { date = ''; }
        const digest = makeDigest(day, facts, { date, currency, revs: facts.revs });
        out.push({ ...boardDay(digestOut(digest, { currency, substitute: substituteOf(tools) })), today: isInt(now) && day === dayOf(now) });
    }
    return out;
}

/** One board day with what {{user}} must not see taken out, its line, facts and search text made again. */
export function knownDay(entry, hidden) {
    const drop = line => namesHidden(line, hidden.words) || namesHidden(line, hidden.behind);
    const happened = list(entry.happened).filter(line => !namesHidden(line, hidden.words));
    const world = list(entry.world).filter(line => !drop(line));
    const met = list(entry.met);
    const npcs = list(entry.npcs);
    const quests = isRecord(entry.quests) ? entry.quests : { taken: [], done: [], failed: [], dropped: [] };
    const removed = list(entry.happened).length - happened.length;
    let short = String(entry.short ?? '');
    if (entry.brief) {
        if (namesHidden(short, hidden.words)) short = '';
    } else if (removed || world.length !== list(entry.world).length || namesHidden(short, hidden.words)) {
        // The line is made of the facts (days.js dayLine); made again from what is left.
        const line = dayLine(entry.date, { places: list(entry.places), quests, fights: entry.fights ?? { count: 0 }, money: entry.money ?? { in: 0, out: 0 }, npcs, world, happened, count: Math.max(0, (entry.count ?? 0) - removed) });
        short = entry.date && line.startsWith(`${entry.date}: `) ? line.slice(entry.date.length + 2) : line;
    }
    const search = [entry.date, short, ...happened, ...list(entry.places), ...Object.values(quests).flatMap(list), ...npcs, ...world, ...met].join(' • ');
    return {
        day: entry.day,
        date: String(entry.date ?? ''),
        today: entry.today === true,
        brief: entry.brief === true,
        short,
        facts: list(entry.facts),
        happened,
        more: isInt(entry.more) ? entry.more : 0,
        world,
        met,
        npcs,
        hasFacts: list(entry.facts).length > 0,
        hasHappened: happened.length > 0,
        hasWorld: world.length > 0,
        hasMet: met.length > 0,
        hasNpcs: npcs.length > 0,
        search,
    };
}

/**
 * `director.journal` → `{ on, days: [day], hasDays, count, today }`: `on` is false while the day digest is
 * off (Features), and then there are no days. Each day: `{ day, date, today, brief, short, facts, happened,
 * more, world, met, npcs, has…, search }` (knownDay), newest first, today's first when it has anything.
 */
export function journalView(state, _args, tools) {
    const query = queryOf(tools);
    const board = tryQuery(query, 'chronicle.dayBoard', {}, null);
    if (!isRecord(board) || !Array.isArray(board.days)) return { on: false, days: [], hasDays: false, count: 0, today: '' };
    const calendar = calendarFrom(query);
    const now = nowFrom(query, state);
    const hidden = hiddenNames(state);
    const days = board.days.filter(isRecord);
    const open = pending(state, tools, { calendar, now, written: new Set(days.map(day => day.day)) });
    const out = [...open, ...days].sort((a, b) => b.day - a.day).map(day => knownDay(day, hidden));
    return { on: true, days: out, hasDays: out.length > 0, count: out.length, today: String(board.today ?? '') };
}
