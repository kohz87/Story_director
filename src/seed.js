// Seeding: turns the list sections of an existing World_State block (Off-Screen, World,
// Hooks, Clocks) into `+` ops, so a chat that predates Story Director starts with a full
// tracker. Items are read with the change-line parser, so the ledger formats the old lists
// used (`* **Geva — now:** Court | then: …`, `* Key — desc`, `* Key: desc`) all work.
// Pure: no DOM, no globals.

import { parseChanges } from './changes.js';

// Compact names (lowercase letters only) of the list sections, and the kind each becomes.
const SECTION_KINDS = Object.freeze({
    offscreen: 'agenda',
    elsewhere: 'agenda',
    world: 'event',
    worldevents: 'event',
    hooks: 'hook',
    unresolvedthreads: 'hook',
    threads: 'hook',
    plantedseeds: 'hook',
    clocks: 'clock',
    consequencetimers: 'clock',
    timers: 'clock',
});

const BULLET = /^\s*[*•-]\s+(.*)$/s;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const MAX_HEADING_WORDS = 4;

function compactName(name) {
    return name.normalize('NFKC').toLowerCase().replace(/[^\p{L}]/gu, '');
}

// A heading name is a few plain words once its emoji are gone (`📡 Off-Screen`). A dashed
// name (`Geva — now`) is an unbulleted ledger item, not a heading.
function headingName(raw) {
    const name = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (!/^\p{L}[\p{L}\p{N}\s'’&/-]*$/u.test(name) || /\s-\s/.test(name)) return null;
    if (name.split(/\s+/).length > MAX_HEADING_WORDS) return null;
    return name;
}

/**
 * Reads a World_State heading line (`**📡 Off-Screen:**`, `**Hooks**:`, `Clocks:`, with
 * optional inline text after the colon). Returns `{ name, kind, inline }`, where `name` is
 * compact (`offscreen`, `arcphase`) and `kind` the record kind of a list section or null;
 * null when the line is not a heading. Shared with mirror.js.
 */
export function readHeading(line) {
    const text = String(line ?? '').replace(/\r$/, '').trim();
    if (!text || BULLET.test(text) || RULE.test(text)) return null;

    let name;
    let inline;
    const bold = text.match(/^\*\*(.+?)\*\*\s*(.*)$/s);
    if (bold) {
        const inner = bold[1].trim();
        if (inner.endsWith(':')) {
            name = inner.slice(0, -1);
            inline = bold[2];
        } else if (bold[2].startsWith(':')) {
            name = inner;
            inline = bold[2].slice(1);
        } else {
            return null;
        }
    } else {
        const plain = text.match(/^([^:]+):(?:\s+(.*))?$/s);
        if (!plain) return null;
        name = plain[1];
        inline = plain[2] ?? '';
    }

    const clean = headingName(name);
    if (!clean) return null;
    const compact = compactName(clean);
    const kind = Object.hasOwn(SECTION_KINDS, compact) ? SECTION_KINDS[compact] : null;
    return { name: compact, kind, inline: inline.trim() };
}

function isNone(item) {
    return /^none\.?$/i.test(item.replace(/[*_`]/g, '').trim());
}

/** `+` ops for every item of the block's list sections, with a count per kind. */
export function seedFromWorldState(text) {
    const ops = [];
    const counts = { agenda: 0, event: 0, hook: 0, clock: 0 };
    let kind = null;

    const take = item => {
        if (!item.trim() || isNone(item)) return;
        const [op] = parseChanges(`+ ${kind} ${item.trim()}`).ops;
        if (!op) return;
        ops.push(op);
        counts[op.kind] += 1;
    };

    for (const line of String(text ?? '').split('\n')) {
        if (RULE.test(line)) {
            kind = null;
            continue;
        }
        const heading = readHeading(line);
        if (heading) {
            // Any other heading (the PC card, NPCs Present, an NPC's name, Arc Phase) ends
            // the list, so its bullets never become records.
            kind = heading.kind;
            if (kind && heading.inline) take(heading.inline);
            continue;
        }
        const bullet = line.match(BULLET);
        if (kind && bullet) take(bullet[1]);
    }
    return { ops, counts };
}
