// Story Suite v2: rule marks, a per-reply list of the rules a reply was captured under (`rules` on its record). A rule that changes what a
// story line does (a new write a line never made before) must not reach an old reply when it is run again (Re-read, edit, rebuild), so the
// live capture marks the reply that has such a line, and a module reads the list, read-only, as `ctx.carrier.rules` in its apply.
// A reply captured before the rule has no mark and keeps the old behaviour. The list is bookkeeping, not a replay input (replay.js).
// New rule: add a name and its line test to RULE_LINES below; nothing else in the host changes.

/** Rule name -> does this change line (`{ kind, raw }`) fall under it? Matched on the line as the story wrote it. */
export const RULE_LINES = Object.freeze({
    // `- key Name | died`: a death counts for anyone, not only a pinned key person (Story Director keypeople). Same words as its death test.
    diedAny: line => line?.kind === 'key' && /(?<![\p{L}\p{N}])(?:died|dies|dead|death|killed|slain|murdered|perished)(?![\p{L}\p{N}])/iu.test(String(line.raw ?? '')),
});

export const MAX_RULE_MARKS = 8;
const NAME = /^[A-Za-z][A-Za-z0-9]{0,31}$/u;

/** The marks a record keeps: known names only, sorted, no repeats, at most MAX_RULE_MARKS. Anything else in the field is ignored. */
export function ruleMarksOf(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter(name => typeof name === 'string' && NAME.test(name) && Object.hasOwn(RULE_LINES, name)))].sort().slice(0, MAX_RULE_MARKS);
}

/** The rules the change `lines` ({ kind, raw }) fall under. */
export function ruleMarksFor(lines) {
    return Object.keys(RULE_LINES).filter(name => (lines ?? []).some(line => RULE_LINES[name](line))).sort();
}
