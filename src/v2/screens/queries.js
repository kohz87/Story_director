// Story Director v2, part **screens**: the view queries its screens bind to (SPEC §13.1 `data`).
//
// A template has no arithmetic, sorting or per-item queries (SPEC §13.2), so what a screen needs
// worked out ahead (which quest is the current goal, which thread comes due next, how far each
// active quest is and why Finish is off) is answered here, as plain data. Each query is built
// from the Director's own queries through `tools.query` (MODULES §F3: `director.threads`,
// `quest.progress`), so the tracker and quests parts stay the only readers of their rules, and
// it reads Story Block's `scene` (SPEC §7) from the same state. Every query runs on the state it
// is given: an inline card (mount `card`) gets that reply's state, never the head.
//
// Without `tools` (a host that cannot call queries from a query) the threads are read from the
// documented `director` layout (MODULES §C1) and progress is left out.
//
// The calendar (for "what comes due next") is the chat's: the tracker's `director.calendar` query (the
// reader's, else the enabled pack's, else Gregorian); without it the tracker part's calendar setting,
// read through an injected settings function (by default Story Block's `sdk.settings('story-director')`).

import { PRESETS, makeCalendar, normalizeCalendar } from '../../calendar.js';
import { lineKey } from '../../changes.js';
import { dateOf } from '../../relevance.js';
import { problemList } from '../tracker/domain.js';
import { heroDate } from '../tracker/clock-set.js';
import { BEHIND, BEHIND_KINDS } from './reveal.js';
import { THREADS_FEATURE, threadsOn } from '../threads.js';

const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
// Fields that hold a date the story can reach (v1 relevance.js DATE_FIELDS).
const DATE_FIELDS = ['due', 'on', 'arrive'];
// The problems the Director screen shows (the tracker's PROBLEM_LIMIT).
const PROBLEM_SHOWN = 50;
export const FINISHED_SHOWN = 20;

/** A `query(name, args)` from the tools a host passes (MODULES §F3), or null. */
function queryFrom(tools) {
    if (typeof tools?.query === 'function') return tools.query;
    if (typeof tools === 'function') return tools;
    return null;
}

function ask(query, name, args, fallback) {
    if (!query) return fallback;
    try {
        const value = query(name, args);
        return value === undefined ? fallback : value;
    } catch {
        return fallback;
    }
}

