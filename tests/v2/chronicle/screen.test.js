// Chronicle part: the Chronicle screen, checked by Story Block's screen validator and drawn by its
// template renderer (vendored in tests/vendor/story-block) with the real condition language:
// events under way first, resolved ones folded, factions; Save sends what the reader typed as
// chronicle.edit, the one-click buttons send their payloads, and the queries other modules read.

import test from 'node:test';
import assert from 'node:assert/strict';

import { CHRONICLE_ID, chronicleScreen } from '../../../src/v2/chronicle/screen.js';
import { part } from '../../../src/v2/chronicle/index.js';
import { daysScreen } from '../../../src/v2/chronicle/days-screen.js';
import { validateScreen } from '../../vendor/story-block/src/v2/view/screens.js';
import { compileTemplate, renderTemplate } from '../../vendor/story-block/src/v2/view/template/index.js';
import { conditionEvaluator } from '../../vendor/story-block/src/v2/view/bind.js';
import { compile, evaluate } from '../../vendor/story-block/src/v2/events/index.js';
import { scopeCss } from '../../vendor/story-block/src/v2/view/css.js';
import { installFakeDom } from '../../ui-fake-dom.js';
import { clockAt, command, eventNamed, factionNamed, lines, makeState, query } from './helpers/fake-ctx.js';

const DAY = 1440;
const squash = text => String(text ?? '').replace(/\s+/g, ' ').trim();
const button = (root, label) => root.querySelectorAll('button').filter(node => squash(node.textContent) === label);
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function worldState() {
    let state = lines(makeState({ minutes: 10 * DAY }), [
        '+ world Dragon Calamity — awakens near Dragonfang | place: Dragonfang | factions: Ashen Court',
        '+ world Red Plague — coughing in the docks | state: looming',
        '+ world Siege of Harrow — the Ashen Court surrounds Harrow',
        '+ faction Ashen Court — the old nobility | area: Northmarch | stance: hostile',
        '+ faction River Guild — boatmen and smugglers',
    ].join('\n')).state;
    state = clockAt(state, 13 * DAY);
    return lines(state, '- world Siege of Harrow — the siege is lifted').state;
}

function draw(state, { command: run = null } = {}) {
    const doc = installFakeDom();
    doc.head = doc.createElement('head');
    const el = doc.createElement('div');
    el.setAttribute('data-ss-screen', CHRONICLE_ID);
    doc.body.appendChild(el);
    const compiled = compileTemplate(chronicleScreen.template);
    const warnings = [...compiled.warnings];
    const scopeOf = current => ({ state: current, q: { board: query(current, 'chronicle.board') }, settings: {}, mount: 'tab', screenId: CHRONICLE_ID, api: {} });
    const view = renderTemplate(el, compiled, scopeOf(state), {
        evaluate: conditionEvaluator({ compile, evaluate }),
        widgets: {},
        command: run,
        onWarn: message => warnings.push(message),
    });
    return { el, view, warnings, update: next => view.update(scopeOf(next)) };
}

test('the Chronicle screen is a valid definition for the tab and the full screen, bound to the part\'s query', () => {
    assert.deepEqual(part.screens, [chronicleScreen, daysScreen]);
    assert.equal(CHRONICLE_ID, 'story-director/chronicle');
    assert.deepEqual([...chronicleScreen.mounts], ['tab', 'screen']);
    assert.deepEqual(validateScreen(chronicleScreen), []);
    for (const binding of Object.values(chronicleScreen.data)) assert.ok(Object.hasOwn(part.queries, binding.query));
    assert.deepEqual(scopeCss(chronicleScreen.css, CHRONICLE_ID).warnings, []);
    assert.deepEqual(part.tabs, []);
});

test('drawn: events under way first, resolved folded away, factions; no warnings', () => {
    const { el, warnings } = draw(worldState());
    assert.deepEqual(warnings, []);
    const events = el.querySelectorAll('.ch-event');
    // Newest news first (the same story time: the later line first).
    assert.deepEqual(events.map(node => node.querySelector('.ch-name').textContent), ['Red Plague', 'Dragon Calamity']);
    assert.match(squash(events[1].textContent), /^Dragon Calamity ongoing awakens near Dragonfang Dragonfang Ashen Court Since .*Last news 3 days ago Edit/);
    assert.equal(events[0].getAttribute('data-state'), 'looming');
    const resolved = el.querySelector('.ch-resolved');
    assert.ok(resolved, 'the resolved list is there, folded');
    assert.equal(resolved.hasAttribute('open'), false);
    assert.match(squash(resolved.textContent), /^Resolved 1 Siege of Harrow — the siege is lifted/);
    const factions = el.querySelectorAll('.ch-faction');
    assert.deepEqual(factions.map(node => node.querySelector('.ch-name').textContent), ['Ashen Court', 'River Guild']);
    assert.match(squash(factions[0].textContent), /Ashen Court hostile the old nobility Northmarch Dragon Calamity/);
    assert.match(squash(el.querySelector('.ch-events .ch-h').textContent), /Events 2 under way/);
});

test('an empty chronicle says so, with no lists', () => {
    const { el, warnings } = draw(makeState());
    assert.deepEqual(warnings, []);
    assert.deepEqual(el.querySelectorAll('.ch-empty').map(node => squash(node.textContent)), ['Nothing is under way in the wider world.', 'No factions recorded yet.']);
    assert.equal(el.querySelector('.ch-resolved'), null);
});

