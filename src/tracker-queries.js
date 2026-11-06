// Story Director: tracker queries and corrections (pure).
//
// Read-only record lookups, quest outcomes, corrections and finished-quest copies moved out
// of tracker.js; tracker.js re-exports their public names.
import { lineKey, questDifficulty } from './changes.js';
import { FAILED } from './tracker-said.js';

// What the next note may say about ignored lines: at most this many, from the latest reply.
const MAX_UNTRACKED_CORRECTIONS = 3;

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
