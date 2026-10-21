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
// The calendar (for "what comes due next") is the reader's: the tracker part's calendar setting, read
// through an injected settings function (by default Story Block's `sdk.settings('story-director')`),
// else the Gregorian one.

import { PRESETS, makeCalendar, normalizeCalendar } from '../../calendar.js';

const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
// Fields that hold a date the story can reach (v1 relevance.js DATE_FIELDS).
const DATE_FIELDS = ['due', 'on', 'arrive'];
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
    const quests = threadsOf(state, queryFrom(tools), { kind: 'quest', status: 'active' }).filter(thread => isOpen(thread) && !isOffer(thread));
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

function calendarFrom(settings) {
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
    const threads = threadsOf(state, queryFrom(tools), { status: 'active' }).filter(thread => isOpen(thread) && thread.kind !== 'secret');
    if (!threads.length) return null;
    const calendar = calendarFrom(settings);
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

// Whole-word names: "Fenna" is "Fenna the miller". The same reading as the quests part's place
// rule (src/v2/quests/progress.js placeRule), which `quest.finish` enforces; this is only the hint.
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

function placeReason(thread, scene) {
    if (text(scene?.place?.kind).toLowerCase() === 'settlement') return '';
    const giver = text(thread?.fields?.giver);
    const present = Array.isArray(scene?.present) ? scene.present : [];
    if (giver && present.some(name => samePersonName(giver, name))) return '';
    return giver ? `Turn it in at a settlement or where ${giver} is.` : 'Turn it in at a settlement.';
}

/**
 * Whether Finish can be pressed now: `{ show, blocked, reason }`. Shown only when code can count the
 * quest's target; blocked, with the reason in plain words, until it is taken on, its target is met and
 * the story is where it can be turned in (the quests part's rules, which `quest.finish` checks again).
 */
export function finishState(thread, progress, scene) {
    if (!progress || !(progress.need > 0)) return { show: false, blocked: true, reason: '' };
    let reason = '';
    if (!thread.taken) reason = 'Take it on first: fights count from then.';
    else if (!progress.met) reason = text(progress.reason) || 'Not done yet.';
    else if (isRecord(progress.finish)) reason = progress.finish.ok === false ? text(progress.finish.reason) || 'It cannot be turned in here.' : '';
    else reason = placeReason(thread, scene);
    return { show: true, blocked: Boolean(reason), reason };
}

const OUTCOME_TEXT = Object.freeze({ done: 'Done', failed: 'Failed', abandoned: 'Given up', declined: 'Turned down', superseded: 'Replaced' });

function rewardOf(thread) {
    return text(thread.reward?.text) || text(thread.fields?.reward);
}

function progressOf(query, thread) {
    const value = ask(query, 'quest.progress', { id: thread.id }, null);
    if (!isRecord(value)) return null;
    const need = Number.isSafeInteger(value.need) ? value.need : 0;
    const have = Number.isSafeInteger(value.have) ? value.have : 0;
    return {
        have,
        need,
        met: value.met === true,
        source: value.source ?? null,
        label: text(value.label) || (need > 0 ? `${have}/${need}` : ''),
        reason: text(value.reason),
        ...(isRecord(value.finish) ? { finish: { ok: value.finish.ok !== false, reason: text(value.finish.reason) } } : {}),
    };
}

/**
 * `quest.board` → the Quests screen's lists:
 * `{ offers: [{ id, key, goal, giver, reward, due }],
 *    active: [{ id, key, goal, step, giver, reward, due, taken, canTake, progress, meter,
 *               finish: { show, blocked, reason, title } }],
 *    finished: [{ id, key, outcome, outcomeText, reason }]  (latest first, at most FINISHED_SHOWN),
 *    finishedCount, hasOffers, hasActive, hasFinished }`.
 * `progress` is `quest.progress` (`{ have, need, met, label, reason, source }`) or null; `meter` is true
 * when it has a target to draw.
 */
export function questBoard(state, args, tools) {
    const query = queryFrom(tools);
    const quests = threadsOf(state, query, { kind: 'quest' });
    const scene = state?.domains?.scene ?? null;
    const byKey = (a, b) => text(a.key).localeCompare(text(b.key)) || (a.id < b.id ? -1 : 1);
    const offers = quests.filter(isOffer).sort(byKey).map(thread => ({
        id: thread.id,
        key: text(thread.key),
        goal: text(thread.fields?.goal) || text(thread.summary),
        giver: text(thread.fields?.giver),
        reward: rewardOf(thread),
        due: text(thread.fields?.due),
    }));
    const active = quests.filter(thread => isOpen(thread) && !isOffer(thread)).sort(byKey).map(thread => {
        const progress = progressOf(query, thread);
        const finish = finishState(thread, progress, scene);
        return {
            id: thread.id,
            key: text(thread.key),
            goal: text(thread.fields?.goal) || text(thread.summary),
            step: text(thread.fields?.step),
            giver: text(thread.fields?.giver),
            reward: rewardOf(thread),
            due: text(thread.fields?.due),
            taken: Boolean(thread.taken),
            canTake: !thread.taken,
            progress,
            meter: Boolean(progress && progress.need > 0),
            finish: { ...finish, title: finish.reason || `Turn in ${text(thread.key)}` },
        };
    });
    const closed = quests.filter(thread => !isOpen(thread))
        .sort((a, b) => (b.ended?.rev ?? b.rev ?? 0) - (a.ended?.rev ?? a.rev ?? 0) || byKey(a, b));
    const finished = closed.slice(0, FINISHED_SHOWN).map(thread => {
        const outcome = thread.ended?.outcome ?? 'done';
        return { id: thread.id, key: text(thread.key), outcome, outcomeText: OUTCOME_TEXT[outcome] ?? 'Closed', reason: text(thread.ended?.reason) };
    });
    return {
        offers,
        active,
        finished,
        finishedCount: closed.length,
        hasOffers: offers.length > 0,
        hasActive: active.length > 0,
        hasFinished: closed.length > 0,
    };
}

/** The part's queries; `settings` is the module's settings (a function or an object). */
export function screenQueries({ settings = null } = {}) {
    return {
        'director.goal': (state, args, tools) => currentGoal(state, args, tools),
        'director.next': (state, args, tools) => nextDue(state, args, tools, { settings }),
        'quest.board': (state, args, tools) => questBoard(state, args, tools),
    };
}
