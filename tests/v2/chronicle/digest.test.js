// Chronicle part, day digest on the real Story Block v2 host (the vendored runtime and testkit), merged
// into the module by src/v2/module.js: a day the clock leaves is written once, before the next reply,
// from the receipts; a swipe keeps it; deleting the reply that crossed the day (or the one that wrote a
// digest) writes that day again from what is left; rebuild and a fresh load give the live state; the
// caps hold; the reply after a time skip hears the last day's line once; the static part never changes.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { fakeRpgBattle } from '../integration/helpers/fake-rpg.js';
import { DIGEST, DIGEST_FEATURE, dayOf, orderedDays, writtenOf } from '../../../src/v2/chronicle/days.js';
import { LAST_DAY_TAG, YESTERDAY_TAG, digestCommands, digestTailLine } from '../../../src/v2/chronicle/digest.js';
import { features, part } from '../../../src/v2/chronicle/index.js';

const STATIC_KEY = 'story_suite_static';
const TAIL_KEY = 'story_suite_tail_1';
const sent = (host, key) => host.st.promptLog.filter(entry => entry.key === key && entry.value).map(entry => entry.value);
const reply = (text, lines = []) => (lines.length ? `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);
const receipts = host => host.sdk.receipts().map(entry => entry.receipt);
const digests = host => receipts(host).filter(receipt => receipt.type === DIGEST);
const lineOf = (host, date) => host.sdk.query('chronicle.days').find(day => day.date === date)?.line ?? null;

async function newHost(settings = {}) {
    let host = null;
    const module = createModule({ host: { settings: id => host?.sdk.settings(id) ?? null, substitute: text => host?.sdk.substitute(text) } });
    host = await createHost({ modules: [fakeRpgBattle(), module], settings: { modules: { 'story-director': settings } } });
    return host;
}

function validatorErrors(host) {
    const state = host.head();
    return Object.keys(state.domains).flatMap(name => (host.registry.validator(name)?.(state.domains[name], state) ?? []).map(error => `${name}: ${error}`));
}

// The reader message's index in the chat (its reply follows it).
const userAt = (host, text) => host.ctx.chat.findIndex(message => message.is_user && message.mes === text);
async function deleteExchange(host, text) {
    const at = userAt(host, text);
    assert.ok(at > 0, `no message "${text}"`);
    await host.st.deleteMessage(at + 1);
    await host.st.deleteMessage(at);
}

function sameOnReload(host, where) {
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live, `${where}: rebuild != live`);
    assert.deepEqual(host.store.problems(), [], `${where}: a block no longer applies`);
    assert.deepEqual(validatorErrors(host), [], where);
}

test('a day the clock leaves is written once, before the next reply, from the receipts', async () => {
    const host = await newHost();
    await host.send('Start.', reply('Morning in Harrow.', [
        '~ time June 3, 1200, 08:00 am', '~ place Harrow | kind: settlement', '+ coin 40 | from: a merchant',
        '+ world Red Plague — coughing in the docks | state: looming',
    ]));
    await host.send('On.', reply('Noon at the weir.', ['! time +4h', '~ place Old Weir', '- coin 5 | to: the ferryman', '+ item Rope']));
    assert.equal(digests(host).length, 0, 'the same day: nothing to write');
    assert.deepEqual(host.sdk.query('chronicle.days'), []);
    await host.send('Sleep.', reply('Night falls, then dawn.', ['! time +20h']));
    assert.equal(digests(host).length, 0, 'the day is written before the next reply, not by the reply that crossed it');
    await host.send('Wake.', reply('Day two.', ['+ item Bread']));
    await host.send('Still day two.', reply('Later.', ['! time +1h']));
    assert.equal(digests(host).length, 1, 'once');
    const [day] = host.sdk.query('chronicle.days');
    assert.equal(day.date, 'June 3, 1200');
    assert.equal(day.day, dayOf(host.sdk.query('time.now').minutes) - 1);
    assert.equal(day.line, 'June 3, 1200: to Harrow, Old Weir; 40 gold in, 5 out; 1 world event.');
    assert.deepEqual(day.places, ['Harrow', 'Old Weir']);
    assert.deepEqual(day.money, { in: 40, out: 5 });
    assert.equal(day.moneyText, '40 gold in, 5 out');
    assert.deepEqual(day.world, ['World: Red Plague is now looming — coughing in the docks.']);
    assert.deepEqual(day.happened, ['The party gains Rope.']);
    assert.ok(!JSON.stringify(day).includes('Bread'), 'the next day\'s things are not in it');
    const [receipt] = digests(host);
    assert.equal(receipt.cause, 'system');
    assert.equal(receipt.narrate, false);
    assert.equal(receipt.summary, 'Day digest written: June 3, 1200.');
    assert.deepEqual(host.sdk.query('chronicle.day', { day: day.day }), day);
    assert.equal(host.sdk.query('chronicle.day', { day: day.day + 1 }), null);
    assert.deepEqual(host.sdk.query('chronicle.days', { from: day.day + 1 }), []);
    assert.deepEqual(host.sdk.query('chronicle.days', { to: day.day }).map(entry => entry.date), ['June 3, 1200']);
    assert.equal(host.sdk.query('chronicle.days', { from: 'x' }), null);
    // The reader cannot write one.
    const refused = await host.sdk.command(DIGEST, {});
    assert.equal(refused.ok, false);
    assert.equal(refused.code, 'REFUSED');
    sameOnReload(host, 'after the digest');
    host.close();
});

test('time.now: the clock in minutes, the calendar text, the story day and its date', async () => {
    const host = await newHost();
    assert.deepEqual(host.sdk.query('time.now'), { minutes: null, text: '', day: null, date: '' });
    await host.send('Start.', reply('Morning.', ['~ time June 3, 1200, 08:00 am']));
    const now = host.sdk.query('time.now');
    assert.deepEqual(now, { minutes: now.minutes, text: 'June 3, 1200, 08:00 am', day: Math.floor(now.minutes / 1440), date: 'June 3, 1200' });
    assert.equal(now.text, host.sdk.query('director.time').text);
    host.close();
});

test('a swipe keeps the digest; deleting the reply that crossed the day writes that day again without it', async () => {
    const host = await newHost();
    await host.send('Start.', reply('Morning.', ['~ time June 3, 1200, 08:00 am', '~ place Harrow', '+ coin 40']));
    await host.send('Cross.', reply('To the weir, and on through the night.', ['~ place Old Weir', '- coin 5', '! time +20h']));
    await host.send('Day two.', reply('Bright morning.', ['~ time June 4, 1200, 10:00 am', '+ item Bread']));
    assert.equal(lineOf(host, 'June 3, 1200'), 'June 3, 1200: to Harrow, Old Weir; 40 gold in, 5 out.');
    // A swipe of the reply after the crossing: the digest (on the crossing reply) stays as it was, once.
    await host.swipe(reply('Bright morning, again.', ['~ time June 4, 1200, 10:00 am', '+ item Bread']));
    assert.equal(digests(host).length, 1);
    assert.equal(lineOf(host, 'June 3, 1200'), 'June 3, 1200: to Harrow, Old Weir; 40 gold in, 5 out.');
    sameOnReload(host, 'after the swipe');

    // The crossing reply goes: its receipts and the digest it carried go with it.
    await deleteExchange(host, 'Cross.');
    assert.deepEqual(host.sdk.query('chronicle.days'), []);
    sameOnReload(host, 'after the delete');
    // The deleted reply's +20h goes with it (C1-6: the clock is a count, SPEC §2.2), and the later
    // reply's "~ time June 4, 10:00 am" is a set (ctx.absolute), so it stays exact. The next reply
    // writes June 3 again, without the deleted reply.
    assert.equal(host.sdk.query('director.time').text, 'June 4, 1200, 10:00 am');
    await host.send('Go on.', reply('More.', ['! time +12h']));
    await host.send('On.', reply('On.'));
    assert.equal(lineOf(host, 'June 3, 1200'), 'June 3, 1200: to Harrow; 40 gold in.');
    sameOnReload(host, 'after the rewrite');
    const again = await newHost();
    await again.st.loadChat(structuredClone(host.ctx.chat));
    assert.deepEqual(again.store.problems(), []);
    assert.equal(JSON.stringify(again.head().domains), JSON.stringify(host.head().domains), 'a fresh load gives the live state');
    again.close();
    host.close();
});

test('a day whose digest a deleted reply wrote is written again by the next reply', async () => {
    const host = await newHost();
    await host.send('Start.', reply('Day one.', ['~ time June 3, 1200, 08:00 am', '+ coin 10']));
    await host.send('Two.', reply('Day two.', ['~ time June 4, 1200, 08:00 am', '+ coin 20']));
    await host.send('Three.', reply('Day three.', ['~ time June 5, 1200, 08:00 am', '+ coin 30']));   // writes June 3 (on "Two.")
    await host.send('Four.', reply('Still day three.', ['+ coin 1']));                               // writes June 4 (on "Three.")
    assert.deepEqual(host.sdk.query('chronicle.days').map(day => day.line), ['June 3, 1200: 10 gold in.', 'June 4, 1200: 20 gold in.']);
    assert.deepEqual(writtenOf(host.head().domains.chronicle).days.length, 2);
    // "Two." carried June 3's digest and was June 4's only reply: June 3 is gone with the digest it
    // carried, and June 4 follows its facts (none left: not shown).
    await deleteExchange(host, 'Two.');
    assert.deepEqual(host.sdk.query('chronicle.days').map(day => day.date), []);
    sameOnReload(host, 'after the delete');
    await host.send('Five.', reply('On.'));
    assert.deepEqual(host.sdk.query('chronicle.days').map(day => day.line), ['June 3, 1200: 10 gold in.'], 'June 3 written again, June 4 dropped');
    sameOnReload(host, 'after the rewrite');
    // Once written again, nothing more to do.
    const count = digests(host).length;
    await host.send('Six.', reply('On.'));
    assert.equal(digests(host).length, count);
    host.close();
});

test('the caps hold: the newest days whole, older ones as their line, the oldest dropped; every state valid', async () => {
    const host = await newHost({ 'chronicle.digestDays': 2, 'chronicle.digestKeep': 3 });
    await host.send('Start.', reply('Day one.', ['~ time June 1, 1200, 08:00 am', '+ coin 1']));
    for (let n = 2; n <= 8; n += 1) {
        await host.send(`Day ${n}.`, reply(`Day ${n}.`, [`~ time June ${n}, 1200, 08:00 am`, `+ coin ${n}`, `~ place Town ${n}`]));
        const days = orderedDays(host.head().domains.chronicle);
        assert.ok(days.length <= 3, `day ${n}: ${days.length} kept`);
        assert.ok(days.filter(day => !day.brief).length <= 2);
        assert.deepEqual(validatorErrors(host), [], `day ${n}`);
    }
    const days = host.sdk.query('chronicle.days');
    // June 7 is written before the reply after the last one.
    assert.deepEqual(days.map(day => [day.date, day.brief]), [['June 4, 1200', true], ['June 5, 1200', false], ['June 6, 1200', false]]);
    assert.equal(days[0].line, 'June 4, 1200: to Town 4; 4 gold in.');
    assert.deepEqual(days[0].places, [], 'a short day keeps only its line');
    assert.deepEqual(writtenOf(host.head().domains.chronicle).days, days.map(day => day.day));
    sameOnReload(host, 'capped');
    host.close();
});

test('the reply after a time skip hears the last day\'s line, once; a short night or the setting off does not', async () => {
    const host = await newHost();
    await host.send('Start.', reply('Evening.', ['~ time June 3, 1200, 08:00 pm', '~ place Harrow', '+ coin 40']));
    await host.send('Sleep.', reply('A long sleep.', ['! time +14h']));          // 08:00 pm → 10:00 am: a skip
    await host.send('Wake.', reply('Morning.'));
    const tails = sent(host, TAIL_KEY);
    const told = tails.filter(text => text.includes(YESTERDAY_TAG));
    assert.equal(told.length, 1, tails.join('\n---\n'));
    assert.match(told[0], /\[Yesterday\] June 3, 1200: to Harrow; 40 gold in\./);
    await host.send('More.', reply('Later.'));
    assert.doesNotMatch(sent(host, TAIL_KEY).at(-1), /\[Yesterday\]/, 'only the reply after the skip');
    // The static part is the same bytes throughout.
    assert.equal(new Set(sent(host, STATIC_KEY)).size, 1);
    host.close();

    const short = await newHost();
    await short.send('Start.', reply('Late.', ['~ time June 3, 1200, 11:00 pm', '+ coin 2']));
    await short.send('Midnight.', reply('Past midnight.', ['! time +2h']));
    await short.send('On.', reply('On.'));
    assert.equal(digests(short).length, 1, 'the day is written');
    assert.ok(!sent(short, TAIL_KEY).some(text => text.includes(YESTERDAY_TAG)), 'a two-hour step is no skip');
    short.close();

    const off = await newHost({ 'chronicle.digestTail': false });
    await off.send('Start.', reply('Evening.', ['~ time June 3, 1200, 08:00 pm', '+ coin 40']));
    await off.send('Sleep.', reply('A long sleep.', ['! time +14h']));
    await off.send('Wake.', reply('Morning.'));
    assert.equal(digests(off).length, 1);
    assert.ok(!sent(off, TAIL_KEY).some(text => text.includes(YESTERDAY_TAG)));
    off.close();
});

// A view as the hook and the tail see it, on a chronicle with one day written.
function viewOn({ feature, minutes, written, recap = null }) {
    const day = { day: 10, date: 'Day 10', line: 'Day 10: 1 gold in.', brief: true, count: 1, made: 1 };
    return {
        state: { meta: { rev: 5 }, domains: { director: { time: { minutes }, recap }, chronicle: { events: {}, factions: {}, days: { 10: [day] }, written: [written] } } },
        chat: { length: 6 },
        settings: () => ({}),
        query: name => (name === 'time.recap' ? recap : name === 'time.overdue' ? null : null),
        ...(feature === undefined ? {} : { feature: id => (id === DIGEST_FEATURE ? feature : false) }),
    };
}

test('the feature: declared on by default; off, the hook writes nothing and the tail says nothing', () => {
    assert.deepEqual(features.map(feature => [feature.id, feature.default]), [[DIGEST_FEATURE, true]]);
    assert.equal(part.commands[DIGEST].feature, DIGEST_FEATURE);
    // B-rxui-3: the three digest settings show only while the feature is on (Story Block's schema-field `feature`).
    for (const key of ['digestDays', 'digestKeep', 'digestTail']) assert.equal(part.settings.schema[key].feature, DIGEST_FEATURE, key);
    const schema = createModule().settings.schema;
    for (const key of ['chronicle.digestDays', 'chronicle.digestKeep', 'chronicle.digestTail']) assert.equal(schema[key].feature, DIGEST_FEATURE, key);
    assert.equal(part.screens.find(screen => screen.id === 'story-director/days').feature, DIGEST_FEATURE);
    const due = { minutes: 12 * 1440 + 60, written: { through: 11, days: [10], at: 6, skip: true } };
    assert.deepEqual(digestCommands(viewOn({ ...due, feature: undefined })), [{ type: DIGEST, payload: { at: 6 } }], 'an older host has no features: on');
    assert.deepEqual(digestCommands(viewOn({ ...due, feature: true })), [{ type: DIGEST, payload: { at: 6 } }]);
    assert.deepEqual(digestCommands(viewOn({ ...due, feature: false })), []);
    const fresh = { minutes: 11 * 1440 + 60, written: { through: 11, days: [10], at: 6, skip: true } };
    assert.equal(digestTailLine(viewOn({ ...fresh })), `${YESTERDAY_TAG} Day 10: 1 gold in.`);
    assert.equal(digestTailLine(viewOn({ ...fresh, feature: false })), '');
    assert.deepEqual(digestCommands(viewOn({ ...fresh })), [], 'written through today: nothing to do');
    // Longer ago than yesterday; and a While away recap for this reply tells it too.
    const later = { minutes: 14 * 1440, written: { through: 14, days: [10], at: 6, skip: false } };
    assert.equal(digestTailLine(viewOn(later)), '');
    assert.equal(digestTailLine(viewOn({ ...later, recap: { lines: ['[While away] …'], at: 6, rev: 5 } })), `${LAST_DAY_TAG} Day 10: 1 gold in.`);
    assert.equal(digestTailLine(viewOn({ ...later, recap: { lines: ['[While away] …'], at: 2, rev: 1 } })), '', 'a recap for an earlier reply');
});

test('RX-TL-3: a 250-reply day keeps its facts in state as it goes (folded past 200), a middle delete takes one reply\'s away, replay equals live', { timeout: 300000 }, async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await newHost();
    await host.send('Start.', reply('The road.', ['~ time June 3, 1200, 08:00 am', '~ place Bluewatch', '+ coin 5']));
    for (let n = 1; n <= 250; n += 1) {
        await host.send(`On (${n}).`, reply(`Reply ${n}.`, ['+ coin 1']));
        if (n === 40) {
            await deleteExchange(host, 'On (10).');
            sameOnReload(host, 'after the middle delete');
        }
    }
    const kept = Object.keys(host.head().domains.chronicle.dayFacts);
    assert.ok(kept.length <= 200, `${kept.length} entries kept for the day: folded`);
    sameOnReload(host, 'a long day');
    await host.send('Sleep.', reply('Morning comes.', ['! time +1d']));
    await host.send('Up.', reply('A new day.'));
    const june3 = host.sdk.query('chronicle.days').find(day => day.date === 'June 3, 1200');
    assert.ok(june3, 'June 3 has its digest');
    assert.deepEqual(june3.money, { in: 5 + 249, out: 0 }, 'every reply\'s coin but the deleted one\'s');
    assert.deepEqual(june3.places, ['Bluewatch']);
    // The day's entries stay while its digest is whole (it follows them); the next day's are kept until it ends.
    const left = Object.entries(host.head().domains.chronicle.dayFacts).filter(([, entry]) => entry.day === june3.day);
    const src = host.head().domains.chronicle.days[String(june3.day)][0].src;
    assert.deepEqual(left.map(([key]) => Number(key.split('.')[1])).sort((a, b) => a - b), src, 'exactly the entries it was made from');
    sameOnReload(host, 'after the digest');
    host.close();
});

// Story Block's storage trim (RX-TL-3): old receipts lose their `data`. Done here to every stored receipt.
function trimAll(host) {
    for (const message of host.ctx.chat) {
        for (const extra of [message?.extra, ...(message?.swipe_info ?? []).map(info => info?.extra)]) {
            for (const receipt of extra?.storySuite?.receipts ?? []) delete receipt.data;
        }
    }
}

test('RX-TL-3: the quest history and the day digest outlive the receipts\' data', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await newHost();
    await host.send('Hello.', reply('Harrow.', ['~ time June 3, 1200, 08:00 am', '~ place Harrow | kind: settlement', '+ present Orsa', '+ coin 9']));
    await host.send("I'll take it, I'll find your letter.", reply('Orsa nods.', ['+ quest Lost Letter — Orsa lost a letter | giver: Orsa | goal: Find the letter | reward: 30 gold']));
    await host.send('Found it.', reply('Under a bench.', ['~ quest Lost Letter | met: yes | progress: found under a bench']));
    await host.send('Here.', reply('Orsa reads it.'));
    const id = host.sdk.query('director.threads', { kind: 'quest' })[0].id;
    const before = host.sdk.query('quest.details', { id }).history;
    assert.ok(before.length >= 2, JSON.stringify(before));
    trimAll(host);
    assert.deepEqual(host.sdk.query('quest.details', { id }).history, before, 'kept by the note, not read from receipts');
    await host.send('Sleep.', reply('Morning.', ['! time +1d']));
    await host.send('Up.', reply('A new day.'));
    const [day] = host.sdk.query('chronicle.days');
    assert.equal(day.line, 'June 3, 1200: to Harrow; took on Lost Letter; 9 gold in.');
    sameOnReload(host, 'after the trim');
    host.close();
});
