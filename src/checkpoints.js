// Story Director: checkpoints, the tracker kept at the back of the chat (pure).
//
// (0.9.30) The tracker is a replay of every reply's change lines, so it depended on every old
// message still being there. A checkpoint is one copy of the tracker as it stood after a reply
// some way back, kept in the chat's metadata: the tracker is that copy plus the replies after
// it, so hiding, summarising away or deleting the messages before it changes nothing. Swiping,
// editing or deleting a reply after it rolls back as before. A few are kept, one every
// CHECKPOINT_EVERY replies, so a rollback past the newest falls back on an older one; past all
// of them the tracker is rebuilt from the messages that are left.

// Replies a checkpoint trails the newest by: what a swipe, edit or delete can still change.
export const CHECKPOINT_TRAIL = 10;
// Replies between two checkpoints.
export const CHECKPOINT_EVERY = 10;
export const CHECKPOINTS_KEPT = 4;

const shiftAt = (at, delta) => (at && Number.isInteger(at.message) ? { ...at, message: at.message + delta } : at);

/**
 * The tracker with every message number moved by `delta`: a checkpoint read back after
 * messages before it were deleted (its reply is now `delta` places earlier or later).
 */
export function shiftTracker(tracker, delta) {
    if (!tracker || !delta) return tracker;
    return {
        ...tracker,
        message: Number.isInteger(tracker.message) ? tracker.message + delta : tracker.message,
        records: (tracker.records ?? []).map(record => ({
            ...record,
            created: shiftAt(record.created, delta),
            changed: shiftAt(record.changed, delta),
            seen: shiftAt(record.seen, delta),
            resolved: shiftAt(record.resolved, delta),
            legSince: shiftAt(record.legSince, delta),
            ...(record.engaged ? { engaged: shiftAt(record.engaged, delta) } : {}),
            history: (record.history ?? []).map(entry => shiftAt(entry, delta)),
        })),
    };
}

// What a closed record's history is still read for: what fired (the Journal), when it was
// added or first shown (the Journal's sign). The rest is how it got there.
const KEPT_WHEN_CLOSED = entry => entry?.op === '!' || entry?.op === '+' || /(?<![\p{L}\p{N}])shown\s*:/iu.test(String(entry?.text ?? ''));

/** A copy of the tracker to keep: closed records keep only the history still read. */
export function compactTracker(tracker) {
    return {
        ...tracker,
        records: (tracker?.records ?? []).map(record => (record.status === 'active'
            ? record
            : { ...record, history: (record.history ?? []).filter(KEPT_WHEN_CLOSED) })),
    };
}

/**
 * The place visits (`[{ message, time, text }]`, chat order) the place book needs: a stay over
 * several replies only by its first and last, which builds the same book.
 */
export function compactVisits(visits) {
    const list = (Array.isArray(visits) ? visits : []).filter(Boolean);
    return list.filter((visit, index) => index === 0 || index === list.length - 1
        || visit.text !== list[index - 1].text || visit.text !== list[index + 1].text);
}

export function shiftVisits(visits, delta) {
    return (Array.isArray(visits) ? visits : []).map(visit => shiftAt(visit, delta));
}

/**
 * Where checkpoint `point` is in `chat` now: the index of its reply (same signature, and send
 * date when it has one), at its own place or, after messages before it were deleted, the
 * nearest such message before it; null when the reply is gone or changed.
 */
export function locate(point, chat, signature) {
    const list = Array.isArray(chat) ? chat : [];
    const same = message => Boolean(message) && signature(message) === point?.sig
        && (!point.sendDate || String(message.send_date ?? '') === point.sendDate);
    const at = Number(point?.message);
    if (Number.isInteger(at) && same(list[at])) return at;
    for (let index = Math.min(Number.isInteger(at) ? at : list.length - 1, list.length - 1); index >= 0; index--) {
        if (same(list[index])) return index;
    }
    return null;
}

/**
 * The newest checkpoint usable for a tracker after message `upTo`: its reply still there and
 * unchanged, at or before `upTo`, written under the same reading (`key`: the calendar and the
 * scene tag that turn dates into numbers). `{ index, point }` or null.
 */
export function usableCheckpoint(points, chat, { signature, upTo, key }) {
    const list = [...(Array.isArray(points) ? points : [])].sort((a, b) => b.message - a.message);
    for (const point of list) {
        if (!point?.tracker || point.key !== key) continue;
        const index = locate(point, chat, signature);
        if (index !== null && index <= upTo) return { index, point };
    }
    return null;
}

/**
 * The reply a new checkpoint is due at, or null: the reply CHECKPOINT_TRAIL replies before the
 * newest (`replies`: story reply indices, chat order), once it is at least CHECKPOINT_EVERY
 * replies past the newest checkpoint kept (`newest`: its index now, or null).
 */
export function checkpointDue(replies, newest, { trail = CHECKPOINT_TRAIL, every = CHECKPOINT_EVERY } = {}) {
    const list = Array.isArray(replies) ? replies : [];
    const at = list.length - 1 - trail;
    if (at < 0) return null;
    const candidate = list[at];
    if (newest === null || newest === undefined) return candidate;
    const since = list.filter(index => index > newest && index <= candidate).length;
    return since >= every ? candidate : null;
}

/** The checkpoints to keep with `point` added: the newest CHECKPOINTS_KEPT, oldest first. */
export function withCheckpoint(points, point, kept = CHECKPOINTS_KEPT) {
    const list = (Array.isArray(points) ? points : []).filter(other => other && other.message !== point.message);
    return [...list, point].sort((a, b) => a.message - b.message).slice(-kept);
}
