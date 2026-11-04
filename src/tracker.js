// The tracker: agendas, events, hooks, clocks, beats and secrets, built only from change
// lines. Because every change lives in the reply that made it, the tracker for any point in
// the chat is a replay of the entries up to it. Pure: every function returns new objects and
// never mutates its inputs (records are copied on write, unchanged ones are shared).

import { FIELDS, QUEST_TYPE_WORDS, formatOp, kindOf, lineKey, questDifficulty } from './changes.js';
import { nearMatches } from './tracker-words.js';
import { ACCEPT_WORDS, AGREE_WORDS, BECOMES_QUEST, CHOSEN_END, FAILED, GIVE_UP, LOOKS_OVER, OVER_VALUE, QUEST_OVER_FIELDS, QUEST_OVER_TEXT, REFUSE_WORDS, TIME_FAIL, allJobsIn, closingReason, endsJob, escapeRegExp, isJob, isOffer, namesJob, normalizeQuotes, offersInQuestion, overByChange, overStep, saidAbout, sentencesOf, takenOn, takesOnQuest, waitsForPay } from './tracker-said.js';
// Moved to tracker-words.js and tracker-said.js; re-exported so every importer of this path keeps working.
export { keyWords, nearMatches } from './tracker-words.js';
export { waitsForPay, looksFinished, givenUpIn, isOffer, offersChosenIn } from './tracker-said.js';

const HISTORY_LIMIT = 20;
const SUPERSEDED = /supersed|replac|merged/i;
// A step that has not started is not the story moving a job on.
const NOT_STARTED = /^\s*(?:0\s*(?:\/|of)\s*\d+|0|none|not (?:yet )?started|pending|unstarted)\b/i;
const MIN_PERSON_LENGTH = 3;
// A `~` on a key that is not tracked, with something to say, becomes a record of this kind.
const UNTRACKED_KIND = 'hook';
// (0.9.14) Keys that only label a line, a block or a kind ("! Encounter — the wolves attack",
// "~ Quest — …"): they name no record, so a line under one is skipped quietly instead of being
// a warning, and the next note never asks the model to add them.
const LABEL_KEYS = new Set(['encounter', 'encounters', 'fight', 'combat', 'battle', 'scene', 'director', 'world state', 'note', 'notes', 'summary', 'status', 'update', 'updates', 'change', 'changes', 'event', 'events', 'record', 'records']);
const isLabelKey = id => LABEL_KEYS.has(id) || Boolean(kindOf(id));
// What the next note may say about ignored lines: at most this many, from the latest reply.
const MAX_UNTRACKED_CORRECTIONS = 3;
// (0.9.19) The other names a record was reached by, newest kept: enough for a model's drift.
const MAX_ALIASES = 8;

export function emptyTracker() {
    return { version: 1, records: [], message: -1, time: null };
}

function blankFields() {
    return Object.fromEntries(FIELDS.map(name => [name, '']));
}

function cloneRecord(record) {
    return {
        ...record,
        fields: { ...record.fields },
        extra: { ...record.extra },
        created: { ...record.created },
        changed: { ...record.changed },
        seen: { ...record.seen },
        resolved: record.resolved ? { ...record.resolved } : null,
        legSince: record.legSince ? { ...record.legSince } : null,
        // (0.9.19) A tracker saved before aliases has none.
        aliases: [...(record.aliases ?? [])],
        // History entries are never edited, only appended, so they can be shared.
        history: [...record.history],
    };
}

function finding(kind, severity, op, message, extra = {}) {
    return { kind, severity, key: op.key ?? null, message, ...extra };
}

// Whether an op has anything to write: a field, or a part, with a value.
function hasContent(op) {
    return [...Object.values(op.fields ?? {}), ...Object.values(op.extra ?? {})].some(value => String(value ?? '').trim());
}

// The record a `~` on a key that is not tracked becomes: a hook, unless its `type:` names a
// kind (`type: clock`; a quest category such as `type: bounty` makes a quest of that type).
function untrackedRecordOp(op, id) {
    const word = lineKey(op.fields?.type ?? '');
    const named = kindOf(word);
    const fields = { ...op.fields };
    // The type was the kind; only a quest's own category (bounty, contract…) stays its type.
    if (named && (named !== 'quest' || word === 'quest' || word === 'quests')) delete fields.type;
    // A job by its parts (0.9.4): who it is for or what it pays.
    const job = !named && ['giver', 'reward'].some(name => String(fields[name] ?? '').trim());
    return { ...op, id, kind: named || (job ? 'quest' : UNTRACKED_KIND), fields };
}

