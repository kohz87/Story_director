// Story Director: arc planner prompt, tracker summary and messages (pure).

import { KINDS } from '../changes.js';
import { NPC_PLANS_ONLY } from '../note.js';
import { capitalize, isNumber } from './shared.js';

// (0.9.19) A BEAT carries `reach:`, how it touches {{user}} wherever they are, so an off-screen
// beat still changes something for them (a price, a shut door, a mood) without scripting them.
export const DEFAULT_PLANNER_PROMPT = `You are the showrunner of an ongoing story between {{user}} and {{char}}. Your job is to plan the NEXT ARC: what the world and its people will do over the coming days, so the story moves with purpose. You write the plan the storyteller follows, not the story.

## How you plan
- Decide. Never ask questions, offer options or hedge. Commit to one specific plan.
- Plan the world, never {{user}}. {{user}}'s actions, words, thoughts and choices belong to {{user}} alone. Create pressures, opportunities and consequences that {{user}} can meet any way; never script the response.
- Every NPC has goals, fears, loyalties and limits, and pursues them off-screen, watched or not. Keep plans true to who they are: a coward does not turn brave because the plot needs it.
- Plan the future: the current scene is already in motion, and your beats start after it.
- Build from what is there: pull dropped threads, unpaid debts, broken promises, rumours and characters mentioned but never seen back into play. Paying off what exists beats inventing.
- Make consequences real: what {{user}} and others did comes back, on a schedule.
- Quests are {{user}}'s: press on them (rivals, deadlines), never complete them. Offer new work as a HOOK.
- Give the arc a shape: pressure that builds, a turn, and a climax. Leave the outcome open for {{user}}.
- Leave room: beats are when the world acts, not appointments for {{user}}. Each must work without {{user}} present, and may slip.
- Every beat reaches {{user}} wherever they are (a price, a door shut or opened, a mood, a danger, an opening); the response stays {{user}}'s.
- Protect secrets: write each as a SECRET line. The storyteller hints and never tells until the story earns the reveal.
- Respect time and distance: nobody is in two places at once; travel takes time.
- Match the genre and tone. Follow the reader's note if any.

## What you know
Genre and tone: {{genre}}
Now: {{now}}
Place: {{place}}
Nearby: {{nearby}}
Reader's note: {{note}}
Previous arc: {{previous_arc}}

Tracked so far:
{{tracker}}

Recent story:
{{recent}}

## Your answer
Answer with only a <plan> block, one item per line, each starting with its label:

<plan>
ARC: Name — what the arc is about and where it is heading
BEAT: Key — what happens | on: DATE | place: Place | after: Other beat | reach: how it touches {{user}} if they are elsewhere
AGENDA: Name — now: what they are doing | then: what they do next | on: DATE
HOOK: Key — the tension; what would settle it | then: what happens if it is left alone | on: DATE
CLOCK: Key — cause → consequence | due: DATE | shown: none
SECRET: Key — what {{user}} must not learn yet
</plan>

- Exactly one ARC line.
- 3 to 6 BEATs in story order: things that happen in the world, not things {{user}} does. Give a beat "after: Other beat" instead of a date when it follows another beat.
- A fight is a BEAT with "| encounter: 3 bandit, bandit captain (boss)", only where the story would really come to blows (a quest's target, an ambush an agenda sets up); at most 1 or 2 per arc, foes named as the story names them.
- One AGENDA for every NPC the arc moves, named the way the story names them.
- 1 to 3 HOOKs, 0 to 2 CLOCKs, and a SECRET for every secret.
- DATE is a date in the story's calendar, written like "Now" above, or relative to now: "in 2 days", "tomorrow at dusk", "next morning", "in 6 hours".
- Keep every part short: a few words, not sentences. No markdown, numbering or commentary.`;

const USER_MESSAGE = 'Plan the next arc. Answer only with the <plan> block.';

// What an empty macro becomes, so the prompt never shows a dangling "Place:".
const NONE = '(none)';
const MACRO = /\{\{\s*([A-Za-z_]+)\s*\}\}/g;

const HEADINGS = Object.freeze({
    agenda: 'Off-screen', event: 'World', hook: 'Hooks', quest: 'Quests', clock: 'Clocks',
    beat: 'Beats', secret: 'Secrets', arc: 'Arc',
});
const RESOLVED_LIMIT = 8;

