// Story Director v2, tracker part: the `director` domain's shape, validator and queries (pure).
//
// director = {
//   time:    { minutes: null | int },             // story clock on the reader's calendar
//   threads: { [id]: thread },                    // MODULES §C1
//   keys:    { [lineKey(key) or alias]: id },
//   problems:[{ rev, kind, text, … }],            // newest last; up to 100 kept, the newest 50 shown
//   (a quest thread may also carry `ready: { rev }`, F83, and an offer `shown: { turn }`, F88)
//   turn:    { n, reply, index, from, quests, lone }, // the reply whose Director lines are being read
// }
// `turn` is this part's own: v1's rules count replies (a record changed in the last three
// replies is relevant; a `- hook` beside the `+ quest` of the same reply is not an ending), and
// capture hands lines over one at a time.

import { lineKey } from '../../changes.js';
import { OUTCOMES, THREAD_KINDS, orderedThreads } from './convert.js';
import { calendarConfig, calendarOf, packCalendarOf, settingsFrom } from './time.js';

export const PROBLEM_LIMIT = 50;
/** How long the list grows before it is cut back to the newest PROBLEM_LIMIT (see capture.js addProblem). */
export const PROBLEM_ROOM = 2 * PROBLEM_LIMIT;
const THREAD_ID = /^th_[0-9a-z]{8}$/;
const TARGET_KINDS = ['foes', 'items'];

export function initialDirector() {
    return {
        time: { minutes: null },
        threads: {},
        keys: {},
        problems: [],
        turn: { n: 0, reply: null, index: -1, from: null, quests: [], lone: null },
    };
}

const isInt = value => Number.isSafeInteger(value);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function threadErrors(id, thread) {
    const errors = [];
    const at = `director.threads.${id}`;
    if (!isRecord(thread)) return [`${at} is not a thread.`];
    if (!THREAD_ID.test(id) || thread.id !== id) errors.push(`${at} has a bad id.`);
    if (!THREAD_KINDS.includes(thread.kind)) errors.push(`${at} has an unknown kind "${thread.kind}".`);
    if (typeof thread.key !== 'string' || !lineKey(thread.key)) errors.push(`${at} has no key.`);
    if (typeof thread.summary !== 'string') errors.push(`${at}.summary is not text.`);
    if (!isRecord(thread.fields) || Object.values(thread.fields).some(value => typeof value !== 'string')) errors.push(`${at}.fields must hold text.`);
    if (!['active', 'resolved'].includes(thread.status)) errors.push(`${at}.status must be active or resolved.`);
    if (typeof thread.offer !== 'boolean') errors.push(`${at}.offer must be true or false.`);
    if (thread.taken !== null && !(isRecord(thread.taken) && isInt(thread.taken.rev))) errors.push(`${at}.taken must be null or { rev }.`);
    if (thread.ended !== null && !(isRecord(thread.ended) && isInt(thread.ended.rev) && typeof thread.ended.reason === 'string' && OUTCOMES.includes(thread.ended.outcome))) {
        errors.push(`${at}.ended must be null or { rev, reason, outcome }.`);
    }
    if ((thread.status === 'resolved') !== (thread.ended !== null)) errors.push(`${at} is ${thread.status} but ended is ${thread.ended ? 'set' : 'empty'}.`);
    const target = thread.target;
    if (target !== null && !(isRecord(target) && typeof target.noun === 'string' && isInt(target.count) && target.count >= 0 && TARGET_KINDS.includes(target.kind))) {
        errors.push(`${at}.target must be null or { noun, count, kind }.`);
    }
    const reward = thread.reward;
    if (reward !== null && !(isRecord(reward) && (reward.amount === null || (isInt(reward.amount) && reward.amount >= 0))
        && typeof reward.each === 'boolean' && typeof reward.unit === 'string' && typeof reward.text === 'string')) {
        errors.push(`${at}.reward must be null or { amount, each, unit, text }.`);
    }
    if (!isInt(thread.rev) || thread.rev < 0) errors.push(`${at}.rev must be a whole number.`);
    // F83: the story said the goal is met; F88: the reply an offer is shown from.
    if (thread.ready !== undefined && thread.ready !== null && !(isRecord(thread.ready) && isInt(thread.ready.rev))) errors.push(`${at}.ready must be null or { rev }.`);
    if (thread.shown !== undefined && !(isRecord(thread.shown) && isInt(thread.shown.turn) && thread.shown.turn >= 0)) errors.push(`${at}.shown must be { turn }.`);
    if (thread.track !== undefined && !isRecord(thread.track)) errors.push(`${at}.track must be an object.`);
    return errors;
}

