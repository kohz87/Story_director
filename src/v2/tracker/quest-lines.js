// Story Director v2, tracker part: what a quest line carries besides v1's fields (pure).
//
// * `| progress: …` is the quest's rolling one-line note (F85). v1's `step:` already plays that
//   role (the row's "Now"), so `progress:` is read as `step:`; only the latest is kept, at most
//   NOTE_CHARS long.
// * `| met: yes` / `| met: no` (F83): the story says the goal of a quest code cannot count is met
//   (or undone). It marks the thread `ready: { rev }` (or clears it) and never reaches v1's rules.
// * A `+ quest` with no goal code can read is kept and flagged (F82, Problem "no-goal").
// * An offer within `offerCooldown` replies of the one before is held (F88): kept, not shown until
//   `shown.turn`. Nothing the story wrote is lost, and no Problem is raised.
// * A taken quest the story closes as done is turned in by code (F94/F95): `quest.finish` with
//   `by: 'story'` when quest.progress's checks pass, else it stays open with a Problem and a
//   narrated receipt that tells the next reply why.
//   One reply turns in at most one quest on the story's word alone (B-b3-r2-5): the others stay
//   open and ready, with that Problem.
//
// The quests part's rules are reached only through its queries and commands (`quest.details`,
// `quest.progress`, `quest.finish`); without that part a line is read as before.

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
 * Marks an offer with the reply it is shown from (F88): now, or, within `cooldown` replies of the
 * last offer, `cooldown` replies after it (held). Done once per offer. True when it is held.
 */
export function markOffer(director, thread, cooldown) {
    if (!thread || thread.kind !== 'quest' || !thread.offer || thread.taken || thread.shown) return false;
    const now = Number.isSafeInteger(director.turn?.n) ? director.turn.n : 0;
    let last = null;
    for (const other of Object.values(director.threads ?? {})) {
        if (other === thread || other?.kind !== 'quest' || !Number.isSafeInteger(other.shown?.turn)) continue;
        if (last === null || other.shown.turn > last) last = other.shown.turn;
    }
    const gap = Number.isSafeInteger(cooldown) && cooldown > 0 ? cooldown : 0;
    const turn = gap && last !== null && now - last < gap ? last + gap : now;
    thread.shown = { turn };
    return turn > now;
}

/**
 * The story closed taken quest `thread` as done (F94): `quest.finish` by the story when its checks
 * pass, else a Problem and a narrated receipt. Null when the quests part does not answer (the line is
 * then read as before).
 */
export function storyTurnIn(ctx, director, thread, { addProblem, raw }) {
    const check = tryQuery(ctx?.query, 'quest.progress', { id: thread.id, closing: true });
    if (!check || !check.finish) return null;
    if (check.finish.ok) {
        const out = ctx.call('quest.finish', { id: thread.id, by: 'story' }) ?? {};
        const closed = director.threads[thread.id];
        if (closed) closed.track = { ...(closed.track ?? {}), closed: { turn: director.turn.n, time: director.time.minutes ?? null } };
        return { summary: text(out.summary) || `Director: ${raw}`, narrate: true, data: { thread: thread.id, quest: thread.id, problems: [], turnIn: out.data ?? null } };
    }
    // One reply turns in one quest on the story's word alone (B-b3-r2-5), and pays at most its budget in
    // rewards the story wrote (RX-E-1): another the story closes in the same reply stays open, marked
    // ready (as `met: yes` would) when code cannot count its goal, for a later reply to turn in.
    if ((check.finish.word || (check.finish.budget && !thread.target)) && !thread.ready) {
        const rev = Number.isSafeInteger(ctx?.rev) ? ctx.rev : 0;
        thread.ready = { rev };
        thread.rev = rev;
    }
    const why = text(check.refusal) || text(check.finish.reason).replace(/\.$/, '').replace(/^./, c => c.toLowerCase());
    const message = `The story says ${thread.key} was turned in, but ${why}; it stays open.`;
    addProblem(director, ctx, { kind: 'turn-in', severity: 'warn', key: thread.key, op: '-', text: message });
    return { summary: message, narrate: true, data: { thread: thread.id, quest: thread.id, problems: ['turn-in'], refused: true } };
}
