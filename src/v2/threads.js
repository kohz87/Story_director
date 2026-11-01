// Story Director v2: the feature `story-director.threads` ("World-building threads"), in one place for every part
// that has to honour it (MODULES §F100). Pure.
//
// It owns the kinds agenda, event, clock, beat, secret (tracker), world, faction (chronicle) and route, landmark
// (atlas); the Pacing, World lines and Under [World] paragraphs of the fixed prompt; the notes' lines about those
// kinds; the Off-screen, Clocks, Beats and Secrets panels and the World card of the Director screen; the Chronicle
// tab; and the News and Factions of the World screen's Now view. It leaves `~ time`, `+ quest`, `+ hook` and
// `? check` alone. Off is the registry's normal off: nothing of it is taught, sent or drawn, what is stored is
// kept, and the state a reply is replayed to is the same. A pack event's lasting world change
// (`chronicle.lasting`) is code's, not the story's, and keeps working.

export const THREADS_FEATURE = 'story-director.threads';

/** The thread kinds the feature owns (the Director's own: quests and hooks are not). */
export const THREAD_KINDS_OWNED = Object.freeze(['agenda', 'event', 'clock', 'beat', 'secret']);
const OWNED = new Set(THREAD_KINDS_OWNED);

/** Whether `kind` is one the feature owns. */
export const ownedKind = kind => OWNED.has(kind);

/**
 * Whether the reader has the feature on: `source.feature(id)` (a ctx, a view, query tools or an api) when the host has
 * it, else on. Anything that cannot be asked is on, so a host without features behaves as it always did.
 */
export function threadsOn(source) {
    if (typeof source?.feature !== 'function') return true;
    try {
        return source.feature(THREADS_FEATURE) !== false;
    } catch {
        return true;
    }
}

/** A director slice (`{ threads, … }`) with the owned kinds' threads left out; nothing is written back. */
export function withoutOwnedThreads(director) {
    const threads = director?.threads;
    if (!threads || typeof threads !== 'object') return director;
    return { ...director, threads: Object.fromEntries(Object.entries(threads).filter(([, thread]) => !OWNED.has(thread?.kind))) };
}

/** The `feature` tag the owned kinds carry: `{ feature }` on a kind's spec. */
export const THREADS_TAG = Object.freeze({ feature: THREADS_FEATURE });
