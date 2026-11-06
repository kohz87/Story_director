// Story Director: the injected note (pure).
//
// Turns a relevance Selection into the short system note injected before each reply: a
// header with the story time and place, what is due and arriving, the relevant records one
// line per kind, what not to reveal, corrections, and the instruction for writing change
// lines. The note keeps within a token budget by dropping the least relevant records, and
// writes no part longer than NOTE_PART_WORDS (the tracker keeps the whole text).
//
// This path stays the public facade: fixed text, formatting, item lines and header/distance
// helpers moved to small note-*.js files.

import { awayIn, estimateTokens } from './relevance.js';
import { looksFinished } from './tracker.js';
import { CHANGE_INSTRUCTION, ENCOUNTER_CUE, NPC_PLANS_ONLY, PACING, PACING_NO_CHANGES } from './note-text.js';
import { ITEM_SEPARATOR, notePart, part } from './note-format.js';
import { addBeats, addLine, arrivalItem, awayPart, dueItem, encounterOf, recordItem, withFight, withReach } from './note-items.js';
import { distancesLine, header, noWeekLine } from './note-extra.js';

export { CHANGE_INSTRUCTION, PACING, PACING_NO_CHANGES, ENCOUNTER_CUE, NPC_PLANS_ONLY, AWAY_CUE, AWAY_RECORD, AWAY_ARRIVAL, AWAY_DEADLINE } from './note-text.js';
export { NOTE_PART_WORDS, notePart } from './note-format.js';
export { DISTANCES_OFF, NO_WEEKDAYS, noteHeader } from './note-extra.js';

// Kind lines, in the order the note shows them.
const KIND_LINES = [
    ['agenda', 'Off-screen'],
    ['event', 'World'],
    ['hook', 'Hooks'],
    ['quest', 'Quests'],
    ['clock', 'Clocks'],
    ['beat', 'Beats'],
];

export const DIRECTOR_OUTPUT_TOKENS = 60;

export function buildNote(selection, options = {}) {
    return joinParts(noteParts(selection, options));
}

// (0.9.38) Cache-friendly: the parts that never change from reply to reply (the change
// instruction, the NPC plans line, Pacing) go early in the prompt, byte-identical every reply,
// so a provider's prompt cache keeps them; the rest of the note goes at the end, for this reply.
export const STATIC_LABELS = Object.freeze(['Change instruction', 'NPC plans only', 'Pacing']);

/**
 * The note's fixed part: the change instruction (when the model writes change lines), the NPC
 * plans line (while NPC State Delta keeps the NPCs), and Pacing, always (it used to come only
 * when something was scheduled; a part that comes and goes would break the cached prefix).
 */
export function staticNote({ instruction = CHANGE_INSTRUCTION, npcPlansOnly = false } = {}) {
    return [
        instruction,
        npcPlansOnly && instruction ? NPC_PLANS_ONLY : '',
        instruction ? PACING : PACING_NO_CHANGES,
    ].filter(Boolean).join('\n');
}

/**
 * (0.9.38) `messages` (a chat completion's) with `fixed` in them: as they are when some message
 * already holds it, else with it as a system message after the leading system messages, still
 * early and in the same place every reply. SillyTavern drops in-prompt extension prompts when the
 * preset's Main Prompt is missing from its prompt order; this keeps the instruction then. A new
 * array when it adds. (0.9.41) `story`: the chat has replies, so the story's own prompt carries
 * some; a call without any (another extension's scan or summary while the reply is generated, a
 * generateRaw) is left alone.
 */
export function withFixedNote(messages, fixed, { story = false } = {}) {
    const text = String(fixed ?? '').trim();
    if (!text || !Array.isArray(messages)) return messages;
    if (story && !messages.some(message => message?.role === 'assistant')) return messages;
    if (messages.some(message => typeof message?.content === 'string' && message.content.includes(text))) return messages;
    let at = 0;
    while (at < messages.length && messages[at]?.role === 'system') at += 1;
    return [...messages.slice(0, at), { role: 'system', content: text }, ...messages.slice(at)];
}

/** The note's part for this reply alone: noteParts without the fixed ones ('' when nothing is left). */
export function tailNote(parts) {
    const kept = (parts ?? []).filter(entry => !STATIC_LABELS.includes(entry.label));
    // The encounter cue used to follow Pacing on its line; it starts its own now.
    return joinParts(kept.map(entry => (entry.label === 'Encounter cue' ? { ...entry, join: '\n' } : entry)));
}

