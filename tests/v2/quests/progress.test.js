// Quests part: the quest.progress query, the context tail and static text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { part, QUEST_STATIC } from '../../../src/v2/quests/index.js';
import { fakeQueries, makeHost, makeState, quest } from './helpers/fake-ctx.js';

const progress = part.queries['quest.progress'];
const fight = (rev, foes, won = true) => ({ rev, foes, won });
const viewOf = state => ({ state, query: (name, args) => fakeQueries[name](state, args), settings: {}, chat: { length: 3, lastUser: '' } });

const wolves = (more = {}) => quest('th_wolves01', 'EastBluffWolves', { goal: 'Clear at least 3 wolves', reward: '1 silver each wolf', giver: 'Orsa' },
    { taken: { rev: 10 }, target: { noun: 'wolves', count: 3, kind: 'foes' }, reward: { amount: 1, each: true, unit: 'silver', text: '1 silver each wolf' }, ...more });

test('progress for foes counts only fights after taken.rev, whole words', () => {
    const state = makeState({ threads: [wolves()], beaten: [
        fight(9, [{ name: 'Wolf', count: 5 }]), fight(10, [{ name: 'Wolf', count: 5 }]),
        fight(11, [{ name: 'Dire Wolf', count: 2 }, { name: 'Wolfhound Handler', count: 3 }]),
    ] });
    const want = { have: 2, need: 3, met: false, ready: false, countable: true, source: 'fights', noun: 'wolves', label: 'Wolves 2/3', reason: 'Need 1 more wolf.', finish: { ok: false, reason: 'Need 1 more wolf.' } };
    // Through the documented state layouts (no query handed to the query) …
    assert.deepEqual(progress(state, { id: 'th_wolves01' }), want);
    // … and through the host's queries when it passes them.
    const seen = [];
    const query = (name, args) => { seen.push([name, args]); return fakeQueries[name](state, args); };
    assert.deepEqual(progress(state, { id: 'th_wolves01' }, { query }), want);
    // The scene has no kind, so the place rule asks the atlas for it (atlas.here).
    // Whether fights are counted at all (Story Director alone counts none), then the fights since taken.
    assert.deepEqual(seen, [['combat.foesBeaten', {}], ['combat.foesBeaten', { sinceRev: 10 }], ['atlas.here', {}]]);
    state.domains.combat.beaten.push(fight(12, [{ name: 'Wolves', count: 6 }]));
    assert.deepEqual(progress(state, { key: 'EastBluffWolves' }), { ...want, have: 8, met: true, label: 'Wolves 8/3', reason: '', finish: { ok: false, reason: 'Turn it in at a settlement or where Orsa is.' } });
});

test('progress accepts foes already flattened by the combat query', () => {
    const state = makeState({ threads: [wolves()] });
    const query = () => [{ name: 'Wolf', count: 2 }, { name: 'Grey Wolf' }];
    assert.equal(progress(state, { id: 'th_wolves01' }, { query }).have, 3);
});

test('progress for items reads the inventory; no target and unknown quests', () => {
    const state = makeState({
        threads: [
            quest('th_herbs001', 'Herb Run', { goal: 'Bring 5 moonleaf' }),
            quest('th_story001', 'Who Poisoned', { goal: 'Find out who poisoned the well' }, { taken: { rev: 2 } }),
        ],
        defs: [{ id: 'story/moonleaf', name: 'Moonleaf' }, { id: 'story/moon', name: 'Moon Charm' }],
        stacks: [{ id: 'it_aaaaaaa1', def: 'story/moonleaf', qty: 2 }, { id: 'it_bbbbbbb2', def: 'story/moonleaf', qty: 1 }, { id: 'it_ccccccc3', def: 'story/moon', qty: 9 }],
    });
    assert.deepEqual(progress(state, { id: 'th_herbs001' }), { have: 3, need: 5, met: false, ready: false, countable: true, source: 'inventory', noun: 'moonleaf', label: 'Moonleaf 3/5', reason: 'Need 2 more moonleaf.', finish: { ok: false, reason: 'It was never taken on.' } });
    // A goal code cannot count (F83): not met until the story says so.
    const waiting = 'The story has not said its goal is met yet.';
    assert.deepEqual(progress(state, { id: 'th_story001' }), { have: 0, need: 0, met: false, ready: false, countable: false, source: null, noun: '', label: '', reason: waiting, finish: { ok: false, reason: waiting } });
    assert.equal(progress(state, { id: 'th_nope0001' }), null);
});

test('a foes quest not taken on here counts nothing yet', () => {
    const state = makeState({ threads: [quest('th_wolves01', 'Wolves', { goal: 'kill 3 wolves' })], beaten: [fight(4, [{ name: 'Wolf', count: 9 }])] });
    const got = progress(state, { id: 'th_wolves01' });
    assert.equal(got.have, 0);
    assert.equal(got.source, 'fights');
    assert.match(got.reason, /from when it is taken on/);
});

