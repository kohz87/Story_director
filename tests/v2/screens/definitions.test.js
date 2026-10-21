// Screens part: the four default screens are valid SPEC §13.1 definitions (Story Block's own
// validateScreen), mount where they should, bind only to queries the module answers, and keep their
// CSS within what §13.3 allows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CSS_LIMIT, resolveData, validateScreen, vendoredScreens } from './helpers/runtime.js';
import { headState, makeQueries, makeRunner } from './helpers/fixtures.js';
import { DIRECTOR_ID, HUD_ID, QUESTS_ID, STATUS_CARD_ID, createScreensPart, part, screens } from '../../../src/v2/screens/index.js';

const byId = Object.fromEntries(screens.map(screen => [screen.id, screen]));
const utf8 = new TextEncoder();

test('the part exports the four screens and the view queries, nothing else of its own', () => {
    assert.deepEqual(part.screens.map(screen => screen.id), [QUESTS_ID, DIRECTOR_ID, STATUS_CARD_ID, HUD_ID]);
    assert.deepEqual(Object.keys(part.queries).sort(), ['director.goal', 'director.next', 'director.problems', 'quest.board']);
    assert.deepEqual([part.domains, part.commands, part.kinds, part.hooks, part.tabs], [{}, {}, {}, {}, []]);
    assert.equal(part.context, undefined, 'no prompt text: the static prompt is unchanged');
    // A fresh part has its own list (a pack or card overriding a screen never edits the defaults).
    assert.notEqual(createScreensPart().screens, part.screens);
    assert.ok(Object.isFrozen(byId[QUESTS_ID]));
});

test('every screen passes validateScreen', () => {
    for (const screen of screens) assert.deepEqual(validateScreen(screen, { id: screen.id }), [], screen.id);
});

test('each screen mounts where it is meant to', () => {
    assert.deepEqual(byId[QUESTS_ID].mounts, ['tab', 'screen']);
    assert.deepEqual(byId[DIRECTOR_ID].mounts, ['tab', 'screen']);
    assert.deepEqual(byId[STATUS_CARD_ID].mounts, ['card']);
    assert.deepEqual(byId[HUD_ID].mounts, ['hud']);
    for (const screen of screens) {
        assert.ok(screen.id.startsWith('story-director/'), screen.id);
        assert.equal(typeof screen.title, 'string');
        assert.match(screen.icon, /^fa-[a-z-]+$/);
    }
});

test('the screens register in Story Block\'s screen registry and list by mount', () => {
    const registry = vendoredScreens();
    registry.addModule('story-director', part.screens);
    assert.deepEqual(registry.problems(), []);
    // Story Block sorts the navigation by screen `order` (SB #75): an id ending in /quests takes the
    // usual quests place (20); the Director screen gives no order, so it comes after the usual ones.
    assert.deepEqual(registry.list('tab').map(entry => entry.id), [QUESTS_ID, DIRECTOR_ID]);
    assert.deepEqual(registry.list('card').map(entry => entry.id), [STATUS_CARD_ID]);
    assert.deepEqual(registry.list('hud').map(entry => entry.id), [HUD_ID]);
    assert.deepEqual(registry.list('dialog'), []);
});

test('every data binding names a query the module (or a module it reads) answers, and resolves', () => {
    const queries = makeQueries();
    const { run } = makeRunner(queries);
    const state = headState();
    for (const screen of screens) {
        for (const [alias, binding] of Object.entries(screen.data ?? {})) assert.ok(queries[binding.query], `${screen.id}: ${alias} → ${binding.query}`);
        const data = resolveData(screen.data, (name, args) => run(state, name, args));
        assert.equal(data.ok, true, screen.id);
        assert.deepEqual(data.problems, [], screen.id);
    }
});

