// Story Director v2, part "quests" (MODULES §C2): taking on, turning down, giving up and
// turning in quests. No domain of its own: it writes only `taken`, `ended`, `target`, `reward`
// (and `offer`, `status`, `rev`) on the `director` domain's quest threads, which the tracker
// part creates from the story's change lines (the tracker also keeps `ready`, `shown` and the
// progress note from those lines).
//
// A turn-in is code from start to end: the target is counted from RPG Battle's fights or Story
// Block's inventory (a goal code cannot count is met when the story says so, F83), the place
// rule is checked on the scene, the reward is computed (per unit when it says "each") and held
// inside the quest's rank range (F87), paid once under the claim `quest:<id>:paid`, fetched items
// are handed over, and the receipt tells the next reply what happened with those numbers.
// Turn-ins follow the story (F94, F95): when the story closes a quest as turned in, the tracker
// asks `quest.finish` with `by: 'story'`; the commands stay for templates, packs and tests, and
// the default screens draw no buttons.

import { lineKey, questDifficulty } from '../../changes.js';
import { currencyName, nameMatches, nounFor, money, parseReward, parseTarget, payFor, rewardText, settleReward, targetText } from './parse.js';
import { NOT_MET_YET, beatenClaim, finishRule, isHeld, placeRule, progressLabel, progressOf, questLists, stateQuery, tryQuery, unclaimedIn } from './progress.js';
import { heldText, holdReward, questRank, rankHeldText, ranksOf } from './ranks.js';
// The director domain's Problem list: the tracker part's limits (the list it shows and the room it grows in).
import { PROBLEM_LIMIT, PROBLEM_ROOM } from '../tracker/domain.js';

export { questLists };

const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const cut = (value, max) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

// Error codes (SPEC §12, MODULES §F4): a rule refusal (a quest in the wrong state, the wrong
// place, a goal not met) is REFUSED; a target not met yet is NOT_ENOUGH.
export const CODES = Object.freeze({ notFound: 'NOT_FOUND', invalid: 'REFUSED', wrongPlace: 'REFUSED', notMet: 'NOT_ENOUGH', claimed: 'CLAIMED', failed: 'FAILED' });

/** The progress note's longest length (F85). */
export const NOTE_CHARS = 160;
/** The offer cooldown's default, in replies with Director lines (F88). */
export const OFFER_COOLDOWN = 6;

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

