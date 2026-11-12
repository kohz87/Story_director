// The cast's plain rules, without a host: reading the packs' entries, the routine, where the party is, the pace, who may be met, how the
// planner's answer is read (strictly), what a goal "touched by the story" means, and the state's shape.
import test from 'node:test';
import assert from 'node:assert/strict';

import { applyAdvance, applyJourney, applyMeet, applySync, planSync, syncEmpty, syncPayload, whyNarrator, whyText } from '../../../src/v2/cast/apply.js';
import { cutWords, initialCast, timeOfDay, validateCast } from '../../../src/v2/cast/domain.js';
import { atParty, castOf, fightOn, leanFight, readEntry, routineHolds, samePlace, shortName } from '../../../src/v2/cast/entries.js';
import { CAPS, castRequest, createPlans, readCast, touches } from '../../../src/v2/cast/plan.js';
import { atPlace, canBeHere, canReach, chanceCandidates, chooseMeetings, daysBetween, dueMove, linkOf, moveFits, moveReach, movable, paceOf, reachDays, roomLeft, sortComes } from '../../../src/v2/cast/world.js';
import { packWorld, worldOf } from '../../../src/v2/atlas/world.js';
import { travelTime } from '../../../src/v2/atlas/travel.js';
import { entry } from './helpers.js';

const castFor = (...entries) => castOf((name, args) => (name === 'packs.content' ? (args?.kind === 'cast' ? entries.map(item => structuredClone(item)) : []) : name === 'packs.list' ? [{ id: 'ersveil', name: 'Ersveil', version: '1.1.0', enabled: true }] : null));
const HOUR = 60;
const DAY = 1440;

test('entries: a listed entry is read cut to size; one without a pack, id or name is not one; a key once; the pack list names the packs', () => {
    const read = readEntry(entry('fenna', { name: `  Fenna ${'x'.repeat(200)}`, aliases: ['the ferrywoman', 'the ferrywoman', ' '], drawnTo: ['a', '', 'b'], canDieUnmet: true }));
    assert.deepEqual(readEntry(entry('fenna', { aliases: ['Fenna', 'the ferrywoman'] })).aliases, ['the ferrywoman'], 'her own name is no alias');
    assert.equal(read.key, 'ersveil:fenna');
    assert.equal(Array.from(read.name).length, 80);
    assert.deepEqual(read.aliases, ['the ferrywoman']);
    assert.deepEqual([read.drawnTo, read.canDieUnmet, read.ver, read.place], [['a', 'b'], true, '1.1.0', 'Harrow']);
    assert.equal(readEntry({ id: 'x', name: 'X' }), null);
    assert.equal(readEntry({ pack: 'p', id: 'bad id', name: 'X' }), null);
    assert.equal(readEntry({ pack: 'p', id: 'x', name: '   ' }), null);
    assert.equal(readEntry('Fenna'), null);
    const cast = castFor(entry('a'), entry('a', { name: 'Again' }), { nonsense: true }, entry('b'));
    assert.deepEqual(cast.entries.map(item => item.key), ['ersveil:a', 'ersveil:b']);
    assert.deepEqual([cast.listed, cast.packs.ersveil, [...cast.enabled]], [true, { name: 'Ersveil', version: '1.1.0' }, ['ersveil']]);
    // The packs could not be asked: not listed, and nothing may be inferred from the silence.
    assert.equal(castOf(() => { throw new Error('no packs'); }).listed, false);
    assert.equal(castOf(null).listed, false);
});

test('places: one holds the other (three letters at least); the party\'s place or region is the person\'s', () => {
    assert.ok(samePlace('Bluewatch docks', 'bluewatch docks'));
    assert.ok(samePlace('Bluewatch', 'Bluewatch docks, east quay'));
    assert.ok(!samePlace('Ye', 'Yew'));
    assert.ok(!samePlace('', 'Harrow'));
    assert.ok(!samePlace('Harrow', 'Kesh'));
    assert.ok(atParty('Harrow', { place: 'Harrow', region: '' }));
    assert.ok(atParty('Ersveil', { place: 'Harrow', region: 'Ersveil' }));
    assert.ok(!atParty('Kesh', { place: 'Harrow', region: 'Ersveil' }));
    assert.ok(!atParty('', { place: 'Harrow' }));
});

test('routine: a routine that names a time of day has someone at their place only then; one that names none holds at any hour; no clock, no objection', () => {
    const at = hour => hour * HOUR + 5 * DAY;
    assert.ok(routineHolds('works the night ferry', at(23)) && routineHolds('works the night ferry', at(2)) && routineHolds('works the night ferry', at(20)));
    assert.ok(!routineHolds('works the night ferry', at(12)) && !routineHolds('works the night ferry', at(8)));
    assert.ok(routineHolds('at the forge in the morning', at(9)) && !routineHolds('at the forge in the morning', at(15)));
    assert.ok(routineHolds('drinks at dusk, sleeps by day', at(18)) && routineHolds('drinks at dusk, sleeps by day', at(10)) && !routineHolds('drinks at dusk, sleeps by day', at(2)));
    assert.ok(routineHolds('keeps the books', at(3)) && routineHolds('', at(3)));
    assert.ok(routineHolds('works the night ferry', null), 'the clock is not set');
    assert.deepEqual([0, 6, 9, 12, 15, 19, 23].map(hour => timeOfDay(hour * HOUR)), ['night', 'dawn', 'morning', 'midday', 'afternoon', 'evening', 'night']);
    assert.equal(timeOfDay(null), '');
});

test('a fight: a session that has not ended; none, or an ended one, is no fight', () => {
    const fight = session => fightOn(name => (name === 'combat.session' ? session : null));
    assert.equal(fight({ status: 'active', round: 2 }), true);
    assert.equal(fight({ id: 'cb_1' }), true);
    assert.equal(fight({ status: 'ended' }), false);
    assert.equal(fight({ status: 'Victory' }), false);
    assert.equal(fight(null), false);
    assert.equal(fightOn(() => { throw new Error('no fights here'); }), false);
    assert.equal(fightOn(null), false);
});

test('when the cast moves: the day changes or six hours pass; a clock that went back only follows; not before the cast\'s day is started', () => {
    const slice = at => ({ ...initialCast(), day: at === null ? null : [{ at, rev: 1 }] });
    const noon = 10 * DAY + 12 * HOUR;
    assert.equal(dueMove(slice(null), noon), null);
    assert.equal(dueMove(slice(noon), null), null);
    assert.equal(dueMove(slice(noon), noon + 5 * HOUR), null, 'later the same day');
    assert.deepEqual(dueMove(slice(noon), noon + 6 * HOUR), { from: noon, to: noon + 6 * HOUR, reset: false }, 'six hours is a skip');
    assert.deepEqual(dueMove(slice(10 * DAY + 20 * HOUR), 11 * DAY + HOUR), { from: 10 * DAY + 20 * HOUR, to: 11 * DAY + HOUR, reset: false }, 'a new day');
    assert.deepEqual(dueMove(slice(noon), noon - 3 * DAY), { from: noon, to: noon - 3 * DAY, reset: true });
});

// ---- the world of a sync -----------------------------------------------------------------------------------------------------------

const SYNC_NOW = 7 * DAY;
function synced(entries, mutate = () => {}) {
    const cast = castFor(...entries);
    const slice = initialCast();
    const plan = planSync(slice, cast, { now: SYNC_NOW });
    applySync(slice, syncPayload(plan), { now: SYNC_NOW, rev: 1 });
    mutate(slice);
    return { slice, cast };
}

