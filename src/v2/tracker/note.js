// Story Director v2, tracker part: what the model is told (pure).
//
// static: the Director's change-line rules, the same bytes every reply of every chat (SPEC §5):
// v1's field rules and Pacing, word for word, under v2's `<Changes>` envelope (the host writes
// the block's header and each kind's one-line grammar).
// tail: v1's Director note (note.js) for this reply: the story time and place, what is due and
// arriving, the relevant threads one line per kind, what not to reveal, corrections for the
// last reply's lines, and the quest checks (a quest that reads finished, one the reader's message
// gives up, takes on or turns down). Built by v1's noteParts within this part's budget.

import { CHANGE_INSTRUCTION, PACING, noteParts, tailNote } from '../../note.js';
import { classify, estimateTokens } from '../../relevance.js';
import { givenUpIn, offersChosenIn, untrackedCorrections } from '../../tracker.js';
import { toTracker } from './convert.js';
import { calendarOf, settingsFrom } from './time.js';

export const TAIL_BUDGET = 500;

const V1_LINES = CHANGE_INSTRUCTION.split('\n');
const FIELDS_LINE = V1_LINES.find(line => line.startsWith('Fields:'));
const WRITE_ONLY_LINE = V1_LINES.find(line => line.startsWith('Write only changes'));

/** The Director's part of the static prompt: no names, counts, times or dice. */
export const STATIC_TEXT = [
    'Director lines: ~ changes only what changed; - closes it (— reason); ! fires a due item (— what happened).',
    FIELDS_LINE,
    WRITE_ONLY_LINE,
    PACING,
].join('\n');

/** Each Director kind's one line for the change-line instruction (SPEC §4.4). */
export const GRAMMAR = Object.freeze({
    agenda: '+ agenda Name — what they are up to off-screen | now: where | then: what next | on: <date, clock time>',
    event: '+ event Name — what is happening in the world | then: what next | on: <date, clock time>',
    hook: '+ hook Name — an open thread (a job only offered: | giver: who | reward: what)',
    quest: '+ quest Name — a job {{user}} accepted | giver: | goal: | reward: | step: | due: | difficulty: easy|normal|hard|nightmare; ~ quest Name | step: …; - quest Name — done|failed|abandoned',
    clock: '+ clock Name — what happens when it runs out | due: <date, clock time> | shown: none|sign|warning',
    beat: '+ beat Name — a planned turn of the story | on: <date, clock time> | encounter: the foes, for a fight | reach: what it changes for {{user}}',
    secret: '+ secret Name — what must not be revealed yet',
    time: '~ time <date, clock time> (the scene\'s time) · ! time +2h (time passes)',
});

// v1's quest checks name a record bare ("- Key — outcome"); every v2 line names its kind.
function v2Lines(text) {
    return text.replace(/close it with - Key — /g, 'close it with - quest Key — ');
}

/** `context.tail(view)` → `{ lines, optional }` (SPEC §5). */
export function directorTail(view, { budget = TAIL_BUDGET } = {}) {
    const state = view?.state;
    const director = state?.domains?.director;
    if (!director) return { lines: [], optional: [] };
    const settings = settingsFrom(typeof view.settings === 'function' ? view.settings() : view.settings);
    const calendar = calendarOf(settings);
    const tracker = toTracker(director);
    const now = director.time?.minutes ?? null;
    const message = director.turn?.n ?? 0;
    const said = typeof view?.chat?.lastUser === 'string' ? view.chat.lastUser : '';
    const selection = classify(tracker, {
        calendar,
        now,
        message,
        place: String(state?.domains?.scene?.place?.name ?? ''),
        recentText: said,
        settings: { dormantReplies: settings.dormantReplies, dormantDays: settings.dormantDays, dueSoonDays: settings.dueSoonDays },
    });
    // The last reply's lines on names not tracked, as v1 reads its problems.
    const corrections = untrackedCorrections((director.problems ?? [])
        .filter(problem => problem.turn === message)
        .map(problem => ({ ...problem, message: problem.turn })), { message });
    const parts = noteParts(selection, {
        calendar,
        // v1's budget counts the instruction too; here it is in the static part.
        budgetTokens: budget + estimateTokens(STATIC_TEXT),
        corrections,
        instruction: STATIC_TEXT,
        givenUp: givenUpIn(tracker, said),
        taking: offersChosenIn(tracker, said, 'accept'),
        declining: offersChosenIn(tracker, said, 'refuse'),
    });
    const text = v2Lines(tailNote(parts));
    return { lines: text ? text.split('\n') : [], optional: [] };
}

