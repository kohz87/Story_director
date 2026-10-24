// The tracker part's change lines: v1's tracker rules (tests/tracker.test.js) ported to v2 lines
// and the `director` domain. Each line runs as its own story command through a fake ctx.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { part } from '../../../src/v2/tracker/index.js';
import { toV1Op } from '../../../src/v2/tracker/capture.js';
import { lastProblems, makeState, readLine, reply, runCommand, story, thread } from './helpers/fake-ctx.js';
import { problemList, replyTurn } from '../../../src/v2/tracker/domain.js';

const kinds = state => lastProblems(state).map(problem => problem.kind);
const threads = (state, args = {}) => part.queries['director.threads'](state, args);
const valid = state => assert.deepEqual(part.domains.director.validate(state.domains.director, state), []);

const START = [
    '+ agenda Senior Listener Geva — now: District Bailiff Court | then: argues with magistrates | on: Haywane 12, 05:45 pm | people: Kade, Al',
    '+ clock Hollin\'s Reach graves — washed graves left uncompleted | due: Goldwane 28 | shown: none',
    '+ event Canal Street Granary Fires — Lower city ablaze | then: citywide night curfew declared',
    '+ hook River stranger — who pulled Ren from the sump',
    '+ hook Footing at Bluewatch — a foothold in the village',
    '+ event The Fall of the Weir — the river dam broke',
].join('\n');

test('+ makes threads: kind, key, summary, fields as written, ids, keys and revs', () => {
    const state = story([{ lines: START }]);
    valid(state);
    const geva = thread(state, 'senior listener geva');
    assert.match(geva.id, /^th_[0-9a-z]{8}$/);
    assert.deepEqual({ ...geva, id: 'x' }, {
        id: 'x', kind: 'agenda', key: 'Senior Listener Geva', summary: '',
        fields: { now: 'District Bailiff Court', then: 'argues with magistrates', on: 'Haywane 12, 05:45 pm', people: 'Kade, Al' },
        status: 'active', offer: false, taken: null, ended: null, target: null, reward: null, rev: 1,
    });
    assert.equal(thread(state, 'River stranger').summary, 'who pulled Ren from the sump');
    assert.equal(thread(state, 'Hollin\'s Reach graves').kind, 'clock');
    assert.equal(thread(state, 'hollins reach graves').fields.shown, 'none', 'keys ignore case and punctuation');
    assert.deepEqual(threads(state).map(entry => entry.rev), [1, 2, 3, 4, 5, 6], 'each line its own receipt');
    assert.deepEqual(Object.keys(state.domains.director.keys), ['senior listener geva', 'hollins reach graves', 'canal street granary fires', 'river stranger', 'footing at bluewatch', 'the fall of the weir']);
    assert.deepEqual(problemList(state.domains.director), []);
});

test('- closes with its reason; replaced and merged supersede', () => {
    const state = story([{ lines: START }, { lines: '- hook River stranger — left the city\n- agenda Senior Listener Geva — replaced by Kade\n- event Canal Street Granary Fires — merged into the riots' }]);
    valid(state);
    assert.deepEqual(thread(state, 'River stranger').ended, { rev: 7, reason: 'left the city', outcome: 'done' });
    assert.equal(thread(state, 'River stranger').status, 'resolved');
    assert.deepEqual(thread(state, 'Senior Listener Geva').ended, { rev: 8, reason: 'replaced by Kade', outcome: 'superseded' });
    assert.equal(thread(state, 'Canal Street Granary Fires').ended.outcome, 'superseded');
    assert.equal(thread(state, 'Canal Street Granary Fires').status, 'resolved');
});

