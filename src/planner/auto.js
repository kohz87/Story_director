// Story Director: when the arc planner should plan automatically (pure).

import { isOffer } from '../tracker.js';
import { isNumber } from './shared.js';

// ---------------------------------------------------------------------------------------
// When to plan automatically

export const DEFAULT_STALL_DAYS = 7;
export const DEFAULT_LOW_THREADS = 3;
// (0.9.19) Replies the story must move on after a plan before "running low" may ask for
// another. Without it a discarded or failed plan would be asked for again after the very next
// reply, each time a long model call; five replies is a scene or two, long enough for the
// reader (or the world) to open something of their own first.
export const LOW_THREADS_REPLIES = 5;

/** The current arc's beats: how many are done, how many in all, and the active ones. */
export function arcBeats(tracker, arc) {
    const beats = (tracker?.records ?? []).filter(record => record.kind === 'beat' && arc && record.arc === arc.arc);
    return { done: beats.filter(record => record.status !== 'active').length, total: beats.length, active: beats.filter(record => record.status === 'active') };
}

/**
 * (0.9.19) The threads the world itself still has open: active hooks and clocks, and the
 * current arc's beats still to play. Offers (a hook with a giver, reward or quest type) are
 * left out: they wait for the reader to take them, so a story of only offers is idle. Quests
 * are the reader's, agendas run on regardless, and events, secrets and world records are
 * background, not pressure, so none of those count either.
 */
export function openThreads(tracker, arc) {
    const records = tracker?.records ?? [];
    const pressing = records.filter(record => record.status === 'active' && (record.kind === 'hook' || record.kind === 'clock') && !isOffer(record));
    return pressing.length + arcBeats(tracker, arc).active.length;
}

/**
 * Why Automatic planning should plan now, or null: 'no-arc' (the story has records but no
 * arc), 'arc-end' (every beat of the arc played out), 'stalled' (no active beat due within
 * `stallDays` story days; a beat without a date counts as due) or, since 0.9.19,
 * 'running-low' (fewer than `lowThreads` open threads, see openThreads; 0 turns it off).
 * Running low waits until `repliesSincePlan` (replies since the last plan was made) reaches
 * LOW_THREADS_REPLIES, so one thin stretch asks once, not every reply. Pure: the caller
 * passes the tracker, the current arc (the newest active one), the scene time and the
 * calendar.
 */
export function autoPlanReason({ tracker, arc = null, now = null, calendar = null, stallDays = DEFAULT_STALL_DAYS, lowThreads = DEFAULT_LOW_THREADS, repliesSincePlan = Infinity } = {}) {
    if (!arc) return tracker?.records?.length ? 'no-arc' : null;
    const { total, active } = arcBeats(tracker, arc);
    if (total && !active.length) return 'arc-end';
    if (isNumber(now) && active.length && calendar) {
        const horizon = calendar.addDays(now, Number(stallDays) || DEFAULT_STALL_DAYS);
        const upcoming = active.some(beat => {
            const date = beat.fields?.on ? calendar.parse(beat.fields.on, { reference: now }) : null;
            return !date || date.abs <= horizon;
        });
        if (!upcoming) return 'stalled';
    }
    // (0.9.19) Running low: the arc's last beats may be far off with nothing else open.
    const low = Number(lowThreads);
    const threshold = Number.isFinite(low) && low >= 0 ? low : DEFAULT_LOW_THREADS;
    if (threshold > 0 && Number(repliesSincePlan) >= LOW_THREADS_REPLIES && openThreads(tracker, arc) < threshold) return 'running-low';
    return null;
}