test('the buttons send chronicle.edit and chronicle.remove with cause ui; Save sends what the reader typed', async () => {
    const state = worldState();
    const sent = [];
    const { el } = draw(state, { command: (type, payload, options) => { sent.push([type, payload, options?.cause]); return { ok: true }; } });
    const dragon = eventNamed(state, 'Dragon Calamity');
    const card = el.querySelector(`[data-event="${dragon.id}"]`);
    button(card, 'Resolved')[0].click();
    button(card, 'Remove')[0].click();
    const summary = card.querySelector('textarea');
    summary.value = 'the dragon burns Harrow';
    summary.dispatch('input');
    const [nameInput, placeInput] = card.querySelectorAll('input');
    assert.equal(nameInput.getAttribute('placeholder'), 'Dragon Calamity');
    placeInput.value = 'Harrow';
    placeInput.dispatch('input');
    button(card, 'Save')[0].click();
    const siege = eventNamed(state, 'Siege of Harrow');
    button(el.querySelector(`[data-event="${siege.id}"]`), 'Reopen')[0].click();
    const court = factionNamed(state, 'Ashen Court');
    const courtCard = el.querySelector(`[data-faction="${court.id}"]`);
    const stance = courtCard.querySelectorAll('input')[2];
    stance.value = 'allied';
    stance.dispatch('input');
    button(courtCard, 'Save')[0].click();
    await settle();
    assert.deepEqual(sent, [
        ['chronicle.edit', { id: dragon.id, state: 'resolved' }, 'ui'],
        ['chronicle.remove', { id: dragon.id }, 'ui'],
        ['chronicle.edit', { id: dragon.id, name: '', summary: 'the dragon burns Harrow', state: '', place: 'Harrow', factions: '' }, 'ui'],
        ['chronicle.edit', { id: siege.id, state: 'ongoing' }, 'ui'],
        ['chronicle.edit', { id: court.id, name: '', summary: '', area: '', stance: 'allied' }, 'ui'],
    ]);
    // Those payloads, run as the commands, do what the buttons say.
    const saved = command(state, ...sent[2].slice(0, 2));
    assert.deepEqual([saved.ok, eventNamed(saved.state, 'Dragon Calamity').summary, eventNamed(saved.state, 'Dragon Calamity').place], [true, 'the dragon burns Harrow', 'Harrow']);
    const allied = command(state, ...sent[4].slice(0, 2));
    assert.equal(factionNamed(allied.state, 'Ashen Court').stance, 'allied');
});

test('drawn again after an edit, the card follows the state', () => {
    const state = worldState();
    const { el, update, warnings } = draw(state);
    const dragon = eventNamed(state, 'Dragon Calamity');
    const next = command(state, 'chronicle.edit', { id: dragon.id, state: 'resolved' }).state;
    update(next);
    assert.deepEqual(warnings, []);
    assert.deepEqual(el.querySelectorAll('.ch-event').map(node => node.querySelector('.ch-name').textContent), ['Red Plague']);
    assert.match(squash(el.querySelector('.ch-resolved').textContent), /Resolved 2 Dragon Calamity/);
});

test('the queries other modules read: chronicle.events, chronicle.event, chronicle.factions, chronicle.faction', () => {
    const state = worldState();
    const events = query(state, 'chronicle.events');
    assert.deepEqual(events.map(event => [event.name, event.state, event.open]), [
        ['Red Plague', 'looming', true], ['Dragon Calamity', 'ongoing', true], ['Siege of Harrow', 'resolved', false],
    ]);
    const dragon = events[1];
    assert.deepEqual(dragon.factions, [{ name: 'Ashen Court', id: factionNamed(state, 'Ashen Court').id }]);
    assert.equal(dragon.since, 10 * DAY);
    assert.equal(dragon.sinceText, 'January 11, 0, 12:00 am');
    assert.equal(dragon.updatedAgo, '3 days ago');
    assert.deepEqual(query(state, 'chronicle.events', { open: false }).map(event => event.name), ['Siege of Harrow']);
    assert.deepEqual(query(state, 'chronicle.events', { state: 'looming' }).map(event => event.name), ['Red Plague']);
    assert.equal(query(state, 'chronicle.event', { name: 'red plague' }).id, eventNamed(state, 'Red Plague').id);
    assert.equal(query(state, 'chronicle.event', { name: 'nothing' }), null);
    const factions = query(state, 'chronicle.factions');
    assert.deepEqual(factions.map(faction => [faction.name, faction.eventsText]), [['Ashen Court', 'Dragon Calamity'], ['River Guild', '']]);
    assert.equal(query(state, 'chronicle.faction', { id: factions[1].id }).name, 'River Guild');
    // Plain copies: changing an answer changes nothing in the state.
    events[1].name = 'Changed';
    assert.equal(query(state, 'chronicle.events')[1].name, 'Dragon Calamity');
    // Without the chronicle (another module asking early): empty answers.
    const bare = { v: 2, meta: { rev: 0 }, domains: {} };
    assert.deepEqual(part.queries['chronicle.events'](bare, {}, {}), []);
    assert.deepEqual(part.queries['chronicle.board'](bare, {}, {}).open, []);
});
