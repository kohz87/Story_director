// Story Director: the Director's note after an accepted plan (pure).

/**
 * The Director's note after an arc it shaped is accepted (0.8.7): '' (used once), unless the
 * reader keeps it for every plan, or changed it after the plan was made (then their new note
 * is for the next one). `current` is the note now, `used` the one the plan was made with.
 */
export function noteAfterAccept(current, used, { keep = false } = {}) {
    const now = String(current ?? '');
    if (keep || !String(used ?? '').trim()) return now;
    return now.trim() === String(used).trim() ? '' : now;
}