function withArticle(word) {
    return `${/^[aeiou]/.test(word) ? 'an' : 'a'} ${word}`;
}

// Records whose leg changed in the op being applied; `touch` stamps when the leg was set, so
// an arrival can be checked against the pace from that moment (a copied leg keeps its time).
const legChanged = new WeakSet();

function applyFields(record, op) {
    const legBefore = record.fields.leg;
    for (const [name, value] of Object.entries(op.fields ?? {})) {
        if (FIELDS.includes(name)) record.fields[name] = String(value ?? '');
    }
    for (const [label, value] of Object.entries(op.extra ?? {})) {
        // The arc a planned record belongs to is identity, not a part to show.
        if (label === 'arc') record.arc = String(value ?? '') || null;
        else record.extra[label] = String(value ?? '');
    }
    if (record.fields.leg !== legBefore) legChanged.add(record);
}

// Every applied op counts as the record being seen, and leaves a trace of the line itself.
function touch(record, op, at) {
    if (legChanged.has(record)) {
        legChanged.delete(record);
        record.legSince = record.fields.leg ? { ...at } : null;
    } else if (!record.fields.leg) {
        record.legSince = null;
    }
    record.changed = { ...at };
    record.seen = { ...at };
    const text = op.raw || formatOp(op);
    // (0.9.30) With its time, so the Journal can date it once the message is behind a checkpoint.
    record.history = [...record.history, { message: at.message, op: op.op, text, time: at.time ?? null }].slice(-HISTORY_LIMIT);
}

function newRecord(op, at) {
    const record = {
        key: op.key,
        id: op.id || lineKey(op.key),
        // parseChanges always infers a kind for `+`; this covers hand-built ops.
        kind: op.kind || 'event',
        status: 'active',
        fields: blankFields(),
        extra: {},
        created: { ...at },
        changed: { ...at },
        seen: { ...at },
        resolved: null,
        legSince: null,
        pinned: false,
        arc: null,
        aliases: [],
        history: [],
    };
    applyFields(record, op);
    touch(record, op, at);
    return record;
}

// (0.9.19) The names records were once reached by (their aliases), each to its record's
// index: a name that is a record's own id is that record's, and a name two records hold
// belongs to the first in tracker order, so a replay always reads it the same way.
function aliasIndexOf(records, indexById) {
    const index = new Map();
    records.forEach((record, at) => {
        for (const alias of record.aliases ?? []) {
            if (!indexById.has(alias) && !index.has(alias)) index.set(alias, at);
        }
    });
    return index;
}

/**
 * Applies ops for one reply. A `~`, `-` or `!` on a key that is not tracked goes to the one
 * active record it plainly means (nearMatches); failing that, a `~` that carries something
 * becomes a new hook, and anything else is reported and ignored. (0.9.19) A key read so is
 * remembered on the record (an alias), and a later line with it, `+` included, is that record's
 * as its own key would be, with no further finding.
 * Returns `{ tracker, problems }`; `tracker.message`/`time` move to this reply.
 */
