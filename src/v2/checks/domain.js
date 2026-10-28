// The standalone checks domain, actor policy, and roll history.

import { STATS } from './words.js';
import { hashJson } from '../hash.js';
import { ledgerProblems } from '../writes.js';

export const ACTOR_ID = /^ca_[0-9a-z]{8}$/;
export const CHECK_ID = /^ck_[0-9a-z]{8}$/;
export const MAX_ACTORS = 24;
export const MAX_BONUSES = 40;
export const MAX_LOG = 60;
export const BONUS_LIMIT = 30;
export const MAX_NAME = 80;

export const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isInt = value => Number.isSafeInteger(value);

export function initialChecks() {
    return { policy: { actors: {}, defaultActor: null }, writes: {}, log: {} };
}

/** Whether a bonus key is a stat or `topic:<name>` of the table. */
export const bonusKeyOk = (key, topics) => STATS.includes(key) || (key.startsWith('topic:') && topics.includes(key.slice(6)));

/** The policy of a state (the missing parts read as empty). */
export function policyOf(checks) {
    const policy = isRecord(checks?.policy) ? checks.policy : {};
    return {
        actors: isRecord(policy.actors) ? policy.actors : {},
        defaultActor: typeof policy.defaultActor === 'string' ? policy.defaultActor : null,
    };
}

/** The effective settings the policy hash covers. */
export function effective(settings) {
    return {
        social: settings?.social !== false,
    };
}

/** The read-only projection `checks.policy` answers and `expectedHash` is compared with. */
export function projection(checks, settings) {
    const policy = policyOf(checks);
    const body = {
        actors: Object.fromEntries(Object.keys(policy.actors).sort().map(id => [id, { id, name: policy.actors[id].name, bonuses: Object.fromEntries(Object.keys(policy.actors[id].bonuses ?? {}).sort().map(key => [key, policy.actors[id].bonuses[key]])) }])),
        defaultActor: policy.defaultActor,
        ...effective(settings),
    };
    return { ...structuredClone(body), hash: hashJson(body) };
}

function actorProblems(id, actor, topics) {
    const at = `checks.policy.actors.${id}`;
    if (!isRecord(actor) || actor.id !== id || !ACTOR_ID.test(id)) return [`${at} is not whole.`];
    const errors = [];
    if (typeof actor.name !== 'string' || !actor.name.trim() || actor.name.length > MAX_NAME) errors.push(`${at} needs a name of at most ${MAX_NAME} characters.`);
    if (!isRecord(actor.bonuses) || Object.keys(actor.bonuses).length > MAX_BONUSES) errors.push(`${at}.bonuses is a record of at most ${MAX_BONUSES}.`);
    else for (const [key, value] of Object.entries(actor.bonuses)) if (!bonusKeyOk(key, topics) || !isInt(value) || Math.abs(value) > BONUS_LIMIT) errors.push(`${at}.bonuses.${key} is a stat or topic and a whole number from -${BONUS_LIMIT} to ${BONUS_LIMIT}.`);
    for (const key of Object.keys(actor)) if (!['id', 'name', 'bonuses'].includes(key)) errors.push(`${at} has an unknown field "${key}".`);
    return errors;
}

function logProblems(log) {
    if (!isRecord(log)) return ['checks.log is not an object.'];
    const keys = Object.keys(log);
    if (keys.length > MAX_LOG) return [`checks.log holds more than ${MAX_LOG} checks.`];
    const bad = keys.find(id => !CHECK_ID.test(id) || !isRecord(log[id]) || log[id].id !== id || !isInt(log[id].die) || !isInt(log[id].mod) || !isInt(log[id].total) || typeof log[id].outcome !== 'string');
    return bad ? [`checks.log.${bad} is not a check.`] : [];
}

/** The fields RPG Battle's own checks part keeps in the same domain (pending rolls, the last result): not ours, dropped at our first write. */
const LEGACY_FIELDS = ['prepared', 'last', 'pending'];

/**
 * The `checks` draft of a command, made ours: a slice RPG Battle's checks part wrote ({ prepared, log, ... } with no policy or ledger) gets
 * the policy and the ledger it lacks, loses the fields only that part reads, and keeps the checks of its log that are ours in shape. The one
 * place every writer takes its draft from.
 */
export function draftChecks(ctx) {
    const draft = ctx.draft('checks');
    for (const key of LEGACY_FIELDS) delete draft[key];
    if (!isRecord(draft.policy)) draft.policy = {};
    if (!isRecord(draft.policy.actors)) draft.policy.actors = {};
    if (typeof draft.policy.defaultActor !== 'string') draft.policy.defaultActor = null;
    if (!isRecord(draft.writes)) draft.writes = {};
    if (!isRecord(draft.log)) draft.log = {};
    for (const id of Object.keys(draft.log)) if (logProblems({ [id]: draft.log[id] }).length) delete draft.log[id];
    return draft;
}

/**
 * The validator (SPEC §2.5). `topics`: the topic names of the table. A slice with no policy is not ours yet (empty, or RPG Battle's checks
 * part's { prepared, log, ... } before the flip release): nothing of ours to check, and our first write makes it ours (draftChecks).
 */
export function validateChecks(slice, topics) {
    if (isRecord(slice) && !Object.hasOwn(slice, 'policy')) return Object.keys(slice).every(key => ['prepared', 'log', 'last', 'pending', 'writes'].includes(key)) ? [] : ['checks has fields that are neither ours nor RPG Battle\'s.'];
    if (!isRecord(slice) || !isRecord(slice.policy)) return ['checks is not { policy, writes, log }.'];
    const errors = [];
    const { actors, defaultActor } = slice.policy;
    if (!isRecord(actors) || Object.keys(actors).length > MAX_ACTORS) return [`checks.policy.actors is a record of at most ${MAX_ACTORS}.`];
    for (const [id, actor] of Object.entries(actors)) errors.push(...actorProblems(id, actor, topics));
    if (!(defaultActor === null || (typeof defaultActor === 'string' && Object.hasOwn(actors, defaultActor)))) errors.push('checks.policy.defaultActor is null or an actor.');
    for (const key of Object.keys(slice.policy)) if (!['actors', 'defaultActor'].includes(key)) errors.push(`checks.policy has an unknown field "${key}".`);
    errors.push(...ledgerProblems(slice.writes, 'checks.writes'));
    errors.push(...logProblems(slice.log));
    for (const key of Object.keys(slice)) if (![...LEGACY_FIELDS, 'policy', 'writes', 'log'].includes(key)) errors.push(`checks has an unknown field "${key}".`);
    return errors.slice(0, 10);
}
