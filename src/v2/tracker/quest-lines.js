// Story Director v2, tracker part: what a quest line carries besides v1's fields (pure).
//
// * `| progress: …` is the quest's rolling one-line note (F85). v1's `step:` already plays that
//   role (the row's "Now"), so `progress:` is read as `step:`; only the latest is kept, at most
//   NOTE_CHARS long.
// * `| met: yes` / `| met: no` (F83): the story says the goal of a quest code cannot count is met
//   (or undone). It marks the thread `ready: { rev }` (or clears it) and never reaches v1's rules.
// * A `+ quest` with no goal code can read is kept and flagged (F82, Problem "no-goal").
// * A taken quest the story closes as done is turned in by code (F94/F95): `quest.finish` with
//   `by: 'story'` when quest.progress's checks pass, else it stays open with a Problem and a
//   narrated receipt that tells the next reply why.
//   One reply turns in at most one quest on the story's word alone (B-b3-r2-5): the others stay
//   open and ready, with that Problem.
// * The place rule is checked where the reply ends up, not where its turn-in line is read: Story Block
//   reads a reply's lines in order, and the story often writes `- quest … — turned in` before the
//   `~ place` and `+ present` lines that bring the party to the giver. A turn-in refused only by the
//   place waits in the reply's bookkeeping (`turn.now.pending`, thread ids) and is checked again at each
//   later Director line of the same reply (paid as soon as the place rule holds) and, last, right after
//   the reply's last story line (the `quest.settle` step of Story Block's afterCapture hook, MODULES §F121,
//   on the scene after all the reply's lines, in that reply): paid then, or refused with the reason. On an
//   older Story Block, which never calls afterCapture, the same step runs before the next reply is written
//   (beforeGenerate, on the scene after the reply's lines and the reader's actions after it). A turn-in the
//   place rule allows when its line is read is paid at once, as before.
// * A Continue is the same reply: a reply cut off by the length limit often reaches the giver in its
//   Continue. A turn-in the place alone refused at the end of the first part is kept as retriable in the
//   reply's bookkeeping (`turn.now.refused`), and the Continue's afterCapture step pays it once the place
//   rule holds (`quest.settle { id, retry: true }`), taking back the refusal's Problem and the `ready` mark
//   it set; a Continue still away changes nothing (refused once). A later reply never pays it.
//
// The quests part's rules are reached only through its queries and commands (`quest.details`,
// `quest.progress`, `quest.finish`); without that part a line is read as before.

import { addProblem as addDirectorProblem, replyDraft, replyTurn } from './domain.js';

export const NOTE_CHARS = 160;
const YES = /^(?:yes|y|true|met|done|complete|completed|reached|achieved)\b/i;
const NO = /^(?:no|n|false|not(?:\s+(?:yet|met))?|unmet|undone)\b/i;

const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const cut = (value, max) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

function tryQuery(query, name, args) {
    if (typeof query !== 'function') return null;
    try {
        return query(name, args) ?? null;
    } catch {
        return null;
    }
}

const isOpenQuest = thread => thread?.kind === 'quest' && thread.status === 'active' && !thread.ended;

/**
 * A quest line's own labels taken out: `{ line, met, metText }`. `line` is the line v1 reads
 * (`progress:` as `step:` unless a step is given, no `met:`); `met` is true, false, null (not
 * written) or 'unread'.
 */
export function splitQuestLine(line) {
    if (line?.kind !== 'quest' || !line.labels || typeof line.labels !== 'object') return { line, met: null, metText: '' };
    const labels = {};
    let met = null;
    let metText = '';
    for (const [label, value] of Object.entries(line.labels)) {
        const name = String(label).trim().toLowerCase();
        if (name === 'met') {
            metText = text(value);
            met = YES.test(metText) ? true : NO.test(metText) ? false : 'unread';
        } else if (name === 'progress' && !Object.keys(line.labels).some(other => String(other).trim().toLowerCase() === 'step')) {
            labels.step = value;
        } else labels[label] = value;
    }
    return { line: { ...line, labels }, met, metText };
}

/** Whether a line has nothing left for v1's rules once its own labels are out: a bare `~ quest Name`. */
export function onlyOwnLabels(line) {
    return line?.op === '~' && !text(line.text) && !Object.keys(line.labels ?? {}).length;
}

