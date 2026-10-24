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
    assert.equal(toV1Op(readLine('~ quest Wolves — step: done — the pack is dead | reward: 2 silver')).op.fields.step, 'done — the pack is dead');
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
    state = story([{ lines: '~ quest Kettle Jack bounty | giver: Warden Hale | reward: 40 crowns' }]);
    assert.equal(thread(state, 'Kettle Jack bounty').kind, 'quest');
    state = story([{ lines: '~ quest North Levee Vipers | step: completed, voucher paid' }], makeState());
    assert.deepEqual(threads(state), []);
    assert.deepEqual(kinds(state), ['unknown-key']);
    // ! with nothing tracked changes nothing and is corrected; a - is only a note.
    state = story([{ lines: '! event Riot — the square burns\n- hook Ghost — gone' }]);
    assert.deepEqual(threads(state), []);
    assert.deepEqual(lastProblems(state).map(problem => [problem.kind, problem.severity]), [['unknown-key', 'warn'], ['unknown-key', 'info']]);
});

test('a line under a label ("! event Encounter — …") is skipped quietly', () => {
    const state = story([{ lines: '+ hook Sheepfold Wolves — wolves at the east fold' }, { lines: '! event Encounter — 4 wolves attack\n~ quest Quest | step: fight' }]);
    assert.equal(threads(state).length, 1);
    assert.deepEqual(kinds(state), ['label-key', 'label-key']);
});

const QUEST = '+ quest Sheep-killer — kill the wolf | giver: Garrow | step: track it to the den | reward: 2 silver';
const TAKEN = { lines: QUEST, said: 'I take the Sheep-killer job.' };

test('a quest closed without a - line: step done, status completed, a ! that says so (v1 0.9.1)', () => {
    for (const line of [
        '~ quest Sheep-killer | step: done',
        '~ quest Sheep-killer | status: completed',
        '~ quest Sheep-killer — step: completed — the wolf is dead, Garrow paid',
        '! quest Sheep-killer — the wolf is slain and the reward paid',
        '! quest Sheep-killer — quest completed',
    ]) {
        const state = story([TAKEN, { lines: line }]);
        const quest = thread(state, 'Sheep-killer');
        assert.equal(quest.status, 'resolved', line);
        assert.equal(quest.ended.outcome, 'done', line);
        assert.equal(quest.ended.rev, 2, line);
        assert.equal(kinds(state)[0], 'closed-by-change', line);
        valid(state);
    }
    const failed = thread(story([TAKEN, { lines: '~ quest Sheep-killer | outcome: failed — the flock is lost' }]), 'Sheep-killer');
    assert.equal(failed.status, 'resolved');
    assert.equal(failed.ended.outcome, 'failed');
    for (const line of ['~ quest Sheep-killer | step: complete the hunt at dawn', '~ quest Sheep-killer | step: done tracking, now the den', '! quest Sheep-killer — tracks found by the river']) {
        assert.equal(thread(story([TAKEN, { lines: line }]), 'Sheep-killer').status, 'active', line);
    }
    // Other kinds close on a status, not on their now.
    assert.equal(thread(story([{ lines: '+ hook River stranger — who' }, { lines: '~ hook River stranger | status: resolved' }]), 'River stranger').status, 'resolved');
    assert.equal(thread(story([{ lines: '+ agenda Geva — plots | now: waiting' }, { lines: '~ agenda Geva | now: done.' }]), 'Geva').status, 'active');
});

test('a step that opens with the ending and confirms it closes the quest (v1 0.9.42)', () => {
    const start = { lines: '+ quest EastBluffWolves — hunt the crag wolves | giver: Fenna | step: find the pack | reward: 2 gold', said: 'I accept the EastBluffWolves job.' };
    for (const line of [
        '~ quest EastBluffWolves | step: Completed and turned in to Fenna',
        '~ quest EastBluffWolves | step: Done — bounty paid by Fenna',
        '~ quest EastBluffWolves | step: Completed and reported | reward: Claimed 2 gold',
        '~ quest EastBluffWolves | step: cleared and turned in for 60 copper',
    ]) {
        assert.equal(thread(story([start, { lines: line }]), 'EastBluffWolves').ended?.outcome, 'done', line);
    }
    for (const line of [
        '~ quest EastBluffWolves | step: Completed and heading back to Fenna',
        '~ quest EastBluffWolves | step: Completed and heading back | reward: 2 gold, paid on return',
        '~ quest EastBluffWolves | step: Finished the hunt, pelts to skin',
    ]) {
        assert.equal(thread(story([start, { lines: line }]), 'EastBluffWolves').status, 'active', line);
    }
});