test('sync: new entries join at the current minute at their start; a second look finds nothing to do; an unchanged entry is no update', () => {
    const { slice, cast } = synced([entry('fenna', { start: { place: 'Bluewatch docks', goal: 'ferry', routine: 'works the night ferry' } }), entry('sera', { start: { place: 'Gwenmar', goal: 'x' } })]);
    assert.deepEqual(Object.keys(slice.people).sort(), ['ersveil:fenna', 'ersveil:sera']);
    assert.match(slice.people['ersveil:fenna'].sig, /^[0-9a-f]{12}$/, 'a fingerprint of what the entry says');
    assert.deepEqual({ ...slice.people['ersveil:fenna'], sig: undefined }, { sig: undefined, pack: 'ersveil', eid: 'fenna', name: 'Fenna', ver: '1.1.0', joined: SYNC_NOW, where: 'Bluewatch docks', doing: 'works the night ferry', since: SYNC_NOW, alive: true, met: null, heard: null, rev: 1 });
    assert.equal(slice.people['ersveil:sera'].doing, 'x', 'no routine: the goal');
    assert.deepEqual(slice.day, [{ at: SYNC_NOW, rev: 1, first: SYNC_NOW }], 'the first minute the cast knew is kept (for people with no since of their own)');
    assert.ok(syncEmpty(planSync(slice, cast, { now: SYNC_NOW })));
    assert.deepEqual(validateCast(slice), []);
});

test('sync: a changed unmet entry takes the new words and keeps where they are; a met one keeps the words it was met with and only its version moves (and settles: no step each reply)', () => {
    const { slice } = synced([entry('fenna'), entry('sera')], draft => {
        draft.people['ersveil:fenna'].where = 'Ashford';
        draft.people['ersveil:sera'].met = { on: 1, where: 'Harrow', why: 'place', reason: '', rev: 2 };
    });
    const next = castFor({ ...entry('fenna'), name: 'Fenna Marsh', aliases: ['the ferrywoman'], packVersion: '1.2.0' }, { ...entry('sera'), name: 'Sera of Kesh', packVersion: '1.2.0' });
    const plan = planSync(slice, next, { now: SYNC_NOW });
    assert.deepEqual(plan.update.map(item => item.key).sort(), ['ersveil:fenna', 'ersveil:sera']);
    applySync(slice, syncPayload(plan), { now: SYNC_NOW, rev: 3 });
    assert.deepEqual([slice.people['ersveil:fenna'].name, slice.people['ersveil:fenna'].aliases, slice.people['ersveil:fenna'].where, slice.people['ersveil:fenna'].ver], ['Fenna Marsh', ['the ferrywoman'], 'Ashford', '1.2.0']);
    assert.deepEqual([slice.people['ersveil:sera'].name, slice.people['ersveil:sera'].ver], ['Sera', '1.2.0']);
    assert.ok(syncEmpty(planSync(slice, next, { now: SYNC_NOW })), 'a met person\'s changed entry is not asked for again');
    assert.deepEqual(validateCast(slice), []);
});

test('sync: an entry that left takes an unmet person (only while its pack is enabled); a met person stays; the pack not asked about leaves everyone', () => {
    const { slice } = synced([entry('fenna'), entry('sera')], draft => { draft.people['ersveil:sera'].met = { on: 1, where: 'Harrow', why: 'place', reason: '', rev: 2 }; });
    const none = castOf(name => (name === 'packs.content' ? [] : name === 'packs.list' ? [{ id: 'ersveil', name: 'Ersveil', version: '1.1.0', enabled: true }] : null));
    assert.deepEqual(planSync(slice, none, { now: SYNC_NOW }).drop, ['ersveil:fenna']);
    const off = castOf(name => (name === 'packs.content' ? [] : name === 'packs.list' ? [{ id: 'ersveil', name: 'Ersveil', version: '1.1.0', enabled: false }] : null));
    assert.deepEqual(planSync(slice, off, { now: SYNC_NOW }).drop, [], 'a pack that is off keeps its people');
    assert.deepEqual(planSync(slice, castOf(() => { throw new Error('x'); }), { now: SYNC_NOW }).drop, [], 'silence drops no one');
});

test('sync: the people the world holds are capped; the pack update line counts new people only where the pack already had some', () => {
    const many = Array.from({ length: 70 }, (_, n) => entry(`p${n}`));
    const { slice } = synced(many);
    assert.equal(Object.keys(slice.people).length, 64);
    const fresh = synced([entry('a')]).slice;
    const more = castFor(entry('a', {}, { packVersion: '1.1.0' }), { ...entry('b'), packVersion: '1.2.0' });
    more.packs.ersveil.version = '1.2.0';
    assert.deepEqual(planSync(fresh, more, { now: SYNC_NOW }).updated, [{ pack: 'ersveil', n: 1, changed: 0, from: '1.1.0', to: '1.2.0' }]);
    assert.deepEqual(planSync(initialCast(), more, { now: SYNC_NOW }).updated, [], 'a pack seen for the first time is not an update');
});

test('advance: a move sets where and what; the dead and the unknown are passed over; a met person\'s news is kept; a death only for the unmet; the cast\'s minute moves', () => {
    const { slice } = synced([entry('fenna'), entry('sera'), entry('brom')], draft => {
        draft.people['ersveil:sera'].met = { on: 1, where: 'Harrow', why: 'place', reason: '', rev: 2 };
        draft.people['ersveil:brom'].alive = false;
    });
    const to = SYNC_NOW + DAY;
    const done = applyAdvance(slice, {
        from: SYNC_NOW, to, moves: [{ key: 'ersveil:fenna', where: 'Ashford', doing: 'at the guild' }, { key: 'ersveil:sera', where: 'Kesh', doing: 'at the fair' }, { key: 'ersveil:brom', where: 'Nowhere', doing: 'ghost' }, { key: 'ersveil:nobody', where: 'X', doing: 'y' }],
        died: [{ key: 'ersveil:sera' }, { key: 'ersveil:fenna' }],
    }, { rev: 4 });
    assert.deepEqual([done.moved, done.died], [2, 1]);
    assert.deepEqual([slice.people['ersveil:fenna'].where, slice.people['ersveil:fenna'].doing, slice.people['ersveil:fenna'].since, slice.people['ersveil:fenna'].alive], ['Ashford', '', to, false], 'moved, then died: nothing left to do');
    assert.deepEqual([slice.people['ersveil:sera'].alive, slice.people['ersveil:sera'].heard], [true, [{ on: to, text: 'at the fair' }]]);
    assert.equal(slice.people['ersveil:brom'].where, 'Harrow');
    assert.deepEqual(slice.day, [{ at: to, rev: 4, first: SYNC_NOW }]);
    assert.deepEqual(validateCast(slice), []);
});