test('~ changes only what it names; text after the dash reads its labels as v1 does', () => {
    let state = story([{ lines: START }, { lines: '~ agenda Senior Listener Geva | then: files the warrant | mood: sour' }]);
    assert.deepEqual(thread(state, 'Senior Listener Geva').fields, { now: 'District Bailiff Court', then: 'files the warrant', on: 'Haywane 12, 05:45 pm', people: 'Kade, Al', mood: 'sour' });
    state = reply(state, '~ agenda Senior Listener Geva — now: the river gate').state;
    assert.equal(thread(state, 'Senior Listener Geva').fields.now, 'the river gate');
    // An empty label clears the field.
    state = reply(state, '~ agenda Senior Listener Geva | then:').state;
    assert.equal(thread(state, 'Senior Listener Geva').fields.then, undefined);
    assert.equal(toV1Op(readLine('~ hook Wolves — step: done — the pack is dead | reward: 2 silver')).op.fields.step, 'done — the pack is dead');
});

test('near keys: a ~ on a name close to one thread changes it, and the name is remembered', () => {
    for (const key of ['Footing in Bluewatch', 'FOOTING IN BLUEWATCH', 'The Footing, Bluewatch']) {
        const state = story([{ lines: START }, { lines: `~ hook ${key} | now: a room at the inn` }]);
        assert.equal(thread(state, 'Footing at Bluewatch').fields.now, 'a room at the inn', key);
        assert.equal(threads(state).length, 6, key);
        assert.deepEqual(lastProblems(state).map(({ kind, severity, text }) => ({ kind, severity, text })), [
            { kind: 'near-key', severity: 'info', text: `"${key}" read as "Footing at Bluewatch".` },
        ], key);
        assert.equal(thread(state, key).id, thread(state, 'Footing at Bluewatch').id, 'an alias in keys');
        valid(state);
    }
    // Containment of two words or more, word overlap, and ! and -.
    let state = story([{ lines: START }, { lines: '! event Weir Fall — the river floods | now: flooded fields' }]);
    assert.equal(thread(state, 'The Fall of the Weir').fields.now, 'flooded fields');
    state = story([{ lines: START }, { lines: '- event Fall of Weir — rebuilt' }]);
    assert.equal(thread(state, 'The Fall of the Weir').status, 'resolved');
    assert.equal(kinds(state)[0], 'near-key');
    // One word is not enough: "Geva" is a new hook, not the agenda.
    state = story([{ lines: START }, { lines: '~ agenda Geva | then: files the warrant' }]);
    assert.equal(thread(state, 'Senior Listener Geva').fields.then, 'argues with magistrates');
    assert.equal(thread(state, 'Geva').kind, 'agenda', 'added as the line\'s own kind');
    // A remembered name is that thread at once, quietly.
    state = story([{ lines: START }, { lines: '~ hook Footing in Bluewatch | now: a room' }, { lines: '~ hook Footing in Bluewatch | now: the loft' }]);
    assert.equal(thread(state, 'Footing at Bluewatch').fields.now, 'the loft');
    assert.deepEqual(kinds(state), []);
});

test('two near threads are never guessed between; the note corrects the line once', () => {
    const state = story([
        { lines: '+ hook Footing at Bluewatch — a foothold\n+ hook Footing on Bluewatch — another' },
        { lines: '~ hook Footing in Bluewatch | now: a room at the inn' },
    ]);
    assert.ok(threads(state).every(entry => entry.fields.now === undefined));
    const [problem] = lastProblems(state);
    assert.deepEqual({ kind: problem.kind, severity: problem.severity, op: problem.op, candidates: problem.candidates }, { kind: 'unknown-key', severity: 'warn', op: '~', candidates: ['Footing at Bluewatch', 'Footing on Bluewatch'] });
    assert.equal(problem.text, '"Footing in Bluewatch" is not tracked (it could be "Footing at Bluewatch" or "Footing on Bluewatch"); the ~ line was ignored.');
    const tail = part.context.tail({ state, settings: {}, chat: { lastUser: '' } });
    assert.ok(tail.lines.includes('Corrections: "Footing in Bluewatch" is not tracked: use its exact key ("Footing at Bluewatch" or "Footing on Bluewatch") or add it with "+ kind Footing in Bluewatch — …".'), tail.lines.join('\n'));
    // A later reply with Director lines: the correction is not repeated.
    const later = reply(state, '+ hook Ferry — a ferryman waits').state;
    assert.ok(!part.context.tail({ state: later, settings: {}, chat: { lastUser: '' } }).lines.some(line => line.startsWith('Corrections')));
});

