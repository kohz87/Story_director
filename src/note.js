// Story Director: the injected note (pure).
//
// Turns a relevance Selection into the short system note injected before each reply: a
// header with the story time and place, what is due and arriving, the relevant records one
// line per kind, what not to reveal, corrections, and the instruction for writing change
// lines. The note keeps within a token budget by dropping the least relevant records.

import { questDifficulty } from './changes.js';
import { estimateTokens } from './relevance.js';

// About 140 tokens. {{user}} stays a literal macro: SillyTavern substitutes it.
export const CHANGE_INSTRUCTION = [
    'End your reply with one <Director>…</Director> block of change lines, one per line:',
    '+ kind Key — part | label: value (new; kind: agenda, event, hook, quest, clock, beat or secret)',
    '~ Key — label: value (change only what changed)',
    '- Key — reason (resolved)',
    '! Key — what happened (a due item fired)',
    'Fields: now, then, on, due, leg, arrive, shown, encounter; a quest (only once {{user}} accepts it): type, giver, goal, reward, step, due, difficulty. Dates go only in on, due and arrive.',
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

export function buildNote(selection, {
    calendar,
    budgetTokens = 1000,
    corrections = [],
    instruction = CHANGE_INSTRUCTION,
    npcPlansOnly = false,
} = {}) {
    // Only where the model writes change lines: with none asked for, there is nothing to steer.
    if (npcPlansOnly && instruction) instruction = `${instruction}\n${NPC_PLANS_ONLY}`;
    const due = selection?.due ?? [];
    const arriving = selection?.arriving ?? [];
    const relevant = selection?.relevant ?? [];
    const secrets = selection?.secrets ?? [];
    const fixes = (corrections ?? []).map(item => typeof item === 'string' ? item : item?.message ?? '').filter(Boolean);

    // The model still needs to know how to add records when there are none yet.
    if (!due.length && !arriving.length && !relevant.length && !secrets.length && !fixes.length && !selection?.arc) {
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
    // The arc steers: its name and what it is about, so every reply leans the same way.
    const arc = selection?.arc;
    if (arc) lines.push(`Arc: ${arc.key}${arc.fields?.desc ? ` — ${arc.fields.desc}` : ''}`);
    addLine(lines, 'Due now', due.map(record => withFight(dueItem(record), record)));
    addLine(lines, 'Arriving', arriving.map(record => withFight(arrivalItem(record), record)));
    for (const [kind, label] of KIND_LINES) {
        addLine(lines, label, relevant.filter(entry => entry.record.kind === kind).map(entry => recordItem(entry.record)));
    }
    // Secrets appear by key only, so the note never states them as facts.
    addLine(lines, 'Do not reveal', secrets.map(record => record.key), '; ');
    addLine(lines, 'Corrections', fixes);
    if (scheduled(selection, due, arriving, relevant)) {
        const pacing = instruction ? PACING : PACING_NO_CHANGES;
        lines.push([...due, ...arriving].some(encounterOf) ? `${pacing} ${ENCOUNTER_CUE}` : pacing);
    }
    // No instruction when a capture call writes the changes instead of the model.
    if (instruction) lines.push(instruction);
    return lines.join('\n');
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
    return String(record?.fields?.encounter ?? '').trim();
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

function addLine(lines, label, items, separator = ITEM_SEPARATOR) {
    const present = items.filter(Boolean);
    if (present.length) lines.push(`${label}: ${present.join(separator)}`);
}

// "Saartje's sale (Goldwane 16)", or with what is meant to happen: "Geva — files the warrant (Goldwane 17)".
function dueItem(record) {
    const f = record.fields ?? {};
    // A quest's due is its deadline: reaching it means time ran out.
    if (record.kind === 'quest') return `${record.key} — deadline${f.due ? ` ${f.due}` : ''} reached${f.goal ? ` (${f.goal})` : ''}`;
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
// "Bounty on Kettle Jack — bring him in alive · at: cornered at the weir · for Warden Hale · 40 crowns · by Haywane 30".
function questItem(record) {
    const f = record.fields ?? {};
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
    return item + fightPart(record);
}

// The far end of a one-hop leg: "Shorn → Varnhold Watch 35 B, courier 70/day → 0.5" gives
// "Varnhold Watch" (the distance, road code and pace after it are not a place).
function destination(leg) {
    const hops = String(leg ?? '').split(/\s*(?:→|->)\s*/);
    if (hops.length < 2) return '';
    return hops[1].split(',')[0].replace(/\s+\d.*$/, '').trim();
}
