// Story Director: reading a planner answer into items (pure).

import { parseChanges } from '../changes.js';
import { resolveDates } from './relative.js';

// Plan labels, lowercased with spaces, hyphens and underscores squashed to one space. The
// old blueprint names (Megumin's EVENT/SUB-EVENT, OFF-LIMITS, TIMER, THREAD) land here too.
const LABELS = Object.freeze({
    arc: 'arc',
    beat: 'beat', event: 'beat', 'sub event': 'beat', subevent: 'beat',
    agenda: 'agenda', 'npc agenda': 'agenda', npc: 'agenda',
    hook: 'hook', thread: 'hook',
    // The planner offers work; only {{user}} accepts it, so a planned quest is an open hook.
    quest: 'hook', bounty: 'hook', contract: 'hook',
    clock: 'clock', timer: 'clock',
    secret: 'secret', 'off limits': 'secret', offlimits: 'secret',
    // A planned fight is a beat that carries its foes; see fightBeat.
    encounter: 'beat', fight: 'beat',
});
const FIGHT_LABELS = new Set(['encounter', 'fight']);

// `BEAT:`, `NPC AGENDA:`, `BEAT 2:` (numbered beats are common); the label is words only, so
// `Geva — now: Court` is not read as a label.
const LABEL = /^([A-Za-z][A-Za-z _-]*?)(?:\s*#?\d+)?\s*:\s*(.*)$/s;
const BULLET = /^(?:[*•+-]|\d+[.)])\s+/;
const CODE_FENCE = /^(?:```|~~~)/;
// What a key cannot start with: the change-line grammar would read it as the end of a key.
const SEPARATOR_FIRST = /^(?:[—–:|]|-(?:\s|$))/;

const THINK_BLOCK = /<(think|thinking)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const THINK_CLOSE = /<\/think(?:ing)?\s*>/gi;
const PLAN_OPEN = /<plan\b[^>]*>/gi;
const PLAN_CLOSE = /<\/plan\s*>/i;


// ---------------------------------------------------------------------------------------
// Reading the answer

/**
 * Reads a planner answer into `{ arc, items, errors }`. Lines it cannot read go to `errors`
 * as `{ line, text, message }` (line is 1-based in `text`); nothing is invented.
 */
export function parsePlan(text, { calendar = null, now = null } = {}) {
    const plan = { arc: null, items: [], errors: [] };
    const { body, firstLine } = planBody(String(text ?? ''));

    body.split(/\r?\n/).forEach((raw, index) => {
        const line = firstLine + index;
        const trimmed = raw.trim();
        // Fence lines are dropped; the lines between them are read like any other.
        if (CODE_FENCE.test(trimmed)) return;
        const result = readLine(trimmed);
        if (!result) return;
        if (result.error) {
            plan.errors.push({ line, text: trimmed, message: result.error });
            return;
        }
        const { kind, op } = result;
        if (kind === 'arc') {
            if (plan.arc) plan.errors.push({ line, text: trimmed, message: 'a second ARC line (the first is kept)' });
            else plan.arc = { key: op.key, desc: op.fields.desc ?? '' };
            return;
        }
        plan.items.push({
            kind,
            key: op.key,
            fields: resolveDates(op.fields, { calendar, now }),
            extra: { ...op.extra },
            raw: trimmed,
        });
    });
    return plan;
}

// The part of the answer that holds the plan. Thinking is blanked down to its newlines, so
// line numbers still point into the text the reader sees.
function planBody(text) {
    const blank = part => part.replace(/[^\n]/g, '');
    let clean = text.replace(THINK_BLOCK, blank);
    // A reasoning model whose opening tag was cut off leaves only `</think>`: all before it
    // is thinking.
    const closes = [...clean.matchAll(THINK_CLOSE)];
    if (closes.length) {
        const last = closes[closes.length - 1];
        const end = last.index + last[0].length;
        clean = blank(clean.slice(0, end)) + clean.slice(end);
    }

    const close = clean.search(PLAN_CLOSE);
    const end = close >= 0 ? close : clean.length;
    // The opening nearest the first closing tag, so "here is the <plan> block:" in prose
    // before the real block does not swallow it.
    let start = 0;
    for (const match of clean.slice(0, end).matchAll(PLAN_OPEN)) start = match.index + match[0].length;
    const firstLine = clean.slice(0, start).split('\n').length;
    return { body: clean.slice(start, end), firstLine };
}

function readLine(trimmed) {
    let text = trimmed.replace(/\*\*|__/g, '').trim();
    text = text.replace(/^#{1,6}\s+/, '').replace(BULLET, '').trim();
    // Rules (`---`), blank bullets and the like carry no words.
    if (!/[\p{L}\p{N}]/u.test(text)) return null;

    const match = text.match(LABEL);
    if (!match) return { error: 'no label (expected ARC:, BEAT:, AGENDA:, HOOK:, CLOCK: or SECRET:)' };
    const label = match[1].trim();
    const name = label.toLowerCase().replace(/[\s_-]+/g, ' ');
    const kind = LABELS[name];
    if (!kind) return { error: `unknown label "${label}"` };
    const rest = match[2].trim();
    if (!rest || SEPARATOR_FIRST.test(rest)) return { error: 'missing key' };

    // The rest is the change-line grammar, so the label becomes the kind of a `+` line.
    // `arc` may not be a change kind, so the ARC line borrows `event`; only its key and
    // description are kept.
    const { ops, errors } = parseChanges(`+ ${kind === 'arc' ? 'event' : kind} ${rest}`);
    if (!ops.length) return { error: errors[0]?.message ?? 'not readable' };
    return { kind, op: FIGHT_LABELS.has(name) ? fightBeat(ops[0]) : ops[0] };
}

// `ENCOUNTER: Ambush at the weir — 3 bandit, bandit captain (boss) | on: …`: without an
// `encounter:` part, the description is the foes; with neither, the key is (`ENCOUNTER:
// 2 x dire wolf | on: …`). A beat without foes would not be a fight at all.
function fightBeat(op) {
    const fields = { ...op.fields };
    if (!String(fields.encounter ?? '').trim()) {
        if (String(fields.desc ?? '').trim()) {
            fields.encounter = fields.desc;
            delete fields.desc;
        } else {
            fields.encounter = op.key;
        }
    }
    return { ...op, fields };
}
