// journal.day (contract §3): one story day for another module, from the visible digest, else the visible facts, else a saved scene;
// independent of the digest and the World screen; what {{user}} must not know never in it.
import test from 'node:test';
import assert from 'node:assert/strict';

import { journalDay } from '../../../src/v2/world/index.js';
import { DIGEST_FEATURE } from '../../../src/v2/chronicle/days.js';
import { FEATURE } from '../../../src/v2/world/index.js';
import { said, worldHost } from './helpers.js';

async function story() {
    const host = await worldHost();
    await host.send('Hello.', said('The harbour at dawn.', [
        '~ time June 3, 1200, 08:00 am', '~ place Harbour', '+ present Mira',
        '+ world Red Plague — coughing in the docks | state: ongoing | place: Harbour',
        '+ secret Bell Curse — cast with ashes', '+ world Bell Curse — whispered in the taverns | state: looming',
    ]));
    await host.send('Next day.', said('Morning again.', ['~ time June 4, 1200, 09:00 am', '+ present Brecht']));
    await host.send('Next.', said('A third.', ['~ time June 5, 1200, 07:00 am', '+ present Wynn']));
    return host;
}
const day = (host, args) => host.sdk.query('journal.day', args);

test('a written day: the digest\'s lines, titled with the day and its date, source digest, nothing hidden', async () => {
    const host = await story();
    const first = host.sdk.query('chronicle.days', {})[0].day;
    const out = day(host, { day: first });
    host.close();
    assert.deepEqual([out.day, out.source, out.missing], [first, 'digest', false]);
    assert.match(out.title, new RegExp(`^Day ${first} · June 3, 1200$`));
    assert.ok(out.lines.length >= 1 && out.lines.length <= 12);
    assert.ok(out.lines.every(line => typeof line === 'string' && line.length > 0 && line.length <= 240));
    assert.ok(out.lines.some(line => /Red Plague/.test(line)));
    assert.ok(out.lines.some(line => /Mira/.test(line)), 'who was met');
    assert.doesNotMatch(JSON.stringify(out), /Bell Curse|whispered/, 'a secret\'s name is not in a recap');
});

test('it works with the digest and the World view off, and the day under way is its facts', async () => {
    const host = await story();
    const first = host.sdk.query('chronicle.days', {})[0].day;
    host.features.set(DIGEST_FEATURE, false);
    host.features.set(FEATURE, false);
    const written = day(host, { day: first });
    assert.equal(written.source, 'digest', 'the digest kept is still the source');
    const today = host.sdk.query('time.now', {}).day;
    const now = day(host, { day: today });
    host.close();
    assert.equal(now.source, 'facts');
    assert.equal(now.missing, false);
    assert.ok(now.lines.length > 0);
});

test('a day with nothing: missing, titled Day <n>, no lines; the saved scene of a save point is its line; bad days are null', async () => {
    const host = await story();
    const empty = day(host, { day: 3 });
    assert.deepEqual(empty, { day: 3, title: 'Day 3', lines: [], source: 'snapshot', missing: true });
    assert.deepEqual(day(host, { day: -1 }), { day: -1, title: 'Day -1', lines: [], source: 'snapshot', missing: true }, 'the clock may be negative: a day before the first is a day');
    assert.equal(day(host, { day: -6254999482461 }), null);
    assert.equal(day(host, { day: 6254999482460 }), null);
    assert.equal(day(host, { day: 1.5 }), null);
    assert.equal(day(host, { day: 'x' }), null);
    assert.equal(day(host, {}), null);
    host.close();
    // A save point's scene, asked through savepoint.list as the host answers it.
    const state = { domains: { chronicle: { events: {}, factions: {}, days: {} } } };
    const tools = { query: (name) => { if (name === 'savepoint.list') return [{ id: 'sv_00000001', scene: { place: null, text: 'Astra waits at the quay.' }, journal: null }]; throw new Error('no'); } };
    assert.deepEqual(journalDay(state, { day: 9, snapshot: 'sv_00000001' }, tools), { day: 9, title: 'Day 9', lines: ['Astra waits at the quay.'], source: 'snapshot', missing: true });
    assert.deepEqual(journalDay(state, { day: 9, snapshot: 'sv_00000002' }, tools).lines, []);
    const withJournal = { query: () => [{ id: 'sv_00000001', scene: { place: null, text: 'x' }, journal: { day: 9, lines: ['Day nine, in short.'] } }] };
    assert.deepEqual(journalDay(state, { day: 9, snapshot: 'sv_00000001' }, withJournal), { day: 9, title: 'Day 9', lines: ['Day nine, in short.'], source: 'snapshot', missing: false });
});

test('twelve lines at most, each cut to 240 characters, whatever the digest holds', () => {
    const long = 'x'.repeat(300);
    const state = { domains: { chronicle: { events: {}, factions: {}, days: { 2: [{ day: 2, date: 'June 3, 1200', line: 'June 3, 1200: much', brief: false, count: 30, more: 0, happened: Array.from({ length: 8 }, (_, i) => `Thing ${i}. ${long}`), places: ['A', 'B', 'C'], quests: { taken: ['Q1'], done: ['Q2'], failed: [], dropped: [] }, fights: { count: 2, won: 1, lost: 1, fled: 0 }, money: { in: 5, out: 3 }, npcs: ['N1', 'N2'], world: ['W1', 'W2', 'W3'], met: ['M1'], revs: [], made: 1 }] } } } };
    const out = journalDay(state, { day: 2 }, { query: () => null });
    assert.equal(out.source, 'digest');
    assert.ok(out.lines.length <= 12 && out.lines.length > 5);
    assert.ok(out.lines.every(line => line.length <= 240));
});
