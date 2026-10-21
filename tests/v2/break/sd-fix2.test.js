// Coordinator decisions after the break rounds ("code sets numbers"): a rank the story writes is at most
// one above the party's own, and a thread's summary is at most 600 characters.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { part as quests } from '../../../src/v2/quests/index.js';
import { DEFAULT_RANKS, WRITTEN_RANKS_ABOVE, questRank } from '../../../src/v2/quests/ranks.js';
import { SUMMARY_CHARS, capSummary } from '../../../src/v2/tracker/capture.js';
import { fakeQueries, makeHost, makeState as questState, quest } from '../quests/helpers/fake-ctx.js';
import { lastProblems, makeState, reply, thread } from '../tracker/helpers/fake-ctx.js';
import { problemList } from '../../../src/v2/tracker/domain.js';

const take = quests.commands['quest.take'];
const finish = quests.commands['quest.finish'];

// A taken-on wolf quest with `fields`, a party at `level`, three wolves beaten after it was taken.
function wolves(fields, { level = 1, queries = fakeQueries } = {}) {
    const state = questState({ threads: [quest('th_wolves01', 'Wolves', { giver: 'Orsa', goal: 'Kill 3 wolves', ...fields }, { offer: true })], scene: { place: { kind: 'settlement' } } });
    state.domains.party.actors.ac_astra001.level = level;
    const host = makeHost(state, { queries });
    const taken = host.run(take, { id: 'th_wolves01' });
    assert.equal(taken.ok, true, taken.message);
    host.state.domains.combat.beaten = [{ rev: 20, foes: [{ name: 'Wolf', count: 3 }], won: true }];
    return { host, taken };
}

const rankProblems = host => problemList(host.state.domains.director).filter(problem => problem.kind === 'rank-held');

test('questRank: a written rank is held to one above the party\'s own; a pack\'s rank is not', () => {
    assert.equal(WRITTEN_RANKS_ABOVE, 1);
    const S = { fields: { rank: 'S' } };
    // Level 12: the party is E (6–12), so a written rank is at most D.
    assert.deepEqual(questRank(S, DEFAULT_RANKS, { level: 12 }), { rank: DEFAULT_RANKS[2], by: 'written', said: DEFAULT_RANKS[6] });
    assert.deepEqual(questRank({ fields: { rank: 'D' } }, DEFAULT_RANKS, { level: 12 }), { rank: DEFAULT_RANKS[2], by: 'written' });
    assert.equal(questRank(S, DEFAULT_RANKS, { level: null }).rank.id, 'E', 'level not known: the lowest rank, one above it');
    assert.equal(questRank(S, DEFAULT_RANKS, { level: 55 }).rank.id, 'S');
    assert.deepEqual(questRank(S, DEFAULT_RANKS, { level: 1, pack: { letter: 'S' } }), { rank: DEFAULT_RANKS[6], by: 'pack' });
});

test('a quest written S-rank for a level-12 party is paid as D, with a receipt note and one Problem', () => {
    const { host, taken } = wolves({ reward: '9999999 gold', rank: 'S' }, { level: 12 });
    const note = 'the story said S-rank; held to D-rank for a level-12 party';
    assert.match(taken.receipt.summary, new RegExp(`D-rank; ${note}\\.$`));
    assert.deepEqual(rankProblems(host).map(problem => [problem.key, problem.text]), [['Wolves', `Wolves: ${note}.`]]);
    const done = host.run(finish, { id: 'th_wolves01' });
    assert.equal(done.ok, true, done.message);
    assert.deepEqual(done.receipt.data.paid, { amount: 1000, said: 9999999, rank: 'D', range: [230, 1000] });
    assert.match(done.receipt.summary, new RegExp(`1000 gold paid \\(reward clamped to D-rank range: 230–1000 gold \\(clamped from 9999999 gold\\)\\) \\(${note}\\)\\.$`));
    assert.equal(rankProblems(host).length, 1, 'the Problem is not repeated at turn-in');
});

test('a written rank the party may take, and a pack quest\'s own rank, are paid as they are', () => {
    const own = wolves({ reward: '9999999 gold', rank: 'E' }, { level: 1 });
    assert.doesNotMatch(own.taken.receipt.summary, /the story said/);
    assert.deepEqual(rankProblems(own.host), []);
    const queries = { ...fakeQueries, 'packs.content': (_state, { kind } = {}) => (kind === 'quests' ? [{ pack: 'p', name: 'Wolves', letter: 'S', reward: '9999999 gold' }] : []) };
    const pack = wolves({ reward: '9999999 gold' }, { level: 1, queries });
    const done = pack.host.run(finish, { id: 'th_wolves01' });
    assert.equal(done.ok, true, done.message);
    assert.equal(done.receipt.data.paid.rank, 'S');
    assert.deepEqual(rankProblems(pack.host), []);
});

test('a thread summary is cut to 600 characters at a space, with a Problem', () => {
    const long = Array.from({ length: 300 }, (_, i) => `word${i}`).join(' ');
    const state = reply(makeState(), `+ hook Long Tale — ${long}`).state;
    const tale = thread(state, 'Long Tale');
    assert.ok(tale.summary.length <= SUMMARY_CHARS, String(tale.summary.length));
    assert.match(tale.summary, /word\d+…$/, 'cut after a whole word');
    assert.ok(long.startsWith(tale.summary.slice(0, -1)));
    assert.equal(lastProblems(state).at(-1).kind, 'long-summary');
    // Changing the thread again keeps it within the limit; a short summary is left as written.
    const again = reply(state, `~ hook Long Tale — ${long} and more`).state;
    assert.ok(thread(again, 'Long Tale').summary.length <= SUMMARY_CHARS);
    assert.equal(capSummary('short'), 'short');
    assert.equal(capSummary('x'.repeat(2000)).length, SUMMARY_CHARS, 'no space: a hard cut');
});
