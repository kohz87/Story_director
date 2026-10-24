// What the model is told: the static rules (byte-identical whatever the state) and the Director
// note in the tail (v1 note.js: due, relevant, checks), within the part's budget.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CHANGE_INSTRUCTION, PACING } from '../../../src/note.js';
import { estimateTokens } from '../../../src/relevance.js';
import { part } from '../../../src/v2/tracker/index.js';
import { STATIC_TEXT, TAIL_BUDGET } from '../../../src/v2/tracker/note.js';
import { makeState, story } from './helpers/fake-ctx.js';

const tail = (state, lastUser = '', settings = {}) => part.context.tail({ state, settings, chat: { length: 9, lastUser } });

const BUSY = [
    { lines: '~ time March 3, 2026, 08:00 am\n+ agenda Senior Listener Geva — plots | now: the court | then: files the warrant | on: March 3, 06:00 pm\n+ secret The Heir — Ren is the lost heir\n+ clock Flood — the levee breaks | due: March 9 | shown: sign' },
    { lines: '+ quest Wolf Hunt — Kill ridge wolves | giver: Danique | reward: 4 silver | due: March 5', said: 'I take the wolf hunt.' },
    { lines: '+ hook Herb run — moonleaf for the healer | giver: Mother Ysolde | reward: 5 copper\n! time +12h', said: 'Hello.' },
];

test('the static part is byte-identical whatever the tracker holds, and names nothing', () => {
    const empty = part.context.static();
    const busy = story(BUSY, makeState({ place: 'Bluewatch' }));
    assert.equal(typeof empty, 'string');
    assert.equal(part.context.static(), empty);
    assert.ok(busy.domains.director.threads, 'a full tracker exists');
    // static() takes no state, only the module set ({ fights }): the same bytes before and after the story moved.
    assert.equal(part.context.static.length, 1);
    assert.equal(part.context.static({ fights: true }), empty);
    const alone = part.context.static({ fights: false });
    assert.equal(part.context.static({ fights: false }), alone);
    assert.doesNotMatch(alone, /encounter/);
    assert.equal(alone, empty.replace(', encounter;', ';'));
    assert.equal(empty, STATIC_TEXT);
    for (const word of ['Geva', 'Wolf', 'March', 'Bluewatch', '2026']) assert.ok(!empty.includes(word), word);
    // v1's own rules, word for word, but for the Fields line's offers (one deliberate change: a job is a
    // quest once {{user}} accepts it, and a job only offered stays in the story).
    const v1Fields = CHANGE_INSTRUCTION.split('\n').find(line => line.startsWith('Fields:'));
    for (const line of CHANGE_INSTRUCTION.split('\n').slice(5)) assert.ok(empty.includes(line === v1Fields ? line.replace('; a job only offered: + hook with giver, reward', '') : line), line);
    assert.doesNotMatch(empty, /offer/);
    assert.ok(empty.includes(PACING));
});

test('each kind has one grammar line for the change instruction', () => {
    assert.deepEqual(Object.keys(part.kinds), ['agenda', 'event', 'hook', 'quest', 'clock', 'beat', 'secret', 'time']);
    for (const [kind, entry] of Object.entries(part.kinds)) {
        // The beat's grammar depends on the module set (a fight runner or none, WAVE rule 11).
        for (const fights of [true, false]) {
            const grammar = typeof entry.grammar === 'function' ? entry.grammar({ fights }) : entry.grammar;
            assert.equal(typeof grammar, 'string', kind);
            assert.ok(!grammar.includes('\n'), kind);
            assert.ok(grammar.includes(` ${kind} `), kind);
        }
        assert.equal(typeof entry.apply, 'function', kind);
    }
    assert.match(part.kinds.beat.grammar({ fights: true }), /encounter: the foes, for a fight/);
    // A hook is an open thread, no job offer with a giver and a reward; + quest is written once {{user}} accepts.
    assert.doesNotMatch(part.kinds.hook.grammar, /giver|reward/);
    assert.match(part.kinds.hook.grammar, /\+ quest once \{\{user\}\} accepts/);
    assert.doesNotMatch(part.kinds.beat.grammar({ fights: false }), /encounter|fight|foe/);
});

