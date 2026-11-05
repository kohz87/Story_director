// The places the story talks about, checked against the world pack's roads (0.9.22): place matching and the note's Distances line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadWorldPack, placesIn } from '../src/routes.js';
import { noteParts } from '../src/note.js';

const { pack } = loadWorldPack(JSON.parse(readFileSync(new URL('./fixtures/world-pack.json', import.meta.url), 'utf8')));

test('placesIn finds every place named, in order, a long name once', () => {
    assert.deepEqual(placesIn(pack, 'From Bluewatch Village to Glassdock, then Auvoth.'), ['Bluewatch Village', 'Glassdock', 'Auvoth']);
    assert.deepEqual(placesIn(pack, 'Nothing on the map here.'), []);
});

test('the note gives the distances, and says to keep to them when the reply was off', () => {
    const now = 0;
    const selection = { now, place: 'Bluewatch Village', arc: null, due: [], arriving: [], relevant: [], dormant: [], secrets: [], resolvedRecently: [] };
    const distances = [{ place: 'Ledgerford', fastest: { days: 12, mode: 'ride' }, slowest: { days: 20, mode: 'wagon' }, said: { text: 'three days' } }];
    const part = noteParts(selection, { distances, distanceFrom: 'Bluewatch Village' }).find(entry => entry.label === 'Distances');
    const { fastest, slowest } = distances[0];
    assert.equal(part.text, `Distances from Bluewatch Village: Ledgerford ${Math.round(fastest.days)}–${Math.round(slowest.days)} days (riding to wagon), not three days. Keep to these when the trip comes up again.`);
    const plain = noteParts(selection, { distances: [{ place: 'Auvoth', fastest: { days: 4, mode: 'ride' }, slowest: { days: 6, mode: 'ride' }, said: null }], distanceFrom: 'Bluewatch Village' }).find(entry => entry.label === 'Distances');
    assert.doesNotMatch(plain.text, /Keep to these/);
    assert.equal(noteParts(selection, {}).some(entry => entry.label === 'Distances'), false);
});
