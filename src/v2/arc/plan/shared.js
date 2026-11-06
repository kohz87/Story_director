// Story Director v2, part **arc**: shared planner constants and text rules. Pure.

/** The longest planner answer read, in characters; the rest is not looked at. */
export const MAX_ANSWER_CHARS = 32000;
/** Lines of the answer looked at; past them nothing is read. */
export const MAX_LINES = 80;
/** The most of each kind one plan keeps (in its order); the rest is left out, and the review says so. */
export const PLAN_CAPS = Object.freeze({ beat: 6, agenda: 6, hook: 3, clock: 2, secret: 4 });
/** Items one plan keeps in all (Story Director adds at most 16 threads for one reply, tracker/capture.js). */
export const MAX_ITEMS = 16;
/** Planned fights one plan keeps; a later beat keeps its words but loses its foes. */
export const MAX_FIGHTS = 2;
export const KEY_POINTS = 80;
export const DESC_POINTS = 240;
export const PART_POINTS = 160;

export const LABELS = Object.freeze({ ARC: 'arc', BEAT: 'beat', ENCOUNTER: 'beat', AGENDA: 'agenda', HOOK: 'hook', CLOCK: 'clock', SECRET: 'secret' });
/** The parts each kind keeps, in the order the plan text writes them. */
export const PARTS = Object.freeze({
    arc: Object.freeze([]),
    beat: Object.freeze(['on', 'place', 'after', 'reach', 'encounter']),
    agenda: Object.freeze(['now', 'then', 'on', 'place']),
    hook: Object.freeze(['then', 'on']),
    clock: Object.freeze(['due', 'shown']),
    secret: Object.freeze([]),
});
export const DATE_PARTS = new Set(['on', 'due']);
export const SHOWN = new Set(['none', 'sign', 'warning']);
// A key the tracker's key index must never be asked for (a plain object's own names).
export const RESERVED_KEYS = new Set(['proto', '__proto__', 'constructor', 'prototype', 'hasownproperty', 'tostring', 'valueof']);
export const KIND_ORDER = ['beat', 'agenda', 'hook', 'clock', 'secret'];

export const THINK_BLOCK = /<(think|thinking|reasoning)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
export const THINK_CLOSE = /<\/(?:think|thinking|reasoning)\s*>/gi;
export const PLAN_OPEN = /<plan\b[^>]*>/gi;
export const PLAN_CLOSE = /<\/plan\s*>/i;
export const DECORATION = /^(?:#{1,6}\s+|>\s*|(?:[*•+-]|\d{1,2}[.)])\s+)+/;
export const LABEL_LINE = /^([A-Za-z]+)\s*:\s*(.*)$/s;
export const FENCE = /^(?:```|~~~)/;

// ---------------------------------------------------------------------------------------------------
// Text as code keeps it

/**
 * `value` as one plain line of at most `points` code points: control and format characters out, `<`
 * and `>` out (no markup reaches a screen or the prompt), runs of space made one, NFC. Cut at a space
 * past half of it when there is one.
 */
export function flat(value, points) {
    const cleaned = String(value ?? '')
        .normalize('NFC')
        .replace(/[\p{Cc}\p{Cf}]+/gu, ' ')
        .replace(/[<>]/g, '')
        .replace(/\*\*|__|`/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    const chars = [...cleaned];
    if (chars.length <= points) return cleaned;
    const head = chars.slice(0, points).join('');
    const space = head.lastIndexOf(' ');
    return (space >= head.length / 2 ? head.slice(0, space) : head).trim();
}

// A separator the change-line grammar reads (` | `, ` — `) never survives inside a part, so the text
// form reads back as the same plan.
export const part = (value, points) => flat(String(value ?? '').replace(/\s[|—–]\s/g, ' ').replace(/\|/g, '/'), points);
