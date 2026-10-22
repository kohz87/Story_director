// Tracker part: what quest lines carry besides v1's fields — no goal (F82), `met:` (F83), the progress
// note (F85), held offers (F88) — and the story's own turn-in, checked and paid by code (F94/F95). The
// quests part answers through its queries and `quest.finish`, run in the same fake transaction.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { part } from '../../../src/v2/tracker/index.js';
import { part as quests } from '../../../src/v2/quests/index.js';
import { stateQuery } from '../../../src/v2/quests/progress.js';
import { Rejected, lastProblems, makeState, reply, story, thread } from './helpers/fake-ctx.js';

const valid = state => assert.deepEqual(part.domains.director.validate(state.domains.director, state), []);
const kinds = state => lastProblems(state).map(problem => problem.kind);

// The other modules this test stands in for: the quests part's commands (on the same ctx), a wallet.
function withQuests() {
    const paid = [];
    const call = (type, payload, ctx) => {
        if (Object.hasOwn(quests.commands, type)) return quests.commands[type](ctx, payload);
        if (type === 'wallet.receive') {
            paid.push(payload.amount);
            return { summary: `${payload.amount} received` };
        }
        throw new Rejected('UNKNOWN_COMMAND', `No command ${type}.`);
    };
    // RPG Battle's battle record, read from the state as the quests part's own fallback reads it.
    const foesBeaten = (state, args) => stateQuery(state)('combat.foesBeaten', args);
    return { paid, options: { call, queries: { ...quests.queries, 'combat.foesBeaten': foesBeaten } } };
}

// A state in a settlement (or `kind`), with fights the battle record knows.
function placeState(kind = 'settlement', beaten = []) {
    const base = makeState({ place: 'Bluewatch' });
    return Object.freeze({ ...base, domains: Object.freeze({ ...base.domains, scene: { place: { name: 'Bluewatch', kind, region: '' }, present: [] }, combat: { beaten } }) });
}

const withFights = (state, beaten) => Object.freeze({ ...state, domains: Object.freeze({ ...state.domains, combat: { beaten } }) });

test('F82: a + quest with no goal is kept and flagged once; with a goal or a target it is not', () => {
    const { options } = withQuests();
    let state = story([{ lines: '+ quest Miller Trouble — help the miller | giver: Fenna', said: 'Hm.', ...options }]);
    assert.equal(thread(state, 'Miller Trouble').kind, 'quest', 'kept');
    assert.deepEqual(kinds(state).filter(kind => kind === 'no-goal'), ['no-goal']);
    assert.match(lastProblems(state).find(problem => problem.kind === 'no-goal').text, /"Miller Trouble" has no goal/);
    // Written again later: not flagged twice.
    state = reply(state, '+ quest Miller Trouble — help the miller', { said: 'Tell me more.', ...options }).state;
    assert.deepEqual(kinds(state).filter(kind => kind === 'no-goal'), []);
    for (const line of ['+ quest Rats — the cellar | goal: find out what is in the cellar', '+ quest Rats — Kill 4 rats in the cellar', '+ quest Rats | target: 4 rats']) {
        assert.deepEqual(kinds(story([{ lines: line, said: 'Hm.', ...options }])).filter(kind => kind === 'no-goal'), [], line);
    }
    // Without the quests part, a goal: label is what counts.
    assert.deepEqual(kinds(story([{ lines: '+ quest Miller Trouble — help the miller', said: 'Hm.' }])).filter(kind => kind === 'no-goal'), ['no-goal']);
    valid(state);
});

function takenRing(options, start = placeState()) {
    return story([{ lines: '+ quest Lost Ring — Mara lost it | giver: Mara | goal: Find Mara\'s ring | reward: 20 gold', said: 'I\'ll take it.', ...options }], start);
}

