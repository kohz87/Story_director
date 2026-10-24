// Story Director v2, part "quests" (MODULES §C2): taking on, giving up and turning in quests. No
// domain of its own: it writes only `taken`, `ended`, `target`, `reward` (and `offer`, `status`,
// `rev`) on the `director` domain's quest threads, which the tracker part creates from the story's
// change lines (the tracker also keeps `ready` and the progress note from those lines).
//
// There are no offers to accept: the story writes `+ quest` when {{user}} accepts a job, and the
// tracker takes it on at once (`quest.take`). A job the story only mentions stays in the story. An
// older chat's offers (`offer: true`) still load; they are shown nowhere and become the quest when
// the story writes `+ quest` for one.
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
import { coinPhrase, currencyName, nameMatches, nounFor, money, parseReward, parseTarget, payFor, rewardText, settleReward, targetText, unknownCoin } from './parse.js';
import { NOT_MET_YET, beatenClaim, countedTarget, finishRule, giverHere, isSettlementKind, placeRule, progressLabel, progressOf, questLists, stateQuery, tryQuery, unclaimedIn } from './progress.js';
import { heldText, questRank, rankHeldText, ranksOf, replyBudget, rewardHold } from './ranks.js';
// The director domain's Problem list: the tracker part's limits (the list it shows and the room it grows in).
import { addProblem, dropProblems, problemList, replyDraft, replyTurn } from '../tracker/domain.js';

export { questLists };

/** The step that pays a reward owed (a system step after each reply's last line, quest-lines.js afterCapture credit). */
export const PAY_OWED = 'quest.payOwed';

const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const cut = (value, max) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

// Error codes (SPEC §12, MODULES §F4): a rule refusal (a quest in the wrong state, the wrong
// place, a goal not met) is REFUSED; a target not met yet is NOT_ENOUGH.
export const CODES = Object.freeze({ notFound: 'NOT_FOUND', invalid: 'REFUSED', wrongPlace: 'REFUSED', notMet: 'NOT_ENOUGH', claimed: 'CLAIMED', failed: 'FAILED' });

/** The progress note's longest length (F85). */
export const NOTE_CHARS = 160;

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

