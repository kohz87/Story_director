// The tracker: agendas, events, hooks, clocks, beats and secrets, built only from change
// lines. Because every change lives in the reply that made it, the tracker for any point in
// the chat is a replay of the entries up to it. Pure: every function returns new objects and
// never mutates its inputs (records are copied on write, unchanged ones are shared).

import { FIELDS, QUEST_TYPE_WORDS, formatOp, kindOf, lineKey, questDifficulty } from './changes.js';

const HISTORY_LIMIT = 20;
const SUPERSEDED = /supersed|replac|merged/i;
// A quest closed with one of these was not done: it ended without the work being finished.
const FAILED = /\b(?:fail|abandon|gave up|give up|given up|giving up|forfeit|quit\b|walked away|backed out|called off|withdr[eao]w|expired|missed|too late|cancel|refused|declined|botched)/i;
// (0.9.1) How a model says something is over without a `-` line: `~ Quest — step: done`,
// `status: completed`, `outcome: failed`. Only a value that is one of these words, alone or
// before punctuation ("completed — the wolves are dead"): "complete the ritual" is a step.
const OVER_VALUE = /^(?:done|complete|completed|finished|fulfilled|accomplished|resolved|succeeded|success|turned in|handed in|delivered|over|closed|failed|failure|abandoned|given up|gave up|forfeit|forfeited|quit|withdrawn|called off|expired|cancell?ed)\s*(?:$|[.,;:!—–(-])/i;
// The labels such a value comes under: any record's status or outcome, and a quest's step or now.
const OVER_LABELS = ['status', 'state', 'outcome', 'result', 'progress'];
const QUEST_OVER_FIELDS = ['step', 'now'];
// A `!` on a quest that says it was finished or failed ("! Sheep-killer — wolves slain, reward paid").
const QUEST_OVER_TEXT = /\b(?:complet|finish|fulfil|accomplish|done\b|turned in|handed in|reward(?:ed)?\s+(?:paid|collected|received|claimed)|paid out)/i;
// (0.9.13) A `-` that says the job was taken on, not ended: "- Hook Sheepfold Wolves — accepted
// by Wessel" beside the `+ quest` it became. Not when it also speaks of pay or an ending.
const TAKEN_ON = /\b(?:accept(?:s|ed)?|tak(?:es|en|ing) (?:on|up)|took (?:on|up)|signed (?:on|up|for)|agreed to|became (?:a |the )?(?:quest|bounty|contract|job)|(?:now|turned into|converted (?:in)?to|promoted to|upgraded to) (?:a |the )?(?:quest|bounty|contract|job))\b/i;
const NOT_TAKEN_ON = /\b(?:reward|paid|pay(?:ment)?|coin|silver|gold|copper|fee)\b/i;
const takenOn = reason => TAKEN_ON.test(reason) && !NOT_TAKEN_ON.test(reason) && !QUEST_OVER_TEXT.test(reason) && !FAILED.test(reason) && !LOOKS_OVER.test(reason);

// (0.9.5) A quest still open whose own progress reads as over ("step: wolf slain, reward
// collected"): finished or failed words in its step or now. Not its goal or description, which
// say what the job is ("complete the ritual").
const LOOKS_OVER = /\b(?:completed|finished|fulfilled|accomplished|done\b(?!\s+with)|turned in|handed in|delivered|reward(?:ed)?\s+(?:paid|collected|received|claimed)|paid out|failed|abandoned|gave up|given up|forfeit(?:ed)?|quit\b|walked away|backed out|called off|expired|too late)/i;

/** Whether an open quest's step or now says it is over, so the note can ask the story to close it. */
export function looksFinished(record) {
    if (record?.kind !== 'quest' || record.status !== 'active') return false;
    return ['step', 'now'].some(field => LOOKS_OVER.test(String(record.fields?.[field] ?? '')));
}

// (0.9.6) The reader's own message (or the reply's narration) saying a job is given up: a
// sentence with one of these and the quest's key, or its giver's name. Only ever a hint: the
// note asks the story to close it, nothing is closed here.
const GIVE_UP = /\b(?:give up|gave up|giving up|given up|forfeit(?:s|ed|ing)?|abandon(?:s|ed|ing)?|quit(?:s|ting)?|walk(?:s|ed|ing)? away from|back(?:s|ed|ing)? out of|call(?:s|ed|ing)? off|drop(?:s|ped|ping)? the (?:job|bounty|contract|quest|hunt|search))\b/i;
const NOT_BEFORE = /\b(?:not|never|won't|wont|don't|dont|didn't|didnt|wouldn't|can't|cannot|refuse to)\s+(?:\w+\s+){0,2}$/i;

/** The open quests a text says are given up, by key: [key], in tracker order. */
export function givenUpIn(tracker, text) {
    const sentences = String(text ?? '').split(/(?<=[.!?…])\s+|\n+/).filter(Boolean);
    const said = sentences.filter(sentence => {
        const match = GIVE_UP.exec(sentence);
        return match && !NOT_BEFORE.test(sentence.slice(0, match.index));
    });
    if (!said.length) return [];
    const names = record => [record.key, String(record.fields?.giver ?? '').trim()].filter(name => name.length >= 3);
    const named = (sentence, name) => new RegExp(`(?<![\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`, 'iu').test(sentence);
    return (tracker?.records ?? [])
        .filter(record => record.kind === 'quest' && record.status === 'active')
        .filter(record => said.some(sentence => names(record).some(name => named(sentence, name))))
        .map(record => record.key);
}

// (0.9.15) Choices about a job are the reader's: taking it on, turning it down, giving it up.
// The model's line for one counts only when the reader's own message (the one the reply answers)
// made it, naming the job (its key, its giver or a word of its name). The story keeps the
// outcomes: done, failed, expired. A main quest is the story's to give, and a job the story
// moves on (a step under way) is one the character is already doing.
const ACCEPT_WORDS = /\b(?:accept(?:s|ed|ing)?|take (?:it|this|that|the|on|up)|takes (?:it|the|on|up)|took (?:it|the|on|up)|taking (?:it|the|on|up)|i'?ll (?:take|do|handle)|i will (?:take|do|handle)|agree(?:s|d)? to|sign(?:s|ed)? (?:up|on)|count me in|i'?m in|deal|choose|chose|pick(?:s|ed)?)\b/i;
const REFUSE_WORDS = /\b(?:refuse[sd]?|refusing|declin(?:e|es|ed|ing)|turn(?:s|ed|ing)? (?:it |that |this |them )?down|no thanks|pass(?:es|ed)? on|not interested)\b/i;
// A closing reason that is the reader's decision rather than the story's outcome.
const CHOSEN_END = /\b(?:abandon|gave up|give up|given up|giving up|forfeit|quit\b|walked away|backed out|withdr[eao]w|refus|declin|turned down|passed on)/i;
// Words of a job's name too general to say which job is meant.
const GENERIC_WORDS = new Set(['quest', 'job', 'jobs', 'contract', 'bounty', 'task', 'work', 'mission', 'favour', 'favor', 'side', 'main']);
// A step that has not started is not the story moving a job on.
const NOT_STARTED = /^\s*(?:0\s*(?:\/|of)\s*\d+|0|none|not (?:yet )?started|pending|unstarted)\b/i;

const sentencesOf = text => String(text ?? '').split(/(?<=[.!?…\]])\s+|\n+/).filter(Boolean);

function namesJob(sentence, record) {
    const words = keyWords(record.key).filter(word => word.length >= 3 && !GENERIC_WORDS.has(word));
    const names = [record.key, String(record.fields?.giver ?? '').trim(), ...words].filter(name => name.length >= 3);
    // A name as written, or with a plural ending: wolf/wolves, bounty/bounties, rat/rats.
    const pattern = name => {
        const body = escapeRegExp(normalizeQuotes(name)).replace(/\s+/g, '\\s+');
        if (/f$/i.test(name)) return `${body.slice(0, -1)}(?:f|ves)`;
        if (/y$/i.test(name)) return `${body.slice(0, -1)}(?:y|ies)`;
        return `${body}(?:s|es)?`;
    };
    return names.some(name => new RegExp(`(?<![\\p{L}\\p{N}])${pattern(name)}(?![\\p{L}\\p{N}])`, 'iu').test(normalizeQuotes(sentence)));
}

/**
 * Whether `said` (the reader's message) makes a choice about `record` with `words`: a sentence
 * with one of them, not negated, naming the job, or any such sentence when `alone` (it is the
 * only job in question).
 */
function saidAbout(said, record, words, { alone = false } = {}) {
    return sentencesOf(said).some(sentence => {
        const match = words.exec(sentence);
        if (!match || NOT_BEFORE.test(sentence.slice(0, match.index))) return false;
        return alone || namesJob(sentence, record);
    });
}

const isJob = record => BECOMES_QUEST.has(record.kind)
    && (JOB_FIELDS.some(name => String(record.fields?.[name] ?? '').trim()) || isQuestType(record.fields?.type));

/** (0.9.15) An offer: a job (a giver, a reward or a quest type) the reader has not taken on yet. */
export function isOffer(record) {
    return record?.status === 'active' && isJob(record);
}

/** The offers `text` (the reader's message) takes on, or turns down: [key], in tracker order. */
export function offersChosenIn(tracker, text, choice = 'accept') {
    const offers = (tracker?.records ?? []).filter(isOffer);
    const words = choice === 'refuse' ? REFUSE_WORDS : ACCEPT_WORDS;
    return offers.filter(record => saidAbout(text, record, words, { alone: offers.length === 1 })).map(record => record.key);
}

/** What a `~` (or a quest's `!`) says when it means the record is over, or null. */
function overByChange(record, op) {
    if (op.op === '!') {
        if (record.kind !== 'quest') return null;
        const said = [op.reason, ...Object.values(op.fields ?? {}), ...Object.values(op.extra ?? {})].map(value => String(value ?? '')).join(' ');
        return QUEST_OVER_TEXT.test(said) || FAILED.test(said) ? (op.reason || said).trim() : null;
    }
    for (const label of OVER_LABELS) {
        const value = String(op.extra?.[label] ?? '').trim();
        if (OVER_VALUE.test(value)) return value;
    }
    if (record.kind === 'quest' || takesOnQuest(record, op)) {
        for (const field of QUEST_OVER_FIELDS) {
            const value = String(op.fields?.[field] ?? '').trim();
            if (OVER_VALUE.test(value)) return value;
        }
    }
    return null;
}
const MIN_PERSON_LENGTH = 3;

// Matching a key that is not tracked to the record it most likely means (v0.8.3): the words
// that tell keys apart, without a leading article or the small words models swap freely.
const LEADING_ARTICLES = new Set(['the', 'a', 'an']);
const CONNECTIVES = new Set(['in', 'at', 'of', 'on', 'to', 'for', 'from', 'the', 'and']);
// One key's words inside the other's counts only when the shorter has this many words.
const MIN_CONTAINED_WORDS = 2;
const MIN_WORD_OVERLAP = 0.75;
// A `~` on a key that is not tracked, with something to say, becomes a record of this kind.
const UNTRACKED_KIND = 'hook';
// (0.9.14) Keys that only label a line, a block or a kind ("! Encounter — the wolves attack",
// "~ Quest — …"): they name no record, so a line under one is skipped quietly instead of being
// a warning, and the next note never asks the model to add them.
const LABEL_KEYS = new Set(['encounter', 'encounters', 'fight', 'combat', 'battle', 'scene', 'director', 'world state', 'note', 'notes', 'summary', 'status', 'update', 'updates', 'change', 'changes', 'event', 'events', 'record', 'records']);
const isLabelKey = id => LABEL_KEYS.has(id) || Boolean(kindOf(id));
// What the next note may say about ignored lines: at most this many, from the latest reply.
const MAX_UNTRACKED_CORRECTIONS = 3;

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
        // History entries are never edited, only appended, so they can be shared.
        history: [...record.history],
    };
}

