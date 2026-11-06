// Story Director v2, part **arc**: the planner's prompt, its answer read strictly, the plan written as
// text the reader can edit, and when to plan by itself (pure: no DOM, no model, no globals).
//
// Once per arc a model plays showrunner (v1 src/planner.js): it reads the recent story and what the
// Director tracks and answers with a short plan in fixed lines (ARC, BEAT, AGENDA, HOOK, CLOCK,
// SECRET; with a fight runner a planned fight is a BEAT with `encounter:`, or an ENCOUNTER line).
// The answer is a proposal and nothing more (WAVE rule 1): code reads only those labels and only the
// parts each kind has, cuts every name and text by code points with markup and control characters
// taken out, caps how many of each kind one plan holds, writes relative dates on the chat's calendar
// itself and leaves out a date it cannot read or one already past. Nothing the planner writes sets an
// amount: rewards, ranks, XP and quantities are not parts of any plan line and are dropped.
// The same reader reads the reader's edited text when they accept it, so what is kept is what code
// read, whoever wrote it.

export {
    MAX_ANSWER_CHARS, MAX_LINES, PLAN_CAPS, MAX_ITEMS, MAX_FIGHTS, KEY_POINTS,
    DESC_POINTS, PART_POINTS, PARTS, flat,
} from './plan/shared.js';
export {
    DEFAULT_PLANNER_PROMPT, FIGHT_RULE, NO_FIGHT_RULE, PLANNER_ASK, plannerRequest,
    trackerSummary,
} from './plan/prompt.js';
export { readPlan, itemLine, planText, planCounts, noteMark } from './plan/read.js';
export {
    DEFAULT_STALL_DAYS, DEFAULT_LOW_THREADS, LOW_THREADS_REPLIES, arcBeats, openThreads,
    autoPlanReason, REASON_TEXT,
} from './plan/auto.js';