test('meet: the first meeting sets met and the cue slot; a second is nothing; the reader\'s and the narrator\'s words for why', () => {
    const { slice } = synced([entry('fenna', { start: { place: 'Bluewatch docks', goal: 'g', routine: 'Works the night ferry.' } })]);
    const met = applyMeet(slice, { at: 6, who: [{ key: 'ersveil:fenna', why: 'place', reason: '' }, { key: 'ersveil:nobody', why: 'goal', reason: 'x' }] }, { now: SYNC_NOW, rev: 5 });
    assert.deepEqual(met, ['ersveil:fenna']);
    assert.deepEqual(slice.people['ersveil:fenna'].met, { on: SYNC_NOW, where: 'Bluewatch docks', why: 'place', reason: '', rev: 5 });
    assert.deepEqual(slice.meeting, [{ at: 6, keys: ['ersveil:fenna'], rev: 5, seen: 1 }]);
    assert.deepEqual(applyMeet(slice, { at: 7, who: [{ key: 'ersveil:fenna', why: 'place', reason: '' }] }, { now: SYNC_NOW, rev: 6 }), []);
    assert.deepEqual(slice.meeting[0].at, 6);
    const person = slice.people['ersveil:fenna'];
    assert.equal(whyText({ name: 'Fenna', why: 'place', reason: '', doing: person.doing, where: person.where }), 'Fenna works the night ferry at Bluewatch docks, and you are there: your first time here while they are. No roll.');
    assert.equal(whyText({ name: 'Sera', why: 'goal', reason: 'Her hunt led her to the weir.', doing: '', where: '' }), 'Her hunt led her to the weir. Their own goal pulls them to you, so they arrive; no roll.');
    assert.equal(whyNarrator(person), 'Works the night ferry, they are at Bluewatch docks, the place of this scene.');
    assert.equal(whyNarrator({ met: { why: 'goal', reason: 'her hunt led her to the weir.' } }), 'Her hunt led her to the weir. Their own goal brings them to {{user}}.');
    assert.deepEqual(validateCast(slice), []);
});

// ---- who crosses the party's path -------------------------------------------------------------------------------------------------

function crowd(specs, now) {
    const entries = specs.map(([id, place, routine, drawnTo = []]) => entry(id, { start: { place, goal: `${id} goal`, routine }, drawnTo }));
    const { slice, cast } = synced(entries);
    slice.day = [{ at: now, rev: 1 }];
    return { slice, cast };
}

test('who is met: by place and routine in the order they joined, goal arrivals first, at most one a reply, within the pace, never in a fight, never the present or the pinned', () => {
    const evening = 20 * DAY + 20 * HOUR;
    const { slice, cast } = crowd([['ana', 'Bluewatch docks', 'works the night ferry'], ['bo', 'Harrow', ''], ['cy', 'Harrow', 'at the forge in the morning'], ['di', 'Kesh', '', ['her brother\'s killer']]], evening);
    const party = { place: 'Harrow', region: '' };
    const pace = paceOf({});
    const pick = (more = {}) => chooseMeetings(slice, cast, { now: evening, party, pace, ...more }).map(item => `${item.key.split(':')[1]}:${item.why}`);
    assert.deepEqual(pick(), ['bo:place'], 'Cy\'s routine is the morning; Ana is at the docks; one a reply');
    assert.deepEqual(pick({ comes: [{ key: 'ersveil:di', reason: 'she heard' }] }), ['di:goal'], 'a goal arrival first, and the one a reply is used');
    assert.deepEqual(pick({ comes: [{ key: 'ersveil:ana', reason: 'x' }] }), ['bo:place'], 'no drawnTo, no goal arrival');
    assert.deepEqual(pick({ fight: true }), []);
    assert.deepEqual(pick({ present: new Set(['bo']) }), [], 'Bo is in the scene already; Cy is not due');
    assert.deepEqual(pick({ pinned: new Set(['bo']) }), []);
    assert.deepEqual(pick({ party: { place: 'Bluewatch docks', region: '' } }), ['ana:place'], 'the night ferry at night');
    assert.deepEqual(chooseMeetings(slice, cast, { now: 20 * DAY + 9 * HOUR, party, pace }).map(item => item.key), ['ersveil:bo']);
    assert.deepEqual(pick({ party: { place: '', region: '' } }), [], 'no place known');
    // Pace.
    slice.people['ersveil:ana'].met = { on: evening - HOUR, where: 'x', why: 'place', reason: '', rev: 2 };
    assert.deepEqual([roomLeft(slice, evening, paceOf({})), roomLeft(slice, evening, paceOf({ faces: 'day2' })), roomLeft(slice, evening + DAY, paceOf({})), roomLeft(slice, evening + 3 * DAY, paceOf({ faces: 'week1' })), roomLeft(slice, evening + 8 * DAY, paceOf({ faces: 'week1' }))], [0, 1, 1, 0, 1]);
    assert.deepEqual(pick(), [], 'one a day: the rest wait');
    // Someone who has moved on from their start has no routine to keep.
    delete slice.people['ersveil:ana'].met;
    slice.people['ersveil:ana'].met = null;
    slice.people['ersveil:cy'].where = 'Kesh road';
    assert.ok(movable(slice, cast).some(item => item.key === 'ersveil:cy'));
    assert.deepEqual(pick({ party: { place: 'Kesh road', region: '' } }), ['cy:place']);
});

test('movable: refs are the entry ids, the whole key where two packs share one; the stale first; the just-joined and the dead left out', () => {
    const a = entry('fenna');
    const b = entry('fenna', {}, { pack: 'other' });
    const cast = castFor(a, b);
    const slice = initialCast();
    applySync(slice, syncPayload(planSync(slice, cast, { now: 100 })), { now: 100, rev: 1 });
    slice.people['other:fenna'].since = 50;
    assert.deepEqual(movable(slice, cast).map(item => [item.key, item.ref]), [['other:fenna', 'other:fenna'], ['ersveil:fenna', 'ersveil:fenna']]);
    assert.deepEqual(movable(slice, cast, { to: 100 }).map(item => item.key), ['other:fenna'], 'joined at the minute asked about: nothing to move yet');
    slice.people['other:fenna'].alive = false;
    assert.deepEqual(movable(slice, cast).map(item => item.ref), ['fenna']);
});

// ---- the planner ---------------------------------------------------------------------------------------------------------------------

const refs = new Map([['fenna', 'ersveil:fenna'], ['sera', 'ersveil:sera'], ['brom', 'ersveil:brom']]);
const allow = { come: new Set(['ersveil:sera']), die: new Set(['ersveil:brom']) };

test('the answer is read strictly: three labels, only for people it named, each part cut and cleaned, each person once, in caps; anything else is ignored', () => {
    const text = [
        '<think>~ cast fenna | hidden | in the reasoning</think>',
        'Here is the plan:',
        '```',
        '- ~ cast fenna | Ashford | **took** the ferry <b>upriver</b> | and then some',
        '~ cast fenna | Elsewhere | a second line for the same person',
        '1. ~ Cast Sera | Bluewatch',
        '> cast sera | her hunt led her to the weir',
        '> cast fenna | she is not drawn to anyone',
        '! cast brom | fell from the quarry',
        '! cast sera | she may not die',
        '~ cast ghost | Nowhere | not in the cast',
        '~ cast | | ',
        'cast fenna | no label',
        '```',
    ].join('\n');
    assert.deepEqual(readCast(text, { refs, allow }), {
        moves: [{ key: 'ersveil:fenna', where: 'Ashford', doing: 'took the ferry upriver / and then some' }, { key: 'ersveil:sera', where: '', doing: 'Bluewatch' }],
        comes: [{ key: 'ersveil:sera', reason: 'her hunt led her to the weir.' }],
        died: [{ key: 'ersveil:brom', text: 'fell from the quarry' }],
    });
    assert.deepEqual(readCast('', { refs, allow }), { moves: [], comes: [], died: [] });
    assert.deepEqual(readCast(null, { refs, allow }), { moves: [], comes: [], died: [] });
    // The think block's close with no open (a model that reasons first): what follows it is read.
    assert.deepEqual(readCast('thinking out loud</think>\n~ cast fenna | Ashford | resting', { refs, allow }).moves, [{ key: 'ersveil:fenna', where: 'Ashford', doing: 'resting' }]);
    // Caps.
    const many = new Map(Array.from({ length: 30 }, (_, n) => [`p${n}`, `k:p${n}`]));
    const lines = Array.from({ length: 30 }, (_, n) => `~ cast p${n} | Somewhere | something`).join('\n');
    assert.equal(readCast(lines, { refs: many }).moves.length, CAPS.move);
    // No markup, no separators, no controls reach a part.
    const odd = readCast('~ cast fenna | A\u0000place <script>x</script> | line one​ — two', { refs });
    assert.doesNotMatch(JSON.stringify(odd), /<|>|\\u0000|​/);
});