function finding(kind, severity, op, message, extra = {}) {
    return { kind, severity, key: op.key ?? null, message, ...extra };
}

/** The words a key is matched by: lineKey's, less a leading article and small connectives. */
export function keyWords(key) {
    const words = lineKey(key).split(' ').filter(Boolean);
    while (words.length && LEADING_ARTICLES.has(words[0])) words.shift();
    return words.filter(word => !CONNECTIVES.has(word));
}

function sameWords(left, right) {
    return left.join(' ') === right.join(' ');
}

// One word set inside the other (the shorter of at least two words), or a Jaccard overlap
// of at least 0.75.
function closeWords(left, right) {
    const a = new Set(left);
    const b = new Set(right);
    const [small, large] = a.size <= b.size ? [a, b] : [b, a];
    const shared = [...small].filter(word => large.has(word)).length;
    if (shared === small.size && small.size >= MIN_CONTAINED_WORDS) return true;
    const union = a.size + b.size - shared;
    return union > 0 && shared / union >= MIN_WORD_OVERLAP;
}

/**
 * The active records a key that is not tracked may mean, as `[{ record, index }]` (index into
 * `records`): those with the same words (case, punctuation, a leading article and small words
 * like in/at/of ignored) or, only when there are none, those whose words contain or are
 * contained in the key's (two words or more) or overlap by 3/4. One entry is a match; more
 * are ambiguous and none is to be guessed.
 */
