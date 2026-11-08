// Chronicle part: the bookkeeping rule (isBookkeeping, used by "What happened") over receipts shaped like the ones a real
// long chat (Ersveil) holds: type, cause, summary and the block result's kind, copied by hand, no chat text beyond these lines.

import test from 'node:test';
import assert from 'node:assert/strict';

import { isBookkeeping } from '../../../src/v2/chronicle/days/shared.js';
import { eventsOf } from '../../../src/v2/chronicle/days/facts.js';

const dm = (summary, kind) => ({ type: 'capture.dm', module: 'story-block', cause: 'story', narrate: false, summary, data: { v2: { result: { kind } } } });
const make = (type, summary, cause = 'story', module = 'story-block') => ({ type, module, cause, narrate: false, summary, data: {} });

const CHAT = [
    dm('Adventurer Guild membership: register.', 'register'),
    dm('Adventurer Guild membership: contract.', 'contract'),
    dm('Fame by region: deed.', 'deed'),
    dm('Astra: add-xp.', 'add-xp'),
    dm('Astra: set-health (Health Scratched → Unhurt).', 'set-health'),
    dm('Astra: set-mana (Mana Empty → Steady).', 'set-mana'),
    dm('Astra: set-stamina (Stamina Spent → Winded).', 'set-stamina'),
    dm('Foes: set-slot-1.', 'set-slot-1'),
    dm('Foes: clear-1 (Health 1 Down → Unhurt).', 'clear-1'),
    dm('Foes: clear-3.', 'clear-3'),
    make('dm.settle', 'Astra: settled at the end of the reply.', 'system'),
    make('time.settle', 'Story time settled at Goldwane 12, 06:40 am.', 'system', 'story-director'),
    make('cast.advance', 'The cast: nothing changed.', 'system', 'story-director'),
    make('director.initiative', 'Initiative for the next reply: Nelje.', 'system', 'story-director'),
    make('rpg.resolve', 'Tell the settled fight results in order; do not reroll them. | Write [battle] on its own line where the fight is told.', 'system'),
    make('capture.time', 'Director: ~ time <CY 611, Goldwane 12, 07:30 am> (not used)', 'story', 'story-director'),
    make('keypeople.sync', '', 'system', 'story-director'),
    make('chronicle.note', '', 'system', 'story-director'),
    make('capture.item', 'The party gains Bone-Knit Salve.'),
    make('capture.coin', 'The party receives 3 silver 6 copper — from Marrit (now 1 gold 6 copper).'),
    make('rpg.practice', 'Practice: Astra\'s Shadow Cut +9, Astra\'s Shadow Step +18.', 'system'),
];

test('the rule drops the chat\'s bookkeeping receipts and keeps its story events', () => {
    // (quiet() drops system steps first; practice is the one it lets through, see shared.js)
    const left = CHAT.filter(receipt => !isBookkeeping(receipt)).map(receipt => receipt.summary);
    for (const text of left) assert.ok(!/set-health|set-mana|set-stamina|settled|Initiative|Tell the settled fight/.test(text), text);
    for (const kept of ['Adventurer Guild membership: register.', 'The party gains Bone-Knit Salve.', 'Astra: add-xp.', 'Fame by region: deed.']) {
        assert.ok(left.includes(kept), kept);
    }
    assert.ok(left.some(text => text.startsWith('Practice: ')));
    assert.ok(left.some(text => text.includes('3 silver 6 copper')));
});

test('"What happened" (eventsOf) keeps the practice, register and item lines and none of the bookkeeping', () => {
    const events = eventsOf(CHAT);
    assert.ok(events.includes('Adventurer Guild membership: register.'));
    assert.ok(events.includes('The party gains Bone-Knit Salve.'));
    assert.ok(events.some(text => text.startsWith('Practice: ')));
    assert.ok(!events.some(text => /set-health|set-mana|set-stamina|clear-|settled|Initiative|Tell the settled fight/.test(text)));
});

test('the rule reads the result kind, not the text: a register line worded like a set stays, a set kind goes', () => {
    assert.equal(isBookkeeping(dm('Astra: set-health.', 'register')), false);
    assert.equal(isBookkeeping(dm('Anything.', 'set-health')), true);
    assert.equal(isBookkeeping(make('capture.item', 'A receipt with any words.')), false);
    assert.equal(isBookkeeping({ type: 'dm.act', summary: 'Astra: set-mana.', data: { v2: { result: { kind: 'set-mana' } } } }), true);
});