/** The progress note kept short (F85): the thread's `step` at most NOTE_CHARS long. */
export function capNote(thread) {
    const step = thread?.fields?.step;
    if (typeof step === 'string' && step.length > NOTE_CHARS) thread.fields.step = cut(step, NOTE_CHARS);
}

/** Whether a quest has a goal code can read: the quests part's `quest.details`, else a `goal:` or target. */
export function questHasGoal(ctx, thread) {
    const details = tryQuery(ctx?.query, 'quest.details', { id: thread.id });
    if (details && typeof details.hasGoal === 'boolean') return details.hasGoal;
    return Boolean(text(thread.fields?.goal) || text(thread.fields?.target) || thread.target);
}

/** The F82 Problem for a quest with no goal. */
export function noGoalProblem(thread) {
    return {
        kind: 'no-goal', severity: 'warn', key: thread.key, op: '+',
        text: `"${thread.key}" has no goal: it is kept, and the story is asked for one (~ quest ${thread.key} | goal: what counts as done).`,
    };
}

/**
 * `met: yes|no` on a thread (F83): `{ changed, problem }`. Only an open, taken quest code cannot count
 * takes it; anything else changes nothing and says why.
 */
export function applyMet(ctx, thread, met, metText, rev) {
    const key = thread?.key ?? '';
    if (met === 'unread') return { changed: false, problem: { kind: 'met', severity: 'warn', key, op: '~', text: `"met: ${metText}" on "${key}" is not yes or no; it changed nothing.` } };
    if (!isOpenQuest(thread)) return { changed: false, problem: { kind: 'met', severity: 'info', key, op: '~', text: `"${key}" is not an open quest; met: changed nothing.` } };
    if (!thread.taken) return { changed: false, problem: { kind: 'met', severity: 'info', key, op: '~', text: `"${key}" is not taken on yet; met: changed nothing.` } };
    const details = tryQuery(ctx?.query, 'quest.details', { id: thread.id });
    const countable = details ? details.countable === true : Boolean(thread.target);
    if (countable) return { changed: false, problem: { kind: 'met', severity: 'info', key, op: '~', text: `"${key}" is counted by code; met: changed nothing.` } };
    if (met === true && !thread.ready) {
        thread.ready = { rev };
        thread.rev = rev;
        return { changed: true, problem: null };
    }
    if (met === false && thread.ready) {
        delete thread.ready;
        thread.rev = rev;
        return { changed: true, problem: null };
    }
    return { changed: false, problem: null };
}

/**
 * The story closed taken quest `thread` as done (F94): `quest.finish` by the story when its checks
 * pass, else a Problem and a narrated receipt. Null when the quests part does not answer (the line is
 * then read as before).
 */
