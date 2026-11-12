// Story Director v2, tracker part: folding old finished threads into one compact record each (pure: no ctx, no I/O).
//
// A long chat keeps every resolved thread in `director.threads` forever (about 0.7 to 0.9 KB each with its keys and
// writes). The fold takes the old ones that no prompt, screen, digest or score still reads in full, and keeps what
// the module reads from them as one record each, in `director.folded["<rev>"] = { rev, items }`: one bucket per fold
// run, under the fold receipt's own rev. The command (writers.js) reads the state, calls these functions and writes
// the result; this file only plans and reads.
//
// Rules (DESIGN-fold, with the review's required changes):
// * eligible: resolved, not a legacy read-only quest (`rpg`, `owed`, `ready`, `shown`), its closing stamped with a
//   Director reply count (`track.closed.turn`), and at least `after` replies (FOLD_AFTER, 200) since it closed;
// * kept: the newest `keep` resolved threads per kind (events: KEEP_EVENTS), the newest and the oldest done quest (legendEarned reads
//   them), and every thread of the newest arc (`arc`, its beats are still counted);
// * the chronicle's gate (`gate`, plain data from `chronicle.foldGate`): the digest must be on with no gap, the thread's
//   taken and ended receipts must sit in no kept chronicle range, and it must have closed before the digest's `through`
//   and outside any full digest day. Days are given as minute ranges (`fullMinutes`), not day numbers, so this file
//   needs no calendar;
// * a record keeps what the readers still use: giver and people; summary and difficulty for scored quests and hooks
//   (Ripples); the keys and aliases of behind-the-scenes threads (`hide`, so hidden names stay hidden), and `secret`.
//
// Imports only the changes grammar (`lineKey`) and convert.js (the thread order and the outcome list); no part.

import { lineKey } from '../../changes.js';
import { OUTCOMES, THREAD_KINDS, orderedThreads } from './convert.js';

export const FOLD_AFTER = 200;
export const KEEP_RESOLVED = 20;
export const KEEP_EVENTS = 30;
export const FOLD_RUN = 60;
export const FOLD_MIN = 10;
export const FOLDED_CEILING = 2000;
export const FOLD = 'director.fold';
export const FORGET = 'chronicle.forget';

// Read-only history from older chats: never folded (Ripples and the quests screen still read them whole).
const LEGACY = ['rpg', 'owed', 'ready', 'shown'];
// Kinds the reader's behind-the-scenes views hide by name (world/known.js `BEHIND`).
const BEHIND = new Set(['agenda', 'beat', 'clock', 'secret']);
// Outcomes Ripples scores (sway); other outcomes keep no summary or difficulty.
const SCORED = new Set(['done', 'failed', 'abandoned']);
const HIDE_ROOM = 12;
// `giver` and `people` are as long as the thread fields allow (600): a cut name would change what Ripples matches.
const LIMITS = Object.freeze({ key: 120, summary: 600, names: 80, giver: 600 });
const RECORD_FIELDS = ['id', 'kind', 'key', 'outcome', 'order', 'giver', 'people', 'summary', 'difficulty', 'hide', 'secret', 'goal', 'at'];
const THREAD_ID = /^th_[0-9a-z]{8}$/;
const BUCKET_KEY = /^\d+$/;

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isInt = value => Number.isSafeInteger(value);
const cut = (value, max) => [...String(value ?? '')].slice(0, max).join('');
const atLeast = (value, floor) => Math.max(floor, Math.floor(value));
const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const endedRev = thread => (isInt(thread.ended?.rev) ? thread.ended.rev : 0);
// Newest first by the receipt that ended the thread, then id: deterministic whatever order the state was built in.
const newestFirst = (a, b) => endedRev(b) - endedRev(a) || byId(a.id, b.id);
const isLegacy = thread => LEGACY.some(key => Boolean(thread[key]));
const turnOf = director => (isInt(director?.turn?.n) ? director.turn.n : 0);
const keepFor = (kind, keep) => keep ?? (kind === 'event' ? KEEP_EVENTS : KEEP_RESOLVED);

