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

import { agoWords, bucketDay, classify, parseTag } from '../chronicle/backlog.js';
import { boardDay } from '../chronicle/queries.js';
import { dayLine, dayOf, digestOut, entriesByDay, factsOf, makeDigest, notedOf, orderedDays, rangeDays } from '../chronicle/days.js';
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

// A day stored before the digest left bookkeeping out can still hold the fight board's narrator note (`rpg.resolve`'s summary, Story Block
// lean-rpg note.js settledNote): shown or counted as an event it is the code's own instruction. Matched by its fixed opening words.
// The fight board's note ("Tell … the settled fight results") and the older roll planner's ("[Rolls] Code rolled these …"), as stored in old days.
const NARRATOR_NOTE = /^(?:Tell (?:the approach, then )?the settled fight results in order; do not reroll them\.|\[Rolls\] Code rolled these)/;
/** Whether a stored "happened" line is that narrator note (the receipt is no longer known, so by its form). */
export const isNarratorNote = line => NARRATOR_NOTE.test(String(line ?? '').trim());

// ---- the day's lines by kind (the Journal's folds) ------------------------------------------------------------------------

const KINDS = [['met', 'Met'], ['relationships', 'Relationships'], ['events', 'Events'], ['party', 'Party & gear'], ['items', 'Items & money'], ['reputation', 'Reputation'], ['news', 'News']];
const ARROW = /^(\S+) (.+?) (?:->|→) (.+)$/;
const LOST = /^Lost (.+?)(?: x(\d+))? \((\d+) left\)\.?$/;
const plain = detail => ({ title: '', chip: '', detail, note: '', tags: [] });

// "Torka: affection 9 -> 10, desire 7 -> 8 (held at 7)" → one row per person, its meter changes as tags (a meter moved twice: first from, last to).
function relationRows(lines) {
    const rows = new Map();
    const loose = [];
    for (const line of lines) {
        const at = line.indexOf(': ');
        const name = at > 0 ? line.slice(0, at) : '';
        const moves = (at > 0 ? line.slice(at + 2) : line).replace(/\([^)]*\)/g, '').split(',').map(part => ARROW.exec(part.trim())).filter(Boolean);
        if (!name || !moves.length) { loose.push(plain(line)); continue; }
        const row = rows.get(name.toLowerCase()) ?? { title: name, chip: '', detail: '', note: '', tags: [], meters: new Map() };
        rows.set(name.toLowerCase(), row);
        for (const [, meter, from, to] of moves) row.meters.set(meter, { from: row.meters.get(meter)?.from ?? from, to: to.replace(/[\s.]+$/, '') });
    }
    return [...rows.values()].map(({ meters, ...row }) => ({ ...row, tags: [...meters].map(([meter, move]) => `${meter} ${move.from} → ${move.to}`) })).concat(loose);
}

// A day's repeated "Lost X xN (n left)" lines are one: "Lost: A x36, B x12" (a lone one stays as it was).
function itemRows(lines) {
    const lost = lines.map(line => LOST.exec(line)).filter(Boolean);
    if (lost.length < 2) return lines.map(plain);
    const merged = new Map(lost.map(([, name, count]) => [name, count ? `${name} x${count}` : name]));
    return [...lines.filter(line => !LOST.test(line)).map(plain), plain(`Lost: ${[...merged.values()].join(', ')}`)];
}

// Events: one row per thread (a quest or thread the lines or the stamps name): its latest line, "N steps today", and "began <date>" on the day it ends.
function eventRows(day, events, { threads, format }) {
    const groups = new Map();
    const rows = [];
    for (const { line, thread } of events) {
        const known = thread ? threads.get(thread) : null;
        const title = known ? String(known.key ?? '') : '';
        if (!title || day.hide(title)) { rows.push({ ...plain(line), order: rows.length }); continue; }
        const key = title.toLowerCase();
        const group = groups.get(key) ?? { title, lines: [], thread: known, order: rows.length };
        if (!groups.has(key)) rows.push(group);
        groups.set(key, group);
        group.lines.push(line);
    }
    const stamps = [['taken', 'began'], ['done', 'finished'], ['failed', 'failed'], ['dropped', 'gave up']];
    for (const [list, chip] of stamps) {
        for (const title of day.quests[list] ?? []) {
            if (day.hide(title)) continue;
            const key = String(title).toLowerCase();
            const group = groups.get(key) ?? { title, lines: [], thread: [...threads.values()].find(item => String(item?.key ?? '').toLowerCase() === key) ?? null };
            if (!groups.has(key)) { groups.set(key, group); rows.push(group); }
            group.chip = list === 'taken' && group.chip ? group.chip : chip;
        }
    }
    return rows.map(row => {
        if (!row.lines) return { title: '', chip: '', detail: row.detail, note: '', tags: [] };
        const ends = ['finished', 'failed', 'gave up'].includes(row.chip);
        const began = ends && isInt(row.thread?.taken?.at) && typeof format === 'function' ? format(row.thread.taken.at) : '';
        const note = [row.lines.length > 1 ? `${row.lines.length} steps today` : '', began && dayOfMinutes(row.thread.taken.at) !== day.day ? `began ${began}` : ''].filter(Boolean).join(' · ');
        return { title: row.title, chip: row.chip || 'step', detail: row.lines.at(-1) ?? '', note, tags: [] };
    });
}

