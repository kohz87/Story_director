// (0.9.19) The Journal builder: only what the story told {{user}}'s character, grouped by
// story day, newest first; nothing planned, private or secret may leak into it.
import test from 'node:test';
import assert from 'node:assert/strict';

import { makeCalendar } from '../src/calendar.js';
import { parseChanges } from '../src/changes.js';
import { buildJournal } from '../src/journal.js';
import { buildPlaceBook } from '../src/places.js';
import { emptyTracker, questOutcome, replay } from '../src/tracker.js';

const cal = makeCalendar({ era: 'CY', months: [{ name: 'Haywane', days: 30 }, { name: 'Goldwane', days: 30 }], leapYears: false });
const at = (day, hour = 9) => cal.toAbs({ year: 611, month: 0, day, minutes: hour * 60 });

function ops(lines) {
    const parsed = parseChanges(lines.join('\n'));
    assert.deepEqual(parsed.errors, [], lines.join('\n'));
    return parsed.ops;
}

/**
 * Per-message trackers the way index.js caches them: `replies[message]` is
 * `{ lines, time, said }` (an assistant reply) or null (a message without change lines).
 */
function trackersOf(replies) {
    let tracker = emptyTracker();
    return replies.map((reply, message) => {
        const entry = { message, ops: reply ? ops(reply.lines ?? []) : null, time: reply?.time ?? null };
        if (reply && 'said' in reply) entry.said = reply.said;
        tracker = replay([entry], { seed: tracker }).tracker;
        return tracker;
    });
}

const all = journal => journal.days.flatMap(day => day.items);
const everything = journal => JSON.stringify(journal);

test('a fired beat is in the journal with what happened, never its plan', () => {
    const trackers = trackersOf([
        { time: at(12), lines: ['+ beat Ford ambush — bandits hired by the Baron wait at the ford | then: they fall back to the mill | on: Haywane 13 | encounter: 3 bandit'] },
        null,
        { time: at(13, 7), lines: ['! Ford ambush — bandits burst from the reeds at the ford'] },
    ]);
    const journal = buildJournal({ trackers, calendar: cal });
    const items = all(journal);
    assert.equal(items.length, 1);
    assert.deepEqual(
        { type: items[0].type, how: items[0].how, kind: items[0].kind, key: items[0].key, text: items[0].text, message: items[0].message, time: items[0].time },
        { type: 'event', how: 'fired', kind: 'beat', key: 'Ford ambush', text: 'bandits burst from the reeds at the ford', message: 2, time: at(13, 7) },
    );
    assert.equal(journal.days[0].label, 'CY 611, Haywane 13');
    const said = everything(journal);
    for (const leak of ['hired by the Baron', 'fall back to the mill', 'Haywane 13 |', '3 bandit']) assert.ok(!said.includes(leak), leak);
});

test('a `!` with only fields says nothing of them: then, on and now are plans', () => {
    const trackers = trackersOf([
        { time: at(12), lines: ['+ beat Bell tower — the bell is rung | then: the guard musters'] },
        { time: at(12, 18), lines: ['! Bell tower — then: the guard storms the docks | on: Haywane 14'] },
    ]);
    const [item] = all(buildJournal({ trackers, calendar: cal }));
    assert.equal(item.key, 'Bell tower');
    assert.equal(item.text, '');
    assert.ok(!everything(buildJournal({ trackers, calendar: cal })).includes('storms the docks'));
});

test('unfired beats, agendas, secrets and arcs never appear, whatever happens to them', () => {
    const trackers = trackersOf([
        { time: at(12), lines: [
            '+ arc The Drowned Crown — the Baron seizes the river',
            '+ beat Mill fire — the mill burns | on: Haywane 15',
            '+ beat Dropped beat — never needed',
            '+ agenda Courier Wessel — now: rides for Glassdock | then: sells the letter to the Baron | leg: Shorn → Glassdock',
            '+ secret Baron\'s debt — the Baron owes the guild 900 crowns',
        ] },
        { time: at(13), lines: [
            '! Courier Wessel — handed the letter over in the dark',
            '~ Courier Wessel — now: in Glassdock',
            '- Dropped beat — the road changed, no longer needed',
            '- Baron\'s debt — revealed to the guild',
        ] },
    ]);
    const journal = buildJournal({ trackers, calendar: cal });
    assert.equal(journal.count, 0);
    assert.deepEqual(journal.days, []);
    const said = everything(journal);
    for (const leak of ['Mill fire', 'Courier', 'Wessel', 'letter', 'Glassdock', 'Baron', 'Drowned Crown', 'Dropped beat']) assert.ok(!said.includes(leak), leak);
});

