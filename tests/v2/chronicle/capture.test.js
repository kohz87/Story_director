// Chronicle part: `world` and `faction` lines (read by Story Block's own parser), the times code
// stamps from the Director's clock, the reader's `chronicle.edit` / `chronicle.remove`, every
// refusal (nothing saved), and replay of the ops equal to the state they built.

import test from 'node:test';
import assert from 'node:assert/strict';

import { MAX_EVENTS, MAX_FACTIONS, initialChronicle, validateChronicle } from '../../../src/v2/chronicle/domain.js';
import { clockOf, readNames, readState } from '../../../src/v2/chronicle/capture.js';
import {
    clockAt, command, eventNamed, factionNamed, line, lines, makeState, replay, runCommand,
} from './helpers/fake-ctx.js';
import { part } from '../../../src/v2/chronicle/index.js';

const DAY = 1440;

test('+ world adds an event: summary, state, place and factions as written, times from the clock', () => {
    const state = makeState({ minutes: 10 * DAY });
    const run = line(state, '+ world Dragon Calamity — awakens near Dragonfang | state: ongoing | place: Dragonfang | factions: Ashen Court, River Guild');
    assert.equal(run.ok, true, run.message);
    const event = eventNamed(run.state, 'Dragon Calamity');
    assert.match(event.id, /^ev_[0-9a-z]{8}$/);
    assert.deepEqual({ ...event, id: undefined }, {
        id: undefined, name: 'Dragon Calamity', summary: 'awakens near Dragonfang', state: 'ongoing', since: 10 * DAY, updated: 10 * DAY,
        place: 'Dragonfang', factions: ['Ashen Court', 'River Guild'], aka: [], rev: 1,
    });
    assert.equal(run.result.summary, 'World: Dragon Calamity (Dragonfang) is now ongoing — awakens near Dragonfang.');
    assert.equal(run.result.narrate, false);
    assert.deepEqual(validateChronicle(run.state.domains.chronicle), []);
    // Only the chronicle changed (and the rev).
    assert.ok(run.ops.every(op => op.path.startsWith('/domains/chronicle/') || op.path === '/meta/rev'));
});

test('the state defaults to ongoing; looming and the words models use are read; a bad state is refused', () => {
    let state = makeState();
    state = line(state, '+ world Border Unrest — raids along the river').state;
    assert.equal(eventNamed(state, 'Border Unrest').state, 'ongoing');
    state = line(state, '+ world Red Plague — coughing in the docks | state: rumoured').state;
    assert.equal(eventNamed(state, 'Red Plague').state, 'looming');
    assert.deepEqual(readState('Ended — the pass is held'), { state: 'resolved', rest: 'the pass is held' });
    assert.deepEqual(readState('under way'), { state: 'ongoing', rest: '' });
    const bad = line(state, '~ world Red Plague | state: smouldering');
    assert.deepEqual([bad.ok, bad.code], [false, 'INVALID']);
    assert.match(bad.message, /"smouldering" is not a state; write looming, ongoing or resolved/);
    assert.equal(bad.state, state, 'nothing saved');
});

test('~ world X | state: resolved — summary: the text after the dash is the new summary; updated moves, since stays', () => {
    let state = makeState({ minutes: DAY });
    state = line(state, '+ world Dragon Calamity — awakens near Dragonfang | place: Dragonfang').state;
    state = clockAt(state, 4 * DAY);
    const run = line(state, '~ world Dragon Calamity | state: resolved — slain at the pass');
    assert.equal(run.ok, true, run.message);
    const event = eventNamed(run.state, 'Dragon Calamity');
    assert.deepEqual([event.state, event.summary, event.since, event.updated, event.rev], ['resolved', 'slain at the pass', DAY, 4 * DAY, 2]);
    assert.equal(run.result.summary, 'World: Dragon Calamity (Dragonfang) has ended — slain at the pass.');
});

test('- world X — how it ended resolves it and keeps it; an unknown name is NOT_FOUND', () => {
    let state = makeState({ minutes: DAY });
    state = line(state, '+ world Siege of Harrow — the Ashen Court surrounds Harrow').state;
    const run = line(state, '- world Siege of Harrow — the siege is lifted');
    assert.equal(run.ok, true);
    const event = eventNamed(run.state, 'Siege of Harrow');
    assert.deepEqual([event.state, event.summary], ['resolved', 'the siege is lifted']);
    assert.equal(run.result.summary, 'World: Siege of Harrow has ended — the siege is lifted.');
    const missing = line(state, '- world Nothing Like It');
    assert.deepEqual([missing.ok, missing.code], [false, 'NOT_FOUND']);
    assert.equal(missing.state, state);
});

