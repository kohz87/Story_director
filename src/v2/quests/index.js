// Story Director v2, part "quests" (MODULES §C2): taking on, turning down, giving up and
// turning in quests. No domain of its own: it writes only `taken`, `ended`, `target`, `reward`
// (and `offer`, `status`, `rev`) on the `director` domain's quest threads, which the tracker
// part creates from the story's change lines.
//
// A turn-in is code from start to end: the target is counted from RPG Battle's fights or Story
// Block's inventory, the place rule is checked on the scene, the reward is computed (per unit
// when it says "each"), paid once under the claim `quest:<id>:paid`, fetched items are handed
// over, and the receipt tells the next reply what happened with those numbers.

import { questDifficulty } from '../../changes.js';
import { currencyName, nameMatches, nounFor, money, parseReward, parseTarget, payFor, rewardText, settleReward, targetText } from './parse.js';
import { beatenClaim, finishRule, placeRule, progressLabel, progressOf, questLists, stateQuery, tryQuery, unclaimedIn } from './progress.js';

export { questLists };

const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();

// Error codes (SPEC §12, MODULES §F4): a rule refusal (a quest in the wrong state, the wrong
// place, nothing code can count) is REFUSED; a target not met yet is NOT_ENOUGH.
export const CODES = Object.freeze({ notFound: 'NOT_FOUND', invalid: 'REFUSED', wrongPlace: 'REFUSED', notMet: 'NOT_ENOUGH', claimed: 'CLAIMED', failed: 'FAILED' });

function fail(ctx, code, message) {
    ctx.fail(code, message);
    // ctx.fail throws; this is only for a ctx that does not.
    const error = new Error(message);
    error.code = code;
    throw error;
}

/** The quest thread a payload names: `{ id }` or `{ key }` (any alias the tracker indexed). */
export function findQuest(director, payload = {}) {
    const threads = director?.threads ?? {};
    const id = text(payload.id) || director?.keys?.[text(payload.key).toLowerCase()] || '';
    const thread = id && Object.hasOwn(threads, id) ? threads[id] : null;
    return thread?.kind === 'quest' ? thread : null;
}

/*
 * The meta.rev this receipt will carry (`ctx.rev`, MODULES §F2), for `taken.rev` / `ended.rev` /
 * `rev`. Without it the action is refused: fights could not be counted "since" anything safely.
 */
function receiptRev(ctx) {
    if (Number.isSafeInteger(ctx.rev)) return ctx.rev;
    return fail(ctx, CODES.failed, 'Story Block did not say which revision this action is.');
}

/** The chat's one currency (`inventory.currency`, MODULES §F1), `{ name, short }`; gold without it. */
function currencyOf(query) {
    const currency = tryQuery(query, 'inventory.currency', {}, null);
    return { name: currencyName(currency), short: text(currency?.short) };
}

/** The player character's name for summaries ("Astra"), else "The party". */
function whoName(query) {
    const pc = tryQuery(query, 'party.pc', {}, null);
    if (pc && typeof pc === 'object' && text(pc.name)) return text(pc.name);
    if (typeof pc === 'string' && pc) {
        const actor = tryQuery(query, 'party.actor', { id: pc }, null);
        if (text(actor?.name)) return text(actor.name);
    }
    return 'The party';
}

// A target label without a verb ("3 wolves"): items when the inventory knows a thing by that
// name, else foes.
function withKind(inventory, target) {
    if (!target || target.kind) return target;
    const names = [
        ...Object.values(inventory?.defs ?? {}).map(def => def?.name),
        ...Object.keys(inventory?.aliases ?? {}),
    ];
    return { ...target, kind: names.some(name => nameMatches(target.noun, text(name))) ? 'items' : 'foes' };
}

function readOr(ctx, domain) {
    try {
        return ctx.read(domain);
    } catch {
        return null;
    }
}

function termsOf(ctx, thread, currency = currencyOf(ctx.query)) {
    const target = thread.target ?? withKind(readOr(ctx, 'inventory'), parseTarget(thread.fields, thread.summary));
    const reward = thread.reward ?? settleReward(parseReward(thread.fields, thread.summary, { currency }), target);
    return { target, reward };
}

function termsText(target, reward, currency) {
    return [targetText(target), rewardText(reward, target, currency)].filter(Boolean).join('; ');
}

// A sub-command: a host that reports a refusal as `{ ok: false }` instead of throwing still rejects.
function call(ctx, type, payload) {
    const result = ctx.call(type, payload);
    if (result && result.ok === false) fail(ctx, result.code || CODES.failed, result.message || `${type} was refused.`);
    return result;
}

const isOver = thread => Boolean(thread.ended) || thread.status !== 'active';