export function storyTurnIn(ctx, director, thread, { addProblem, raw, defer = true }) {
    const check = tryQuery(ctx?.query, 'quest.progress', { id: thread.id, closing: true });
    if (!check || !check.finish) return null;
    // Refused by the place alone: it waits for the scene the reply ends up in (settleTurnIns).
    if (!check.finish.ok && check.place === true && defer) {
        const now = replyDraft(director);
        if (now) {
            if (!Array.isArray(now.pending)) now.pending = [];
            if (!now.pending.includes(thread.id)) now.pending.push(thread.id);
            return { summary: `Director: ${raw} (checked where the reply ends up)`, narrate: false, data: { thread: thread.id, quest: thread.id, problems: [], waiting: true } };
        }
    }
    if (check.finish.ok) {
        const out = ctx.call('quest.finish', { id: thread.id, by: 'story' }) ?? {};
        const closed = director.threads[thread.id];
        if (closed) closed.track = { ...(closed.track ?? {}), closed: { turn: director.turn.n, time: director.time.minutes ?? null } };
        clearRefusal(director, thread.id);
        return { summary: text(out.summary) || `Director: ${raw}`, narrate: true, data: { thread: thread.id, quest: thread.id, problems: [], turnIn: out.data ?? null } };
    }
    // One reply turns in one quest on the story's word alone (B-b3-r2-5), and pays at most its budget in
    // rewards the story wrote (RX-E-1): another the story closes in the same reply stays open, marked
    // ready (as `met: yes` would) when code cannot count its goal, for a later reply to turn in.
    // `countable` (quest.progress): whether code counts its target; a kill goal with no fights module is the story's word.
    const vouched = check.countable === undefined ? !thread.target : !check.countable;
    const wasReady = Boolean(thread.ready);
    if ((check.finish.word || (check.finish.budget && vouched)) && !thread.ready) {
        const rev = Number.isSafeInteger(ctx?.rev) ? ctx.rev : 0;
        thread.ready = { rev };
        thread.rev = rev;
    }
    const why = text(check.refusal) || text(check.finish.reason).replace(/\.$/, '').replace(/^./, c => c.toLowerCase());
    const message = `The story says ${thread.key} was turned in, but ${why}; it stays open.`;
    const problem = addProblem(director, ctx, { kind: 'turn-in', severity: 'warn', key: thread.key, op: '-', text: message });
    // Refused by the place alone: a Continue of this reply may still bring the party to the giver.
    if (check.place === true) {
        const now = replyDraft(director);
        if (now) {
            const others = replyTurn(director).refused.filter(entry => entry.id !== thread.id);
            now.refused = [...others, { id: thread.id, problem: typeof problem === 'string' ? problem : null, ready: !wasReady && Boolean(thread.ready) }];
        }
    }
    return { summary: message, narrate: true, data: { thread: thread.id, quest: thread.id, problems: ['turn-in'], refused: true } };
}

/**
 * A turn-in this reply refused by the place is paid after all (a Continue reached the giver): the refusal's
 * Problem and the `ready` mark it set go, and it is no longer retriable, so the reply ends as if it had been
 * paid at once (Re-read of the joined reply pays it at once).
 */
function clearRefusal(director, id) {
    const entry = replyTurn(director).refused.find(item => item.id === id);
    if (!entry) return;
    const problems = director.problems;
    if (problems && typeof problems === 'object' && !Array.isArray(problems) && typeof entry.problem === 'string') delete problems[entry.problem];
    if (entry.ready && director.threads?.[id]) delete director.threads[id].ready;
    const now = replyDraft(director);
    if (!now) return;
    const rest = replyTurn(director).refused.filter(item => item.id !== id);
    if (rest.length) now.refused = rest;
    else delete now.refused;
}

// Words in a quest line that say the story turned it in, however it put them (an `~` or `!` line the
// tracker does not read as closing it: "~ quest X — Elula pays you", "! quest X — reward handed over").
// Kept by the tracker as the reply's `intent` (turn.now); the line itself changes only what it says.
export const TURN_IN_WORDS = /\b(?:turn(?:s|ed|ing)?\s+(?:\w+\s+)?in|hand(?:s|ed|ing)?\s+(?:\w+\s+)?(?:in|over)|deliver(?:s|ed|ing|y)?|rewards?|rewarded|pa(?:y|ys|id|ying)|bount(?:y|ies)|collect(?:s|ed|ing)?|claim(?:s|ed|ing)?|complet(?:e|es|ed|ing)|finish(?:es|ed|ing)?|done)\b/i;

/** The words of a line (its text and labels' values), for TURN_IN_WORDS. */
export const lineWords = line => [line?.text, ...Object.values(line?.labels ?? {})].map(value => String(value ?? '')).join(' ');

/** The step that checks the reply's waiting turn-ins before the next reply (the quests' cue). */
export const SETTLE = 'quest.settle';
// The quests part's step that pays a reward owed (quests/index.js); here only to credit the story's coin.
const PAY_OWED = 'quest.payOwed';

const isWaitingQuest = thread => isOpenQuest(thread) && Boolean(thread.taken);

/**
 * The reply's turn-ins that wait for its scene (storyTurnIn), checked on the scene as it stands now:
 * `[result]`, one per quest that was settled. `final: false` (a later Director line of the same reply)
 * pays the ones the place rule now allows and leaves the others waiting; `final: true` (the step before
 * the next reply) pays them or refuses them with the reason. A quest no longer open stops waiting.
 * `only`: one quest id (the step settles one quest per receipt).
 */