test('~ on a name not kept adds it; + on a known name changes it; ! is news; a line changing nothing keeps updated', () => {
    let state = makeState({ minutes: DAY });
    state = line(state, '~ world Grain Shortage — bread doubles in price').state;
    assert.equal(eventNamed(state, 'Grain Shortage').state, 'ongoing');
    state = clockAt(state, 2 * DAY);
    state = line(state, '+ world grain shortage | place: Harrow').state;
    const event = eventNamed(state, 'Grain Shortage');
    assert.equal(Object.keys(state.domains.chronicle.events).length, 1);
    assert.deepEqual([event.place, event.updated, event.summary], ['Harrow', 2 * DAY, 'bread doubles in price']);
    state = clockAt(state, 3 * DAY);
    const news = line(state, '! world Grain Shortage — riots at the granary');
    assert.equal(eventNamed(news.state, 'Grain Shortage').summary, 'riots at the granary');
    state = clockAt(news.state, 5 * DAY);
    const same = line(state, '~ world Grain Shortage | place: Harrow');
    assert.equal(same.ok, true);
    assert.equal(same.result.summary, 'World: Grain Shortage is unchanged.');
    assert.equal(eventNamed(same.state, 'Grain Shortage').updated, 3 * DAY, 'nothing changed: the news time stays');
    const ask = line(state, '? world Grain Shortage');
    assert.deepEqual([ask.ok, ask.code], [false, 'INVALID']);
});

test('times are code\'s: ctx.time() first, then director.time, never a label the model wrote; null while unset', () => {
    const state = makeState({ minutes: 3 * DAY });
    const run = line(state, '+ world Long Winter — snow in summer | since: year 1 | updated: today', { time: () => 7 * DAY });
    const event = eventNamed(run.state, 'Long Winter');
    assert.deepEqual([event.since, event.updated], [7 * DAY, 7 * DAY], 'ctx.time() wins; the since/updated labels are not read');
    const viaQuery = line(state, '+ world Long Winter — snow in summer');
    assert.equal(eventNamed(viaQuery.state, 'Long Winter').since, 3 * DAY);
    const unset = line(makeState(), '+ world Long Winter — snow in summer');
    assert.deepEqual([eventNamed(unset.state, 'Long Winter').since, eventNamed(unset.state, 'Long Winter').updated], [null, null]);
    // clockOf reads the director domain when no query answers.
    assert.equal(clockOf({ read: () => ({ time: { minutes: 42 } }) }), 42);
    assert.equal(clockOf({ time: () => null, query: () => { throw new Error('no'); }, read: () => null }), null);
});

test('factions: + adds with area and stance, ~ changes, - takes it out; place and factions clear with none', () => {
    let state = makeState();
    const run = line(state, '+ faction Ashen Court — the old nobility of the north | area: Northmarch | stance: wary of {{user}}');
    assert.equal(run.ok, true, run.message);
    let court = factionNamed(run.state, 'Ashen Court');
    assert.match(court.id, /^fa_[0-9a-z]{8}$/);
    assert.deepEqual([court.summary, court.area, court.stance, court.rev], ['the old nobility of the north', 'Northmarch', 'wary of {{user}}', 1]);
    assert.equal(run.result.summary, 'Faction: Ashen Court (in Northmarch, wary of {{user}}) — the old nobility of the north.');
    state = line(run.state, '~ faction Ashen Court | stance: hostile').state;
    court = factionNamed(state, 'Ashen Court');
    assert.deepEqual([court.stance, court.summary, court.rev], ['hostile', 'the old nobility of the north', 2]);
    state = line(state, '~ faction Ashen Court | area: none').state;
    assert.equal(factionNamed(state, 'Ashen Court').area, '');
    const gone = line(state, '- faction Ashen Court — broken at Harrow');
    assert.equal(gone.result.summary, 'Faction: Ashen Court is gone — broken at Harrow.');
    assert.deepEqual(gone.state.domains.chronicle.factions, {});
    const missing = line(gone.state, '- faction Ashen Court');
    assert.deepEqual([missing.ok, missing.code], [false, 'NOT_FOUND']);

    state = line(makeState(), '+ world War — the north rises | place: Harrow | factions: Ashen Court and River Guild').state;
    assert.deepEqual(eventNamed(state, 'War').factions, ['Ashen Court', 'River Guild']);
    state = line(state, '~ world War | place: none | factions: none').state;
    assert.deepEqual([eventNamed(state, 'War').place, eventNamed(state, 'War').factions], ['', []]);
    assert.deepEqual(readNames('A, B; a vs C / D & E and F, G'), ['A', 'B', 'C', 'D', 'E', 'F']);
});