test('the request: the cast with goals and routines, the time passed, the places, the recent story; a goal that may be judged only for the unmet; the judge asks for > lines only', () => {
    const people = [
        { ref: 'fenna', name: 'Fenna', goal: 'keep the ferry running', routine: 'works the night ferry', where: 'Bluewatch docks', doing: 'ferrying', drawnTo: [], met: true, mayDie: false },
        { ref: 'sera', name: 'Sera', goal: 'find the killer', routine: '', where: 'Gwenmar', doing: '', drawnTo: ['the man at the weir'], met: false, mayDie: true },
    ];
    const batch = castRequest({ people, now: 'June 4, 1200', elapsed: '1 day', place: 'Harrow', places: ['Harrow', 'Kesh'], recent: 'Narrator: Morning.' });
    assert.match(batch.system, /^You run the off-screen cast of an ongoing story between \{\{user\}\} and \{\{char\}\}\./);
    assert.match(batch.prompt, /^Now: June 4, 1200 \(1 day since the cast last moved\)\n\{\{user\}\} is at: Harrow\nPlaces of this world: Harrow, Kesh\n/);
    assert.match(batch.prompt, /- fenna \| Fenna \| goal: keep the ferry running \| routine: works the night ferry \| now at: Bluewatch docks \| doing: ferrying \| has met them\n/);
    assert.match(batch.prompt, /- sera \| Sera \| goal: find the killer \| now at: Gwenmar \| drawn to: the man at the weir \| has not met them \| may die\n/);
    assert.match(batch.prompt, /~ cast ref \| place \| what they are doing now/);
    const judge = castRequest({ mode: 'judge', people: [people[1]] });
    assert.doesNotMatch(judge.prompt, /~ cast ref/);
    assert.match(judge.prompt, /> cast ref \| what in the story pulls them/);
    assert.match(castRequest({}).prompt, /The cast:\n\(none\)\n/);
});

test('a goal touched by the story: all the telling words of a short phrase, two thirds of a long one, whole words (a plural counts); nothing for a phrase of small words', () => {
    assert.ok(touches(['the man you fought at the weir'], 'You beat the man at the weir, the one you fought.'));
    assert.ok(touches(['whoever opened the weir'], 'Someone opened the weirs by night.'));
    assert.ok(!touches(['the man you fought at the weir'], 'You walk by the river.'));
    assert.ok(!touches(['the man you fought at the weir'], 'A weir, a river.'));
    assert.ok(!touches(['it is a to be'], 'it is a to be'), 'no telling word');
    assert.ok(!touches([], 'anything'));
    assert.ok(touches(['a', 'the stolen ledger'], 'The ledger was stolen.'));
});

test('plans in flight: a plan is asked for once per key, waited for a little, kept for a swipe; a failure is a status, not a throw', async () => {
    const plans = createPlans({ size: 2 });
    let calls = 0;
    const first = plans.start('a', async () => { calls += 1; return { ok: true }; });
    assert.equal(plans.start('a', async () => { calls += 1; return 'other'; }), first);
    assert.equal((await plans.settled('a', 50)).status, 'done');
    assert.equal(calls, 1);
    plans.start('bad', async () => { throw new Error('x'); });
    assert.equal((await plans.settled('bad', 50)).status, 'failed');
    plans.start('slow', () => new Promise(() => {}));
    assert.equal((await plans.settled('slow', 5)).status, 'pending', 'waited for the limit only');
    assert.equal(plans.peek('a'), null, 'the oldest is let go past the size');
    assert.equal(await plans.settled('never', 5), null);
});

test('the state\'s validator: a person, a note, the slots and nothing else', () => {
    const good = synced([entry('fenna')]).slice;
    assert.deepEqual(validateCast(good), []);
    assert.deepEqual(validateCast(initialCast()), []);
    const broken = structuredClone(good);
    broken.people['ersveil:fenna'].eid = 'sera';
    broken.people['ersveil:fenna'].met = { on: 1 };
    broken.notes.cn_00000001 = { at: -1, kind: 'x' };
    broken.day = [{ at: 'soon' }];
    broken.extra = 1;
    const errors = validateCast(broken);
    assert.ok(errors.length >= 4 && errors.length <= 10);
    assert.ok(validateCast(null).length === 1 && validateCast({ people: [], notes: {} }).length === 1);
});

test('a long routine is not quoted in the card\'s or the narrator\'s words for why', () => {
    const doing = 'Dawn to noon at the inspection quay; afternoons in the Watchhouse infirmary corner; after dusk at the Stray Oar.';
    assert.equal(whyText({ name: 'Tansy', why: 'place', reason: '', doing, where: 'Bluewatch Village' }), 'Tansy is at Bluewatch Village, and you are there: your first time here while they are. No roll.');
    assert.equal(whyNarrator({ doing, met: { why: 'place', where: 'Bluewatch Village', reason: '' } }), 'They are at Bluewatch Village, the place of this scene.');
});

test('places: the pack\'s places match by name, slug or alias in any case; with no places listed a start place stays as written', async () => {
    const { placeMatcher } = await import('../../../src/v2/cast/entries.js');
    const list = [{ id: 'pack.ersveil/bluewatch-village', name: 'Bluewatch Village', aliases: ['The Watch Town'] }, { id: 'pack.ersveil/guild-office', name: 'Bluewatch Village / Guild Office' }, { nope: true }, 'x'];
    const matcher = placeMatcher(name => (name === 'packs.content' ? list : null));
    assert.equal(matcher.any, true);
    assert.deepEqual(['bluewatch village', 'BLUEWATCH-VILLAGE', 'the watch town', 'Bluewatch Village/Guild Office', 'guild-office', 'Nowhere', ''].map(matcher.match), ['Bluewatch Village', 'Bluewatch Village', 'Bluewatch Village', 'Bluewatch Village / Guild Office', 'Bluewatch Village / Guild Office', null, null]);
    assert.equal(placeMatcher(() => { throw new Error('no packs'); }).any, false);
    const cast = castOf((name, args) => (name === 'packs.content' ? (args?.kind === 'cast' ? [entry('a', { start: { place: 'Anywhere', goal: 'g', routine: '' } })] : []) : null));
    assert.equal(cast.entries[0].place, 'Anywhere', 'nothing to check against: as written');
});