// `direct` (Story Director v2): the story's `+ quest` is the reader's acceptance, so a job is never
// held as an offer; a hook or event becomes a quest only by `+ quest` (or a `-` that says it was taken
// on), never by a `~` that gives it a giver or a reward, and closing a hook never makes it a quest.
export function applyOps(tracker, ops, { message, time = null, said, chosen = [], taken = [], direct = false } = {}) {
    const records = [...tracker.records];
    // (0.9.15) With the reader's message given (null: there was none), their choices are theirs.
    const gated = said !== undefined;
    const quests = (ops ?? []).filter(op => op.op === '+' && op.kind === 'quest');
    const alone = op => quests.length === 1 && (!op || quests.includes(op));
    // (0.9.32) "Took down all three contracts": the offers shown last, or that many of them.
    const all = gated ? allJobsIn(said) : null;
    const inQuestion = new Set(all ? offersInQuestion(records, message, all.count).map(record => record.id) : []);
    const among = record => {
        if (!all) return false;
        const tracked = records.find(other => other.id === record.id || lineKey(other.key) === lineKey(record.key));
        return tracked ? inQuestion.has(tracked.id) : true;
    };
    // (0.9.33) `taken`: offers the reader took on with the Take on button (ids stamped on the reply).
    const tookOn = new Set((taken ?? []).map(key => lineKey(key)));
    const accepts = (record, op = null) => direct || !gated
        || tookOn.has(record.id) || tookOn.has(lineKey(record.key))
        || lineKey(op?.fields?.type ?? record.fields?.type ?? '') === 'main'
        || saidAbout(said, record, ACCEPT_WORDS, { alone: alone(op), among: among(record) })
        || (alone(op) && saidAbout(said, record, AGREE_WORDS, { alone: true }));
    // (0.9.27) Whether the reader has spoken of a job: in this reply's message, or before.
    const spokenOf = record => !gated || Boolean(record.engaged) || sentencesOf(said).some(sentence => namesJob(sentence, record));
    // `chosen`: records the reader gave up with the Abandon flag (ids stamped on the reply).
    const picked = new Set((chosen ?? []).map(key => lineKey(key)));
    const chose = record => picked.has(record.id) || picked.has(lineKey(record.key))
        || saidAbout(said, record, GIVE_UP, { alone: false, among: among(record) }) || saidAbout(said, record, REFUSE_WORDS, { alone: false, among: among(record) });
    const offered = (op, record) => problems.push(finding('offered', 'info', op, `"${record.key}" was offered, not taken on: it stays an offer until {{user}} accepts it.`));
    // (0.9.27) An offer the story closes as done ("! Barrow-Viper Clearing — skins turned in to
    // Verna") was done by {{user}}, who went and did it without the words to take it on: when
    // they have spoken of it, it closes as their quest finished. Failed, given up or lapsed, it
    // stays the offer it was.
    const doneOffer = (record, reason, op) => {
        if (direct || !isOffer(record) || !QUEST_OVER_TEXT.test(reason) && !LOOKS_OVER.test(reason)) return;
        if (FAILED.test(reason) || CHOSEN_END.test(reason) || !spokenOf(record)) return;
        record.kind = 'quest';
        problems.push(finding('done-offer', 'info', op, `"${record.key}" was offered and the story says it is done: it is a quest {{user}} finished.`));
    };
    const indexById = new Map(records.map((record, index) => [record.id, index]));
    let aliasIndex = aliasIndexOf(records, indexById);
    // A record by its id, else by a name it was reached by before.
    const lookup = id => indexById.get(id) ?? aliasIndex.get(id);
    const copied = new Set();
    const problems = [];
    const at = { message, time };
    // (0.9.20) Records this reply names with `+ quest`: a `-` on one of them in the same reply
    // closes the hook it was, not the job just taken on.
    const questNow = new Set();

    // Copy a record the first time this call changes it, so the input stays untouched.
    const edit = index => {
        if (!copied.has(index)) {
            records[index] = cloneRecord(records[index]);
            copied.add(index);
        }
        return records[index];
    };
    // (0.9.19) Remember a made-up name a line reached a record by, so the next line with it is
    // that record at once, not matched (and noted) again. The newest names are kept.
    const remember = (index, id) => {
        if (lookup(id) !== undefined) return;
        const record = edit(index);
        const aliases = [...(record.aliases ?? []), id];
        record.aliases = aliases.slice(-MAX_ALIASES);
        if (aliases.length > MAX_ALIASES) aliasIndex = aliasIndexOf(records, indexById);
        else aliasIndex.set(id, index);
    };

    // (0.9.27) An offer the reader's message names is one they have spoken of: it is given the
    // story's grace before it lapses (lapses.js), and done by the story it is their quest.
    if (gated && said) {
        records.forEach((record, index) => {
            if (!record.engaged && isOffer(record) && sentencesOf(said).some(sentence => namesJob(sentence, record))) edit(index).engaged = { ...at };
        });
    }

    for (const line of ops ?? []) {
        // (0.9.28) "- Key — failed: deadline passed" reads its label as a part, leaving no reason:
        // the closing's words are the reason, so a failure is never read as done.
        const op = line.op === '-' ? { ...line, reason: closingReason(line) } : line;
        const id = op.id || lineKey(op.key);
        if (!id) continue;
        const index = lookup(id);

        if (op.op === '+') {
            // One arc at a time: a new arc closes the one before it.
            if ((op.kind === 'arc') && (index === undefined || records[index].status !== 'active')) {
                records.forEach((other, otherIndex) => {
                    if (other.kind !== 'arc' || other.status !== 'active' || otherIndex === index) return;
                    const closed = edit(otherIndex);
                    closed.status = 'superseded';
                    closed.resolved = { ...at, reason: 'a new arc began' };
                    touch(closed, { ...op, op: '-', raw: `- ${closed.key} — a new arc began` }, at);
                });
            }
            if (index === undefined) {
                let added = { ...op, id };
                if (op.kind === 'quest' && !accepts({ key: op.key, fields: op.fields ?? {} }, op)) {
                    added = { ...added, kind: 'hook' };
                    offered(op, added);
                }
                if (op.kind === 'quest') questNow.add(records.length);
                indexById.set(id, records.length);
                copied.add(records.length);
                records.push(newRecord(added, at));
                continue;
            }
            if (op.kind === 'quest') questNow.add(index);
            const record = edit(index);
            if (record.status === 'active') {
                // (0.9.9) "+ quest Key" on a hook or event already tracked (one the planner
                // offered) is the job taken on: it becomes the quest, as a ~ with its parts does.
                if (op.kind === 'quest' && BECOMES_QUEST.has(record.kind) && !accepts(record, op)) {
                    offered(op, record);
                } else if (op.kind === 'quest' && BECOMES_QUEST.has(record.kind)) {
                    problems.push(finding('became-quest', 'info', op, `"${record.key}" was ${withArticle(record.kind)}; it is a quest now.`));
                    record.kind = 'quest';
                } else {
                    const as = record.id === id ? '' : ` as "${record.key}"`;
                    problems.push(finding('duplicate-add', 'info', op,
                        `"${op.key}" is already tracked${as}; the + was applied as a change.`));
                }
                applyFields(record, op);
            } else {
                problems.push(finding('reopened', 'info', op,
                    `"${op.key}" was ${record.status}; it is active again.`));
                // A reopened record is described afresh, so stale dates from before it was
                // closed cannot make it due at once. Identity, history and pin are kept.
                record.kind = op.kind === 'quest' && !accepts({ key: record.key, fields: op.fields ?? {} }, op) ? 'hook' : op.kind || record.kind;
                record.status = 'active';
                record.resolved = null;
                record.fields = blankFields();
                record.extra = {};
                applyFields(record, op);
            }
            touch(record, op, at);
            continue;
        }

        let target = index;
        // (0.9.20) "- hook Lone Grey Wolf": a kind word in front of a tracked key names the form
        // the line is about ("the hook"), it is not part of the key.
        if (target === undefined) {
            const kinded = String(op.key ?? '').match(/^([A-Za-z]+)\s+(\S.*)$/s);
            if (kinded && kindOf(kinded[1])) target = lookup(lineKey(kinded[2]));
        }
        if (target === undefined && isLabelKey(id)) {
            problems.push(finding('label-key', 'info', op, `"${op.key}" is a label, not a record; the ${op.op} line was skipped.`));
            continue;
        }
        if (target === undefined) {
            // A key that is not tracked: the one record it plainly means, else (for a `~` with
            // something to say) a new record, else the line is ignored and the next note says so.
            const near = nearMatches(records, op.key, op.op === '+' ? null : op.lineKind ?? null);
            if (near.length === 1) {
                target = near[0].index;
                problems.push(finding('near-key', 'info', op, `"${op.key}" read as "${near[0].record.key}".`));
                remember(target, id);
            } else if (op.op === '~' && !near.length && hasContent(op) && overByChange({ kind: 'quest', fields: {} }, op) !== null) {
                // (0.9.27) "~ North Levee Vipers — step: completed" on nothing tracked: there is
                // nothing left to track, so no record is made for it.
                problems.push(finding('unknown-key', 'info', op, `"${op.key}" is not tracked and reads as over; the ~ line was ignored.`, { op: op.op }));
                continue;
            } else if (op.op === '~' && !near.length && hasContent(op)) {
                const added = untrackedRecordOp(op, id);
                indexById.set(id, records.length);
                copied.add(records.length);
                records.push(newRecord(added, at));
                problems.push(finding('untracked-added', 'info', op,
                    `"${op.key}" was not tracked; added as ${withArticle(added.kind)} (write "+ kind Key" to set its kind).`));
                continue;
            } else {
                // A `-` of something never tracked does no harm, so it is only worth a note.
                const severity = op.op === '-' ? 'info' : 'warn';
                const candidates = near.map(entry => entry.record.key);
                const could = candidates.length ? ` (it could be ${candidates.map(key => `"${key}"`).join(' or ')})` : '';
                problems.push(finding('unknown-key', severity, op,
                    `"${op.key}" is not tracked${could}; the ${op.op} line was ignored.`,
                    { op: op.op, ...(candidates.length ? { candidates } : {}) }));
                continue;
            }
        }

        const record = edit(target);
        // (0.9.13) A job taken on is not over: the `-` turns a hook or event into the quest, and
        // on a quest (most often the `+ quest` just above it) it changes nothing.
        if (op.op === '-' && record.status === 'active' && takenOn(String(op.reason ?? ''))) {
            if (BECOMES_QUEST.has(record.kind) && !accepts(record)) {
                offered(op, record);
            } else if (BECOMES_QUEST.has(record.kind)) {
                problems.push(finding('became-quest', 'info', op, `"${record.key}" was ${withArticle(record.kind)}; it is a quest now.`));
                record.kind = 'quest';
                touch(record, op, at);
            } else {
                problems.push(finding('taken-on', 'info', op, `"${record.key}" was taken on, not ended; it stays open.`));
            }
            continue;
        }
        // (0.9.20) "+ quest Key" then "- hook Key — <what the hook was>": the hook made way for the
        // quest, so the quest stays open. Only a reason that says the job is over or failed ends it.
        if (op.op === '-' && record.status === 'active' && questNow.has(target) && !endsJob(String(op.reason ?? ''))) {
            problems.push(finding('taken-on', 'info', op, `"${record.key}" was taken on, not ended; it stays open.`));
            continue;
        }
        // (0.9.1) A change that says the record is over closes it, as its `-` would have.
        // (0.9.7) Closing what is already closed changes nothing: the record keeps the reply that
        // first closed it, so a model repeating "- Quest — done" later never finishes it twice.
        const closing = op.op === '-' || ((op.op === '~' || op.op === '!') && overByChange(record, op) !== null);
        if (closing && record.status !== 'active') {
            problems.push(finding('already-closed', 'info', op, `"${record.key}" is already ${record.status}; the line changed nothing.`));
            continue;
        }
        const over = (op.op === '~' || op.op === '!') ? overByChange(record, op) : null;
        // (0.9.15) Giving a job up or turning it down is the reader's choice, not the model's.
        const ending = op.op === '-' ? String(op.reason ?? '') : over;
        if (gated && closing && ending !== null && CHOSEN_END.test(ending) && (record.kind === 'quest' || isJob(record)) && !chose(record)) {
            problems.push(finding('not-chosen', 'info', op, `"${record.key}" stays open: giving it up or turning it down is {{user}}'s choice, and their message did not make it.`));
            continue;
        }
        // (0.9.28) The work done and the pay waiting, a quest is not failed for the hour passing.
        if (closing && ending !== null && record.kind === 'quest' && FAILED.test(ending) && TIME_FAIL.test(ending) && waitsForPay(record)) {
            problems.push(finding('pay-waiting', 'info', op, `"${record.key}" stays open: its work is done and only the pay is left, which a passed time does not take away.`));
            continue;
        }
        if (over !== null) {
            const { status: _s, state: _st, outcome: _o, result: _r, progress: _p, ...extra } = op.extra ?? {};
            const fields = Object.fromEntries(Object.entries(op.fields ?? {}).filter(([name, value]) => !(QUEST_OVER_FIELDS.includes(name) && (OVER_VALUE.test(String(value ?? '').trim()) || overStep(String(value ?? '').trim(), op)))));
            applyFields(record, { ...op, fields, extra });
            doneOffer(record, over, op);
            record.status = 'resolved';
            record.resolved = { ...at, reason: over };
            problems.push(finding('closed-by-change', 'info', op, `"${record.key}" read as finished ("${over}"); "- ${record.key} — ${over}" says it directly.`));
            touch(record, op, at);
            continue;
        }
        if (op.op === '~') {
            let change = op;
            const moving = ['step', 'now'].some(name => String(op.fields?.[name] ?? '').trim() && !NOT_STARTED.test(String(op.fields[name])));
            // (0.9.33) An offer taken on with the button: any ~ on it in that reply makes it the quest.
            const button = BECOMES_QUEST.has(record.kind) && (tookOn.has(record.id) || tookOn.has(lineKey(record.key)));
            if (direct) {
                // A hook stays a hook until the story writes `+ quest` for it.
            } else if (takesOnQuest(record, op) && gated && !moving && !accepts(record)) {
                offered(op, record);
            } else if (takesOnQuest(record, op) || button) {
                problems.push(finding('became-quest', 'info', op, `"${record.key}" was ${withArticle(record.kind)}; it is a quest now.`));
                record.kind = 'quest';
                // `type: quest` only said what it is; a category (bounty, contract…) stays its type.
                const type = lineKey(op.fields?.type ?? '');
                const { type: _type, ...rest } = op.fields ?? {};
                if (type === 'quest') change = { ...op, fields: rest };
                else if (Object.hasOwn(QUEST_TYPE_WORDS, type)) change = { ...op, fields: { ...op.fields, type: QUEST_TYPE_WORDS[type] } };
            }
            applyFields(record, change);
        } else if (op.op === '-') {
            applyFields(record, op);
            if (!SUPERSEDED.test(op.reason ?? '')) doneOffer(record, String(op.reason ?? ''), op);
            record.status = SUPERSEDED.test(op.reason ?? '') ? 'superseded' : 'resolved';
            record.resolved = { ...at, reason: op.reason ?? '' };
        } else if (op.op === '!') {
            const given = Object.keys(op.fields ?? {}).length > 0;
            applyFields(record, op);
            if (!given) {
                // What was next has happened. With no `then`, `now` is still the best we know.
                if (record.fields.then) record.fields.now = record.fields.then;
                record.fields.then = '';
                record.fields.on = '';
            }
            if (record.kind === 'clock') {
                record.status = 'resolved';
                record.resolved = { ...at, reason: 'fired' };
            }
        } else {
            continue;
        }
        touch(record, op, at);
    }

    return {
        tracker: { ...tracker, records, message: message ?? tracker.message, time: time ?? tracker.time },
        problems,
    };
}

