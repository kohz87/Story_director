// Story Director v2, part **arc**: strict reading, writing and counting of plans. Pure.

import { lineKey, parseChanges } from '../../../changes.js';
import { resolveRelative } from '../../../planner.js';
import {
    DATE_PARTS, DECORATION, DESC_POINTS, FENCE, KEY_POINTS, KIND_ORDER, LABELS, LABEL_LINE,
    MAX_ANSWER_CHARS, MAX_FIGHTS, MAX_ITEMS, MAX_LINES, PARTS, PART_POINTS, PLAN_CAPS,
    PLAN_CLOSE, PLAN_OPEN, RESERVED_KEYS, SHOWN, THINK_BLOCK, THINK_CLOSE, flat, part,
} from './shared.js';

// ---------------------------------------------------------------------------------------------------
// Reading a plan

// The plan's lines: inside the <plan> block when there is one (the opening nearest the first close, so a
// "here is the <plan>" in prose before it does not swallow it), with reasoning taken out first.
function planBody(text) {
    let clean = String(text ?? '').slice(0, MAX_ANSWER_CHARS).replace(THINK_BLOCK, '');
    const closes = [...clean.matchAll(THINK_CLOSE)];
    if (closes.length) {
        const last = closes.at(-1);
        clean = clean.slice(last.index + last[0].length);
    }
    const close = clean.search(PLAN_CLOSE);
    const end = close >= 0 ? close : clean.length;
    let start = 0;
    for (const match of clean.slice(0, end).matchAll(PLAN_OPEN)) start = match.index + match[0].length;
    return clean.slice(start, end);
}

const finding = (severity, text) => ({ severity, text });

function isPast(parsed, now, calendar) {
    if (!parsed.hasTime) return calendar.dayIndex(parsed.abs) < calendar.dayIndex(now);
    return parsed.abs < now;
}

// A date part as code keeps it: relative words written on the calendar, an absolute date written the
// calendar's way; `{ value }`, or `{ drop: reason }`. Without a calendar or a story time, as written.
function dateOf(value, { calendar, now }) {
    const written = part(value, PART_POINTS);
    if (!calendar || !Number.isInteger(now)) return { value: written };
    let resolved = null;
    try { resolved = resolveRelative(written, { calendar, now }); } catch { resolved = null; }
    let parsed = null;
    try { parsed = calendar.parse(resolved ?? written, { reference: now }); } catch { parsed = null; }
    if (!parsed || !Number.isFinite(parsed.abs)) return { drop: `"${written}" is not a date on this calendar` };
    if (isPast(parsed, now, calendar)) return { drop: `${written} is already past` };
    let out = '';
    try { out = calendar.format(parsed.abs, { era: false, time: parsed.hasTime === true }); } catch { out = ''; }
    return { value: out || written };
}

// One line's label and the rest, or null for a line that carries nothing (a fence, a rule, a blank).
function labelOf(raw) {
    const trimmed = String(raw ?? '').trim();
    if (!trimmed || FENCE.test(trimmed)) return null;
    let text = trimmed.replace(/\*\*|__/g, '').replace(DECORATION, '').trim();
    if (!/[\p{L}\p{N}]/u.test(text)) return null;
    const match = text.match(LABEL_LINE);
    if (!match) return { error: `"${flat(trimmed, 60)}" has no label (ARC:, BEAT:, AGENDA:, HOOK:, CLOCK: or SECRET:)` };
    const label = match[1].toUpperCase();
    if (!Object.hasOwn(LABELS, label)) return { error: `"${flat(match[1], 30)}:" is not a plan label` };
    text = match[2].trim();
    return { label, kind: LABELS[label], rest: text };
}

/**
 * Reads a plan: the planner's answer, or the plan's text as the reader edited it. `options`: { calendar
 * (calendar.js), now (story minutes or null), fights (a module runs fights), userName ({{user}}'s name,
 * for a line that plans what they do), lone (one item read alone: no ARC line is asked for) }. → `{ arc: { key, desc } | null, items: [{ kind, key, desc,
 * parts: { name: text } }], findings: [{ severity: 'error' | 'warn' | 'info', text }] }`. An `error`
 * finding means the plan cannot be used (no ARC line, nothing planned).
 */