const dayOfMinutes = minutes => Math.floor(minutes / 1440);
const textOf = row => [row.title, row.chip, row.detail, row.note, ...row.tags].filter(Boolean).join(' ');

/** The Journal's folds of one known day: `[{ id, label, count, items: [{ title, chip, detail, note, tags }], search }]`, only kinds with something. */
function foldsOf(entry, { kept, quests, hidden, threads, format }) {
    const hide = line => namesHidden(line, hidden.words) || namesHidden(line, hidden.behind);
    const made = bucketDay({ ...entry, happened: kept.map(item => item.line), tags: kept.map(item => item.tag) });
    // Events keep their thread (a short day has only the lines).
    const events = entry.brief ? (made.events ?? []).map(line => ({ line, thread: '' }))
        : kept.filter(item => classify({ type: parseTag(item.tag).type, text: item.line }) === 'events').map(item => ({ line: item.line, thread: parseTag(item.tag).thread }));
    const items = [...(made.items ?? []), ...(entry.moneyText && !entry.brief ? [`Money: ${entry.moneyText}`] : [])];
    const rows = {
        met: list(entry.met).map(name => ({ ...plain(''), title: name })),
        relationships: relationRows((made.relationships ?? []).filter(line => !hide(line))),
        events: eventRows({ day: entry.day, quests, hide }, events, { threads, format }),
        party: (made.party ?? []).map(plain),
        items: itemRows(items),
        reputation: (made.reputation ?? []).map(plain),
        news: list(entry.world).filter(line => !hide(line)).map(plain),
    };
    if (entry.brief) rows.met = (made.met ?? []).map(name => ({ ...plain(''), title: name }));
    return KINDS.filter(([id]) => rows[id].length).map(([id, label]) => ({ id, label, count: rows[id].length, items: rows[id], search: rows[id].map(textOf).join(' • ') }));
}

/**
 * One board day with what {{user}} must not see taken out, its line, facts and search text made again, and its folds by kind
 * (`cats`: Met, Relationships, Events, Party & gear, Items & money, Reputation, News). `context`: `{ now, threads, format }`: the story clock
 * (for "3 days ago"), the threads by id and the calendar's date text of story minutes.
 */
export function knownDay(entry, hidden, { now = null, threads = new Map(), format = null } = {}) {
    const drop = line => namesHidden(line, hidden.words) || namesHidden(line, hidden.behind);
    const lines = list(entry.happened);
    const kept = lines.map((line, index) => ({ line, tag: entry.tags?.[index] ?? '' })).filter(item => !namesHidden(item.line, hidden.words) && !isNarratorNote(item.line));
    const happened = kept.map(item => item.line);
    const world = list(entry.world).filter(line => !drop(line));
    const met = list(entry.met);
    const npcs = list(entry.npcs);
    const quests = isRecord(entry.quests) ? entry.quests : { taken: [], done: [], failed: [], dropped: [] };
    const removed = lines.length - happened.length;
    let short = String(entry.short ?? '');
    if (entry.brief) {
        if (namesHidden(short, hidden.words)) short = '';
    } else if (removed || world.length !== list(entry.world).length || namesHidden(short, hidden.words)) {
        // The line is made of the facts (days.js dayLine); made again from what is left.
        const line = dayLine(entry.date, { places: list(entry.places), quests, fights: entry.fights ?? { count: 0 }, money: entry.money ?? { in: 0, out: 0 }, npcs, world, happened, count: Math.max(0, (entry.count ?? 0) - removed) });
        short = entry.date && line.startsWith(`${entry.date}: `) ? line.slice(entry.date.length + 2) : line;
    }
    const cats = foldsOf(entry, { kept, quests, hidden, threads, format });
    const events = cats.find(cat => cat.id === 'events');
    const search = [entry.date, short, ...happened, ...list(entry.places), ...Object.values(quests).flatMap(list), ...npcs, ...world, ...met, ...cats.map(cat => cat.search)].join(' • ');
    const ago = isInt(now) && isInt(entry.day) ? agoWords(dayOf(now) - entry.day) : '';
    return {
        day: entry.day,
        date: String(entry.date ?? ''),
        today: entry.today === true,
        brief: entry.brief === true,
        short,
        facts: list(entry.facts),
        happened,
        more: isInt(entry.more) ? entry.more : 0,
        total: happened.length + (isInt(entry.more) ? entry.more : 0),
        world,
        met,
        npcs,
        cats,
        hasCats: cats.length > 0,
        ago,
        eventCount: events?.count ?? 0,
        meta: [ago, events ? `${events.count} ${events.count === 1 ? 'event' : 'events'}` : ''].filter(Boolean).join(' · '),
        // One line per event row (the thread's latest), for the narrator's [Earlier days] block.
        eventLines: (events?.items ?? []).map(row => (row.title ? `${row.title} (${row.chip}${row.note ? `, ${row.note}` : ''}): ${row.detail}`.replace(/: $/, '') : row.detail)),
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
    const threads = new Map(Object.entries(isRecord(state?.domains?.director?.threads) ? state.domains.director.threads : {}).filter(([, thread]) => isRecord(thread)));
    const format = minutes => { try { return calendar.format(minutes, { time: false }); } catch { return ''; } };
    const out = [...open, ...days].sort((a, b) => b.day - a.day).map(day => knownDay(day, hidden, { now, threads, format }));
    return { on: true, days: out, hasDays: out.length > 0, count: out.length, today: String(board.today ?? '') };
}

/**
 * `director.journal.events { day }` → `{ day, events: [text] }`: that day's whole list of events (the Journal's "Show all N events"), loaded
 * on tap from the chat's receipts (`chronicle.dayEvents`), with what {{user}} must not know left out as the Journal leaves it out. Null for a bad day.
 */
export function journalEvents(state, { day } = {}, tools) {
    const wanted = typeof day === 'string' && day.trim() !== '' ? Number(day) : day;
    if (!isInt(wanted)) return null;
    const got = tryQuery(queryOf(tools), 'chronicle.dayEvents', { day: wanted }, null);
    const hidden = hiddenNames(state);
    return { day: wanted, events: list(got?.events).filter(line => !namesHidden(line, hidden.words)) };
}

// ---- one day, for other modules (contract §3: journal.day) ----------------------------------------------------------------

const LINES = 12;
const LINE = 240;
const oneLine = value => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, LINE);

