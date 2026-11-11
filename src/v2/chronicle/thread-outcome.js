// P23 closes the journal in the same root as the thread and its owner's settlement.
export function threadOutcome(ctx, payload) {
    if (ctx.caller !== 'story-director') return ctx.fail('REFUSED', 'Thread outcomes come from the thread writer.');
    const chronicle = ctx.draft('chronicle');
    chronicle.questLog ??= {};
    chronicle.questLog[String(ctx.rev)] = { thread: payload.thread, text: payload.text };
    return { summary: payload.text, narrate: false, data: { thread: payload.thread } };
}

/**
 * `chronicle.forget { threads }` (the Director's fold, src/v2/tracker/fold.js): removes the quest log lines of those threads and every
 * line whose thread is no longer in the Director's threads (a note that read a range again may bring such lines back; this sweep heals it).
 */
export function forget(ctx, payload) {
    if (ctx.caller !== 'story-director') return ctx.fail('REFUSED', 'Quest log lines are forgotten by the Director\'s fold.');
    const gone = new Set(Array.isArray(payload?.threads) ? payload.threads : []);
    const chronicle = ctx.draft('chronicle');
    const threads = ctx.read('director')?.threads ?? {};
    let removed = 0;
    for (const [key, line] of Object.entries(chronicle.questLog ?? {})) {
        if (!gone.has(line?.thread) && Object.hasOwn(threads, line?.thread)) continue;
        delete chronicle.questLog[key];
        removed++;
    }
    return { summary: '', narrate: false, data: { removed } };
}