/** The chat's one currency (`inventory.currency`, MODULES §F1), `{ name, plural, short }`; gold without it. */
function currencyOf(query) {
    const currency = tryQuery(query, 'inventory.currency', {}, null);
    return {
        name: currencyName(currency), plural: text(currency?.plural), short: text(currency?.short),
        ...(Array.isArray(currency?.coins) && currency.coins.length ? { coins: currency.coins, ...(currency.display === 'base' ? { display: 'base' } : {}) } : {}),
    };
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

/** "no character level is known, so it pays as F-rank, the lowest". */
export const noLevelText = rank => `no character level is known, so it pays as ${rank.title}, the lowest`;

/** The player character's level (`party.pc`, else `party.actor`), or null. */
function pcLevel(query) {
    const pc = tryQuery(query, 'party.pc', {}, null);
    const actor = typeof pc === 'string' && pc ? tryQuery(query, 'party.actor', { id: pc }, null) : pc;
    return Number.isSafeInteger(actor?.level) ? actor.level : null;
}

/**
 * A quest's terms: `{ target, reward, said, pack, rank }`. `reward` is its pack quest's when it is one
 * (`said`: the reward the story wrote, when that differs), else the one it was taken on with, else read
 * from its labels; `rank` (questRank) is the range the reward is held to (a written rank: at most the
 * party's own). `budget`: the most one reply may pay in rewards the story wrote (replyBudget), used
 * only when Story Block does not keep that tally itself (spendOf).
 */
function termsFor(query, inventory, thread, currency) {
    const target = thread.target ?? withKind(inventory, parseTarget(thread.fields, thread.summary));
    const read = thread.reward ? null : parseReward(thread.fields, thread.summary, { currency });
    const own = thread.reward ?? settleReward(read, target);
    const pack = packQuestOf(query, thread);
    const fromPack = packReward(pack, target, currency);
    const differs = fromPack && JSON.stringify(fromPack) !== JSON.stringify(own);
    const level = pcLevel(query);
    const ladder = ranksOf(query);
    const rank = questRank(thread, ladder, { pack, level, difficulty: questDifficulty(thread.fields?.difficulty) });
    const rankNote = rank.said ? rankHeldText(rank.said, rank.rank, level) : '';
    // Story Director stands alone (WAVE rule 11): with no character level known (no RPG Battle), a
    // quest the pack does not rank pays as the lowest rank, and the terms say so.
    const levelNote = level === null && rank.rank && rank.by === 'difficulty' ? noLevelText(rank.rank) : '';
    // B-a1-16: a coin amount code refused ("2 platinum" where the chat has no platinum) pays nothing
    // code counts; the story settles it, and the reader is told why.
    // A reward kept unpaid at take-on (amount null) is read again for the reason, so the terms keep saying why.
    const why = read ?? (thread.reward?.amount === null && text(thread.reward.text) ? parseReward({ reward: thread.reward.text }, '', { currency }) : null);
    const rewardNote = !fromPack && typeof why?.problem === 'string' ? why.problem.replace(/\.$/, '') : '';
    return { target, reward: fromPack ?? own, said: differs ? own : null, pack, byPack: Boolean(fromPack), rank: rank.rank, rankBy: rank.by, rankNote, levelNote, rewardNote, budget: replyBudget(ladder, level) };
}

/*
 * What a turn-in pays before the reply's budget: `{ units, said, hold, pay, storyMoney }`. Per unit: the
 * target's count at most (B-b4-10: foes beaten past the target are not paid for); items: the ones
 * handed over. A goal code cannot count pays its fixed amount (there are no units). Held inside the
 * rank's range (F87, rewardHold). `storyMoney`: every reward but a pack quest's own is the story's
 * number, held to what one reply may pay (budgetRule, RX-E-1), counted or not.
 */
function payOf(terms, target, progress) {
    const units = !target ? 0 : target.kind === 'items' ? target.count : Math.min(progress.have, target.count);
    const said = payFor(terms.reward, units);
    const hold = rewardHold(said, terms.rank, terms.rankBy);
    return { units, said, hold, pay: hold.total, storyMoney: !terms.byPack };
}

const isAmount = value => Number.isSafeInteger(value) && value >= 0;

/*
 * What one reply may pay in money the story wrote: `{ budget, used, quests, host }`, `used` what it has
 * paid and `quests` the part of it quest turn-ins (vouched payouts) paid. Story Block keeps one tally per
 * reply (RX-E-2): `inventory.storyBudget` → `{ budget, paid, left, vouched }` counts the reply's own
 * `+ coin` lines, the quests it closed and the clicks after it, against the reader's `storyCoinPerReply`
 * or the party rank's top (`host: true`). Without that query (an older Story Block, which does not count
 * clicks) this module keeps its own: `paid` in `director.turn.now`, what this reply's turn-ins paid,
 * against `budget` (replyBudget; the tracker starts a fresh `turn` for each reply's Director lines, so
 * the tally goes with the reply, as `vouched` does).
 */
function spendOf(query, director, budget) {
    const host = tryQuery(query, 'inventory.storyBudget', {}, null);
    if (isAmount(host?.budget) && isAmount(host?.paid)) {
        const used = Math.min(host.paid, host.budget);
        return { budget: host.budget, used, quests: isAmount(host.vouched) ? Math.min(host.vouched, used) : used, host: true };
    }
    const used = replyTurn(director).paid;
    return { budget, used, quests: used, host: false };
}

/*
 * One reply pays at most its budget (spendOf) in rewards the story wrote (RX-E-1: four "bring 1 Torch"
 * quests one reply wrote, finished by clicks, paid four rank tops; RX-E-2: a reply's `+ coin` lines and
 * a Finish click after it). A turn-in waits for the next reply, unpaid and open, when nothing is left, or
 * when another turn-in already paid from this reply's budget and this one does not fit: `{ ok: false,
 * budget: true, reason }`, else null. The reply's first turn-in is otherwise paid what is left (the
 * story's own coin lines may have taken part of it).
 */
function budgetRule(spend, pay, currency) {
    if (!pay.storyMoney || !Number.isSafeInteger(pay.pay) || pay.pay <= 0) return null;
    const { budget, used, quests, host } = spend;
    if (used + pay.pay <= budget || (used < budget && quests <= 0)) return null;
    const what = host ? 'in money the story wrote, quest rewards included' : 'in quest rewards the story wrote';
    return { ok: false, budget: true, reason: `One reply pays at most ${money(budget, currency)} ${what} (${money(used, currency)} so far); it is ready for the next reply.` };
}

// What this turn-in may pay of `pay`: a reward the story wrote, what is left of this reply's budget.
function spendBudget(spend, pay) {
    if (!pay.storyMoney) return pay.pay;
    return Math.max(0, Math.min(pay.pay, spend.budget - spend.used));
}

/*
 * A written rank held to the party's (questRank): a Problem on the Director tab, once per quest (a
 * Problem already on the list for it is not repeated), kept as the tracker part keeps its own.
 */
function rankProblem(ctx, director, thread, note, kind = 'rank-held') {
    if (!note) return;
    if (problemList(director).some(problem => problem?.kind === kind && problem.key === thread.key)) return;
    addProblem(director, ctx, { kind, severity: 'info', key: thread.key, text: `${thread.key}: ${note}.` });
}

/** A reward in coins code would not read (termsFor's rewardNote): a Problem once per quest, as rankProblem. */
const rewardProblem = (ctx, director, thread, note) => rankProblem(ctx, director, thread, note ? `the reward is not counted, ${note}` : '', 'reward-coin');

/** A reward owed (finish): a Problem once per quest, worded as owed; it goes when the reward is paid (payOwed). */
function owedProblem(ctx, director, thread, note) {
    // The Problem the take-on raised for the same words ("not counted") becomes this one, worded as owed.
    dropProblems(director, problem => problem.kind === 'reward-coin' && problem.key === thread.key);
    if (problemList(director).some(problem => problem?.kind === 'reward-owed' && problem.key === thread.key)) return;
    addProblem(director, ctx, { kind: 'reward-owed', severity: 'warn', key: thread.key, text: `${thread.key}: ${note}.` });
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
function termsText(target, reward, currency, rank = null, { by = null } = {}) {
    const total = promised(reward, target);
    const hold = rewardHold(total, rank, by);
    const said = rewardText(reward, target, currency);
    return [
        targetText(target),
        said ? `${said}${hold.held ? ` (${heldText(rank, money(total, currency), currency)})` : ''}` : '',
        // A rank the difficulty gave is not the quest's own: its name is not shown.
        rank && by !== 'difficulty' ? rank.title : '',
    ].filter(Boolean).join('; ');
}

// A sub-command: a host that reports a refusal as `{ ok: false }` instead of throwing still rejects.
function call(ctx, type, payload) {
    const result = ctx.call(type, payload);
    if (result && result.ok === false) fail(ctx, result.code || CODES.failed, result.message || `${type} was refused.`);
    return result;
}

const isOver = thread => Boolean(thread.ended) || thread.status !== 'active';

/*
 * A goal code cannot count is met on the story's word alone (F83, F94), so one reply turns in at most
 * `limit` such quests (B-b3-r2-5; the Quests setting "Story's-word turn-ins per reply", WORD_LIMIT, 1 by
 * default): `vouched` in `director.turn.now` is the first this reply turned in, `words` all of them (kept
 * only while the limit is above 1). The tracker starts a fresh `turn` for each reply's Director lines, so
 * the mark goes with the reply (and a click after the reply counts against it too). `{ ok: false, word:
 * true, other, limit, reason }` when this reply's turn-ins on the story's word are used up, else null.
 */
function wordRule(director, thread, target, limit = 1) {
    if (target) return null;
    const used = replyTurn(director).words;
    if (used.includes(thread.id) || used.length < limit) return null;
    const other = text(director.threads?.[used.at(-1)]?.key) || 'another quest';
    const reason = limit === 1
        ? `One reply turns in only one quest on the story's word alone (${other} was); it is ready for the next reply.`
        : `One reply turns in at most ${limit} quests on the story's word alone (${used.length} were); it is ready for the next reply.`;
    return { ok: false, word: true, other, limit, reason };
}

// The Quests setting "Story's-word turn-ins per reply": a whole number from 1 to 5, 1 by default.
export const WORD_LIMIT = Object.freeze({ min: 1, max: 5, default: 1 });
function wordLimit(settings) {
    let own = null;
    try { own = typeof settings === 'function' ? settings() : null; } catch { own = null; }
    const value = Number(own?.wordTurnIns);
    return Number.isSafeInteger(value) ? Math.min(WORD_LIMIT.max, Math.max(WORD_LIMIT.min, value)) : WORD_LIMIT.default;
}

/*
 * The story's own coin this reply (its `+ coin` lines; Story Block's `inventory.storyBudget` → paid less
 * the modules' vouched payouts), which a story or system turn-in counts as its reward instead of paying
 * on top of it, so the reward and the story's coin for it never stack. Counted for one turn-in a reply
 * (claim `storycoin:<sid>`). 0 on a Story Block without that query, or once claimed.
 */
// What of the story's coin this reply counts as this quest's reward (`owed`, payOf): when it is the reward's
// amount, or when the giver is here (the giver paying); never more than the reward. 0 otherwise: coin the
// story wrote for something else is not a quest's.
function creditFor(coin, owed, here) {
    if (!(coin > 0) || !(owed?.pay > 0)) return 0;
    return here || coin === owed.pay || coin === owed.said ? Math.min(coin, owed.pay) : 0;
}

function storyCoinOf(query, claims, sid) {
    if (typeof sid !== 'string' || !sid || (claims && Object.hasOwn(claims, `storycoin:${sid}`))) return 0;
    const host = tryQuery(query, 'inventory.storyBudget', {}, null);
    if (!isAmount(host?.paid)) return 0;
    return Math.max(0, host.paid - (isAmount(host.vouched) ? host.vouched : 0));
}

/**
 * The scene for the place rule, with the kind the atlas knows (`atlas.here`) when the scene's is not a
 * settlement's: a `~ place` line that moves the scene without `| kind:` leaves the scene's kind empty
 * (Story Block before 2.0.0-alpha.2) or keeps the last place's ("wild" from the ridge, back in town),
 * and the place the map knows was a settlement all the same.
 */
export function hereScene(query, scene) {
    const own = text(scene?.place?.kind);
    if (isSettlementKind(own)) return scene;
    const here = tryQuery(query, 'atlas.here', {}, null);
    const kind = [here?.placeKind, here?.kind].map(text).find(isSettlementKind) ?? (own ? '' : text(here?.kind));
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
    const { target, reward, rank, rankBy, rankNote, levelNote, rewardNote } = termsOf(ctx, thread, currency);
    thread.offer = false;
    thread.taken = stampOf(director, rev);
    thread.target = target ? { noun: target.noun, count: target.count, kind: target.kind } : null;
    thread.reward = reward;
    thread.rev = rev;
    const who = whoName(ctx.query);
    const terms = [termsText(thread.target, reward, currency, rank, { by: rankBy }), rankNote || levelNote].filter(Boolean).join('; ');
    rankProblem(ctx, director, thread, rankNote);
    rewardProblem(ctx, director, thread, rewardNote);
    // The story's own `+ quest` already told it: the quest is only adopted for counting. An older chat's
    // offer taken on by a template's or pack's button is news for the next reply.
    return {
        summary: wasOffer ? `${who} takes on ${thread.key}${terms ? `: ${terms}` : ''}.` : `${who} keeps count for ${thread.key}${terms ? `: ${terms}` : ''}.`,
        narrate: wasOffer,
        data: { quest: thread.id, key: thread.key, target: thread.target, reward },
    };
}

function abandon(ctx, payload) {
    const director = ctx.draft('director');
    const thread = findQuest(director, payload);
    if (!thread) fail(ctx, CODES.notFound, 'There is no such quest.');
    if (isOver(thread)) fail(ctx, CODES.invalid, `${thread.key} is already over.`);
    if (thread.offer && !thread.taken) fail(ctx, CODES.invalid, `${thread.key} was never taken on.`);
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
    const { target, reward, said: written, byPack, rank, rankBy, rankNote, levelNote, budget } = termsOf(ctx, thread, currency);
    // What code counts: a kill goal with no module counting fights is the story's word (WAVE rule 11).
    const counted = countedTarget(target, ctx.query);
    if (!counted && !thread.ready && !byStory) fail(ctx, CODES.invalid, `${thread.key} is not done yet: ${NOT_MET_YET.toLowerCase()}`);
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
    const limit = wordLimit(ctx.settings);
    const word = wordRule(director, thread, counted, limit);
    if (word) fail(ctx, CODES.invalid, `${thread.key} cannot be turned in yet. ${word.reason}`);
    const terms = { reward, byPack, rank, rankBy };
    const full = payOf(terms, target, progress);
    // The story already wrote coin this reply (its own `+ coin` line for the reward): counted as the
    // reward, never on top of it. Not for a click, whose coin is the reader's own action.
    const coin = ctx.cause === 'ui' ? 0 : creditFor(storyCoinOf(ctx.query, null, ctx.reply?.sid), full, giverHere(thread, hereScene(ctx.query, ctx.read('scene'))));
    // Claimed once a reply: a second turn-in of the same reply finds it counted already.
    const credit = coin > 0 && ctx.claim(`storycoin:${ctx.reply.sid}`) ? coin : 0;
    const owed = { ...full, pay: full.pay - credit };
    // A reward in a coin word this chat cannot count ("30 copper bits" with no such coin) is not lost: the quest
    // closes as it is, the reward is OWED (thread.owed) and paid once the chat can count it (quest.payOwed).
    // The story's own coin this reply, with the giver here, counts toward it as it does toward a counted reward.
    const coinWord = !byPack && reward && reward.amount === null ? unknownCoin(reward.text, currency) : '';
    const wordCoin = coinWord && ctx.cause !== 'ui' && giverHere(thread, hereScene(ctx.query, ctx.read('scene'))) ? storyCoinOf(ctx.query, null, ctx.reply?.sid) : 0;
    const wordCredit = wordCoin > 0 && ctx.claim(`storycoin:${ctx.reply.sid}`) ? wordCoin : 0;
    const spend = spendOf(ctx.query, director, budget);
    const over = budgetRule(spend, owed, currency);
    if (over) fail(ctx, CODES.invalid, `${thread.key} cannot be turned in yet. ${over.reason}`);
    const now = replyDraft(director);
    if (!counted && now) {
        if (limit === 1) now.vouched = thread.id;
        else {
            if (!now.vouched) now.vouched = thread.id;
            now.words = [...replyTurn(director).words.filter(id => id !== thread.id), thread.id];
        }
    }

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
    // Held inside the rank's range (F87): the quest's own rank, its pack's, else the one its difficulty
    // gives (ranks.js defaultRank), so every reward is held; only a pack's reward is raised to the
    // floor (rewardHold). Then held to what this reply may still pay (budgetRule).
    const { units, said, hold, pay } = owed;
    const allowed = spendBudget(spend, owed);
    let paid = null;
    if (credit > 0 && pay <= 0) paid = { amount: 0, story: credit, ...(hold.held ? { said, rank: rank.id, range: [...rank.reward] } : {}) };
    if (pay > 0) {
        // A whole amount of the chat's one currency (MODULES §F1, §F5). A reward the story wrote (every
        // one but a pack quest's own) is the story's money: `story: true` asks Story Block to count it
        // against what one reply may give (B-b3-r2-5, RX-E-1), in the tally spendOf read (RX-E-2). A Story
        // Block without that budget ignores the flag; this reply's own tally then holds. What it says it
        // paid is what was paid.
        let amount = 0;
        if (allowed > 0) {
            const out = call(ctx, 'wallet.receive', { owner: 'party', amount: allowed, note: `${thread.key} reward`, ...(owed.storyMoney ? { story: true } : {}) });
            const given = out?.data?.amount ?? out?.receipt?.data?.amount;
            amount = Number.isSafeInteger(given) && given >= 0 && given < allowed ? given : allowed;
        }
        if (owed.storyMoney && now && !spend.host) now.paid = replyTurn(director).paid + amount;
        paid = { amount, ...(credit > 0 ? { story: credit } : {}), ...(hold.held ? { said, rank: rank.id, range: [...rank.reward] } : {}), ...(amount < pay ? { owed: pay } : {}) };
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
    const phrase = coinWord ? coinPhrase(reward.text, coinWord) : '';
    if (coinWord) {
        thread.owed = { text: cut(text(reward.text), OWED_CHARS), rev, units, ...(wordCredit > 0 ? { credit: wordCredit } : {}) };
        owedProblem(ctx, director, thread, `${thread.owed.text} is owed, not paid by code: "${phrase}" is not a coin this chat counts. Add ${phrase} under Settings → Coins and it is paid with the next reply`);
    }

    const goal = cut(text(thread.fields?.goal), 80);
    const done = !counted ? `goal met${goal ? ` (${goal})` : ''}${target ? ' on the story\'s word (no fights are counted)' : ''}`
        : target.kind === 'items'
            ? `${target.count} ${nounFor(target, target.count)} handed over (target ${target.count})`
            : `${progress.have} ${nounFor(target, progress.have)} beaten (target ${target.count})`;
    const fromPack = written && Number.isSafeInteger(written.amount) ? ` (the pack's reward for ${thread.key}; the story said ${rewardText(written, target, currency)})` : '';
    const rankText = (rankNote || levelNote) && hold.held ? ` (${rankNote || levelNote})` : '';
    if (rankNote) rankProblem(ctx, director, thread, rankNote);
    const budgetText = paid?.owed ? ` (${money(paid.owed, currency)} was owed; one reply may give no more)` : '';
    const storyText = paid?.story ? ` (${money(paid.story, currency)} of it the story's own coin this reply)` : '';
    const payText = paid ? `${money(paid.amount + (paid.story ?? 0), currency)} paid${storyText}${hold.held ? ` (${heldText(rank, money(said, currency), currency)})` : ''}${rankText}${fromPack}${budgetText}`
        : reward?.amount === 0 ? 'no reward in money'
            : coinWord ? `${reward.text} is owed: the chat cannot count "${phrase}" yet, so it is paid with a later reply once it can${wordCredit > 0 ? ` (the story's own coin this reply, ${money(wordCredit, currency)}, counts toward it)` : ''}`
            : reward?.text ? `reward as the story tells it: ${reward.text}`
                : 'no reward was named';
    return {
        summary: `${whoName(ctx.query)} turns in ${thread.key}: ${done}, ${payText}.`,
        narrate: true,
        data: { quest: thread.id, key: thread.key, have: progress.have, need: progress.need, source: progress.source, units, paid, consumed, xp, fights: progress.fights ?? [], ...(coinWord ? { owed: { text: thread.owed.text, ...(wordCredit > 0 ? { credit: wordCredit } : {}) } } : {}), ...(byStory ? { by: 'story' } : {}) },
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
    const counted = countedTarget(target, query);
    const view = { ...thread, target };
    const progress = progressOf(view, query, { free: unclaimedIn(state), closing: args?.closing === true });
    const { have, need, met, source, noun, reason } = progress;
    const scene = hereScene(query, state?.domains?.scene);
    const rule = finishRule(view, progress, scene);
    const director = state?.domains?.director;
    let finish = rule.ok ? wordRule(director, thread, counted, wordLimit(tools?.settings)) ?? rule : rule;
    // Refused only by where the scene is: the story's own turn-in then waits for the scene the reply ends
    // up in (the tracker's pending turn-ins, tracker/quest-lines.js), as its place lines may come after it.
    const placeOnly = !rule.ok && progress.met && !isOver(thread) && Boolean(thread.taken) && !placeRule(view, scene).ok;
    if (finish.ok && progress.met) {
        const currency = currencyOf(query);
        const terms = termsFor(query, state?.domains?.inventory, thread, currency);
        const owed = payOf(terms, target, progress);
        // Asked as the story's or a system step's turn-in (`closing`, `asStory`): the story's own coin this
        // reply counts as the reward (finish); a click's does not.
        const story = args?.closing === true || args?.asStory === true;
        const credit = story ? creditFor(storyCoinOf(query, state?.meta?.claims ?? null, tools?.reply?.sid), owed, giverHere(view, scene)) : 0;
        finish = budgetRule(spendOf(query, director, terms.budget), { ...owed, pay: owed.pay - credit }, currency) ?? finish;
    }
    return {
        have, need, met, ready: !counted && Boolean(thread.ready), countable: Boolean(counted), source, noun, label: progressLabel(view, { have, need }), reason, finish,
        ...(args?.closing === true ? { refusal: storyRefusal(view, progress, finish), place: placeOnly } : {}),
    };
}

/**
 * `quest.repeatedCoin()` → `{ amount }`: the story's own coin this reply (`tools.reply`) that repeats a quest
 * reward code already paid in it: the story wrote `+ coin` after the turn-in had paid, so turn-in and coin
 * would stack. At most the rewards modules paid this reply on the story's word (`inventory.storyBudget`
 * vouched). 0 once the reply's coin was counted (claim `storycoin:<sid>`), or on a Story Block without the
 * query. The afterCapture step takes it back (quest.settle { repeated: true }).
 */
function repeatedCoin(state, _args = {}, tools = null) {
    const sid = tools?.reply?.sid;
    const lines = storyCoinOf(queryOf(state, tools), state?.meta?.claims ?? null, sid);
    if (lines <= 0) return { amount: 0 };
    const query = queryOf(state, tools);
    const host = tryQuery(query, 'inventory.storyBudget', {}, null);
    const vouched = isAmount(host?.vouched) ? host.vouched : 0;
    if (vouched <= 0) return { amount: 0 };
    // For a reward: the same amount, or a quest this reply closed whose giver is here.
    const director = state?.domains?.director;
    const turn = replyTurn(director);
    const scene = hereScene(query, state?.domains?.scene);
    const closedHere = turn.reply === sid && questLists(director).finished
        .some(thread => thread.track?.closed?.turn === director?.turn?.n && giverHere(thread, scene));
    return { amount: lines === vouched || closedHere ? Math.min(lines, vouched) : 0 };
}

const looseName = value => text(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// The names of the items the reply's story lines gave (Story Block's per-reply tally, `perReply[<sid>]
// .items` by def id), [] when the host keeps none.
function itemsGiven(state, sid) {
    const inventory = state?.domains?.inventory;
    const items = inventory?.perReply?.[sid]?.items;
    if (!items || typeof items !== 'object') return [];
    return Object.keys(items).map(id => looseName(inventory?.defs?.[id]?.name)).filter(name => name.length >= 3);
}

// A delivery goal: "bring / deliver / take / return / carry <thing> to <someone or somewhere>" (the goal, else
// the summary). `thing` is the words between the verb and "to".
const DELIVERY = /\b(?:bring|deliver|take|return|carry|fetch)\s+(?:back\s+)?(.{1,80}?)\s+(?:back\s+)?to\b/iu;
// What a progress note says when the thing was handed over ("pelt brought to guild").
const DELIVERED = /\b(?:brought|delivered|handed(?:\s+(?:over|in))?|returned|carried|gave|given|turned\s+in)\b/iu;
// Words of a delivered thing that do not name it.
const THING_FILLER = new Set(['the', 'a', 'an', 'some', 'his', 'her', 'their', 'its', 'my', 'your', 'our', 'back', 'all', 'of']);

/** The head word of what a delivery goal brings ("the pack-leader's pelt" → "pelt"), singular, or ''. */
export function deliveredThing(thread) {
    const goal = text(thread?.fields?.goal) || text(thread?.summary);
    const found = DELIVERY.exec(goal);
    if (!found) return '';
    const words = looseName(found[1]).split(' ').filter(word => word.length >= 3 && !THING_FILLER.has(word));
    return singularWord(words.at(-1) ?? '');
}

const singularWord = word => (/ies$/.test(word) ? `${word.slice(0, -3)}y` : /(?:ches|shes|xes|ses)$/.test(word) ? word.slice(0, -2) : /[^s]s$/.test(word) ? word.slice(0, -1) : word);
const namesThing = (name, thing) => Boolean(thing) && looseName(name).split(' ').map(singularWord).includes(thing);

/*
 * Whether the reply shows the delivery made (autoTurnIns): the thing the goal brings (deliveredThing) is held
 * by the party or was given this reply (`given`, the reply's items), or the quest's progress note says it was
 * brought or delivered. A goal that is not a delivery: false.
 */
function delivered(state, thread, given) {
    const thing = deliveredThing(thread);
    if (!thing) return false;
    const inventory = state?.domains?.inventory;
    const held = Object.values(inventory?.stacks ?? {}).filter(stack => stack?.owner === 'party' && (stack.qty ?? 1) > 0)
        .map(stack => text(inventory?.defs?.[stack.def]?.name));
    if ([...held, ...given].some(name => namesThing(name, thing))) return true;
    const note = `${text(thread.fields?.progress)} ${text(thread.fields?.step)}`;
    return DELIVERED.test(note) && namesThing(note, thing);
}

/**
 * `quest.autoTurnIns()` → [thread id]: the quests the reply asked about (`tools.reply`, the head reply)
 * turned in from where things stand, with no turn-in line read as one (Story Director's afterCapture step,
 * quest-lines.js): open and taken, the goal met by code or by the story's `met: yes` (never on the story's
 * word alone), quest.finish's rules allow it here now (the place, the per-reply limits), and the reply
 * shows it was turned in: a quest line of this reply in turn-in words (the tracker's `intent`), the story's
 * own coin this reply equal to the reward, or an item the reply gave named in the reward.
 */
function autoTurnIns(state, _args = {}, tools = null) {
    const director = state?.domains?.director;
    const sid = tools?.reply?.sid;
    if (!director || typeof sid !== 'string' || !sid) return [];
    const query = queryOf(state, tools);
    const turn = replyTurn(director);
    const intent = turn.reply === sid ? turn.intent : [];
    const coin = storyCoinOf(query, state?.meta?.claims ?? null, sid);
    const given = itemsGiven(state, sid);
    const currency = currencyOf(query);
    const out = [];
    for (const thread of questLists(director).active) {
        if (!thread.taken || turn.pending.includes(thread.id)) continue;
        const check = progressQuery(state, { id: thread.id, asStory: true }, tools);
        if (!check?.met || check.finish?.ok !== true) continue;
        // The giver handing over the coin or the item: only with the giver here.
        const here = giverHere(thread, hereScene(query, state?.domains?.scene));
        let shown = intent.includes(thread.id);
        if (!shown && here && coin > 0) {
            const terms = termsFor(query, state?.domains?.inventory, thread, currency);
            const target = terms.target;
            const progress = progressOf({ ...thread, target }, query, { free: unclaimedIn(state) });
            const owed = payOf(terms, target, progress);
            shown = owed.pay > 0 && (coin === owed.pay || coin === owed.said);
        }
        if (!shown && here && given.length) {
            const reward = looseName(`${text(thread.fields?.reward)} ${text(thread.reward?.text)}`);
            shown = given.some(name => ` ${reward} `.includes(` ${name} `));
        }
        // A delivery goal the story said was met in this reply, where it can be turned in (the giver here or a
        // settlement: quest.finish's place rule above), with the thing delivered in sight: handing it over is
        // the turn-in (beta live test 5: the pelt on Elula's counter, no turn-in line).
        if (!shown && turn.reply === sid && turn.met.includes(thread.id)) shown = delivered(state, thread, given);
        if (shown) out.push(thread.id);
    }
    return out;
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
        if (/inventory is not available/.test(progress.reason)) return 'the inventory is not available';
        return `only ${progress.have} of ${progress.need} ${nounFor(target, progress.need)} ${progress.have === 1 ? 'is' : 'are'} ${target.kind === 'items' ? 'held' : 'beaten'}`;
    }
    if (!progress.met) return 'its goal is not met yet';
    if (finish.word && finish.limit > 1) return `one reply turns in at most ${finish.limit} quests on the story's word alone, so it is ready for the next reply`;
    if (finish.word) return `one reply turns in only one quest on the story's word alone (${finish.other} was turned in), so it is ready for the next reply`;
    if (finish.budget) return lowerFirst(text(finish.reason).replace(/\.$/, ''));
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
 * Where a quest stands, in words for its row (F95): `{ state, text }`, state one of untaken (an older
 * chat's quest nothing took on), ready, here (ready, and it can be turned in here), notyet, over.
 */
function statusOf(thread, target, progress, finish, waiting = false) {
    if (isOver(thread)) return { state: 'over', text: '' };
    if (!thread.taken) return { state: 'untaken', text: 'Not taken on' };
    // The story turned it in; code checks it where the reply ends up (tracker/quest-lines.js). Shown only
    // on a Story Block without afterCapture (MODULES §F121), where that check waits for the next reply.
    if (waiting) return { state: 'ready', text: 'Turned in by the story — checked where this reply ends up, before the next reply' };
    const label = target ? countText(target, progress) : 'goal met';
    if (progress.met) {
        return finish.ok ? { state: 'here', text: `Ready to turn in — ${label}` } : { state: 'ready', text: `Ready — ${label}; ${lowerFirst(text(finish.reason))}` };
    }
    return { state: 'notyet', text: target ? `Not yet: ${label}` : `Not yet: ${lowerFirst(NOT_MET_YET)}` };
}

const HISTORY_SHOWN = 8;

// The receipts that touched a quest (F84): its own commands' (`data.quest`) and its change lines'
// (`data.thread`), oldest first, the last few. Story Block trims old receipts' data (RX-TL-3), so what
// the chronicle's note kept (`chronicle.questLog`) comes first; receipts still whole fill in the rest
// (the latest reply's, not noted yet, and a chat from before the log).
function historyOf(tools, id) {
    let kept = [];
    try {
        const logged = typeof tools?.query === 'function' ? tools.query('chronicle.questLog', { id }) : null;
        kept = Array.isArray(logged) ? logged.filter(item => Number.isSafeInteger(item?.rev) && text(item.text)) : [];
    } catch {
        kept = [];
    }
    let list = [];
    try {
        list = typeof tools?.receipts === 'function' ? tools.receipts() ?? [] : [];
    } catch {
        list = [];
    }
    const seen = new Set(kept.map(item => item.rev));
    const fresh = (Array.isArray(list) ? list : [])
        .map(entry => entry?.receipt ?? entry)
        .filter(receipt => receipt && (receipt.data?.quest === id || receipt.data?.thread === id || (Array.isArray(receipt.data?.settled) && receipt.data.settled.some(item => item?.quest === id))) && text(receipt.summary) && !seen.has(receipt.rev))
        .map(receipt => ({ rev: Number.isSafeInteger(receipt.rev) ? receipt.rev : null, text: cut(text(receipt.summary).replace(/^Director: /, ''), 200) }));
    return [...kept.map(item => ({ rev: item.rev, text: cut(text(item.text), 200) })), ...fresh]
        .sort((a, b) => (a.rev ?? Infinity) - (b.rev ?? Infinity))
        .slice(-HISTORY_SHOWN);
}

/**
 * `quest.details({ id | key })` → everything the Quests screen shows of one quest (F84), or null:
 * `{ id, key, goal, hasGoal, countable, note, giver, due, rank: { id, title, reward } | null,
 *    terms: { target, reward, held, text }, ready, waiting, taken: { rev, at? } | null,
 *    ended: { rev, at?, reason, outcome } | null, status: { state, text }, history: [{ rev, text }] }`.
 * `note` is the rolling progress note (the story's `progress:` or `step:`, F85), at most NOTE_CHARS.
 */
function detailsQuery(state, args = {}, tools = null) {
    const director = state?.domains?.director;
    const thread = findQuest(director, args);
    if (!thread) return null;
    const query = queryOf(state, tools);
    const currency = currencyOf(query);
    const { target, reward, rank, rankBy, levelNote, rewardNote } = termsFor(query, state?.domains?.inventory, thread, currency);
    const counted = countedTarget(target, query);
    const view = { ...thread, target };
    const progress = progressOf(view, query, { free: unclaimedIn(state) });
    const rule = finishRule(view, progress, hereScene(query, state?.domains?.scene));
    const finish = rule.ok ? wordRule(director, thread, counted) ?? rule : rule;
    const total = promised(reward, target);
    const hold = rewardHold(total, rank, rankBy);
    const fields = thread.fields ?? {};
    const owedNow = owedView(query, state?.domains?.inventory, thread, currency);
    return {
        id: thread.id,
        key: text(thread.key),
        goal: text(fields.goal) || text(thread.summary),
        hasGoal: hasGoal(thread),
        countable: Boolean(counted),
        note: cut(text(fields.progress) || text(fields.step), NOTE_CHARS),
        giver: text(fields.giver),
        due: text(fields.due),
        rank: rank && rankBy !== 'difficulty' ? { id: rank.id, title: rank.title, reward: [...rank.reward] } : null,
        terms: {
            target: targetText(target),
            reward: rewardText(reward, target, currency),
            held: hold.held ? heldText(rank, money(total, currency), currency) : '',
            // A reward code does not pay (a coin the chat does not know) says so beside the story's words.
            text: [termsText(target, reward, currency, rank, { by: rankBy }), rewardNote ? `not paid by code: ${rewardNote}` : ''].filter(Boolean).join('; '),
            level: levelNote,
        },
        ready: !counted && Boolean(thread.ready),
        waiting: replyTurn(director).pending.includes(thread.id),
        owed: owedLine(owedNow, currency),
        taken: thread.taken ? { ...thread.taken } : null,
        ended: thread.ended ? { ...thread.ended } : null,
        status: statusOf(thread, counted, progress, finish, replyTurn(director).pending.includes(thread.id)),
        history: historyOf(tools, thread.id),
    };
}

// ---- rewards owed -------------------------------------------------------------------------------------
//
// A quest closed with a reward in a coin word the chat cannot count yet ("30 copper bits" where the money is
// pennies) keeps `thread.owed = { text, rev, units, credit?, total?, paid? }`, keyed by the quest like the rest
// of the thread: the story's own words; `credit` the story's own coin that counted toward it; `total` what it
// came to in the chat's money when the first of it was paid; `paid` what each paying step gave, under the rev
// of its receipt (add-only: a deleted step takes its own key back, and a step whose predecessor was deleted
// no longer applies, so a replay never pays what the first payment did not). Nothing is guessed: it is paid
// only when Story Block's coins (the Coins setting, a pack's) count the word, by the same reading a reward
// is priced with (parseReward), held to the quest's rank and to the story-money budget of the reply it is
// paid in (`quest.payOwed`, a system step right after each reply's last story line, kept on that reply; what
// does not fit stays owed for the next one).

const OWED_CHARS = 120;     // the story's reward words kept
const OWED_STEPS = 3;       // owed rewards paid before one reply
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sumOf = record => Object.values(isRecord(record) ? record : {}).reduce((sum, value) => sum + (isAmount(value) ? value : 0), 0);

/**
 * One owed reward as it stands (null when the quest owes none): `{ id, key, giver, text, word, phrase, countable,
 * total, credit, paid, left, open, storyMoney, budget }`. `countable`: the chat's coins count the words now (so
 * `total` and `left` are numbers); `open`: not all of it is settled. `phrase` is the coin as the story wrote it
 * ("copper bits"), '' once the chat counts it.
 */
function owedView(query, inventory, thread, currency) {
    const owed = thread?.owed;
    if (!isRecord(owed) || !text(owed.text)) return null;
    const read = parseReward({ reward: owed.text }, '', { currency });
    const reward = settleReward(read, thread.target ?? null);
    const word = unknownCoin(owed.text, currency);
    const credit = isAmount(owed.credit) ? owed.credit : 0;
    const paid = sumOf(owed.paid);
    const view = { id: thread.id, key: text(thread.key), giver: text(thread.fields?.giver), text: text(owed.text), word, phrase: word ? coinPhrase(owed.text, word) : '', countable: false, total: null, credit, paid, left: null, open: true, storyMoney: true, budget: 0 };
    if (word || !reward || !Number.isSafeInteger(reward.amount) || read.problem) return view;
    const terms = termsFor(query, inventory, { ...thread, reward }, currency);
    const full = payOf(terms, terms.target, { have: isAmount(owed.units) ? owed.units : 0 });
    const total = isAmount(owed.total) ? owed.total : full.pay;
    const left = Math.max(0, total - credit - paid);
    // Settled once a step has counted it (the first payment sets `total`) and nothing is left.
    return { ...view, countable: true, total, left, open: !(isAmount(owed.total) && left <= 0), storyMoney: full.storyMoney, budget: terms.budget };
}

// What the step may still give of the story's money in the reply it is kept on: Story Block's tally for that reply
// (the head carrier: its own `+ coin` lines and the quests it paid), else the reply budget whole.
function stepBudget(query, budget) {
    const host = tryQuery(query, 'inventory.storyBudget', {}, null);
    return isAmount(host?.budget) && isAmount(host?.paid) ? Math.max(0, host.budget - Math.min(host.paid, host.budget)) : budget;
}

/** Every reward owed, oldest closing first (`quest.owed`): the views of owedView with `payable`, `ask` and `hint`. */
function owedList(state, tools) {
    const director = state?.domains?.director;
    const query = queryOf(state, tools);
    const currency = currencyOf(query);
    const out = [];
    for (const thread of Object.values(director?.threads ?? {})) {
        if (thread?.kind !== 'quest' || !isRecord(thread.owed)) continue;
        const view = owedView(query, state?.domains?.inventory, thread, currency);
        if (!view?.open) continue;
        const room = view.countable ? (view.storyMoney ? Math.min(view.left, stepBudget(query, view.budget)) : view.left) : 0;
        out.push({
            ...view, payable: room, rev: thread.owed.rev ?? 0,
            // Asked for when it can be paid now, or counted as settled by the story's coin.
            ask: view.countable && (view.left <= 0 || room > 0),
            hint: view.countable ? '' : `add ${view.phrase || view.text} in Settings → Coins`,
        });
    }
    return out.sort((a, b) => a.rev - b.rev || (a.id < b.id ? -1 : 1));
}

/**
 * `quest.payOwed({ id })` (system steps only: code pays, never a click or a line): pays an owed reward the
 * chat can count now, once, right after the last story line of the reply it is kept on; what that reply's
 * story-money budget does not allow stays owed for the next one. `{ id, credit: true }` (the reply's afterCapture): the story's own coin
 * this reply, written for a reward owed, counts toward it (one reply's coin credits one reward, claim
 * `storycoin:<sid>`) so the reward and the coin never stack. The receipt is kept on the reply, so a swipe or a
 * delete of it puts the reward back to owed.
 */
function payOwed(ctx, payload = {}) {
    if (ctx.cause !== 'system') fail(ctx, CODES.invalid, 'A reward owed is paid by code, not by a click or a line.');
    const director = ctx.draft('director');
    const thread = findQuest(director, payload);
    if (!thread || !isRecord(thread.owed)) fail(ctx, CODES.notFound, 'That quest owes no reward.');
    const currency = currencyOf(ctx.query);
    let view = owedView(ctx.query, readOr(ctx, 'inventory'), thread, currency);
    if (!view?.open) fail(ctx, CODES.claimed, `${thread.key}'s reward is not owed.`);
    const sid = ctx.reply?.sid;
    if (payload?.credit === true) {
        const coin = view.credit > 0 || !sid ? 0 : storyCoinOf(ctx.query, null, sid);
        if (!(coin > 0) || !ctx.claim(`storycoin:${sid}`)) fail(ctx, CODES.invalid, 'No coin of this reply counts toward that reward.');
        thread.owed.credit = coin;
        return { summary: `${view.giver || whoName(ctx.query)}'s ${view.text} for ${thread.key}: the story's own coin this reply, ${money(coin, currency)}, counts toward it.`, narrate: true, data: { quest: thread.id, key: thread.key, credit: coin }, replan: true };
    }
    if (!view.countable) fail(ctx, CODES.invalid, `${thread.key}'s ${view.text} cannot be counted yet: add ${view.phrase || view.text} in Settings → Coins.`);
    // The story wrote coin for it in the reply this step is kept on, as much as it comes to: that is the reward.
    if (view.credit <= 0 && view.paid <= 0 && view.left > 0) {
        const coin = sid ? storyCoinOf(ctx.query, null, sid) : 0;
        if (coin > 0 && coin === view.total && ctx.claim(`storycoin:${sid}`)) {
            thread.owed.credit = coin;
            view = { ...view, credit: coin, left: 0 };
        }
    }
    const allowed = view.left <= 0 ? 0 : view.storyMoney ? Math.min(view.left, stepBudget(ctx.query, view.budget)) : view.left;
    if (view.left > 0 && allowed <= 0) fail(ctx, CODES.invalid, `${thread.key}'s reward waits: one reply gives no more of the story's money.`);
    let amount = 0;
    if (allowed > 0) {
        const out = call(ctx, 'wallet.receive', { owner: 'party', amount: allowed, note: `${thread.key} reward`, ...(view.storyMoney ? { story: true } : {}) });
        const given = out?.data?.amount ?? out?.receipt?.data?.amount;
        amount = Number.isSafeInteger(given) && given >= 0 && given < allowed ? given : allowed;
    }
    ctx.ifThere('director', `/threads/${thread.id}`);
    const rev = receiptRev(ctx);
    if (!isAmount(thread.owed.total)) thread.owed.total = view.total;
    thread.owed.paid = { ...(isRecord(thread.owed.paid) ? thread.owed.paid : {}), [String(rev)]: amount };
    const left = Math.max(0, view.left - amount);
    if (left <= 0) dropProblems(director, problem => (problem.kind === 'reward-owed' || problem.kind === 'reward-coin') && problem.key === thread.key);
    const who = view.giver || whoName(ctx.query);
    const covered = view.credit > 0 ? ` (the story's own coin, ${money(view.credit, currency)}, counted toward it)` : '';
    const summary = left > 0 ? `${who}'s ${view.text} for ${thread.key}: ${money(amount, currency)} paid now, ${money(left, currency)} still owed (one reply gives no more).`
        : amount > 0 ? `${who}'s ${view.text} for ${thread.key} are paid (${money(amount, currency)})${covered}.`
            : `${who}'s ${view.text} for ${thread.key} were paid by the story's own coin; nothing more is paid.`;
    return { summary, narrate: true, data: { quest: thread.id, key: thread.key, paid: amount, left, total: view.total, credit: view.credit } };
}

/** `afterCapture(view)`: one `quest.payOwed` step for each owed reward the chat can count now (OWED_STEPS at most). */
function payOwedHook(view) {
    const list = tryQuery(view?.query, 'quest.owed', {}, null);
    const commands = (Array.isArray(list) ? list : []).filter(entry => entry?.ask === true).slice(0, OWED_STEPS).map(entry => ({ type: PAY_OWED, payload: { id: entry.id } }));
    return commands.length ? { lines: [], commands } : undefined;
}

/**
 * `quest.owedCredits()` → [thread id]: the owed reward the story's own coin this reply (`tools.reply`) counts
 * toward: closed in this reply with its giver here, owed, not credited yet, and the reply's coin not counted
 * by another step. At most one (one reply's coin credits one reward). The afterCapture step asks `quest.payOwed
 * { id, credit: true }` for it.
 */
function owedCredits(state, _args = {}, tools = null) {
    const director = state?.domains?.director;
    const sid = tools?.reply?.sid;
    if (!director || typeof sid !== 'string' || !sid || replyTurn(director).reply !== sid) return [];
    const query = queryOf(state, tools);
    if (storyCoinOf(query, state?.meta?.claims ?? null, sid) <= 0) return [];
    const scene = hereScene(query, state?.domains?.scene);
    const found = questLists(director).finished.find(thread => isRecord(thread.owed) && !isAmount(thread.owed.credit) && !isAmount(thread.owed.total)
        && thread.track?.closed?.turn === director.turn?.n && giverHere(thread, scene));
    return found ? [found.id] : [];
}

/** The quest card's line: "Reward owed: 30 copper bits (add copper bits in Settings → Coins)", or null. */
function owedLine(view, currency) {
    if (!view?.open) return null;
    const note = view.countable
        ? (view.paid > 0 ? `${money(view.left, currency)} of it still owed; paid as one reply allows` : 'paid with the next reply')
        : `add ${view.phrase || view.text} in Settings → Coins`;
    return { text: `Reward owed: ${view.text} (${note})`, countable: view.countable, left: view.left };
}

const TAIL_NAMES = 6;
const READY_SHOWN = 2;      // quests ready to turn in named in the tail, with their giver and where
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
 * Tail lines: quests with no goal yet (F82), up to three quests code cannot count with their goal (F83),
 * quests ready to turn in (and, optional, met but elsewhere).
 */
export function questTail(view) {
    const state = view?.state;
    const director = state?.domains?.director;
    const lines = [];
    const optional = [];
    if (!director) return { lines, optional };
    const query = typeof view.query === 'function' ? view.query : stateQuery(state);
    const { active } = questLists(director);
    const goalless = active.filter(thread => !hasGoal(thread));
    if (goalless.length) lines.push(`Quests with no goal yet (give each a concrete goal: ~ quest Name | goal: …): ${listText(goalless.map(thread => thread.key))}.`);
    const ready = [];
    const judged = [];
    for (const thread of active) {
        if (!thread.taken) continue;
        const target = countedTarget(thread.target, query);
        if (!target && !thread.ready) {
            if (hasGoal(thread)) judged.push(thread);
            continue;
        }
        const progress = progressOf(thread, query, { free: unclaimedIn(state) });
        if (!progress.met) continue;
        ready.push(thread);
    }
    for (const thread of judged.sort(byRecent).slice(0, JUDGED_SHOWN)) {
        lines.push(`Quest goal the story judges: ${thread.key} — ${cut(text(thread.fields?.goal), GOAL_CHARS)}.`);
    }
    // While a quest's goal is met: one short line, at most READY_SHOWN quests (the latest), each with its
    // giver and where it can be turned in ("here" when the place rule holds now).
    if (ready.length) {
        const scene = hereScene(query, state.domains.scene);
        const named = ready.sort(byRecent).slice(0, READY_SHOWN).map(thread => {
            const giver = cut(text(thread.fields?.giver), 40);
            const where = placeRule(thread, scene).ok ? 'here' : giver ? `at a settlement or where ${giver} is` : 'at a settlement';
            return `${thread.key} (${giver ? `to ${giver}, ` : ''}${where})`;
        });
        lines.push(`Ready to turn in: ${named.join('; ')}.`);
    }
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

/** Quest ranks follow the reader's ladder unless the reader turned it off (tools.settings: this part's). */
function followsLadder(tools) {
    let own = null;
    try { own = typeof tools?.settings === 'function' ? tools.settings() : null; } catch { own = null; }
    return own?.followLadder !== false;
}

export const part = {
    domains: {},
    commands: {
        'quest.take': take,
        'quest.abandon': abandon,
        'quest.finish': finish,
        [PAY_OWED]: payOwed,
    },
    queries: {
        'quest.progress': progressQuery,
        'quest.autoTurnIns': autoTurnIns,
        'quest.repeatedCoin': repeatedCoin,
        'quest.owed': (state, _args, tools) => owedList(state, tools),
        'quest.owedCredits': owedCredits,
        'quest.details': detailsQuery,
        'quest.ranks': (state, _args, tools) => ranksOf(queryOf(state, tools)),
        // Whether quest ranks follow the reader's rank ladder (Quests: Quest ranks follow the rank ladder).
        'quest.followsLadder': (_state, _args, tools) => followsLadder(tools),
    },
    kinds: {},
    context: { static: () => QUEST_STATIC, tail: questTail, budget: 250 },
    // Right after each reply's last story line (Story Block's afterCapture, like the tracker's settle step): the
    // rewards owed that the chat can count now are paid, in that reply (payOwed), and told to the next one.
    hooks: { afterCapture: payOwedHook },
    settings: {
        section: 'Quests',
        defaults: { followLadder: true, wordTurnIns: WORD_LIMIT.default },
        schema: {
            // WAVE rule 11: Story Director stands alone. Its quest ranks without RPG Battle are its own.
            followLadder: {
                type: 'bool', label: 'Quest ranks follow the rank ladder',
                help: 'The world\'s rank ladder and its levels are set in RPG Battle\'s Terms; with RPG Battle, quest ranks use them. Without RPG Battle a ladder has no levels to band, so quests keep Story Director\'s own ranks: the pack\'s, else F to S. Off: always Story Director\'s own.',
            },
            // B-b3-r2-5: how many quests code cannot count one reply turns in on the story's word alone.
            wordTurnIns: {
                type: 'int', min: WORD_LIMIT.min, max: WORD_LIMIT.max, label: 'Story\'s-word turn-ins per reply',
                help: 'How many quests whose goal code cannot count (the story says it is met) one reply may turn in. The others stay ready for the next reply. Quests code counts (foes beaten, items fetched) are not limited by this.',
            },
        },
    },
    // The Quests board is the screens part's `story-director/quests` screen.
    tabs: [],
};