/** The lines a known day gives, newest facts first as the Journal reads them: its line, the facts, what happened, the news, who was met. */
function linesOf(entry) {
    const out = [];
    if (entry.short) out.push(entry.short);
    out.push(...list(entry.facts), ...list(entry.happened), ...list(entry.world));
    if (list(entry.met).length) out.push(`Met: ${list(entry.met).join(', ')}`);
    out.push(...list(entry.npcs));
    return [...new Set(out.map(oneLine).filter(Boolean))].slice(0, LINES);
}

/**
 * `journal.day({ day, snapshot? }) -> { day, title, lines, source: 'digest' | 'facts' | 'snapshot', missing }` (contract §3): one story day
 * for a module that wants its recap (for example, a save point). It works whether or not the Journal screen or the
 * day digest is on: the visible digest first, else the visible facts of the day (the receipts the digest would be written from), else the
 * saved visible scene of `snapshot`. At most twelve lines of 240 characters; what {{user}} must not know (a secret, an arc) is left
 * out as the Journal leaves it out, and no hidden event is recapped. A day with none of these is `missing: true`, titled `Day <day>`, with
 * the saved scene's line or `[]`. Null for a day that is not a whole number of the contract's `Day` (floor(minutes / 1440); the story clock may be
 * negative, so a day before the first is a day).
 */
const DAY_MIN = -6254999482460;
const DAY_MAX = 6254999482459;

export function journalDay(state, { day, snapshot = null } = {}, tools) {
    if (!isInt(day) || day < DAY_MIN || day > DAY_MAX) return null;
    const query = queryOf(tools);
    const calendar = calendarFrom(query);
    const now = nowFrom(query, state);
    const hidden = hiddenNames(state);
    const currency = tryQuery(query, 'inventory.currency', {}, null);
    const title = date => (date ? `Day ${day} · ${date}` : `Day ${day}`).slice(0, 80);
    const digest = orderedDays(state?.domains?.chronicle, { state, currency }).find(item => item.day === day);
    if (digest) {
        const entry = knownDay(boardDay(digestOut(digest, { currency, substitute: substituteOf(tools) })), hidden);
        const lines = linesOf(entry);
        if (lines.length) return { day, title: title(entry.date), lines, source: 'digest', missing: false };
    }
    const facts = pending(state, tools, { calendar, now, written: new Set() }).find(item => item.day === day);
    if (facts) {
        const entry = knownDay(facts, hidden);
        const lines = linesOf(entry);
        if (lines.length) return { day, title: title(entry.date), lines, source: 'facts', missing: false };
    }
    // The saved visible scene of a save point: its own journal for the day, else its scene's line.
    const point = typeof snapshot === 'string' && snapshot ? (tryQuery(query, 'savepoint.list', {}, []) ?? []).find(item => isRecord(item) && item.id === snapshot) : null;
    const saved = list(point?.journal?.day === day ? point.journal.lines : []).map(oneLine).filter(line => line && !namesHidden(line, hidden.words) && !namesHidden(line, hidden.behind)).slice(0, LINES);
    if (saved.length) return { day, title: title(''), lines: saved, source: 'snapshot', missing: false };
    const scene = oneLine(point?.scene?.text);
    const visible = scene && !namesHidden(scene, hidden.words) && !namesHidden(scene, hidden.behind) ? [scene] : [];
    return { day, title: `Day ${day}`, lines: visible, source: 'snapshot', missing: true };
}