export function readPlan(text, { calendar = null, now = null, fights = true, userName = '', lone = false } = {}) {
    const findings = [];
    const items = [];
    const seen = new Set();
    const count = Object.fromEntries(KIND_ORDER.map(kind => [kind, 0]));
    let arc = null;
    let fightsKept = 0;
    let read = 0;
    const user = userPattern(userName);
    const body = planBody(text);
    if (String(text ?? '').length > MAX_ANSWER_CHARS) findings.push(finding('info', `Only the first ${MAX_ANSWER_CHARS} characters were read.`));

    for (const raw of body.split(/\r?\n/)) {
        const line = labelOf(raw);
        if (!line) continue;
        read += 1;
        if (read > MAX_LINES) {
            findings.push(finding('info', `Only the first ${MAX_LINES} lines were read.`));
            break;
        }
        if (line.error) {
            findings.push(finding('info', `Not read: ${line.error}.`));
            continue;
        }
        // The rest is the change-line grammar ("Key — what | part: value"); `arc` borrows `event`.
        const { ops } = parseChanges(`+ ${line.kind === 'arc' ? 'event' : line.kind} ${line.rest}`);
        const op = ops[0];
        const key = op ? flat(String(op.key ?? '').replace(/^[A-Za-z]+\s*:\s*/, ''), KEY_POINTS) : '';
        if (!op || !key || !lineKey(key)) {
            findings.push(finding('info', `Not read: a ${line.label} line without a name.`));
            continue;
        }
        if (RESERVED_KEYS.has(lineKey(key)) || RESERVED_KEYS.has(key.toLowerCase())) {
            findings.push(finding('warn', `Left out: "${key}" cannot be a name.`));
            continue;
        }
        const desc = part(op.fields?.desc, DESC_POINTS);
        if (line.kind === 'arc') {
            if (arc) findings.push(finding('info', `A second ARC line ("${key}") was left out; the first is kept.`));
            else arc = { key, desc };
            continue;
        }
        const id = lineKey(key);
        if (seen.has(id)) {
            findings.push(finding('info', `"${key}" is in the plan twice; the first is kept.`));
            continue;
        }
        if (count[line.kind] >= PLAN_CAPS[line.kind]) {
            findings.push(finding('info', `"${key}" was left out: a plan keeps at most ${PLAN_CAPS[line.kind]} ${line.kind === 'beat' ? 'beats' : `${line.kind}s`}.`));
            continue;
        }
        if (items.length >= MAX_ITEMS) {
            findings.push(finding('info', `"${key}" was left out: a plan keeps at most ${MAX_ITEMS} items.`));
            continue;
        }
        // A secret about {{user}} is fine ("Ren is the heir"); a plan for them is not.
        if (user && line.kind !== 'secret' && user.test(key)) {
            findings.push(finding('warn', `"${key}" was left out: it plans what ${userName.trim()} does; the plan is for the world and its people.`));
            continue;
        }

        const given = { ...(op.fields ?? {}), ...(op.extra ?? {}) };
        const parts = {};
        const dropped = [];
        // ENCOUNTER: the foes are its `encounter:`, else its words, else its name (v1 fightBeat).
        if (line.label === 'ENCOUNTER' && !String(given.encounter ?? '').trim()) given.encounter = desc || key;
        for (const [name, value] of Object.entries(given)) {
            if (name === 'desc' || !String(value ?? '').trim()) continue;
            if (!PARTS[line.kind].includes(name)) {
                dropped.push(name);
                continue;
            }
            if (DATE_PARTS.has(name)) {
                const date = dateOf(value, { calendar, now });
                if (date.drop) findings.push(finding('info', `"${key}": ${name}: left out (${date.drop}).`));
                else if (date.value) parts[name] = date.value;
                continue;
            }
            if (name === 'shown') {
                const word = part(value, 20).toLowerCase();
                if (SHOWN.has(word)) parts.shown = word;
                else dropped.push(name);
                continue;
            }
            if (name === 'after') {
                const other = flat(value, KEY_POINTS);
                if (other && lineKey(other) !== id) parts.after = other;
                continue;
            }
            const kept = part(value, PART_POINTS);
            if (kept) parts[name] = kept;
        }
        if (parts.encounter) {
            if (!fights) {
                delete parts.encounter;
                findings.push(finding('info', `"${key}": no module runs fights here, so it stays a beat without foes.`));
            } else if (fightsKept >= MAX_FIGHTS) {
                delete parts.encounter;
                findings.push(finding('info', `"${key}": a plan keeps at most ${MAX_FIGHTS} fights; it stays a beat without foes.`));
            } else fightsKept += 1;
        }
        if (dropped.length) findings.push(finding('info', `"${key}": ${[...new Set(dropped)].map(name => `${name}:`).join(', ')} left out (not part of a ${line.kind} in a plan).`));
        seen.add(id);
        count[line.kind] += 1;
        items.push({ kind: line.kind, key, desc, parts: ordered(line.kind, parts) });
    }

    if (!arc && !lone) findings.unshift(finding('error', 'The plan has no ARC line.'));
    if (!items.length) findings.unshift(finding('error', 'The plan has no beats, agendas, hooks, clocks or secrets.'));
    return { arc, items, findings };
}

const ordered = (kind, parts) => Object.fromEntries(PARTS[kind].filter(name => parts[name]).map(name => [name, parts[name]]));

// The name at the start, as a whole word; a possessive ("Ren's debt") is a thing, not an act.
function userPattern(name) {
    const trimmed = String(name ?? '').trim();
    if (!trimmed || /^\{\{.*\}\}$/.test(trimmed)) return null;
    const body = trimmed.split(/\s+/).map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
    return new RegExp(`^\\s*${body}(?![\\p{L}\\p{N}'’])`, 'iu');
}

/** One plan item as its text line ("BEAT: Key — what | on: …"). */
export function itemLine(item) {
    const label = item.kind === 'arc' ? 'ARC' : item.kind.toUpperCase();
    const parts = Object.entries(item.parts ?? {}).map(([name, value]) => ` | ${name}: ${value}`).join('');
    return `${label}: ${item.key}${item.desc ? ` — ${item.desc}` : ''}${parts}`;
}

/** The plan as text, one line an item: what the review shows and the reader may edit; readPlan reads it back the same. */
export function planText(plan) {
    const lines = [];
    if (plan?.arc) lines.push(itemLine({ kind: 'arc', key: plan.arc.key, desc: plan.arc.desc }));
    for (const item of plan?.items ?? []) lines.push(itemLine(item));
    return lines.join('\n');
}

/** How many of each kind a plan holds: `{ beat, agenda, hook, clock, secret }`. */
export function planCounts(plan) {
    const counts = Object.fromEntries(KIND_ORDER.map(kind => [kind, 0]));
    for (const item of plan?.items ?? []) if (Object.hasOwn(counts, item.kind)) counts[item.kind] += 1;
    return counts;
}

/** A short hash of the Director's note (FNV-1a, base 36), so an arc can say which note it was planned with. */
export function noteMark(note) {
    const text = String(note ?? '').trim().replace(/\s+/g, ' ');
    if (!text) return '';
    let hash = 0x811c9dc5;
    for (const char of text) {
        hash ^= char.codePointAt(0);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(36);
}
