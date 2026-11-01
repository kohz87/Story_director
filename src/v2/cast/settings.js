// Story Director v2, part **cast**: the feature, its settings and the switch every hook and query reads (pure).

import { DEFAULT_FACES, FACES, FEATURE } from './domain.js';

export { FEATURE };
/** The most tokens the narrator's cue for a meeting may take (the module's tail budget gains this). */
export const TAIL_BUDGET = 220;
/** How long a reply waits for the planner's answer, and the limit the model call is given (milliseconds). */
export const HOLD_MS = 15000;
export const CALL_MS = 45000;
export const HOOK_MS = HOLD_MS + 5000;

export const DEFAULTS = Object.freeze({ on: true, faces: DEFAULT_FACES, unmetDie: false, profile: '' });

const field = spec => Object.freeze({ ...spec, feature: FEATURE, group: 'The cast' });

export const SCHEMA = Object.freeze({
    on: field({ type: 'bool', label: 'The pack\'s cast lives off-screen', help: 'People a pack lists move on while you are elsewhere, and you meet them by place and routine, or when their goal leads them to you. Off: nobody moves or arrives; what is kept stays.' }),
    faces: field({
        // Compact pills (Story Block's segmented choice); a host without it draws the same choice as a dropdown.
        type: 'choice', form: 'segmented', label: 'New faces at most',
        options: Object.entries(FACES).map(([value, face]) => ({ value, label: face.label })),
        help: 'You meet someone the first time you are at their place while they are there, or when their goal leads them to you. This keeps it to a few at a time; the rest wait. Never during a fight.',
    }),
    unmetDie: field({ type: 'bool', label: 'Unmet cast can die off-screen', help: 'Off: before you meet them they can be hurt, lose things or move, but not die. A pack entry can still mark someone as able to die.' }),
    profile: field({ type: 'profile', label: 'Planner connection', help: 'The model that moves the cast when a day passes. They move only when the day changes or time skips: one short planner line each, only where something changed. Same as chat uses the chat\'s own connection.' }),
});

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The cast settings out of the part's values. */
export function castSettings(values) {
    const given = isRecord(values) ? values : {};
    return {
        on: given.on !== false,
        faces: Object.hasOwn(FACES, given.faces) ? given.faces : DEFAULT_FACES,
        unmetDie: given.unmetDie === true,
        profile: typeof given.profile === 'string' ? given.profile.slice(0, 100).trim() : '',
    };
}

/** Settings of a view or ctx (a function or an object), read as the cast uses them. */
export function settingsOf(source) {
    let value = source;
    if (typeof source === 'function') {
        try { value = source(); } catch { value = null; }
    }
    return castSettings(value);
}

/** Whether the feature is on (`source.feature` when the host has it), else on. */
export function featureOn(source) {
    if (typeof source?.feature !== 'function') return true;
    try {
        return source.feature(FEATURE) !== false;
    } catch {
        return true;
    }
}

/** Whether the cast works now: the feature is on and the reader has not switched it off in its settings. */
export const castOn = source => featureOn(source) && settingsOf(source?.settings).on;
