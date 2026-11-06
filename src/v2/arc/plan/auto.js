// Story Director v2, part **arc**: when the Director plans by itself. Pure.

// ---------------------------------------------------------------------------------------------------
// When to plan by itself (v1 autoPlanReason, on v2 threads)

export const DEFAULT_STALL_DAYS = 7;
export const DEFAULT_LOW_THREADS = 3;
/** Replies the story must move on after a plan was asked for before "running low" asks again (v1 0.9.19). */
export const LOW_THREADS_REPLIES = 5;

/** The arc's beats: `{ done, total, active }` (threads tagged with the arc's id). */
export function arcBeats(threads, arcId) {
    const beats = arcId ? threads.filter(thread => thread?.kind === 'beat' && thread.arc === arcId) : [];
    const active = beats.filter(thread => thread.status === 'active');
    return { done: beats.length - active.length, total: beats.length, active };
}

/** Open threads the world itself still has: active hooks and clocks, and the arc's beats still to play. */
export function openThreads(threads, arcId) {
    const pressing = threads.filter(thread => thread?.status === 'active' && (thread.kind === 'hook' || thread.kind === 'clock') && !thread.offer);
    return pressing.length + arcBeats(threads, arcId).active.length;
}

/**
 * Why the Director should plan by itself now, or null (v1): 'no-arc' (the story tracks something and
 * has no arc), 'arc-end' (every beat of the arc played out), 'stalled' (no beat of the arc due within
 * `stallDays` story days; a beat without a date counts as due) or 'running-low' (fewer than
 * `lowThreads` open threads, once `repliesSincePlan` reaches LOW_THREADS_REPLIES; 0 turns it off).
 * `threads`: each with `kind`, `status`, `fields`, `offer` and `arc` (its arc's id). `arc`: the current
 * arc `{ id, active }` or null; an ended arc counts as none.
 */
export function autoPlanReason({ threads = [], arc = null, now = null, calendar = null, stallDays = DEFAULT_STALL_DAYS, lowThreads = DEFAULT_LOW_THREADS, repliesSincePlan = Infinity } = {}) {
    if (!arc || arc.active === false) return threads.length ? 'no-arc' : null;
    const { total, active } = arcBeats(threads, arc.id);
    if (total && !active.length) return 'arc-end';
    if (Number.isInteger(now) && active.length && calendar) {
        const days = Number.isInteger(stallDays) && stallDays > 0 ? stallDays : DEFAULT_STALL_DAYS;
        const horizon = calendar.addDays(now, days);
        const upcoming = active.some(beat => {
            let date = null;
            try { date = beat.fields?.on ? calendar.parse(beat.fields.on, { reference: now }) : null; } catch { date = null; }
            return !date || date.abs <= horizon;
        });
        if (!upcoming) return 'stalled';
    }
    const threshold = Number.isInteger(lowThreads) && lowThreads >= 0 ? lowThreads : DEFAULT_LOW_THREADS;
    if (threshold > 0 && Number(repliesSincePlan) >= LOW_THREADS_REPLIES && openThreads(threads, arc.id) < threshold) return 'running-low';
    return null;
}

/** Why a plan was asked for, in the reader's words. */
export const REASON_TEXT = Object.freeze({
    manual: 'you asked for it',
    'no-arc': 'the story had no arc',
    'arc-end': 'every beat of the last arc played out',
    stalled: 'no beat of the arc was coming up',
    'running-low': 'the story was running low on open threads',
});