/**
 * The note in its sections, `[{ label, text, join }]`, in order; `join` ('\n' or ' ') goes
 * before `text`, so joining them gives buildNote exactly. Labels: Header, No weekdays, While away, Due now,
 * Arriving, Off-screen, World, Hooks, Quests, Clocks, Beats (headed by the current arc), Do not reveal,
 * Corrections, Quest check, Abandoned, Slipped, Lapsed, Distances, Pacing, Encounter cue, Change
 * instruction, NPC plans only.
 *
 * `offscreenInBlock` (0.9.3): the scene block's Off-Screen section already carries every active
 * agenda (Story Director mirrors it there and keeps the timeline), so the note leaves its
 * Off-screen line out; an agenda due or arriving is still on Due now / Arriving.
 *
 * `previousTime` (0.9.19): the story time before the latest reply. When the selection's now is
 * at least AWAY_GAP_MINUTES past it, what came due or arrived in between goes on one While away
 * line (relevance.js awayIn) and not on Due now / Arriving.
 * `slipped` and `lapsed` (0.9.19): what the latest reply closed because time ran past it, as
 * `[{ key, on, giver }]` (lapses.lapsesIn): beats that slipped, offers that lapsed.
 */
export function noteParts(selection, {
    calendar,
    budgetTokens = 1000,
    corrections = [],
    instruction = CHANGE_INSTRUCTION,
    npcPlansOnly = false,
    offscreenInBlock = false,
    givenUp = [],
    taking = [],
    declining = [],
    abandoning = [],
    takingOn = [],
    turningDown = [],
    previousTime = null,
    slipped = [],
    lapsed = [],
    distances = [],
    distanceFrom = '',
} = {}) {
    // Only where the model writes change lines: with none asked for, there is nothing to steer.
    const asks = [];
    if (instruction) asks.push(part('Change instruction', instruction));
    if (npcPlansOnly && instruction) asks.push(part('NPC plans only', NPC_PLANS_ONLY));
    const due = selection?.due ?? [];
    const arriving = selection?.arriving ?? [];
    const relevant = (selection?.relevant ?? []).filter(entry => !(offscreenInBlock && entry?.record?.kind === 'agenda'));
    const secrets = selection?.secrets ?? [];
    const fixes = (corrections ?? []).map(item => typeof item === 'string' ? item : item?.message ?? '').filter(Boolean);
    const away = awayIn(selection, { calendar, from: previousTime });

    // The model still needs to know how to add records when there are none yet.
    const choices = (instruction && (givenUp?.length || taking?.length || declining?.length)) || abandoning?.length || takingOn?.length || turningDown?.length || slipped?.length || lapsed?.length || (distances?.length && distanceFrom);
    if (!due.length && !arriving.length && !relevant.length && !secrets.length && !fixes.length && !selection?.arc && !choices) {
        return asks;
    }

    // relevant is sorted highest priority first, so the cheapest cut is from the end.
    let kept = relevant.length;
    const build = () => compose({ selection, calendar, due, arriving, relevant: relevant.slice(0, kept), secrets, fixes, instruction, asks, givenUp, taking, declining, abandoning, takingOn, turningDown, away, slipped, lapsed, distances, distanceFrom });
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

function joinParts(parts) {
    return parts.map((entry, index) => (index ? entry.join : '') + entry.text).join('');
}

function compose({ selection, calendar, due, arriving, relevant, secrets, fixes, instruction, asks, givenUp = [], taking = [], declining = [], abandoning = [], takingOn = [], turningDown = [], away = null, slipped = [], lapsed = [], distances = [], distanceFrom = '' }) {
    const parts = [part('Header', header(selection, calendar))];
    const noWeek = noWeekLine(selection, calendar);
    if (noWeek) parts.push(part('No weekdays', noWeek, ' '));
    // (0.9.12) A quest deadline goes out at a clock time the calendar sets, never "evening".
    const now = typeof selection?.now === 'number' && Number.isFinite(selection.now) ? selection.now : null;
    const clock = text => (text && typeof calendar?.withClock === 'function' ? calendar.withClock(text, { reference: now }) : text);
    // (0.9.19) What came due while the story skipped ahead is told once, as a recap, and not
    // again on Due now / Arriving.
    const awayDue = new Set(away?.due ?? []);
    const awayArriving = new Set(away?.arriving ?? []);
    const awayLine = awayPart(away, calendar, clock, instruction);
    if (awayLine) parts.push(part('While away', awayLine));
    const dueNow = due.filter(record => !awayDue.has(record));
    const arrivingNow = arriving.filter(record => !awayArriving.has(record));
    addLine(parts, 'Due now', dueNow.map(record => withReach(withFight(dueItem(record, clock), record), record)));
    addLine(parts, 'Arriving', arrivingNow.map(record => withFight(arrivalItem(record), record)));
    for (const [kind, label] of KIND_LINES) {
        const items = relevant.filter(entry => entry.record.kind === kind).map(entry => recordItem(entry.record, clock));
        if (kind === 'beat') addBeats(parts, selection?.arc, items);
        else addLine(parts, label, items);
    }
    // Secrets appear by key only, so the note never states them as facts.
    addLine(parts, 'Do not reveal', secrets.map(record => record.key), '; ');
    addLine(parts, 'Corrections', fixes);
    // (0.9.5) An open quest whose progress reads as over: the story is asked to close it, never
    // closed for it. Only where the model writes change lines.
    // (0.9.6) And one the latest exchange says {{user}} gave up: the story closes it as abandoned.
    // (0.9.15) Read from the reader's message only, as are an offer taken on or turned down:
    // the choices are theirs, the lines that record them the story's.
    const ended = instruction ? [...new Set([...due, ...relevant.map(entry => entry.record)].filter(looksFinished).map(record => record.key))] : [];
    const dropped = instruction ? [...new Set(givenUp ?? [])].filter(key => !ended.includes(key)) : [];
    const checks = [
        ended.length ? `the story may have finished ${ended.join(', ')}. If it has, close it with - Key — outcome; if not, leave it.` : '',
        dropped.length ? `{{user}} may be giving up ${dropped.join(', ')}. If they do, close it with - Key — abandoned; if not, leave it.` : '',
        instruction && taking?.length ? `{{user}} may be taking on ${[...new Set(taking)].join(', ')}. If they do, write + quest Key with its parts (no - line for the hook); if not, leave it an offer.` : '',
        instruction && declining?.length ? `{{user}} may be turning down ${[...new Set(declining)].join(', ')}. If they do, close it with - Key — declined; if not, leave it.` : '',
    ].filter(Boolean);
    if (checks.length) parts.push(part('Quest check', `Quest check: ${checks.join(' Also: ')}`));
    // (0.9.15) The reader gave a quest up with the Abandon flag: told behind the scenes, like a
    // fight's hand-off. The reply records it whether or not the story writes the line.
    const giving = [...new Set(abandoning ?? [])];
    if (giving.length) {
        parts.push(part('Abandoned', `Abandoned: {{user}} gives up ${giving.join(', ')}. Show it in this reply${instruction ? ', and close each with - Key — abandoned' : ''}.`));
    }
    // (0.9.33) Offers the reader took on or turned down with the Quests tab's buttons, told the
    // same way: the choice is made, the reply shows it in the story's own voice.
    const takes = [...new Set(takingOn ?? [])];
    if (takes.length) {
        parts.push(part('Taken on', `Taken on: {{user}} takes on ${takes.join(', ')}. Show it in this reply as part of the scene, in the story's own voice${instruction ? ', and write ~ Key — accepted for each' : ''}.`));
    }
    const refusals = [...new Set(turningDown ?? [])];
    if (refusals.length) {
        parts.push(part('Turned down', `Turned down: {{user}} turns down ${refusals.join(', ')}. Show it in this reply${instruction ? ', and close each with - Key — declined' : ''}.`));
    }
    // (0.9.19) What time closed in the latest reply, told once, in the note right after it: the
    // story need not stage a beat that slipped or a job that went to someone else, only not
    // contradict it.
    const slips = lapseItems(slipped, entry => `${entry.key}${entry.on ? ` (${notePart(entry.on, 'on')})` : ''}`);
    if (slips.length) {
        const one = slips.length === 1;
        parts.push(part('Slipped', `Slipped: ${slips.join(', ')} — ${one ? 'it' : 'they'} happened off-screen or not at all; mention ${one ? 'it' : 'them'} only where ${one ? 'it fits' : 'they fit'}.`));
    }
    const lapses = lapseItems(lapsed, entry => `${entry.key}${giverName(entry.giver) ? ` (${giverName(entry.giver)}'s offer)` : ''}`);
    if (lapses.length) {
        const givers = [...new Set(lapsed.map(entry => giverName(entry?.giver)).filter(Boolean))];
        const who = lapses.length === 1 ? givers[0] || '' : '';
        const after = who ? `${who} may mention it` : lapses.length === 1 ? 'it may come up in passing' : 'whoever offered them may mention it';
        parts.push(part('Lapsed', `Lapsed: ${lapses.join(', ')} went to someone else; ${after}.`));
    }
    const distanceLine = distancesLine(distances, distanceFrom);
    if (distanceLine) parts.push(part('Distances', distanceLine));
    if (scheduled(selection, due, arriving, relevant)) {
        parts.push(part('Pacing', instruction ? PACING : PACING_NO_CHANGES));
        // A fight on the While away line already happened off-screen: no first blow to stop at.
        if ([...dueNow, ...arrivingNow].some(encounterOf)) parts.push(part('Encounter cue', ENCOUNTER_CUE, ' '));
    }
    // No instruction when a capture call writes the changes instead of the model.
    return [...parts, ...asks];
}

// One item per record, once each by key.
function lapseItems(entries, item) {
    const seen = new Set();
    return (entries ?? []).filter(entry => {
        const key = String(entry?.key ?? '').trim();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    }).map(item);
}

// A giver by name only: "Danique, the rat-catcher's widow" is Danique.
function giverName(giver) {
    return notePart(String(giver ?? '').split(/[,(;—–]/)[0], 'giver');
}

// Anything with a date or a plan behind it: an arc, something due or arriving, a beat or a
// clock, or a record with a next step.
function scheduled(selection, due, arriving, relevant) {
    if (selection?.arc || due.length || arriving.length) return true;
    return relevant.some(({ record }) => record.kind === 'beat' || record.kind === 'clock' || Boolean(record.fields?.then)
        || (record.kind === 'quest' && Boolean(record.fields?.due)));
}
