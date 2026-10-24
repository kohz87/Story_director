// P23's pure retry/hash and acceptance checks. The director remains the only thread/ledger
// owner. Runtime writers still need the host's persisted write/cursor handoff before dispatch.
import { offersChosenIn } from '../../tracker.js';

const copy = value => structuredClone(value);
const failure = (code, message) => ({ ok: false, code, message });
const recordId = value => typeof value === 'string' && /^[a-z][a-z0-9]*_[0-9a-z]{8}$/.test(value);
const own = (object, key) => Object.hasOwn(object ?? {}, key);

/** Canonical public projection: include every public field, including rpg/rev; omit only track. */
export function threadProjection(thread) {
    if (!thread) return null;
    const { track: _track, ...publicFields } = thread;
    return copy(publicFields);
}

/**
 * Prepare a write against the SD-owned director.writes map. Hash is supplied by ctx.hash;
 * no module imports the host's private query runner or chooses a different hash algorithm.
 * The returned saved result wins before stale/transition checks.
 */
export function prepareThreadWrite(director, type, payload, hash) {
    if (!recordId(payload?.write)) return failure('INVALID', 'A thread write needs its host-persisted write ID.');
    if (typeof hash !== 'function') return failure('DEPENDENCY_UNAVAILABLE', 'The host hash function is unavailable.');
    const { write, ...meaning } = payload;
    let fingerprint;
    try { fingerprint = hash({ type, payload: meaning }); }
    catch { return failure('INVALID', 'A thread write must contain normalized JSON.'); }
    const previous = director?.writes?.[write];
    if (previous) {
        return previous.fingerprint === fingerprint
            ? { ok: true, retry: true, result: copy(previous.result) }
            : failure('CONFLICT', 'This write ID was already used with different meaning.');
    }
    const thread = director?.threads?.[payload.thread];
    const currentHash = thread ? hash(threadProjection(thread)) : null;
    if (type === 'threads.offer') {
        if (payload.expectedHash !== null) return failure('INVALID', 'A new offer expects no previous thread.');
        if (thread) return failure('CONFLICT', 'This thread ID is already occupied.');
    } else {
        if (!thread) return failure('NOT_FOUND', 'There is no such thread.');
        if (payload.expectedHash !== currentHash) return failure('STALE', 'This thread changed before the write.');
    }
    return { ok: true, retry: false, fingerprint, currentHash };
}

/** A ledger entry to add atomically with its owner's thread changes, never before them. */
export function threadWriteEntry(prepared, result) {
    if (!prepared?.ok || prepared.retry || typeof prepared.fingerprint !== 'string') throw new TypeError('A fresh prepared write is required.');
    return { fingerprint: prepared.fingerprint, result: copy(result) };
}

/**
 * The host proves that the reader wrote a complete sentence; SD still checks its meaning.
 * Only a surviving SD acceptance proof for this thread is accepted. The retained intent
 * matcher handles whole names/aliases; explicit refusal takes precedence over acceptance.
 */
export function neutralAcceptance(thread, proofs, proofId, { cause, caller = null } = {}) {
    if (!Array.isArray(proofs)) return failure('DEPENDENCY_UNAVAILABLE', 'Active story evidence is unavailable.');
    const proof = proofs.find(proof => proof.id === proofId);
    if (!proof || proof.owner !== 'story-director' || proof.kind !== 'acceptance'
        || proof.payload?.thread !== thread?.id) return failure('REFUSED', 'No active acceptance proof names this thread.');
    const payload = proof.payload;
    if (own(payload, 'selection')) {
        if (cause !== 'ui' || caller && caller !== 'rpg-battle') return failure('REFUSED', 'This proof requires the reader\'s selected action.');
    } else if (own(payload, 'words')) {
        // toRecord's injected type is an intent-matcher input only, never a stored RPG field.
        const offered = { id: thread.id, key: thread.key, kind: 'hook', status: 'active',
            fields: { ...thread.fields, type: 'quest' }, aliases: thread.aliases ?? [] };
        const tracker = { records: [offered] };
        const declined = offersChosenIn(tracker, payload.words, 'refuse').includes(thread.key);
        const negated = /\b(?:no|not|nothing|neither|never|won['’]?t|don['’]?t|cannot|can['’]?t|refus\w*|declin\w*)\b/iu.test(payload.words);
        if (declined || negated || !offersChosenIn(tracker, payload.words, 'accept').includes(thread.key)) {
            return failure('REFUSED', 'The reader\'s words do not accept this goal.');
        }
    } else return failure('REFUSED', 'Acceptance requires a reader selection or explicit words.');
    return { ok: true, proof: copy(proof) };
}