function namesOf(record) {
    const people = String(record.fields?.people ?? '')
        .split(',')
        .map(name => name.trim())
        .filter(name => name.length >= MIN_PERSON_LENGTH);
    return [record.key, ...people].filter(Boolean);
}

// Whole words only ("Ren" is not in "Renata"), any run of whitespace between words.
function mentionPattern(name) {
    const body = normalizeQuotes(name).trim().split(/\s+/).map(escapeRegExp).join('\\s+');
    return new RegExp(`(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`, 'iu');
}

/** Records whose key or a `people` name appears in `text` get `seen = { message, time }`. */
export function markSeen(tracker, text, { message, time = null } = {}) {
    const haystack = normalizeQuotes(String(text ?? ''));
    if (!haystack.trim()) return { ...tracker, records: [...tracker.records] };
    const records = tracker.records.map(record => {
        const mentioned = namesOf(record).some(name => mentionPattern(name).test(haystack));
        return mentioned ? { ...record, seen: { message, time } } : record;
    });
    return { ...tracker, records };
}

/**
 * Rebuilds the tracker from chat entries `[{ message, ops, text, time }]` in chat order.
 * Each problem carries the message index it came from in `message`; its description moves
 * to `text` (a Finding's own `message`).
 */
export function replay(entries, { seed = null } = {}) {
    let tracker = seed ?? emptyTracker();
    const problems = [];
    for (const entry of entries ?? []) {
        // A reply without a readable time keeps the last known one rather than forgetting it.
        const time = entry.time ?? tracker.time;
        const at = { message: entry.message, time };
        if (entry.text) tracker = markSeen(tracker, entry.text, at);
        // (0.9.27) A reply with no change lines still reads the reader's message (offers spoken of).
        if (entry.ops?.length || (typeof entry.said === 'string' && entry.said)) {
            const result = applyOps(tracker, entry.ops, {
                ...at, ...(entry.said === undefined ? {} : { said: entry.said }),
                chosen: entry.chosen ?? [], taken: entry.taken ?? [],
            });
            tracker = result.tracker;
            for (const problem of result.problems) {
                problems.push({ ...problem, text: problem.message, message: entry.message });
            }
        }
        tracker = { ...tracker, message: entry.message, time };
    }
    return { tracker, problems };
}

