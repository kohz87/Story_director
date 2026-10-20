// Off-Screen mirror: writes the tracker's active agendas back into the stored World_State
// block as its Off-Screen section, for readers who keep that section in Story Block's block.
// Only that section changes; every byte outside it is kept as it was. Pure.

import { lineKey } from './changes.js';
import { readHeading } from './seed.js';

const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
// Sections that come after Off-Screen in a World_State block; a new section goes before them.
const AFTER_OFFSCREEN_KINDS = new Set(['event', 'hook', 'clock']);
const AFTER_OFFSCREEN_NAMES = new Set(['arcphase', 'scenephase']);
// (0.9.31) One short line per agenda, read like the story's own: what they are doing, when they
// arrive, and what they do next (and when). The leg's arithmetic (Shorn → Auvoth 70 F, wagon
// 14/day → 5) stays in the tracker and the Director tab: travel is checked in code, and it made
// each line a wall of labels. "* Courier — rides south from Shorn; arrives Haywane 13, morning;
// next: delivers the writ".
function agendaLine(record) {
    const fields = record.fields ?? {};
    const text = name => String(fields[name] ?? '').trim();
    // An agenda seeded from `* Key: desc` has no `now`; its one line of state is the desc.
    const now = text('now') || text('desc');
    const arrive = text('arrive');
    const then = text('then');
    const on = text('on');
    const onArrival = Boolean(on && arrive && on === arrive);
    const when = on && !onArrival ? on : '';
    const parts = [];
    if (now) parts.push(now);
    if (arrive) parts.push(`arrives ${arrive}`);
    if (then) parts.push(`${onArrival ? 'next, on arrival' : 'next'}: ${then}${when ? ` (${when})` : ''}`);
    else if (when) parts.push(`on ${when}`);
    return parts.length ? `* ${record.key} — ${parts.join('; ')}` : `* ${record.key}`;
}

// (0.9.26) "* Jor — crying in the granary alley": the name a story line starts with.
const STORY_LINE = /^\s*[-*•]\s+\**\s*([^—–:*]+?)\s*\**\s*(?:—|–|-\s|:)/u;
const NONE_LINE = /^\s*[-*•]?\s*[*_(\[]*\s*(?:none|nobody|no one)\s*[)\]*_.]*\s*$/i;

function sectionLines(agendas, heading, storyLines = []) {
    const active = (agendas ?? []).filter(record =>
        (record.status ?? 'active') === 'active' && (record.kind ?? 'agenda') === 'agenda');
    // (0.9.26) The story's own lines for people the tracker has no agenda for stay, after the
    // agendas: who else is off-screen and what they are doing is the story's, not ours to drop.
    // Every agenda the tracker knows, closed ones too: those lines are the tracker's to drop.
    const tracked = new Set((agendas ?? []).filter(record => (record.kind ?? 'agenda') === 'agenda')
        .flatMap(record => [lineKey(record.key), ...(record.aliases ?? [])]).filter(Boolean));
    const kept = storyLines.filter(line => {
        const name = STORY_LINE.exec(line)?.[1];
        return name && !NONE_LINE.test(line) && !tracked.has(lineKey(name));
    });
    const body = [...active.map(agendaLine), ...kept];
    return [heading, ...(body.length ? body : ['* None'])];
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
        const storyLines = lines.slice(first + 1, last + 1).map(({ line }) => line.replace(/\r$/, '')).filter(line => line.trim());
        const section = sectionLines(agendas, heading, storyLines).join(eol);
        return text.slice(0, lines[first].start) + section + text.slice(lines[last].end);
    }
    const section = sectionLines(agendas, heading).join(eol);

    const before = headings.findIndex(found =>
        found && (AFTER_OFFSCREEN_KINDS.has(found.kind) || AFTER_OFFSCREEN_NAMES.has(found.name)));
    if (before !== -1) {
        const at = lines[before].start;
        return text.slice(0, at) + section + eol + text.slice(at);
    }

    if (!text) return section;
    return text.endsWith('\n') ? text + section + eol : text + eol + section;
}
