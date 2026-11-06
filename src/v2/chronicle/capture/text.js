// Story Director v2, chronicle part: the text shared by the chronicle's change lines and reader commands
// (moved out of capture.js unchanged; capture.js re-exports the public names): the line text, the Director's
// clock, state words, names and labels, and the sentence helper. It imports only the chronicle domain.

import { MAX_NAMED, STATES, cleanName, keyOf } from '../domain.js';

// The separator between a word and more text inside a label: an em or en dash, or a spaced hyphen.
const TEXT_DASH = /\s*[—–]\s*|\s+-\s+/;
const LIST = /\s*[,;/]\s*|\s+(?:and|&|vs\.?|versus|against)\s+/i;
export const CLEAR = /^(?:none|-|—|nothing|nowhere|no one)$/i;

// The words a model writes for each state.
const STATE_WORDS = Object.freeze({
    looming: ['looming', 'brewing', 'rumoured', 'rumored', 'building', 'threatened', 'pending', 'rising', 'gathering', 'imminent'],
    ongoing: ['ongoing', 'active', 'underway', 'under way', 'open', 'raging', 'spreading', 'escalating', 'continuing', 'worsening', 'waning'],
    resolved: ['resolved', 'ended', 'over', 'done', 'finished', 'closed', 'averted', 'defeated', 'won', 'lost', 'stopped', 'ended peacefully'],
});

export const asText = value => (typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value));
const isInt = value => Number.isSafeInteger(value);

/** The line as the story wrote it, for messages. */
export function lineText(line) {
    const labels = Object.entries(line?.labels ?? {}).map(([label, value]) => ` | ${label}: ${value}`).join('');
    return `${line?.op ?? ''} ${line?.kind ?? ''} ${line?.name ?? ''}${line?.text ? ` — ${line.text}` : ''}${labels}`.trim();
}

/**
 * The Director's clock now, in story minutes, or null while it is not set: Story Block's
 * `ctx.time()` (SPEC §3.2), else the tracker's `director.time` query, else `director.time.minutes`.
 */
export function clockOf(ctx) {
    const tries = [
        () => (typeof ctx?.time === 'function' ? ctx.time() : undefined),
        () => (typeof ctx?.query === 'function' ? ctx.query('director.time', {})?.minutes : undefined),
        () => (typeof ctx?.read === 'function' ? ctx.read('director')?.time?.minutes : undefined),
    ];
    for (const fn of tries) {
        let value;
        try { value = fn(); } catch { value = undefined; }
        if (isInt(value)) return value;
    }
    return null;
}

/** A state word (`resolved — slain at the pass`): `{ state, rest }`, or `{ error }`. */
export function readState(value) {
    const text = asText(value).trim();
    const dash = TEXT_DASH.exec(text);
    const word = (dash ? text.slice(0, dash.index) : text).trim().toLowerCase().replace(/[.!]+$/, '');
    const rest = dash ? text.slice(dash.index + dash[0].length).trim() : '';
    const state = STATES.find(name => STATE_WORDS[name].includes(word));
    if (!state) return { error: `"${word || text}" is not a state; write looming, ongoing or resolved.` };
    return { state, rest };
}

/** Names in a list label (`Ashen Court, River Guild`), cleaned, at most `max`, no repeats. */
export function readNames(value, max = MAX_NAMED) {
    const out = [];
    for (const part of asText(value).split(LIST)) {
        const name = cleanName(part);
        if (!keyOf(name) || CLEAR.test(name) || out.some(other => keyOf(other) === keyOf(name))) continue;
        out.push(name);
        if (out.length >= max) break;
    }
    return out;
}

// The first label of `labels` given under one of `names`, or undefined.
export function labelOf(labels, names) {
    for (const name of names) if (labels[name] !== undefined) return labels[name];
    return undefined;
}

export const sentence = text => text.replace(/([.!?…])\.$/, '$1');
