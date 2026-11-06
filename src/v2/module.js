// Story Director v2: the module definition (MODULES §A, §C).
//
// Public facade. Part identity, host access, namespaced settings, the per-part ctx/view/tools,
// merge rules and the builder live under ./module/; every export here is the one importers used
// before the split.

import { createModule } from './module/create.js';

export { MODULE_ID, MODULE_NAME, VERSION, STORY_BLOCK_WITH_HEADS, STORY_BLOCK_RANGE, PARTS } from './module/parts.js';
export { namespaced, partSettings } from './module/settings.js';
export { fightRunner } from './module/host.js';
export { createModule };

/** The module, built once. */
export const storyDirectorModule = createModule();