test('F83: met: yes marks a taken quest code cannot count ready (with its rev), met: no clears it', () => {
    const { options } = withQuests();
    let state = takenRing(options);
    assert.ok(thread(state, 'Lost Ring').taken, 'taken in the reader\'s words');
    const before = state.meta.rev;
    state = reply(state, '~ quest Lost Ring | met: yes', { said: 'I dig in the well.', ...options }).state;
    assert.deepEqual(thread(state, 'Lost Ring').ready, { rev: before + 1 });
    assert.equal(thread(state, 'Lost Ring').rev, before + 1);
    assert.equal(thread(state, 'Lost Ring').fields.met, undefined, 'not stored as a field');
    assert.equal(quests.queries['quest.progress'](state, { key: 'Lost Ring' }).ready, true);
    valid(state);
    // Said again: nothing changes.
    const again = reply(state, '~ quest Lost Ring | met: yes', { said: 'Yes.', ...options }).state;
    assert.equal(thread(again, 'Lost Ring').rev, before + 1);
    // With a progress line beside it, both apply.
    const both = reply(state, '~ quest Lost Ring | met: no | progress: the ring was a fake', { said: 'Hm.', ...options }).state;
    assert.equal(thread(both, 'Lost Ring').ready, undefined);
    assert.equal(thread(both, 'Lost Ring').fields.step, 'the ring was a fake');
    valid(both);
});

test('F83: met: on what is not a taken quest code cannot count changes nothing and says why', () => {
    const { options } = withQuests();
    const ringOffer = story([{ lines: '+ quest Lost Ring — Mara lost it | giver: Mara | goal: Find Mara\'s ring', said: 'Hm.', ...options }]);
    const offered = reply(ringOffer, '~ quest Lost Ring | met: yes', { said: 'Hm.', ...options }).state;
    assert.equal(thread(offered, 'Lost Ring').ready, undefined);
    assert.match(lastProblems(offered).at(-1).text, /not taken on yet/);
    // With a battle record (RPG Battle), a kill goal is counted by code.
    const wolves = withFights(story([{ lines: '+ quest Wolves — on the ridge | giver: Orsa | goal: Kill 3 wolves', said: 'I\'ll take it.', ...options }]), []);
    const counted = reply(wolves, '~ quest Wolves | met: yes', { said: 'Hm.', ...options }).state;
    assert.equal(thread(counted, 'Wolves').ready, undefined);
    assert.match(lastProblems(counted).at(-1).text, /counted by code/);
    // Without one (Story Director alone, WAVE rule 11), the story vouches for it: met: yes marks it ready.
    const alone = story([{ lines: '+ quest Wolves — on the ridge | giver: Orsa | goal: Kill 3 wolves', said: 'I\'ll take it.', ...options }]);
    const vouched = reply(alone, '~ quest Wolves | met: yes', { said: 'Hm.', ...options }).state;
    assert.ok(thread(vouched, 'Wolves').ready, 'ready on the story\'s word');
    const unknown = reply(wolves, '~ quest Nobody Knows | met: yes', { said: 'Hm.', ...options }).state;
    assert.equal(thread(unknown, 'Nobody Knows'), null, 'no thread made from a met: line');
    assert.deepEqual(kinds(unknown), ['met']);
    const unread = reply(takenRing(options), '~ quest Lost Ring | met: perhaps', { said: 'Hm.', ...options }).state;
    assert.match(lastProblems(unread).at(-1).text, /"met: perhaps" .* is not yes or no/);
});

test('F85: progress: is the quest\'s one-line note (v1\'s step), only the latest kept, at most 160 characters', () => {
    const { options } = withQuests();
    let state = takenRing(options);
    state = reply(state, '~ quest Lost Ring | progress: searching the well', { said: 'Hm.', ...options }).state;
    assert.equal(thread(state, 'Lost Ring').fields.step, 'searching the well');
    state = reply(state, `~ quest Lost Ring | progress: ${'down the well, '.repeat(20)}`, { said: 'Hm.', ...options }).state;
    const step = thread(state, 'Lost Ring').fields.step;
    assert.equal(step.length, 160);
    assert.ok(step.endsWith('…'));
    // A step written beside it wins; v1's step: is the same note.
    state = reply(state, '~ quest Lost Ring | step: at the bottom | progress: ignored', { said: 'Hm.', ...options }).state;
    assert.equal(thread(state, 'Lost Ring').fields.step, 'at the bottom');
    assert.equal(thread(state, 'Lost Ring').fields.progress, 'ignored', 'kept as written, the step shows');
    valid(state);
});

