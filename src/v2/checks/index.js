// Story Director v2, part **checks**: independent checks (contract §3 P09). Story Director owns the dice outside a fight: an actor of its
// own with standalone bonuses, an optional explicit link to a RPG Battle character, one d20 per check (`checks.roll`), the policy it is
// read from (`checks.policy`) and the probe other modules ask first (`director.contract`). It needs nobody: with Story Block and Story Director
// alone a check rolls with SD's standalone bonuses; a linked RPG Battle adds its `rules.modifier` in their place, and NPC State Delta's
// `npc.socialModifier` adds how a person feels about you. The coordinator's src/v2/module.js merges this part with the others.
//
// Not here (written in docs/dev/checks.md): the check table and the `? check` line's capture, which RPG Battle still owns until the lead
// retires it; this part is the roll those callers ask for.

import { commands } from './commands.js';
import { initialChecks, validateChecks } from './domain.js';
import { queries } from './queries.js';
import { TOPIC_NAMES } from './words.js';

export const DEFAULTS = Object.freeze({ defaultDc: 15, costMargin: 2, rbModifiers: true, social: true });

export const part = {
    domains: {
        checks: { initial: initialChecks, validate: slice => validateChecks(slice, TOPIC_NAMES) },
    },
    commands,
    queries,
    settings: {
        section: 'Checks',
        defaults: { ...DEFAULTS },
        schema: {
            defaultDc: { type: 'int', label: 'Difficulty when none is written', min: 1, max: 40 },
            costMargin: { type: 'int', label: 'A miss by this much is a success at a cost', min: 0, max: 5 },
            rbModifiers: { type: 'bool', label: 'Use a linked RPG Battle character\'s modifiers' },
            social: { type: 'bool', label: 'Add how a person feels about you (NPC State Delta)' },
        },
    },
};
