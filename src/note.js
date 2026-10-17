// Story Director: the injected note (pure).
//
// Turns a relevance Selection into the short system note injected before each reply: a
// header with the story time and place, what is due and arriving, the relevant records one
// line per kind, what not to reveal, corrections, and the instruction for writing change
// lines. The note keeps within a token budget by dropping the least relevant records.

import { estimateTokens } from './relevance.js';

// About 120 tokens. {{user}} stays a literal macro: SillyTavern substitutes it.
export const CHANGE_INSTRUCTION = [
    'End your reply with one <Director>…</Director> block of change lines, one per line:',
    '+ kind Key — part | label: value (new; kind: agenda, event, hook, clock, beat or secret)',
    '~ Key — label: value (change only what changed)',
    '- Key — reason (resolved)',
    '! Key — what happened (a due item fired)',
    'Fields: now, then, on, due, leg, arrive, shown. Dates go only in on, due and arrive.',
    'Write only changes, never the whole list. Never write actions for {{user}}.',
].join('\n');

// Kind lines, in the order the note shows them.
const KIND_LINES = [
    ['agenda', 'Off-screen'],
    ['event', 'World'],
    ['hook', 'Hooks'],
    ['clock', 'Clocks'],
    ['beat', 'Beats'],
];

const ITEM_SEPARATOR = ' · ';

export function buildNote(selection, {
    calendar,
    budgetTokens = 1000,
    corrections = [],
    instruction = CHANGE_INSTRUCTION,
} = {}) {
    const due = selection?.due ?? [];
    const arriving = selection?.arriving ?? [];
    const relevant = selection?.relevant ?? [];
    const secrets = selection?.secrets ?? [];
    const fixes = (corrections ?? []).map(item => typeof item === 'string' ? item : item?.message ?? '').filter(Boolean);

    // The model still needs to know how to add records when there are none yet.
    if (!due.length && !arriving.length && !relevant.length && !secrets.length && !fixes.length) {
        return instruction;
    }

    // relevant is sorted highest priority first, so the cheapest cut is from the end.
    let kept = relevant.length;
    let note = compose({ selection, calendar, due, arriving, relevant: relevant.slice(0, kept), secrets, fixes, instruction });
    while (kept > 0 && estimateTokens(note) > budgetTokens) {
        kept -= 1;
        note = compose({ selection, calendar, due, arriving, relevant: relevant.slice(0, kept), secrets, fixes, instruction });
    }
    return note;
}

function compose({ selection, calendar, due, arriving, relevant, secrets, fixes, instruction }) {
    const lines = [header(selection, calendar)];
    addLine(lines, 'Due now', due.map(dueItem));
    addLine(lines, 'Arriving', arriving.map(arrivalItem));
    for (const [kind, label] of KIND_LINES) {
        addLine(lines, label, relevant.filter(entry => entry.record.kind === kind).map(entry => recordItem(entry.record)));
    }
    // Secrets appear by key only, so the note never states them as facts.
    addLine(lines, 'Do not reveal', secrets.map(record => record.key), '; ');
    addLine(lines, 'Corrections', fixes);
    lines.push(instruction);
    return lines.join('\n');
}

function header(selection, calendar) {
    const parts = ['Story Director'];
    const now = selection?.now;
    if (calendar && typeof now === 'number' && Number.isFinite(now)) parts.push(calendar.format(now));
    if (selection?.place) parts.push(selection.place);
    return `[${parts.join(ITEM_SEPARATOR)}]`;
}

function addLine(lines, label, items, separator = ITEM_SEPARATOR) {
    const present = items.filter(Boolean);
    if (present.length) lines.push(`${label}: ${present.join(separator)}`);
}

// "Saartje's sale (Goldwane 16)", or with what is meant to happen: "Geva — files the warrant (Goldwane 17)".
function dueItem(record) {
    const f = record.fields ?? {};
    const when = record.kind === 'clock' ? f.due || f.on : f.on || f.due;
    const what = f.then || (record.kind === 'clock' ? f.desc : '');
    return `${record.key}${what ? ` — ${what}` : ''}${when ? ` (${when})` : ''}`;
}

// "Courier arrives Varnhold Watch (Goldwane 16, morning)".
function arrivalItem(record) {
    const f = record.fields ?? {};
    const where = destination(f.leg);
    return `${record.key} arrives${where ? ` ${where}` : ''}${f.arrive ? ` (${f.arrive})` : ''}`;
}

// "Geva — Bailiff Court → files the warrant (Goldwane 17)",
// "Hollin's Reach graves — the dead rise (Goldwane 28) · shown: sign".
function recordItem(record) {
    const f = record.fields ?? {};
    const body = [];
    const state = f.now || f.desc;
    if (state) body.push(state);
    const when = record.kind === 'clock' ? f.due : f.on;
    if (f.then) body.push(`${state ? '→ ' : ''}${f.then}${when ? ` (${when})` : ''}`);
    if (f.arrive) {
        const where = destination(f.leg);
        body.push(`${body.length ? '→ ' : ''}arrives${where ? ` ${where}` : ''} (${f.arrive})`);
    }

    let item = record.key + (body.length ? ` — ${body.join(' ')}` : '');
    // With no then, the date belongs to the record itself (a beat's on, a clock's due).
    if (when && !f.then) item += ` (${when})`;
    if (record.kind === 'clock' && f.shown && !/^none$/i.test(f.shown.trim())) item += `${ITEM_SEPARATOR}shown: ${f.shown}`;
    return item;
}

// The far end of a one-hop leg: "Shorn → Varnhold Watch 35 B, courier 70/day → 0.5" gives
// "Varnhold Watch" (the distance, road code and pace after it are not a place).
function destination(leg) {
    const hops = String(leg ?? '').split(/\s*(?:→|->)\s*/);
    if (hops.length < 2) return '';
    return hops[1].split(',')[0].replace(/\s+\d.*$/, '').trim();
}
