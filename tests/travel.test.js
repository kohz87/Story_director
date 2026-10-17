// Travel checks over the tracker, with the fixture world pack and the user's calendar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeCalendar } from '../src/calendar.js';
import { parseChanges } from '../src/changes.js';
import { replay } from '../src/tracker.js';
import { loadWorldPack } from '../src/routes.js';
import { corrections, nearbyPlaces, travelFindings } from '../src/travel.js';

const pack = loadWorldPack(JSON.parse(readFileSync(new URL('./fixtures/world-pack.json', import.meta.url), 'utf8'))).pack;
const cal = makeCalendar({ era: 'CY', daysPerMonth: 30, months: ['Dawnwane', 'Rainmoot', 'Greengale', 'Highsun', 'Goldwane', 'Haywane', 'Emberwane', 'Nightfall', 'Frostfall', 'Deepwinter', 'Icewane', 'Yearsend'] });
const at = text => cal.parse(text).abs;

// A tracker built the way the extension builds it: change lines replayed reply by reply.
function track(...replies) {
    return replay(replies.map(([message, time, lines]) => ({ message, time: at(time), text: '', ops: parseChanges(lines).ops }))).tracker;
}

test('a corridor written as one leg is not one hop: corrected to the first road', () => {
    const tracker = track([1, 'CY 611, Haywane 10, 06:00 am', '+ agenda Courier — now: leaves Shorn | leg: Shorn → Auvoth 130 B, courier 70/day → 2 | arrive: Haywane 12, morning']);
    const findings = travelFindings(tracker, { pack, calendar: cal });
    const hop = findings.find(finding => finding.kind === 'leg-not-one-hop');
    assert.ok(hop, 'flagged');
    assert.equal(hop.key, 'Courier');
    assert.match(hop.message, /^Courier: /);
    assert.match(hop.correction, /Shorn → Varnhold Watch 35 B/);
    const lines = corrections(findings);
    assert.equal(lines.length, 1, 'one correction per record');
    assert.match(lines[0], /^Courier — leg Shorn → Varnhold Watch 35 B/);
});

test('an invented road is flagged with the real exits', () => {
    const tracker = track([1, 'CY 611, Goldwane 13, 09:00 am', '+ agenda Giert — now: leaves Bluewatch | leg: Bluewatch Village → Siltbarrow 130 L, foot 16/day → 8.5']);
    const findings = travelFindings(tracker, { pack, calendar: cal });
    const bad = findings.find(finding => finding.kind === 'leg-no-edge' || finding.kind === 'leg-not-one-hop');
    assert.ok(bad, 'flagged');
    assert.equal(bad.severity, 'error');
});

test('a correct leg with the right arrival passes; a wrong arrival is corrected', () => {
    const good = track([1, 'CY 611, Goldwane 13, 09:00 am', '+ agenda Giert — now: walks the mules out | leg: Bluewatch Village → Auvoth 70 F, foot 16/day → 4.5 | arrive: Goldwane 17, 09:00 pm']);
    assert.deepEqual(travelFindings(good, { pack, calendar: cal }), []);

    const late = track([1, 'CY 611, Goldwane 13, 09:00 am', '+ agenda Giert — now: walks the mules out | leg: Bluewatch Village → Auvoth 70 F, foot 16/day → 1 | arrive: Goldwane 14, 09:00 am']);
    const findings = travelFindings(late, { pack, calendar: cal });
    assert.ok(findings.some(finding => finding.kind === 'leg-arrive'), 'arrival off by more than half a day');
});

test('a new leg must start where the last one ended', () => {
    const tracker = track(
        [1, 'CY 611, Haywane 10, 06:00 am', '+ agenda Courier — now: leaves Shorn | leg: Shorn → Varnhold Watch 35 B, courier 70/day → 0.5'],
        [3, 'CY 611, Haywane 10, 06:00 pm', '~ Courier — now: rides on | leg: Wolfmere Outpost → Auvoth 130 B, courier 70/day → 2'],
    );
    const previous = track([1, 'CY 611, Haywane 10, 06:00 am', '+ agenda Courier — now: leaves Shorn | leg: Shorn → Varnhold Watch 35 B, courier 70/day → 0.5']);
    const findings = travelFindings(tracker, { pack, calendar: cal, previous, onlyChanged: true });
    assert.ok(findings.some(finding => finding.kind === 'leg-wrong-start'), 'Varnhold Watch, not Wolfmere Outpost');
});

test('onlyChanged skips legs the reply copied unchanged; no pack, no findings', () => {
    const lines = '+ agenda Courier — now: leaves Shorn | leg: Shorn → Auvoth 130 B, courier 70/day → 2';
    const before = track([1, 'CY 611, Haywane 10, 06:00 am', lines]);
    const after = track([1, 'CY 611, Haywane 10, 06:00 am', lines], [3, 'CY 611, Haywane 10, 09:00 am', '~ Courier — then: delivers the writ']);
    assert.deepEqual(travelFindings(after, { pack, calendar: cal, previous: before, onlyChanged: true }), []);
    assert.ok(travelFindings(after, { pack, calendar: cal }).length > 0, 'still wrong when all legs are checked');
    assert.deepEqual(travelFindings(after, { pack: null, calendar: cal }), []);
});

test('nearbyPlaces: the place and its one-road neighbours', () => {
    const near = nearbyPlaces(pack, 'Auvoth | Seventh Seal Terrace');
    assert.equal(near[0], 'Auvoth');
    assert.ok(near.includes('Bluewatch Village'));
    assert.ok(near.includes('Wolfmere Outpost'));
    assert.deepEqual(nearbyPlaces(pack, 'Nowhere'), []);
    assert.deepEqual(nearbyPlaces(null, 'Auvoth'), []);
});

test('nearbyPlaces leaves out long and far-reaching roads', () => {
    const wide = { ...pack, edges: [...pack.edges, { a: 'Auvoth', b: 'Glass Howl Icefield', km: 5610, code: 'X', corridor: 'Expedition', notes: '' }, { a: 'Auvoth', b: 'Far Keep', km: 400, code: 'R', corridor: 'Long road', notes: '' }] };
    const near = nearbyPlaces(wide, 'Auvoth');
    assert.ok(!near.includes('Glass Howl Icefield'), 'an expedition road is not nearby');
    assert.ok(!near.includes('Far Keep'), 'a 400 km road is not nearby');
    assert.ok(near.includes('Bluewatch Village'));
});
