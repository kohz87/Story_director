// The chat's calendar (the reader's, else the enabled pack's, else Gregorian) and the story clock
// set from a pack's start date before the first reply (`director.seed`, claim `clock:seed`).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { part } from '../../../src/v2/tracker/index.js';
import { SEED, seedCommand, seedHook } from '../../../src/v2/tracker/seed.js';
import { PACK_PRESET, SEED_CLAIM, calendarConfig, calendarOf, settingsDefaults, startMinutes } from '../../../src/v2/tracker/time.js';
import { makeState, reply, runCommand } from './helpers/fake-ctx.js';

const MONTHS = ['Dawnwane', 'Rainmoot', 'Greengale', 'Highsun', 'Goldwane', 'Haywane', 'Emberwane', 'Nightfall', 'Frostfall', 'Deepwinter', 'Icewane', 'Yearsend']
    .map(name => ({ name, days: 30 }));
const ERSVEIL = { pack: 'ersveil-bluewatch', era: 'CY', months: MONTHS, start: { year: 611, month: 'Goldwane', day: 12, hour: 6, minute: 40 } };
const packs = (calendar = ERSVEIL) => ({ 'packs.calendar': () => structuredClone(calendar) });
const OWN = { calendar: { preset: 'custom', era: '', months: ['Haywane | 30', 'Goldwane | 30'], week: [] } };
const minutes = state => state.domains.director.time.minutes;
const viewOf = (state, { settings = {}, queries = packs() } = {}) => ({
    state,
    settings: () => settings,
    query: (name, args) => {
        if (!queries[name]) throw new Error(`no query ${name}`);
        return queries[name](state, args);
    },
    chat: { length: 2, lastUser: '' },
});

test('the calendar: the pack\'s by default, Gregorian without one, the reader\'s own whatever the pack says', () => {
    assert.equal(settingsDefaults().calendar.preset, PACK_PRESET);
    const fromPack = calendarConfig(settingsDefaults(), ERSVEIL);
    assert.deepEqual([fromPack.preset, fromPack.era, fromPack.months.length, fromPack.leapYears], ['custom', 'CY', 12, false]);
    assert.equal(calendarConfig(settingsDefaults(), null).preset, 'gregorian');
    assert.equal(calendarConfig({}, ERSVEIL).era, 'CY', 'no calendar setting at all: the pack\'s');
    assert.deepEqual(calendarConfig(OWN, ERSVEIL).months.map(month => month.name), ['Haywane', 'Goldwane']);
    assert.equal(calendarConfig({ calendar: { ...settingsDefaults().calendar, preset: 'gregorian' } }, ERSVEIL).preset, 'gregorian');
    // A pack calendar without months is no calendar.
    assert.equal(calendarConfig(settingsDefaults(), { pack: 'x', months: [] }).preset, 'gregorian');
});

test('startMinutes: the pack\'s start on the chat\'s calendar, null when it is not a date there', () => {
    const calendar = calendarOf(settingsDefaults(), ERSVEIL);
    const at = startMinutes(calendar, ERSVEIL.start);
    assert.equal(calendar.format(at), 'CY 611, Goldwane 12, 06:40 am');
    assert.equal(startMinutes(calendar, { ...ERSVEIL.start, month: 'goldwane' }), at, 'month names in any case');
    assert.equal(startMinutes(calendarOf(OWN, ERSVEIL), ERSVEIL.start) % 1440, 6 * 60 + 40, 'the reader\'s calendar has a Goldwane too');
    for (const bad of [{ ...ERSVEIL.start, month: 'Smarch' }, { ...ERSVEIL.start, day: 31 }, { ...ERSVEIL.start, hour: 24 }, { ...ERSVEIL.start, year: 611.5 }, null]) {
        assert.equal(startMinutes(calendar, bad), null, JSON.stringify(bad));
    }
    assert.equal(startMinutes(calendarOf(settingsDefaults(), null), ERSVEIL.start), null, 'Gregorian has no Goldwane');
});

test('the hook asks for director.seed while the clock is unset and a pack gives a start; never twice', () => {
    const fresh = makeState();
    assert.deepEqual(seedHook(viewOf(fresh)), { lines: [], commands: [{ type: SEED, payload: {} }] });
    assert.equal(part.hooks.beforeGenerate, seedHook);
    assert.equal(seedHook(viewOf(fresh, { queries: {} })), undefined, 'no packs part');
    assert.equal(seedHook(viewOf(fresh, { queries: packs({ ...ERSVEIL, start: null }) })), undefined, 'a pack without a start');
    assert.equal(seedHook(viewOf(fresh, { settings: OWN, queries: packs({ ...ERSVEIL, start: { ...ERSVEIL.start, month: 'Rainmoot' } }) })), undefined, 'not a date on the reader\'s calendar');
    const set = reply(fresh, '~ time Goldwane 3, 611, 08:00 am', { queries: packs() }).state;
    assert.equal(seedHook(viewOf(set)), undefined, 'the story set the time');
    const claimed = { ...fresh, meta: { ...fresh.meta, claims: { [SEED_CLAIM]: true } } };
    assert.equal(seedHook(viewOf(claimed)), undefined);
});

test('director.seed sets the clock once, under its claim, without narrating', () => {
    const run = runCommand(makeState(), seedCommand, {}, { queries: packs() });
    assert.equal(run.ok, true, run.message);
    assert.equal(calendarOf(settingsDefaults(), ERSVEIL).format(minutes(run.state)), 'CY 611, Goldwane 12, 06:40 am');
    assert.equal(run.state.meta.claims[SEED_CLAIM], true);
    assert.equal(run.result.narrate, false);
    assert.equal(run.result.summary, 'Story time: CY 611, Goldwane 12, 06:40 am (the start of ersveil-bluewatch).');
    assert.deepEqual(run.result.data, { minutes: minutes(run.state), pack: 'ersveil-bluewatch' });
    // The story's own `! time` moves it from there on the pack's calendar.
    const later = reply(run.state, '! time +2h', { queries: packs() }).state;
    assert.equal(minutes(later), minutes(run.state) + 120);

    // Refusals change nothing.
    assert.equal(runCommand(run.state, seedCommand, {}, { queries: packs() }).code, 'REFUSED', 'already set');
    assert.equal(runCommand(makeState(), seedCommand, {}, {}).code, 'REFUSED', 'no pack');
    const claimed = { ...makeState(), meta: { rev: 0, claims: { [SEED_CLAIM]: true } } };
    const again = runCommand(claimed, seedCommand, {}, { queries: packs() });
    assert.equal(again.code, 'CLAIMED');
    assert.equal(minutes(again.state), null);
});

test('director.time writes the time on the chat\'s calendar; director.calendar gives it as data', () => {
    const run = runCommand(makeState(), seedCommand, {}, { queries: packs() });
    const tools = { query: name => (name === 'packs.calendar' ? ERSVEIL : null), settings: () => settingsDefaults() };
    assert.deepEqual(part.queries['director.time'](run.state, {}, tools), { minutes: minutes(run.state), text: 'CY 611, Goldwane 12, 06:40 am' });
    assert.equal(part.queries['director.calendar'](run.state, {}, tools).era, 'CY');
    assert.equal(part.queries['director.calendar'](run.state, {}, { ...tools, settings: () => OWN }).months.length, 2);
    assert.equal(part.queries['director.calendar'](run.state, {}, {}).preset, 'gregorian');
});