/** `director.keys` turned round: `Map(id → [name])`, names as stored (own key included). */
function aliasesById(director) {
    const names = new Map();
    for (const [name, id] of Object.entries(director?.keys ?? {})) {
        if (!names.has(id)) names.set(id, []);
        names.get(id).push(name);
    }
    return names;
}

/** The ids of the newest and the oldest done quest still live (what `legendEarned` reads once the rest is folded). */
export function doneWitnesses(director) {
    const done = orderedThreads(director).filter(thread => thread.status === 'resolved' && thread.kind === 'quest' && thread.ended?.outcome === 'done').sort(newestFirst);
    return [...new Set([done[0]?.id, done[done.length - 1]?.id].filter(Boolean))];
}

/** The chronicle's gate, as plain data (see the header). Closed without `on`, or with a gap, folds nothing. */
function gateHolds(gate, thread) {
    if (gate?.on !== true || gate.gap === true) return false;
    const time = thread.track?.closed?.time;
    if (!isInt(time) || !isInt(gate.throughMinutes) || time >= gate.throughMinutes) return false;
    if ((gate.fullMinutes ?? []).some(([lo, hi]) => time >= lo && time <= hi)) return false;
    const receipts = [thread.taken?.rev, thread.ended?.rev];
    return !(gate.ranges ?? []).some(([lo, hi]) => receipts.some(rev => isInt(rev) && rev >= lo && rev <= hi));
}

/**
 * The threads a fold may take, oldest first (by the receipt that ended them, then id). `turn` is the Director's reply
 * count now; `arc` the newest arc's id or null.
 */
export function foldCandidates(director, { turn = turnOf(director), gate, arc = null, after = FOLD_AFTER, keep = null } = {}) {
    const resolved = orderedThreads(director).filter(thread => thread.status === 'resolved' && thread.ended);
    const kept = new Set();
    const seen = new Map();
    for (const thread of [...resolved].sort(newestFirst)) {
        const count = seen.get(thread.kind) ?? 0;
        seen.set(thread.kind, count + 1);
        if (count < keepFor(thread.kind, keep)) kept.add(thread.id);
    }
    // Story Block's `legendEarned` reads a done quest: keep the newest and the oldest (the guard makes a fold depend on both staying done).
    for (const id of doneWitnesses(director)) kept.add(id);
    return resolved
        .filter(thread => !kept.has(thread.id) && !isLegacy(thread)
            && !(arc !== null && thread.track?.arc === arc)
            && isInt(thread.track?.closed?.turn) && isInt(turn) && turn - thread.track.closed.turn >= after
            && gateHolds(gate, thread))
        .sort((a, b) => -newestFirst(a, b));
}

/** The compact record a folded thread keeps (review change 4 and 5). `aliases`: the names that reach it, own key included. */
export function foldRecord(thread, aliases = []) {
    const fields = isRecord(thread.fields) ? thread.fields : {};
    const outcome = thread.ended?.outcome;
    const record = {
        id: thread.id,
        kind: thread.kind,
        key: cut(thread.key, LIMITS.key),
        outcome,
        order: isInt(thread.track?.order) ? thread.track.order : 0,
    };
    if (isInt(thread.ended?.at)) record.at = thread.ended.at;
    if (fields.giver) record.giver = cut(fields.giver, LIMITS.giver);
    if (fields.people) record.people = cut(fields.people, LIMITS.summary);
    if ((thread.kind === 'quest' || thread.kind === 'hook') && SCORED.has(outcome)) {
        record.summary = cut(thread.summary, LIMITS.summary);
        if (fields.difficulty) record.difficulty = cut(fields.difficulty, LIMITS.names);
    }
    if (BEHIND.has(thread.kind)) {
        const own = lineKey(thread.key) || thread.key;
        record.hide = [...new Set([own, ...aliases])].slice(0, HIDE_ROOM).map(name => cut(name, LIMITS.key));
    }
    if (thread.kind === 'secret') record.secret = true;
    // The Quests screen draws any thread with a goal as a card (quest-cards.js `isQuestThread`): its "Older" footer counts these.
    if (thread.kind !== 'quest' && fields.goal != null) record.goal = true;
    return record;
}

