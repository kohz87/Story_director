// World part: the Journal (the World screen's second view, which took the Days screen's place), drawn by
// Story Block's template renderer (vendored in tests/vendor/story-block) with the real condition language:
// newest day first, each folded to its line and opening to its facts; the search box keeps the days that
// hold what was typed; an older day shows its line only; with no day yet, one plain sentence. The old Days
// id is a dialog of the Journal alone.

import test from 'node:test';
import assert from 'node:assert/strict';

import { DAYS_ID, WORLD_ID, daysScreen, knownDay, part, worldScreen } from '../../../src/v2/world/index.js';
import { backlogBlock } from '../../../src/v2/chronicle/backlog.js';
import { DIGEST_FEATURE } from '../../../src/v2/chronicle/days.js';
import { part as chronicle } from '../../../src/v2/chronicle/index.js';
import { validateScreen } from '../../vendor/story-block/src/v2/view/screens.js';
import { compileTemplate, renderTemplate } from '../../vendor/story-block/src/v2/view/template/index.js';
import { conditionEvaluator } from '../../vendor/story-block/src/v2/view/bind.js';
import { compile, evaluate } from '../../vendor/story-block/src/v2/events/index.js';
import { scopeCss } from '../../vendor/story-block/src/v2/view/css.js';
import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { fakeFightRunner } from '../integration/helpers/fake-fight-runner.js';
import { installFakeDom } from '../../ui-fake-dom.js';

