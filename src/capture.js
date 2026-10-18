// Capture: change lines written by a second model call, for writers that cannot be trusted to
// write their own <Director> block.
//
// After a reply, one call reads only that exchange (the player's message and the reply) with
// the tracker for context, and answers with change lines in the same grammar the main model
// would have used. The rules are World State Alpha's capture rules, which held up in play:
// record only what the exchange established, never plans, guesses or options; a claim made in
// dialogue stays a claim; a rumour stays a rumour; nothing is invented to keep the world busy.
//
// The answer is held to the tracker: a change, resolution or firing of a key that is not
// tracked (and is not plainly one tracked record under another spelling) is dropped (and
// reported), and capture never opens an arc. Pure.

import { formatOp, parseChanges } from './changes.js';
import { NPC_PLANS_ONLY } from './note.js';
import { nearMatches } from './tracker.js';

export const DEFAULT_CAPTURE_PROMPT = `You keep the story tracker for a roleplay between {{user}} and {{char}}. Read ONE exchange (the player's message and the narrator's reply) and write the tracker changes that exchange established. You write no story.

Tracked now:
{{tracker}}

Story time: {{now}}. Place: {{place}}.

Write one change per line, inside <Director>…</Director>:
+ kind Key — summary | label: value      a new record; kinds: agenda (someone off-screen with a stake), event, hook (an open tension), quest (work {{user}} accepted), clock (a consequence that fires at due:), beat, secret
~ Key — label: value                  change only what changed
- Key — reason                        resolved
! Key — what happened                 something that was due happened
Fields: now, then, on, due, leg, arrive, shown, place, people, encounter (the foes of a fight that is coming); a quest: type (main, side, bounty, contract…), giver, goal, reward, step, due (its deadline), difficulty (easy, normal, hard or nightmare). Dates go only in on, due and arrive.

Rules:
- Record only what this exchange established as true. Never plans, intentions, options, guesses or hypotheticals.
- A quest starts only when {{user}} accepts it in this exchange; an offer not yet taken is a hook. A tracked hook {{user}} takes on becomes the quest: ~ its key with the quest's parts (giver, goal, reward, difficulty). Move its step: as it progresses, - it when done or failed.
- What someone claims in dialogue is their claim ("the guard says the gate is shut"), not a fact. A rumour stays a rumour.
- Use the exact keys above for ~, - and !. A new key only for something new.
- Off-screen people get a line only when they have a stake in {{user}} or an open hook.
- Nothing changed? Answer <Director></Director>.
- Never write {{user}}'s actions, thoughts or words as plans.

The exchange:
{{exchange}}`;

const THINK_BLOCK = /<(think|thinking)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const FENCE = /^\s*```[\w-]*\s*$/gm;

/**
 * The messages for the capture call: [{ role: 'system', content }, { role: 'user', content }].
 * `npcPlansOnly`: as in the note, one line saying agendas give only plans and timing.
 */
export function buildCaptureMessages({ template = DEFAULT_CAPTURE_PROMPT, trackerSummary = '', nowText = '', place = '', userText = '', replyText = '', npcPlansOnly = false } = {}) {
    const exchange = [userText ? `Player: ${userText}` : '', `Narrator: ${replyText}`].filter(Boolean).join('\n\n');
    const values = {
        tracker: trackerSummary || '(nothing tracked yet)',
        now: nowText || 'unknown',
        place: place || 'unknown',
        exchange,
    };
    // Unknown macros ({{user}}, {{char}}) are left for SillyTavern to fill.
    const content = String(template || DEFAULT_CAPTURE_PROMPT).replace(/\{\{(\w+)\}\}/g, (whole, name) => values[name.toLowerCase()] ?? whole);
    return [
        { role: 'system', content },
        { role: 'user', content: `Write the tracker changes for this exchange. Answer only with the <Director> block.${npcPlansOnly ? ` ${NPC_PLANS_ONLY}` : ''}` },
    ];
}

/**
 * The capture answer, held to the tracker:
 * { ops, lines, dropped: [{ raw, reason }], errors: [{ line, message }] }.
 * `lines` is the <Director> body to store (formatOp of the kept ops).
 */
export function parseCapture(text, tracker) {
    let body = String(text ?? '').replace(THINK_BLOCK, '');
    // A reasoning model whose opening tag was cut off leaves only the closing one.
    const close = body.search(/<\/think(?:ing)?\s*>/i);
    if (close >= 0) body = body.slice(body.indexOf('>', close) + 1);
    const block = /<Director>([\s\S]*?)<\/Director>/i.exec(body);
    body = (block ? block[1] : body).replace(FENCE, '');

    const { ops, errors } = parseChanges(body);
    const known = new Set((tracker?.records ?? []).map(record => record.id));
    const kept = [];
    const dropped = [];
    for (const op of ops) {
        if (op.op === '+' && op.kind === 'arc') {
            dropped.push({ raw: op.raw, reason: 'capture does not plan arcs' });
        } else if (op.op !== '+' && !known.has(op.id) && nearMatches(tracker?.records, op.key).length !== 1) {
            // A key that plainly means one tracked record is kept; the tracker reads it as that one.
            dropped.push({ raw: op.raw, reason: `"${op.key}" is not tracked` });
        } else {
            kept.push(op);
        }
    }
    return { ops: kept, lines: kept.map(formatOp).join('\n'), dropped, errors };
}
