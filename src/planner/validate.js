// Story Director: arc plan findings and the change ops of an accepted plan (pure).

import { formatOp, lineKey } from '../changes.js';
import { FIRE_FIELDS } from './relative.js';
import { escapeRegExp, isNumber } from './shared.js';

// ---------------------------------------------------------------------------------------
// Checking and applying

/** Findings for a parsed plan, before the reader accepts it. */
export function validatePlan(plan, { calendar = null, now = null, userName = '' } = {}) {
    const findings = [];
    const push = (kind, severity, key, message) => findings.push({ kind, severity, key, message });
    const items = plan?.items ?? [];
    const reference = isNumber(now) ? now : null;

    if (!plan?.arc) push('plan-no-arc', 'error', null, 'The plan has no ARC line.');
    if (!items.length) push('plan-empty', 'error', null, 'The plan has no beats, agendas, hooks, clocks or secrets.');

    const user = userPattern(userName);
    for (const item of items) {
        const fields = item.fields ?? {};
        if (calendar) {
            for (const name of FIRE_FIELDS) {
                const value = fields[name];
                if (!value) continue;
                const parsed = calendar.parse(value, { reference });
                if (!parsed) {
                    push('plan-bad-date', 'warn', item.key, `"${item.key}": ${name} "${value}" is not a date.`);
                } else if (reference !== null && isPast(parsed, reference, calendar)) {
                    push('plan-past-date', 'warn', item.key,
                        `"${item.key}": ${name} ${value} is before now (${calendar.format(reference, { era: false })}).`);
                }
            }
        }
        // A secret about {{user}} is fine ("Ren is the heir"); a plan for them is not.
        if (user && item.kind !== 'secret' && [item.key, fields.then].some(text => user.test(text ?? ''))) {
            push('plan-user-action', 'warn', item.key,
                `"${item.key}" plans what ${userName.trim()} does; the plan is for the world and the NPCs.`);
        }
    }

    for (const error of plan?.errors ?? []) {
        push('plan-unread', 'info', null, `Line ${error.line} was not read (${error.message}): ${error.text ?? ''}`.trim());
    }
    return findings;
}

// A date without a time counts for its whole day, so "today" is never in the past.
function isPast(parsed, now, calendar) {
    if (!parsed.hasTime) return calendar.dayIndex(parsed.abs) < calendar.dayIndex(now);
    return parsed.abs < now;
}

// The name at the start, as a whole word; a possessive ("Ren's debt") is a thing, not an act.
function userPattern(name) {
    const trimmed = String(name ?? '').trim();
    if (!trimmed) return null;
    const body = trimmed.split(/\s+/).map(escapeRegExp).join('\\s+');
    return new RegExp(`^\\s*${body}(?![\\p{L}\\p{N}'’])`, 'iu');
}

/** `+` ops for an accepted plan: the arc first, then one per item, all tagged `extra.arc`. */
export function planToOps(plan, { arcId } = {}) {
    const arc = String(arcId ?? '').trim();
    if (!arc) throw new TypeError('planToOps needs an arcId');
    const ops = [];
    if (plan?.arc) {
        const fields = plan.arc.desc ? { desc: plan.arc.desc } : {};
        ops.push(addOp('arc', plan.arc.key, fields, { arc }));
    }
    for (const item of plan?.items ?? []) {
        // `after` and any other extra the planner wrote travel with the item.
        ops.push(addOp(item.kind, item.key, { ...item.fields }, { ...item.extra, arc }));
    }
    return ops;
}

function addOp(kind, key, fields, extra) {
    const op = { op: '+', kind, key, id: lineKey(key), fields, extra, reason: '' };
    return { ...op, raw: formatOp(op) };
}