/**
 * The fold plan: `{ ids, items, keys, writes }`. `ids` are the folded thread ids (at most `max`, capped at FOLD_RUN);
 * `items` their records in that order; `keys` the `director.keys` names that point at them; `writes` the
 * `director.writes` ids whose result names one of them.
 */
export function planFold(director, { turn, gate, arc = null, after, keep, max = FOLD_RUN } = {}) {
    const limit = Math.min(FOLD_RUN, atLeast(max, 1));
    const picked = foldCandidates(director, {
        turn: turn ?? turnOf(director),
        gate,
        arc,
        after: atLeast(after ?? FOLD_AFTER, 1),
        keep: keep === undefined || keep === null ? null : atLeast(keep, 1),
    }).slice(0, limit);
    const ids = picked.map(thread => thread.id);
    const names = aliasesById(director);
    const items = picked.map(thread => foldRecord(thread, names.get(thread.id) ?? []));
    const chosen = new Set(ids);
    const keys = Object.entries(director?.keys ?? {}).filter(([, id]) => chosen.has(id)).map(([name]) => name);
    const writes = Object.entries(director?.writes ?? {}).filter(([, entry]) => chosen.has(entry?.result?.thread)).map(([write]) => write);
    return { ids, items, keys, writes };
}

const keyOf = item => lineKey(item.key) || item.key;
const buckets = director => Object.values(director?.folded ?? {}).sort((a, b) => (a?.rev ?? 0) - (b?.rev ?? 0));
const itemsOf = bucket => (Array.isArray(bucket?.items) ? bucket.items : []);

/**
 * Every folded record, in tracker order (`order`, then id); one record per key: a key folded twice (a thread made again under a
 * folded key gets a new id and may fold again) keeps the newest bucket's record only.
 */
export function foldedItems(director) {
    const newest = new Map();
    for (const bucket of buckets(director)) for (const item of itemsOf(bucket)) newest.set(keyOf(item), item);
    return [...newest.values()].sort((a, b) => (a.order - b.order) || byId(a.id, b.id));
}

/** The folded records no live thread has the key of again (a key made again is read from its live thread, not from the old record). */
export function olderItems(director) {
    return foldedItems(director).filter(item => !director?.threads?.[item.id] && !director?.keys?.[keyOf(item)]);
}

/** Whether a folded record was a Quests card (a quest, or a thread with a goal). */
export const isCardRecord = item => item.kind === 'quest' || item.goal === true;

/**
 * Story Block's `legendEarned` asks `director.threads { kind: 'quest' }` for a done quest. While none is live (the witnesses kept by the
 * fold were reopened) but an older done quest was folded, that answer gets one read-only stand-in, so reopening what the fold kept cannot
 * take the earned legendary away (the fold cannot depend on how many reopen). `[]` or `[thread]`.
 */
export function legendWitness(director) {
    const live = Object.values(director?.threads ?? {}).some(thread => thread?.kind === 'quest' && thread.ended?.outcome === 'done');
    const item = live ? null : olderItems(director).filter(entry => entry.kind === 'quest' && entry.outcome === 'done').pop();
    if (!item) return [];
    return [{ id: item.id, kind: 'quest', key: item.key, summary: item.summary ?? '', fields: {}, status: 'resolved', offer: false, taken: null,
        ended: { rev: 0, reason: 'folded', outcome: 'done' }, target: null, reward: null, rev: 0, folded: true }];
}

