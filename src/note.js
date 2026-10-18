// Story Director: the injected note (pure).
//
// Turns a relevance Selection into the short system note injected before each reply: a
// header with the story time and place, what is due and arriving, the relevant records one
// line per kind, what not to reveal, corrections, and the instruction for writing change
// lines. The note keeps within a token budget by dropping the least relevant records, and
// writes no part longer than NOTE_PART_WORDS (the tracker keeps the whole text).

import { questDifficulty } from './changes.js';
import { estimateTokens } from './relevance.js';

// About 155 tokens. {{user}} stays a literal macro: SillyTavern substitutes it.
export const CHANGE_INSTRUCTION = [
    'End your reply with one <Director>…</Director> block of change lines, one per line:',
    '+ kind Key — summary | label: value (new; kind: agenda, event, hook, quest, clock, beat or secret)',
    '~ Key — label: value (change only what changed)',
    '- Key — reason (resolved)',
    '! Key — what happened (a due item fired)',
    'Fields: now, then, on, due, leg, arrive, shown, encounter; a quest (only once {{user}} accepts it; a hook they take on: ~ it with these; done or failed: - it): type, giver, goal, reward, step, due, difficulty. Dates go only in on, due and arrive.',
    'Write only changes, never the whole list. Never write actions for {{user}}.',
].join('\n');

// How a schedule meets a scene, about 70 tokens; only when something is scheduled. Without
// it a model handed "Due now: the warrant is filed" tends to stop the scene and stage it.
export const PACING = [
    'Pacing: the world keeps its schedule and the scene keeps its flow. Bring a due item in only where it fits: on-screen if {{user}} is there to see it, otherwise later as news, signs or aftermath.',
    'Never cut into or bend the current scene for a beat, and never decide what {{user}} does. What cannot fit yet happens off-screen (!) or slips (~ on: later).',
].join(' ');
// The same, when a capture call writes the changes and the model writes none.
export const PACING_NO_CHANGES = PACING.replace(/ What cannot fit yet happens off-screen \(!\) or slips \(~ on: later\)\./, ' What cannot fit yet can happen off-screen or later.');
// Added to the Pacing line only while a due or arriving record carries an encounter, about 35
// tokens. The fight is resolved in code by another extension (RPG Battle); a storyteller left
// alone would narrate the whole fight and decide how it ends, so it stops at the first blow.
export const ENCOUNTER_CUE = 'A due fight starts when the scene reaches it: show the foes appear and stop at the first blow; the fight is resolved outside the story.';
// While NPC State Delta is the source of truth for who an NPC is (Story Suite, area `npc`),
// about 20 tokens after the instruction (and in the planner's and capture's request), so an
// agenda never restates a dossier the reader keeps there.
export const NPC_PLANS_ONLY = 'NPC State Delta keeps who each NPC is: agenda lines give only what they plan and when.';

// Kind lines, in the order the note shows them.
const KIND_LINES = [
    ['agenda', 'Off-screen'],
    ['event', 'World'],
    ['hook', 'Hooks'],
    ['quest', 'Quests'],
    ['clock', 'Clocks'],
    ['beat', 'Beats'],
];

const ITEM_SEPARATOR = ' · ';

// The most words of one part the note writes (v0.8.4): what a record is doing and when in 12,
// what it is (desc, a quest's goal, step, giver and reward, the foes of a fight) in 16. A longer
// part ends in "…" in the note only; the tracker, the tabs and the API keep every word.
export const NOTE_PART_WORDS = Object.freeze({
    now: 12, then: 12, on: 12, due: 12, arrive: 12,
    desc: 16, goal: 16, step: 16, reward: 16, giver: 16, encounter: 16, type: 16, shown: 16,
});
const DEFAULT_PART_WORDS = 16;
const ELLIPSIS = '…';

/**
 * `text` as the note writes it for `field`: trimmed, and cut after the field's word limit at a
 * word boundary with "…". A cut that would leave a bracket open goes back to before it, when
 * words are left; trailing commas, semicolons and dashes go.
 */
export function notePart(text, field) {
    const value = String(text ?? '').trim();
    const limit = NOTE_PART_WORDS[field] ?? DEFAULT_PART_WORDS;
    const words = value.split(/\s+/).filter(Boolean);
    if (words.length <= limit) return value;
    let kept = words.slice(0, limit);
    const open = kept.reduce((last, word, index) => {
        const opens = (word.match(/[([]/g) ?? []).length;
        const closes = (word.match(/[)\]]/g) ?? []).length;
        return opens > closes ? index : closes > opens ? -1 : last;
    }, -1);
    if (open > 0) kept = kept.slice(0, open);
    return `${kept.join(' ').replace(/[\s,;:—–-]+$/u, '')}${ELLIPSIS}`;
}