const squash = text => String(text ?? '').replace(/\s+/g, ' ').trim();
const reply = (text, lines = []) => (lines.length ? `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);

async function threeDays() {
    let host = null;
    const module = createModule({ host: { settings: id => host?.sdk.settings(id) ?? null, substitute: text => host?.sdk.substitute(text) } });
    host = await createHost({ modules: [fakeFightRunner(), module], settings: { modules: { 'story-director': { 'chronicle.digestDays': 2 } } } });
    await host.send('Start.', reply('Harrow.', ['~ time June 3, 1200, 08:00 am', '~ place Harrow', '+ coin 40', '+ item Rope']));
    await host.send('Weir.', reply('The weir.', ['~ time June 4, 1200, 08:00 am', '~ place Old Weir', '+ world Red Plague — coughing in the docks']));
    await host.send('Fort.', reply('The fort.', ['~ time June 5, 1200, 08:00 am', '~ place Ridge Fort', '- coin 5']));
    await host.send('Rest.', reply('Rest.', ['~ time June 6, 1200, 08:00 am']));
    // June 5 is written before this reply.
    await host.send('On.', reply('On.'));
    const journal = host.sdk.query('director.journal');
    host.close();
    return journal;
}

function draw(journal, { screen = worldScreen } = {}) {
    const doc = installFakeDom();
    doc.head = doc.createElement('head');
    const el = doc.createElement('div');
    el.setAttribute('data-ss-screen', screen.id);
    doc.body.appendChild(el);
    const compiled = compileTemplate(screen.template);
    const warnings = [...compiled.warnings];
    const draft = { view: 'journal' };
    const scopeOf = () => ({ state: {}, q: { world: null, journal }, draft, settings: {}, mount: 'tab', screenId: screen.id, api: {} });
    const view = renderTemplate(el, compiled, scopeOf(), {
        evaluate: conditionEvaluator({ compile, evaluate }),
        widgets: {},
        onWarn: message => warnings.push(message),
    });
    return { el, view, warnings, find: text => { draft.find = text; view.update(scopeOf()); } };
}

test('the Days screen is gone from the tabs: its id is a dialog of the Journal; the World screen draws the Journal', () => {
    assert.ok(part.screens.includes(daysScreen) && part.screens.includes(worldScreen));
    assert.ok(!chronicle.screens.some(screen => screen.id === DAYS_ID));
    assert.equal(DAYS_ID, 'story-director/days');
    assert.equal(WORLD_ID, 'story-director/world');
    assert.equal(daysScreen.feature, DIGEST_FEATURE);
    assert.deepEqual([...daysScreen.mounts], ['dialog']);
    assert.deepEqual(validateScreen(daysScreen), []);
    for (const binding of Object.values(daysScreen.data)) assert.ok(Object.hasOwn(part.queries, binding.query));
    assert.deepEqual(scopeCss(daysScreen.css, DAYS_ID).warnings, []);
});

test('the old Days id draws the same Journal', async () => {
    const journal = await threeDays();
    const { el, warnings } = draw(journal, { screen: daysScreen });
    assert.deepEqual(warnings, []);
    assert.deepEqual(el.querySelectorAll('.wv-day').map(node => node.querySelector('.wv-date').textContent), ['June 5, 1200', 'June 4, 1200', 'June 3, 1200']);
});

test('drawn: newest day first, each folded to its line; an older day keeps its line only; no warnings', async () => {
    const journal = await threeDays();
    const { el, warnings } = draw(journal);
    assert.deepEqual(warnings, []);
    const days = el.querySelectorAll('.wv-day');
    assert.deepEqual(days.map(node => node.querySelector('.wv-date').textContent), ['June 5, 1200', 'June 4, 1200', 'June 3, 1200']);
    // The date once: beside the line, which leaves its own off (B-c1-3).
    assert.equal(squash(days[0].querySelector('.wv-line').textContent), 'Went to Ridge Fort, 5 gold out.');
    assert.equal(days[0].querySelector('details').hasAttribute('open'), false, 'folded');
    // Inside: the summary once, then the kinds with their counts (no separate Went to / Money block).
    assert.match(squash(days[0].textContent), /^June 5, 1200 yesterday · quiet day Went to Ridge Fort, 5 gold out\. Items & money 1 Money: 5 gold out$/);
    assert.doesNotMatch(squash(days[0].textContent), /Went to:|Finished:/);
    assert.match(squash(days[1].textContent), /News 1 ?World: Red Plague is now ongoing — coughing in the docks/);
    // June 3 is past the two whole days: its line only.
    assert.equal(days[2].getAttribute('data-brief'), 'true');
    assert.match(squash(days[2].textContent), /^June 3, 1200 3 days ago · quiet day Went to Harrow, 40 gold in\. Items & money 1 The party gains Rope\.$/);
    assert.equal(days[2].querySelectorAll('.wv-cat').length, 1, 'its kept list by kind: the one thing it held');
});

test('the search box keeps the days that hold what was typed, any case; empty shows them all', async () => {
    const { el, find } = draw(await threeDays());
    const shown = () => el.querySelectorAll('.wv-day').map(node => node.querySelector('.wv-date').textContent);
    find('plague');
    assert.deepEqual(shown(), ['June 4, 1200']);
    find('HARROW');
    assert.deepEqual(shown(), ['June 3, 1200']);
    find('june');
    assert.equal(shown().length, 3);
    find('nowhere at all');
    assert.deepEqual(shown(), []);
    find('');
    assert.equal(shown().length, 3);
});

test('no day yet: one plain sentence, no search box', () => {
    const { el, warnings } = draw({ on: true, days: [], hasDays: false, count: 0, today: '' });
    assert.deepEqual(warnings, []);
    assert.match(squash(el.textContent), /^Now Journal No story day is written yet\./);
    assert.equal(el.querySelectorAll('input[type="search"]').length, 0);
});

test('every World section label is drawn by the one label helper (.wv-label, where the separator is set)', () => {
    for (const screen of [worldScreen, daysScreen]) {
        const headings = [...screen.template.matchAll(/<h[45]\b[^>]*>/g)].map(match => match[0]);
        if (screen === worldScreen) assert.ok(headings.length > 0, `${screen.id} has section labels`);
        for (const heading of headings) assert.match(heading, /\bwv-label\b/, `${screen.id}: ${heading}`);
    }
});

// ---- Journal by kind (spec items 1 to 7) -------------------------------------------------------------------------------------

const HIDDEN = { words: [], behind: [] };
const NOW = 23 * 1440;
const threads = new Map([['th_a', { key: 'Perimeter Sweep', taken: { at: 16 * 1440 } }]]);
const format = minutes => `Goldwane ${Math.floor(minutes / 1440)}`;
const stored = (extra = {}) => ({
    day: 20, date: 'Goldwane 20', brief: false, count: 12, short: 'to Bluewatch; finished Perimeter Sweep.', more: 0, places: ['Bluewatch'],
    quests: { taken: [], done: ['Perimeter Sweep'], failed: [], dropped: [] }, fights: { count: 1, won: 1, lost: 0, fled: 0 }, money: { in: 0, out: 0 }, moneyText: '1100 copper in',
    npcs: ['Rika: trust wary → friendly'], world: ['World: Red Plague spreads.'], met: ['Sister Temiwa', 'Bregje'], facts: ['Went to: Bluewatch', 'Finished: Perimeter Sweep', 'Money: 1100 copper in'],
    happened: ['Sweep: the deadfall held.', 'Sweep: the basilisk bled out.', 'Fight won: Astra +60 XP.', 'Torka: affection 9 -> 10, desire 7 -> 8 (held at 7).', 'Torka: affection 10 -> 11.', 'Lost Ridge Boar Ears x36 (0 left).', 'Lost Hide x12 (3 left).',
        'Torka Bloodsong left the party. Their bound gear leaves with them: a.', 'Adventurer Guild membership: contract.', 'Marrit is not here.', 'Key people: noted'],
    tags: ['quest.step th_a', 'quest.step th_a', 'rpg.fight', 'capture.npc', 'capture.npc', 'capture.item', 'capture.item', 'capture.party', 'capture.dm', 'capture.present', 'npc.tick'],
    ...extra,
});
const kindOf = (day, id) => day.cats.find(cat => cat.id === id);

test('1/4: a day has its date, "3 days ago" and the event count; the summary once; the kinds with counts, only those that hold something, each line once', () => {
    const day = knownDay(stored(), HIDDEN, { now: NOW, threads, format });
    assert.equal(day.ago, '3 days ago');
    assert.equal(day.meta, '3 days ago · 2 events');
    assert.deepEqual(day.cats.map(cat => [cat.label, cat.count]), [['Met', 2], ['Relationships', 2], ['Events', 2], ['Party & gear', 1], ['Items & money', 2], ['Reputation', 1], ['News', 1]]);
    const all = day.cats.flatMap(cat => cat.items.map(row => [row.title, row.detail].filter(Boolean).join(' ')));
    assert.equal(new Set(all).size, all.length, 'no line twice');
    assert.equal(knownDay(stored({ today: true }), HIDDEN, { now: 20 * 1440 }).ago, 'today');
    assert.equal(knownDay(stored(), HIDDEN, { now: 21 * 1440, threads, format }).meta, 'yesterday · 2 events');
    assert.equal(knownDay(stored({ npcs: [], world: [], met: [], happened: [], tags: [], quests: { taken: [], done: [], failed: [], dropped: [] }, moneyText: '' }), HIDDEN, { now: NOW }).hasCats, false);
});

test('3: noise is out of the kinds (presence, "Key people: noted"); a day\'s "Lost X" lines are one line', () => {
    const day = knownDay(stored(), HIDDEN, { now: NOW, threads, format });
    assert.doesNotMatch(JSON.stringify(day.cats), /is not here|Key people/);
    assert.deepEqual(kindOf(day, 'items').items.map(row => row.detail), ['Money: 1100 copper in', 'Lost: Ridge Boar Ears x36, Hide x12']);
    // A lone loss stays as it was.
    assert.deepEqual(kindOf(knownDay(stored({ happened: ['Lost Hide x12 (3 left).'], tags: ['capture.item'], moneyText: '' }), HIDDEN), 'items').items.map(row => row.detail), ['Lost Hide x12 (3 left).']);
});

test('5: Events: one row per thread, its latest line; "N steps today"; "began <date>" on the finishing day; a board fight is an event row', () => {
    const day = knownDay(stored(), HIDDEN, { now: NOW, threads, format });
    const rows = kindOf(day, 'events').items;
    assert.deepEqual(rows[0], { title: 'Perimeter Sweep', chip: 'finished', detail: 'Sweep: the basilisk bled out.', note: '2 steps today · began Goldwane 16', since: 'began Goldwane 16', stepsLabel: '2 steps today', steps: ['Sweep: the deadfall held.', 'Sweep: the basilisk bled out.'], tags: [] });
    assert.ok(rows.some(row => row.detail === 'Fight won: Astra +60 XP.'));
    assert.equal(rows.length, 2, 'the two steps are one row, the fight another');
    // A quest taken today with one line: began, no steps note.
    const began = knownDay(stored({ quests: { taken: ['Perimeter Sweep'], done: [], failed: [], dropped: [] }, happened: ['Sweep: set out.'], tags: ['quest.step th_a'] }), HIDDEN, { threads, format });
    assert.deepEqual(kindOf(began, 'events').items.map(row => [row.title, row.chip, row.note]), [['Perimeter Sweep', 'began', '']]);
});

test('6: Relationships: per person, then the meter changes as small tags; a meter moved twice is one tag (first from, last to)', () => {
    const rows = kindOf(knownDay(stored(), HIDDEN, { now: NOW }), 'relationships').items;
    assert.deepEqual(rows.map(row => [row.title, row.tags]), [['Torka', ['affection 9 → 11', 'desire 7 → 8']], ['Rika', ['trust wary → friendly']]]);
});

test('2: an old stored day with no types is sorted by the known shapes, the rest under Events', () => {
    const day = knownDay(stored({ tags: undefined, npcs: [] }), HIDDEN, { now: NOW });
    assert.deepEqual(day.cats.map(cat => cat.id), ['met', 'relationships', 'events', 'party', 'items', 'reputation', 'news']);
    // No types and no thread ids: each line is its own row (unknown lines are Events); the quest the day finished still has its row.
    assert.deepEqual(kindOf(day, 'events').items.map(row => [row.title, row.detail]), [['', 'Sweep: the deadfall held.'], ['', 'Sweep: the basilisk bled out.'], ['', 'Fight won: Astra +60 XP.'], ['Perimeter Sweep', '']]);
});

test('7: search looks through every kind of every day, shows the day and "N days ago", and opens the matching kinds; a short day with its kept lists is found too', () => {
    const brief = knownDay({ day: 14, date: 'Goldwane 14', brief: true, count: 4, short: 'a quiet day.', cats: { met: ['Grey Ledger collectors'], events: ['The ledger was signed.'] }, happened: [], quests: undefined }, HIDDEN, { now: NOW });
    assert.deepEqual(brief.cats.map(cat => cat.id), ['met', 'events']);
    const journal = { on: true, days: [knownDay(stored(), HIDDEN, { now: NOW, threads, format }), brief], hasDays: true, count: 2, today: '' };
    const { el, find, warnings } = draw(journal);
    assert.deepEqual(warnings, []);
    assert.equal(el.querySelectorAll('.wv-day details.wv-cat').length, 9, 'no search: every kind is a fold');
    assert.equal(el.querySelectorAll('.wv-day details.wv-cat[open]').length, 0);
    find('ledger');
    const shown = el.querySelectorAll('.wv-day');
    assert.deepEqual(shown.map(node => node.querySelector('.wv-date').textContent), ['Goldwane 14']);
    assert.equal(squash(shown[0].querySelector('.wv-meta').textContent), '9 days ago');
    assert.deepEqual(shown[0].querySelectorAll('.wv-hit').map(node => node.getAttribute('data-kind')), ['met', 'events']);
    find('torka');
    assert.deepEqual(el.querySelectorAll('.wv-day .wv-hit').map(node => node.getAttribute('data-kind')), ['relationships', 'party'], 'only the kinds that hold it, open');
    assert.equal(el.querySelectorAll('.wv-day details').length, 0, 'a search shows the hits open, not folds');
});

// ---- fix round 1: hidden lines on short days, real receipts, layout ------------------------------------------------------------

const SECRET = { words: new Set(['duke betrayal']), behind: [] };
const shortDay = (cats, extra = {}) => ({ day: 14, date: 'Goldwane 14', brief: true, count: 6, short: 'to Harrow; 5 copper out.', happened: [], more: 0, quests: undefined, cats, ...extra });

test('F1/F9: a short day\'s own lists pass the same hidden filter as a whole day (every kind, the search, the backlog), and keep NPC moves and News', () => {
    const cats = {
        events: ['Astra learned of the Duke Betrayal from Mira.', 'New arc: The Salt War (3 beats).', 'Tell the settled fight results in order; do not reroll them.', 'The ledger was signed.'],
        party: ['Duke Betrayal gear bound.'], items: ['The party gains the Duke Betrayal letter.', 'The party gains Rope.'], reputation: ['Duke Betrayal: deed.'],
        met: ['Mira'], relationships: ['Mira: trust 2 -> 3', 'Duke Betrayal: trust 1 -> 2'], news: ['World: Red Plague is now ongoing.', 'World: the Duke Betrayal spreads.'],
    };
    const day = knownDay(shortDay(cats), SECRET, { now: NOW });
    const text = JSON.stringify(day.cats) + day.search;
    assert.doesNotMatch(text, /Duke Betrayal|Salt War|reroll/);
    assert.deepEqual(kindOf(day, 'events').items.map(row => row.detail), ['The ledger was signed.']);
    assert.deepEqual(kindOf(day, 'items').items.map(row => row.detail), ['The party gains Rope.']);
    assert.deepEqual(kindOf(day, 'news').items.map(row => row.detail), ['World: Red Plague is now ongoing.'], 'News of a short day stays');
    assert.deepEqual(kindOf(day, 'relationships').items.map(row => row.title), ['Mira']);
    assert.equal(kindOf(day, 'party'), undefined);
    // The narrator's [Earlier days] block reads the same filtered lines.
    const block = backlogBlock({ days: [{ ...day, day: 20 }], now: 22 * 1440 }).join('\n');
    assert.doesNotMatch(block, /Duke Betrayal|Salt War/);
    // Nothing is rewritten: with the word no longer hidden (a Reveal), the lines are back.
    assert.match(JSON.stringify(knownDay(shortDay(cats), HIDDEN, { now: NOW }).cats), /Duke Betrayal/);
});

test('F8: the collapsed Lost line sums the counts of one item', () => {
    const day = knownDay(stored({ happened: ['Lost Hide x12 (3 left).', 'Lost Hide x2 (1 left).', 'Lost Flint (0 left).', 'Lost Flint (0 left).'], tags: ['capture.item', 'capture.item', 'capture.item', 'capture.item'], moneyText: '' }), HIDDEN);
    assert.deepEqual(kindOf(day, 'items').items.map(row => row.detail), ['Lost: Hide x14, Flint x2']);
});

test('F3/render 2/7: one "today" tag (the pill), every other day tells its events ("quiet day" with none), the summary reads as a sentence', () => {
    assert.equal(knownDay(stored({ today: true }), HIDDEN, { now: 20 * 1440, threads, format }).meta, '2 events', 'the pill says today');
    assert.equal(knownDay(stored({ happened: [], tags: [], quests: { taken: [], done: [], failed: [], dropped: [] } }), HIDDEN, { now: NOW }).meta, '3 days ago · quiet day');
    const day = knownDay(stored({ short: 'to Bluewatch Village, Old Weir; finished Perimeter Sweep; 1100 copper in, 2 out; 1 world event.' }), HIDDEN, { now: NOW });
    assert.equal(day.summary, 'Went to Bluewatch Village, Old Weir, finished Perimeter Sweep, 1100 copper in, 2 out, 1 world event.');
    assert.equal(day.short, 'to Bluewatch Village, Old Weir; finished Perimeter Sweep; 1100 copper in, 2 out; 1 world event.', 'the stored line is as it was (the recap and the narrator read it)');
});

test('render 4/8: today\'s card is open and the others folded; an event\'s detail is its own line, its steps fold open', () => {
    const today = knownDay(stored({ today: true }), HIDDEN, { now: NOW, threads, format });
    const { el, warnings } = draw({ on: true, days: [today, knownDay(stored({ day: 19, date: 'Goldwane 19' }), HIDDEN, { now: NOW, threads, format })], hasDays: true, count: 2, today: '' });
    assert.deepEqual(warnings, []);
    const cards = el.querySelectorAll('.wv-day');
    assert.equal(cards[0].querySelector('details').hasAttribute('open'), true, 'today open');
    assert.equal(cards[1].querySelector('details').hasAttribute('open'), false);
    const row = cards[0].querySelector('details.wv-cat[data-kind="events"] .wv-item');
    assert.equal(squash(row.querySelector('.wv-t').textContent), 'Perimeter Sweep finished', 'the pill on the title line');
    assert.equal(squash(row.querySelector('.wv-d').textContent), 'Sweep: the basilisk bled out.', 'the detail on its own line');
    assert.equal(squash(row.querySelector('.wv-steps summary').textContent), '2 steps today');
    assert.deepEqual(row.querySelectorAll('.wv-steps li').map(node => squash(node.textContent)), ['Sweep: the deadfall held.', 'Sweep: the basilisk bled out.']);
    const person = cards[0].querySelector('details.wv-cat[data-kind="relationships"] .wv-item');
    assert.equal(squash(person.querySelector('.wv-t').textContent), 'Torka', 'the name on its own line');
    assert.equal(person.querySelectorAll('.wv-tags .wv-tag').length, 2, 'its meters wrap under it');
});

test('N1: a person with an agenda keeps their Met, events and fight lines on a short day (Journal, search, backlog), as on a whole day', () => {
    const agenda = { words: new Set(), behind: new Set(['bregje']) };
    const cats = {
        met: ['Bregje'], events: ['Bregje asked for the ledger.', 'Fight won: Astra +60 XP, Bregje +60 XP.'],
        party: ['Bregje joins the party.'], items: ['Bregje gives the party Rope.'], reputation: ['Bregje: deed.'],
        relationships: ['Bregje: trust 1 -> 2'], news: ['World: Bregje left town.'],
    };
    const day = knownDay(shortDay(cats), agenda, { now: NOW });
    assert.deepEqual(kindOf(day, 'met').items.map(row => row.title), ['Bregje']);
    assert.equal(kindOf(day, 'events').items.length, 2);
    assert.equal(kindOf(day, 'party').items.length, 1);
    assert.equal(kindOf(day, 'items').items.length, 1);
    assert.equal(kindOf(day, 'reputation').items.length, 1);
    assert.equal(kindOf(day, 'relationships'), undefined, 'relationships and news still hide agenda keys, as on a whole day');
    assert.equal(kindOf(day, 'news'), undefined);
    assert.match(day.search, /Fight won: Astra \+60 XP, Bregje/);
    assert.match(backlogBlock({ days: [{ ...day, day: 20 }], now: 22 * 1440, present: ['Bregje'] }).join('\n'), /Bregje/);
});