/** The names folded threads still hide: `behind` (every name a behind-the-scenes thread reached) and `words` (secrets' keys and aliases), from every record. */
export function foldedHidden(director) {
    const behind = new Set();
    const words = new Set();
    for (const item of buckets(director).flatMap(itemsOf)) {
        for (const name of item.hide ?? []) behind.add(name);
        if (item.secret) for (const name of item.hide ?? []) words.add(name);
    }
    return { behind, words };
}

/**
 * Folded quests and hooks as Ripples reads live ones (`key`, `giver`, `summary`, `outcome` when scored, `difficulty` raw, `at`). A record
 * whose id is a live thread again (the key was made again) is left out, as a reopened quest stops scoring its old outcome without a fold.
 */
export function foldedQuests(director) {
    return olderItems(director)
        .filter(item => item.kind === 'quest' || item.kind === 'hook')
        .map(item => ({
            key: item.key, name: item.key, giver: item.giver, summary: item.summary,
            outcome: SCORED.has(item.outcome) ? item.outcome : null, difficulty: item.difficulty, order: item.order, at: item.at ?? null,
        }));
}

/**
 * The newest arc's id read from the arc part's state slice (never through the feature-gated `director.arc`, which a replay guard may not
 * ask): the last of its arcs by rev, then id (the order the arc part's `currentArc` uses), or null.
 */
export function newestArcId(arcSlice) {
    const arcs = isRecord(arcSlice?.arcs) ? Object.values(arcSlice.arcs).filter(isRecord) : [];
    arcs.sort((a, b) => (a.rev ?? 0) - (b.rev ?? 0) || byId(a.id, b.id));
    return arcs.length ? (arcs[arcs.length - 1].id ?? null) : null;
}

/**
 * The hook's pre-check (the handler plans again, the same way): `{ type: FOLD, payload: {} }` when at least FOLD_MIN threads are old
 * enough and outside the keeps, the digest gate is open and the bucket room is not used up; else null.
 */
export function foldHook(view) {
    const director = view?.state?.domains?.director;
    if (!director || Object.keys(director.folded ?? {}).length >= FOLDED_CEILING) return null;
    if (Object.values(director.threads ?? {}).filter(thread => thread?.status === 'resolved').length < FOLD_MIN) return null;
    let gate = null;
    try {
        gate = typeof view.query === 'function' ? view.query('chronicle.foldGate', {}) : null;
    } catch {
        gate = null;
    }
    if (gate?.on !== true) return null;
    // The same plan the handler makes (same turn, gate and arc), so a cue is only sent when the handler has threads to take.
    return planFold(director, { gate, arc: newestArcId(view.state?.domains?.arc) }).ids.length >= FOLD_MIN ? { type: FOLD, payload: {} } : null;
}

/** The guard inputs for a fold: one hash over the folded threads' public projections in id order, the newest arc and the done-quest witnesses. */
export function foldGuardInputs(director, ids, arc, hashJson) {
    const sorted = [...ids].sort(byId);
    const threads = director?.threads ?? {};
    const projections = sorted.map(id => {
        const { track: _track, ...publicFields } = threads[id] ?? {};
        return publicFields;
    });
    return { ids: sorted, hash: hashJson(projections), arc: arc ?? null, witness: doneWitnesses(director) };
}

/**
 * Whether a fold's guard still holds: every id present and resolved, the same hash, the same newest arc (`arcNow`), the done-quest
 * witnesses still done (legendEarned reads a live done quest), and the chronicle's gate (`gate`, asked on the state before the block)
 * still open for every folded thread: an edit that took the digest operation away would otherwise leave a full day without them.
 */
export function foldGuardOk(director, inputs, arcNow, hashJson, gate = null) {
    if (!isRecord(inputs) || !Array.isArray(inputs.ids)) return false;
    if ((arcNow ?? null) !== (inputs.arc ?? null)) return false;
    const threads = director?.threads ?? {};
    if (!inputs.ids.every(id => threads[id]?.status === 'resolved' && gateHolds(gate, threads[id]))) return false;
    if (!(inputs.witness ?? []).every(id => threads[id]?.kind === 'quest' && threads[id].status === 'resolved' && threads[id].ended?.outcome === 'done')) return false;
    return foldGuardInputs(director, inputs.ids, inputs.arc, hashJson).hash === inputs.hash;
}

