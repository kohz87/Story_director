// The five P23 writers: one owner, one optimistic hash and an atomic retry ledger.
import { hashJson } from './hash.js';
import { lineKey } from '../../changes.js';
import { THREAD_KINDS } from './convert.js';
import { replyDraft, replyTurn } from './domain.js';
import { neutralAcceptance, prepareThreadWrite, threadProjection, threadWriteEntry } from './thread-writes.js';
import { closed, cursor, hash, map, recordId, source, text, validQuest } from './quest-shape.js';

const neutralFields = new Set(['desc', 'now', 'then', 'on', 'due', 'shown', 'leg', 'arrive', 'place', 'people', 'encounter', 'reach', 'goal', 'step', 'progress', 'giver']);
const copy = value => structuredClone(value);
const same = (ctx, a, b) => ctx.hash(a) === ctx.hash(b);
const fail = (ctx, code, message) => ctx.fail(code, message);
const reply = result => ({ summary: 'Thread updated.', narrate: false, data: result });

function authority(ctx, payload, rbOnly) {
    // ctx.caller is host-authenticated; the host refuses dispatch from dormant modules.
    if ((rbOnly || Object.hasOwn(payload ?? {}, 'quest')) && ctx.caller !== 'rpg-battle') {
        fail(ctx, 'REFUSED', 'Only ready RPG Battle may write a quest extension.');
    }
}
function shape(ctx, type, payload) {
    const fields = {
        'threads.offer': [['write', 'thread', 'kind', 'key', 'summary', 'fields', 'expectedHash'], ['quest']],
        'threads.accept': [['write', 'thread', 'expectedHash'], ['acceptance', 'quest']],
        'threads.link': [['write', 'thread', 'quest', 'expectedHash'], []],
        'threads.questWrite': [['write', 'thread', 'quest', 'expectedHash'], []],
        'threads.close': [['write', 'thread', 'expectedHash', 'instance', 'outcome', 'reason', 'settlement'], []],
    }[type];
    if (!closed(payload, ...fields) || !recordId(payload.thread) || !payload.thread.startsWith('th_')
        || !recordId(payload.write) || (type !== 'threads.offer' && !hash(payload.expectedHash))) fail(ctx, 'INVALID', 'Invalid thread writer payload.');
    if (Object.hasOwn(payload, 'quest') && (!validQuest(payload.quest) || payload.quest.id !== payload.thread)) fail(ctx, 'INVALID', 'Invalid Quest extension.');
}
function acceptance(ctx, thread, proofId) {
    let selected = proofId;
    if (!selected && ctx.cause === 'ui' && (!ctx.caller || ctx.caller === 'rpg-battle')) {
        selected = ctx.proof({ kind: 'acceptance', payload: { thread: thread.id, selection: thread.key } }).id;
    }
    const checked = neutralAcceptance(thread, ctx.query('story.evidence', selected ? { ids: [selected] } : {}), selected,
        { cause: ctx.cause, caller: ctx.caller });
    if (!checked.ok) fail(ctx, checked.code, checked.message);
    const at = typeof ctx.cursor === 'function' ? ctx.cursor() : null;
    if (!cursor(at) || !source(checked.proof.source)) fail(ctx, 'DEPENDENCY_UNAVAILABLE', 'Thread acceptance needs the host cursor and Source.');
    return { source: copy(checked.proof.source), cursor: copy(at), minute: ctx.time(), proof: checked.proof.id };
}
function activeQuest(ctx, quest, accepted) {
    if (quest.state !== 'active' || quest.settlement !== null || !accepted || !same(ctx, quest.acceptedCursor, accepted.cursor)
        || quest.acceptedAt !== accepted.minute) fail(ctx, 'CONFLICT', 'The quest must retain the original acceptance cursor and minute.');
}
function survivingAcceptance(ctx, thread) {
    const accepted = thread.acceptance;
    if (!accepted) fail(ctx, 'REFUSED', 'The original acceptance evidence is missing.');
    const proof = ctx.query('story.evidence', { ids: [accepted.proof] }).find(p => p.id === accepted.proof);
    if (!proof || proof.kind !== 'acceptance' || proof.owner !== 'story-director' || proof.payload.thread !== thread.id
        || !same(ctx, proof.source, accepted.source)) fail(ctx, 'REFUSED', 'The original acceptance evidence is inactive.');
    const checked = neutralAcceptance(thread, [proof], proof.id, { cause: Object.hasOwn(proof.payload, 'selection') ? 'ui' : ctx.cause, caller: ctx.caller });
    if (!checked.ok) fail(ctx, checked.code, checked.message);
}
function compatible(thread) {
    // Compatibility fields are projections of this extension; they never authorize payouts.
    const q = thread.rpg;
    const first = q.objectives[0];
    thread.target = first?.kind === 'collect' || first?.kind === 'kill'
        ? { noun: first.def ?? first.foe, count: first.count, kind: first.kind === 'collect' ? 'items' : 'foes' } : null;
    thread.reward = { amount: q.reward.coin, each: false, unit: '', text: String(q.reward.coin) };
    thread.ready = null;
}

