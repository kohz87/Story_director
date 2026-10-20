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
    quests: 'quest',
    activequests: 'quest',
    bounties: 'quest',
    contracts: 'quest',
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

// (0.9.31) An Off-Screen line as the mirror writes it ("Courier — rides south; arrives Haywane
// 13; next: delivers the writ (Haywane 14)") read back into change-line parts, so a seeded agenda
// keeps its now, then, on and arrive. Any other line is left as it is.
const MIRROR_ARRIVES = /;\s*arrives\s+([^;]+)/i;
const MIRROR_NEXT = /;\s*next(, on arrival)?:\s*([^;]+?)(?:\s*\(([^()]+)\))?\s*(?=;|$)/i;
const MIRROR_ON = /;\s*on\s+([^;]+)/i;
export function fromMirrorLine(item) {
    const line = String(item ?? '');
    const split = /^(.+?)\s+[—–]\s+(.+)$/.exec(line);
    if (!split || line.includes('|') || !(MIRROR_ARRIVES.test(line) || MIRROR_NEXT.test(line) || MIRROR_ON.test(line))) return line;
    const [, key, rest] = split;
    const now = rest.split(';')[0].trim();
    const arrive = MIRROR_ARRIVES.exec(rest)?.[1]?.trim() ?? '';
    const next = MIRROR_NEXT.exec(rest);
    const on = next?.[3]?.trim() || MIRROR_ON.exec(rest)?.[1]?.trim() || (next?.[1] ? arrive : '');
    const parts = [now ? `now: ${now}` : '', next?.[2] ? `then: ${next[2].trim()}` : '', on ? `on: ${on}` : '', arrive ? `arrive: ${arrive}` : ''].filter(Boolean);
    return `${key} — ${parts.join(' | ')}`;
}

/** `+` ops for every item of the block's list sections, with a count per kind. */
export function seedFromWorldState(text) {
    const ops = [];
    const counts = { agenda: 0, event: 0, hook: 0, quest: 0, clock: 0 };
    let kind = null;

    const take = item => {
        if (!item.trim() || isNone(item)) return;
        const [op] = parseChanges(`+ ${kind} ${kind === 'agenda' ? fromMirrorLine(item.trim()) : item.trim()}`).ops;
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