test('the caps: a 61st event under way is refused; resolved ones make room oldest first; a 41st faction is refused', () => {
    let state = makeState();
    const block = Array.from({ length: MAX_EVENTS }, (_, i) => `+ world Event ${i + 1} — something`).join('\n');
    state = lines(state, block).state;
    const refused = line(state, '+ world One Too Many — more');
    assert.deepEqual([refused.ok, refused.code], [false, 'REFUSED']);
    assert.match(refused.message, /already follows 60 world events under way/);
    assert.equal(refused.state, state);
    // Two resolved: the new event goes in and the oldest resolved one leaves.
    state = line(state, '- world Event 5 — over').state;
    state = line(state, '- world Event 2 — over').state;
    const run = line(state, '+ world One More — more');
    assert.equal(run.ok, true, run.message);
    assert.deepEqual(run.result.data.pruned, ['Event 5']);
    assert.equal(Object.keys(run.state.domains.chronicle.events).length, MAX_EVENTS);
    assert.ok(eventNamed(run.state, 'Event 2'));

    let factions = makeState();
    factions = lines(factions, Array.from({ length: MAX_FACTIONS }, (_, i) => `+ faction Faction ${i + 1}`).join('\n')).state;
    const tooMany = line(factions, '+ faction Faction 41');
    assert.deepEqual([tooMany.ok, tooMany.code], [false, 'REFUSED']);
});

test('lines that name nothing, or use the wrong op, are refused with a sentence and save nothing', () => {
    const state = makeState();
    for (const [lineText, code, pattern] of [
        ['? world Dragon Calamity', 'INVALID', /world lines use \+, ~, ! or -/],
        ['? faction Ashen Court', 'INVALID', /faction lines use \+, ~ or -/],
        ["+ world ' — just marks", 'INVALID', /names no world event/],
        ["+ faction ’ — just marks", 'INVALID', /names no faction/],
    ]) {
        const run = line(state, lineText);
        assert.deepEqual([run.ok, run.code], [false, code], lineText);
        assert.match(run.message, pattern);
        assert.equal(run.state, state);
    }
});

test('chronicle.edit: the reader renames (old name kept), rewrites, resolves and reopens; empty fields keep', () => {
    let state = makeState({ minutes: DAY });
    state = lines(state, '+ world Border War — raids on the river | place: Harrow | factions: Ashen Court\n+ faction Ashen Court — nobles | area: north').state;
    const war = eventNamed(state, 'Border War');
    state = clockAt(state, 2 * DAY);
    let run = command(state, 'chronicle.edit', { id: war.id, name: "The King's War", summary: '', state: '', place: '', factions: '' });
    assert.equal(run.ok, true, run.message);
    assert.equal(run.result.summary, "The King's War: now called The King's War.");
    assert.equal(run.result.narrate, false);
    let event = run.state.domains.chronicle.events[war.id];
    assert.deepEqual([event.name, event.aka, event.place, event.updated], ["The King's War", ['Border War'], 'Harrow', DAY]);
    // The story's old name still finds it.
    run = line(run.state, '~ world Border War — the king marches');
    assert.equal(run.state.domains.chronicle.events[war.id].summary, 'the king marches');
    run = command(run.state, 'chronicle.edit', { id: war.id, state: 'resolved', place: 'none' });
    event = run.state.domains.chronicle.events[war.id];
    assert.deepEqual([event.state, event.place, event.updated], ['resolved', '', 2 * DAY]);
    run = command(run.state, 'chronicle.edit', { id: war.id, state: 'ongoing' });
    assert.equal(run.state.domains.chronicle.events[war.id].state, 'ongoing');

    const court = factionNamed(state, 'Ashen Court');
    run = command(state, 'chronicle.edit', { id: court.id, stance: 'allied', area: 'none', summary: '' });
    assert.deepEqual([factionNamed(run.state, 'Ashen Court').stance, factionNamed(run.state, 'Ashen Court').area], ['allied', '']);
    assert.equal(run.result.summary, 'Ashen Court: area, stance.');
    // The same values again change nothing and still succeed.
    const again = command(run.state, 'chronicle.edit', { id: court.id, stance: 'allied' });
    assert.deepEqual([again.ok, again.result.summary, again.result.data.changed], [true, '', false]);
});