test('tail: quests ready to turn in (an older chat\'s offer is not told); done-but-elsewhere is optional', () => {
    const state = makeState({
        threads: [
            quest('th_offer001', 'Granary Rats', { goal: 'kill 6 rats', giver: 'Fenna' }, { offer: true }),
            wolves(),
            quest('th_bears001', 'Bear Trouble', { goal: 'kill 1 bear', giver: 'Hobb' }, { taken: { rev: 10 }, target: { noun: 'bear', count: 1, kind: 'foes' } }),
            quest('th_closed01', 'Old Job', {}, { status: 'resolved', offer: true, ended: { rev: 3, reason: 'x', outcome: 'declined' } }),
        ],
        beaten: [fight(11, [{ name: 'Wolf', count: 8 }, { name: 'Black Bear', count: 1 }])],
        scene: { place: { kind: 'wild' }, present: ['Orsa'] },
    });
    const tail = part.context.tail(viewOf(state));
    assert.deepEqual(tail.lines, [
        'Quests ready to turn in here (code checks and pays when the story turns one in): EastBluffWolves (Wolves 8/3).',
    ]);
    assert.deepEqual(tail.optional, ['Quests done but turned in only at a settlement or with their giver: Bear Trouble (Bears 1/1).']);
    assert.equal(part.context.budget, 250);
});

test('tail stays within its budget and is empty without quests', () => {
    const threads = Array.from({ length: 40 }, (_, i) => quest(`th_quest${String(i).padStart(3, '0')}`, `A rather long active job number ${i}`, { giver: 'Someone with a long name' }, { taken: { rev: 2 } }));
    const tail = part.context.tail(viewOf(makeState({ threads })));
    // The quests asked for a goal (F82).
    assert.equal(tail.lines.length, 1);
    assert.match(tail.lines[0], /^Quests with no goal yet .*and 34 more\.$/);
    assert.ok(tail.lines.join('\n').length <= 1000);
    // An older chat's offers are told nowhere.
    const offers = threads.map(thread => ({ ...thread, taken: null, offer: true }));
    assert.deepEqual(part.context.tail(viewOf(makeState({ threads: offers }))), { lines: [], optional: [] });
    assert.deepEqual(part.context.tail(viewOf(makeState())), { lines: [], optional: [] });
    assert.deepEqual(part.context.tail({ state: { domains: {} } }), { lines: [], optional: [] });
});

test('static text is byte-identical whatever the state', () => {
    assert.equal(part.context.static(), QUEST_STATIC);
    assert.equal(part.context.static(), part.context.static());
    assert.doesNotMatch(QUEST_STATIC, /\d/);
});

test('the part has the MODULES §A shape and no domain of its own', () => {
    assert.deepEqual(Object.keys(part).sort(), ['commands', 'context', 'domains', 'hooks', 'kinds', 'queries', 'settings', 'tabs']);
    assert.deepEqual(part.domains, {});
    assert.deepEqual(Object.keys(part.commands), ['quest.take', 'quest.abandon', 'quest.finish']);
    assert.deepEqual(Object.keys(part.queries), ['quest.progress', 'quest.details', 'quest.ranks', 'quest.followsLadder']);
    // The Quests board is the screens part's screen now.
    assert.deepEqual(part.tabs, []);
});

test('quest.progress finish: quest.finish\'s own rule in its order, the place rule last', () => {
    const met = [fight(11, [{ name: 'Wolf', count: 3 }])];
    const finishOf = (thread, scene = {}) => progress(makeState({ threads: [thread], beaten: met, scene }), { id: thread.id }).finish;
    assert.deepEqual(finishOf(wolves()), { ok: false, reason: 'Turn it in at a settlement or where Orsa is.' });
    assert.deepEqual(finishOf(wolves(), { place: { name: 'Bluewatch', kind: 'settlement' } }), { ok: true, reason: '' });
    assert.deepEqual(finishOf(wolves(), { present: ['Orsa the Hunter'] }), { ok: true, reason: '' });
    assert.deepEqual(finishOf(wolves({ taken: null }), { place: { kind: 'settlement' } }), { ok: false, reason: 'It was never taken on.' });
    assert.deepEqual(finishOf(wolves({ status: 'resolved', ended: { rev: 12, reason: 'turned in', outcome: 'done' } })), { ok: false, reason: 'EastBluffWolves is already over.' });
    // It agrees with quest.finish: a met quest in a settlement turns in, elsewhere it is refused for the same reason.
    const elsewhere = makeHost(makeState({ threads: [wolves()], beaten: met })).run(part.commands['quest.finish'], { id: 'th_wolves01' });
    assert.equal(elsewhere.code, 'REFUSED');
    assert.match(elsewhere.message, /Turn it in at a settlement or where Orsa is\./);
});