test('F88: an offer within the cooldown of the last one is held (kept, shown later), with no Problem', () => {
    const { options } = withQuests();
    let state = story([{ lines: '+ quest First Job — wolves | giver: Orsa | goal: Kill 2 wolves', said: 'Work?', ...options }]);
    const first = thread(state, 'First Job');
    assert.deepEqual([first.offer, first.shown], [true, { turn: 1 }]);
    state = reply(state, '+ quest Second Job — rats | giver: Hobb | goal: Kill 2 rats', { said: 'More work?', ...options }).state;
    const second = thread(state, 'Second Job');
    assert.deepEqual([second.offer, second.shown], [true, { turn: 7 }], 'six replies after the first');
    assert.deepEqual(kinds(state).filter(kind => kind !== 'offered'), [], 'no Problem for holding it');
    // A third waits behind the second.
    state = reply(state, '+ quest Third Job — bears | giver: Hobb | goal: Kill 1 bear', { said: 'And?', ...options }).state;
    assert.deepEqual(thread(state, 'Third Job').shown, { turn: 13 });
    valid(state);
    // The reader's setting: 0 is no cooldown; another number is that many replies.
    const off = story([
        { lines: '+ quest First Job — wolves | giver: Orsa | goal: Kill 2 wolves', said: 'Work?', settings: { offerCooldown: 0 }, ...options },
        { lines: '+ quest Second Job — rats | giver: Hobb | goal: Kill 2 rats', said: 'More?', settings: { offerCooldown: 0 }, ...options },
    ]);
    assert.deepEqual(thread(off, 'Second Job').shown, { turn: 2 });
    const two = story([
        { lines: '+ quest First Job — wolves | giver: Orsa | goal: Kill 2 wolves', said: 'Work?', settings: { offerCooldown: 2 }, ...options },
        { lines: '+ quest Second Job — rats | giver: Hobb | goal: Kill 2 rats', said: 'More?', settings: { offerCooldown: 2 }, ...options },
    ]);
    assert.deepEqual(thread(two, 'Second Job').shown, { turn: 3 });
    // A quest the reader takes on at once is no offer and never held.
    const taken = reply(state, '+ quest Fourth Job — boars | giver: Hobb | goal: Kill 1 boar', { said: 'I\'ll take it.', ...options }).state;
    assert.equal(thread(taken, 'Fourth Job').shown, undefined);
});

test('F88: the quests part\'s offerCooldown setting reaches the tracker through the module (reads)', () => {
    assert.deepEqual(part.settings.reads, { offerCooldown: 'quests.offerCooldown' });
    assert.equal(quests.settings.defaults.offerCooldown, 6);
    assert.deepEqual(quests.settings.schema.offerCooldown, { type: 'int', label: 'Replies between quest offers (0: no limit)', min: 0, max: 100 });
});

function wolfCull(options, kind = 'settlement') {
    return story([{ lines: '+ quest Wolf Cull — the ridge | giver: Orsa | goal: Kill 3 wolves | reward: 2 gold each', said: 'I\'ll take it.', ...options }], placeState(kind));
}

