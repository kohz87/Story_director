// The `? check` line as one checks.roll (E7b): one die, the policy's modifiers, the model's `result:` never read, no second roll for the same line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hashOf, makeState, run, write } from './helpers.js';
import { dcOf } from '../../../src/v2/checks/words.js';
import { checkKind, part } from '../../../src/v2/checks/index.js';

const SOURCE = { sid: 'sr_00000001', swipeKey: 'sw_00000001', evidence: 'ev_00000001', ordinal: 1 };
function ready() {
    let state = makeState();
    state = run(state, 'checks.actor', { write: write(), name: 'Mara', bonuses: { DEX: 2 }, expectedHash: hashOf(state) }).state;
    state = run(state, 'checks.actor', { write: write(), name: 'Tov', bonuses: { CHA: 4 }, expectedHash: hashOf(state) }).state;
    return state;
}
const line = (raw, state, options = {}) => {
    const [head, ...rest] = raw.split(/\s*\|\s*/);
    const [name, ...text] = head.replace(/^\?\s*check\s+/, '').split(/\s+—\s+/);
    const labels = Object.fromEntries(rest.map(piece => [piece.slice(0, piece.indexOf(':')).trim().toLowerCase(), piece.slice(piece.indexOf(':') + 1).trim()]));
    return run(state, 'check', { op: '?', kind: 'check', name, text: text.join(' — '), labels, raw }, { cause: 'story', source: SOURCE, ...options });
};

test('the grammar is the old one and, after the flip, this part keeps the `check` kind (example fight runner\'s part is gone)', () => {
    assert.match(checkKind.grammar, /^\? check .* \| dc: easy\|normal\|hard\|very hard \| who: Name \| vs: Name$/);
    assert.equal(part.kinds.check, checkKind);
});

test('a line rolls once: the default actor, the difficulty word as its number, the model\'s result ignored; the same line again is refused', () => {
    const state = ready();
    const out = line('? check Stealth — slip past the guard | dc: hard | result: success', state, { die: 3 });
    assert.ok(out.ok, out.message);
    const result = out.result.data.v2.result;
    assert.deepEqual([result.die, result.dc, result.mod, result.total, result.outcome], [3, 20, 2, 5, 'fail'], 'the story said success; the die said otherwise');
    assert.equal(out.result.narrate, true);
    assert.equal(Object.keys(out.state.domains.checks.log).length, 1);
    const again = line('? check Stealth — slip past the guard | dc: hard', out.state);
    assert.equal(again.code, 'REFUSED', 'one claim for one line on one reply');
    assert.ok(line('? check Stealth — another try | dc: easy', out.state).ok, 'another difficulty is another check');
});

test('who names one of SD\'s own actors, exactly; vs names a person NSD knows; neither is guessed', () => {
    const state = ready();
    const tov = line('? check Persuade — talk round | dc: normal | who: tov', state, { die: 10 });
    assert.ok(tov.ok, tov.message);
    assert.equal(tov.result.data.v2.result.mod, 4);
    assert.equal(line('? check Persuade — talk | dc: normal | who: Nobody', state).code, 'NOT_FOUND');
    const queries = { 'npc.identity': ({ name, id }) => (name === 'Brannoc' || id === 'np_00000001' ? { id: 'np_00000001', nativeKey: 'brannoc', name: 'Brannoc' } : null), 'npc.socialModifier': ({ name, skill }) => ({ mod: 2, name, skill, reasons: [{ text: 'trusts you', value: 2 }] }) };
    const vs = line('? check Persuade — talk | dc: normal | vs: Brannoc', state, { queries });
    assert.ok(vs.ok, vs.message);
    assert.equal(vs.result.data.v2.result.modifiers.at(-1).source, 'social');
    assert.equal(line('? check Persuade — talk | dc: normal | vs: Stranger', state, { queries }).code, 'NOT_FOUND');
});

test('what is refused is refused whole: a bad difficulty, no skill, no reply, an unknown who; no die and no claim are kept', () => {
    const state = ready();
    for (const raw of ['? check Stealth — x | dc: kinda', '? check Stealth — x | stat: WIS | dc: easy']) {
        const out = line(raw, state);
        assert.ok(['INVALID'].includes(out.code), raw + out.code);
        assert.deepEqual(out.state.meta.claims, {});
    }
    assert.equal(run(state, 'check', { op: '?', kind: 'check', name: 'Stealth', labels: { dc: 'easy' } }, { cause: 'story', source: null }).code, 'REFUSED', 'no reply to hold it: a refusal that says so, not a failure');
    assert.equal(line('? check Stealth — x | dc: easy | who: Mara', makeState()).code, 'NOT_FOUND');
    assert.equal(line('? check Stealth — x | dc: easy', makeState()).ok, true, 'with no character yet the player rolls with no bonuses');
    assert.equal(run(state, 'check', { op: '?', kind: 'check', name: '', labels: { dc: 'easy' } }, { cause: 'story', source: SOURCE }).code, 'INVALID');
});

test('difficulties: the table\'s words and the numbers from 1 to 40', () => {
    assert.deepEqual(['easy', 'Normal', 'very hard', 'DC 12', '40', 30].map(dcOf), [10, 15, 25, 12, 40, 30]);
    assert.deepEqual(['', 'kinda', '0', '41', null].map(dcOf), [null, null, null, null, null]);
});