test('the pack label drops a trailing parenthetical, as NPC State Delta writes it', () => {
    assert.deepEqual(['Ersveil (open world)', 'Ersveil', 'Ersveil (a) (open world)', '(Only)', ' Pack  (x) '].map(shortName), ['Ersveil', 'Ersveil', 'Ersveil (a)', '(Only)', 'Pack']);
    const cast = castOf((name, args) => (name === 'packs.content' ? (args?.kind === 'cast' ? [entry('a')] : []) : name === 'packs.list' ? [{ id: 'ersveil', name: 'Ersveil (open world)', version: '2.2.1', enabled: true }] : null));
    assert.equal(cast.packs.ersveil.name, 'Ersveil');
});

test('a Lean RPG fight: a Foes block with a named foe whose count is above 0 and whose health is above 0; nothing else is one', () => {
    const state = (fields, role = 'foes') => ({ domains: { dataModules: { active: { 'pack.chat/foes': { hash: 'h' } }, pins: { h: { definition: { role } } }, instances: { 'pack.chat/foes': { chat: { fields } } } } } });
    assert.equal(leanFight(state({ foe1: 'Drake', count1: 1, hurt1: 5 })), true);
    assert.equal(leanFight(state({ foe1: '', count1: 2, hurt1: 5, foe3: 'Rat', count3: 0, hurt3: 5 })), false);
    assert.equal(leanFight(state({ foe4: 'Rat', count4: 2, hurt4: 1 })), true);
    assert.equal(leanFight(state({ foe1: 'Drake', count1: 1, hurt1: 5 }, 'character')), false, 'only a Foes block');
    assert.equal(leanFight({ domains: {} }), false);
    assert.equal(leanFight(null), false);
    assert.equal(fightOn(() => null, state({ foe1: 'Drake', count1: 1, hurt1: 5 })), true);
    assert.equal(fightOn(() => null, state({ foe1: 'Drake', count1: 1, hurt1: 5 }), { leanOn: false }), false);
});

test('a won Lean RPG fight is no fight: a filled slot at health 0 (Down) is beaten, as Story Block reads it; any health above 0 is live', () => {
    const state = fields => ({ domains: { dataModules: { active: { 'pack.chat/foes': { hash: 'h' } }, pins: { h: { definition: { role: 'foes' } } }, instances: { 'pack.chat/foes': { chat: { fields } } } } } });
    // Classic: hurt is a stage index (0 = Down … 5 = Unhurt); Standard: the blocks left (0 = Down).
    assert.equal(leanFight(state({ foe1: 'Gnashers', count1: 12, hurt1: 0 })), false, 'Down: a won fight');
    assert.equal(leanFight(state({ foe1: 'Gnashers', count1: 12 })), false, 'no health field reads 0, as Story Block does');
    assert.equal(leanFight(state({ foe1: 'Gnashers', count1: 12, hurt1: '0' })), false, 'not a whole number: 0');
    for (const hurt of [1, 3, 5, 6, 8]) assert.equal(leanFight(state({ foe1: 'Boar', count1: 1, hurt1: hurt })), true, `health ${hurt}`);
    assert.equal(leanFight(state({ foe1: 'Gnashers', count1: 12, hurt1: 0, foe2: 'Rat', count2: 3, hurt2: 0, foe3: 'Mantid', count3: 1, hurt3: 0 })), false, 'every filled slot Down');
    assert.equal(leanFight(state({ foe1: 'Gnashers', count1: 12, hurt1: 0, foe2: 'Rat', count2: 3, hurt2: 2 })), true, 'one live slot among Down ones');
    assert.equal(leanFight(state({ foe1: 'Rat', count1: 0, hurt1: 4 })), false, 'no count: an empty slot');
    assert.equal(leanFight(state({ foe1: '  ', count1: 2, hurt1: 4 })), false, 'no name: an empty slot');
});

test('a pack update: a version bump alone is no change; an edited entry is, and counts once; a person kept before fingerprints existed has it noted silently', () => {
    const { slice } = synced([entry('fenna'), entry('sera'), entry('brom')]);
    const same = castFor({ ...entry('fenna'), packVersion: '1.2.0' }, { ...entry('sera'), packVersion: '1.2.0' }, { ...entry('brom'), packVersion: '1.2.0' }, { ...entry('tam'), packVersion: '1.2.0' });
    const bumped = planSync(slice, same, { now: SYNC_NOW });
    assert.deepEqual(bumped.update.map(item => item.key).sort(), ['ersveil:brom', 'ersveil:fenna', 'ersveil:sera'], 'the version moves on');
    assert.deepEqual([...bumped.changed], [], 'but nothing was edited');
    assert.deepEqual(bumped.updated.map(item => [item.n, item.changed]), [[1, 0]]);
    const edited = castFor({ ...entry('fenna'), look: 'new look', packVersion: '1.2.0' }, { ...entry('sera'), packVersion: '1.2.0' }, { ...entry('brom'), packVersion: '1.2.0' }, { ...entry('tam'), packVersion: '1.2.0' });
    const plan = planSync(slice, edited, { now: SYNC_NOW });
    assert.deepEqual([...plan.changed], ['ersveil:fenna']);
    assert.deepEqual(plan.updated.map(item => [item.n, item.changed]), [[1, 1]]);
    // Applied, it settles: a second look finds nothing to do.
    applySync(slice, syncPayload(plan), { now: SYNC_NOW, rev: 3 });
    assert.ok(syncEmpty(planSync(slice, edited, { now: SYNC_NOW })), 'nothing left to do');
    // Kept before fingerprints existed: noted, never counted as an edit.
    delete slice.people['ersveil:sera'].sig;
    const old = planSync(slice, edited, { now: SYNC_NOW });
    assert.ok(old.update.some(item => item.key === 'ersveil:sera' && item.sig));
    assert.ok(!old.changed.has('ersveil:sera'));
});

test('"doing" is cut at a word, not in the middle of one', () => {
    const routine = 'Dawn to noon at the inspection quay; afternoons in the Watchhouse infirmary corner; after dusk at the Stray Oar, then the night ferry on the Branch.';
    const cut = cutWords(routine, 120);
    assert.ok(Array.from(cut).length <= 120 && cut.endsWith('…'));
    assert.match(cut, /^Dawn to noon at the inspection quay; afternoons in the Watchhouse infirmary corner; after dusk at the Stray Oar, then…$/);
    assert.equal(cutWords('short', 120), 'short');
    assert.equal(cutWords('x'.repeat(30), 10), `${'x'.repeat(9)}…`, 'a long word with no space is cut where it is');
    const { slice } = synced([entry('tansy', { start: { place: 'Bluewatch Village', goal: 'g', routine } })]);
    assert.doesNotMatch(slice.people['ersveil:tansy'].doing, /\bthen t…$/);
    assert.ok(slice.people['ersveil:tansy'].doing.endsWith('Stray Oar, then…'));
});

// ---- distance and a real link: the export's Rika (Auvoth -> Bluewatch at reply 4), Ysmeth, a neighbour ------------------------------------

const MAP = {
    places: [{ name: 'Auvoth', region: 'North', kind: 'city', x: 0, y: 0 }, { name: 'Bluewatch Village', region: 'North', kind: 'town', x: 50, y: 0 }, { name: 'Shackles City', region: 'South', kind: 'city' }],
    routes: [{ from: 'Auvoth', to: 'Bluewatch Village', km: 400, kind: 'river' }],
};
const mapWorld = worldOf({ places: {}, routes: {}, keys: {}, focus: null }, packWorld((name, { kind } = {}) => (name === 'packs.content' ? structuredClone(MAP[kind] ?? []) : undefined)));
// The atlas's trip in days (Shackles City has no route: unknown).
const travel = (from, to) => travelTime(mapWorld, from, to)?.days ?? null;
const BLUEWATCH = { place: 'Bluewatch Village / Guild Office', region: '' };
const START = 316931440;