export function nearMatches(records, key) {
    const words = keyWords(key);
    if (!words.length) return [];
    const active = (records ?? [])
        .map((record, index) => ({ record, index, words: keyWords(record.key) }))
        .filter(entry => entry.record.status === 'active' && entry.words.length);
    for (const close of [sameWords, closeWords]) {
        const found = active.filter(entry => close(words, entry.words));
        if (found.length) return found.map(({ record, index }) => ({ record, index }));
    }
    return [];
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

// Work {{user}} took on (0.8.6): a hook or event that a `~` names a quest (`type: quest`, or a
// category such as bounty), or that is a job — it has, or the `~` gives it, a giver, a reward or
// a quest category — and the `~` moves it on (a giver, reward, goal, step or difficulty). So
// `~ Wolf pelts — step: tracking the pack` on a hook the planner offered with its reward makes
// the bounty a quest (0.9.4), while a step on a plain thread ("River stranger") does not
// (0.9.2: models write `step:` for any progress). Beats are the world's, never a quest.
const BECOMES_QUEST = new Set(['hook', 'event']);
const JOB_FIELDS = ['giver', 'reward'];
const MOVES_ON = ['giver', 'reward', 'goal', 'step', 'difficulty'];

const isQuestType = value => {
    const type = lineKey(value ?? '');
    return type === 'quest' || Object.hasOwn(QUEST_TYPE_WORDS, type);
};

function takesOnQuest(record, op) {
    if (!BECOMES_QUEST.has(record.kind)) return false;
    const fields = op.fields ?? {};
    if (isQuestType(fields.type)) return true;
    const given = name => String(fields[name] ?? '').trim();
    const job = JOB_FIELDS.some(name => given(name) || String(record.fields?.[name] ?? '').trim()) || isQuestType(record.fields?.type);
    return job && MOVES_ON.some(given);
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
    record.history = [...record.history, { message: at.message, op: op.op, text }].slice(-HISTORY_LIMIT);
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
        history: [],
    };
    applyFields(record, op);
    touch(record, op, at);
    return record;
}

