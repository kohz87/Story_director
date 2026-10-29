// Thread offers and acceptance use an optimistic hash and an atomic retry ledger.
import { hashJson } from './hash.js';
import { lineKey } from '../../changes.js';
import { THREAD_KINDS } from './convert.js';
import { replyDraft, replyTurn } from './domain.js';
import { neutralAcceptance, prepareThreadWrite, threadProjection, threadWriteEntry } from './thread-writes.js';
import { closed, cursor, hash, map, recordId, source, text } from './thread-shape.js';

const neutralFields = new Set(['desc', 'now', 'then', 'on', 'due', 'shown', 'leg', 'arrive', 'place', 'people', 'encounter', 'reach', 'goal', 'step', 'progress', 'giver', 'type', 'reward', 'difficulty']);
const copy = value => structuredClone(value);
const same = (ctx, a, b) => ctx.hash(a) === ctx.hash(b);
const fail = (ctx, code, message) => ctx.fail(code, message);
const reply = result => ({ summary: 'Thread updated.', narrate: false, data: result });

function shape(ctx, type, payload) {
    const fields = {
        'threads.offer': [['write', 'thread', 'kind', 'key', 'summary', 'fields', 'expectedHash'], []],
        'threads.accept': [['write', 'thread', 'expectedHash'], ['acceptance']],
    }[type];
    if (!closed(payload, ...fields) || !recordId(payload.thread) || !payload.thread.startsWith('th_')
        || !recordId(payload.write) || (type !== 'threads.offer' && !hash(payload.expectedHash))) fail(ctx, 'INVALID', 'Invalid thread writer payload.');
}
function acceptance(ctx, thread, proofId) {
    let selected = proofId;
    if (!selected && ctx.cause === 'ui' && !ctx.caller) {
        selected = ctx.proof({ kind: 'acceptance', payload: { thread: thread.id, selection: thread.key } }).id;
    }
    const checked = neutralAcceptance(thread, ctx.query('story.evidence', selected ? { ids: [selected] } : {}), selected,
        { cause: ctx.cause, caller: ctx.caller });
    if (!checked.ok) fail(ctx, checked.code, checked.message);
    const at = typeof ctx.cursor === 'function' ? ctx.cursor() : null;
    if (!cursor(at) || !source(checked.proof.source)) fail(ctx, 'DEPENDENCY_UNAVAILABLE', 'Thread acceptance needs the host cursor and Source.');
    return { source: copy(checked.proof.source), cursor: copy(at), minute: ctx.time(), proof: checked.proof.id };
}
export function writeThread(type, ctx, payload) {
    shape(ctx, type, payload);
    const director = ctx.draft('director');
    const prepared = prepareThreadWrite(director, type, payload, ctx.hash);
    if (!prepared.ok) fail(ctx, prepared.code, prepared.message);
    if (prepared.retry) return reply(prepared.result);
    let thread = director.threads[payload.thread];
    if (thread?.rpg || thread?.owed || thread?.ready) fail(ctx, 'REFUSED', 'Quest from an earlier version (read only).');
    let result;
    if (type === 'threads.offer') {
        if (!THREAD_KINDS.includes(payload.kind) || !text(payload.key, 120, true) || !lineKey(payload.key)
            || !text(payload.summary, 600) || !map(payload.fields)
            || Object.entries(payload.fields).some(([k, v]) => !neutralFields.has(k) || !text(v, 600))) fail(ctx, 'INVALID', 'Invalid neutral thread fields.');
        const occupied = director.threads[director.keys[lineKey(payload.key)]];
        if (occupied?.status === 'active') fail(ctx, 'CONFLICT', 'This display key is already active.');
        if (Object.values(director.threads).filter(t => t.status === 'active').length >= 300
            || replyTurn(director).added >= 16) fail(ctx, 'LIMITED', 'The thread limit was reached.');
        thread = { id: payload.thread, kind: payload.kind, key: payload.key, summary: payload.summary, fields: copy(payload.fields),
            status: 'active', offer: true, taken: null, ended: null, target: null, reward: null, acceptance: null, rev: ctx.rev,
            track: { order: Math.max(-1, ...Object.values(director.threads).map(t => t.track?.order ?? 0)) + 1,
                created: { turn: director.turn?.n ?? 0, time: ctx.time() }, changed: { turn: director.turn?.n ?? 0, time: ctx.time() },
                seen: { turn: director.turn?.n ?? 0, time: ctx.time() } } };
        director.threads[thread.id] = thread;
        director.keys[lineKey(thread.key)] = thread.id;
        const turn = replyDraft(director);
        if (turn) turn.added++;
        result = { thread: thread.id, hash: ctx.hash(threadProjection(thread)) };
    } else if (type === 'threads.accept') {
        if (thread.status !== 'active' || !thread.offer || thread.taken) fail(ctx, 'REFUSED', 'This thread is not an unaccepted offer.');
        const accepted = acceptance(ctx, thread, payload.acceptance);
        {
            if (!recordId(ctx.epoch)) fail(ctx, 'DEPENDENCY_UNAVAILABLE', 'Acceptance requires the host epoch.');
            const given = ctx.query('story.evidence', { ids: [accepted.proof] })[0];
            const external = given && !same(ctx, given.source, ctx.source) ? accepted.proof : null;
            const inputs = { thread: threadProjection(thread), proof: external };
            const proof = external ? [given] : [];
            ctx.replayGuard({ owner: 'story-director', version: 2, epoch: ctx.epoch, rulesHash: null,
                inputHash: ctx.hash({ inputs, proof }), predicate: { kind: 'threads.accept', inputs } }, { proof });
        }
        thread.offer = false;
        thread.taken = { rev: ctx.rev };
        thread.acceptance = accepted;
        thread.rev = ctx.rev;
        result = { thread: thread.id, hash: ctx.hash(threadProjection(thread)), accepted: true, linked: false };
    }
    director.writes ??= {};
    director.writes[payload.write] = threadWriteEntry(prepared, result);
    return reply(result);
}

export const threadCommands = Object.fromEntries(['offer', 'accept']
    .map(name => [`threads.${name}`, (ctx, payload) => writeThread(`threads.${name}`, ctx, payload)]));

/** Neutral accept binds the offer and proof bytes, independent of transport revision/ordinal. */
export function threadReplayGuard({ state, query }, { guard, recorded }) {
    if (guard?.predicate?.kind !== 'threads.accept') return undefined;
    const off = () => ({ ok: false, reason: 'The offer or reader acceptance evidence changed.' });
    if (guard.version !== 2 || guard.epoch !== (state?.domains?.savepoints?.epoch ?? 'ep_00000000')) return off();
    const inputs = guard.predicate.inputs;
    const savedProof = recorded?.proof;
    if (!inputs?.thread || !Array.isArray(savedProof) || hashJson({ inputs, proof: savedProof }) !== guard.inputHash) return off();
    const thread = query('director.thread', { id: inputs.thread.id });
    const proof = inputs.proof ? query('story.evidence', { ids: [inputs.proof] }) : [];
    const semanticThread = value => {
        if (!value) return null;
        const { rev: _rev, ...rest } = value;
        return rest;
    };
    const semanticProofs = list => list.map(value => {
        const item = copy(value);
        if (item.source) delete item.source.ordinal;
        return item;
    });
    return hashJson(semanticThread(thread)) === hashJson(semanticThread(inputs.thread))
        && hashJson(semanticProofs(proof)) === hashJson(semanticProofs(savedProof))
        ? { ok: true } : off();
}