test('nothing tracked: no tail', () => {
    assert.deepEqual(tail(makeState()), { lines: [], optional: [] });
    assert.deepEqual(part.context.tail({ state: { domains: {} } }), { lines: [], optional: [] });
});

test('the tail: header with time and place, due now, kind lines, secrets by name, the quest checks', () => {
    const state = story(BUSY, makeState({ place: 'Bluewatch' }));
    const { lines, optional } = tail(state);
    assert.deepEqual(optional, []);
    assert.deepEqual(lines, [
        '[Story Director · Tuesday, March 3, 2026, 08:00 pm · Bluewatch]',
        'Due now: Senior Listener Geva — files the warrant (March 3, 06:00 pm)',
        'Quests: Wolf Hunt — Kill ridge wolves · for Danique · 4 silver · by March 5, 11:59 pm',
        'Clocks: Flood — the levee breaks (March 9) · shown: sign',
        // Not tied to Bluewatch, nobody present, not due soon: named elsewhere only (scene.js).
        'Elsewhere, not in this scene: Herb run (hook)',
        'Do not reveal: The Heir',
    ]);
    // The reader's message: a job given up, an offer taken on or turned down.
    assert.ok(tail(state, 'I give up on the wolf hunt.').lines.includes('Quest check: {{user}} may be giving up Wolf Hunt. If they do, close it with - quest Key — abandoned; if not, leave it.'));
    assert.ok(tail(state, 'I accept the herb run.').lines.includes('Quest check: {{user}} may be taking on Herb run. Write + quest Key with its parts when {{user}} accepts (no - line for the hook); if not, leave it.'));
    // v2 has no offers (#99): the check never asks the story to leave a job as one.
    assert.ok(!tail(state, 'I accept the herb run.').lines.join('\n').includes('offer'));
    assert.ok(tail(state, 'No thanks, not interested in herbs.').lines.at(-1).startsWith('Quest check: {{user}} may be turning down Herb run. If they do, close it with - quest Key — declined'));
    // A quest whose step reads finished is asked about, never closed for the story.
    const finished = story([{ lines: '~ quest Wolf Hunt | step: wolves slain, reward collected — waiting on Danique' }], state);
    assert.equal(finished.domains.director.threads[Object.keys(finished.domains.director.threads)[1]].status, 'active');
    assert.ok(tail(finished).lines.some(line => line.startsWith('Quest check: the story may have finished Wolf Hunt. If it has, close it with - quest Key — outcome')), tail(finished).lines.join('\n'));
});

test('the tail keeps within the part\'s budget by dropping the least relevant threads', () => {
    const many = Array.from({ length: 60 }, (_, n) => `+ hook Thread number ${n} — a long description of thread ${n} that goes on and on about what it is`).join('\n');
    const state = story([{ lines: many }]);
    const { lines } = tail(state);
    assert.ok(estimateTokens(lines.join('\n')) <= TAIL_BUDGET, `${estimateTokens(lines.join('\n'))} tokens`);
    assert.ok(lines.some(line => line.startsWith('Hooks: ')));
    assert.equal(part.context.budget, TAIL_BUDGET);
});

test('relevance follows the reader: dormant settings come from the module settings', () => {
    const lines = Array.from({ length: 20 }, (_, n) => ({ lines: `+ event Filler ${n} — x` }));
    const state = story([{ lines: '+ hook Old lighthouse — a light at night' }, ...lines]);
    assert.ok(!tail(state).lines.some(line => line.includes('Old lighthouse')), 'quiet for 15 replies: dormant');
    assert.ok(tail(state, '', { dormantReplies: 100 }).lines.some(line => line.includes('Old lighthouse')));
    assert.ok(tail(state, 'I climb to the old lighthouse.').lines.some(line => line.includes('Old lighthouse')), 'the reader names it');
});
