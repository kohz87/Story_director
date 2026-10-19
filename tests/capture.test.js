// Capture: the prompt, and an answer held to the tracker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChanges } from '../src/changes.js';
import { replay } from '../src/tracker.js';
import { DEFAULT_CAPTURE_PROMPT, buildCaptureMessages, parseCapture } from '../src/capture.js';
import { NPC_PLANS_ONLY } from '../src/note.js';

const tracker = replay([{ message: 1, time: 0, text: '', ops: parseChanges('+ agenda Senior Listener Geva — now: Bailiff Court | then: argues the warrant | on: Haywane 12\n+ hook River stranger — who pulled Ren from the sump').ops }]).tracker;

test('buildCaptureMessages fills the exchange, tracker, time and place; leaves {{user}} for SillyTavern', () => {
    const [system, user] = buildCaptureMessages({ trackerSummary: 'Off-screen:\n- Geva', nowText: 'Haywane 12, dusk', place: 'Auvoth', userText: 'I ask about Geva.', replyText: 'The clerk says Geva left for the court.' });
    assert.equal(system.role, 'system');
    assert.match(system.content, /Off-screen:\n- Geva/);
    assert.match(system.content, /Story time: Haywane 12, dusk\. Place: Auvoth\./);
    assert.match(system.content, /Player: I ask about Geva\.\n\nNarrator: The clerk says Geva left for the court\./);
    assert.match(system.content, /\{\{user\}\}/, 'macros SillyTavern fills stay');
    assert.match(user.content, /<Director>/);
    assert.match(DEFAULT_CAPTURE_PROMPT, /Never plans/);
    assert.match(DEFAULT_CAPTURE_PROMPT, /people, encounter \(the foes of a fight that is coming\)/, 'the fields name the encounter');
    assert.match(DEFAULT_CAPTURE_PROMPT, /due \(its deadline\), difficulty \(easy, normal, hard or nightmare\)\./, 'and a quest\'s difficulty');
    assert.match(buildCaptureMessages({})[0].content, /\(nothing tracked yet\)/);
});

test('buildCaptureMessages with npcPlansOnly: the same line as the note, in the request only', () => {
    const exchange = { trackerSummary: 'Off-screen:\n- Geva', replyText: 'Geva left for the court.' };
    const alone = buildCaptureMessages(exchange);
    assert.ok(!alone[1].content.includes(NPC_PLANS_ONLY));
    const [system, user] = buildCaptureMessages({ ...exchange, npcPlansOnly: true });
    assert.equal(system.content, alone[0].content);
    assert.equal(user.content, `${alone[1].content} ${NPC_PLANS_ONLY}`);
});

test('parseCapture keeps changes to tracked keys and new records, drops the rest', () => {
    const answer = `<think>Geva is at court; a new courier appeared.</think>
<Director>
~ Senior Listener Geva — now: District Bailiff Court | then: files the warrant
+ agenda Courier — now: rides south | on: Haywane 13
- Nobody Known — gone
! Ghost Event — happened
+ arc The Big Plan — capture must not plan
</Director>`;
    const result = parseCapture(answer, tracker);
    assert.deepEqual(result.ops.map(op => `${op.op} ${op.key}`), ['~ Senior Listener Geva', '+ Courier']);
    assert.deepEqual(result.dropped.map(item => item.reason), ['"Nobody Known" is not tracked', '"Ghost Event" is not tracked', 'capture does not plan arcs']);
    assert.match(result.lines, /^~ Senior Listener Geva — now: District Bailiff Court \| then: files the warrant\n\+ agenda Courier/);
    assert.deepEqual(parseChanges(result.lines).errors, [], 'stored lines read back cleanly');
});

test('parseCapture keeps a change to a key that plainly means one tracked record', () => {
    const result = parseCapture('<Director>\n~ The Senior Listener Geva — then: files the warrant\n~ Listener — then: waits\n</Director>', tracker);
    assert.deepEqual(result.ops.map(op => op.key), ['The Senior Listener Geva']);
    assert.deepEqual(result.dropped.map(item => item.reason), ['"Listener" is not tracked']);
});

test('parseCapture: an empty block, a cut-off think tag, fences, and no block at all', () => {
    assert.equal(parseCapture('<Director></Director>', tracker).ops.length, 0);
    const cut = parseCapture('reasoning without its opening tag</think>\n```\n~ River stranger — then: sends word\n```', tracker);
    assert.deepEqual(cut.ops.map(op => op.key), ['River stranger']);
    assert.equal(cut.errors.length, 0);
});

test('parseCapture: a captured quest keeps its difficulty as one of the four words', () => {
    const { ops, lines } = parseCapture('<Director>\n+ bounty Wolf pelts — giver: Tanner Ole | reward: 2 silver each | difficulty: Simple\n</Director>', tracker);
    assert.equal(ops[0].kind, 'quest');
    assert.equal(ops[0].fields.difficulty, 'easy');
    assert.equal(lines, '+ quest Wolf pelts — type: bounty | giver: Tanner Ole | reward: 2 silver each | difficulty: easy');
});

test('parseCapture keeps a change to a name a record was reached by before (0.9.19)', () => {
    const named = { ...tracker, records: tracker.records.map(record => (record.key === 'River stranger' ? { ...record, aliases: ['the old fisher'] } : record)) };
    const answer = '<Director>\n~ The Old Fisher — then: sends word\n</Director>';
    assert.deepEqual(parseCapture(answer, named).ops.map(op => op.key), ['The Old Fisher']);
    assert.deepEqual(parseCapture(answer, tracker).ops, [], 'without the alias it is not tracked');
});