// A bucket that is frozen all the way down is checked once per object and key (as threadErrors does in domain.js).
const checkedBuckets = new WeakMap();

function recordErrors(at, item) {
    if (!isRecord(item) || Object.keys(item).some(key => !RECORD_FIELDS.includes(key))) return [`${at} has an item that is not a fold record.`];
    const errors = [];
    if (typeof item.id !== 'string' || !THREAD_ID.test(item.id)) errors.push(`${at} has a bad id.`);
    if (!THREAD_KINDS.includes(item.kind)) errors.push(`${at} has an unknown kind.`);
    if (!OUTCOMES.includes(item.outcome)) errors.push(`${at} has an unknown outcome.`);
    if (!isInt(item.order)) errors.push(`${at}.order must be a whole number.`);
    if (item.at !== undefined && !isInt(item.at)) errors.push(`${at}.at must be a whole number.`);
    const text = (value, max) => typeof value === 'string' && [...value].length <= max;
    if (!text(item.key, LIMITS.key) || item.key === '') errors.push(`${at}.key is not text.`);
    if (item.giver !== undefined && !text(item.giver, LIMITS.giver)) errors.push(`${at}.giver is not text.`);
    if (item.people !== undefined && !text(item.people, LIMITS.summary)) errors.push(`${at}.people is not text.`);
    if (item.summary !== undefined && !text(item.summary, LIMITS.summary)) errors.push(`${at}.summary is not text.`);
    if (item.difficulty !== undefined && !text(item.difficulty, LIMITS.names)) errors.push(`${at}.difficulty is not text.`);
    if (item.hide !== undefined && !(Array.isArray(item.hide) && item.hide.length <= HIDE_ROOM && item.hide.every(name => text(name, LIMITS.key)))) {
        errors.push(`${at}.hide must be at most ${HIDE_ROOM} names.`);
    }
    if (item.goal !== undefined && item.goal !== true) errors.push(`${at}.goal must be true.`);
    if (item.secret !== undefined && item.secret !== true) errors.push(`${at}.secret must be true.`);
    return errors;
}

function bucketErrorsOf(key, bucket) {
    const at = `director.folded.${key}`;
    if (!BUCKET_KEY.test(key)) return [`${at} has a bad key.`];
    if (!isRecord(bucket) || !isInt(bucket.rev) || String(bucket.rev) !== key || !Array.isArray(bucket.items)) {
        return [`${at} must be { rev, items } under its own rev.`];
    }
    if (bucket.items.length > 2 * FOLD_RUN) return [`${at}.items holds more than ${2 * FOLD_RUN} records.`];
    return bucket.items.flatMap(item => recordErrors(`${at}.items`, item));
}

function bucketErrors(key, bucket) {
    const frozen = isRecord(bucket) && Object.isFrozen(bucket) && Array.isArray(bucket.items) && Object.isFrozen(bucket.items)
        && bucket.items.every(item => Object.isFrozen(item));
    const known = frozen ? checkedBuckets.get(bucket) : undefined;
    if (known?.key === key) return known.errors;
    const errors = bucketErrorsOf(key, bucket);
    if (frozen) checkedBuckets.set(bucket, { key, errors });
    return errors;
}

/** Validator errors for `director.folded` (absent is fine). Shape: rev-keyed buckets, bounded items, closed record fields. */
export function foldedErrors(slice) {
    const folded = slice?.folded;
    if (folded === undefined) return [];
    if (!isRecord(folded)) return ['director.folded is not an object.'];
    const keys = Object.keys(folded);
    if (keys.length > FOLDED_CEILING) return [`director.folded must hold at most ${FOLDED_CEILING} buckets.`];
    return keys.flatMap(key => bucketErrors(key, folded[key]));
}
