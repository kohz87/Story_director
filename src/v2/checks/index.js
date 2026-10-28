// Story Director checks: standalone actor bonuses, dice, and optional NPC social modifiers.

import { commands } from './commands.js';
import { initialChecks, validateChecks } from './domain.js';
import { kind as checkKind } from './capture.js';
import { queries } from './queries.js';
import { TOPIC_NAMES } from './words.js';

export { checkKind };
export const DEFAULTS = Object.freeze({ defaultDc: 15, costMargin: 2, social: true });

export const part = {
    domains: {
        checks: { initial: initialChecks, validate: slice => validateChecks(slice, TOPIC_NAMES) },
    },
    context: {
        static: () => 'Checks: write ? check skill — attempt | dc: hard (optionally who: Name or vs: Name), without a result. Story Director rolls once; narrate the outcome told by the tail. A pre-rolled check already told under [Happened] is not rolled again.',
        tail: () => ({ lines: [], optional: [] }),
        budget: 1,
    },
    commands,
    queries,
    kinds: { check: checkKind },
    settings: {
        section: 'Checks',
        defaults: { ...DEFAULTS },
        schema: {
            defaultDc: { type: 'int', label: 'Difficulty when none is written', min: 1, max: 40 },
            costMargin: { type: 'int', label: 'A miss by this much is a success at a cost', min: 0, max: 5 },
            social: { type: 'bool', label: 'Add how a person feels about you (NPC State Delta)' },
        },
    },
};