export function settleTurnIns(ctx, director, { addProblem, final = false, only = null } = {}) {
    const waiting = replyTurn(director).pending.filter(id => only === null || id === only);
    if (!waiting.length) return [];
    const now = replyDraft(director);
    if (now) now.pending = replyTurn(director).pending.filter(id => !waiting.includes(id));
    const out = [];
    for (const id of waiting) {
        const thread = director.threads?.[id];
        if (!isWaitingQuest(thread)) continue;
        const result = storyTurnIn(ctx, director, thread, { addProblem, raw: `- quest ${thread.key} — turned in`, defer: !final });
        if (result && !result.data?.waiting) out.push(result);
    }
    return out;
}

/**
 * A Director line's result with the turn-ins settled before it (settleTurnIns): their summaries first,
 * told to the next reply, and their data under `settled` (the first one's as `quest` and `turnIn`, for
 * the quest's history and the day's money).
 */
export function withSettled(settled, result) {
    if (!settled.length) return result;
    const first = settled.find(item => item.data?.turnIn) ?? settled[0];
    return {
        ...result,
        summary: [...settled.map(item => text(item.summary)), text(result?.summary)].filter(Boolean).join(' '),
        narrate: true,
        data: {
            ...(result?.data ?? {}),
            ...(result?.data?.quest ? {} : { quest: first.data?.quest ?? null }),
            ...(first.data?.turnIn ? { turnIn: first.data.turnIn } : {}),
            settled: settled.map(item => item.data),
        },
    };
}

/**
 * `quest.settle({ id })`: the step right after the reply's last story line (the tracker's afterCapture),
 * or before the next reply on an older Story Block (its beforeGenerate), checks one turn-in the reply left
 * waiting, on the scene the reply ended up in: paid, or refused with the reason (a narrated receipt either
 * way). Kept on that reply, so a swipe or delete of it takes it back; a Re-read of the reply runs it again
 * on the new lines (afterCapture, or `replan`). Story and system steps only.
 */
export function settleCommand(ctx, payload = {}) {
    if (ctx.cause === 'ui') ctx.fail('REFUSED', 'A turn-in is checked by the story, not by a click.');
    const director = ctx.draft('director');
    const id = text(payload?.id);
    // `repeated`: the story's own coin this reply repeated a reward code paid in it (quest.repeatedCoin): taken
    // back, at most what the party holds, and counted (claim), so it is done once.
    if (payload?.repeated === true) {
        const amount = Number(ctx.query('quest.repeatedCoin', {})?.amount);
        const sid = ctx.reply?.sid;
        if (!Number.isSafeInteger(amount) || amount <= 0 || !sid || !ctx.claim(`storycoin:${sid}`)) ctx.fail('REFUSED', 'No coin of this reply repeats a reward.');
        const held = Number(ctx.query('inventory.wallet', { owner: 'party' })?.coin);
        const back = Math.min(amount, Number.isSafeInteger(held) && held > 0 ? held : 0);
        if (back > 0) ctx.call('wallet.pay', { owner: 'party', amount: back, note: 'the story\'s coin for a reward already paid' });
        return { summary: `Director: the story's own coin this reply repeated a quest reward code had already paid; ${back} of it was taken back, so it is not paid twice.`, narrate: true, data: { repeated: back }, replan: true };
    }
    // `auto`: turned in from where things stand (afterCaptureHook, quest.autoTurnIns): quest.finish as code
    // runs it, never on the story's word alone, so a goal not met is refused. Kept on the reply, `replan`.
    if (payload?.auto === true) {
        const thread = director.threads?.[id];
        if (!id || !isWaitingQuest(thread)) ctx.fail('REFUSED', 'That quest is not open.');
        const out = ctx.call('quest.finish', { id }) ?? {};
        const closed = director.threads[id];
        if (closed) closed.track = { ...(closed.track ?? {}), closed: { turn: director.turn.n, time: director.time.minutes ?? null } };
        clearRefusal(director, id);
        return { summary: text(out.summary) || `Director: ${thread.key} turned in.`, narrate: true, data: { thread: id, quest: id, problems: [], turnIn: out.data ?? null, auto: true }, replan: true };
    }
    // `retry`: a Continue of the reply that refused it by the place (afterCaptureHook): paid now, or refused
    // as it was (nothing kept, no second Problem). Only on that reply.
    if (payload?.retry === true) {
        const sid = ctx.reply?.sid;
        const turn = replyTurn(director);
        if (!id || !sid || turn.reply !== sid || !turn.refused.some(entry => entry.id === id)) ctx.fail('REFUSED', 'No turn-in of this reply waits for another try.');
        const thread = director.threads?.[id];
        if (!isWaitingQuest(thread)) ctx.fail('REFUSED', 'That quest is no longer open.');
        const result = storyTurnIn(ctx, director, thread, { addProblem: addDirectorProblem, raw: `- quest ${thread.key} — turned in`, defer: false });
        if (!result || result.data?.refused) ctx.fail('REFUSED', `${thread.key} still cannot be turned in here.`);
        return { ...result, replan: true };
    }
    if (!id || !replyTurn(director).pending.includes(id)) ctx.fail('REFUSED', 'No turn-in waits for that quest.');
    const [settled] = settleTurnIns(ctx, director, { addProblem: addDirectorProblem, final: true, only: id });
    if (!settled) return { summary: 'Director: a turn-in that waited is no longer open.', narrate: false, data: { quest: id }, replan: true };
    return { ...settled, replan: true };
}

