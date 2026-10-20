// Story Director: the settings' defaults, one copy (0.9.39).
//
// The runtime (index.js) fills the reader's settings with these, and the settings panel
// (ui/settings.js) fills its copy with the same, so a value never differs between them.

import { PRESETS } from './calendar.js';
import { DEFAULT_MAP } from './places.js';
import { DEFAULT_LOW_THREADS, DEFAULT_STALL_DAYS } from './planner.js';
import { DEFAULTS } from './relevance.js';

export const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    sceneTag: 'World_State',
    // (0.9.38) The note's part for this reply goes at the very end (Story Suite's layout).
    depth: 0,
    budgetTokens: DEFAULTS.budgetTokens,
    dormantReplies: DEFAULTS.dormantReplies,
    dormantDays: DEFAULTS.dormantDays,
    dueSoonDays: DEFAULTS.dueSoonDays,
    mirrorOffscreen: true,
    // The tracker is the story behind the scenes: hidden in the tab until the reader asks.
    spoilerGuard: true,
    // (0.9.34) Take on asks first while the offer is not "here".
    giverPresent: true,
    calendar: PRESETS.gregorian,
    arc: Object.freeze({ trigger: 'manual', model: Object.freeze({ source: 'chat' }), recent: 60, maxTokens: 1500, stallDays: DEFAULT_STALL_DAYS, lowThreads: DEFAULT_LOW_THREADS, autoAccept: false, genre: '', note: '', keepNote: false, prompt: '' }),
    capture: Object.freeze({ mode: 'off', model: Object.freeze({ source: 'chat' }), maxTokens: 800 }),
    // How to read map coordinates: which way north and east run, km per unit, road winding.
    map: DEFAULT_MAP,
    // Per Story Suite area: 'auto' (the suite's order), 'mine' or 'theirs'.
    sourceOfTruth: Object.freeze({ calendar: 'auto', timeline: 'auto', npc: 'auto' }),
});
