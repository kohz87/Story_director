// Story Director v2, part **tracker** (MODULES §C1): the `director` domain, its change-line
// kinds, the story clock (set from a pack's start date when the story has not set it), its queries
// and what the model is told. Its screen is the screens part's `story-director/director`.
// The coordinator's src/v2/module.js merges this part with the others into module
// `story-director`. Quest taking, finishing, targets and progress are part `quests` (§C2):
// this part keeps `taken`, `target` and `reward` as they are, and sets `ended` when a line
// closes a thread. Its quest lines also carry `met:` (a thread's `ready`), `progress:` (the step
// note), the no-goal Problem, held offers (`shown`) and the story's own turn-in (quest-lines.js).

import { applyThreadLine, applyTimeLine } from './capture.js';
import { THREAD_KINDS } from './convert.js';
import { initialDirector, queries, validateDirector } from './domain.js';
import { GRAMMAR, GRAMMAR_ALONE, TAIL_BUDGET, directorTail, grammarOf, staticText } from './note.js';
import { SEED, seedCommand, seedHook } from './seed.js';
import { PRESET_CHOICES, settingsDefaults } from './time.js';

// A kind Story Director alone words otherwise (GRAMMAR_ALONE) gets its grammar from the module set.
const kinds = Object.fromEntries(THREAD_KINDS.map(kind => [kind, {
    grammar: Object.hasOwn(GRAMMAR_ALONE, kind) ? env => grammarOf(kind, env) : GRAMMAR[kind],
    apply: applyThreadLine,
}]));
kinds.time = { grammar: GRAMMAR.time, apply: applyTimeLine };

export const part = {
    domains: {
        director: { initial: initialDirector, validate: validateDirector },
    },
    commands: { [SEED]: seedCommand },
    queries,
    kinds,
    context: {
        static: env => staticText(env),
        tail: view => directorTail(view),
        budget: TAIL_BUDGET,
    },
    hooks: { beforeGenerate: seedHook },
    settings: {
        section: 'Calendar',
        // The quests part's offer cooldown (F88), which this part applies to the offers it reads.
        reads: { offerCooldown: 'quests.offerCooldown' },
        defaults: settingsDefaults(),
        schema: {
            calendar: {
                type: 'group',
                label: 'Calendar',
                fields: {
                    // `pack`: the enabled pack's calendar when one has it, else Gregorian.
                    preset: { type: 'choice', label: 'Calendar', options: [...PRESET_CHOICES] },
                    era: { type: 'text', label: 'Era (written before the year)' },
                    months: { type: 'list', label: 'Months', of: { name: { type: 'text', label: 'Name' }, days: { type: 'int', label: 'Days', min: 1, max: 400 } } },
                    leapYears: { type: 'bool', label: 'Leap years' },
                    week: { type: 'text', label: 'Weekdays (comma separated; empty for none)' },
                },
            },
            dormantReplies: { type: 'int', label: 'Quiet after replies', min: 1, max: 500 },
            dormantDays: { type: 'int', label: 'Quiet after story days', min: 1, max: 3650 },
            dueSoonDays: { type: 'int', label: 'Due soon within days', min: 0, max: 365 },
            // One time line moves the clock forward at most this far; a longer jump is held to it, with a Problem.
            maxJump: { type: 'int', label: 'Longest time jump (story days)', min: 1, max: 3650 },
        },
    },
    tabs: [],
};