test('a ~ on a name not tracked adds a thread of its kind; one that reads as over adds nothing', () => {
    let state = story([{ lines: '~ event Lantern Guild dues | now: two silver owed | people: Brann' }]);
    assert.equal(thread(state, 'Lantern Guild dues').kind, 'event');
    assert.deepEqual(lastProblems(state).map(problem => problem.text), ['"Lantern Guild dues" was not tracked; added as an event.']);
    state = story([{ lines: '~ hook Odd lights | now: over the marsh' }]);
    assert.equal(thread(state, 'Odd lights').kind, 'hook');
    // With a giver or reward it is a job (v1 0.9.4).
    state = story([{ lines: '~ hook Kettle Jack bounty | giver: Warden Hale | reward: 40 crowns' }]);
    assert.equal(thread(state, 'Kettle Jack bounty').kind, 'hook');
    state = story([{ lines: '~ hook North Levee Vipers | step: completed, voucher paid' }], makeState());
    assert.deepEqual(threads(state), []);
    assert.deepEqual(kinds(state), ['unknown-key']);
    // ! with nothing tracked changes nothing and is corrected; a - is only a note.
    state = story([{ lines: '! event Riot — the square burns\n- hook Ghost — gone' }]);
    assert.deepEqual(threads(state), []);
    assert.deepEqual(lastProblems(state).map(problem => [problem.kind, problem.severity]), [['unknown-key', 'warn'], ['unknown-key', 'info']]);
});

test('a line under a label ("! event Encounter — …") is skipped quietly', () => {
    const state = story([{ lines: '+ hook Sheepfold Wolves — wolves at the east fold' }, { lines: '! event Encounter — 4 wolves attack\n~ hook Quest | step: fight' }]);
    assert.equal(threads(state).length, 1);
    assert.deepEqual(kinds(state), ['label-key', 'label-key']);
});

const QUEST = '+ hook Sheep-killer — kill the wolf | giver: Garrow | step: track it to the den | reward: 2 silver';
const TAKEN = { lines: QUEST, said: 'I take the Sheep-killer job.' };

test('closing a closed thread again changes nothing; a + reopens it (v1 0.9.7)', () => {
    const closed = story([TAKEN, { lines: '- hook Sheep-killer — the wolf is dead' }]);
    const ended = thread(closed, 'Sheep-killer').ended;
    for (const line of ['- hook Sheep-killer — the wolf is dead', '~ hook Sheep-killer | status: completed', '! hook Sheep-killer — reward paid']) {
        const again = reply(closed, line).state;
        assert.deepEqual(thread(again, 'Sheep-killer').ended, ended, line);
        assert.deepEqual(kinds(again), ['already-closed'], line);
    }
    const reopened = story([{ lines: '+ hook Sheep-killer — a second wolf | giver: Garrow | reward: 2 silver', said: 'I take the Sheep-killer job again.' }], closed);
    assert.equal(thread(reopened, 'Sheep-killer').status, 'active');
    assert.equal(thread(reopened, 'Sheep-killer').ended, null);
    assert.equal(thread(reopened, 'Sheep-killer').summary, 'a second wolf');
    valid(reopened);
});

// An older chat's offer as Story Director kept it before quests went straight to active: a quest
// thread with `offer: true`, read by v1 as the hook it was offered as.
function withOldOffer(state, key) {
    const next = structuredClone(state);
    const id = next.domains.director.keys[key.toLowerCase()];
    const old = next.domains.director.threads[id];
    next.domains.director.threads[id] = { ...old, kind: 'hook', offer: true, track: { ...old.track, was: old.kind } };
    return next;
}