test('the bindings use the Director\'s queries: time, threads by kind and status, progress of the goal', () => {
    assert.deepEqual(byId[HUD_ID].data, { time: { query: 'director.time' } });
    assert.deepEqual(byId[STATUS_CARD_ID].data.progress, { query: 'quest.progress', args: { id: '$goal.id' } });
    assert.equal(byId[STATUS_CARD_ID].data.time.query, 'director.time');
    const director = byId[DIRECTOR_ID].data;
    assert.deepEqual(director.quest_open, { query: 'director.threads', args: { kind: 'quest', status: 'active' } });
    assert.deepEqual(director.secret_closed, { query: 'director.threads', args: { kind: 'secret', status: 'resolved' } });
    const { problems, time, ...threads } = director;
    assert.deepEqual(problems, { query: 'director.problems' });
    assert.deepEqual(time, { query: 'director.time' }, 'the clock line in its header');
    assert.ok(Object.values(threads).every(binding => binding.query === 'director.threads'));
    assert.equal(byId[STATUS_CARD_ID].defaultOn, true, 'on under every reply by default (§F24)');
    assert.equal(byId[HUD_ID].defaultOn, undefined);
    assert.deepEqual(byId[QUESTS_ID].data, { board: { query: 'quest.board' } });
});

test('the status card\'s progress follows its goal binding ($goal.id), and is empty without a goal', () => {
    const { run } = makeRunner();
    const card = byId[STATUS_CARD_ID];
    const data = resolveData(card.data, (name, args) => run(headState(), name, args));
    assert.deepEqual(data.order, ['time', 'next', 'goal', 'progress']);
    assert.equal(data.q.goal.id, 'th_wolves01');
    assert.equal(data.q.progress.label, 'Wolves 8/3');
    const none = resolveData(card.data, (name, args) => run(headState({ threads: [] }), name, args));
    assert.equal(none.q.goal, null);
    assert.equal(none.q.progress, null);
});

test('css stays within §13.3: under 64 KB, no @import, fixed positions or url(), no global selectors', () => {
    for (const screen of screens) {
        const size = utf8.encode(screen.css).length;
        assert.ok(size < CSS_LIMIT, `${screen.id}: ${size} bytes`);
        assert.doesNotMatch(screen.css, /@import|position\s*:\s*fixed|url\(|expression\(|behavior\s*:|-moz-binding/i, screen.id);
        // Selectors are written for the screen root (Story Block prefixes them); none reaches html/body.
        assert.doesNotMatch(screen.css, /(^|[\s,}])(html|body)\b/, screen.id);
        // Default look: SillyTavern's theme variables (MODULES §F18).
        assert.match(screen.css, /--SmartThemeBodyColor/, screen.id);
        assert.match(screen.css, /--SmartThemeQuoteColor/, screen.id);
    }
});

test('templates stay inside the §13.2 subset: no scripts, handlers or script URLs', () => {
    for (const screen of screens) {
        assert.doesNotMatch(screen.template, /<\s*(script|style|iframe|object|embed|link|meta|base)\b/i, screen.id);
        assert.doesNotMatch(screen.template, /\son[a-z]+\s*=/i, screen.id);
        assert.doesNotMatch(screen.template, /javascript:|vbscript:/i, screen.id);
        // Data never sets data-* through data-bind-attr (the renderer refuses it).
        assert.doesNotMatch(screen.template, /data-bind-attr="[^"]*\bdata-/, screen.id);
    }
});

test('no screen draws a command button by default: quests follow the reader\'s words and the story (F95)', () => {
    for (const screen of screens) assert.doesNotMatch(screen.template, /data-command|data-submit|<button/, `${screen.id} draws no buttons`);
    // Each quest row says where it stands and opens its details (F84) in a screen-local panel.
    const template = byId[QUESTS_ID].template;
    assert.equal([...template.matchAll(/class="sd-status"/g)].length, 2, 'offers and active quests');
    assert.equal([...template.matchAll(/<details class="sd-more">/g)].length, 3, 'offers, active and finished rows');
    assert.doesNotMatch(template, /<dialog/i, 'templates have no dialog element');
});
