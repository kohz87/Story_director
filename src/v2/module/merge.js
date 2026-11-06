// Story Director v2: merging the parts into the module surface.

import { partView } from './contexts.js';
import { isObject } from './shared.js';

// ---- merging ---------------------------------------------------------------------------------

export function own(table, name, ns, what) {
    if (Object.hasOwn(table, name)) throw new Error(`Story Director: ${what} "${name}" is in two parts (${table[name]} and ${ns}).`);
    table[name] = ns;
}

// A hook's line: a string, or `{ text, keep: true }` (a pinned cue: Story Block keeps it whatever the tail budget says).
const cueLinesOf = value => (Array.isArray(value) ? value.filter(line => typeof line === 'string' || (line !== null && typeof line === 'object' && typeof line.text === 'string')) : []);
export const linesOf = value => (Array.isArray(value) ? value.filter(line => typeof line === 'string') : []);

// A wrapped handler or query keeps the part's `feature` tag (MODULES §F100: a function with a `feature`
// property), so Story Block can leave it out while the reader has that feature off.
export const withFeature = (fn, from) => (typeof from?.feature === 'string' ? Object.assign(fn, { feature: from.feature }) : fn);

// Several parts' functions under one hook name, called in part order. beforeGenerate and afterCapture
// answers (string[] | { lines, commands }) are joined; canGenerate gives the first refusal; any other
// hook gives the last answer that is not undefined.
export function mergeHook(name, entries, shared) {
    const partView_ = (ns, view) => partView(ns, view, shared);
    // A hook that needs longer than the turn's default (the cast's planner answer is waited for) gives its limit (`fn.timeoutMs`); the merged one keeps the longest.
    const limit = Math.max(0, ...entries.map(([, fn]) => (Number.isFinite(fn?.timeoutMs) ? fn.timeoutMs : 0)));
    const withLimit = merged => (limit > 0 ? Object.assign(merged, { timeoutMs: limit }) : merged);
    // A hook that opted in to run for a reply with no change lines (`fn.always`): the merged hook opts in, and then runs only those parts.
    const always = entries.some(([, fn]) => fn?.always === true);
    const withAlways = merged => (always ? Object.assign(merged, { always: true }) : merged);
    if (entries.length === 1) {
        const [[ns, fn]] = entries;
        return withAlways(withLimit((view, ...rest) => fn(partView_(ns, view), ...rest)));
    }
    return withAlways(withLimit(async (view, ...rest) => {
        if (name === 'beforeGenerate' || name === 'afterCapture') {
            const lines = [];
            const commands = [];
            for (const [ns, fn] of entries) {
                if (rest[0]?.always === true && fn?.always !== true) continue;
                const out = await fn(partView_(ns, view), ...rest);
                lines.push(...cueLinesOf(Array.isArray(out) ? out : out?.lines));
                if (Array.isArray(out?.commands)) commands.push(...out.commands);
            }
            return { lines, commands };
        }
        let answer;
        for (const [ns, fn] of entries) {
            const out = await fn(partView_(ns, view), ...rest);
            if (name === 'canGenerate' && (out === false || (isObject(out) && out.ok === false))) return out;
            if (out !== undefined) answer = out;
        }
        return answer;
    }));
}

// The settings panel's own part (`settings.section(el, api)`): a part's function, keeping its `feature`
// tag (one part has one now); several are drawn one after another, untagged.
export function sectionOf(list) {
    if (!list.length) return null;
    if (list.length === 1) return list[0];
    return (el, api) => { for (const fn of list) fn(el, api); };
}