function farWorld() {
    const entries = [
        entry('rika', { start: { place: 'Auvoth / Pale Market', goal: 'A Guild licence and a crew.', routine: '' }, drawnTo: ['Master Albrecht Somner', 'Church Inquest agents'] }),
        entry('ysmeth', { start: { place: 'Shackles City / Chainmarket', goal: 'Pay off the debt the Ledger holds her on.', routine: '' }, drawnTo: ['the Broken Chain', 'the River Council'] }),
        entry('temiwa', { start: { place: 'Bluewatch Village', goal: 'tend the dying', routine: '' }, drawnTo: ['the Ashen Veil'] }),
    ];
    const cast = castFor(...entries);
    const slice = initialCast();
    applySync(slice, syncPayload(planSync(slice, cast, { now: START })), { now: START, rev: 1 });
    for (const person of Object.values(slice.people)) person.since = START;
    return { slice, cast };
}
const named = giver => ({ threads: [{ key: 'Errand', fields: { giver } }], items: [] });
const keysOf = list => list.map(item => item.key.split(':')[1]);

test('reach: the same area is no distance; a route needs the story time since they were placed; no route is far', () => {
    const { slice } = farWorld();
    const rika = slice.people['ersveil:rika'];
    const days = daysBetween(rika.where, BLUEWATCH, travel);
    assert.ok(days > 10, `Auvoth to Bluewatch is a long trip (${days} days)`);
    assert.equal(daysBetween('Bluewatch Village', BLUEWATCH, travel), 0);
    assert.equal(daysBetween('Shackles City / Chainmarket', BLUEWATCH, travel), null, 'no route: unknown');
    assert.equal(canBeHere(rika, BLUEWATCH, { now: START, travel }), false, 'reply 4: nothing has passed');
    assert.equal(canBeHere(rika, BLUEWATCH, { now: START + Math.ceil(days * DAY) - 1, travel }), false);
    assert.equal(canBeHere(rika, BLUEWATCH, { now: START + Math.ceil(days * DAY), travel }), true, 'enough time has passed');
    assert.equal(canBeHere({ where: 'Shackles City', since: START }, BLUEWATCH, { now: START + 400 * DAY, travel }), false, 'unknown distance is far however long');
});

test('chance meeting: only people who can be here (the export: Rika at reply 4 is not chanced upon; a neighbour is; time lets her)', () => {
    const { slice, cast } = farWorld();
    const at = now => keysOf(chanceCandidates(slice, cast, { party: BLUEWATCH, now, travel }));
    assert.deepEqual(at(START), ['temiwa'], 'the neighbour only');
    assert.equal(chanceCandidates(slice, cast, { party: BLUEWATCH, now: START, travel })[0].here, true);
    assert.deepEqual(at(START + 30 * DAY), ['rika', 'temiwa'], 'thirty days later Rika can be here; Ysmeth (no route) never');
    assert.deepEqual(keysOf(chanceCandidates(slice, cast, { party: BLUEWATCH, now: START + 30 * DAY, travel, pace: { count: 0, days: 1 } })), [], 'the pace is full');
});

test('a goal: a real link (the place, a thread naming them or what they follow, something carried) and never a shared word; far means a journey, near a meeting', () => {
    const { slice, cast } = farWorld();
    const item = key => movable(slice, cast).find(entryItem => entryItem.key === key);
    assert.equal(linkOf(item('ersveil:ysmeth'), BLUEWATCH, { threads: [{ key: 'The Grey Ledger audit', fields: { giver: 'Grey Ledger clerk', people: 'Ledger men' } }], items: ['Ledger of debts'] }), '', 'the owner\'s Ysmeth: "Ledger" in her goal and in the story is no link');
    assert.equal(linkOf(item('ersveil:rika'), BLUEWATCH, { threads: [{ key: 'Guild contract', fields: { giver: 'Guild Office' } }], items: [] }), '', 'a bare "Guild" is none either');
    assert.equal(linkOf(item('ersveil:rika'), BLUEWATCH, named('Rika')), 'thread');
    assert.equal(linkOf(item('ersveil:ysmeth'), BLUEWATCH, named('the River Council')), 'thread', 'their faction as giver');
    assert.equal(linkOf(item('ersveil:ysmeth'), { place: 'The Broken Chain', region: '' }, {}), 'place', 'the place is their goal\'s');
    assert.equal(linkOf(item('ersveil:rika'), BLUEWATCH, { items: ['Church Inquest agents'] }), 'carried');
    const comes = key => [{ key, reason: 'it pulls her' }];
    const run = (key, links, now = START) => sortComes(slice, cast, { comes: comes(key), party: BLUEWATCH, now, travel, links });
    // The export's case: reply 4, Rika far, no meeting; a journey instead (landing after the real trip).
    const far = run('ersveil:rika', named('Rika'));
    assert.deepEqual([far.meet.length, far.start.length], [0, 1]);
    assert.equal(far.start[0].arrive, START + Math.ceil(daysBetween('Auvoth / Pale Market', BLUEWATCH, travel) * DAY));
    assert.deepEqual(run('ersveil:rika', named('Guild Office')), { meet: [], start: [], stop: [], land: [] }, 'no link: nothing, not even a journey');
    assert.deepEqual(run('ersveil:ysmeth', named('Ysmeth')), { meet: [], start: [], stop: [], land: [] }, 'Ysmeth: linked but no route: far, no time to give');
    assert.equal(run('ersveil:rika', named('Rika'), START + 30 * DAY).meet.length, 1, 'enough time: she arrives');
    assert.equal(sortComes(slice, cast, { comes: comes('ersveil:temiwa'), party: BLUEWATCH, now: START, travel, links: { items: ['the Ashen Veil'] } }).meet.length, 1, 'a neighbour still meets');
});

test('a journey: set out, landing after the trip at the place the party was, dropped when the link goes; the slot is valid', () => {
    const { slice, cast } = farWorld();
    const sorted = sortComes(slice, cast, { comes: [{ key: 'ersveil:rika', reason: 'her licence' }], party: BLUEWATCH, now: START, travel, links: named('Rika') });
    assert.deepEqual(applyJourney(slice, { start: sorted.start }, { now: START, rev: 2 }), { started: 1, stopped: 0, landed: 0 });
    assert.deepEqual(validateCast(slice), []);
    assert.equal(slice.people['ersveil:rika'].where, 'Auvoth / Pale Market', 'still where she was while on the road');
    const trip = slice.people['ersveil:rika'].coming[0];
    const again = sortComes(slice, cast, { comes: [], party: BLUEWATCH, now: trip.arrive - 1, travel, links: named('Rika') });
    assert.deepEqual([again.stop, again.land], [[], []], 'on the road');
    assert.deepEqual(sortComes(slice, cast, { comes: [], party: BLUEWATCH, now: trip.arrive - 1, travel, links: {} }).stop, ['ersveil:rika'], 'the reason went away: cancelled');
    const landed = sortComes(slice, cast, { comes: [], party: BLUEWATCH, now: trip.arrive, travel, links: named('Rika') });
    applyJourney(slice, { land: landed.land }, { now: trip.arrive, rev: 3 });
    assert.deepEqual([slice.people['ersveil:rika'].where, slice.people['ersveil:rika'].since, slice.people['ersveil:rika'].coming], [BLUEWATCH.place, trip.arrive, null]);
    assert.equal(atParty(slice.people['ersveil:rika'].where, BLUEWATCH), true, 'now she meets the party by place');
    assert.deepEqual(validateCast(slice), []);
});