// `{ rev }`, with the story time (`at`, minutes) when the story has set it: for the details' dates.
function stampOf(director, rev) {
    const minutes = director?.time?.minutes;
    return Number.isSafeInteger(minutes) ? { rev, at: minutes } : { rev };
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

/**
 * The enabled packs' quest a thread is (`packs.content({ kind: 'quests' })`, by name or alias, case and
 * punctuation folded), or null. Its reward and rank win over what the story wrote (B-b3-18).
 */
export function packQuestOf(query, thread) {
    const list = tryQuery(query, 'packs.content', { kind: 'quests' }, null);
    const key = lineKey(thread?.key ?? '');
    if (!Array.isArray(list) || !key) return null;
    return list.find(record => record && typeof record === 'object'
        && [record.name, ...(Array.isArray(record.aliases) ? record.aliases : [])].some(name => typeof name === 'string' && lineKey(name) === key)) ?? null;
}

// A pack quest's own reward as the thread's reward, or null when it gives none code can read.
function packReward(pack, target, currency) {
    if (!pack || (typeof pack.reward !== 'string' && !Number.isSafeInteger(pack.reward))) return null;
    const reward = settleReward(parseReward({ reward: String(pack.reward) }, '', { currency }), target);
    return reward && reward.amount !== null ? reward : null;
}

/** The player character's level (`party.pc`, else `party.actor`), or null. */
function pcLevel(query) {
    const pc = tryQuery(query, 'party.pc', {}, null);
    const actor = typeof pc === 'string' && pc ? tryQuery(query, 'party.actor', { id: pc }, null) : pc;
    return Number.isSafeInteger(actor?.level) ? actor.level : null;
}

/**
 * A quest's terms: `{ target, reward, said, pack, rank }`. `reward` is its pack quest's when it is one
 * (`said`: the reward the story wrote, when that differs), else the one it was taken on with, else read
 * from its labels; `rank` (questRank) is the range the reward is held to.
 */
function termsFor(query, inventory, thread, currency) {
    const target = thread.target ?? withKind(inventory, parseTarget(thread.fields, thread.summary));
    const own = thread.reward ?? settleReward(parseReward(thread.fields, thread.summary, { currency }), target);
    const pack = packQuestOf(query, thread);
    const fromPack = packReward(pack, target, currency);
    const differs = fromPack && JSON.stringify(fromPack) !== JSON.stringify(own);
    const level = pcLevel(query);
    const rank = questRank(thread, ranksOf(query), { pack, level, difficulty: questDifficulty(thread.fields?.difficulty) });
    const rankNote = rank.said ? rankHeldText(rank.said, rank.rank, level) : '';
    return { target, reward: fromPack ?? own, said: differs ? own : null, pack, rank: rank.rank, rankBy: rank.by, rankNote };
}

/*
 * A written rank held to the party's (questRank): a Problem on the Director tab, once per quest (a
 * Problem already on the list for it is not repeated). Appended as the tracker part appends its own,
 * cut back to the newest PROBLEM_LIMIT once the list reaches PROBLEM_ROOM.
 */
function rankProblem(ctx, director, thread, note) {
    if (!note || !Array.isArray(director.problems)) return;
    if (director.problems.some(problem => problem?.kind === 'rank-held' && problem.key === thread.key)) return;
    const entry = { rev: ctx.rev, turn: Number.isSafeInteger(director.turn?.n) ? director.turn.n : 0, kind: 'rank-held', severity: 'info', key: thread.key, text: `${thread.key}: ${note}.` };
    if (director.problems.length >= PROBLEM_ROOM) director.problems = [...director.problems.slice(-(PROBLEM_LIMIT - 1)), entry];
    else director.problems.push(entry);
}

function termsOf(ctx, thread, currency = currencyOf(ctx.query)) {
    return termsFor(ctx.query, readOr(ctx, 'inventory'), thread, currency);
}

// The reward a quest's terms promise in all (per unit: times the target's count), or null.
const promised = (reward, target) => (reward?.each ? (target ? payFor(reward, target.count) : null) : payFor(reward, 0));

/**
 * The terms in words: "beat 3 wolves; 1 gold per wolf; D-rank", and when the promised reward is
 * outside the rank's range, "(reward clamped to D-rank range: 220–1000 gold (clamped from 5000 gold))".
 */
function termsText(target, reward, currency, rank = null, { capOnly = false } = {}) {
    const total = promised(reward, target);
    const hold = holdReward(total, rank, { capOnly });
    const said = rewardText(reward, target, currency);
    return [
        targetText(target),
        said ? `${said}${hold.held ? ` (${heldText(rank, money(total, currency), currencyName(currency))})` : ''}` : '',
        // A rank the difficulty gave only holds the top of the reward; it is not the quest's own.
        rank && !capOnly ? rank.title : '',
    ].filter(Boolean).join('; ');
}

// A sub-command: a host that reports a refusal as `{ ok: false }` instead of throwing still rejects.
function call(ctx, type, payload) {
    const result = ctx.call(type, payload);
    if (result && result.ok === false) fail(ctx, result.code || CODES.failed, result.message || `${type} was refused.`);
    return result;
}

const isOver = thread => Boolean(thread.ended) || thread.status !== 'active';

/**
 * The scene for the place rule, with the kind the atlas knows (`atlas.here`) when the scene has none:
 * a `~ place` line that moves the scene without `| kind:` leaves the scene's kind empty, and the place
 * was a settlement all the same.
 */
export function hereScene(query, scene) {
    if (text(scene?.place?.kind)) return scene;
    const here = tryQuery(query, 'atlas.here', {}, null);
    const kind = text(here?.kind);
    return kind ? { ...(scene ?? {}), place: { ...(scene?.place ?? {}), kind } } : scene;
}

function take(ctx, payload) {
    const director = ctx.draft('director');
    const thread = findQuest(director, payload);
    if (!thread) fail(ctx, CODES.notFound, 'There is no such quest.');
    if (isOver(thread)) fail(ctx, CODES.invalid, `${thread.key} is already over.`);
    if (thread.taken) fail(ctx, CODES.invalid, `${thread.key} is already taken on.`);
    const rev = receiptRev(ctx);
    const wasOffer = Boolean(thread.offer);
    const currency = currencyOf(ctx.query);
    const { target, reward, rank, rankBy, rankNote } = termsOf(ctx, thread, currency);
    thread.offer = false;
    thread.taken = stampOf(director, rev);
    thread.target = target ? { noun: target.noun, count: target.count, kind: target.kind } : null;
    thread.reward = reward;
    thread.rev = rev;
    // A held offer (F88) taken on is shown from now.
    if (thread.shown && thread.shown.turn > (director.turn?.n ?? 0)) thread.shown = { turn: director.turn?.n ?? 0 };
    const who = whoName(ctx.query);
    const terms = [termsText(thread.target, reward, currency, rank, { capOnly: rankBy === 'difficulty' }), rankNote].filter(Boolean).join('; ');
    rankProblem(ctx, director, thread, rankNote);
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
    thread.ended = { ...stampOf(director, rev), reason: text(payload?.reason) || 'turned down', outcome: 'declined' };
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
    thread.ended = { ...stampOf(director, rev), reason: text(payload?.reason) || 'given up', outcome: 'abandoned' };
    thread.rev = rev;
    return { summary: `${whoName(ctx.query)} gives up ${thread.key}.`, narrate: true, data: { quest: thread.id, key: thread.key } };
}

/*
 * `quest.finish({ id | key, by? })`. `by: 'story'` is the tracker turning a quest in because the story
 * closed it (F94): a goal code cannot count is then met on the story's word. Only a story or system
 * command may say so; a click (cause `ui`) needs the story's `met: yes` first.
 */
function finish(ctx, payload) {
    const director = ctx.draft('director');
    const thread = findQuest(director, payload);
    if (!thread) fail(ctx, CODES.notFound, 'There is no such quest.');
    if (isOver(thread)) fail(ctx, CODES.invalid, `${thread.key} is already over.`);
    if (!thread.taken) fail(ctx, CODES.invalid, `${thread.key} has not been taken on.`);
    const byStory = payload?.by === 'story' && ctx.cause !== 'ui';
    const currency = currencyOf(ctx.query);
    const { target, reward, said: written, rank, rankBy, rankNote } = termsOf(ctx, thread, currency);
    if (!target && !thread.ready && !byStory) fail(ctx, CODES.invalid, `${thread.key} is not done yet: ${NOT_MET_YET.toLowerCase()}`);
    thread.target = target ? { noun: target.noun, count: target.count, kind: target.kind } : null;
    thread.reward = reward;
    const place = placeRule(thread, hereScene(ctx.query, ctx.read('scene')));
    const rev = receiptRev(ctx);
    if (!ctx.claim(`quest:${thread.id}:paid`)) fail(ctx, CODES.claimed, `${thread.key} has already been paid.`);
    // One fight pays one kill quest (MODULES §F7): each fight counted is claimed as `beaten:<rev>`
    // while it is counted, and a fight another kill quest claimed is skipped. A refusal below
    // takes the claims back with everything else.
    const progress = progressOf(thread, ctx.query, { free: fightRev => ctx.claim(beatenClaim(fightRev)), closing: byStory });
    if (!progress.met) fail(ctx, CODES.notMet, `${thread.key} is not done yet (${progressLabel(thread, progress)}). ${progress.reason}`.trim());
    if (!place.ok) fail(ctx, CODES.wrongPlace, `${thread.key} cannot be turned in here. ${place.reason}`);

    // Fetched items are handed over: exactly the target's count, stack by stack.
    const consumed = [];
    if (target?.kind === 'items') {
        let left = target.count;
        for (const stack of progress.stacks ?? []) {
            if (left <= 0) break;
            const qty = Math.min(left, stack.qty);
            call(ctx, 'inventory.consume', { stack: stack.stack, qty });
            consumed.push({ stack: stack.stack, qty });
            left -= qty;
        }
    }
    // Per unit: the target's count at most (B-b4-10: foes beaten past the target are not paid for);
    // items: the ones handed over. A goal code cannot count pays its fixed amount (there are no units).
    const units = !target ? 0 : target.kind === 'items' ? target.count : Math.min(progress.have, target.count);
    const said = payFor(reward, units);
    // Held inside the rank's range (F87): the quest's own rank, its pack's, else the one its difficulty
    // gives (ranks.js defaultRank), so every reward is held.
    const hold = holdReward(said, rank, { capOnly: rankBy === 'difficulty' });
    const pay = hold.total;
    let paid = null;
    if (pay > 0) {
        // A whole amount of the chat's one currency (MODULES §F1, §F5).
        call(ctx, 'wallet.receive', { owner: 'party', amount: pay, note: `${thread.key} reward` });
        paid = { amount: pay, ...(hold.held ? { said, rank: rank.id, range: [...rank.reward] } : {}) };
    }
    // XP is RPG Battle's: it scales quest XP by difficulty (MODULES §F5). A written amount (an `xp:`
    // label) is never sent (B-b3-19).
    let xp = null;
    try {
        const result = call(ctx, 'party.grantXp', { quest: thread.id, difficulty: questDifficulty(thread.fields?.difficulty) });
        xp = result?.data ?? result?.receipt?.data ?? true;
    } catch (error) {
        if (error?.code !== 'UNKNOWN_COMMAND') throw error;
    }

    thread.status = 'resolved';
    thread.ended = { ...stampOf(director, rev), reason: 'turned in', outcome: 'done' };
    thread.rev = rev;

    const goal = cut(text(thread.fields?.goal), 80);
    const counted = !target ? `goal met${goal ? ` (${goal})` : ''}`
        : target.kind === 'items'
            ? `${target.count} ${nounFor(target, target.count)} handed over (target ${target.count})`
            : `${progress.have} ${nounFor(target, progress.have)} beaten (target ${target.count})`;
    const currencyWord = currencyName(currency);
    const fromPack = written && Number.isSafeInteger(written.amount) ? ` (the pack's reward for ${thread.key}; the story said ${rewardText(written, target, currency)})` : '';
    const rankText = rankNote && hold.held ? ` (${rankNote})` : '';
    if (rankNote) rankProblem(ctx, director, thread, rankNote);
    const payText = paid ? `${money(paid.amount, currency)} paid${hold.held ? ` (${heldText(rank, money(said, currency), currencyWord)})` : ''}${rankText}${fromPack}`
        : reward?.amount === 0 ? 'no reward in money'
            : reward?.text ? `reward as the story tells it: ${reward.text}`
                : 'no reward was named';
    return {
        summary: `${whoName(ctx.query)} turns in ${thread.key}: ${counted}, ${payText}.`,
        narrate: true,
        data: { quest: thread.id, key: thread.key, have: progress.have, need: progress.need, source: progress.source, units, paid, consumed, xp, fights: progress.fights ?? [], ...(byStory ? { by: 'story' } : {}) },
    };
}

const queryOf = (state, tools) => (typeof tools?.query === 'function' ? tools.query : typeof tools === 'function' ? tools : stateQuery(state));

/**
 * `quest.progress({ id | key, closing? })` → `{ have, need, met, ready, source, noun, label, reason,
 * finish: { ok, reason } }` (null for no such quest). `ready`: a goal code cannot count that the story
 * said is met (F83). `closing: true` asks as the story's own turn-in would (F94: such a goal is met on
 * the story's word). `finish` is whether `quest.finish` would turn it in now, by its own rules in its
 * order (over, taken on, the target met, the place rule), with the first reason it would refuse in plain
 * words; screens and the tracker use it instead of working the rule out again.
 */
function progressQuery(state, args = {}, tools = null) {
    const thread = findQuest(state?.domains?.director, args);
    if (!thread) return null;
    // Through the host's query when it passes one, else the documented layouts read-only.
    const query = queryOf(state, tools);
    const target = thread.target ?? withKind(state?.domains?.inventory, parseTarget(thread.fields, thread.summary));
    const view = { ...thread, target };
    const progress = progressOf(view, query, { free: unclaimedIn(state), closing: args?.closing === true });
    const { have, need, met, source, noun, reason } = progress;
    const finish = finishRule(view, progress, hereScene(query, state?.domains?.scene));
    return {
        have, need, met, ready: !target && Boolean(thread.ready), source, noun, label: progressLabel(view, { have, need }), reason, finish,
        ...(args?.closing === true ? { refusal: storyRefusal(view, progress, finish) } : {}),
    };
}

/**
 * Why the story's own turn-in is refused (F94), to finish "The story says X was turned in, but …; it
 * stays open.": '' when it is not.
 */
function storyRefusal(thread, progress, finish) {
    if (finish.ok) return '';
    if (isOver(thread)) return 'it is already over';
    if (!thread.taken) return 'it was never taken on';
    const target = thread.target;
    if (!progress.met && target) {
        if (/^No battle record/.test(progress.reason)) return 'no fights can be counted (RPG Battle is not running)';
        if (/inventory is not available/.test(progress.reason)) return 'the inventory is not available';
        return `only ${progress.have} of ${progress.need} ${nounFor(target, progress.need)} ${progress.have === 1 ? 'is' : 'are'} ${target.kind === 'items' ? 'held' : 'beaten'}`;
    }
    if (!progress.met) return 'its goal is not met yet';
    const where = text(finish.reason).replace(/^Turn it in /, '').replace(/\.$/, '');
    return where ? `it can only be turned in ${where}` : 'it cannot be turned in here';
}

/** Whether a quest has a concrete goal (F82): a `goal:`, or a target code can read. */
export function hasGoal(thread) {
    return Boolean(text(thread?.fields?.goal) || thread?.target || parseTarget(thread?.fields ?? {}, thread?.summary ?? ''));
}

// "3/3 wolves".
function countText(target, progress) {
    return `${progress.have}/${progress.need} ${nounFor(target, progress.need)}`;
}

const lowerFirst = value => value.replace(/^./, c => c.toLowerCase());

/**
 * Where a quest stands, in words for its row (F95): `{ state, text }`, state one of offered, held,
 * untaken, ready, here (ready, and it can be turned in here), notyet, over.
 */
function statusOf(thread, target, progress, finish, director) {
    if (isOver(thread)) return { state: 'over', text: '' };
    if (thread.offer && !thread.taken) {
        return isHeld(thread, director) ? { state: 'held', text: 'Held back — shown later' } : { state: 'offered', text: 'Offered — say you take it' };
    }
    if (!thread.taken) return { state: 'untaken', text: 'Not taken on yet — say you take it on' };
    const label = target ? countText(target, progress) : 'goal met';
    if (progress.met) {
        return finish.ok ? { state: 'here', text: `Ready to turn in — ${label}` } : { state: 'ready', text: `Ready — ${label}; ${lowerFirst(text(finish.reason))}` };
    }
    return { state: 'notyet', text: target ? `Not yet: ${label}` : `Not yet: ${lowerFirst(NOT_MET_YET)}` };
}

const HISTORY_SHOWN = 8;

// The receipts that touched a quest (F84): its own commands' (`data.quest`) and its change lines'
// (`data.thread`), oldest first, the last few.
function historyOf(tools, id) {
    let list = [];
    try {
        list = typeof tools?.receipts === 'function' ? tools.receipts() ?? [] : [];
    } catch {
        list = [];
    }
    return (Array.isArray(list) ? list : [])
        .map(entry => entry?.receipt ?? entry)
        .filter(receipt => receipt && (receipt.data?.quest === id || receipt.data?.thread === id) && text(receipt.summary))
        .slice(-HISTORY_SHOWN)
        .map(receipt => ({ rev: Number.isSafeInteger(receipt.rev) ? receipt.rev : null, text: cut(text(receipt.summary).replace(/^Director: /, ''), 200) }));
}

/**
 * `quest.details({ id | key })` → everything the Quests screen shows of one quest (F84), or null:
 * `{ id, key, goal, hasGoal, countable, note, giver, due, rank: { id, title, reward } | null,
 *    terms: { target, reward, held, text }, ready, taken: { rev, at? } | null,
 *    ended: { rev, at?, reason, outcome } | null, status: { state, text }, history: [{ rev, text }] }`.
 * `note` is the rolling progress note (the story's `progress:` or `step:`, F85), at most NOTE_CHARS.
 */
function detailsQuery(state, args = {}, tools = null) {
    const director = state?.domains?.director;
    const thread = findQuest(director, args);
    if (!thread) return null;
    const query = queryOf(state, tools);
    const currency = currencyOf(query);
    const { target, reward, rank, rankBy } = termsFor(query, state?.domains?.inventory, thread, currency);
    const view = { ...thread, target };
    const progress = progressOf(view, query, { free: unclaimedIn(state) });
    const finish = finishRule(view, progress, hereScene(query, state?.domains?.scene));
    const total = promised(reward, target);
    const capOnly = rankBy === 'difficulty';
    const hold = holdReward(total, rank, { capOnly });
    const fields = thread.fields ?? {};
    return {
        id: thread.id,
        key: text(thread.key),
        goal: text(fields.goal) || text(thread.summary),
        hasGoal: hasGoal(thread),
        countable: Boolean(target),
        note: cut(text(fields.progress) || text(fields.step), NOTE_CHARS),
        giver: text(fields.giver),
        due: text(fields.due),
        rank: rank && !capOnly ? { id: rank.id, title: rank.title, reward: [...rank.reward] } : null,
        terms: {
            target: targetText(target),
            reward: rewardText(reward, target, currency),
            held: hold.held ? heldText(rank, money(total, currency), currencyName(currency)) : '',
            text: termsText(target, reward, currency, rank, { capOnly }),
        },
        ready: !target && Boolean(thread.ready),
        taken: thread.taken ? { ...thread.taken } : null,
        ended: thread.ended ? { ...thread.ended } : null,
        status: statusOf(thread, target, progress, finish, director),
        history: historyOf(tools, thread.id),
    };
}

const TAIL_NAMES = 6;
const TAIL_CHARS = 1000;    // budget 250 tokens at chars/4
const JUDGED_SHOWN = 3;     // F83: open quests code cannot count, one line each
const GOAL_CHARS = 80;

function listText(names) {
    const shown = names.slice(0, TAIL_NAMES);
    const more = names.length - shown.length;
    return `${shown.join(', ')}${more > 0 ? `, and ${more} more` : ''}`;
}

const byRecent = (a, b) => (b.rev ?? 0) - (a.rev ?? 0) || text(a.key).localeCompare(text(b.key)) || (a.id < b.id ? -1 : 1);

/**
 * Tail lines: open offers (not held ones), quests with no goal yet (F82), up to three quests code cannot
 * count with their goal (F83), quests ready to turn in (and, optional, met but elsewhere).
 */
export function questTail(view) {
    const state = view?.state;
    const director = state?.domains?.director;
    const lines = [];
    const optional = [];
    if (!director) return { lines, optional };
    const query = typeof view.query === 'function' ? view.query : stateQuery(state);
    const { offers, active } = questLists(director);
    if (offers.length) {
        lines.push(`Quest offers not yet taken ({{user}} takes them on or turns them down in their own words): ${listText(offers.map(thread => {
            const giver = text(thread.fields?.giver);
            return giver ? `${thread.key} (from ${giver})` : thread.key;
        }))}.`);
    }
    const goalless = [...offers, ...active].filter(thread => !hasGoal(thread));
    if (goalless.length) lines.push(`Quests with no goal yet (give each a concrete goal: ~ quest Name | goal: …): ${listText(goalless.map(thread => thread.key))}.`);
    const ready = [];
    const elsewhere = [];
    const judged = [];
    for (const thread of active) {
        if (!thread.taken) continue;
        const target = thread.target;
        if (!target && !thread.ready) {
            if (hasGoal(thread)) judged.push(thread);
            continue;
        }
        const progress = progressOf(thread, query, { free: unclaimedIn(state) });
        if (!progress.met) continue;
        const entry = target ? `${thread.key} (${progressLabel(thread, progress)})` : `${thread.key} (goal met)`;
        if (placeRule(thread, hereScene(query, state.domains.scene)).ok) ready.push(entry);
        else elsewhere.push(entry);
    }
    for (const thread of judged.sort(byRecent).slice(0, JUDGED_SHOWN)) {
        lines.push(`Quest goal the story judges: ${thread.key} — ${cut(text(thread.fields?.goal), GOAL_CHARS)}.`);
    }
    if (ready.length) lines.push(`Quests ready to turn in here (code checks and pays when the story turns one in): ${listText(ready)}.`);
    if (elsewhere.length) optional.push(`Quests done but turned in only at a settlement or with their giver: ${listText(elsewhere)}.`);
    // Keep within the budget: optional goes first, then lines are cut.
    while (optional.length && [...lines, ...optional].join('\n').length > TAIL_CHARS) optional.pop();
    return { lines: lines.map(line => cut(line, TAIL_CHARS)), optional };
}

// Byte-identical every reply (SPEC §5): no names, counts or numbers.
export const QUEST_STATIC = [
    'Quest rewards: when a quest is turned in, code checks it, pays the reward and tells you under [Happened]; never add coins for a quest reward yourself.',
    'Turning in: close a quest when {{user}} turns it in (- quest Name — turned in); code checks the goal and the place, then pays, or tells you why it stays open.',
    'Every quest needs a concrete goal (| goal: what counts as done). When the goal of a quest code cannot count is met in the story, write ~ quest Name | met: yes (met: no if it is undone). Keep one short line of where it stands: ~ quest Name | progress: …',
    'Quest pacing: offer a new quest rarely, when the story calls for it, and leave quiet stretches with no new jobs. A passer-by is only a passer-by, not a quest-giver. Trouble does not come looking for {{user}} unless they provoke it.',
].join('\n');

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
        'quest.details': detailsQuery,
        'quest.ranks': (state, _args, tools) => ranksOf(queryOf(state, tools)),
    },
    kinds: {},
    context: { static: () => QUEST_STATIC, tail: questTail, budget: 250 },
    hooks: {},
    settings: {
        section: 'Quests',
        defaults: { offerCooldown: OFFER_COOLDOWN },
        schema: {
            // F88: replies with Director lines between two quest offers; an offer sooner is kept and shown later.
            offerCooldown: { type: 'int', label: 'Replies between quest offers (0: no limit)', min: 0, max: 100 },
        },
    },
    // The Quests board is the screens part's `story-director/quests` screen.
    tabs: [],
};