test('F94: the story turning in a taken quest that meets every check pays it, as Finish does, in one receipt', () => {
    const { paid, options } = withQuests();
    let state = wolfCull(options);
    const taken = thread(state, 'Wolf Cull').taken.rev;
    state = withFights(state, [{ rev: taken + 1, foes: [{ name: 'Wolf', count: 3 }], won: true }]);
    const { state: after, results } = reply(state, '- quest Wolf Cull — turned in to Orsa', { said: 'Here are the pelts.', ...options });
    assert.deepEqual(paid, [6]);
    assert.equal(results.length, 1);
    assert.equal(results[0].summary, 'The party turns in Wolf Cull: 3 wolves beaten (target 3), 6 gold paid.');
    assert.equal(results[0].narrate, true);
    assert.equal(results[0].data.turnIn.by, 'story');
    const closed = thread(after, 'Wolf Cull');
    assert.deepEqual([closed.status, closed.ended.outcome, closed.ended.reason], ['resolved', 'done', 'turned in']);
    assert.ok(after.meta.claims[`quest:${closed.id}:paid`]);
    assert.ok(after.meta.claims[`beaten:${taken + 1}`], 'the fight is claimed');
    valid(after);
    // No double pay: the story saying so again, or Finish later, changes nothing.
    const again = reply(after, '- quest Wolf Cull — turned in', { said: 'Again.', ...options }).state;
    assert.deepEqual(paid, [6]);
    assert.deepEqual(kinds(again), ['already-closed']);
});

test('F94: a step or status saying turned in counts the same as the - line', () => {
    const { paid, options } = withQuests();
    let state = wolfCull(options);
    state = withFights(state, [{ rev: thread(state, 'Wolf Cull').taken.rev + 1, foes: [{ name: 'Wolf', count: 4 }], won: true }]);
    const after = reply(state, '~ quest Wolf Cull | step: turned in', { said: 'Done.', ...options }).state;
    assert.deepEqual(paid, [6], 'per wolf beaten, up to the target\'s 3 (B-b4-10)');
    assert.equal(thread(after, 'Wolf Cull').status, 'resolved');
});

