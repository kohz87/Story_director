// Story Director v2: the live host access and small shared object helpers.

// Story Block's sdk when it is up (SillyTavern): what queries are handed when the host's tools lack it.
export function liveSdk() {
    try {
        return globalThis.StoryBlock?.sdk ?? null;
    } catch {
        return null;
    }
}
export const tryLive = (fn, fallback) => {
    try {
        return fn() ?? fallback;
    } catch {
        return fallback;
    }
};
/**
 * Whether the live Story Block has the game view header's module toggle (its `sdk.modules()` entries carry a `headerControls` list; an older host's do
 * not). False when no host can be asked: the Quiet scene switch then stays on the Director tab (the stand-alone path).
 */
export const hostHasHeaderSlot = () => tryLive(() => liveSdk()?.modules?.().some(entry => Array.isArray(entry?.headerControls)), false) === true;
export const LIVE_HOST = Object.freeze({
    settings: id => tryLive(() => liveSdk()?.settings?.(id), null),
    substitute: text => tryLive(() => liveSdk()?.substitute?.(text), undefined),
    // Whether the reader has a feature on (Story Block's `sdk.feature`); undefined when it cannot be asked, which reads as on.
    feature: id => tryLive(() => liveSdk()?.feature?.(id), undefined),
    // A model call for a part that needs one (the cast's planner): Story Block's `sdk.callModel`, when it has one.
    callModel: request => liveSdk().callModel(request),
    canCallModel: () => typeof liveSdk()?.callModel === 'function',
    // SillyTavern's chat (the messages, for the part that reads the recent story), [] when there is none.
    chat: () => tryLive(() => globalThis.SillyTavern?.getContext?.()?.chat, []),
});

export const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
