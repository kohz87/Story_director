// Whether an offer's giver is in the scene (src/presence.js, 0.9.34).
import test from 'node:test';
import assert from 'node:assert/strict';
import { giverNames, giverPresent, offerPlace, offerPresence, presentPart, settlementKey } from '../src/presence.js';

const SCENE = [
    '**📅 Time:** CY 611, Goldwane 12, 01:15 pm | **🌤 Loc:** Bluewatch Village | Adventurer Guild Post',
    '---',
    '**👥 NPCs Present:**',
    '**Elke:**',
    '* *Position:* Leaning over the counter',
    '---',
    '**📡 Off-Screen:**',
    '* Convoy Master Kaelen — checking cart axles behind the Stray Oar',
    '* Brother Aldo — praying at the shrine',
].join('\n');

test('a giver goes by their name, not their title or who they act for', () => {
    assert.deepEqual(giverNames('Elke (for Watch-Captain)'), ['elke']);
    assert.deepEqual(giverNames('Reeve Hollis'), ['hollis', 'reeve hollis']);
    assert.deepEqual(giverNames('Brother Aldo, of the shrine'), ['aldo', 'brother aldo']);
    assert.deepEqual(giverNames(''), []);
});

test('the first source there is decides: NPCs Present, then NPC State Delta\'s cast, then the latest reply (0.9.36)', () => {
    assert.match(presentPart(SCENE), /Elke/);
    assert.doesNotMatch(presentPart(SCENE), /Kaelen|Aldo/);
    assert.equal(giverPresent('Elke (for Watch-Captain)', { scene: SCENE }), true);
    assert.equal(giverPresent('Convoy Master Kaelen', { scene: SCENE }), false);
    // The scene board decides: a reply naming someone off it does not bring them in.
    assert.equal(giverPresent('Brother Aldo', { scene: SCENE, present: ['Aldo'], reply: 'Brother Aldo waves from the shrine.' }), false);
    // No scene board: NPC State Delta's present cast.
    assert.equal(giverPresent('Brother Aldo', { present: ['Aldo', 'Elke'], reply: '' }), true);
    assert.equal(giverPresent('Reeve Hollis', { present: ['Aldo'], reply: 'Hollis taps the slip.' }), false);
    // Neither: the latest reply.
    assert.equal(giverPresent('Reeve Hollis', { present: [], reply: 'Hollis taps the slip.' }), true);
    assert.equal(giverPresent('Reeve Hollis', { reply: 'The hall is empty.' }), false);
    // No giver: nothing to look for.
    assert.equal(giverPresent('', { scene: SCENE }), null);
});

test('an offer is here in the settlement it was offered in, or with its giver; elsewhere it says where (0.9.37)', () => {
    const visits = [{ message: 2, text: 'Bluewatch Village | Adventurer Guild Post | [64.1, 110.2]' }, { message: 9, text: 'Reed Beds south of the boom' }];
    const offer = { key: 'Drake Shallows', fields: { giver: 'Elke (for Watch-Captain)', place: 'lower shallows' }, created: { message: 4 }, seen: { message: 9 } };
    assert.equal(settlementKey('Bluewatch Village | Stray Oar'), 'bluewatch');
    assert.equal(offerPlace(offer, visits), 'Bluewatch Village | Adventurer Guild Post | [64.1, 110.2]', 'where it was first shown, not its job site');
    assert.deepEqual(offerPresence(offer, { place: 'Bluewatch Village | Stray Oar', visits }), { here: true, badge: 'Bluewatch Village · here', ask: '' });
    assert.deepEqual(offerPresence(offer, { place: 'Reed Beds south of the boom', visits }), { here: false, badge: 'offered in Bluewatch Village', ask: "You're not in Bluewatch Village — take it anyway?" });
    // Elsewhere but with the giver: here.
    assert.deepEqual(offerPresence(offer, { place: 'Reed Beds', visits, reply: 'Elke catches up with you at the boom.' }), { here: true, badge: 'Elke · here', ask: '' });
    // No place known: the giver alone, as before; neither: nothing to tell.
    assert.deepEqual(offerPresence({ key: 'X', fields: { giver: 'Elke' } }, { reply: 'The hall is empty.' }), { here: false, badge: 'Elke · not here', ask: "Elke isn't here — take it anyway?" });
    assert.equal(offerPresence({ key: 'X', fields: {} }, {}), null);
});
