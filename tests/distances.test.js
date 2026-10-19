// The places the story talks about, checked against the world pack's roads (0.9.22).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadWorldPack, placesIn } from '../src/routes.js';
import { distancesFor, saidDuration, tripRange } from '../src/distances.js';
import { noteParts } from '../src/note.js';

const { pack } = loadWorldPack(JSON.parse(readFileSync(new URL('./fixtures/world-pack.json', import.meta.url), 'utf8')));

test('saidDuration reads the travel times stories write, spans by their ends', () => {
    const read = text => { const said = saidDuration(text); return said && [said.days, said.most, said.text]; };
    assert.deepEqual(read('but that’s three days downstream'), [3, 3, 'three days']);
    assert.deepEqual(read('Auvoth lies a day or two east'), [1, 2, 'a day or two']);
    assert.deepEqual(read('two to four days by cart'), [2, 4, 'two to four days']);
    assert.deepEqual(read('3-5 days'), [3, 5, '3-5 days']);
    assert.deepEqual(read("a week's ride"), [7, 7, "a week's"]);
    assert.deepEqual(read('half a day on foot'), [0.5, 0.5, 'half a day']);
    assert.equal(read('the days are long here'), null);
});

test('placesIn finds every place named, in order, a long name once', () => {
    assert.deepEqual(placesIn(pack, 'From Bluewatch Village to Glassdock, then Auvoth.'), ['Bluewatch Village', 'Glassdock', 'Auvoth']);
    assert.deepEqual(placesIn(pack, 'Nothing on the map here.'), []);
});

test('tripRange: the quickest and slowest way by the roads; nothing for the same place', () => {
    const range = tripRange(pack, 'Bluewatch Village', 'Glassdock');
    assert.equal(range.fastest.mode, 'boat');
    assert.ok(range.fastest.days < range.slowest.days);
    assert.equal(tripRange(pack, 'Bluewatch Village', 'Bluewatch Village'), null);
});

test('distancesFor: the places the reply and the reader name, and a time said far off the map', () => {
    const reply = '"And the ferryman at Ledgerford sent word about river-leeches fouling the haul-chains, but that’s three days downstream." Auvoth lies a day or two east.';
    const found = distancesFor(pack, 'Bluewatch Village | Adventurer Guild Branch', { reply, message: 'I ask about Glassdock and Bluewatch Village.' });
    assert.deepEqual(found.map(entry => [entry.place, entry.said?.text ?? null]), [['Ledgerford', 'three days'], ['Auvoth', null], ['Glassdock', null]],
        'three days to Ledgerford is far too short; a day or two to Auvoth is close enough; the reader is never corrected; here is left out');
    assert.deepEqual(distancesFor(pack, 'Nowhere known', { reply }), [], 'no starting point on the map');
    // A sentence naming two places says nothing about either one's distance.
    assert.equal(distancesFor(pack, 'Bluewatch Village', { reply: 'Glassdock and Auvoth are both three days away.' }).some(entry => entry.said), false);
});

test('the note gives the distances, and says to keep to them when the reply was off', () => {
    const now = 0;
    const selection = { now, place: 'Bluewatch Village', arc: null, due: [], arriving: [], relevant: [], dormant: [], secrets: [], resolvedRecently: [] };
    const distances = distancesFor(pack, 'Bluewatch Village', { reply: 'The ferryman at Ledgerford is three days downstream.' });
    const part = noteParts(selection, { distances, distanceFrom: 'Bluewatch Village' }).find(entry => entry.label === 'Distances');
    const { fastest, slowest } = distances[0];
    assert.equal(part.text, `Distances from Bluewatch Village: Ledgerford ${Math.round(fastest.days)}–${Math.round(slowest.days)} days (riding to wagon), not three days. Keep to these when the trip comes up again.`);
    const plain = noteParts(selection, { distances: distancesFor(pack, 'Bluewatch Village', { message: 'Is Auvoth far?' }), distanceFrom: 'Bluewatch Village' }).find(entry => entry.label === 'Distances');
    assert.doesNotMatch(plain.text, /Keep to these/);
    assert.equal(noteParts(selection, {}).some(entry => entry.label === 'Distances'), false);
});
