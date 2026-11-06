// Story Director v2, part **arc**: the planner prompt and tracker summary. Pure.

import { DESC_POINTS, KEY_POINTS, PART_POINTS, flat } from './shared.js';

// ---------------------------------------------------------------------------------------------------
// The prompt

export const DEFAULT_PLANNER_PROMPT = `You are the showrunner of an ongoing story between {{user}} and {{char}}. Your job is to plan the NEXT ARC: what the world and its people will do over the coming days, so the story moves with purpose. You write the plan the storyteller follows, not the story.

## How you plan
- Decide. Never ask questions, offer options or hedge. Commit to one specific plan.
- Plan the world, never {{user}}. {{user}}'s actions, words, thoughts and choices belong to {{user}} alone. Create pressures, opportunities and consequences that {{user}} can meet any way; never script the response.
- Every character has goals, fears, loyalties and limits, and pursues them off-screen, watched or not. Keep plans true to who they are.
- Plan the future: the current scene is already in motion, and your beats start after it.
- Build from what is there: pull dropped threads, unpaid debts, broken promises, rumours and characters mentioned but never seen back into play. Paying off what exists beats inventing.
- Make consequences real: what {{user}} and others did comes back, on a schedule.
- Quests are {{user}}'s: press on them (rivals, deadlines), never complete them. Offer new work as a HOOK.
- Give the arc a shape: pressure that builds, a turn, and a climax. Leave the outcome open for {{user}}.
- Beats are when the world acts, not appointments for {{user}}. Each must work without {{user}} present, and may slip.
- Every beat reaches {{user}} wherever they are (a price, a door shut or opened, a mood, a danger, an opening); the response stays {{user}}'s.
- Protect secrets: write each as a SECRET line. The storyteller hints and never tells until the story earns the reveal.
- Respect time and distance: nobody is in two places at once; travel takes time.
- Match the genre and tone. Follow the Director's note if there is one.

## What you know
Genre and tone: {{genre}}
Now: {{now}}
Place: {{place}}
Director's note: {{note}}
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
AGENDA: Name — what they want | now: what they are doing | then: what they do next | on: DATE
HOOK: Key — the tension; what would settle it | then: what happens if it is left alone | on: DATE
CLOCK: Key — cause → consequence | due: DATE | shown: none
SECRET: Key — what {{user}} must not learn yet
</plan>

- Exactly one ARC line.
- 3 to 6 BEATs in story order: things that happen in the world, not things {{user}} does. Give a beat "after: Other beat" instead of a date when it follows another beat.
{{fights}}
- One AGENDA for every character the arc moves, named the way the story names them.
- 1 to 3 HOOKs, 0 to 2 CLOCKs, and a SECRET for every secret.
- DATE is a date in the story's calendar, written like "Now" above, or relative to now: "in 2 days", "tomorrow at dusk", "next morning", "in 6 hours".
- No rewards, prices, levels or amounts: the story's rules set those.
- Keep every part short: a few words, not sentences. No markdown, numbering or commentary.`;

/** The `{{fights}}` line: with a module that runs fights, how a planned fight is written; else none at all. */
export const FIGHT_RULE = '- A fight is a BEAT with "| encounter: 3 bandit, bandit captain (boss)", only where the story would really come to blows (a quest\'s target, an ambush an agenda sets up); at most 1 or 2 per arc, foes named as the story names them.';
export const NO_FIGHT_RULE = '- This story has no fights: plan no battles or encounters.';

export const PLANNER_ASK = 'Plan the next arc. Answer only with the <plan> block.';
const NONE = '(none)';
const MACRO = /\{\{\s*([A-Za-z_]+)\s*\}\}/g;

/**
 * The planner call's `{ system, prompt }`: the reader's template (empty: the default) with its macros
 * filled. `{{user}}` and `{{char}}` (and any other macro) stay for Story Block's substitute.
 */
export function plannerRequest({ template = '', genre = '', now = '', place = '', note = '', previousArc = '', tracker = '', recent = '', fights = true } = {}) {
    const values = {
        genre, now, place, note, previous_arc: previousArc, tracker, recent,
        fights: fights ? FIGHT_RULE : NO_FIGHT_RULE,
    };
    const source = String(template ?? '').trim() ? String(template) : DEFAULT_PLANNER_PROMPT;
    const system = source.replace(MACRO, (whole, name) => {
        const key = name.toLowerCase();
        if (!Object.hasOwn(values, key)) return whole;
        return String(values[key] ?? '').trim() || NONE;
    });
    return { system, prompt: PLANNER_ASK };
}

/** What the Director tracks, as the planner reads it: open threads by kind, then the last few closed. */
export function trackerSummary(threads = [], { closedShown = 8 } = {}) {
    const headings = { quest: 'Quests', hook: 'Hooks', agenda: 'Agendas', event: 'World', clock: 'Clocks', beat: 'Beats', secret: 'Secrets' };
    const lines = [];
    const open = threads.filter(thread => thread?.status === 'active');
    for (const kind of Object.keys(headings)) {
        const group = open.filter(thread => thread.kind === kind);
        if (!group.length) continue;
        lines.push(`${headings[kind]}:`);
        for (const thread of group) {
            const fields = thread.fields ?? {};
            let line = `- ${flat(thread.key, KEY_POINTS)}`;
            const what = flat(fields.now || thread.summary, DESC_POINTS);
            if (what) line += ` — ${what}`;
            if (fields.then) line += ` → ${flat(fields.then, PART_POINTS)}`;
            const when = fields.on || fields.due;
            if (when) line += ` (${flat(when, PART_POINTS)})`;
            lines.push(line);
        }
    }
    const closed = threads.filter(thread => thread?.status !== 'active').slice(-closedShown);
    if (closed.length) {
        lines.push('Resolved:');
        for (const thread of closed) lines.push(`- ${flat(thread.key, KEY_POINTS)}${thread.ended?.reason ? ` — ${flat(thread.ended.reason, PART_POINTS)}` : ''}`);
    }
    return lines.length ? lines.join('\n') : '(nothing tracked yet)';
}