test('+ hook makes no quest: a job the story only mentions stays an open thread, whatever it pays', () => {
    const hook = { lines: '+ hook Watch Granary Rats — Minke wants the cellar cleared | giver: Minke | reward: 5 copper per dozen tails (up to 40)', said: 'I ask Minke for work.' };
    let state = story([hook]);
    const rats = thread(state, 'Watch Granary Rats');
    assert.deepEqual([rats.kind, rats.offer, rats.taken, rats.status], ['hook', false, null, 'active']);
    assert.equal(threads(state, { kind: 'hook' }).length, 1);
    assert.deepEqual(kinds(state), ['label']);
    valid(state);
    // The story moving it on, or the reader saying yes, does not make it a quest: only + hook does.
    state = story([{ lines: '~ hook Watch Granary Rats | step: in the cellar | reward: 6 copper a dozen', said: 'Yes, I\'ll take it.' }], state);
    assert.equal(thread(state, 'Watch Granary Rats').kind, 'hook');
    assert.equal(thread(story([{ lines: '~ hook Ferry Run | giver: Ola | reward: 2 silver' }]), 'Ferry Run').kind, 'hook', 'a ~ hook on a name not tracked');
    assert.equal(thread(story([{ lines: '+ event Market day — stalls | giver: Hobb | reward: 1 silver' }]), 'Market day').kind, 'event');
    // Closed as done, it stays a hook that closed: no quest {{user}} finished, nothing to pay.
    const done = thread(story([{ lines: '! hook Watch Granary Rats — tails turned in to Minke', said: 'I hand Minke the tails.' }], state), 'Watch Granary Rats');
    assert.deepEqual([done.kind, done.status], ['hook', 'resolved']);
    // + hook when {{user}} accepts it: the hook is the quest, active and taken on from that reply.
    state = story([{ lines: '+ hook Watch Granary Rats | giver: Minke | goal: collect 12 to 40 rat tails | reward: 5 copper per 12 tails (up to 40) | difficulty: easy' }], state);
    const quest = thread(state, 'Watch Granary Rats');
    assert.deepEqual([quest.kind, quest.offer, quest.status, quest.taken], ['hook', false, 'active', null]);
    assert.ok(!kinds(state).includes('became-quest'));
    valid(state);
    // The user's card: both lines in one reply give one quest, active at once.
    const card = story([{ lines: '+ hook Watch Granary Rats | giver: Minke | reward: 5 copper per dozen tails (up to 40)\n+ hook Watch Granary Rats | giver: Minke | goal: collect 12 to 40 rat tails from the Watch Granary cellar | reward: 5 copper per 12 tails (up to 40) | difficulty: easy', said: 'Sure.' }]);
    assert.deepEqual(threads(card).map(entry => [entry.kind, entry.offer, entry.taken]), [['hook', false, null]]);
    // Beats and agendas stay what they are.
    const start = { lines: '+ agenda Marrit — now: unloading' };
    assert.equal(thread(story([start, { lines: '+ hook Marrit — follow her', said: 'I follow Marrit.' }]), 'Marrit').kind, 'agenda');
    assert.equal(thread(story([start, { lines: '~ agenda Marrit | reward: a cut of the cargo' }]), 'Marrit').kind, 'agenda');
});

test('the carrier the host gives ({ index, swipe, key }) tells replies apart, a swipe too', () => {
    let state = makeState();
    const run = (raw, carrier, index) => {
        state = runCommand(state, part.kinds.hook.apply, readLine(raw, index), { carrier }).state;
        return state.domains.director.turn;
    };
    assert.equal(run('+ hook A — a', { index: 3, swipe: 0, key: '3:0' }, 0).n, 1);
    assert.equal(run('+ hook B — b', { index: 3, swipe: 0, key: '3:0' }, 1).n, 1);
    assert.equal(run('+ hook C — c', { index: 3, swipe: 1, key: '3:1' }, 2).n, 2, 'a swipe is another reply');
    assert.equal(run('+ hook D — d', { index: 5, swipe: 0 }, 3).n, 3, 'index and swipe without a key');
    assert.equal(replyTurn(state.domains.director).reply, '5:0');
    // The reply's record ID (`sid`, which stays with it when an earlier message is deleted) wins over its index.
    assert.equal(run('+ hook E — e', { index: 4, swipe: 0, key: '4:0', sid: 'm_reply5' }, 0).n, 4);
    assert.equal(run('+ hook F — f', { index: 4, swipe: 0, key: '4:0', sid: 'm_reply5' }, 1).n, 4);
    assert.equal(replyTurn(state.domains.director).reply, 'm_reply5');
    assert.equal(run('+ hook G — g', { index: 4, swipe: 0, key: '4:0', sid: 'm_reply6' }, 2).n, 5, 'another record at the same index');
});