function take(ctx, payload) {
    const director = ctx.draft('director');
    const thread = findQuest(director, payload);
    if (!thread) fail(ctx, CODES.notFound, 'There is no such quest.');
    if (isOver(thread)) fail(ctx, CODES.invalid, `${thread.key} is already over.`);
    if (thread.taken) fail(ctx, CODES.invalid, `${thread.key} is already taken on.`);
    const rev = receiptRev(ctx);
    const wasOffer = Boolean(thread.offer);
    const currency = currencyOf(ctx.query);
    const { target, reward } = termsOf(ctx, thread, currency);
    thread.offer = false;
    thread.taken = { rev };
    thread.target = target ? { noun: target.noun, count: target.count, kind: target.kind } : null;
    thread.reward = reward;
    thread.rev = rev;
    const who = whoName(ctx.query);
    const terms = termsText(thread.target, reward, currency);
    // A quest the story already accepted is only adopted for counting: nothing new to tell.
    return {
        summary: wasOffer ? `${who} takes on ${thread.key}${terms ? `: ${terms}` : ''}.` : `${who} keeps count for ${thread.key}${terms ? `: ${terms}` : ''}.`,
        narrate: wasOffer,
        data: { quest: thread.id, key: thread.key, target: thread.target, reward },
    };
}

function decline(ctx, payload) {
    const director = ctx.draft('director');
    const thread = findQuest(director, payload);
    if (!thread) fail(ctx, CODES.notFound, 'There is no such quest.');
    if (isOver(thread) || !thread.offer || thread.taken) fail(ctx, CODES.invalid, `${thread.key} is not an open offer.`);
    const rev = receiptRev(ctx);
    thread.offer = false;
    thread.status = 'resolved';
    thread.ended = { rev, reason: text(payload?.reason) || 'turned down', outcome: 'declined' };
    thread.rev = rev;
    return { summary: `${whoName(ctx.query)} turns down ${thread.key}.`, narrate: true, data: { quest: thread.id, key: thread.key } };
}

function abandon(ctx, payload) {
    const director = ctx.draft('director');
    const thread = findQuest(director, payload);
    if (!thread) fail(ctx, CODES.notFound, 'There is no such quest.');
    if (isOver(thread)) fail(ctx, CODES.invalid, `${thread.key} is already over.`);
    if (thread.offer && !thread.taken) fail(ctx, CODES.invalid, `${thread.key} is only offered; turn it down instead.`);
    const rev = receiptRev(ctx);
    thread.status = 'resolved';
    thread.ended = { rev, reason: text(payload?.reason) || 'given up', outcome: 'abandoned' };
    thread.rev = rev;
    return { summary: `${whoName(ctx.query)} gives up ${thread.key}.`, narrate: true, data: { quest: thread.id, key: thread.key } };
}

function finish(ctx, payload) {
    const director = ctx.draft('director');
    const thread = findQuest(director, payload);
    if (!thread) fail(ctx, CODES.notFound, 'There is no such quest.');
    if (isOver(thread)) fail(ctx, CODES.invalid, `${thread.key} is already over.`);
    if (!thread.taken) fail(ctx, CODES.invalid, `${thread.key} has not been taken on.`);
    const currency = currencyOf(ctx.query);
    const { target, reward } = termsOf(ctx, thread, currency);
    if (!target) fail(ctx, CODES.invalid, `${thread.key} has no target code can count; the story decides when it is done.`);
    thread.target = { noun: target.noun, count: target.count, kind: target.kind };
    thread.reward = reward;
    const place = placeRule(thread, ctx.read('scene'));
    const rev = receiptRev(ctx);
    if (!ctx.claim(`quest:${thread.id}:paid`)) fail(ctx, CODES.claimed, `${thread.key} has already been paid.`);
    // One fight pays one kill quest (MODULES §F7): each fight counted is claimed as `beaten:<rev>`
    // while it is counted, and a fight another kill quest claimed is skipped. A refusal below
    // takes the claims back with everything else.
    const progress = progressOf(thread, ctx.query, { free: fightRev => ctx.claim(beatenClaim(fightRev)) });
    if (!progress.met) fail(ctx, CODES.notMet, `${thread.key} is not done yet (${progressLabel(thread, progress)}). ${progress.reason}`.trim());
    if (!place.ok) fail(ctx, CODES.wrongPlace, `${thread.key} cannot be turned in here. ${place.reason}`);

    // Fetched items are handed over: exactly the target's count, stack by stack.
    const consumed = [];
    if (target.kind === 'items') {
        let left = target.count;
        for (const stack of progress.stacks ?? []) {
            if (left <= 0) break;
            const qty = Math.min(left, stack.qty);
            call(ctx, 'inventory.consume', { stack: stack.stack, qty });
            consumed.push({ stack: stack.stack, qty });
            left -= qty;
        }
    }
    // Per unit: every foe beaten since it was taken on; items: the ones handed over.
    const units = target.kind === 'items' ? target.count : progress.have;
    const pay = payFor(reward, units);
    let paid = null;
    if (pay > 0) {
        // A whole amount of the chat's one currency (MODULES §F1, §F5).
        call(ctx, 'wallet.receive', { owner: 'party', amount: pay, note: `${thread.key} reward` });
        paid = { amount: pay };
    }
    // XP is RPG Battle's (it scales quest XP by difficulty); without it there is none.
    let xp = null;
    try {
        const amount = Number(text(thread.fields?.xp));
        const result = call(ctx, 'party.grantXp', {
            quest: thread.id, difficulty: questDifficulty(thread.fields?.difficulty),
            ...(Number.isSafeInteger(amount) && amount > 0 ? { amount } : {}),
        });
        xp = result?.data ?? result?.receipt?.data ?? true;
    } catch (error) {
        if (error?.code !== 'UNKNOWN_COMMAND') throw error;
    }

    thread.status = 'resolved';
    thread.ended = { rev, reason: 'turned in', outcome: 'done' };
    thread.rev = rev;

    const counted = target.kind === 'items'
        ? `${target.count} ${nounFor(target, target.count)} handed over`
        : `${progress.have} ${nounFor(target, progress.have)} beaten`;
    const payText = paid ? `${money(paid.amount, currency)} paid`
        : reward?.amount === 0 ? 'no reward in money'
            : reward?.text ? `reward as the story tells it: ${reward.text}`
                : 'no reward was named';
    return {
        summary: `${whoName(ctx.query)} turns in ${thread.key}: ${counted} (target ${target.count}), ${payText}.`,
        narrate: true,
        data: { quest: thread.id, key: thread.key, have: progress.have, need: progress.need, source: progress.source, units, paid, consumed, xp, fights: progress.fights ?? [] },
    };
}