test('a beat closed after it fired keeps both; a clock only by firing', () => {
    const trackers = trackersOf([
        { time: at(12), lines: [
            '+ beat Siege of Shorn — the wall is breached',
            '+ clock Graves — washed graves → the dead rise | due: Haywane 20 | shown: sign',
            '+ clock Quiet clock — the levy → the tax riots | due: Haywane 25',
        ] },
        { time: at(14), lines: ['! Siege of Shorn — the east wall falls', '! Graves — the first of the dead climb out'] },
        { time: at(15), lines: ['- Siege of Shorn — the town surrenders', '- Quiet clock — dropped'] },
    ]);
    const items = all(buildJournal({ trackers, calendar: cal }));
    assert.deepEqual(items.map(item => [item.message, item.key, item.how, item.text]), [
        [2, 'Siege of Shorn', 'closed', 'the town surrenders'],
        [1, 'Siege of Shorn', 'fired', 'the east wall falls'],
        [1, 'Graves', 'fired', 'the first of the dead climb out'],
    ]);
    const said = JSON.stringify(items);
    assert.ok(!said.includes('Quiet clock'));
    assert.ok(!said.includes('the dead rise'), 'a clock\'s consequence is never quoted from its plan');
});

test('hooks and events: closed, fired, or a sign shown; superseded ones and their `+` stay out', () => {
    const trackers = trackersOf([
        { time: at(12), lines: [
            '+ hook River stranger — who pulled Ren from the sump | then: the stranger comes looking for Ren',
            '+ event Granary fires — the lower city burns | then: curfew is declared',
            '+ hook Old thread — something about the wells',
            '+ hook Smoke — signal fires on the ridge | shown: none',
        ] },
        { time: at(13), lines: ['! Granary fires — the night sky glows orange over the docks', '~ Smoke — shown: sign — three columns of smoke'] },
        { time: at(14), lines: ['- River stranger — the stranger was Ren\'s brother', '- Old thread — merged into River stranger'] },
    ]);
    const items = all(buildJournal({ trackers, calendar: cal }));
    assert.deepEqual(items.map(item => [item.message, item.key, item.how, item.text]), [
        [2, 'River stranger', 'closed', 'the stranger was Ren\'s brother'],
        [1, 'Granary fires', 'fired', 'the night sky glows orange over the docks'],
        [1, 'Smoke', 'sign', 'sign — three columns of smoke'],
    ]);
    const said = JSON.stringify(items);
    for (const leak of ['comes looking', 'curfew', 'Old thread', 'pulled Ren']) assert.ok(!said.includes(leak), leak);
});

test('quests: taken on (with goal and giver as they were), progress, done; failed and abandoned', () => {
    const trackers = trackersOf([
        { time: at(12), lines: [
            '+ quest Kettle Jack — type: bounty | giver: Warden Hale | goal: bring him in alive | reward: 40 crowns',
            '+ quest Herb run — giver: Mother Ilse | goal: twelve moonleaf',
            '+ quest Rat cellar — giver: Brannoc | goal: clear the cellar',
        ] },
        { time: at(13), lines: ['! Kettle Jack — cornered him at the weir', '~ Kettle Jack — goal: bring him in, alive or not'] },
        { time: at(14), lines: ['- Kettle Jack — turned in, paid 40 crowns', '- Herb run — failed, the moonleaf wilted', '- Rat cellar — abandoned'], said: 'I give up the Rat cellar job.' },
    ]);
    const items = all(buildJournal({ trackers, calendar: cal }));
    assert.deepEqual(items.map(item => [item.message, item.key, item.how, item.text]), [
        [2, 'Kettle Jack', 'done', 'turned in, paid 40 crowns'],
        [2, 'Herb run', 'failed', 'failed, the moonleaf wilted'],
        [2, 'Rat cellar', 'abandoned', 'abandoned'],
        [1, 'Kettle Jack', 'progress', 'cornered him at the weir'],
        [0, 'Kettle Jack', 'taken', 'bring him in alive'],
        [0, 'Herb run', 'taken', 'twelve moonleaf'],
        [0, 'Rat cellar', 'taken', 'clear the cellar'],
    ]);
    const taken = items.find(item => item.how === 'taken');
    assert.equal(taken.giver, 'Warden Hale');
    assert.ok(!Object.hasOwn(taken, 'reward'));
});

