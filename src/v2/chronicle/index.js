// Story Director v2, part **chronicle** (F89): the `chronicle` domain (world events the story keeps
// moving, and the factions that shape them), the `world` and `faction` change lines, the
// reader's edits, the three open events the next reply is reminded of, and the Chronicle screen.
// The coordinator's src/v2/module.js merges this part with the others into module
// `story-director`.
//
// The day digest (feature `story-director.digest`, on by default; days.js, digest.js): when the story
// clock has passed into a new day, code writes what each finished day held from the receipts (no model
// call), keeps them by day in `chronicle.days`, shows them on the Days screen, and tells the reply after
// a time skip or a While away recap the last day's one line.
//
// The tracker part owns the kind `event` (a dated happening, MODULES §C1), so a world event is a
// `world` line here: one owner per kind, and the tracker's `event` lines keep working as before.
//
// Interface for other parts and modules: the queries `chronicle.events`, `chronicle.event`,
// `chronicle.factions`, `chronicle.faction`, `chronicle.days`, `chronicle.day` (and
// `chronicle.board`, `chronicle.dayBoard`, the screens', and `chronicle.dayFacts`, the digest's); the
// commands `chronicle.edit` and `chronicle.remove` (the reader's, cause `ui`), `chronicle.surface`
// and `chronicle.digest` (the hook's, cause `system`).

import { applyFactionLine, applyWorldLine, edit, remove } from './capture.js';
import { DIGEST, DIGEST_DEFAULTS, DIGEST_FEATURE, FULL_MAX, KEEP_MAX } from './days.js';
import { DIGEST_TAIL_BUDGET, digestCommand, digestCommands, digestTailLine } from './digest.js';
import { daysScreen } from './days-screen.js';
import { initialChronicle, validateChronicle } from './domain.js';
import { GRAMMAR, STATIC_TEXT, TAIL_BUDGET, chronicleTail } from './note.js';
import { SURFACE, beforeGenerate as surfaceHook, surface } from './pick.js';
import { queries } from './queries.js';
import { chronicleScreen } from './screen.js';

/** The chronicle's optional mechanics (MODULES §F100). */
export const features = Object.freeze([
    Object.freeze({
        id: DIGEST_FEATURE,
        label: 'Day digest',
        describe: 'When a story day ends, code writes what it held (places, quests, fights, money, NPC stages, world news) from the receipts, for the Days screen and a one-line reminder after a time skip.',
        default: true,
    }),
]);

// The command owned by the feature: a handler with `feature` (Story Block refuses it while it is off).
const digestHandler = Object.assign((ctx, payload) => digestCommand(ctx, payload), { feature: DIGEST_FEATURE });

/** `beforeGenerate(view)`: the digest when a day ended, then the world events' pick. */
export function beforeGenerate(view) {
    const commands = [...digestCommands(view), ...(surfaceHook(view)?.commands ?? [])];
    return commands.length ? { commands } : undefined;
}

/** `context.tail(view)`: the [World] lines, and the last day's line after a time skip (optional). */
export function tail(view) {
    const out = chronicleTail(view);
    const line = digestTailLine(view);
    return line ? { lines: out.lines, optional: [...out.optional, line] } : out;
}

export const part = {
    features,
    domains: {
        chronicle: { initial: initialChronicle, validate: validateChronicle },
    },
    commands: {
        'chronicle.edit': edit,
        'chronicle.remove': remove,
        [SURFACE]: surface,
        [DIGEST]: digestHandler,
    },
    queries,
    kinds: {
        world: { grammar: GRAMMAR.world, apply: applyWorldLine },
        faction: { grammar: GRAMMAR.faction, apply: applyFactionLine },
    },
    context: {
        static: () => STATIC_TEXT,
        tail: view => tail(view),
        budget: TAIL_BUDGET + DIGEST_TAIL_BUDGET,
    },
    hooks: { beforeGenerate },
    settings: {
        section: 'Chronicle',
        defaults: { ...DIGEST_DEFAULTS },
        // The While away threshold is the time part's: a jump that long is a time skip.
        reads: { recapHours: 'time.recapHours' },
        schema: {
            digestDays: { type: 'int', label: 'Day digest: whole days kept', min: 1, max: FULL_MAX },
            digestKeep: { type: 'int', label: 'Day digest: days kept in all (older ones are dropped)', min: 1, max: KEEP_MAX },
            digestTail: { type: 'bool', label: 'Day digest: remind the story of the last day after a time skip' },
        },
    },
    tabs: [],
    screens: [chronicleScreen, daysScreen],
};
