import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptedContract, entityKey, evaluateQuest, requirementOf, rewardOf, settlementPlan } from '../src/quest-completion.js';
import { applyOps, emptyTracker, replay } from '../src/tracker.js';
import { parseChanges } from '../src/changes.js';
import { turnInPresence } from '../src/presence.js';

const currency = { mode: 'single', single: 'silver', row: 'Coins' };
const parseCoins = text => /^\d+ silver$/.test(text) ? Number(text.split(' ')[0]) : null;
const formatCoins = value => `${value} silver`;
const context = { owner: 'accepted-reply', cursor: { version: 1, anchor: 'accepted-reply', excluded: ['earlier-fight'] }, currency, place: 'Bluewatch Village | Guild' };
const ops = text => parseChanges(text).ops;
const add = (text, seed = emptyTracker(), more = {}) => applyOps(seed, ops(text), { message: 4, contractContext: context, ...more });
const job = (target = 'defeat 3 wolves', reward = '1 silver each wolf') => add(`+ quest Wolf bounty — road | target: ${target} | reward: ${reward} | giver: Fenna`).tracker.records[0];
const inventory = { availability: 'available', items: [], currency, revision: 'inventory-1' };
const evidence = count => ({ availability: 'available', revision: `fight-${count}`, events: [{ id: 'f1', defeated: Array.from({ length: count }, (_, i) => ({ id: `f1:e${i}`, name: 'Wolf' })) }] });
const evaluate = (record, more = {}) => evaluateQuest({ record, inventory, evidence: evidence(8), presence: { here: true }, parseCoins, formatCoins, ...more });

test('explicit target grammar, bounded inference and invalid versus unmanaged', () => {
    assert.equal(requirementOf({ goal: 'defeat at least 3 wolves' }).qty, 3);
    assert.equal(requirementOf({ goal: 'escort the merchant' }).managed, false);
    assert.equal(requirementOf({ goal: '3 wolves' }).managed, false);
    for (const target of ['kill 3 wolf', 'defeat 0 wolf', 'defeat 3 wolf or 5 rat', 'deliver -1 tail']) {
        assert.ok(requirementOf({ target }).error, target);
    }
    assert.equal(requirementOf({ target: 'possess 1 permit', goal: 'defeat 99 wolves' }).action, 'possess');
    assert.equal(entityKey('Wolves'), entityKey('wolf'));
    assert.notEqual(entityKey('wolf spider'), entityKey('wolf'));
    assert.notEqual(entityKey('young wolf'), entityKey('wolf'));
});

test('reward is fully parsed, requires explicit none, and matches per-unit entity', () => {
    const target = requirementOf({ target: 'defeat 3 wolf' });
    for (const reward of ['', '2 silver and a sword', '2 unknown', '1 silver per rat', '1 silver per wolf capped at 5']) {
        assert.ok(rewardOf(reward, target, currency, parseCoins).error, reward);
    }
    assert.equal(rewardOf('none', target, currency, parseCoins).rate, 0);
    assert.ok(rewardOf('1 silver per permit', requirementOf({ target: 'possess 1 permit' }), currency, parseCoins).error);
});

test('thresholds and exact payments: two disabled, three ready, eight earns eight', () => {
    for (const count of [2, 3, 8]) {
        const result = evaluate(job(), { evidence: evidence(count) });
        assert.equal(result.eligible, count >= 3);
        assert.equal(result.payment, count);
        assert.equal(result.claimable, count);
    }
    const fixed = evaluate(job('defeat 3 wolves', '5 silver'));
    assert.equal(fixed.payment, 5);
    assert.equal(fixed.claims.length, 3);
    const claimed = evaluate(job(), { claims: evidence(8).events[0].defeated.slice(0, 6).map(enemy => enemy.id) });
    assert.equal(claimed.claimable, 2);
    assert.equal(claimed.eligible, false);
});

test('unknown proof is not displayed as zero; missing identity and changed currency block', () => {
    const unknown = evaluate(job(), { evidence: { availability: 'incomplete' } });
    assert.equal(unknown.observed, null);
    assert.match(unknown.reason, /history unavailable/);
    const old = job();
    old.contract = acceptedContract(old, null);
    assert.match(evaluate(old).reason, /Acceptance/);
    assert.match(evaluate(job(), { inventory: { ...inventory, currency: {} } }).reason, /Currency changed/);
});

