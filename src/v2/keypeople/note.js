// Story Director v2, part **keypeople**: what the narrator is told (pure).
//
// static (the feature's, the same bytes every reply): what the `away` and `key` lines are for.
// tail: `[Key people] Away from the scene:` and one line per away key person, within the Key people token budget (a
// setting, 300 by default, no upper limit; the host's overall tail budget still caps everything):
//   `Ren: away, scouting the north road, back Goldwane 18; latest: reached Wolfmere Outpost.`
// Ordered by the soonest return (no date last), then the latest step; over budget, the rest are left out of that reply
// (they are still tracked). A back date that has passed moves nobody: the line says "due back" and the narrator brings them.

import { estimateTokens } from '../../relevance.js';
import { DEFAULT_TOKENS, FEATURE, awayOf, cutPoints, isInt, isRecord, tables } from './domain.js';
import { calendarFrom, dateText } from './time.js';

export const TAIL_HEADER = '[Key people] Away from the scene:';
const MAX_DOING = 90;
const MAX_LATEST = 80;

/** The kinds' one line for the change-line instruction (SPEC §4.4). */
export const GRAMMAR = Object.freeze({
    away: '+ away Name — what they are doing | back: date (~ away Name to change it; ! away Name — where they got to; - away Name when they are back)',
    key: '- key Name | died (a key person who dies)',
});

/** The paragraph of the fixed prompt: no names, counts, times or dice. */
export const STATIC_TEXT = 'Key people are the people {{user}} follows. When one leaves the scene for a while, write an away line with what they do and when they should be back; write a step line when news of them comes; write - away Name when they return. Under [Key people] each away person has a line: let their story move on, and when one is due back, bring them back. Write - key Name | died only for a death.';

/** The `tokens` setting: a whole number from 0 (nothing is told), no upper limit; else the default. */
export function tokensOf(settings) {
    const value = settings?.tokens;
    return isInt(value) && value >= 0 ? value : DEFAULT_TOKENS;
}

/** Whether the feature is on (`source.feature` when the host has it), else on. */
export function keyPeopleOn(source) {
    if (typeof source?.feature !== 'function') return true;
    try {
        return source.feature(FEATURE) !== false;
    } catch {
        return true;
    }
}

/**
 * The away key people (pinned people with an away record), told in the tail's order: `[{ key, name, doing, since, back, due,
 * last: { date, text } | null, steps }]`. `now`: the story clock, or null.
 */
export function awayEntries(slice, now) {
    const { pins } = tables(slice);
    const out = [];
    for (const key of Object.keys(pins)) {
        const away = awayOf(slice, key);
        if (!away) continue;
        const back = isInt(away.back) ? away.back : null;
        const steps = Array.isArray(away.steps) ? away.steps.filter(isRecord) : [];
        const last = steps.at(-1) ?? null;
        out.push({
            key, name: String(pins[key].name ?? away.name ?? ''), doing: String(away.doing ?? ''), since: isInt(away.since) ? away.since : null, back,
            due: back !== null && isInt(now) && now >= back, last: last ? { date: isInt(last.date) ? last.date : null, text: String(last.text ?? '') } : null, steps,
        });
    }
    const soon = entry => (entry.back === null ? Infinity : entry.back);
    const late = entry => entry.last?.date ?? -Infinity;
    return out.sort((a, b) => soon(a) - soon(b) || late(b) - late(a) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** One away person's tail line. */
export function awayLine(entry, calendar) {
    const doing = cutPoints(entry.doing, MAX_DOING).replace(/[.!?…]+$/, '');
    const when = dateText(calendar, entry.back);
    const back = when ? (entry.due ? `, due back (${when})` : `, back ${when}`) : '';
    const latest = entry.last?.text ? `; latest: ${cutPoints(entry.last.text, MAX_LATEST).replace(/[.!?…]+$/, '')}` : '';
    return `${entry.name}: away${doing ? `, ${doing}` : ''}${back}${latest}.`;
}

/**
 * The tail for a state: `{ lines, tokens, left }` — the header and the lines that fit `budget` tokens (estimated at four
 * characters a token), `tokens` what they cost, `left` how many away people did not fit. No lines when none is away or
 * nothing fits.
 */
export function keyTail(slice, { now = null, calendar, budget = DEFAULT_TOKENS } = {}) {
    const entries = awayEntries(slice, now);
    const lines = [TAIL_HEADER];
    let left = 0;
    for (const entry of entries) {
        const line = awayLine(entry, calendar);
        if (left === 0 && estimateTokens([...lines, line].join('\n')) <= budget) lines.push(line);
        else left += 1;
    }
    if (lines.length < 2) return { lines: [], tokens: 0, left: entries.length };
    return { lines, tokens: estimateTokens(lines.join('\n')), left };
}

/** `context.tail(view)` → `{ lines, optional }` (SPEC §5). */
export function tail(view) {
    if (!keyPeopleOn(view)) return { lines: [], optional: [] };
    const slice = view?.state?.domains?.keypeople;
    if (!slice || !Object.keys(tables(slice).away).length) return { lines: [], optional: [] };
    let settings = {};
    try { settings = typeof view?.settings === 'function' ? view.settings() ?? {} : {}; } catch { settings = {}; }
    const minutes = view?.state?.domains?.director?.time?.minutes;
    const calendar = calendarFrom(typeof view?.query === 'function' ? (name, args) => view.query(name, args) : null);
    const out = keyTail(slice, { now: isInt(minutes) ? minutes : null, calendar, budget: tokensOf(settings) });
    return { lines: out.lines, optional: [] };
}