// A record's field as the note writes it.
function fieldOf(record, field) {
    return notePart(record?.fields?.[field], field);
}

// What the model is allowed for writing the change lines the instruction asks for, in tokens:
// the two tags and about two lines of 20 to 25 tokens, a usual reply's worth. A rough
// allowance for the reader, not a limit.
export const DIRECTOR_OUTPUT_TOKENS = 60;

export function buildNote(selection, options = {}) {
    return joinParts(noteParts(selection, options));
}

/**
 * The note in its sections, `[{ label, text, join }]`, in order; `join` ('\n' or ' ') goes
 * before `text`, so joining them gives buildNote exactly. Labels: Header, Arc, Due now,
 * Arriving, Off-screen, World, Hooks, Quests, Clocks, Beats, Do not reveal, Corrections,
 * Pacing, Encounter cue, Change instruction, NPC plans only.
 */
export function noteParts(selection, {
    calendar,
    budgetTokens = 1000,
    corrections = [],
    instruction = CHANGE_INSTRUCTION,
    npcPlansOnly = false,
} = {}) {
    // Only where the model writes change lines: with none asked for, there is nothing to steer.
    const asks = [];
    if (instruction) asks.push(part('Change instruction', instruction));
    if (npcPlansOnly && instruction) asks.push(part('NPC plans only', NPC_PLANS_ONLY));
    const due = selection?.due ?? [];
    const arriving = selection?.arriving ?? [];
    const relevant = selection?.relevant ?? [];
    const secrets = selection?.secrets ?? [];
    const fixes = (corrections ?? []).map(item => typeof item === 'string' ? item : item?.message ?? '').filter(Boolean);

    // The model still needs to know how to add records when there are none yet.
    if (!due.length && !arriving.length && !relevant.length && !secrets.length && !fixes.length && !selection?.arc) {
        return asks;
    }

    // relevant is sorted highest priority first, so the cheapest cut is from the end.
    let kept = relevant.length;
    const build = () => compose({ selection, calendar, due, arriving, relevant: relevant.slice(0, kept), secrets, fixes, instruction, asks });
    let parts = build();
    while (kept > 0 && estimateTokens(joinParts(parts)) > budgetTokens) {
        kept -= 1;
        parts = build();
    }
    return parts;
}

/**
 * The tokens (≈ 4 characters each) a note adds to the next reply: `input` the note's parts,
 * `output` DIRECTOR_OUTPUT_TOKENS for the change lines while it asks for them (on its Change
 * instruction part), 0 when it does not (a capture call writes them, and is not counted).
 * Plain `{ input, output, parts: [{ label, input, output }] }`.
 */
export function noteTokens(parts, { outputTokens = DIRECTOR_OUTPUT_TOKENS } = {}) {
    const allowance = Number(outputTokens) >= 0 ? Math.round(Number(outputTokens)) : DIRECTOR_OUTPUT_TOKENS;
    const counted = (Array.isArray(parts) ? parts : [])
        .filter(entry => entry && String(entry.text ?? ''))
        .map(entry => ({
            label: String(entry.label ?? ''),
            input: estimateTokens(entry.text),
            output: entry.label === 'Change instruction' ? allowance : 0,
        }));
    return {
        input: counted.reduce((sum, entry) => sum + entry.input, 0),
        output: counted.reduce((sum, entry) => sum + entry.output, 0),
        parts: counted,
    };
}

function part(label, text, join = '\n') {
    return { label, text, join };
}

function joinParts(parts) {
    return parts.map((entry, index) => (index ? entry.join : '') + entry.text).join('');
}

function compose({ selection, calendar, due, arriving, relevant, secrets, fixes, instruction, asks }) {
    const parts = [part('Header', header(selection, calendar))];
    // The arc steers: its name and what it is about, so every reply leans the same way.
    const arc = selection?.arc;
    const arcDesc = fieldOf(arc, 'desc');
    if (arc) parts.push(part('Arc', `Arc: ${arc.key}${arcDesc ? ` — ${arcDesc}` : ''}`));
    addLine(parts, 'Due now', due.map(record => withFight(dueItem(record), record)));
    addLine(parts, 'Arriving', arriving.map(record => withFight(arrivalItem(record), record)));
    for (const [kind, label] of KIND_LINES) {
        addLine(parts, label, relevant.filter(entry => entry.record.kind === kind).map(entry => recordItem(entry.record)));
    }
    // Secrets appear by key only, so the note never states them as facts.
    addLine(parts, 'Do not reveal', secrets.map(record => record.key), '; ');
    addLine(parts, 'Corrections', fixes);
    if (scheduled(selection, due, arriving, relevant)) {
        parts.push(part('Pacing', instruction ? PACING : PACING_NO_CHANGES));
        if ([...due, ...arriving].some(encounterOf)) parts.push(part('Encounter cue', ENCOUNTER_CUE, ' '));
    }
    // No instruction when a capture call writes the changes instead of the model.
    return [...parts, ...asks];
}

