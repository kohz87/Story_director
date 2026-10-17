// Off-Screen mirror: writes the tracker's active agendas back into the stored World_State
// block as its Off-Screen section, for readers that still look there (NPC State Delta).
// Only that section changes; every byte outside it is kept as it was. Pure.

import { readHeading } from './seed.js';

const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
// Sections that come after Off-Screen in a World_State block; a new section goes before them.
const AFTER_OFFSCREEN_KINDS = new Set(['event', 'hook', 'clock']);
const AFTER_OFFSCREEN_NAMES = new Set(['arcphase', 'scenephase']);
const PARTS = ['now', 'then', 'on', 'leg', 'arrive'];

function agendaLine(record) {
    const fields = record.fields ?? {};
    const parts = [];
    // An agenda seeded from `* Key: desc` has no `now`; its one line of state is the desc.
    if (!fields.now && fields.desc) parts.push(fields.desc);
    for (const name of PARTS) {
        if (fields[name]) parts.push(`${name}: ${fields[name]}`);
    }
    return parts.length ? `* ${record.key} — ${parts.join(' | ')}` : `* ${record.key}`;
}

function sectionLines(agendas, heading) {
    const active = (agendas ?? []).filter(record =>
        (record.status ?? 'active') === 'active' && (record.kind ?? 'agenda') === 'agenda');
    return [heading, ...(active.length ? active.map(agendaLine) : ['* None'])];
}

// Lines with their offsets; a '\r' stays on its line so offsets match the original text.
function indexLines(text) {
    const lines = [];
    let start = 0;
    for (const line of text.split('\n')) {
        const end = start + line.length - (line.endsWith('\r') ? 1 : 0);
        lines.push({ line, start, end });
        start += line.length + 1;
    }
    return lines;
}

/**
 * Replaces the block's Off-Screen section (heading line up to the next heading, `---` or
 * the end) with `heading` and one line per active agenda, or `* None`. Without one, inserts
 * it before the first World/Hooks/Clocks/Arc Phase/Scene Phase heading, else appends it.
 */
export function mirrorOffscreen(worldStateText, agendas, { heading = '**📡 Off-Screen:**' } = {}) {
    const text = String(worldStateText ?? '');
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const section = sectionLines(agendas, heading).join(eol);
    const lines = indexLines(text);
    const headings = lines.map(({ line }) => readHeading(line));

    const first = headings.findIndex(found => found?.kind === 'agenda');
    if (first !== -1) {
        // The section ends at its last non-blank line, so blank lines before the next
        // heading stay where they were.
        let last = first;
        for (let index = first + 1; index < lines.length; index += 1) {
            if (headings[index] || RULE.test(lines[index].line)) break;
            if (lines[index].line.trim()) last = index;
        }
        return text.slice(0, lines[first].start) + section + text.slice(lines[last].end);
    }

    const before = headings.findIndex(found =>
        found && (AFTER_OFFSCREEN_KINDS.has(found.kind) || AFTER_OFFSCREEN_NAMES.has(found.name)));
    if (before !== -1) {
        const at = lines[before].start;
        return text.slice(0, at) + section + eol + text.slice(at);
    }

    if (!text) return section;
    return text.endsWith('\n') ? text + section + eol : text + eol + section;
}