test('chronicle.edit refusals: no id, unknown id, wrong fields, nothing to change, a bad state, a name taken', () => {
    let state = makeState();
    state = lines(state, '+ world Border War — raids\n+ world Red Plague — coughing\n+ faction Ashen Court').state;
    const war = eventNamed(state, 'Border War');
    const court = factionNamed(state, 'Ashen Court');
    for (const [payload, code, pattern] of [
        [{}, 'INVALID', /Say what to change/],
        [{ id: 'xx_00000000' }, 'INVALID', /not a world event or a faction/],
        [{ id: 'ev_zzzzzzzz', name: 'X' }, 'NOT_FOUND', /no world event ev_zzzzzzzz/],
        [{ id: war.id, stance: 'hostile' }, 'INVALID', /A world event has no stance to change/],
        [{ id: court.id, place: 'Harrow' }, 'INVALID', /A faction has no place to change/],
        [{ id: war.id, name: '', summary: '  ' }, 'INVALID', /Nothing to change/],
        [{ id: war.id, state: 'smouldering' }, 'INVALID', /not a state/],
        [{ id: war.id, summary: 5 }, 'INVALID', /summary must be text/],
        [{ id: war.id, name: 'red plague' }, 'REFUSED', /already a world event called Red Plague/],
    ]) {
        const run = command(state, 'chronicle.edit', payload);
        assert.deepEqual([run.ok, run.code], [false, code], JSON.stringify(payload));
        assert.match(run.message, pattern);
        assert.equal(run.state, state);
    }
});

test('chronicle.remove takes an event (and its seen mark) or a faction out; an unknown id is NOT_FOUND', () => {
    let state = makeState();
    state = lines(state, '+ world Border War — raids\n+ faction Ashen Court').state;
    const war = eventNamed(state, 'Border War');
    state = { ...state, domains: { ...state.domains, chronicle: { ...state.domains.chronicle, seen: { [war.id]: 1 }, round: 1 } } };
    let run = command(state, 'chronicle.remove', { id: war.id });
    assert.equal(run.result.summary, 'Border War is out of the chronicle.');
    assert.deepEqual([run.state.domains.chronicle.events, run.state.domains.chronicle.seen], [{}, {}]);
    run = command(run.state, 'chronicle.remove', { id: factionNamed(state, 'Ashen Court').id });
    assert.deepEqual(run.state.domains.chronicle.factions, {});
    const missing = command(run.state, 'chronicle.remove', { id: war.id });
    assert.deepEqual([missing.ok, missing.code], [false, 'NOT_FOUND']);
    assert.deepEqual([command(state, 'chronicle.remove', {}).code], ['INVALID']);
});

test('replay of every run\'s ops equals the state they built; a rejected run adds no ops', () => {
    const initial = makeState({ minutes: DAY });
    const block = [
        '+ world Dragon Calamity — awakens near Dragonfang | place: Dragonfang',
        '+ faction Ashen Court — nobles | area: north',
        '~ world Dragon Calamity | state: resolved — slain',
        '+ world Red Plague — coughing | state: looming',
        '- faction Ashen Court',
    ].join('\n');
    const { state, runs } = lines(initial, block);
    assert.deepEqual(replay(initial, runs), state);
    const edit = command(state, 'chronicle.edit', { id: eventNamed(state, 'Red Plague').id, state: 'ongoing' });
    assert.deepEqual(replay(initial, [...runs, edit]), edit.state);
    assert.deepEqual(part.domains.chronicle.initial(), initialChronicle());
});

test('a draft of another part\'s domain is refused: the chronicle writes only its own', () => {
    const state = makeState();
    const run = runCommand(state, ctx => { ctx.draft('director'); return {}; }, {});
    assert.deepEqual([run.ok, run.code], [false, 'NOT_OWNER']);
});
