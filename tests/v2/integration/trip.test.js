// Trips on the real Story Block v2 host (the vendored runtime and testkit) with the Ersveil pack: set out from Bluewatch Village by the pack's
// frontier road (100 km to Hollin's Reach, 60 on to Wolfmere Outpost), what the narrator is told as the story time passes, the Status row,
// the feature switch, and replay: a swipe, a Re-read, a middle delete, a rebuild and a reload all give the same trip.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { TRIP_FEATURE } from '../../../src/v2/atlas/trip.js';

const STATIC_KEY = 'story_suite_static';
const TAIL_KEY = 'story_suite_tail_1';
const ERSVEIL = readFileSync(new URL('../../fixtures/ersveil-bluewatch.pack.json', import.meta.url), 'utf8');

const reply = (text, lines = []) => (lines.length ? `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);
const sent = (host, key) => host.st.promptLog.filter(entry => entry.key === key && entry.value).map(entry => entry.value);
const tripLine = host => sent(host, TAIL_KEY).at(-1)?.split('\n').filter(line => /^(On the road:|You has reached)/.test(line)) ?? [];
const trips = host => host.head().domains.atlas.trips;
const goRecord = host => Object.values(trips(host) ?? {}).find(record => record.kind === 'go');

async function newHost(options = {}) {
    let host = null;
    const module = createModule({ host: { settings: id => host?.sdk.settings(id) ?? null, substitute: text => host?.sdk.substitute(text) } });
    host = await createHost({ modules: [module], ...options });
    const installed = await host.packs.packs.install(ERSVEIL, { origin: 'pack.json' });
    assert.equal(installed.ok, true, JSON.stringify(installed.errors));
    return host;
}

const SET_OUT = ['~ place Bluewatch Village', '~ trip Wolfmere Outpost | by: foot'];

test('the feature is Trips, on by default, and owns the kind: its grammar line is in the static part only while it is on', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await newHost();
    try {
        const feature = host.sdk.features().find(entry => entry.id === TRIP_FEATURE);
        assert.equal(feature.label, 'Trips');
        assert.equal(feature.on, true);
        await host.send('Hello.', reply('Bluewatch.', ['~ place Bluewatch Village']));
        await host.send('We set out.', reply('The road.', ['~ trip Wolfmere Outpost | by: foot']));
        await host.send('On.', reply('A day.', ['! time +1 day']));
        const statics = sent(host, STATIC_KEY);
        assert.equal(new Set(statics).size, 1, 'the same bytes every reply, whatever the trip does');
        assert.match(statics[0], /~ trip Place \| by: riding\|foot\|wagon\|boat\|ship \| via: Stop, Stop/);
        host.features.set(TRIP_FEATURE, false);
        await host.send('Again.', reply('Quiet.'));
        assert.doesNotMatch(sent(host, STATIC_KEY).at(-1), /~ trip/);
    } finally {
        host.close();
    }
});

test('off means off: no grammar line, no tail line, no state, no answer, and the trip line is a quiet Problem', async t => {
    t.mock.method(console, 'warn', () => {});
    const off = await newHost({ settings: { features: { [TRIP_FEATURE]: false } } });
    const plain = await newHost({ settings: { features: { [TRIP_FEATURE]: false } } });
    try {
        for (const host of [off, plain]) await host.send('Hello.', reply('Bluewatch.', ['~ place Bluewatch Village', '~ time Goldwane 12, 8:00 am']));
        await off.send('We set out.', reply('The road.', ['~ trip Wolfmere Outpost | by: foot']));
        await plain.send('We set out.', reply('The road.'));
        for (const host of [off, plain]) await host.send('On.', reply('Two days.', ['! time +2 days']));
        assert.equal(trips(off), undefined, 'nothing stored');
        assert.equal(off.sdk.query('atlas.trip'), null);
        assert.deepEqual(tripLine(off), []);
        for (const key of [STATIC_KEY, TAIL_KEY]) {
            const a = sent(off, key);
            const b = sent(plain, key);
            assert.equal(a.length, b.length);
            assert.deepEqual(a, b, `${key}: byte for byte as without the line`);
        }
        assert.deepEqual(Object.keys(off.head().domains.atlas), Object.keys(plain.head().domains.atlas), 'the atlas has no new key');
        const quiet = off.turn.problems().filter(problem => problem.line === '~ trip Wolfmere Outpost | by: foot');
        assert.deepEqual(quiet.map(problem => [problem.code, problem.quiet]), [['FEATURE_OFF', true]], 'a quiet Problem, not a refusal on the reply\'s card');
    } finally {
        off.close();
        plain.close();
    }
});

test('set out from Bluewatch Village: the legs are planned and kept, the narrator is told where the party is, then to write ~ place', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await newHost();
    try {
        await host.send('Hello.', reply('Bluewatch.', ['~ time Goldwane 12, 8:00 am']));
        await host.send('We set out.', reply('The gate.', SET_OUT));
        const record = goRecord(host);
        assert.deepEqual(record.legs.map(leg => [leg.from, leg.to, leg.km, leg.days]), [['Bluewatch Village', "Hollin's Reach", 100, 5], ['Hollin\'s Reach', 'Wolfmere Outpost', 60, 3]]);
        assert.equal(host.sdk.query('atlas.trip').row, "Bluewatch Village → Hollin's Reach → Wolfmere Outpost · on foot, 20 km/day · leg 1 of 2 · arrive Wolfmere Outpost Goldwane 20");
        await host.send('On.', reply('Two days.', ['! time +2 days']));
        assert.deepEqual(tripLine(host), ["On the road: Bluewatch Village → Hollin's Reach, 0 of 100 km, arrive Goldwane 17; then Wolfmere Outpost, Goldwane 20."], 'the tail is built before the reply: the clock had not moved yet');
        await host.send('On.', reply('Two more days.', ['! time +2 days']));
        assert.deepEqual(tripLine(host), ["On the road: Bluewatch Village → Hollin's Reach, 40 of 100 km, arrive Goldwane 17; then Wolfmere Outpost, Goldwane 20."]);
        // Past the first arrival (day 5) with the story still at Bluewatch: the cue, and the next stage (day 7: 40 of 60 km).
        await host.send('On.', reply('Three days.', ['! time +3 days']));
        assert.deepEqual(tripLine(host), ["On the road: Bluewatch Village → Hollin's Reach, 80 of 100 km, arrive Goldwane 17; then Wolfmere Outpost, Goldwane 20."]);
        await host.send('Quiet.', reply('Hollin\'s Reach at dusk.'));
        assert.deepEqual(tripLine(host), [
            "You has reached Hollin's Reach (Goldwane 17): write ~ place Hollin's Reach.",
            "On the road: Hollin's Reach → Wolfmere Outpost, 40 of 60 km, arrive Goldwane 20.",
        ]);
        // The story writes the place: the next prompt has no cue, only the road.
        await host.send('We rest.', reply('An inn.', ["~ place Hollin's Reach"]));
        await host.send('Rest.', reply('A night.'));
        assert.deepEqual(tripLine(host), ["On the road: Hollin's Reach → Wolfmere Outpost, 40 of 60 km, arrive Goldwane 20."]);
        assert.match(host.sdk.query('atlas.trip').row, /leg 2 of 2/);
        // Past the last arrival: the cue for Wolfmere Outpost, "Arrived" on the status.
        await host.send('Two more.', reply('Arrival.', ['! time +3 days']));
        await host.send('Wolfmere.', reply('The gate of Wolfmere Outpost.'));
        assert.deepEqual(tripLine(host), ['You has reached Wolfmere Outpost (Goldwane 20): write ~ place Wolfmere Outpost.']);
        assert.equal(host.sdk.query('atlas.trip').row, 'Arrived at Wolfmere Outpost, Goldwane 20');
        await host.send('In.', reply('Inside.', ['~ place Wolfmere Outpost']));
        await host.send('Rest.', reply('Quiet.'));
        assert.deepEqual(tripLine(host), []);
        assert.equal(host.sdk.query('atlas.trip').row, 'Arrived at Wolfmere Outpost, Goldwane 20', 'the status keeps the arrival while the place is where the trip ended');
        await host.send('Away.', reply('Elsewhere.', ['~ place Auvoth']));
        assert.equal(host.sdk.query('atlas.trip'), null, 'the place changed: the trip is over');
        // The head, a rebuild and a reload of the chat are the same.
        const live = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live);
        assert.deepEqual(host.store.problems(), []);
    } finally {
        host.close();
    }
});

test('a ride goes at the mount pace Story Block answers (its mounts.pace, from the mounts the party has), and a delay moves what is ahead', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await newHost();
    try {
        await host.send('Hello.', reply('Bluewatch.', ['~ place Bluewatch Village', '~ time Goldwane 12, 8:00 am', '+ mount Grey Mare | kind: horse | pace: 35', '+ mount Burr | kind: mule | pace: 25']));
        assert.deepEqual(host.sdk.query('mounts.pace'), { pace: 25, mounts: 2, riders: 1, short: 0, slowest: 'Burr' });
        await host.send('We set out.', reply('Riding.', ['~ trip Wolfmere Outpost | by: riding']));
        assert.deepEqual(goRecord(host).legs.map(leg => leg.days), [4, 2.5]);
        assert.equal(host.sdk.query('atlas.trip').pace, 'riding, 25 km/day (Burr sets the pace)');
        await host.send('A day.', reply('Dusk.', ['! time +2 days']));
        await host.send('The horse.', reply('Burr limps.', ['~ trip delay: 1 day | because: lame horse']));
        const view = host.sdk.query('atlas.trip');
        assert.equal(view.legs[0].arrive, 'Goldwane 17');
        assert.equal(view.arrive, 'Goldwane 19');
        assert.deepEqual(view.delays, [{ text: '1 day: lame horse' }]);
        await host.send('Stop.', reply('We camp.', ['~ trip stop']));
        assert.equal(host.sdk.query('atlas.trip'), null);
        assert.equal(trips(host), undefined);
        assert.deepEqual(host.store.problems(), []);
    } finally {
        host.close();
    }
});

test('a line that cannot be used is a Problem and writes nothing: no route, no such place', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await newHost();
    try {
        await host.send('Hello.', reply('Bluewatch.', ['~ place Bluewatch Village', '+ landmark Lonely Tower | region: Far Marches | kind: ruin']));
        await host.send('Far.', reply('Far.', ['~ trip Lonely Tower | by: foot', '~ trip Atlantis | by: foot', '~ trip Wolfmere Outpost | by: teleport']));
        assert.equal(trips(host), undefined);
        const texts = host.turn.problems().map(problem => problem.message);
        assert.ok(texts.some(text => /^"~ trip Lonely Tower \| by: foot" was not used: No known route from Bluewatch Village to Lonely Tower\.$/.test(text)), texts.join(' | '));
        assert.ok(texts.some(text => /Atlantis is not on the map/.test(text)), texts.join(' | '));
        assert.ok(texts.some(text => /"teleport" is not a way of travelling here/.test(text)), texts.join(' | '));
        // A river route is known: the boat takes it whatever the trip rides.
        await host.send('River.', reply('River.', ['~ trip Glassdock | by: foot']));
        assert.deepEqual(goRecord(host).legs.map(leg => [leg.to, leg.km, leg.kind]), [['Glassdock', 440, 'river']]);
    } finally {
        host.close();
    }
});

test('replay: a swipe takes the trip back, a Re-read keeps it, a middle delete and a rebuild give the same state, and a delay without its trip does nothing', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await newHost();
    try {
        await host.send('Hello.', reply('Bluewatch.', ['~ place Bluewatch Village', '~ time Goldwane 12, 8:00 am']));
        await host.send('We set out.', reply('The road.', ['~ trip Wolfmere Outpost | by: foot']));
        assert.ok(goRecord(host));
        // A swipe of that reply without the line: gone.
        await host.swipe(reply('The road, another way.'));
        assert.equal(trips(host), undefined);
        // A swipe with it again; a Re-read keeps it.
        await host.swipe(reply('The road.', ['~ trip Wolfmere Outpost | by: foot']));
        const once = JSON.stringify(trips(host));
        assert.equal((await host.sdk.reread(host.ctx.chat.length - 1)).ok, true);
        assert.equal(JSON.stringify(trips(host)), once);
        assert.equal(Object.keys(trips(host)).length, 1);

        // More replies: time passes, a delay, a new trip that continues the road.
        await host.send('Two days.', reply('Dusk.', ['! time +2 days']));
        const delayAt = host.ctx.chat.length;
        await host.send('The horse.', reply('A shoe.', ['~ trip delay: 1 day | because: a shoe']));
        assert.equal(Object.keys(trips(host)).length, 2);
        const live = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live, 'rebuild == live');
        assert.deepEqual(host.store.problems(), []);

        // Delete the delay's reply (and its user message): the plan stands as it was made.
        await host.st.deleteMessage(delayAt + 1);
        await host.st.deleteMessage(delayAt);
        assert.deepEqual(host.store.problems(), [], 'the chat replays with no problem');
        assert.equal(Object.keys(trips(host)).length, 1);
        assert.equal(host.sdk.query('atlas.trip').legs[0].arrive, 'Goldwane 17');

        // Delete the reply that set out (a middle exchange): a later delay has nothing to move, and nothing fails.
        await host.send('The horse again.', reply('Another shoe.', ['~ trip delay: 1 day']));
        const first = host.ctx.chat.findIndex(message => /^The road\./.test(message.mes ?? ''));
        assert.ok(first > 0);
        await host.st.deleteMessage(first);
        await host.st.deleteMessage(first - 1);
        assert.deepEqual(host.store.problems(), [], 'no block of a later reply fails');
        assert.equal(host.sdk.query('atlas.trip'), null, 'the trip went with its reply: the delay moves nothing');
        const after = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), after);
    } finally {
        host.close();
    }
});

test('a new trip mid-road continues along the road; one that cannot is refused as a Problem and the old trip stands', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await newHost();
    try {
        await host.send('Hello.', reply('Bluewatch.', ['~ place Bluewatch Village', '~ time Goldwane 12, 8:00 am', '+ landmark Lonely Tower | region: Far Marches | kind: ruin']));
        await host.send('We set out.', reply('The road.', SET_OUT.slice(1)));
        await host.send('Two days.', reply('Forty km.', ['! time +2 days']));
        await host.send('Back.', reply('Turning back.', ['~ trip Auvoth | by: foot']));
        const record = goRecord(host);
        assert.deepEqual(record.legs.map(leg => [leg.from, leg.to, leg.km, leg.skip ?? 0]), [["Hollin's Reach", 'Bluewatch Village', 100, 60], ['Bluewatch Village', 'Auvoth', 70, 0]]);
        assert.equal(Object.keys(trips(host)).length, 1);
        const view = host.sdk.query('atlas.trip');
        assert.deepEqual([view.from, view.next, view.along, view.of], ["Hollin's Reach", 'Bluewatch Village', 60, 100]);
        await host.send('Stuck.', reply('Where?', ['~ trip Lonely Tower | by: foot']));
        assert.deepEqual(goRecord(host), record, 'the old trip stands');
        assert.ok(host.turn.problems().some(problem => /You are on the road between Hollin's Reach and Bluewatch Village/.test(problem.message)));
    } finally {
        host.close();
    }
});