test('planner moves: a trip that does not fit the time since they were placed is refused; no route is refused only onto the party\'s place', () => {
    const { slice } = farWorld();
    const rika = slice.people['ersveil:rika'];
    const fit = (where, to) => moveFits(rika, where, { party: BLUEWATCH, to, travel });
    assert.equal(fit('Bluewatch Village', START + DAY), false, 'an 18-day trip in a day');
    assert.equal(fit('Bluewatch Village', START + 40 * DAY), true);
    assert.equal(fit('Marsh Road', START + DAY), true, 'no route, not the party\'s place');
    assert.equal(fit('Bluewatch Village / Guild Office', START + DAY), false);
    assert.equal(moveFits({ where: '' }, 'Bluewatch Village', { party: BLUEWATCH, to: START, travel }), true, 'unplaced');
});

// ---- reach, rule 2: run5cast reply 14 (Director 2.15.1): Rika chanced upon in Drowned Bell taproom 1.2 days in; Torka met on the road ------

// The run's world at reply 14 as stored (night/run5cast/out/chat.jsonl up to message 27): Ersveil 2.9.6's places and road this needs, as the
// pack writes them, and the atlas's own places ("Drowned Bell taproom" the map placed itself: no road, no parent).
const ERSVEIL = {
    places: [
        { name: 'Bluewatch Village', region: 'River Confederacy: Bluewatch', kind: 'village', x: 64, y: 110 },
        { name: 'Bluewatch Village / Guild Office', region: 'River Confederacy: Bluewatch', kind: 'guild office', x: 64, y: 110 },
        { name: 'Auvoth', region: 'Auvoth Compact', kind: 'city', x: 59, y: 110 },
        { name: 'Auvoth / Pale Market', region: 'Auvoth Compact', kind: 'district', x: 59.4, y: 109.6 },
    ],
    routes: [{ from: 'Auvoth', to: 'Bluewatch Village', kind: 'frontier road', km: 70 }],
};
const RUN_ATLAS = {
    places: {
        pl_dmu7s0ab: { id: 'pl_dmu7s0ab', name: 'Bluewatch Village / Guild Office', region: 'River Confederacy: Bluewatch', kind: 'guild office', layer: '', discovered: true, rev: 10 },
        pl_55i67iir: { id: 'pl_55i67iir', name: 'The Drowned Bell', region: 'bluewatch', kind: 'tavern', layer: '', discovered: true, rev: 22, made: 'sw_f43e3206a119' },
        pl_c57qz36z: { id: 'pl_c57qz36z', name: 'Bluewatch Village', region: 'River Confederacy: Bluewatch', kind: 'settlement', layer: '', discovered: true, rev: 37 },
        pl_yo7o67fj: { id: 'pl_yo7o67fj', name: 'Adventurers\' Guild back room', region: 'bluewatch', kind: 'settlement', layer: '', discovered: true, rev: 53, x: 64.266, y: 109.576, auto: true },
        pl_yz6zp4i3: { id: 'pl_yz6zp4i3', name: 'Wharf smithy', region: 'bluewatch', kind: 'settlement', layer: '', discovered: true, rev: 124, x: 63.972, y: 109.516, auto: true },
        pl_llyj22ck: { id: 'pl_llyj22ck', name: 'Drowned Bell taproom', region: 'bluewatch', kind: 'settlement', layer: '', discovered: true, rev: 140, x: 63.759, y: 109.371, auto: true },
    },
    keys: { 'bluewatch village / guild office': 'pl_dmu7s0ab', 'the drowned bell': 'pl_55i67iir', 'bluewatch village': 'pl_c57qz36z', 'adventurers guild back room': 'pl_yo7o67fj', 'wharf smithy': 'pl_yz6zp4i3', 'drowned bell taproom': 'pl_llyj22ck' },
    placeRefs: { pl_dmu7s0ab: 'pack.ersveil/bluewatch-village-guild-office', pl_55i67iir: 'pl_55i67iir', pl_c57qz36z: 'pack.ersveil/bluewatch-village', pl_yo7o67fj: 'pl_yo7o67fj', pl_yz6zp4i3: 'pl_yz6zp4i3', pl_llyj22ck: 'pl_llyj22ck' },
    routes: {}, tripRest: true, focus: null,
};
const runWorld = worldOf(structuredClone(RUN_ATLAS), packWorld((name, { kind } = {}) => (name === 'packs.content' ? structuredClone(ERSVEIL[kind] ?? []) : undefined)));
const runTrip = (from, to) => travelTime(runWorld, from, to);
// What rule 1 read (entries.js travelOf: the atlas's days, whatever their source) and what rule 2 reads (roadsOf: road trips only).
const anyTrip = (from, to) => runTrip(from, to)?.days ?? null;
const roadTrip = (from, to) => (runTrip(from, to)?.source === 'routes' ? runTrip(from, to).days : null);
// Reply 14: the clock 1730 minutes after the first reply, the party in the taproom (atlas.here: the place, region "bluewatch", no town).
const REPLY14 = 316933170;
const TAPROOM = { place: 'Drowned Bell taproom', region: 'bluewatch', town: '' };
const GUILD = { place: 'Bluewatch Village / Guild Office', region: 'River Confederacy: Bluewatch', town: 'Bluewatch Village' };

function runCast() {
    const cast = castFor(
        entry('rika', { start: { place: 'Auvoth / Pale Market', goal: 'A Guild licence and a crew.', routine: '' }, drawnTo: ['Master Albrecht Somner'] }),
        entry('torka', { start: { place: 'Bluewatch Village', goal: 'a good fight', routine: '' }, drawnTo: ['a good fight'] }),
        entry('ysmeth', { start: { place: 'Shackles City / Chainmarket', goal: 'Pay off the debt.', routine: '' }, drawnTo: ['the Broken Chain'] }),
    );
    const slice = initialCast();
    applySync(slice, syncPayload(planSync(slice, cast, { now: START })), { now: START, rev: 1 });
    // As stored at reply 14: everyone placed at the first minute, the cast's day moved to the clock with the first minute kept.
    for (const person of Object.values(slice.people)) person.since = START;
    slice.day = [{ at: REPLY14, rev: 158, first: START }];
    return { slice, cast };
}