/**
 * `afterCapture(view)`: the reply's waiting turn-ins (settleHook), and the ones the place refused at the end
 * of an earlier part of the same reply (`director.retriable`, the head reply's only) that the place rule now
 * allows: `quest.settle { id, retry: true }`. One still refused asks for nothing (refused once).
 */
export function afterCaptureHook(view) {
    const turn = replyTurn(view?.state?.domains?.director);
    const commands = turn.pending.map(id => ({ type: SETTLE, payload: { id } }));
    const retriable = tryQuery(view?.query, 'director.retriable', {});
    for (const id of Array.isArray(retriable) ? retriable : []) {
        if (turn.pending.includes(id)) continue;
        const check = tryQuery(view?.query, 'quest.progress', { id, closing: true });
        if (check?.finish?.ok === true) commands.push({ type: SETTLE, payload: { id, retry: true } });
    }
    // Turned in from where things stand (quest.autoTurnIns): the goal met, the place allowed, and the reply
    // shows it was turned in though no line was read as a turn-in. One step per quest; paid at most once.
    const asked = new Set(commands.map(command => command.payload.id));
    const auto = tryQuery(view?.query, 'quest.autoTurnIns', {});
    for (const id of Array.isArray(auto) ? auto : []) {
        if (typeof id === 'string' && !asked.has(id)) commands.push({ type: SETTLE, payload: { id, auto: true } });
    }
    // The story's own `+ coin` after a turn-in had paid in this reply: the reward and the coin do not
    // stack, so the repeat is taken back (quest.repeatedCoin). Not asked when a step above will pay: that
    // one counts the coin as its reward instead.
    if (!commands.length && Number(tryQuery(view?.query, 'quest.repeatedCoin', {})?.amount) > 0) commands.push({ type: SETTLE, payload: { repeated: true } });
    // The story's own coin this reply, written for a reward the chat cannot count yet that this reply's turn-in
    // left owed (quest.owedCredits): it counts toward that reward, so the reward is not paid on top of it later.
    const credits = tryQuery(view?.query, 'quest.owedCredits', {});
    for (const id of Array.isArray(credits) ? credits : []) if (typeof id === 'string' && id) commands.push({ type: PAY_OWED, payload: { id, credit: true } });
    return commands.length ? { lines: [], commands } : undefined;
}

/**
 * `beforeGenerate(view)` (and afterCaptureHook): `{ commands: [quest.settle] }`, one per turn-in the reply
 * left waiting. Story Block's afterCapture settles them in that reply; on a Story Block without it, nothing
 * is settled until the step before the next reply, which then finds them still waiting (the fallback). With
 * afterCapture nothing is left waiting for beforeGenerate, so it asks for nothing.
 */
export function settleHook(view) {
    const waiting = replyTurn(view?.state?.domains?.director).pending;
    if (!waiting.length) return undefined;
    return { lines: [], commands: waiting.map(id => ({ type: SETTLE, payload: { id } })) };
}
