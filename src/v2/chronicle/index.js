// Story Director v2, part **chronicle** (F89): the `chronicle` domain (world events the story keeps
// moving, and the factions that shape them), the `world` and `faction` change lines, the
// reader's edits, the three open events the next reply is reminded of, and the Chronicle screen.
// The coordinator's src/v2/module.js merges this part with the others into module
// `story-director`.
//
// The tracker part owns the kind `event` (a dated happening, MODULES §C1), so a world event is a
// `world` line here: one owner per kind, and the tracker's `event` lines keep working as before.
//
// Interface for other parts and modules: the queries `chronicle.events`, `chronicle.event`,
// `chronicle.factions`, `chronicle.faction` (and `chronicle.board`, the screen's); the commands
// `chronicle.edit` and `chronicle.remove` (the reader's, cause `ui`) and `chronicle.surface`
// (the hook's, cause `system`).

import { applyFactionLine, applyWorldLine, edit, remove } from './capture.js';
import { initialChronicle, validateChronicle } from './domain.js';
import { GRAMMAR, STATIC_TEXT, TAIL_BUDGET, chronicleTail } from './note.js';
import { SURFACE, beforeGenerate, surface } from './pick.js';
import { queries } from './queries.js';
import { chronicleScreen } from './screen.js';

export const part = {
    domains: {
        chronicle: { initial: initialChronicle, validate: validateChronicle },
    },
    commands: {
        'chronicle.edit': edit,
        'chronicle.remove': remove,
        [SURFACE]: surface,
    },
    queries,
    kinds: {
        world: { grammar: GRAMMAR.world, apply: applyWorldLine },
        faction: { grammar: GRAMMAR.faction, apply: applyFactionLine },
    },
    context: {
        static: () => STATIC_TEXT,
        tail: view => chronicleTail(view),
        budget: TAIL_BUDGET,
    },
    hooks: { beforeGenerate },
    tabs: [],
    screens: [chronicleScreen],
};
