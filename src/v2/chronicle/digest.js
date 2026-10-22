// Story Director v2, chronicle part: writing the day digests (feature `story-director.digest`), the
// hook that asks for it, and the one tail line after a time skip. Pure apart from the ctx.
//
// Before each reply (`beforeGenerate`), the clock's day is compared with `chronicle.written`: when the
// story has moved into a later day since digests were last written (or one of the days written then is
// gone, because the reply that wrote it was deleted), the hook commits `chronicle.digest` (cause
// `system`). The command walks the stored receipts (`chronicle.dayFacts`, which reads them through the
// query tools), writes a digest for each finished day since the last write (and each one gone missing),
// applies the caps and records where it got to. It is a receipt on the reply where the day turned, like
// the time part's settle: a swipe or a delete of that reply takes it back, and the next reply writes
// the day again from the receipts that are left. Replay applies the receipt's ops; it never runs this.

import { DIGEST, DIGEST_FEATURE, capDays, dayOf, daysOf, digestSettings, makeDigest, orderedDays, writtenOf } from './days.js';
import { calendarFrom } from './queries.js';
import { toSlot } from '../slot.js';

const isInt = value => Number.isSafeInteger(value);

/** Whether the digest feature is on: `ctx.feature` / `view.feature` when the host has them (F100), else on. */
export function digestOn(source) {
    if (typeof source?.feature !== 'function') return true;
    try {
        return source.feature(DIGEST_FEATURE) !== false;
    } catch {
        return true;
    }
}

function ask(query, name, args) {
    if (typeof query !== 'function') return null;
    try {
        return query(name, args) ?? null;
    } catch {
        return null;
    }
}

const minutesFrom = query => {
    const minutes = ask(query, 'director.time', {})?.minutes;
    return isInt(minutes) ? minutes : null;
};

/** The days to write now: those since `written.through` up to yesterday, and those it had that are gone. */
export function daysToWrite(chronicle, today) {
    const written = writtenOf(chronicle);
    const kept = daysOf(chronicle);
    const missing = (written?.days ?? []).filter(day => isInt(day) && day < today && !Object.hasOwn(kept, String(day)));
    return { from: written ? written.through : null, missing };
}

/**
 * Whether the hook should commit `chronicle.digest` on `state` at story day `today`: the day moved
 * since digests were last written, or a day written then is gone. With nothing written yet, when the
 * clock has moved into a later day since the time part last settled it (`settledDay`).
 */
export function needsDigest(chronicle, today, { settledDay = null } = {}) {
    if (!chronicle || !isInt(today)) return false;
    const written = writtenOf(chronicle);
    if (!written) return isInt(settledDay) && settledDay < today;
    if (written.through !== today) return true;
    return daysToWrite(chronicle, today).missing.length > 0;
}

/**
 * `chronicle.digest { at? }` (cause `system`, from the hook): writes the digests of the finished days
 * (see above) and records where it got to. `at`: the chat's length when the hook ran. Refused from a
 * click and while the story time is not set.
 */
