// Story Director: the note's fixed text (pure).
//
// Change instruction, Pacing, encounter, NPC-plans and While away cues. Moved out of note.js;
// note.js re-exports every public name.
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
// tokens. The fight is resolved by another extension; a storyteller left
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