export function writeThread(type, ctx, payload) {
    authority(ctx, payload, ['threads.link', 'threads.questWrite', 'threads.close'].includes(type));
    shape(ctx, type, payload);
    const director = ctx.draft('director');
    const prepared = prepareThreadWrite(director, type, payload, ctx.hash);
    if (!prepared.ok) fail(ctx, prepared.code, prepared.message);
    if (prepared.retry) return reply(prepared.result);
    let thread = director.threads[payload.thread];
    if (thread?.kind === 'quest' && !thread.rpg && !Object.hasOwn(thread, 'acceptance')) fail(ctx, 'REFUSED', 'Quest from an earlier version (read only).');
    let result;
    if (type === 'threads.offer') {
        if (!THREAD_KINDS.includes(payload.kind) || !text(payload.key, 120, true) || !lineKey(payload.key)
            || !text(payload.summary, 600) || !map(payload.fields)
            || Object.entries(payload.fields).some(([k, v]) => !neutralFields.has(k) || !text(v, 600))) fail(ctx, 'INVALID', 'Invalid neutral thread fields.');
        const occupied = director.threads[director.keys[lineKey(payload.key)]];
        if (occupied?.status === 'active') fail(ctx, 'CONFLICT', 'This display key is already active.');
        if (Object.values(director.threads).filter(t => t.status === 'active').length >= 300
            || replyTurn(director).added >= 16) fail(ctx, 'LIMITED', 'The thread limit was reached.');
        if (payload.quest && (payload.quest.state !== 'offered' || payload.quest.acceptedAt !== null || payload.quest.acceptedCursor !== null)) fail(ctx, 'REFUSED', 'A new quest must be offered without acceptance.');
        thread = { id: payload.thread, kind: payload.kind, key: payload.key, summary: payload.summary, fields: copy(payload.fields),
            status: 'active', offer: true, taken: null, ended: null, target: null, reward: null, acceptance: null, rev: ctx.rev,
            track: { order: Math.max(-1, ...Object.values(director.threads).map(t => t.track?.order ?? 0)) + 1,
                created: { turn: director.turn?.n ?? 0, time: ctx.time() }, changed: { turn: director.turn?.n ?? 0, time: ctx.time() },
                seen: { turn: director.turn?.n ?? 0, time: ctx.time() } } };
        if (payload.quest) thread.rpg = copy(payload.quest);
        director.threads[thread.id] = thread;
        director.keys[lineKey(thread.key)] = thread.id;
        const turn = replyDraft(director);
        if (turn) turn.added++;
        result = { thread: thread.id, hash: ctx.hash(threadProjection(thread)) };
    } else if (type === 'threads.accept') {
        if (thread.status !== 'active' || !thread.offer || thread.taken) fail(ctx, 'REFUSED', 'This thread is not an unaccepted offer.');
        if (thread.rpg && !payload.quest) fail(ctx, 'REFUSED', 'An RPG offer requires its matching active Quest.');
        const accepted = acceptance(ctx, thread, payload.acceptance);
        if (ctx.caller !== 'rpg-battle') {
            if (!recordId(ctx.epoch)) fail(ctx, 'DEPENDENCY_UNAVAILABLE', 'Acceptance requires the host epoch.');
            const given = ctx.query('story.evidence', { ids: [accepted.proof] })[0];
            const external = given && !same(ctx, given.source, ctx.source) ? accepted.proof : null;
            const inputs = { thread: threadProjection(thread), proof: external };
            const proof = external ? [given] : [];
            ctx.replayGuard({ owner: 'story-director', version: 2, epoch: ctx.epoch, rulesHash: null,
                inputHash: ctx.hash({ inputs, proof }), predicate: { kind: 'threads.accept', inputs } }, { proof });
        }
        if (payload.quest) {
            activeQuest(ctx, payload.quest, accepted);
            if (thread.rpg && (payload.quest.template !== thread.rpg.template || payload.quest.instance !== thread.rpg.instance)) fail(ctx, 'CONFLICT', 'Quest identity changed.');
            thread.rpg = copy(payload.quest);
            compatible(thread);
        }
        thread.offer = false;
        thread.taken = { rev: ctx.rev };
        thread.acceptance = accepted;
        thread.rev = ctx.rev;
        result = { thread: thread.id, hash: ctx.hash(threadProjection(thread)), accepted: true, linked: !!thread.rpg };
    } else if (type === 'threads.link') {
        if (thread.status !== 'active' || thread.offer || !thread.taken || thread.rpg) fail(ctx, 'REFUSED', 'Only an accepted neutral thread can be linked.');
        survivingAcceptance(ctx, thread);
        activeQuest(ctx, payload.quest, thread.acceptance);
        thread.rpg = copy(payload.quest);
        thread.rev = ctx.rev;
        compatible(thread);
        result = { thread: thread.id, instance: thread.rpg.instance, hash: ctx.hash(threadProjection(thread)) };
    } else if (type === 'threads.questWrite') {
        if (!thread.rpg || thread.status !== 'active' || thread.rpg.settlement) fail(ctx, 'REFUSED', 'This quest cannot be changed.');
        if (['id', 'template', 'instance'].some(k => thread.rpg[k] !== payload.quest[k])) fail(ctx, 'CONFLICT', 'Quest identity changed.');
        if (!same(ctx, thread.rpg.acceptedCursor, payload.quest.acceptedCursor) || thread.rpg.acceptedAt !== payload.quest.acceptedAt) fail(ctx, 'CONFLICT', 'Quest acceptance changed.');
        if (thread.rpg.state === 'offered' && payload.quest.state !== 'offered' || thread.rpg.state === 'active' && payload.quest.state === 'offered') fail(ctx, 'REFUSED', 'Use acceptance for that transition.');
        thread.rpg = copy(payload.quest);
        thread.rev = ctx.rev;
        compatible(thread);
        result = { thread: thread.id, instance: thread.rpg.instance, hash: ctx.hash(threadProjection(thread)) };
    } else {
        if (!Number.isInteger(payload.instance) || payload.instance < 1 || payload.instance > 1000000
            || !['done', 'failed', 'expired', 'abandoned'].includes(payload.outcome) || !text(payload.reason, 240) || !recordId(payload.settlement)) fail(ctx, 'INVALID', 'Invalid terminal thread transition.');
        const settlement = thread.rpg?.settlement;
        if (!settlement || thread.rpg.instance !== payload.instance || settlement.id !== payload.settlement || settlement.outcome !== payload.outcome) fail(ctx, 'CONFLICT', 'The matching terminal quest settlement is required.');
        if (thread.status !== 'active') {
            if (thread.ended?.outcome !== (payload.outcome === 'expired' ? 'failed' : payload.outcome)) fail(ctx, 'CONFLICT', 'This thread ended differently.');
        } else {
            if (!same(ctx, settlement.source, ctx.source)) fail(ctx, 'CONFLICT', 'Closure must share the terminal extension transaction.');
            if (!ctx.claim(settlement.claim)) fail(ctx, 'REFUSED', 'Closure must share the settlement transaction claim.');
            // One claim in the shared settlement root covers the extension, payout and journal.
            thread.status = 'resolved';
            thread.ended = { rev: ctx.rev, reason: payload.reason, outcome: payload.outcome === 'expired' ? 'failed' : payload.outcome };
            thread.rev = ctx.rev;
            ctx.call('chronicle.threadOutcome', { thread: thread.id, text: `${thread.key}: ${payload.outcome}.` });
        }
        result = { thread: thread.id, instance: payload.instance, outcome: payload.outcome, settlement: payload.settlement, hash: ctx.hash(threadProjection(thread)) };
    }
    director.writes ??= {};
    director.writes[payload.write] = threadWriteEntry(prepared, result);
    return reply(result);
}

export const threadCommands = Object.fromEntries(['offer', 'accept', 'link', 'questWrite', 'close']
    .map(name => [`threads.${name}`, (ctx, payload) => writeThread(`threads.${name}`, ctx, payload)]));

/** Neutral accept keeps its original offer and any separately committed acceptance proof. */
export function threadReplayGuard({ query }, { guard, recorded }) {
    if (guard?.predicate?.kind !== 'threads.accept') return undefined;
    const inputs = guard.predicate.inputs;
    const thread = query('director.thread', { id: inputs.thread.id });
    const proof = inputs.proof ? query('story.evidence', { ids: [inputs.proof] }) : [];
    return hashJson({ inputs: { thread, proof: inputs.proof }, proof }) === guard.inputHash
        && (!inputs.proof || hashJson(proof) === hashJson(recorded.proof))
        ? { ok: true } : { ok: false, reason: 'The offer or reader acceptance evidence changed.' };
}