/** Threads as `director.threads` gives them (tracker order), else read from the state. */
function threadsOf(state, query, args = {}) {
    const listed = ask(query, 'director.threads', args, null);
    if (Array.isArray(listed)) return listed;
    const director = state?.domains?.director;
    const { kind = null, status = null } = args;
    return Object.values(isRecord(director?.threads) ? director.threads : {})
        .filter(thread => isRecord(thread) && (!kind || thread.kind === kind) && (!status || thread.status === status))
        .sort((a, b) => (a.track?.order ?? 0) - (b.track?.order ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const isOpen = thread => thread.status === 'active' && !thread.ended;
const isOffer = thread => isOpen(thread) && Boolean(thread.offer) && !thread.taken;

// ---------------------------------------------------------------------------------------------------
// The current goal

/**
 * `director.goal` → the active quest touched most recently (highest `rev`; the tracker's order breaks
 * a tie), not an open offer: `{ id, key, goal, step, giver, due, taken }`, or null.
 */
export function currentGoal(state, args, tools) {
    const quests = threadsOf(state, queryFrom(tools), { status: 'active' }).filter(thread => isOpen(thread) && !isOffer(thread)
        && (thread.kind === 'quest' || thread.rpg || thread.acceptance));
    let best = null;
    for (const thread of quests) if (!best || (thread.rev ?? 0) > (best.rev ?? 0)) best = thread;
    if (!best) return null;
    const fields = best.fields ?? {};
    return {
        id: best.id,
        key: text(best.key),
        goal: text(fields.goal) || text(best.summary),
        step: text(fields.step),
        giver: text(fields.giver),
        due: text(fields.due),
        taken: Boolean(best.taken),
    };
}

// ---------------------------------------------------------------------------------------------------
// What comes due next

// The tracker part's calendar setting, either as that part reads it (`{ calendar: {…} }`) or as the
// module's settings hold it, namespaced by part and flattened (`'tracker.calendar.months': […]`,
// src/v2/module.js). Null when neither is there.
const CALENDAR_PREFIX = 'tracker.calendar.';
export function calendarSetting(values) {
    if (!isRecord(values)) return null;
    if (isRecord(values.calendar)) return values.calendar;
    const flat = Object.entries(values).filter(([key]) => key.startsWith(CALENDAR_PREFIX));
    return flat.length ? Object.fromEntries(flat.map(([key, value]) => [key.slice(CALENDAR_PREFIX.length), value])) : null;
}

// The chat's calendar: the tracker's `director.calendar` (the reader's, else the pack's, else Gregorian)
// when a query can ask it, else the setting itself.
function calendarFrom(settings, query = null) {
    const config = ask(query, 'director.calendar', {}, null);
    if (isRecord(config)) {
        try { return makeCalendar(config); } catch { /* the setting below */ }
    }
    try {
        const value = typeof settings === 'function' ? settings() : settings;
        return makeCalendar(normalizeCalendar(calendarSetting(value) ?? PRESETS.gregorian));
    } catch {
        return makeCalendar(normalizeCalendar(PRESETS.gregorian));
    }
}

// A date without a clock time counts for its whole day (v1 relevance.js reachedBy).
function reached(parsed, now, calendar) {
    if (!Number.isInteger(now)) return false;
    if (!parsed.hasTime) return calendar.dayIndex(parsed.abs) <= calendar.dayIndex(now);
    return parsed.abs <= now;
}

/**
 * `director.next` → the open thread whose date (`due`, `on` or `arrive`, read on the reader's calendar
 * from the story time) comes first: `{ id, key, kind, summary, field, when, at, reached }`, or null.
 * `reached` is true once that date has come (it is due now or overdue). Secrets are never due.
 */
export function nextDue(state, args, tools, { settings = null } = {}) {
    const query = queryFrom(tools);
    // `shown: true` (the card under each reply): while behind the scenes is hidden, only what the reader
    // may see (quests, hooks, world events) is named there.
    const hide = args?.shown === true && hidingBehind(tools);
    const threads = threadsOf(state, query, { status: 'active' }).filter(thread => isOpen(thread) && thread.kind !== 'secret' && !(hide && BEHIND.has(thread.kind)));
    if (!threads.length) return null;
    const calendar = calendarFrom(settings, query);
    const minutes = state?.domains?.director?.time?.minutes;
    const now = Number.isInteger(minutes) ? minutes : null;
    let best = null;
    for (const thread of threads) {
        for (const field of DATE_FIELDS) {
            const when = text(thread.fields?.[field]);
            if (!when) continue;
            let parsed = null;
            try {
                parsed = calendar.parse(when, { reference: now });
            } catch {
                parsed = null;
            }
            if (!parsed || !Number.isFinite(parsed.abs)) continue;
            const at = Math.round(parsed.abs);
            if (!best || at < best.at) best = { thread, field, when, at, parsed };
        }
    }
    if (!best) return null;
    const { thread, field, when, at, parsed } = best;
    return {
        id: thread.id,
        key: text(thread.key),
        kind: thread.kind,
        summary: text(thread.summary),
        field,
        when,
        at,
        reached: reached(parsed, now, calendar),
    };
}

// ---------------------------------------------------------------------------------------------------
// The quest board

/** Story-told quests on the Home screen, using only Director threads. */
export function questBoard(state, _args, tools) {
    const quests = threadsOf(state, queryFrom(tools), { kind: 'quest', status: 'active' }).filter(isOpen);
    const row = thread => ({
        id: thread.id,
        key: text(thread.key),
        goal: text(thread.fields?.goal) || text(thread.summary),
        status: isOffer(thread) ? { state: 'offered', text: 'Offered' } : { state: 'active', text: 'Under way' },
        meter: false,
    });
    return { active: quests.filter(thread => !isOffer(thread)).map(row), offers: quests.filter(isOffer).map(row) };
}

const cut = (value, max) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

// ---------------------------------------------------------------------------------------------------
// Problems, in the reader's words

// v1's problem texts name the reader as the `{{user}}` macro. Without the host's substitution they read
// "you", with the few phrases where that changes the verb or pronoun put right.
const YOU = [
    [/\{\{user\}\}'s choice, and their message/gi, 'your choice, and your message'],
    [/\{\{user\}\} accepts/gi, 'you accept'],
    [/\{\{user\}\}'s/gi, 'your'],
    [/\{\{user\}\}/gi, 'you'],
];
export function readerWords(value, substitute = null) {
    let out = String(value ?? '');
    if (typeof substitute === 'function' && out.includes('{{')) {
        try {
            const named = substitute(out);
            if (typeof named === 'string') out = named;
        } catch { /* "you" below */ }
    }
    for (const [pattern, words] of YOU) out = out.replace(pattern, words);
    return out;
}

// A Problem about a passing state of a quest is shown only while that state lasts: "has no goal" while it
// is open with no goal (its `goal:` field). An older
// chat's "was offered, not taken on" is not shown: there is nothing to accept any more.
function stillSo(problem, director) {
    if (problem.kind === 'offered') return false;
    if (problem.kind !== 'no-goal') return true;
    const id = director?.keys?.[lineKey(text(problem.key))];
    const thread = id ? director?.threads?.[id] : null;
    if (!thread) return true;
    if (!isOpen(thread)) return false;
    return !text(thread.fields?.goal);
}

/**
 * `director.problems` → the last replies' Director problems, oldest first as kept: `[{ rev, kind, text }]`,
 * the text with `{{user}}` written out (the host's `tools.substitute` when there is one, else "you"). A
 * Problem about a missing goal is left out once the quest is given a goal or over; one about an offer, always.
 */
export function problemsList(state, args, tools) {
    const director = state?.domains?.director;
    const problems = problemList(director);
    const substitute = typeof tools?.substitute === 'function' ? tools.substitute : null;
    // `behind: true` / `false`: only those about a thread behind the scenes, or only the others.
    const behind = typeof args?.behind === 'boolean' ? args.behind : null;
    // The newest PROBLEM_SHOWN: the tracker keeps more than that (domain.js PROBLEM_ROOM).
    return problems.slice(-PROBLEM_SHOWN).filter(isRecord).filter(problem => stillSo(problem, director))
        .filter(problem => behind === null || isBehindProblem(problem, director) === behind).map(problem => ({
        rev: problem.rev ?? null,
        kind: text(problem.kind),
        text: readerWords(problem.text, substitute),
    }));
}

// ---------------------------------------------------------------------------------------------------
// Behind the scenes (reveal.js)

/** Whether the reader hides behind the scenes (the part's `hideBehind` setting; on unless set off). */
export function hidingBehind(tools) {
    try {
        return typeof tools?.settings === 'function' ? tools.settings()?.hideBehind !== false : true;
    } catch {
        return true;
    }
}

/** Whether a Director problem is about a thread behind the scenes (its key names an agenda, beat, clock or secret). */
export function isBehindProblem(problem, director) {
    const key = lineKey(String(problem?.key ?? ''));
    const keys = isRecord(director?.keys) ? director.keys : {};
    if (!key || !Object.hasOwn(keys, key)) return false;
    const threads = isRecord(director?.threads) ? director.threads : {};
    const id = keys[key];
    return Object.hasOwn(threads, id) && BEHIND.has(threads[id]?.kind);
}

// A thread as the behind-the-scenes list shows it; a secret by its name alone.
function behindThread(thread) {
    if (thread.kind === 'secret') return { id: thread.id, key: text(thread.key), summary: '', fields: {}, ended: null };
    const fields = {};
    for (const name of ['now', 'then', 'on', 'due', 'place', 'reach', 'shown', 'arrive', 'where', 'stepAt', 'stepOf', 'stepSince']) if (text(thread.fields?.[name])) fields[name] = text(thread.fields[name]);
    return { id: thread.id, key: text(thread.key), summary: text(thread.summary), fields, ended: thread.ended ? { outcome: text(thread.ended.outcome) } : null };
}

/**
 * `director.behind` → `{ kinds: [{ kind, title, open, closed }], problems, open, total }`: the threads behind
 * the scenes (agendas, clocks, beats, secrets: open ones and the closed ones), the problems about them, and
 * how many there are, for the Reveal panel (widget `story-director.behind`).
 */
export function behindView(state, args, tools) {
    const query = queryFrom(tools);
    const kinds = BEHIND_KINDS.map(([kind, title]) => ({
        kind,
        title,
        open: threadsOf(state, query, { kind, status: 'active', open: true }).filter(isRecord).map(behindThread),
        closed: threadsOf(state, query, { kind, status: 'resolved' }).filter(isRecord).map(behindThread),
    })).filter(group => group.open.length || group.closed.length);
    const open = kinds.reduce((sum, group) => sum + group.open.length, 0);
    const total = kinds.reduce((sum, group) => sum + group.open.length + group.closed.length, 0);
    return { kinds, problems: problemsList(state, { behind: true }, tools), open, total };
}

/**
 * An off-screen agenda's progress as its card draws it (the pulse's optional fields, written by code): `{ at, of, line, place, arriving }`, or
 * null when it has none. `line`: "step 3 of 4 · since Goldwane 19"; `arriving`: its `arrive` date is within the next hour (an ENTER_CHECK).
 */
export function agendaSteps(fields, { calendar = null, now = null, query = null } = {}) {
    const [at, of, since] = [fields?.stepAt, fields?.stepOf, fields?.stepSince].map(Number);
    const place = text(fields?.where) ? text(ask(query, 'atlas.line', { name: fields.where }, '')) || text(fields.where) : '';
    const arrive = calendar && Number.isSafeInteger(now) ? dateOf({ fields }, 'arrive', { calendar, reference: now }) : null;
    const arriving = Boolean(arrive?.hasTime) && arrive.abs >= now && arrive.abs - now <= 60;
    const steps = at > 0 ? `step ${at}${of > 0 ? ` of ${of}` : ''}` : '';
    const when = Number.isSafeInteger(since) && calendar ? `since ${calendar.format(since, { time: false, era: false })}` : '';
    if (!steps && !place && !arriving) return null;
    return { at: at > 0 ? at : 0, of: of > 0 ? of : 0, line: [steps, when].filter(Boolean).join(' · '), place, arriving };
}

/**
 * `director.plan` → `{ hooks, clocks, beats, agendas, secrets, problems, any }`: what the Director screen's cards show (the plan; spoilers):
 * the open hooks with their Next, and, while the feature `story-director.threads` is on, the open clocks (with Due), beats, agendas (off-screen) and
 * secrets (name only), then every problem, newest first (the ones about the visible threads, then those behind the scenes). Each thread is
 * `{ id, key, summary, fields }` as `director.behind` gives it.
 */
export function planView(state, args, tools, { settings = null } = {}) {
    const query = queryFrom(tools);
    const hooks = threadsOf(state, query, { kind: 'hook', status: 'active' }).filter(thread => isRecord(thread) && !thread.ended).map(behindThread);
    const behind = threadsOn(tools) ? behindView(state, args, tools) : { kinds: [], problems: [] };
    const open = kind => behind.kinds.find(group => group.kind === kind)?.open ?? [];
    const calendar = calendarFrom(settings, query);
    const now = state?.domains?.director?.time?.minutes;
    const agendas = open('agenda').map(agenda => ({ ...agenda, steps: agendaSteps(agenda.fields, { calendar, now, query }) }));
    // Newest first (the lists are kept oldest first), so a card's first rows are the latest reply's problems.
    const problems = [...problemsList(state, { behind: false }, tools).reverse(), ...[...behind.problems].reverse()];
    const view = { hooks, clocks: open('clock'), beats: open('beat'), agendas, secrets: open('secret'), problems };
    return { ...view, any: Object.values(view).some(list => list.length > 0) };
}

/** The part's queries; `settings` is the module's settings (a function or an object). */
const COORD_LIMIT = 1e7;
const WEATHER_CHARS = 80;
// {{user}}'s rank, what they wear and their condition (Story Block's `scene.you`, each at most 120 characters there).
const YOU_CHARS = 120;
const RANK_LABEL_CHARS = 30;

// A map coordinate as the card writes it: whole map units, '' when not a usable number.
const coordText = value => (Number.isFinite(value) && Math.abs(value) < COORD_LIMIT ? String(Math.round(value * 10) / 10) : '');

// The card's one-line summary, cut by code points (never inside a character).
const SUMMARY_CHARS = 80;
const summaryText = line => {
    const chars = Array.from(line);
    return chars.length > SUMMARY_CHARS ? `${chars.slice(0, SUMMARY_CHARS - 1).join('').trimEnd()}…` : line;
};

// The time of day as the card's one-line summary writes it: "1:30 pm" (no date, no leading zero).
export function clockText(calendar, minutes) {
    if (!calendar || !Number.isFinite(minutes)) return '';
    try {
        const day = Math.floor(calendar.fromAbs(minutes).minutes);
        const hour = Math.floor(day / 60);
        return `${hour % 12 || 12}:${String(day % 60).padStart(2, '0')} ${hour < 12 ? 'am' : 'pm'}`;
    } catch {
        return '';
    }
}

/**
 * The place's map position as text: its own, else its town's (the first part of the place line "Town · Spot", or of the scene's
 * name when the atlas does not have the place yet), so a spot with no point of its own still shows where it is.
 */
function coordsOf(query, here, placeName) {
    const has = place => isRecord(place) && coordText(place.x) && coordText(place.y);
    const own = isRecord(here) && text(here.id) ? ask(query, 'atlas.place', { id: here.id }, null) : null;
    if (has(own)) return [coordText(own.x), coordText(own.y)];
    const town = (text(here?.line) || placeName).split(/\s*(?:\||·|—|–)\s*/)[0];
    const up = town && town !== text(own?.name) ? ask(query, 'atlas.place', { name: town }, null) : null;
    return has(up) ? [coordText(up.x), coordText(up.y)] : ['', ''];
}

/**
 * `director.status` → what the reply's Status card adds to Story Block's scene, all of it {{user}}'s own
 * (world/known.js: where they are, the weather they stand in, their rank, what they wear and how they are): `{ summary, when, place, region, coords,
 * weather, rank, wearing, condition }`.
 * `when`: the story time as the Game view hero writes it ("CY 611, Goldwane 14, 6:00 pm"), for the card's Time row; '' while the clock is unset.
 * Display only: `director.time`'s `text` and the Director note keep their own words.
 * `summary`: the card's one line, "<clock time>, <place>" ("1:30 pm, Bluewatch Village"; each part is left out when the story has
 * not set it), for the one "This reply" line Story Block draws above the reply's cards.
 * `place`: the place line ("Auvoth · Southern Gatehouse": the atlas's `line`, else the scene's name); `region`: the place's own, else the scene's.
 * `coords`: the scene's place on the map ("59, 110", map units, one decimal: the atlas's or the pack's map data),
 * '' when the atlas does not know the place or has no position for it. `weather`: Story Block's
 * `scene.weather` (`{ text } | null`, the story's `~ weather <text>` line), '' when there is none or that
 * query is not there. `rank`, `rankLabel`, `wearing` and `condition`: Story Block's `scene.you` (`{ rank?, rankLabel?, wearing, condition } | null`, a Rank and its label only in a game whose pack gives one, the story's
 * `~ you rank: … | wearing: … | condition: …` line), '' for a part with no words, and all '' when Story Block is older than 2.10.0
 * (no such query) or has the feature off. Read on the state it is given, so each reply's card shows its own.
 */
export function statusExtras(state, _args, tools, { settings = null } = {}) {
    const query = queryFrom(tools);
    const minutes = state?.domains?.director?.time?.minutes;
    const calendar = Number.isSafeInteger(minutes) ? calendarFrom(settings, query) : null;
    const clock = calendar ? clockText(calendar, minutes) : '';
    let when = '';
    try { when = calendar ? heroDate(calendar, minutes) : ''; } catch { when = ''; }
    const placeName = text(state?.domains?.scene?.place?.name);
    const here = ask(query, 'atlas.here', {}, null);
    const [x, y] = coordsOf(query, here, placeName);
    // The atlas does not have a place the story has just named until the next send: its line is worked out from the name (atlas.line).
    const line = text(here?.line) || (placeName ? text(ask(query, 'atlas.line', { name: placeName }, '')) : '') || placeName;
    const weather = ask(query, 'scene.weather', {}, null);
    const you = ask(query, 'scene.you', {}, null);
    return {
        summary: summaryText([clock, line].filter(Boolean).join(', ')),
        when,
        place: cut(line, 80),
        region: cut(text(here?.region) || text(state?.domains?.scene?.place?.region), 80),
        coords: x && y ? `${x}, ${y}` : '',
        weather: isRecord(weather) ? cut(text(weather.text), WEATHER_CHARS) : '',
        // The Rank only where a pack gives the game one: Story Block answers `rankLabel` (its word for it) then, and no `rank` without it.
        rankLabel: isRecord(you) ? cut(text(you.rankLabel), RANK_LABEL_CHARS) : '',
        rank: isRecord(you) && text(you.rankLabel) ? cut(text(you.rank), YOU_CHARS) : '',
        wearing: isRecord(you) ? cut(text(you.wearing), YOU_CHARS) : '',
        condition: isRecord(you) ? cut(text(you.condition), YOU_CHARS) : '',
    };
}

export function screenQueries({ settings = null } = {}) {
    return {
        // The agendas, clocks, beats and secrets: the feature `story-director.threads`' (answers null while it is off, so the screen draws none).
        'director.behind': Object.assign((state, args, tools) => behindView(state, args, tools), { feature: THREADS_FEATURE }),
        // `{ on: true }` while the feature is on, null while it is off: the Director screen's World card and the World screen's News and Factions read it.
        // The Director screen's cards (planView).
        'director.plan': (state, args, tools) => planView(state, args, tools, { settings }),
        'director.threads.on': Object.assign(() => ({ on: true }), { feature: THREADS_FEATURE }),
        'director.goal': (state, args, tools) => currentGoal(state, args, tools),
        'quest.board': (state, args, tools) => questBoard(state, args, tools),
        'director.next': (state, args, tools) => nextDue(state, args, tools, { settings }),
        'director.problems': (state, args, tools) => problemsList(state, args, tools),
        'director.status': (state, args, tools) => statusExtras(state, args, tools, { settings }),
    };
}