/**
 * Lines for the next note's `Corrections:` from the problems of the latest reply only: each
 * `~` or `!` line that changed nothing because its key is not tracked, once per key, at most
 * `limit`. With `message`, only replay problems from that message count, so an older reply's
 * lines are never corrected again. A `-` of something never tracked needs no correction.
 */
export function untrackedCorrections(problems, { message, limit = MAX_UNTRACKED_CORRECTIONS } = {}) {
    const seen = new Set();
    const lines = [];
    for (const problem of problems ?? []) {
        if (lines.length >= limit) break;
        if (problem?.kind !== 'unknown-key' || (problem.op !== '~' && problem.op !== '!')) continue;
        if (message !== undefined && problem.message !== message) continue;
        const key = String(problem.key ?? '').trim();
        const id = lineKey(key);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const candidates = (problem.candidates ?? []).slice(0, 2);
        lines.push(candidates.length
            ? `"${key}" is not tracked: use its exact key (${candidates.map(other => `"${other}"`).join(' or ')}) or add it with "+ kind ${key} — …".`
            : `"${key}" is not tracked: add it with "+ kind ${key} — …" before changing it.`);
    }
    return lines;
}

// (0.9.19) A closed quest's own reason, read for the Journal: given up is the reader's choice,
// failed is the story's, anything else is done.
const ABANDONED = /\b(?:abandon|gave up|give up|given up|giving up|forfeit|quit\b|walked away|backed out|withdr[eao]w)/i;

