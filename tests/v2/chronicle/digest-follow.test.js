// The day digest follows its day's facts (Story Block beta.1 known issue): a reply deleted from the
// middle of a day that already has its digest takes its facts out of that digest and of the one-line
// time-skip reminder. The digest keeps the revisions of the day-facts entries it was made from
// (`src`), the entries stay while it is whole, and the digest is worked out again on read from the
// entries left (days.daysOf). Nothing positional is stored; replay equals live after swipes, middle
// deletes, rewinds and reloads; Story Director alone (no example fight runner) lists no fights.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { fakeFightRunner } from '../integration/helpers/fake-fight-runner.js';
import { DIGEST, FOLLOW_MAX, daysOf, entriesByDay, makeDigest, orderedDays, validateDays, writtenOf } from '../../../src/v2/chronicle/days.js';
import { YESTERDAY_TAG, digestTailLine } from '../../../src/v2/chronicle/digest.js';

const reply = (text, lines = []) => (lines.length ? `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);
const digests = host => host.sdk.receipts().filter(entry => entry.receipt.type === DIGEST);
const june3 = host => host.sdk.query('chronicle.days').find(day => day.date === 'June 3, 1200') ?? null;

async function newHost({ rpg = true, settings = {} } = {}) {
    let host = null;
    const module = createModule({ host: { settings: id => host?.sdk.settings(id) ?? null, substitute: text => host?.sdk.substitute(text) } });
    host = await createHost({ modules: [...(rpg ? [fakeFightRunner()] : []), module], settings: { modules: { 'story-director': settings } } });
    return host;
}

function validatorErrors(host) {
    const state = host.head();
    return Object.keys(state.domains).flatMap(name => (host.registry.validator(name)?.(state.domains[name], state) ?? []).map(error => `${name}: ${error}`));
}

async function deleteExchange(host, text) {
    const at = host.ctx.chat.findIndex(message => message.is_user && message.mes === text);
    assert.ok(at > 0, `no message "${text}"`);
    await host.st.deleteMessage(at + 1);
    await host.st.deleteMessage(at);
}

async function sameEverywhere(host, where, options = {}) {
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live, `${where}: rebuild != live`);
    assert.deepEqual(host.store.problems(), [], `${where}: a block no longer applies`);
    assert.deepEqual(validatorErrors(host), [], where);
    const again = await newHost(options);
    try {
        await again.st.loadChat(structuredClone(host.ctx.chat));
        assert.deepEqual(again.store.problems(), [], `${where}: a fresh load skips nothing`);
        assert.equal(JSON.stringify(again.head().domains), JSON.stringify(host.head().domains), `${where}: reload != live`);
        assert.deepEqual(again.sdk.query('chronicle.days'), host.sdk.query('chronicle.days'), `${where}: the reloaded digests`);
    } finally {
        again.close();
    }
}

// June 3 in three replies (Harrow +40, Old Weir +20, Bluewatch +7), a long sleep into June 4, then the
// reply that hears it: the digest of June 3 is written before it.
async function digestedDay(options) {
    const host = await newHost(options);
    await host.send('Start.', reply('Evening in Harrow.', ['~ time June 3, 1200, 06:00 pm', '~ place Harrow', '+ coin 40']));
    await host.send('To the weir.', reply('The weir.', ['~ place Old Weir', '+ coin 20']));
    await host.send('To Bluewatch.', reply('Bluewatch.', ['~ place Bluewatch', '+ coin 7']));
    await host.send('Sleep.', reply('A long sleep.', ['! time +16h']));
    await host.send('Wake.', reply('Morning.'));
    assert.equal(digests(host).length, 1);
    assert.equal(june3(host).line, 'June 3, 1200: to Harrow, Old Weir, Bluewatch; 67 gold in.');
    return host;
}

const tailNow = host => {
    const state = host.head();
    const written = writtenOf(state.domains.chronicle);
    return digestTailLine({ state, settings: {}, chat: { length: written.at }, query: (name, args) => host.sdk.query(name, args) });
};

test('a reply deleted inside a day that has its digest: the digest and the time-skip line follow the facts left', async () => {
    const host = await digestedDay();
    assert.equal(tailNow(host), `${YESTERDAY_TAG} June 3, 1200: to Harrow, Old Weir, Bluewatch; 67 gold in.`);
    const stored = host.head().domains.chronicle.days[String(june3(host).day)][0];
    assert.equal(stored.src.length, 3, 'made from the three replies\' entries');
    await deleteExchange(host, 'To the weir.');
    const day = june3(host);
    assert.equal(day.line, 'June 3, 1200: to Harrow, Bluewatch; 47 gold in.');
    assert.deepEqual(day.places, ['Harrow', 'Bluewatch']);
    assert.deepEqual(day.money, { in: 47, out: 0 });
    assert.deepEqual(day.fights, { count: 0, won: 0, lost: 0, fled: 0 });
    assert.equal(tailNow(host), `${YESTERDAY_TAG} June 3, 1200: to Harrow, Bluewatch; 47 gold in.`, 'the reminder follows too');
    assert.deepEqual(host.sdk.query('chronicle.dayBoard').days[0].line, day.line, 'the Days screen');
    await sameEverywhere(host, 'after the middle delete');
    // The next reply rewrites nothing (the day is there) and the digest still follows.
    await host.send('On.', reply('On.'));
    assert.equal(digests(host).length, 1);
    assert.equal(june3(host).line, 'June 3, 1200: to Harrow, Bluewatch; 47 gold in.');
    await sameEverywhere(host, 'a reply later');
    host.close();
});

test('every reply of a digested day deleted: the day goes, and the next reply drops it for good', async () => {
    const host = await newHost();
    await host.send('Start.', reply('Evening.', ['~ time June 3, 1200, 06:00 pm']));
    await host.send('To the weir.', reply('The weir.', ['~ place Old Weir', '+ coin 20']));
    await host.send('Sleep.', reply('A long sleep.', ['! time +16h']));
    await host.send('Wake.', reply('Morning.'));
    assert.equal(june3(host).line, 'June 3, 1200: to Old Weir; 20 gold in.');
    await deleteExchange(host, 'To the weir.');
    assert.equal(june3(host), null, 'nothing of the day is left');
    assert.equal(tailNow(host), '');
    await sameEverywhere(host, 'the day emptied');
    await host.send('On.', reply('On.'));
    assert.equal(june3(host), null);
    assert.deepEqual(host.head().domains.chronicle.days, {}, 'the next digest dropped it');
    assert.deepEqual(writtenOf(host.head().domains.chronicle).days, []);
    await sameEverywhere(host, 'dropped');
    host.close();
});

test('a swipe after the digest keeps it; a rewind past it takes it away; rebuild and reload equal live', async () => {
    const host = await digestedDay();
    await host.swipe(reply('Morning, again.'));
    assert.equal(digests(host).length, 1, 'the digest is on the reply before');
    assert.equal(june3(host).line, 'June 3, 1200: to Harrow, Old Weir, Bluewatch; 67 gold in.');
    await deleteExchange(host, 'To Bluewatch.');
    assert.equal(june3(host).line, 'June 3, 1200: to Harrow, Old Weir; 60 gold in.');
    await host.swipe(reply('Morning, a third time.', ['+ coin 1']));
    assert.equal(june3(host).line, 'June 3, 1200: to Harrow, Old Weir; 60 gold in.', 'a swipe on June 4 leaves June 3 alone');
    await sameEverywhere(host, 'swipe after a middle delete');
    // Rewind: back to before the night (the sleep's reply and everything after it go).
    const chat = host.ctx.chat;
    const sleep = chat.findIndex(message => message.is_user && message.mes === 'Sleep.');
    for (let i = chat.length - 1; i >= sleep; i -= 1) await host.st.deleteMessage(i);
    assert.deepEqual(host.sdk.query('chronicle.days'), [], 'no digest before the day ended');
    await sameEverywhere(host, 'after the rewind');
    await host.send('Sleep again.', reply('Sleep.', ['! time +16h']));
    await host.send('Wake.', reply('Morning.'));
    assert.equal(june3(host).line, 'June 3, 1200: to Harrow, Old Weir; 60 gold in.');
    await sameEverywhere(host, 'written again');
    host.close();
});

test('Story Director alone (no example fight runner): the day follows a delete and lists no fights', async () => {
    const host = await digestedDay({ rpg: false });
    await deleteExchange(host, 'To the weir.');
    const day = june3(host);
    assert.ok(day, 'June 3 is still there');
    assert.doesNotMatch(day.line, /Old Weir|fight/);
    assert.deepEqual(day.fights, { count: 0, won: 0, lost: 0, fled: 0 });
    assert.equal(day.fightText, '');
    await sameEverywhere(host, 'alone', { rpg: false });
    host.close();
});

test('daysOf: all sources left gives the digest as stored; none left, no day; a short or receipt-read digest as written', () => {
    const entry = (day, coin, place) => ({ day, count: 1, happened: [], more: 0, places: [place], fights: { count: 0, won: 0, lost: 0, fled: 0 }, money: { in: coin, out: 0 }, npcs: [], world: [], revs: [] });
    const facts = { count: 2, happened: [], more: 0, places: ['A', 'B'], quests: { taken: ['Rats'], done: [], failed: [], dropped: [] }, fights: { count: 0, won: 0, lost: 0, fled: 0 }, money: { in: 3, out: 0 }, npcs: [], world: [] };
    const digest = makeDigest(5, facts, { date: 'Day 5', made: 9, src: [7, 4] });
    assert.deepEqual(digest.src, [4, 7]);
    const chronicle = { days: { 5: [digest], 6: [makeDigest(6, facts, { date: 'Day 6', made: 9 })] }, dayFacts: { '5.4': entry(5, 1, 'A'), '5.7': entry(5, 2, 'B') } };
    assert.equal(daysOf(chronicle)[5], digest, 'all its entries: as stored');
    delete chronicle.dayFacts['5.7'];
    const left = daysOf(chronicle)[5];
    assert.equal(left.line, 'Day 5: to A; took on Rats; 1 coin in.', 'no state: the quests as written');
    assert.deepEqual(left.src, [4]);
    assert.deepEqual(validateDays({ days: { 5: [left] } }), []);
    delete chronicle.dayFacts['5.4'];
    assert.equal(daysOf(chronicle)[5], undefined);
    assert.equal(daysOf(chronicle)[6].line, 'Day 6: to A, B; took on Rats; 3 coins in.', 'read from the receipts: as written');
    assert.ok(validateDays({ days: { 5: [{ ...digest, src: ['x'] }] } }).some(error => /src/.test(error)));
    assert.ok(FOLLOW_MAX >= 200);
});

test('the caps: a day gone short drops its entries (its line as the facts stood then)', async () => {
    const host = await newHost({ settings: { 'chronicle.digestDays': 1, 'chronicle.digestKeep': 3 } });
    await host.send('Start.', reply('Day one.', ['~ time June 3, 1200, 08:00 am', '+ coin 10']));
    await host.send('More.', reply('Still day one.', ['+ coin 5']));
    await host.send('Night.', reply('Night.', ['! time +1d']));
    await host.send('Day two.', reply('Day two.', ['+ coin 2']));
    await deleteExchange(host, 'More.');
    assert.equal(june3(host).line, 'June 3, 1200: 10 gold in.');
    await host.send('Night two.', reply('Night.', ['! time +1d']));
    await host.send('Day three.', reply('Day three.'));
    const chronicle = host.head().domains.chronicle;
    const day3 = orderedDays(chronicle).find(day => day.date === 'June 3, 1200');
    assert.equal(day3.brief, true);
    assert.equal(day3.line, 'June 3, 1200: 10 gold in.', 'short with the line as the facts stood');
    assert.equal(entriesByDay(chronicle).get(day3.day), undefined, 'its entries went');
    await sameEverywhere(host, 'caps', { settings: { 'chronicle.digestDays': 1, 'chronicle.digestKeep': 3 } });
    host.close();
});
