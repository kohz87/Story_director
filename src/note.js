// Story Director: the injected note (pure).
//
// Turns a relevance Selection into the short system note injected before each reply: a
// header with the story time and place, what is due and arriving, the relevant records one
// line per kind, what not to reveal, corrections, and the instruction for writing change
// lines. The note keeps within a token budget by dropping the least relevant records, and
// writes no part longer than NOTE_PART_WORDS (the tracker keeps the whole text).

import { questDifficulty } from './changes.js';
import { awayIn, estimateTokens } from './relevance.js';
import { looksFinished } from './tracker.js';

// About 165 tokens. {{user}} stays a literal macro: SillyTavern substitutes it.
export const CHANGE_INSTRUCTION = [
    'End your reply with one <Director>…</Director> block of change lines, one per line:',
    '+ kind Key — summary | label: value (new; kind: agenda, event, hook, quest, clock, beat or secret)',
    '~ Key — label: value (change only what changed)',
    '- Key — reason (resolved)',
    '! Key — what happened (a due item fired)',
    'Fields: now, then, on, due, leg, arrive, shown, encounter; a quest (a job {{user}} accepted, not an errand; a job only offered: + hook with giver, reward; done or failed: - it): type, giver, goal, reward, step, due, difficulty. Dates go only in on, due and arrive, with a clock time.',
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
// (0.9.19) After the While away list, about 20 tokens: what came due in a skipped stretch of
// time already happened, so the story tells its outcome rather than staging it now.
export const AWAY_CUE = 'Show what came of them as news, signs or aftermath, not as scenes {{user}} lived through.';
// Added only where the model writes change lines: about 10 tokens, 10 more with an arrival and
// 20 more with a passed deadline.
export const AWAY_RECORD = 'Record each with ! Key — what came of it.';
export const AWAY_ARRIVAL = 'An arrival: ~ Key — now: where it is.';
export const AWAY_DEADLINE = 'A passed deadline: - Key — failed, or ~ Key — due: later if it still stands.';

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
    // (0.9.19) A beat's reach, on Due now only: enough for one consequence and who it falls on.
    reach: 16,
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
 * before `text`, so joining them gives buildNote exactly. Labels: Header, While away, Due now,
 * Arriving, Off-screen, World, Hooks, Quests, Clocks, Beats (headed by the current arc), Do not reveal,
 * Corrections, Quest check, Abandoned, Slipped, Lapsed, Pacing, Encounter cue, Change
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
    previousTime = null,
    slipped = [],
    lapsed = [],
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
    const choices = (instruction && (givenUp?.length || taking?.length || declining?.length)) || abandoning?.length || slipped?.length || lapsed?.length;
    if (!due.length && !arriving.length && !relevant.length && !secrets.length && !fixes.length && !selection?.arc && !choices) {
        return asks;
    }

    // relevant is sorted highest priority first, so the cheapest cut is from the end.
    let kept = relevant.length;
    const build = () => compose({ selection, calendar, due, arriving, relevant: relevant.slice(0, kept), secrets, fixes, instruction, asks, givenUp, taking, declining, abandoning, away, slipped, lapsed });
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

function compose({ selection, calendar, due, arriving, relevant, secrets, fixes, instruction, asks, givenUp = [], taking = [], declining = [], abandoning = [], away = null, slipped = [], lapsed = [] }) {
    const parts = [part('Header', header(selection, calendar))];
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

// (0.9.19) "… · reach: the inn shuts for repairs": what a due beat changes for {{user}} wherever
// they are, so a story away from it has concrete aftermath to show rather than nothing. Due
// now only: a beat still ahead keeps its reach off the Beats line, so the note stays short and
// the story is not handed an aftermath before the beat has happened.
function withReach(item, record) {
    const reach = fieldOf(record, 'reach');
    return reach ? `${item}${ITEM_SEPARATOR}reach: ${reach}` : item;
}

// The compact form for the kind lines: the fight is planned, not happening yet.
function fightPart(record) {
    const foes = encounterOf(record);
    return foes ? `${ITEM_SEPARATOR}fight: ${foes}` : '';
}

// The arc is carried by its beats (0.9.3): its name and what it is about head the Beats line,
// "Beats — The Weir Debt (who sold the route): Toll riders reach the ford (Goldwane 19)", so
// the note has no separate arc line to weigh against them. With every beat due (on Due now)
// or none left, the line is the arc alone.
function addBeats(parts, arc, items) {
    const present = items.filter(Boolean);
    if (!arc) {
        addLine(parts, 'Beats', present);
        return;
    }
    const desc = notePart(fieldOf(arc, 'desc'), 'desc');
    const head = `Beats — ${arc.key}${desc ? ` (${desc})` : ''}`;
    parts.push(part('Beats', present.length ? `${head}: ${present.join(ITEM_SEPARATOR)}` : head));
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
function dueItem(record, clock = text => text) {
    const f = noteFields(record);
    // A quest's due is its deadline: reaching it means time ran out.
    if (record.kind === 'quest') return `${record.key} — deadline${f.due ? ` ${clock(f.due)}` : ''} reached${f.goal ? ` (${f.goal})` : ''}`;
    const when = record.kind === 'clock' ? f.due || f.on : f.on || f.due;
    const what = f.then || (record.kind === 'clock' ? f.desc : '');
    return `${record.key}${what ? ` — ${what}` : ''}${when ? ` (${when})` : ''}`;
}

// (0.9.19) "While away (Goldwane 12, 08:00 pm → Goldwane 15, 07:00 am): Stray Oar — sacked
// (Goldwane 13) · Bond collector reached Hollin's Reach (Goldwane 14) · Bounty — deadline
// Goldwane 14, 11:59 pm passed. Show what came of them …". A planned fight in the gap was fought
// off-screen. '' with nothing in the gap.
function awayPart(away, calendar, clock, instruction) {
    const items = [
        // A beat's reach is the aftermath to show: most needed here, where it happened unseen.
        ...(away?.due ?? []).map(record => withReach(withAwayFight(awayDueItem(record, clock), record), record)),
        ...(away?.arriving ?? []).filter(record => !(away?.due ?? []).includes(record)).map(record => withAwayFight(arrivalItem(record, 'reached'), record)),
    ].filter(Boolean);
    if (!items.length) return '';
    const span = `${calendar.format(away.from, { era: false })} → ${calendar.format(away.to, { era: false })}`;
    const record = instruction
        ? [AWAY_RECORD, away.arriving?.length ? AWAY_ARRIVAL : '', (away.due ?? []).some(entry => entry.kind === 'quest') ? AWAY_DEADLINE : '']
        : [];
    const list = items.join(ITEM_SEPARATOR);
    // A list ending in a trimmed part ("…") needs no full stop after it.
    return [`While away (${span}): ${list}${/[.…]$/u.test(list) ? '' : '.'}`, AWAY_CUE, ...record].filter(Boolean).join(' ');
}

// A due item as it reads in the past: a quest's deadline "passed", not "reached".
function awayDueItem(record, clock) {
    if (record.kind !== 'quest') return dueItem(record, clock);
    const f = noteFields(record);
    return `${record.key} — deadline${f.due ? ` ${clock(f.due)}` : ''} passed${f.goal ? ` (${f.goal})` : ''}`;
}

function withAwayFight(item, record) {
    const foes = encounterOf(record);
    return foes ? `${item} (fought off-screen: ${foes})` : item;
}

// "Courier arrives Varnhold Watch (Goldwane 16, morning)".
function arrivalItem(record, verb = 'arrives') {
    const f = noteFields(record);
    const where = destination(f.leg);
    // With nowhere to reach, an arrival in the past just "arrived".
    const said = where ? verb : verb === 'reached' ? 'arrived' : verb;
    return `${record.key} ${said}${where ? ` ${where}` : ''}${f.arrive ? ` (${f.arrive})` : ''}`;
}

// "Geva — Bailiff Court → files the warrant (Goldwane 17)",
// "Hollin's Reach graves — the dead rise (Goldwane 28) · shown: sign".
// "Bounty on Kettle Jack — bring him in alive · at: cornered at the weir · for Warden Hale · 40 crowns · by Haywane 30".
function questItem(record, clock = text => text) {
    const f = noteFields(record);
    const parts = [f.goal || f.desc, f.step ? `at: ${f.step}` : '', f.giver ? `for ${f.giver}` : '', f.reward, f.due ? `by ${clock(f.due)}` : '']
        .map(part => String(part ?? '').trim())
        .filter(Boolean);
    // A normal difficulty goes without saying; a set one rides with the type: "(bounty, hard)".
    const difficulty = questDifficulty(f.difficulty);
    const tags = [String(f.type ?? '').trim(), difficulty === 'normal' ? '' : difficulty].filter(Boolean);
    return record.key + (tags.length ? ` (${tags.join(', ')})` : '') + (parts.length ? ` — ${parts.join(ITEM_SEPARATOR)}` : '') + fightPart(record);
}

function recordItem(record, clock) {
    if (record.kind === 'quest') return questItem(record, clock);
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
