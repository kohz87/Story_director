// Whether an offer's giver is in the scene (src/presence.js, 0.9.34).
import test from 'node:test';
import assert from 'node:assert/strict';
import { giverNames, giverPresent, presentPart } from '../src/presence.js';

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
