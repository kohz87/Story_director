// Story Director checks: standalone actor bonuses, dice, and optional NPC social modifiers. With no actor set up in a
// chat, a check is the player's with no bonuses.

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
        // The check rule is the `? check` grammar line's (capture.js), said once, and not while Story Block's RPG is on without a fight module.
        static: () => '',
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