/** How a closed quest ended: 'done' | 'failed' | 'abandoned', or null (open, or merged into another). */
export function questOutcome(record) {
    if (record?.kind !== 'quest' || record.status !== 'resolved') return null;
    const reason = String(record.resolved?.reason ?? '');
    if (ABANDONED.test(reason)) return 'abandoned';
    return FAILED.test(reason) ? 'failed' : 'done';
}

/**
 * The record with this key or id (markdown and punctuation ignored), or null. (0.9.19) Failing
 * that, the record a line once reached by this name (an alias), as applyOps reads it.
 */
export function findRecord(tracker, keyOrId) {
    const id = lineKey(keyOrId);
    if (!id) return null;
    const records = tracker?.records ?? [];
    return records.find(record => record.id === id)
        ?? records.find(record => (record.aliases ?? []).includes(id))
        ?? null;
}

export function activeRecords(tracker, { kind = null } = {}) {
    return tracker.records.filter(record => record.status === 'active' && (!kind || record.kind === kind));
}

/**
 * The quests finished in the reply at `message`: closed there with a `-` line that is not a
 * failure (failed, abandoned, expired…) or a supersession, as `[{ id, name, type, difficulty,
 * reward, giver }]` plain copies; quests finished earlier are not listed.
 */
export function questsDoneIn(tracker, message) {
    const at = Number(message);
    if (!Number.isInteger(at)) return [];
    const text = value => String(value ?? '').trim();
    return (tracker?.records ?? [])
        .filter(record => record.kind === 'quest' && record.status === 'resolved'
            && record.resolved?.message === at && !FAILED.test(record.resolved?.reason ?? ''))
        .map(record => ({
            id: record.id,
            name: record.key,
            type: text(record.fields?.type),
            difficulty: questDifficulty(record.fields?.difficulty),
            reward: text(record.fields?.reward),
            giver: text(record.fields?.giver),
        }));
}