export function digestCommand(ctx, payload = {}) {
    if (ctx?.cause === 'ui') return ctx.fail('REFUSED', 'Day digests are written by Story Director itself when a story day ends.');
    if (!digestOn(ctx)) return ctx.fail('REFUSED', 'The day digest is turned off.');
    const at = payload?.at ?? null;
    if (!(at === null || (isInt(at) && at >= 0))) return ctx.fail('INVALID', 'chronicle.digest: "at" must be the chat\'s length (a whole number).');
    const query = typeof ctx.query === 'function' ? (name, args) => ctx.query(name, args) : null;
    const now = minutesFrom(query);
    if (now === null) return ctx.fail('REFUSED', 'The story time is not set yet, so no day has ended.');
    const today = dayOf(now);
    const settings = digestSettings(ctx.settings);
    const chronicle = ctx.draft('chronicle');
    if (!chronicle.days || typeof chronicle.days !== 'object' || Array.isArray(chronicle.days)) chronicle.days = {};
    const before = writtenOf(chronicle);
    const { from, missing } = daysToWrite(chronicle, today);
    const plan = ask(query, 'chronicle.dayFacts', { before: today }) ?? { days: [], settle: null };
    const wanted = day => day < today && ((from === null || day >= from) || missing.includes(day));
    const calendar = calendarFrom(query);
    const currency = ask(query, 'inventory.currency', {});
    const rev = isInt(ctx.rev) ? ctx.rev : 0;
    const written = [];
    const found = new Set();
    for (const entry of plan.days ?? []) {
        if (!isInt(entry?.day) || !wanted(entry.day)) continue;
        found.add(entry.day);
        let date = '';
        try { date = calendar.format(entry.day * 1440, { time: false }); } catch { date = ''; }
        chronicle.days[String(entry.day)] = toSlot(makeDigest(entry.day, entry.facts, { date, currency, made: rev, revs: entry.revs }));
        written.push(date || `day ${entry.day}`);
    }
    // A day to write that no receipt is left for (the only reply of that day was deleted): it goes.
    for (const key of Object.keys(chronicle.days)) {
        const day = Number(key);
        if (wanted(day) && !found.has(day)) delete chronicle.days[key];
    }
    for (const [key, change] of Object.entries(capDays(daysOf(chronicle), settings))) {
        if (change === null) delete chronicle.days[key];
        else chronicle.days[key] = toSlot(change);
    }
    // A time skip: this run follows the day turning (not a rewrite after a delete), and the clock's last
    // jump, as the time part settled it just now, was at least the While away threshold.
    const turned = !before || today > before.through;
    const settle = plan.settle;
    const skip = Boolean(turned && settle && settle.to === now && isInt(settle.from) && now - settle.from >= settings.skipMinutes);
    chronicle.written = toSlot({ through: today, days: orderedDays(chronicle).map(digest => digest.day), at, skip });
    return {
        summary: written.length ? `Day digest written: ${written.join(', ')}.` : '',
        narrate: false,
        data: { days: [...found].sort((a, b) => a - b), through: today, skip },
    };
}

/** The hook's part: `[{ type: chronicle.digest, payload: { at } }]` when digests are due, else []. */
export function digestCommands(view) {
    const chronicle = view?.state?.domains?.chronicle;
    if (!chronicle || !digestOn(view)) return [];
    const minutes = view.state.domains.director?.time?.minutes;
    if (!isInt(minutes)) return [];
    const settled = ask(typeof view.query === 'function' ? (name, args) => view.query(name, args) : null, 'time.overdue', {});
    const settledDay = isInt(settled?.minutes) ? dayOf(settled.minutes) : null;
    if (!needsDigest(chronicle, dayOf(minutes), { settledDay })) return [];
    const at = isInt(view?.chat?.length) ? view.chat.length : null;
    return [{ type: DIGEST, payload: { at } }];
}

// ---- the tail line ----------------------------------------------------------------------------

export const YESTERDAY_TAG = '[Yesterday]';
export const LAST_DAY_TAG = '[Last day]';
/** About 60 tokens: the line is optional, and Story Block drops it before anything else. */
export const DIGEST_TAIL_BUDGET = 60;

// The time part's While away recap is for this reply (its own staleness rule, time/settle.js).
function recapLive(view) {
    const recap = ask(typeof view.query === 'function' ? (name, args) => view.query(name, args) : null, 'time.recap', {});
    if (!recap || !Array.isArray(recap.lines) || !recap.lines.length) return false;
    const at = isInt(view?.chat?.length) ? view.chat.length : null;
    if (isInt(at) && isInt(recap.at)) return at < recap.at + 2;
    const rev = view?.state?.meta?.rev;
    return !(isInt(rev) && isInt(recap.rev) && rev > recap.rev);
}

/**
 * The tail's optional line: the last day's one line (`[Yesterday] …`, or `[Last day] …` when it was
 * longer ago), for the reply right after a time skip or a While away recap. '' otherwise.
 */
export function digestTailLine(view) {
    const chronicle = view?.state?.domains?.chronicle;
    if (!chronicle || !digestOn(view)) return '';
    if (!digestSettings(view.settings).tail) return '';
    const minutes = view.state.domains.director?.time?.minutes;
    if (!isInt(minutes)) return '';
    const written = writtenOf(chronicle);
    const at = isInt(view?.chat?.length) ? view.chat.length : null;
    // This reply (or a swipe of it) is the one the digests were written for.
    const fresh = written && isInt(written.at) && isInt(at) && at >= written.at && at < written.at + 2;
    if (!(fresh && written.skip) && !recapLive(view)) return '';
    const today = dayOf(minutes);
    const last = orderedDays(chronicle).filter(digest => digest.day < today).at(-1);
    if (!last?.line) return '';
    return `${last.day === today - 1 ? YESTERDAY_TAG : LAST_DAY_TAG} ${last.line}`;
}