test('the reply a line belongs to: the host\'s carrier when given, else the line\'s place in its block', () => {
    let state = makeState();
    const run = (raw, options) => {
        const result = runCommand(state, part.kinds.hook.apply, readLine(raw, options.index), options);
        state = result.state;
        return state.domains.director.turn;
    };
    assert.equal(run('+ hook A — a', { carrier: 3, index: 0 }).n, 1);
    assert.equal(run('+ hook B — b', { carrier: 3, index: 1 }).n, 1);
    assert.equal(run('+ hook C — c', { carrier: 5, index: 2 }).n, 2, 'another carrier');
    assert.equal(run('+ hook D — d', { index: 0 }).n, 3, 'no carrier: a first line');
    assert.equal(run('+ hook E — e', { index: 4 }).n, 3);
    assert.equal(run('+ hook F — f', { index: 2 }).n, 4, 'a line before the last one read starts another reply');
});

test('lines the Director cannot use are Problems, not errors, and change nothing else', () => {
    const start = story([{ lines: START }]);
    const asked = runCommand(start, part.kinds.hook.apply, readLine('? hook River stranger — who is she'));
    assert.equal(asked.ok, true);
    assert.deepEqual(asked.state.domains.director.threads, start.domains.director.threads);
    assert.deepEqual(kinds(asked.state), ['unread']);
    // The newest 100 are kept, each under its own key (B-b1-capture-14, B-b1r2-12: never a list
    // position): one `add` a problem, and past 100 the oldest is removed.
    let state = start;
    for (let n = 0; n < 30; n += 1) state = reply(state, `! event Riot ${n} — x\n! event Fire ${n} — y`).state;
    assert.equal(problemList(state.domains.director).length, 60);
    assert.match(problemList(state.domains.director).at(-1).text, /Fire 29/);
    for (let n = 30; n < 51; n += 1) state = reply(state, `! event Riot ${n} — x\n! event Fire ${n} — y`).state;
    assert.equal(problemList(state.domains.director).length, 100, 'the newest 100');
    assert.match(problemList(state.domains.director).at(-1).text, /Fire 50/);
    assert.match(problemList(state.domains.director).at(0).text, /Fire 1$|Riot 1$|Fire 1\b|Riot 1\b/);
    valid(state);
});

test('a swipe reads from the state before the reply: nothing of the swiped reply is left', () => {
    const before = story([{ lines: START }]);
    const first = reply(before, '+ hook Wolf Hunt — Kill ridge wolves | giver: Danique\n- hook River stranger — left', { said: 'I take the wolf hunt.', carrier: 4 }).state;
    const swipe = reply(before, '~ hook River stranger | now: at the inn', { said: 'I take the wolf hunt.', carrier: 4 }).state;
    assert.equal(thread(first, 'Wolf Hunt').kind, 'hook');
    assert.equal(thread(swipe, 'Wolf Hunt'), null);
    assert.equal(thread(swipe, 'River stranger').status, 'active');
    assert.deepEqual(replyTurn(swipe.domains.director).quests, []);
    assert.equal(swipe.domains.director.turn.n, first.domains.director.turn.n);
    assert.deepEqual(swipe, reply(before, '~ hook River stranger | now: at the inn', { said: 'I take the wolf hunt.', carrier: 4 }).state);
});

test('the same lines on the same state give the same state (ids from the receipt\'s seed)', () => {
    const lines = [{ lines: START }, { lines: '~ hook Footing in Bluewatch | now: a room', said: 'x' }];
    assert.deepEqual(story(lines), story(lines));
    const ids = threads(story(lines)).map(entry => entry.id);
    assert.equal(new Set(ids).size, ids.length);
});