/**
 * Applies ops for one reply. A `~`, `-` or `!` on a key that is not tracked goes to the one
 * active record it plainly means (nearMatches); failing that, a `~` that carries something
 * becomes a new hook, and anything else is reported and ignored.
 * Returns `{ tracker, problems }`; `tracker.message`/`time` move to this reply.
 */
export function applyOps(tracker, ops, { message, time = null, said, chosen = [] } = {}) {
    const records = [...tracker.records];
    // (0.9.15) With the reader's message given (null: there was none), their choices are theirs.
    const gated = said !== undefined;
    const quests = (ops ?? []).filter(op => op.op === '+' && op.kind === 'quest');
    const accepts = (record, op = null) => !gated
        || lineKey(op?.fields?.type ?? record.fields?.type ?? '') === 'main'
        || saidAbout(said, record, ACCEPT_WORDS, { alone: quests.length === 1 && (!op || quests.includes(op)) });
    // `chosen`: records the reader gave up with the Abandon flag (ids stamped on the reply).
    const picked = new Set((chosen ?? []).map(key => lineKey(key)));
    const chose = record => picked.has(record.id) || picked.has(lineKey(record.key))
        || saidAbout(said, record, GIVE_UP, { alone: false }) || saidAbout(said, record, REFUSE_WORDS, { alone: false });
    const offered = (op, record) => problems.push(finding('offered', 'info', op, `"${record.key}" was offered, not taken on: it stays an offer until {{user}} accepts it.`));
    const indexById = new Map(records.map((record, index) => [record.id, index]));
    const copied = new Set();
    const problems = [];
    const at = { message, time };

    // Copy a record the first time this call changes it, so the input stays untouched.
    const edit = index => {
        if (!copied.has(index)) {
            records[index] = cloneRecord(records[index]);
            copied.add(index);
        }
        return records[index];
    };

    for (const op of ops ?? []) {
        const id = op.id || lineKey(op.key);
        if (!id) continue;
        const index = indexById.get(id);

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
                indexById.set(id, records.length);
                copied.add(records.length);
                records.push(newRecord(added, at));
                continue;
            }
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
                    problems.push(finding('duplicate-add', 'info', op,
                        `"${op.key}" is already tracked; the + was applied as a change.`));
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
        if (target === undefined && isLabelKey(id)) {
            problems.push(finding('label-key', 'info', op, `"${op.key}" is a label, not a record; the ${op.op} line was skipped.`));
            continue;
        }
        if (target === undefined) {
            // A key that is not tracked: the one record it plainly means, else (for a `~` with
            // something to say) a new record, else the line is ignored and the next note says so.
            const near = nearMatches(records, op.key);
            if (near.length === 1) {
                target = near[0].index;
                problems.push(finding('near-key', 'info', op, `"${op.key}" read as "${near[0].record.key}".`));
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
        // (0.9.1) A change that says the record is over closes it, as its `-` would have.
        // (0.9.7) Closing what is already closed changes nothing: the record keeps the reply that
        // first closed it, so a model repeating "- Quest — done" later never finishes it twice
        // (RPG Battle's quest XP follows the reply a quest was closed in).
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
        if (over !== null) {
            const { status: _s, state: _st, outcome: _o, result: _r, progress: _p, ...extra } = op.extra ?? {};
            const fields = Object.fromEntries(Object.entries(op.fields ?? {}).filter(([name, value]) => !(QUEST_OVER_FIELDS.includes(name) && OVER_VALUE.test(String(value ?? '').trim()))));
            applyFields(record, { ...op, fields, extra });
            record.status = 'resolved';
            record.resolved = { ...at, reason: over };
            problems.push(finding('closed-by-change', 'info', op, `"${record.key}" read as finished ("${over}"); "- ${record.key} — ${over}" says it directly.`));
            touch(record, op, at);
            continue;
        }
        if (op.op === '~') {
            let change = op;
            const moving = ['step', 'now'].some(name => String(op.fields?.[name] ?? '').trim() && !NOT_STARTED.test(String(op.fields[name])));
            if (takesOnQuest(record, op) && gated && !moving && !accepts(record)) {
                offered(op, record);
            } else if (takesOnQuest(record, op)) {
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

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeQuotes(text) {
    return text.replace(/[’‘]/g, '\'');
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
        if (entry.ops?.length) {
            const result = applyOps(tracker, entry.ops, entry.said === undefined ? at : { ...at, said: entry.said, chosen: entry.chosen ?? [] });
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

/** The record with this key or id (markdown and punctuation ignored), or null. */
export function findRecord(tracker, keyOrId) {
    const id = lineKey(keyOrId);
    if (!id) return null;
    return tracker.records.find(record => record.id === id) ?? null;
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