test('current items, exact delivery, possession and invalid quantities', () => {
    const items = { ...inventory, items: [{ name: 'Rat Tail', qty: 8 }] };
    const result = evaluate(job('deliver 5 Rat Tail', '1 silver per Rat Tail'), { inventory: items });
    assert.equal(result.eligible, true);
    assert.equal(result.payment, 5);
    assert.deepEqual(result.consume, { names: ['Rat Tail'], qty: 5 });
    assert.equal(evaluate(job('possess 1 Rat Tail', 'none'), { inventory: items }).consume, null);
    assert.equal(evaluate(job('deliver 5 Rat Tail'), { inventory: { ...items, items: [{ name: 'Rat Tail', qty: null }] } }).eligible, false);
});

test('giver or issuing settlement, no incidental mention or arbitrary combat site', () => {
    const contract = job().contract;
    assert.equal(turnInPresence(contract, { place: 'Bluewatch | Market' }).here, true);
    assert.equal(turnInPresence(contract, { scene: 'NPCs Present: Fenna\nOff-Screen: Aldo' }).here, true);
    assert.equal(turnInPresence(contract, { scene: 'NPCs Present: Aldo\nOff-Screen: Fenna', place: 'Woods' }).here, false);
    assert.equal(turnInPresence(contract, { place: 'Woods', reply: 'Fenna was mentioned.' }).here, false);
    assert.equal(evaluate(job(), { presence: { here: false, reason: 'Return to Fenna.' } }).eligible, false);
    assert.equal(evaluate(job(), { busy: true }).eligible, false);
});

test('hook acceptance freezes terms and actual acceptance boundary, not offer creation', () => {
    const offerContext = { ...context, owner: 'offer-reply', place: 'Bluewatch' };
    const offered = add('+ hook Wolf bounty — road | target: defeat 3 wolf | reward: 1 silver per wolf', emptyTracker(), { message: 1, contractContext: offerContext }).tracker;
    const taken = add('+ quest Wolf bounty — accepted', offered).tracker;
    const record = taken.records[0];
    assert.equal(record.created.message, 1);
    assert.equal(record.contract.owner, 'accepted-reply');
    assert.equal(record.contract.issuer, 'Bluewatch');
    const changed = add('~ Wolf bounty — target: defeat 1 rat | reward: paid 999 silver', taken).tracker.records[0];
    assert.deepEqual(changed.contract, record.contract);
});

test('managed narrative success requires a receipt; legacy closure and failures remain', () => {
    const seed = { ...emptyTracker(), records: [job()] };
    for (const line of ['- Wolf bounty — done', '~ Wolf bounty — step: completed', '! Wolf bounty — reward paid']) {
        const result = add(line, seed);
        assert.equal(result.tracker.records[0].status, 'active');
        assert.ok(result.problems.some(problem => problem.kind === 'unverified-completion'));
    }
    assert.equal(add('- Wolf bounty — failed', seed).tracker.records[0].status, 'resolved');
    const legacy = add('+ quest Escort — escort the merchant').tracker;
    assert.equal(add('- Escort — done', legacy).tracker.records[0].status, 'resolved');
    const plan = settlementPlan(seed.records[0], evaluate(seed.records[0]), 'transaction-1');
    const settled = add('- Wolf bounty — completed', seed, { settlements: [plan] }).tracker;
    assert.equal(settled.records[0].settlement.id, 'transaction-1');
    assert.equal(add('- Wolf bounty — completed', settled, { message: 5, settlements: [plan] }).tracker.records[0].resolved.message, 4);
    const reopened = add('+ quest Wolf bounty — target: defeat 3 wolf | reward: 1 silver per wolf', settled).tracker.records[0];
    assert.equal(evaluate(reopened).eligible, false);
});

test('replay without the owning receipt reopens managed success', () => {
    const start = { message: 0, ops: ops('+ quest Wolf bounty — target: defeat 3 wolf | reward: 1 silver per wolf'), contractContext: context };
    const record = replay([start]).tracker.records[0];
    const receipt = settlementPlan(record, evaluate(record), 'settled');
    const done = { message: 2, ops: ops('- Wolf bounty — completed'), settlements: [receipt] };
    assert.equal(replay([start, done]).tracker.records[0].status, 'resolved');
    assert.equal(replay([start, { ...done, settlements: [] }]).tracker.records[0].status, 'active');
    const edited = { ...start, ops: ops('+ quest Wolf bounty — target: defeat 3 dragon | reward: 1 silver per dragon') };
    assert.equal(replay([edited, done]).tracker.records[0].status, 'active', 'a receipt cannot settle edited acceptance terms');
});
