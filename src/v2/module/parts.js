// Story Director v2: the module's identity and its parts in fixed order.

import { part as tracker } from '../tracker/index.js';
import { part as time } from '../time/index.js';
import { part as atlas } from '../atlas/index.js';
import { part as chronicle } from '../chronicle/index.js';
import { part as world } from '../world/index.js';
import { part as keypeople } from '../keypeople/index.js';
import { part as cast } from '../cast/index.js';
import { part as names } from '../names/index.js';
import { part as pulse } from '../pulse/effects.js';
import { part as arc } from '../arc/index.js';
import { part as checks } from '../checks/index.js';
import { part as ripples } from '../ripples/index.js';
import { part as screens } from '../screens/index.js';

export const MODULE_ID = 'story-director';
export const MODULE_NAME = 'Story Director';
export const VERSION = '2.16.0';

/** The Story Block versions this module runs on (`requires.storyBlock`). */
// 2.19.0 reads a kind spec's `heads` (stray change lines of a kind with no grammar line of its own); 2.25.0 is the least this release runs on.
export const STORY_BLOCK_WITH_HEADS = '2.25.0';
export const STORY_BLOCK_RANGE = `>=${STORY_BLOCK_WITH_HEADS}`;

/** The parts in their fixed order: [id, part]. The order is the static prompt's and the tail's order. */
export const PARTS = Object.freeze([['tracker', tracker], ['time', time], ['atlas', atlas], ['chronicle', chronicle], ['world', world], ['keypeople', keypeople], ['cast', cast], ['names', names], ['pulse', pulse], ['arc', arc], ['checks', checks], ['ripples', ripples], ['screens', screens]]);