test('closing a closed thread again changes nothing; a + reopens it (v1 0.9.7)', () => {
    const closed = story([TAKEN, { lines: '- quest Sheep-killer — the wolf is dead' }]);
    const ended = thread(closed, 'Sheep-killer').ended;
    for (const line of ['- quest Sheep-killer — the wolf is dead', '~ quest Sheep-killer | status: completed', '! quest Sheep-killer — reward paid']) {
        const again = reply(closed, line).state;
        assert.deepEqual(thread(again, 'Sheep-killer').ended, ended, line);
        assert.deepEqual(kinds(again), ['already-closed'], line);
    }
    const reopened = story([{ lines: '+ quest Sheep-killer — a second wolf | giver: Garrow | reward: 2 silver', said: 'I take the Sheep-killer job again.' }], closed);
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
    next.domains.director.threads[id] = { ...old, kind: 'quest', offer: true, track: { ...old.track, was: old.kind } };
    return next;
}

test('+ quest is active and taken on at once, whatever the reader\'s message said', () => {
    const offers = '+ quest Rat Culling — Kill granary rats | type: side | giver: Danique | reward: 8 copper a sack\n+ quest Wolf Hunt — Kill ridge wolves | type: side | giver: Danique | reward: 4 silver';
    const state = story([{ lines: offers, said: 'I pay the fee and ask what work there is.' }]);
    assert.deepEqual(threads(state).map(entry => [entry.key, entry.kind, entry.offer, entry.taken]), [['Rat Culling', 'quest', false, { rev: 1 }], ['Wolf Hunt', 'quest', false, { rev: 2 }]]);
    // Neither names a goal code can read (F82): kept, and flagged. Nothing is "offered".
    assert.deepEqual(kinds(state), ['no-goal', 'no-goal']);
    assert.equal(threads(state, { offer: true }).length, 0);
    valid(state);
    const single = '+ quest Wolf Hunt — Kill ridge wolves | giver: Danique | reward: 4 silver';
    for (const said of [null, '', 'Yes.', 'I won\'t take it.', 'What does it pay?']) {
        const wolf = thread(story([{ lines: single, said }]), 'Wolf Hunt');
        assert.deepEqual([wolf.kind, wolf.offer, wolf.status, wolf.taken], ['quest', false, 'active', { rev: 1 }], String(said));
    }
    assert.deepEqual(thread(story([{ lines: '+ quest The bond — pay it off | type: main' }]), 'The bond').taken, { rev: 1 });
    // A quest with nothing but its name is a quest too, and no type is stored for it.
    const cat = thread(story([{ lines: '+ quest Find the cat — the widow\'s cat is lost', said: 'I listen.' }]), 'Find the cat');
    assert.deepEqual([cat.kind, cat.offer, cat.fields, cat.taken], ['quest', false, {}, { rev: 1 }]);
    // A quest already taken is not taken again by a later + quest line.
    const again = story([{ lines: '+ quest Wolf Hunt — Kill 3 ridge wolves', said: 'Yes, the wolves.' }], story([{ lines: single }]));
    assert.deepEqual(thread(again, 'Wolf Hunt').taken, { rev: 1 });
});

test('+ hook makes no quest: a job the story only mentions stays an open thread, whatever it pays', () => {
    const hook = { lines: '+ hook Watch Granary Rats — Minke wants the cellar cleared | giver: Minke | reward: 5 copper per dozen tails (up to 40)', said: 'I ask Minke for work.' };
    let state = story([hook]);
    const rats = thread(state, 'Watch Granary Rats');
    assert.deepEqual([rats.kind, rats.offer, rats.taken, rats.status], ['hook', false, null, 'active']);
    assert.deepEqual(threads(state, { kind: 'quest' }), []);
    assert.deepEqual(kinds(state), []);
    valid(state);
    // The story moving it on, or the reader saying yes, does not make it a quest: only + quest does.
    state = story([{ lines: '~ hook Watch Granary Rats | step: in the cellar | reward: 6 copper a dozen', said: 'Yes, I\'ll take it.' }], state);
    assert.equal(thread(state, 'Watch Granary Rats').kind, 'hook');
    assert.equal(thread(story([{ lines: '~ hook Ferry Run | giver: Ola | reward: 2 silver' }]), 'Ferry Run').kind, 'hook', 'a ~ hook on a name not tracked');
    assert.equal(thread(story([{ lines: '+ event Market day — stalls | giver: Hobb | reward: 1 silver' }]), 'Market day').kind, 'event');
    // Closed as done, it stays a hook that closed: no quest {{user}} finished, nothing to pay.
    const done = thread(story([{ lines: '! hook Watch Granary Rats — tails turned in to Minke', said: 'I hand Minke the tails.' }], state), 'Watch Granary Rats');
    assert.deepEqual([done.kind, done.status], ['hook', 'resolved']);
    // + quest when {{user}} accepts it: the hook is the quest, active and taken on from that reply.
    state = story([{ lines: '+ quest Watch Granary Rats | giver: Minke | goal: collect 12 to 40 rat tails | reward: 5 copper per 12 tails (up to 40) | difficulty: easy' }], state);
    const quest = thread(state, 'Watch Granary Rats');
    assert.deepEqual([quest.kind, quest.offer, quest.status, quest.taken], ['quest', false, 'active', { rev: 3 }]);
    assert.ok(kinds(state).includes('became-quest'));
    valid(state);
    // The user's card: both lines in one reply give one quest, active at once.
    const card = story([{ lines: '+ hook Watch Granary Rats | giver: Minke | reward: 5 copper per dozen tails (up to 40)\n+ quest Watch Granary Rats | giver: Minke | goal: collect 12 to 40 rat tails from the Watch Granary cellar | reward: 5 copper per 12 tails (up to 40) | difficulty: easy', said: 'Sure.' }]);
    assert.deepEqual(threads(card).map(entry => [entry.kind, entry.offer, entry.taken]), [['quest', false, { rev: 2 }]]);
    // Beats and agendas stay what they are.
    const start = { lines: '+ agenda Marrit — now: unloading' };
    assert.equal(thread(story([start, { lines: '+ quest Marrit — follow her', said: 'I follow Marrit.' }]), 'Marrit').kind, 'agenda');
    assert.equal(thread(story([start, { lines: '~ agenda Marrit | reward: a cut of the cargo' }]), 'Marrit').kind, 'agenda');
});

test('"- … taken on" makes a hook the quest; "- hook Key" beside the reply\'s "+ quest Key" does not end it (v1 0.9.13, 0.9.20)', () => {
    const hook = { lines: '+ hook Lone Grey Wolf — Hunt the lone wolf killing sheep | giver: Verna' };
    const pair = "+ quest Lone Grey Wolf — Hunt the wolf pack | type: bounty | giver: Verna | reward: 1 gold\n- hook Lone Grey Wolf — Hunt the lone wolf killing sheep";
    for (const said of ["I'll take the wolf bounty.", 'I look around the square.']) {
        const state = story([hook, { lines: pair, said }]);
        const wolf = thread(state, 'Lone Grey Wolf');
        assert.deepEqual([wolf.kind, wolf.status, wolf.offer, wolf.taken], ['quest', 'active', false, { rev: 2 }], said);
        // A quest with no goal code can read is flagged once (F82).
        assert.deepEqual(kinds(state), ['became-quest', 'no-goal', 'taken-on'], said);
    }
    const state = story([hook, { lines: pair }]);
    // With nothing tracked before, the same pair leaves the quest open.
    assert.equal(thread(story([{ lines: pair }]), 'Lone Grey Wolf').status, 'active');
    // A reason that says the job is over ends it, in the same reply or a later one.
    assert.equal(thread(story([hook, { lines: "+ quest Lone Grey Wolf — hunt it | giver: Verna\n- quest Lone Grey Wolf — done, Verna paid" }]), 'Lone Grey Wolf').status, 'resolved');
    assert.equal(thread(story([{ lines: '- quest Lone Grey Wolf — cleared' }], state), 'Lone Grey Wolf').status, 'resolved');
    // A later reply's plain "- hook Key — …" is an ending: the + quest was another reply's.
    assert.equal(thread(story([{ lines: '- hook Lone Grey Wolf — Hunt the lone wolf killing sheep' }], state), 'Lone Grey Wolf').status, 'resolved');
    // "- … taken on by" on the hook alone: the story says it was accepted, so it is the quest, taken on.
    const accepted = thread(story([hook, { lines: '- hook Lone Grey Wolf — taken on by Wessel' }]), 'Lone Grey Wolf');
    assert.deepEqual([accepted.kind, accepted.status, accepted.offer, accepted.taken], ['quest', 'active', false, { rev: 2 }]);
});

test('an older chat\'s offer loads, stays as it is, and becomes the quest when the story writes + quest', () => {
    const old = withOldOffer(story([{ lines: '+ hook Herb run — moonleaf for the healer | giver: Mother Ysolde | reward: 5 copper', said: 'Hello.' }]), 'Herb run');
    valid(old);
    assert.deepEqual([thread(old, 'Herb run').kind, thread(old, 'Herb run').offer], ['quest', true]);
    // A ~ on it changes its parts and nothing else: it is no quest of {{user}}'s yet.
    const touched = story([{ lines: '~ hook Herb run | now: the healer waits', said: 'I take it.' }], old);
    assert.deepEqual([thread(touched, 'Herb run').kind, thread(touched, 'Herb run').offer, thread(touched, 'Herb run').taken], ['quest', true, null]);
    valid(touched);
    // + quest: taken on from that reply.
    const taken = story([{ lines: '+ quest Herb run — moonleaf | goal: bring 5 moonleaf', said: 'Hm.' }], old);
    assert.deepEqual([thread(taken, 'Herb run').kind, thread(taken, 'Herb run').offer, thread(taken, 'Herb run').taken], ['quest', false, { rev: 2 }]);
    valid(taken);
    // Turned down in the reader's words, it closes as before.
    const declined = thread(story([{ lines: '- quest Herb run — declined', said: 'No thanks, I am not picking herbs.' }], old), 'Herb run');
    assert.deepEqual([declined.kind, declined.status, declined.ended.outcome], ['quest', 'resolved', 'declined']);
    // An older chat's quest nothing took on (no reader message then) is taken on by a later + quest.
    const untaken = structuredClone(story([{ lines: '+ quest Wolf Hunt — Kill 3 ridge wolves | giver: Danique' }]));
    untaken.domains.director.threads[thread(untaken, 'Wolf Hunt').id].taken = null;
    assert.deepEqual(thread(story([{ lines: '+ quest Wolf Hunt — Kill 3 ridge wolves' }], untaken), 'Wolf Hunt').taken, { rev: 2 });
});

test('+ quest asks part quests to take it on (quest.take) when the module has it, with or without a message', () => {
    for (const said of ['I\'ll take it.', null]) {
        const calls = [];
        const call = (type, payload) => { calls.push({ type, payload }); };
        const run = runCommand(makeState(), part.kinds.quest.apply, readLine('+ quest Wolf Hunt — Kill 3 wolves | giver: Danique'), { said, call });
        assert.equal(run.ok, true, run.message);
        assert.deepEqual(calls.map(entry => entry.type), ['quest.take']);
        assert.equal(calls[0].payload.id, run.result.data.thread);
    }
    // A + hook asks nothing.
    const calls = [];
    runCommand(makeState(), part.kinds.hook.apply, readLine('+ hook Wolf Hunt — Kill 3 wolves | giver: Danique | reward: 1 gold'), { said: 'Yes.', call: type => calls.push(type) });
    assert.deepEqual(calls, []);
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

test('giving up and turning down are the reader\'s; failing is the story\'s (v1 0.9.6, 0.9.15)', () => {
    const start = { lines: '+ quest Wolf Hunt — Kill ridge wolves | giver: Danique | reward: 4 silver', said: 'I take the wolf hunt.' };
    let state = story([start, { lines: '- quest Wolf Hunt — abandoned', said: 'I look around the fold.' }]);
    assert.equal(thread(state, 'Wolf Hunt').status, 'active');
    assert.deepEqual(kinds(state), ['not-chosen']);
    assert.equal(thread(story([start, { lines: '~ quest Wolf Hunt | status: abandoned', said: 'Onward.' }]), 'Wolf Hunt').status, 'active');
    for (const [said, line] of [
        ['I give up on the wolf hunt, it is hopeless.', '- quest Wolf Hunt — abandoned'],
        ['Tell Danique I quit.', '~ quest Wolf Hunt | outcome: forfeit'],
        ['I walk away from the wolf hunt.', '! quest Wolf Hunt — Ren walked away from the hunt'],
    ]) {
        const ended = thread(story([start, { lines: line, said }]), 'Wolf Hunt').ended;
        assert.equal(ended?.outcome, 'abandoned', line);
    }
    for (const reason of ['failed, the wolves scattered the flock', 'expired at sundown', 'called off after the flood']) {
        assert.equal(thread(story([start, { lines: `- quest Wolf Hunt — ${reason}`, said: 'Hm.' }]), 'Wolf Hunt').ended?.outcome, 'failed', reason);
    }
    assert.equal(thread(story([start, { lines: '- quest Wolf Hunt — turned in, quite a haul', said: 'Hm.' }]), 'Wolf Hunt').ended.outcome, 'done', '"quite" is not "quit"');
});

test('a quest with only its pay left is not failed for the hour passing (v1 0.9.28)', () => {
    const start = { lines: '+ quest Lone Grey Wolf — hunt the pack | giver: Verna | reward: 1 gold\n~ quest Lone Grey Wolf | step: turn in voucher at bailiff hatch on Friday noon | due: Goldwane 14, 12:00 pm', said: 'I take the Lone Grey Wolf job.' };
    for (const line of ['- quest Lone Grey Wolf — failed: deadline passed', '- quest Lone Grey Wolf — voucher expired, too late', '~ quest Lone Grey Wolf | status: failed (missed the window)']) {
        const state = story([start, { lines: line, said: 'I wait.' }]);
        assert.equal(thread(state, 'Lone Grey Wolf').status, 'active', line);
        assert.ok(kinds(state).includes('pay-waiting'), line);
    }
    assert.equal(thread(story([start, { lines: '- quest Lone Grey Wolf — voucher cashed, 1 gold paid' }]), 'Lone Grey Wolf').ended.outcome, 'done');
    assert.equal(thread(story([start, { lines: '- quest Lone Grey Wolf — failed: the bailiff tore up the voucher' }]), 'Lone Grey Wolf').ended.outcome, 'failed');
    // While the work is still to do, a passed deadline fails it.
    const hunting = { lines: '+ quest Wolves — hunt the pack | giver: Verna | step: track the pack | due: Goldwane 14', said: 'I take the wolves job.' };
    const failed = thread(story([hunting, { lines: '- quest Wolves — failed: deadline passed' }]), 'Wolves');
    assert.deepEqual([failed.ended.outcome, failed.ended.reason], ['failed', 'failed: deadline passed']);
});

test('taken, target and reward (part quests) stay as they are; a code-checked target is not closed by the story', () => {
    const offered = story([{ lines: '+ quest Rat Culling — Kill granary rats | giver: Danique | reward: 8 copper', said: 'Hm.' }]);
    const id = thread(offered, 'Rat Culling').id;
    // What SD-quests' quest.take would write.
    const director = structuredClone(offered.domains.director);
    Object.assign(director.threads[id], { kind: 'quest', offer: false, taken: { rev: 2 }, target: { noun: 'rat', count: 5, kind: 'foes' }, reward: { amount: 8, each: false, unit: 'copper', text: '8 copper' } });
    let state = { ...offered, domains: { ...offered.domains, director } };
    state = story([{ lines: '~ quest Rat Culling | step: two sacks so far' }], state);
    const quest = thread(state, 'Rat Culling');
    assert.deepEqual([quest.kind, quest.offer, quest.fields.step], ['quest', false, 'two sacks so far']);
    assert.deepEqual(quest.taken, { rev: 2 });
    assert.deepEqual(quest.target, { noun: 'rat', count: 5, kind: 'foes' });
    assert.deepEqual(quest.reward, { amount: 8, each: false, unit: 'copper', text: '8 copper' });
    // "Done" is the Finish's to say; a failure is still the story's.
    const done = story([{ lines: '- quest Rat Culling — all rats dead, Danique paid' }], state);
    assert.equal(thread(done, 'Rat Culling').status, 'active');
    assert.deepEqual(kinds(done), ['unverified-completion']);
    const failed = story([{ lines: '- quest Rat Culling — failed, the granary burned' }], state);
    assert.deepEqual(thread(failed, 'Rat Culling').ended, { rev: 3, reason: 'failed, the granary burned', outcome: 'failed' });
    assert.deepEqual(thread(failed, 'Rat Culling').taken, { rev: 2 });
    valid(failed);
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
    const first = reply(before, '+ quest Wolf Hunt — Kill ridge wolves | giver: Danique\n- hook River stranger — left', { said: 'I take the wolf hunt.', carrier: 4 }).state;
    const swipe = reply(before, '~ hook River stranger | now: at the inn', { said: 'I take the wolf hunt.', carrier: 4 }).state;
    assert.equal(thread(first, 'Wolf Hunt').kind, 'quest');
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