// Anything with a date or a plan behind it: an arc, something due or arriving, a beat or a
// clock, or a record with a next step.
function scheduled(selection, due, arriving, relevant) {
    if (selection?.arc || due.length || arriving.length) return true;
    return relevant.some(({ record }) => record.kind === 'beat' || record.kind === 'clock' || Boolean(record.fields?.then)
        || (record.kind === 'quest' && Boolean(record.fields?.due)));
}

function header(selection, calendar) {
    const parts = ['Story Director'];
    const now = selection?.now;
    if (calendar && typeof now === 'number' && Number.isFinite(now)) parts.push(calendar.format(now));
    if (selection?.place) parts.push(selection.place);
    return `[${parts.join(ITEM_SEPARATOR)}]`;
}

// The foes of a planned fight, as written ('' for a record that is not one).
function encounterOf(record) {
    return fieldOf(record, 'encounter');
}

// "Ambush at the weir (Haywane 14) (fight: 3 bandit, bandit captain (boss))": a due fight
// says who is coming, so the storyteller can bring them on.
function withFight(item, record) {
    const foes = encounterOf(record);
    return foes ? `${item} (fight: ${foes})` : item;
}

// The compact form for the kind lines: the fight is planned, not happening yet.
function fightPart(record) {
    const foes = encounterOf(record);
    return foes ? `${ITEM_SEPARATOR}fight: ${foes}` : '';
}

function addLine(parts, label, items, separator = ITEM_SEPARATOR) {
    const present = items.filter(Boolean);
    if (present.length) parts.push(part(label, `${label}: ${present.join(separator)}`));
}

// The record's fields as the note writes them, each within its word limit. The leg stays
// whole: only its destination is shown, and it is read from the full text.
function noteFields(record) {
    const fields = record?.fields ?? {};
    return Object.fromEntries(Object.entries(fields).map(([name, value]) => [name, name === 'leg' ? value : notePart(value, name)]));
}

// "Saartje's sale (Goldwane 16)", or with what is meant to happen: "Geva — files the warrant (Goldwane 17)".
function dueItem(record) {
    const f = noteFields(record);
    // A quest's due is its deadline: reaching it means time ran out.
    if (record.kind === 'quest') return `${record.key} — deadline${f.due ? ` ${f.due}` : ''} reached${f.goal ? ` (${f.goal})` : ''}`;
    const when = record.kind === 'clock' ? f.due || f.on : f.on || f.due;
    const what = f.then || (record.kind === 'clock' ? f.desc : '');
    return `${record.key}${what ? ` — ${what}` : ''}${when ? ` (${when})` : ''}`;
}

// "Courier arrives Varnhold Watch (Goldwane 16, morning)".
function arrivalItem(record) {
    const f = noteFields(record);
    const where = destination(f.leg);
    return `${record.key} arrives${where ? ` ${where}` : ''}${f.arrive ? ` (${f.arrive})` : ''}`;
}

// "Geva — Bailiff Court → files the warrant (Goldwane 17)",
// "Hollin's Reach graves — the dead rise (Goldwane 28) · shown: sign".
// "Bounty on Kettle Jack — bring him in alive · at: cornered at the weir · for Warden Hale · 40 crowns · by Haywane 30".
function questItem(record) {
    const f = noteFields(record);
    const parts = [f.goal || f.desc, f.step ? `at: ${f.step}` : '', f.giver ? `for ${f.giver}` : '', f.reward, f.due ? `by ${f.due}` : '']
        .map(part => String(part ?? '').trim())
        .filter(Boolean);
    // A normal difficulty goes without saying; a set one rides with the type: "(bounty, hard)".
    const difficulty = questDifficulty(f.difficulty);
    const tags = [String(f.type ?? '').trim(), difficulty === 'normal' ? '' : difficulty].filter(Boolean);
    return record.key + (tags.length ? ` (${tags.join(', ')})` : '') + (parts.length ? ` — ${parts.join(ITEM_SEPARATOR)}` : '') + fightPart(record);
}

function recordItem(record) {
    if (record.kind === 'quest') return questItem(record);
    const f = noteFields(record);
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
    return item + fightPart(record);
}

// The far end of a one-hop leg: "Shorn → Varnhold Watch 35 B, courier 70/day → 0.5" gives
// "Varnhold Watch" (the distance, road code and pace after it are not a place).
function destination(leg) {
    const hops = String(leg ?? '').split(/\s*(?:→|->)\s*/);
    if (hops.length < 2) return '';
    return hops[1].split(',')[0].replace(/\s+\d.*$/, '').trim();
}