test('F94: a check that fails keeps the quest open, unpaid, with a Problem and a receipt the next reply hears', () => {
    const { paid, options } = withQuests();
    let state = wolfCull(options);
    state = withFights(state, [{ rev: thread(state, 'Wolf Cull').taken.rev + 1, foes: [{ name: 'Wolf', count: 2 }], won: true }]);
    const { state: after, results } = reply(state, '- quest Wolf Cull — turned in', { said: 'Here.', ...options });
    const text = 'The story says Wolf Cull was turned in, but only 2 of 3 wolves are beaten; it stays open.';
    assert.deepEqual(paid, []);
    assert.equal(thread(after, 'Wolf Cull').status, 'active');
    assert.deepEqual(lastProblems(after).map(problem => [problem.kind, problem.text]), [['turn-in', text]]);
    assert.deepEqual([results[0].summary, results[0].narrate], [text, true]);
    assert.equal(Object.keys(after.meta.claims).some(key => key.startsWith('quest:')), false, 'nothing claimed');
    valid(after);
    // Away from a settlement and the giver: the place is the reason.
    let away = wolfCull(options, 'wild');
    away = withFights(away, [{ rev: thread(away, 'Wolf Cull').taken.rev + 1, foes: [{ name: 'Wolf', count: 3 }], won: true }]);
    const wild = reply(away, '- quest Wolf Cull — done', { said: 'Done.', ...options }).state;
    assert.equal(lastProblems(wild)[0].text, 'The story says Wolf Cull was turned in, but it can only be turned in at a settlement or where Orsa is; it stays open.');
    assert.equal(thread(wild, 'Wolf Cull').status, 'active');
    // No battle record at all (Story Director alone): the kill goal is the story's word, and it is paid.
    const none = reply(Object.freeze({ ...wolfCull(options), domains: Object.freeze({ ...wolfCull(options).domains, combat: undefined }) }), '- quest Wolf Cull — done', { said: 'Done.', ...options });
    assert.match(none.results[0].summary, /^The party turns in Wolf Cull: goal met .*on the story's word \(no fights are counted\), \d+ gold paid\.$/);
    assert.equal(thread(none.state, 'Wolf Cull').status, 'resolved');
});

test('F94: a quest code cannot count is taken on the story\'s word at turn-in, met: yes or not', () => {
    const { paid, options } = withQuests();
    const { state, results } = reply(takenRing(options), '- quest Lost Ring — returned it to Mara', { said: 'Here is your ring.', ...options });
    assert.deepEqual(paid, [20]);
    assert.equal(results[0].summary, 'The party turns in Lost Ring: goal met (Find Mara\'s ring), 20 gold paid.');
    assert.equal(thread(state, 'Lost Ring').ended.outcome, 'done');
    valid(state);
});

test('F94: failing, giving up and an untaken quest are read as before; without the quests part, as before', () => {
    const { paid, options } = withQuests();
    const failed = reply(wolfCull(options), '- quest Wolf Cull — failed, the wolves fled', { said: 'Damn.', ...options }).state;
    assert.deepEqual([thread(failed, 'Wolf Cull').ended.outcome, paid], ['failed', []]);
    // A quest the story closes that was never taken on closes as the story says (no pay).
    const loose = story([{ lines: '+ quest The Bond — pay it off | type: main | goal: pay the debt' }]);
    const closed = reply(loose, '- quest The Bond — done', {}).state;
    assert.equal(thread(closed, 'The Bond').ended.outcome, 'done');
    // Without the quests part a counted quest keeps v1's rule: the story's word is not a turn-in.
    const bare = story([{ lines: '+ quest Wolf Cull — the ridge | giver: Orsa | goal: Kill 3 wolves', said: 'I\'ll take it.' }]);
    assert.equal(thread(bare, 'Wolf Cull').status, 'active');
});

test('F88: a held offer is left out of the Director note until its reply comes', () => {
    const { options } = withQuests();
    let state = story([{ lines: '+ quest First Job — wolves | giver: Orsa | goal: Kill 2 wolves', said: 'Work?', ...options }]);
    state = reply(state, '+ quest Second Job — rats | giver: Hobb | goal: Kill 2 rats', { said: 'More?', ...options }).state;
    const note = view => part.context.tail({ state: view, settings: {}, chat: { length: 2, lastUser: '' } }).lines.join('\n');
    assert.match(note(state), /First Job/);
    assert.doesNotMatch(note(state), /Second Job/);
    // Its reply comes: told again.
    const later = Object.freeze({ ...state, domains: Object.freeze({ ...state.domains, director: { ...state.domains.director, turn: { ...state.domains.director.turn, n: 7 } } }) });
    assert.match(note(later), /Second Job/);
});

test('F94: swiping or rebuilding the turn-in reply is deterministic: the same lines give the same state', () => {
    const run = () => {
        const { options } = withQuests();
        let state = wolfCull(options);
        state = withFights(state, [{ rev: thread(state, 'Wolf Cull').taken.rev + 1, foes: [{ name: 'Wolf', count: 3 }], won: true }]);
        return reply(state, '- quest Wolf Cull — turned in', { said: 'Here.', ...options }).state;
    };
    assert.deepEqual(run(), run());
});

test('F83/F94: met: yes and the turn-in in one reply; a met line after the close changes nothing', () => {
    const { paid, options } = withQuests();
    const { state } = reply(takenRing(options), '~ quest Lost Ring | met: yes\n- quest Lost Ring — returned', { said: 'Here.', ...options });
    assert.deepEqual(paid, [20]);
    const after = reply(state, '~ quest Lost Ring | met: no', { said: 'Hm.', ...options }).state;
    assert.equal(thread(after, 'Lost Ring').status, 'resolved');
    assert.match(lastProblems(after).at(-1).text, /not an open quest/);
});

test('F88: an offer kept from before offers were marked is never held by a later line', () => {
    const { options } = withQuests();
    let state = story([{ lines: '+ quest Old Offer — wolves | giver: Orsa | goal: Kill 2 wolves', said: 'Work?', ...options }]);
    // As stored by an older version: no `shown`.
    const director = structuredClone(state.domains.director);
    delete director.threads[thread(state, 'Old Offer').id].shown;
    state = Object.freeze({ ...state, domains: Object.freeze({ ...state.domains, director }) });
    state = reply(state, '+ quest New Offer — rats | giver: Hobb | goal: Kill 2 rats', { said: 'More?', ...options }).state;
    state = reply(state, '~ quest Old Offer | reward: 5 gold', { said: 'Hm.', ...options }).state;
    assert.equal(thread(state, 'Old Offer').shown, undefined);
    assert.equal(thread(state, 'Old Offer').offer, true);
});
