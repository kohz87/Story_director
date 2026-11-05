// Story Director v2, part **cast** (USER, 1 Nov): the living cast. A pack lists a hand-written cast; each person starts somewhere with
// a goal and a routine and lives off-screen. The party meets them by place and routine, or because their goal pulls them to the party.
// No dice, no backdrops; nameless people stay as generative as today.
//
// * Feature `story-director.cast` ("The cast", on by default, no preset turns it off: Lean keeps it). Off means fully off: no step,
//   hook, query or screen, nothing in the prompt; what is stored stays.
// * State: the `cast` domain (domain.js): who is in the world, where they are and what they do, who has been met and why, and the
//   notes that tell a reply's card what happened. The pack entries themselves are read from the packs (Story Block's query
//   `packs.content({ kind: 'cast' })`), never copied; an unmet person is hidden from every screen and from the narrator.
// * Steps (capture.js, all cause `system`, before a reply, hooks.js): `cast.sync` (the packs' cast joined, changed or left), `cast.advance`
//   (the planner's batch after a day change or a time skip), `cast.meet` (paths cross for the first time, also when the reader sought a kind of
//   person) and `cast.rumor` (the reader sought a kind of person who is elsewhere: the narrator hears of them with no name). One step after the reply:
//   `cast.withdraw` (the reply did not show the person the meeting brought in, so the meeting is taken back).
// * Narrator: the one cue for a meeting, in the reply it happens in (note.js). No static text.
// * Interface for other modules: the query `director.cast` (queries.js): the met people with their pack entries, for NPC State Delta.
// * Reader: the reply's card (the status card's notes), World -> Now -> Around here, Settings -> Modules -> Story Director -> The cast.
// Works without NPC State Delta, and without a model (nobody moves, meetings by place still happen).

import { advance, meet, rumor, sync, withdraw } from './capture.js';
import { FEATURE, initialCast, validateCast } from './domain.js';
import { createCastHooks } from './hooks.js';
import { createPlans } from './plan.js';
import { queries } from './queries.js';
import { DEFAULTS, HOOK_MS, SCHEMA, TAIL_BUDGET } from './settings.js';

export { FEATURE };

const tagged = fn => Object.assign(fn, { feature: FEATURE });

/** The planner's answers in flight (in memory); shared by the module's hooks. */
export const castPlans = createPlans();

const hooks = createCastHooks({ plans: castPlans });

export const part = {
    // No `presets`: Lean keeps it (the reader's own switch is the only one).
    features: [{
        id: FEATURE,
        label: 'The cast',
        describe: 'A pack\'s hand-written cast lives off-screen: they move on when the day changes or time skips, and you meet them by place and routine, or when their goal leads them to you. Unmet cast is hidden from you and from the narrator\'s text.',
        default: true,
    }],
    domains: { cast: { initial: initialCast, validate: validateCast } },
    commands: {
        'cast.sync': tagged((ctx, payload) => sync(ctx, payload)),
        'cast.advance': tagged((ctx, payload) => advance(ctx, payload)),
        'cast.meet': tagged((ctx, payload) => meet(ctx, payload)),
        'cast.rumor': tagged((ctx, payload) => rumor(ctx, payload)),
        'cast.withdraw': tagged((ctx, payload) => withdraw(ctx, payload)),
    },
    queries,
    kinds: {},
    // The cue and the rumor are pinned cues from `beforeGenerate` (hooks.js), so Story Block's budgets never drop them; the tail is empty (never twice).
    context: { static: () => '', tail: () => ({ lines: [], optional: [] }), budget: TAIL_BUDGET },
    hooks: {
        // The planner's answer is waited for a little (HOOK_MS), so the turn's own limit is given the same.
        beforeGenerate: Object.assign(tagged((view, info) => hooks.beforeGenerate(view, info)), { timeoutMs: HOOK_MS }),
        afterReceive: tagged(view => { hooks.afterReceive(view); }),
        // After the reply's lines: a planned meeting counts only if the reply shows the person (hooks.js).
        // (`always`: it runs for a reply with no change lines too, which Story Block's afterCapture otherwise skips.)
        afterCapture: Object.assign(tagged((view, info) => hooks.afterCapture(view, info)), { always: true }),
    },
    settings: { section: 'The cast', defaults: { ...DEFAULTS }, schema: { ...SCHEMA } },
    tabs: [],
};
