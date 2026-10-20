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

test('present when NPCs Present or the latest reply names them; Off-Screen never counts', () => {
    assert.match(presentPart(SCENE), /Elke/);
    assert.doesNotMatch(presentPart(SCENE), /Kaelen|Aldo/);
    assert.equal(giverPresent('Elke (for Watch-Captain)', { scene: SCENE }), true);
    assert.equal(giverPresent('Convoy Master Kaelen', { scene: SCENE }), false);
    assert.equal(giverPresent('Brother Aldo', { scene: SCENE, reply: 'Brother Aldo waves you over from the shrine steps.' }), true);
    // No World State: the latest reply alone.
    assert.equal(giverPresent('Reeve Hollis', { reply: 'Hollis taps the slip.' }), true);
    assert.equal(giverPresent('Reeve Hollis', { reply: 'The hall is empty.' }), false);
    // No giver: nothing to look for.
    assert.equal(giverPresent('', { scene: SCENE }), null);
});