test('a job only offered is not in the journal; taken on, it starts on the day it was taken', () => {
    const trackers = trackersOf([
        { time: at(12), lines: ['+ hook Wolf Hunt — giver: Danique | reward: 4 silver | goal: kill the ridge wolves', '+ hook Mill job — giver: Brannoc | reward: 2 copper'], said: null },
        { time: at(13), lines: ['- Mill job — declined'], said: 'No thanks, I turn the mill job down.' },
        { time: at(15), lines: ['+ quest Wolf Hunt — giver: Danique | reward: 4 silver | goal: kill the ridge wolves'], said: 'Fine, I accept the Wolf Hunt.' },
    ]);
    const items = all(buildJournal({ trackers, calendar: cal }));
    assert.deepEqual(items.map(item => [item.message, item.key, item.how]), [[2, 'Wolf Hunt', 'taken']]);
    assert.equal(items[0].time, at(15));
    assert.ok(!JSON.stringify(items).includes('Mill job'));
    // Still on offer: nothing at all.
    assert.equal(buildJournal({ trackers: trackers.slice(0, 2), calendar: cal }).count, 0);
});

test('questOutcome reads a closed quest\'s reason', () => {
    const quest = reason => ({ kind: 'quest', status: 'resolved', resolved: { reason } });
    assert.equal(questOutcome(quest('turned in, paid')), 'done');
    assert.equal(questOutcome(quest('expired, too late')), 'failed');
    assert.equal(questOutcome(quest('gave up on it')), 'abandoned');
    assert.equal(questOutcome({ ...quest('merged'), status: 'superseded' }), null);
    assert.equal(questOutcome({ kind: 'hook', status: 'resolved', resolved: { reason: 'done' } }), null);
});

test('places on the day of their first visit; places only a world pack knows stay out', () => {
    const trackers = trackersOf([{ time: at(12), lines: [] }, { time: at(12, 15), lines: [] }, { time: at(14), lines: [] }, { time: at(14, 20), lines: [] }]);
    const book = buildPlaceBook([
        { message: 0, time: at(12), text: 'Shorn | Gate' },
        { message: 1, time: at(12, 15), text: 'Shorn | Market' },
        { message: 2, time: at(14), text: 'Heron Ford | Willow camp' },
        { message: 3, time: at(14, 20), text: 'Shorn | Gate' },
    ], { pack: { places: { Varnhold: { x: 1, y: 2 } } } });
    const journal = buildJournal({ trackers, places: book.places, calendar: cal });
    assert.deepEqual(journal.days.map(day => [day.label, day.items.map(item => [item.type, item.key])]), [
        ['CY 611, Haywane 14', [['place', 'Heron Ford']]],
        ['CY 611, Haywane 12', [['place', 'Shorn']]],
    ]);
    assert.ok(!everything(journal).includes('Varnhold'));
});

test('grouped by story day, newest first; within a reply places, then events, then quests; no time comes last', () => {
    const trackers = trackersOf([
        { lines: ['+ event Bells — the bells ring', '! Bells — every bell in Shorn rings at once'] },
        { time: at(12, 8), lines: ['+ quest Herb run — giver: Mother Ilse | goal: twelve moonleaf', '+ event Rain — a storm comes', '! Rain — the river rises over the ford'] },
        { time: at(12, 20), lines: ['! Herb run — found the first moonleaf'] },
        { time: at(13), lines: [] },
    ]);
    const places = [{ name: 'Shorn', visits: 1, firstMessage: 1, lastMessage: 3, firstTime: at(12, 8) }];
    const journal = buildJournal({ trackers, places, calendar: cal });
    assert.deepEqual(journal.days.map(day => [day.key === 'undated' ? 'undated' : day.label, day.items.map(item => `${item.type}:${item.key}:${item.how}`)]), [
        ['CY 611, Haywane 12', ['quest:Herb run:progress', 'place:Shorn:visited', 'event:Rain:fired', 'quest:Herb run:taken']],
        ['undated', ['event:Bells:fired']],
    ]);
    assert.equal(journal.days[1].label, 'Undated');
    assert.equal(journal.count, 5);
});

test('nothing in, an empty journal out; without a calendar every day is undated', () => {
    assert.deepEqual(buildJournal(), { days: [], count: 0 });
    assert.deepEqual(buildJournal({ trackers: [null, emptyTracker()] }), { days: [], count: 0 });
    const trackers = trackersOf([{ time: at(12), lines: ['+ beat Storm — a storm', '! Storm — lightning splits the oak'] }]);
    const journal = buildJournal({ trackers });
    assert.deepEqual(journal.days.map(day => day.key), ['undated']);
});