/** `validate(slice, state) → string[]` (SPEC §2.5). */
export function validateDirector(slice) {
    if (!isRecord(slice)) return ['director is not an object.'];
    const errors = [];
    const minutes = slice.time?.minutes;
    if (!isRecord(slice.time) || !(minutes === null || isInt(minutes))) errors.push('director.time.minutes must be null or whole minutes.');
    if (!isRecord(slice.threads)) errors.push('director.threads is not an object.');
    else for (const [id, thread] of Object.entries(slice.threads)) errors.push(...threadErrors(id, thread));
    if (!isRecord(slice.keys)) errors.push('director.keys is not an object.');
    else {
        for (const [name, id] of Object.entries(slice.keys)) {
            if (!Object.hasOwn(slice.threads ?? {}, id)) errors.push(`director.keys["${name}"] points at no thread.`);
        }
        for (const thread of Object.values(slice.threads ?? {})) {
            if (thread?.key && slice.keys[lineKey(thread.key)] !== thread.id) errors.push(`"${thread.key}" is missing from director.keys.`);
        }
    }
    if (!Array.isArray(slice.problems) || slice.problems.length > PROBLEM_ROOM) errors.push(`director.problems must be a list of at most ${PROBLEM_ROOM}.`);
    else if (slice.problems.some(problem => !isRecord(problem) || typeof problem.kind !== 'string' || typeof problem.text !== 'string' || !isInt(problem.rev))) {
        errors.push('director.problems entries need rev, kind and text.');
    }
    const turn = slice.turn;
    if (!isRecord(turn) || !isInt(turn.n) || turn.n < 0 || !Array.isArray(turn.quests) || !(turn.from === null || isInt(turn.from)) || !(turn.lone === null || isRecord(turn.lone))) {
        errors.push('director.turn is malformed.');
    }
    return errors;
}

// Plain copies: nothing a caller changes reaches the state.
const copy = value => structuredClone(value);
const plain = thread => {
    const { track: _track, ...rest } = thread;
    return copy(rest);
};

// The chat's calendar for a query: the tracker's settings as module.js hands them to its queries
// (`tools.settings()`, defaults without it) and the packs' calendar through `tools.query`.
function queryCalendar(tools) {
    const settings = settingsFrom(typeof tools?.settings === 'function' ? tools.settings() : null);
    return { settings, pack: packCalendarOf(typeof tools?.query === 'function' ? tools.query : null) };
}

export const queries = {
    /**
     * `{ minutes, text }`: the story time (null until the story sets it) and that time written on the
     * chat's calendar ("Goldwane 12, 611, 06:40 am"; '' while unset).
     */
    'director.time': (state, _args, tools) => {
        const minutes = state?.domains?.director?.time?.minutes ?? null;
        if (!Number.isInteger(minutes)) return { minutes: null, text: '' };
        const { settings, pack } = queryCalendar(tools);
        let text = '';
        try { text = calendarOf(settings, pack).format(minutes); } catch { text = ''; }
        return { minutes, text };
    },
    /**
     * The calendar the chat runs on, as plain data (calendar.js normalizeCalendar's shape: `preset`,
     * `era`, `months: [{ name, days }]`, `leapYears`, `week`, …): the reader's own, else the first
     * enabled pack's, else Gregorian. Other parts make it a calendar with calendar.js makeCalendar.
     */
    'director.calendar': (_state, _args, tools) => {
        const { settings, pack } = queryCalendar(tools);
        return calendarConfig(settings, pack);
    },
    /** Threads in tracker order, filtered by `kind`, `status` and `offer` when given. */
    'director.threads': (state, { kind = null, status = null, offer = null } = {}) => orderedThreads(state?.domains?.director)
        .filter(thread => (!kind || thread.kind === kind) && (!status || thread.status === status) && (offer === null || thread.offer === offer))
        .map(plain),
    /** One thread by `id`, or by `key` (its own or a name it was reached by), else null. */
    'director.thread': (state, { key = null, id = null } = {}) => {
        const director = state?.domains?.director;
        const found = id ? director?.threads?.[id] : director?.threads?.[director?.keys?.[lineKey(key ?? '')]];
        return found ? plain(found) : null;
    },
};