test('reach, rule 2: run5cast reply 14, Rika (Auvoth / Pale Market) is not chanced upon in Drowned Bell taproom 1730 minutes in; rule 1 took her by a straight-line estimate', () => {
    const { slice, cast } = runCast();
    const rika = slice.people['ersveil:rika'];
    // Why rule 1 passed: the taproom has no road and no town, so the atlas estimated the trip from map coordinates at one km a unit.
    const estimate = runTrip('Auvoth / Pale Market', 'Drowned Bell taproom');
    assert.equal(estimate.source, 'map');
    assert.ok(estimate.days * DAY <= REPLY14 - START, `half a day by the straight line (${estimate.days} days) fits the 1730 minutes`);
    assert.equal(canBeHere(rika, TAPROOM, { now: REPLY14, travel: anyTrip }), true, 'rule 1 (steps with reach: 1 replay as they were)');
    assert.ok(keysOf(chanceCandidates(slice, cast, { party: TAPROOM, now: REPLY14, travel: anyTrip })).includes('rika'), 'rule 1 would chance on her');
    // Rule 2: road trips only; the taproom has none, so she is far.
    assert.equal(reachDays(rika.where, TAPROOM, roadTrip), null);
    assert.equal(canReach(rika, TAPROOM, { now: REPLY14, travel: roadTrip }), false);
    for (const now of [REPLY14, START + 400 * DAY]) assert.deepEqual(keysOf(chanceCandidates(slice, cast, { party: TAPROOM, now, travel: roadTrip, strict: true })), [], 'nobody far is chanced upon, nor Torka (no road to the taproom, and it is not his village by name)');
    // The frontier road: 70 km, 3.5 days; at the guild office she can be there only once the road's time has passed since she was placed.
    const days = reachDays(rika.where, GUILD, roadTrip);
    assert.ok(days >= 3.5, `the road is at least 3.5 days (${days})`);
    assert.equal(canReach(rika, GUILD, { now: REPLY14, travel: roadTrip }), false, 'reply 14 at the guild office: still too soon');
    assert.equal(canReach(rika, GUILD, { now: START + Math.ceil(days * DAY) - 1, travel: roadTrip }), false);
    assert.equal(canReach(rika, GUILD, { now: START + Math.ceil(days * DAY), travel: roadTrip }), true);
    assert.deepEqual(keysOf(chanceCandidates(slice, cast, { party: GUILD, now: REPLY14, travel: roadTrip, strict: true })), ['torka'], 'Torka, in the village, can be');
    // A goal pull that is linked sets out instead, landing after the road's time.
    const sorted = sortComes(slice, cast, { comes: [{ key: 'ersveil:rika', reason: 'her licence' }], party: TAPROOM, now: REPLY14, travel: roadTrip, links: named('Rika') });
    assert.deepEqual([sorted.meet, sorted.start], [[], []], 'to the taproom no road says how long: no meeting, no journey');
    const toGuild = sortComes(slice, cast, { comes: [{ key: 'ersveil:rika', reason: 'her licence' }], party: GUILD, now: REPLY14, travel: roadTrip, links: named('Rika') });
    assert.deepEqual([toGuild.meet.length, toGuild.start.length], [0, 1]);
    assert.ok(toGuild.start[0].arrive >= REPLY14 + Math.ceil(days * DAY));
});

test('a place meeting needs the party at the place or its town, not in its region (run5cast reply 17: Torka met while the party was on the Old Rut-Line)', () => {
    const { slice, cast } = runCast();
    const ROAD = { place: 'Old Rut-Line', region: 'bluewatch', town: '' };
    const meet = party => keysOf(chooseMeetings(slice, cast, { now: START + 2 * DAY, party, pace: paceOf({}), travel: roadTrip }));
    assert.equal(atParty('Bluewatch Village', ROAD), true, 'rule 1 took the region for the place');
    assert.equal(atPlace('Bluewatch Village', ROAD), false);
    assert.deepEqual(meet(ROAD), [], 'on the road outside Bluewatch: not met');
    assert.deepEqual(meet(GUILD), ['torka'], 'in the village (its guild office)');
    assert.deepEqual(meet({ place: 'Bluewatch gatehouse', region: 'bluewatch', town: 'Bluewatch Village' }), ['torka'], 'a place the atlas has in the village');
    assert.deepEqual(meet({ place: 'Bluewatch Village', region: 'bluewatch', town: '' }), ['torka']);
    assert.equal(atPlace('Auvoth / Pale Market', { place: 'Auvoth outskirts', region: 'auvoth', town: '' }), true, 'the same town (run5cast reply 21: Rika met in Auvoth)');
    assert.equal(atPlace('Bluewatch Village / Guild Office', { place: 'Glassdock / Guild Office', region: '', town: '' }), false, 'a guild office of another town');
    assert.equal(canReach(slice.people['ersveil:torka'], ROAD, { now: START + 2 * DAY, travel: roadTrip }), false, 'and not chanced upon there (no road says how far)');
});

test('planner moves, rule 2: no hop through a place with no road beats the road from the last known place; a road move ends that', () => {
    const { slice } = runCast();
    const rika = slice.people['ersveil:rika'];
    const reach = to => ({ party: GUILD, to, travel: roadTrip });
    const LAST = { where: 'Auvoth / Pale Market', since: START };
    assert.equal(moveReach(rika, 'Bluewatch Village', reach(START + DAY)), null, 'the road is 3.5 days');
    assert.equal(moveReach(rika, 'Bluewatch Village / Market', reach(START + DAY)), null, 'the party\'s town by its road, too soon');
    assert.equal(moveReach(rika, 'the river road north', reach(START + 6 * HOUR)).from.where, 'Auvoth / Pale Market', 'no road: kept, with her last known place');
    assert.equal(moveReach(rika, 'Bluewatch Village / Guild Office', { ...reach(START + 6 * HOUR), travel: () => null }), null, 'no road at all: never onto the party\'s place');
    // The two hops the review found: an unknown road first, then the party's town 12 hours after leaving a 3.5-day trip.
    const first = moveReach(rika, 'the river road north', reach(START + 6 * HOUR));
    applyAdvance(slice, { from: START, to: START + 6 * HOUR, moves: [{ key: 'ersveil:rika', where: 'the river road north', doing: 'walks', from: first.from }] }, { rev: 2 });
    assert.deepEqual([rika.where, rika.since, rika.known], ['the river road north', START + 6 * HOUR, [LAST]]);
    assert.deepEqual(validateCast(slice), []);
    assert.equal(moveReach(rika, 'Bluewatch Village / Market', reach(START + 12 * HOUR)), null, 'from her last known place it is still 3.5 days');
    assert.deepEqual(moveReach(rika, 'Wharf smithy', reach(START + 12 * HOUR)), { from: LAST }, 'another place with no road keeps the same last known place');
    assert.equal(canReach(rika, GUILD, { now: START + 12 * HOUR, travel: roadTrip }), false, 'not chanced upon either');
    assert.equal(canReach(rika, GUILD, { now: START + 4 * DAY, travel: roadTrip }), true, 'once the road from Auvoth could be walked');
    assert.deepEqual(moveReach(rika, 'Bluewatch Village', reach(START + 4 * DAY)), {}, 'the road fits: no last known place to keep');
    applyAdvance(slice, { from: START + 6 * HOUR, to: START + 4 * DAY, moves: [{ key: 'ersveil:rika', where: 'Bluewatch Village', doing: 'arrives' }] }, { rev: 3 });
    assert.deepEqual([rika.where, rika.known], ['Bluewatch Village', null]);
    assert.deepEqual(validateCast(slice), []);
    // At a place with no road, a place meeting waits for the road from her last known place too.
    slice.people['ersveil:rika'].known = [LAST];
    slice.people['ersveil:rika'].where = 'Drowned Bell taproom';
    const cast = runCast().cast;
    assert.deepEqual(keysOf(chooseMeetings(slice, cast, { now: START + DAY, party: TAPROOM, pace: paceOf({}), travel: roadTrip })), [], 'there, but not by any road in a day');
});