/**
 * `quest.progress({ id | key })` → `{ have, need, met, source, noun, label, reason, finish: { ok, reason } }`
 * (null for no such quest). `finish` is whether `quest.finish` would turn it in now, by its own rules in
 * its order (over, taken on, a target code can count, the target met, the place rule), with the first
 * reason it would refuse in plain words; screens show it instead of working the rule out again.
 */
function progressQuery(state, args = {}, tools = null) {
    const thread = findQuest(state?.domains?.director, args);
    if (!thread) return null;
    // Through the host's query when it passes one, else the documented layouts read-only.
    const query = typeof tools?.query === 'function' ? tools.query : typeof tools === 'function' ? tools : stateQuery(state);
    const target = thread.target ?? withKind(state?.domains?.inventory, parseTarget(thread.fields, thread.summary));
    const view = { ...thread, target };
    const progress = progressOf(view, query, { free: unclaimedIn(state) });
    const { have, need, met, source, noun, reason } = progress;
    return { have, need, met, source, noun, label: progressLabel(view, { have, need }), reason, finish: finishRule(view, progress, state?.domains?.scene) };
}

const TAIL_NAMES = 6;
const TAIL_CHARS = 600;     // budget 150 tokens at chars/4

function listText(names) {
    const shown = names.slice(0, TAIL_NAMES);
    const more = names.length - shown.length;
    return `${shown.join(', ')}${more > 0 ? `, and ${more} more` : ''}`;
}

/** Tail lines: open offers and quests ready to turn in (and, optional, met but elsewhere). */
export function questTail(view) {
    const state = view?.state;
    const director = state?.domains?.director;
    const lines = [];
    const optional = [];
    if (!director) return { lines, optional };
    const query = typeof view.query === 'function' ? view.query : stateQuery(state);
    const { offers, active } = questLists(director);
    if (offers.length) {
        lines.push(`Quest offers not yet taken (the reader takes them on or turns them down): ${listText(offers.map(thread => {
            const giver = text(thread.fields?.giver);
            return giver ? `${thread.key} (from ${giver})` : thread.key;
        }))}.`);
    }
    const ready = [];
    const elsewhere = [];
    for (const thread of active) {
        if (!thread.taken || !thread.target) continue;
        const progress = progressOf(thread, query, { free: unclaimedIn(state) });
        if (!progress.met) continue;
        const entry = `${thread.key} (${progressLabel(thread, progress)})`;
        if (placeRule(thread, state.domains.scene).ok) ready.push(entry);
        else elsewhere.push(entry);
    }
    if (ready.length) lines.push(`Quests ready to turn in (code pays when the reader turns one in): ${listText(ready)}.`);
    if (elsewhere.length) optional.push(`Quests done but turned in only at a settlement or with their giver: ${listText(elsewhere)}.`);
    // Keep within the budget: optional goes first, then lines are cut.
    while (optional.length && [...lines, ...optional].join('\n').length > TAIL_CHARS) optional.pop();
    return { lines: lines.map(line => (line.length > TAIL_CHARS ? `${line.slice(0, TAIL_CHARS - 1)}…` : line)), optional };
}

// Byte-identical every reply (SPEC §5): no names, counts or numbers.
export const QUEST_STATIC = 'Quest rewards: when the reader turns a quest in, code counts it, pays the reward and tells you under [Happened]; never add coins for a quest reward yourself.';

export const part = {
    domains: {},
    commands: {
        'quest.take': take,
        'quest.decline': decline,
        'quest.abandon': abandon,
        'quest.finish': finish,
    },
    queries: {
        'quest.progress': progressQuery,
    },
    kinds: {},
    context: { static: () => QUEST_STATIC, tail: questTail, budget: 150 },
    hooks: {},
    // The Quests board is the screens part's `story-director/quests` screen.
    tabs: [],
};
