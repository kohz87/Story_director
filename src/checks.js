// Story Director: checks after a reply (pure).
//
// Compares the tracker before and after a reply's change lines and reports what the model
// got wrong or left undone: problems from applying ops, lines that did not parse, due items
// it did not fire (and ones overdue long enough to count as missed), dates written into
// prose fields, and a missing <Director> block. (Long parts are no longer reported: since
// v0.8.4 the note trims them, and the tracker keeps every word.)

import { isDue } from './relevance.js';

const DAY_MINUTES = 1440;
// Past due by more than a day, an unfired item counts as missed.
const MISSED_AFTER_MINUTES = DAY_MINUTES;
// Prose fields where a date does not belong (it belongs in on/due/arrive).
const PROSE_FIELDS = ['now', 'then', 'desc'];

export function checkReply({
    before,
    after,
    ops = [],
    applyProblems = [],
    parseErrors = [],
    calendar,
    now = null,
    hadBlock,
} = {}) {
    const findings = applyProblems.map(problem => ({ ...problem }));

    for (const error of parseErrors) {
        const line = error?.line ? `"${error.line}"` : 'a line';
        findings.push(finding('parse', 'warn', null, `Could not read ${line}: ${error?.message ?? 'not a change line'}`));
    }

    const touched = new Set((ops ?? []).map(opId).filter(Boolean));
    const beforeById = byId(before);
    const timed = calendar && typeof now === 'number' && Number.isFinite(now);

    if (timed) {
        for (const record of after?.records ?? []) {
            if (written(record, touched) || !isDue(record, { calendar, now })) continue;
            if (overdueMinutes(record, calendar, now) > MISSED_AFTER_MINUTES) {
                findings.push(finding('missed', 'warn', record.key, `${record.key} was due ${dueText(record)} and has not happened`));
            } else if (beforeById.has(record.id) && isDue(beforeById.get(record.id), { calendar, now })) {
                findings.push(finding('unfired', 'info', record.key, `${record.key} is due ${dueText(record)}; fire it with ! when it happens`));
            }
        }
    }

    for (const record of changedRecords(after, ops)) {
        const fields = record.fields ?? {};
        if (calendar) {
            for (const field of PROSE_FIELDS) {
                if (hasCalendarDate(fields[field], calendar, now)) {
                    findings.push(finding('date-in-text', 'info', record.key, `${record.key}: a date is written in ${field}; dates go in on, due or arrive`));
                }
            }
        }
    }

    if (hadBlock === false && timed && ((before ?? after)?.records ?? []).some(record => isDue(record, { calendar, now }))) {
        findings.push(finding('no-block', 'info', null, 'The reply has no <Director> block although something was due'));
    }
    return findings;
}

function finding(kind, severity, key, message) {
    return { kind, severity, key, message };
}

function opId(op) {
    return op?.id || String(op?.key ?? '').toLowerCase().trim();
}

function byId(tracker) {
    return new Map((tracker?.records ?? []).map(record => [record.id, record]));
}

// (0.9.19) Whether one of `ids` is the record's: its own, or a name it was reached by (an alias).
function written(record, ids) {
    return ids.has(record.id) || (record.aliases ?? []).some(alias => ids.has(alias));
}

// The active records an op wrote to; a resolved record has nothing left to tidy.
function changedRecords(after, ops) {
    const ids = new Set((ops ?? []).filter(op => op?.op !== '-').map(opId));
    return (after?.records ?? []).filter(record => record.status === 'active' && written(record, ids));
}

// How long ago the earliest due date passed; a day-level date passes at the end of its day.
function overdueMinutes(record, calendar, now) {
    let most = -Infinity;
    for (const field of ['on', 'due']) {
        const text = record.fields?.[field];
        if (!text) continue;
        const parsed = calendar.parse(text, { reference: now });
        if (!parsed) continue;
        const passed = parsed.hasTime ? parsed.abs : (calendar.dayIndex(parsed.abs) + 1) * DAY_MINUTES;
        most = Math.max(most, now - passed);
    }
    return most;
}

function dueText(record) {
    const f = record.fields ?? {};
    const when = record.kind === 'clock' ? f.due || f.on : f.on || f.due;
    return when ? `(${when})` : 'now';
}

// A bare time or part of day ("waits until morning") parses too, as the reference's day,
// so only text that names a month counts as a calendar date.
function hasCalendarDate(text, calendar, now) {
    if (typeof text !== 'string' || !text.trim()) return false;
    const parsed = calendar.parse(text, { reference: typeof now === 'number' ? now : null });
    if (!parsed) return false;
    const months = (calendar.config?.months ?? []).map(month => String(month?.name ?? month).toLowerCase());
    if (!months.length) return true;
    // A part of day ("dawn") can share a prefix with a month (Dawnwane) but names no date.
    const partsOfDay = new Set(Object.keys(calendar.config?.partsOfDay ?? {}).map(name => name.toLowerCase()));
    const words = String(parsed.text ?? text).toLowerCase().match(/[\p{L}]+/gu) ?? [];
    return words.some(word => word.length >= 3 && !partsOfDay.has(word) && months.some(name => name.startsWith(word)));
}