// ---------------------------------------------------------------------------------------
// Prompt

/** The tracker as the planner reads it: active records by kind, then recent resolutions. */
export function summarizeTracker(tracker, { calendar = null } = {}) {
    const records = tracker?.records ?? [];
    const reference = isNumber(tracker?.time) ? tracker.time : null;
    const lines = [];

    // KINDS order (agenda, event, hook, clock, beat, secret), then arc, then anything newer.
    const kinds = [...new Set([...KINDS, 'arc', ...records.map(record => record.kind)])];
    for (const kind of kinds) {
        const group = records.filter(record => record.status === 'active' && record.kind === kind);
        if (!group.length) continue;
        lines.push(`${HEADINGS[kind] ?? capitalize(kind)}:`);
        for (const record of byDate(group, { calendar, reference })) lines.push(`- ${recordLine(record)}`);
    }

    const resolved = records
        .filter(record => record.status !== 'active')
        .sort((a, b) => resolvedMessage(b) - resolvedMessage(a))
        .slice(0, RESOLVED_LIMIT);
    if (resolved.length) {
        lines.push('Resolved:');
        for (const record of resolved) {
            const reason = record.resolved?.reason ?? '';
            lines.push(`- ${record.key}${reason ? ` — ${reason}` : ''}`);
        }
    }
    return lines.length ? lines.join('\n') : '(nothing tracked yet)';
}

function recordLine(record) {
    const fields = record.fields ?? {};
    let line = record.key;
    const what = fields.now || fields.desc;
    if (what) line += ` — ${what}`;
    if (fields.then) line += ` → ${fields.then}`;
    const when = fields.on || fields.due;
    if (when) line += ` (${when})`;
    // A planned fight says so, so the next plan neither repeats nor forgets it.
    if (fields.encounter) line += ` · fight: ${fields.encounter}`;
    return line;
}

// With a calendar, the soonest first: what fires next matters most to the next arc. Undated
// records follow in tracker order (the sort is stable).
function byDate(records, { calendar, reference }) {
    if (!calendar) return records;
    const when = record => {
        const fields = record.fields ?? {};
        const text = fields.on || fields.due;
        const parsed = text ? calendar.parse(text, { reference }) : null;
        return parsed ? parsed.abs : Infinity;
    };
    return records
        .map(record => ({ record, at: when(record) }))
        .sort((a, b) => (a.at === b.at ? 0 : a.at < b.at ? -1 : 1))
        .map(({ record }) => record);
}

function resolvedMessage(record) {
    const value = record.resolved?.message;
    return isNumber(value) ? value : -Infinity;
}

/**
 * The planning call: the template with its macros filled as the system message, and a short
 * user turn. Unknown macros, `{{user}}` and `{{char}}` included, stay for SillyTavern.
 * `npcPlansOnly` (NPC State Delta keeps who each NPC is) adds one line to the user turn, so
 * it holds for the reader's own template too.
 */
export function buildPlannerMessages({
    template = DEFAULT_PLANNER_PROMPT,
    recent = '',
    trackerSummary = '',
    nowText = '',
    place = '',
    nearby = [],
    directorNote = '',
    genre = '',
    previousArc = '',
    npcPlansOnly = false,
} = {}) {
    const values = {
        recent,
        tracker: trackerSummary,
        now: nowText,
        place,
        nearby: Array.isArray(nearby) ? nearby.filter(Boolean).join(', ') : nearby,
        note: directorNote,
        genre,
        previous_arc: previousArc,
    };
    // An emptied template in the settings means "use the default", not "send nothing".
    const source = String(template || DEFAULT_PLANNER_PROMPT);
    // A replacer function, so a `$&` inside the story is inserted as written.
    const content = source.replace(MACRO, (whole, name) => {
        const key = name.toLowerCase();
        if (!Object.hasOwn(values, key)) return whole;
        return String(values[key] ?? '').trim() || NONE;
    });
    return [
        { role: 'system', content },
        { role: 'user', content: npcPlansOnly ? `${USER_MESSAGE} ${NPC_PLANS_ONLY}` : USER_MESSAGE },
    ];
}
