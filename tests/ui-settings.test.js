// Settings panel against the fake DOM: every control hands a full new settings object
// to onChange and leaves the one it was given alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './ui-fake-dom.js';

const doc = installFakeDom();
const { renderSettings, parseMonths, formatMonths } = await import('../src/ui/settings.js');

const SETTINGS = Object.freeze({
    enabled: true, sceneTag: 'World_State', depth: 1,
    budgetTokens: 1000, dormantReplies: 15, dormantDays: 30, dueSoonDays: 3,
    mirrorOffscreen: true,
    calendar: { preset: 'custom', era: 'CY', months: [{ name: 'Dawnwane', days: 30 }, { name: 'Haywane', days: 31 }], daysPerMonth: 30 },
});
const BLOCKS = [{ tag: 'World_State', name: 'World State' }, { tag: 'Scene', name: 'Scene' }];

function setup({ settings = structuredClone(SETTINGS), blocks = BLOCKS, status } = {}) {
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const changes = [];
    let seeds = 0;
    const before = structuredClone(settings);
    const panel = renderSettings(container, { settings, blocks, status, onChange: next => changes.push(next), onSeed: () => { seeds += 1; } });
    return { container, panel, settings, before, changes, seeds: () => seeds, $: selector => container.querySelector(selector) };
}

function edit(input, value, type = 'change') {
    input.value = value;
    input.dispatch(type);
}

const last = list => list[list.length - 1];

test('drawer markup, header and status line', () => {
    const { $, container } = setup({ status: 'Tracking 4 records.' });
    assert.ok($('.story-director-settings > .inline-drawer > .inline-drawer-toggle.inline-drawer-header'));
    assert.match($('.inline-drawer-header b').textContent, /^Story Director/);
    assert.ok($('.inline-drawer-content.story-suite-panel'), 'the drawer content is a Story Suite panel');
    const status = $('#story_director_status');
    assert.equal(status.textContent, 'Tracking 4 records.');
    assert.ok(status.classList.contains('story-suite-notice'));
    assert.equal(container.querySelectorAll('#story_director_status').length, 1);
    const groups = container.querySelectorAll('.story-suite-folds > details.story-suite-fold > summary > b').map(node => node.textContent);
    assert.deepEqual(groups, ['Tracking & note', 'Calendar', 'Map & travel', 'Arc planning', 'Capture', 'Existing chat & compatibility']);
});

test('a quick bar on top, folding sections below, all closed at first', () => {
    const planned = [];
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    renderSettings(container, { settings: SETTINGS, version: 'v0.5.1', onPlanArc: () => planned.push(1), onChange() {} });
    assert.match(container.querySelector('.inline-drawer-header b').textContent, /Story Director v0\.5\.1/);
    const quickbar = container.querySelector('.story-suite-quickbar');
    assert.ok(quickbar.querySelector('label.story-suite-row > input#story_director_enabled'), 'the switch is a row in the quick bar');
    quickbar.querySelector('.story-suite-actions .story-director-plan').click();
    assert.deepEqual(planned, [1]);
    assert.ok(quickbar.querySelector('.story-suite-actions .story-director-seed'));
    const folds = container.querySelectorAll('details.story-suite-fold');
    assert.deepEqual(folds.map(node => node.getAttribute('data-fold')), ['tracking', 'calendar', 'pack', 'arc', 'capture', 'chat']);
    assert.deepEqual(folds.filter(node => node.hasAttribute('open')), [], 'all closed');
    assert.ok(container.querySelector('.story-suite-fold[data-fold="arc"] > .story-suite-fold-body #story_director_arc_trigger'), 'arc controls live in their section');
});

test('section summaries say what the main setting is now, and follow edits', () => {
    const { container, $ } = setup();
    const summary = key => container.querySelector(`.story-suite-fold[data-fold="${key}"] > summary > small`).textContent;
    assert.equal(summary('tracking'), '<World_State> · depth 1 · up to 1000 tokens');
    assert.equal(summary('calendar'), '2 months · CY');
    assert.equal(summary('pack'), '1 km per unit · no world pack');
    assert.equal(summary('arc'), 'Manual · same model as chat');
    assert.equal(summary('capture'), 'Off');
    assert.equal(summary('chat'), 'Mirror on · source of truth Automatic');
    edit($('#story_director_depth'), '4');
    assert.equal(summary('tracking'), '<World_State> · depth 4 · up to 1000 tokens');
    edit($('#story_director_preset'), 'gregorian');
    assert.equal(summary('calendar'), 'Gregorian · CY');
    edit($('#story_director_capture_mode'), 'always');
    assert.equal(summary('capture'), 'Always · same model as chat');
    edit($('#story_director_source_npc'), 'theirs');
    assert.equal(summary('chat'), 'Mirror on · source of truth your choices');
});

test('every setting is a story-suite-row: a bold label, a small hint, the control; numbers carry units', () => {
    const { $ } = setup();
    const depthRow = $('#story_director_depth').closest('.story-suite-row');
    assert.equal(depthRow.tagName, 'LABEL');
    assert.equal(depthRow.getAttribute('for'), 'story_director_depth');
    assert.equal(depthRow.querySelector('span > b').textContent, 'Note depth');
    assert.match(depthRow.querySelector('span > small').textContent, /messages from the end/);
    const number = $('#story_director_depth').closest('.story-suite-number');
    assert.ok(number, 'a number with its unit');
    assert.equal(number.querySelector('small').textContent, 'messages');
    assert.equal($('#story_director_budget').closest('.story-suite-number').querySelector('small').textContent, 'tokens');
    // Selects sit straight in the row, where suite.css sizes them.
    assert.equal($('#story_director_scene').parentNode, $('#story_director_scene').closest('.story-suite-row'));
    assert.ok($('.story-suite-fold[data-fold="tracking"] .story-suite-subhead'), 'Dormant shelf is a subhead');
});

test('re-rendering into the same container keeps the status the runtime wrote', () => {
    const { container } = setup();
    container.querySelector('#story_director_status').textContent = 'Seeded 7 records.';
    renderSettings(container, { settings: SETTINGS, onChange() {} });
    assert.equal(container.querySelector('#story_director_status').textContent, 'Seeded 7 records.');
});

test('every control emits a full new object and never mutates the input', () => {
    const cases = [
        ['#story_director_enabled', input => { input.checked = false; input.dispatch('change'); }, next => assert.equal(next.enabled, false)],
        ['#story_director_scene', input => edit(input, 'Scene'), next => assert.equal(next.sceneTag, 'Scene')],
        ['#story_director_depth', input => edit(input, '4'), next => assert.equal(next.depth, 4)],
        ['#story_director_budget', input => edit(input, '1500'), next => assert.equal(next.budgetTokens, 1500)],
        ['#story_director_dormant_replies', input => edit(input, '20'), next => assert.equal(next.dormantReplies, 20)],
        ['#story_director_dormant_days', input => edit(input, '45'), next => assert.equal(next.dormantDays, 45)],
        ['#story_director_due_soon', input => edit(input, '5'), next => assert.equal(next.dueSoonDays, 5)],
        ['#story_director_preset', input => edit(input, 'gregorian'), next => assert.equal(next.calendar.preset, 'gregorian')],
        ['#story_director_era', input => edit(input, ' AR ', 'input'), next => assert.equal(next.calendar.era, 'AR')],
        ['#story_director_months', input => edit(input, 'One\nTwo | 12', 'input'), next => assert.deepEqual(next.calendar.months, [{ name: 'One', days: 30 }, { name: 'Two', days: 12 }])],
        ['#story_director_days_per_month', input => edit(input, '28'), next => assert.equal(next.calendar.daysPerMonth, 28)],
        ['#story_director_mirror', input => { input.checked = false; input.dispatch('change'); }, next => assert.equal(next.mirrorOffscreen, false)],
        ['#story_director_source_npc', input => edit(input, 'mine'), next => assert.deepEqual(next.sourceOfTruth, { calendar: 'auto', timeline: 'auto', npc: 'mine' })],
    ];
    for (const [selector, act, check] of cases) {
        const { $, settings, before, changes } = setup();
        const input = $(selector);
        assert.ok(input, `${selector} exists`);
        act(input);
        assert.equal(changes.length, 1, `${selector} emits once`);
        const next = changes[0];
        check(next);
        assert.notEqual(next, settings, `${selector}: a new object`);
        assert.notEqual(next.calendar, settings.calendar, `${selector}: a new calendar`);
        assert.deepEqual(settings, before, `${selector}: input untouched`);
        // Full: every key of the input is still there.
        for (const key of Object.keys(SETTINGS)) assert.ok(key in next, `${selector}: ${key} kept`);
        for (const key of Object.keys(SETTINGS.calendar)) assert.ok(key in next.calendar, `${selector}: calendar.${key} kept`);
    }
});

test('edits accumulate: the second change carries the first', () => {
    const { $, changes } = setup();
    edit($('#story_director_depth'), '3');
    edit($('#story_director_dormant_days'), '60');
    assert.equal(last(changes).depth, 3);
    assert.equal(last(changes).dormantDays, 60);
    assert.notEqual(changes[0], changes[1]);
});

test('numbers are clamped, and text that is not a number keeps the old value', () => {
    const { $, changes } = setup();
    const depth = $('#story_director_depth');
    edit(depth, '-4');
    assert.equal(last(changes).depth, 0);
    assert.equal(depth.value, '0');
    edit(depth, 'lots');
    assert.equal(depth.value, '0');
    assert.equal(changes.length, 1, 'nothing new to emit');
    edit($('#story_director_budget'), '999999');
    assert.equal(last(changes).budgetTokens, 20000);
});

test('(0.9.19) running low sits by the stall window in the Arc fold: 3 by default, 0 turns it off', () => {
    const { $, changes, container } = setup();
    const input = $('#story_director_arc_low_threads');
    assert.ok(container.querySelector('.story-suite-fold[data-fold="arc"] > .story-suite-fold-body #story_director_arc_low_threads'), 'in the Arc fold');
    assert.equal(input.value, '3');
    const row = input.closest('.story-suite-row');
    assert.equal(row.querySelector('span > b').textContent, 'Running low at');
    assert.match(row.querySelector('span > small').textContent, /^Automatic: .*fewer than .*hooks, clocks and beats.*0: off/);
    assert.equal(input.closest('.story-suite-number').querySelector('small').textContent, 'threads');
    const rows = container.querySelectorAll('.story-suite-fold[data-fold="arc"] .story-suite-row').map(node => node.getAttribute('for'));
    assert.equal(rows.indexOf('story_director_arc_low_threads'), rows.indexOf('story_director_arc_stall') + 1, 'right after Stalled after');
    edit(input, '0');
    assert.equal(last(changes).arc.lowThreads, 0);
    assert.equal(last(changes).arc.stallDays, 7, 'the rest of the arc kept');
    edit(input, '99');
    assert.equal(last(changes).arc.lowThreads, 20, 'clamped');
    edit(input, 'some');
    assert.equal(input.value, '20');
});

test('months textarea parses Name and Name | days lines', () => {
    assert.deepEqual(parseMonths('Dawnwane\n  Haywane | 31 \n\nGoldwane|28\nYearsend | x', 30), [
        { name: 'Dawnwane', days: 30 },
        { name: 'Haywane', days: 31 },
        { name: 'Goldwane', days: 28 },
        { name: 'Yearsend', days: 30 },
    ]);
    assert.equal(formatMonths([{ name: 'Dawnwane', days: 30 }, { name: 'Haywane', days: 31 }], 30), 'Dawnwane\nHaywane | 31');

    const { $, changes } = setup();
    const months = $('#story_director_months');
    assert.equal(months.value, 'Dawnwane\nHaywane | 31');
    edit(months, 'Frostwane\nThawwane | 29\n', 'input');
    assert.deepEqual(last(changes).calendar.months, [{ name: 'Frostwane', days: 30 }, { name: 'Thawwane', days: 29 }]);
});

test('bare month names follow a new days per month', () => {
    const { $, changes } = setup();
    edit($('#story_director_days_per_month'), '28');
    assert.deepEqual(last(changes).calendar.months, [{ name: 'Dawnwane', days: 28 }, { name: 'Haywane', days: 31 }]);
});

test('the Gregorian preset hides the custom month rows', () => {
    const { $ } = setup();
    const row = $('#story_director_months').closest('.story-suite-row');
    assert.equal(row.hasAttribute('hidden'), false);
    edit($('#story_director_preset'), 'gregorian');
    assert.equal(row.hasAttribute('hidden'), true);
    edit($('#story_director_preset'), 'custom');
    assert.equal(row.hasAttribute('hidden'), false);
});

test('scene block select lists the blocks, and keeps a tag it does not list', () => {
    const { $ } = setup();
    const scene = $('#story_director_scene');
    assert.equal(scene.tagName, 'SELECT');
    assert.deepEqual(scene.querySelectorAll('option').map(option => option.value), ['World_State', 'Scene']);
    assert.equal(scene.querySelectorAll('option')[0].textContent, 'World State <World_State>');
    assert.equal(scene.value, 'World_State');

    const missing = setup({ settings: { ...structuredClone(SETTINGS), sceneTag: 'Old_State' } });
    const options = missing.$('#story_director_scene').querySelectorAll('option');
    assert.equal(options[0].value, 'Old_State');
    assert.match(options[0].textContent, /not found/);
});

test('scene block falls back to free text when there are no blocks', () => {
    const { $, changes } = setup({ blocks: [] });
    const scene = $('#story_director_scene');
    assert.equal(scene.tagName, 'INPUT');
    assert.equal(scene.type, 'text');
    assert.equal(scene.value, 'World_State');
    edit(scene, ' My_State ', 'input');
    assert.equal(last(changes).sceneTag, 'My_State');
    edit(scene, '', 'input');
    assert.equal(last(changes).sceneTag, 'World_State', 'an empty box means the default');
});

test('tracking and mirror switches', () => {
    const { $, changes } = setup();
    for (const id of ['#story_director_enabled', '#story_director_mirror']) {
        const input = $(id);
        assert.equal(input.type, 'checkbox');
        assert.equal(input.getAttribute('role'), 'switch');
        assert.equal(input.checked, true);
        assert.equal(input.parentNode.tagName, 'LABEL', 'a checkbox straight in its row, shown as a pill');
        assert.ok(input.parentNode.classList.contains('story-suite-row'));
    }
    const mirror = $('#story_director_mirror');
    mirror.checked = false;
    mirror.dispatch('change');
    assert.equal(last(changes).mirrorOffscreen, false);
    mirror.checked = true;
    mirror.dispatch('change');
    assert.equal(last(changes).mirrorOffscreen, true);
    assert.equal(last(changes).enabled, true);
    assert.ok(mirror.closest('.story-suite-row').textContent.includes('Mirror off-screen agendas'));
});

test('Seed button calls onSeed and changes nothing', () => {
    const { $, changes, seeds } = setup();
    const seed = $('.story-director-seed');
    assert.ok(seed.classList.contains('menu_button'));
    assert.equal(seed.textContent, 'Seed from World State');
    assert.ok(seed.querySelector('i.fa-solid.fa-seedling'));
    seed.click();
    seed.click();
    assert.equal(seeds(), 2);
    assert.equal(changes.length, 0);
});

test('update(settings) re-renders the sections and keeps the drawer and status', () => {
    const { $, panel, container, changes } = setup({ status: 'Ready.' });
    const drawer = $('.inline-drawer');
    panel.update({ ...structuredClone(SETTINGS), depth: 7, enabled: false, calendar: { ...SETTINGS.calendar, era: 'AR', months: [{ name: 'Solmonth', days: 30 }] } });
    assert.equal($('#story_director_depth').value, '7');
    assert.equal($('#story_director_enabled').checked, false);
    assert.equal($('#story_director_era').value, 'AR');
    assert.equal($('#story_director_months').value, 'Solmonth');
    assert.equal(container.querySelector('.inline-drawer'), drawer, 'same drawer');
    assert.equal($('#story_director_status').textContent, 'Ready.');
    assert.equal(changes.length, 0, 'update does not echo back');
    // Later edits build on the updated settings.
    edit($('#story_director_budget'), '800');
    assert.equal(last(changes).depth, 7);
    assert.equal(last(changes).budgetTokens, 800);
    assert.equal(panel.root, container.querySelector('.story-director-settings'));
});

test('a partial settings object is completed with the defaults', () => {
    const { $, changes } = setup({ settings: { depth: 2 } });
    edit($('#story_director_due_soon'), '6');
    const next = last(changes);
    assert.equal(next.depth, 2);
    assert.equal(next.dueSoonDays, 6);
    assert.equal(next.sceneTag, 'World_State');
    assert.equal(next.calendar.daysPerMonth, 30);
    assert.deepEqual(next.calendar.months, []);

    const named = setup({ settings: { calendar: { months: ['Dawnwane', 'Haywane'], daysPerMonth: 28 } } });
    assert.equal(named.$('#story_director_months').value, 'Dawnwane\nHaywane');
    edit(named.$('#story_director_depth'), '2');
    assert.deepEqual(last(named.changes).calendar.months, [{ name: 'Dawnwane', days: 28 }, { name: 'Haywane', days: 28 }]);
});

test('no data goes through innerHTML', () => {
    const { container } = setup({ blocks: [{ tag: '<img src=x>', name: '<b>bad</b>' }] });
    assert.ok(container.descendants().every(node => !node.html));
    assert.ok(container.querySelectorAll('#story_director_scene option').some(option => option.textContent === '<b>bad</b> <<img src=x>>'));
});

test('world pack: summary, paste import, clear, and messages', async () => {
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const imported = [];
    let cleared = 0;
    const panel = renderSettings(container, {
        settings: {},
        packSummary: '',
        onImportPack: async text => { imported.push(text); return { summary: '19 places · 23 routes', message: 'Imported.' }; },
        onClearPack: async () => { cleared++; return { summary: '', message: 'Cleared.' }; },
    });
    const map = () => container.querySelector('.story-suite-row.is-pack');
    assert.match(map().textContent, /Roads.*Now: none/);
    assert.equal(container.querySelector('.story-director-pack-clear').disabled, true, 'nothing to clear');

    container.querySelector('.story-director-pack-paste').value = '{"places":{}}';
    container.querySelector('.story-director-pack-import').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(imported, ['{"places":{}}']);
    assert.match(map().textContent, /Now: 19 places · 23 routes/);
    assert.match(container.querySelector('.story-suite-fold[data-fold="pack"] > summary > small').textContent, /world pack loaded/);
    assert.equal(container.querySelector('.story-suite-notice.story-director-pack-message').textContent, 'Imported.');

    container.querySelector('.story-director-pack-clear').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(cleared, 1);
    assert.match(map().textContent, /Roads.*Now: none/);
    panel.update({}, { packSummary: '1 place · 0 routes' });
    assert.match(map().textContent, /1 place · 0 routes/);
});

test('capture: mode, model and answer length go through onChange', () => {
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const changes = [];
    renderSettings(container, { settings: {}, profiles: [{ id: 'p1', name: 'Fast' }], onChange: next => changes.push(next) });
    const mode = container.querySelector('#story_director_capture_mode');
    assert.equal(mode.value, 'off');
    mode.value = 'fallback';
    mode.dispatch('change');
    const model = container.querySelector('#story_director_capture_model');
    model.value = 'p1';
    model.dispatch('change');
    const tokens = container.querySelector('#story_director_capture_tokens');
    tokens.value = '600';
    tokens.dispatch('change');
    const last = changes.at(-1).capture;
    assert.deepEqual(last, { mode: 'fallback', model: { source: 'profile', profileId: 'p1' }, maxTokens: 600 });
    assert.ok(container.querySelector('#story_director_wsa_file'), 'the World State Alpha import is offered');
});

test('the spoiler switch sits in the quick bar, on by default', () => {
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const changes = [];
    renderSettings(container, { settings: {}, onChange: next => changes.push(next) });
    const guard = container.querySelector('.story-suite-quickbar input#story_director_spoiler');
    assert.ok(guard, 'in the quick bar');
    assert.equal(guard.checked, true);
    guard.checked = false;
    guard.dispatch('change');
    assert.equal(changes.at(-1).spoilerGuard, false);
});

test('map: north and east, km per unit and road factor, decimals kept and clamped', () => {
    const changes = [];
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    renderSettings(container, { settings: { map: { north: 'down', kmPerUnit: 10 } }, onChange: next => changes.push(next) });
    const $ = selector => container.querySelector(selector);
    assert.equal($('#story_director_map_north').value, 'down');
    assert.equal($('#story_director_map_east').value, 'right');
    assert.equal($('#story_director_map_scale').value, '10');
    assert.equal($('#story_director_map_factor').value, '1.25');
    assert.ok($('.story-suite-fold[data-fold="pack"] #story_director_map_scale'), 'in Map & travel');
    assert.equal($('#story_director_map_scale').closest('.story-suite-number').querySelector('small').textContent, 'km per unit');

    const north = $('#story_director_map_north');
    north.value = 'up';
    north.dispatch('change');
    assert.equal(changes.at(-1).map.north, 'up');
    const scale = $('#story_director_map_scale');
    scale.value = '2.5';
    scale.dispatch('change');
    assert.equal(changes.at(-1).map.kmPerUnit, 2.5);
    const factor = $('#story_director_map_factor');
    factor.value = '9';
    factor.dispatch('change');
    assert.equal(changes.at(-1).map.roadFactor, 3, 'clamped');
    assert.equal(factor.value, '3');
    factor.value = 'abc';
    factor.dispatch('change');
    assert.equal(factor.value, '3', 'not a number keeps the old value');
});

test('source of truth: a select per shared area, Automatic by default, kept with the rest', () => {
    const { $, container, changes, settings, before } = setup();
    const ids = ['calendar', 'timeline', 'npc'].map(area => `#story_director_source_${area}`);
    for (const id of ids) {
        const choice = $(id);
        assert.ok(choice, `${id} exists`);
        assert.ok(choice.closest('.story-suite-fold[data-fold="chat"]'), `${id} sits under compatibility`);
        assert.equal(choice.value, 'auto');
        assert.deepEqual(choice.querySelectorAll('option').map(option => [option.value, option.textContent]),
            [['auto', 'Automatic'], ['mine', 'This extension'], ['theirs', 'The other one']]);
    }
    const heads = container.querySelectorAll('.story-suite-subhead').map(node => node.textContent);
    assert.ok(heads.includes('Source of truth'));
    assert.ok($('.story-director-suite-note').classList.contains('story-suite-muted'));
    assert.match($('.story-director-suite-note').textContent, /No other story extension is here/);

    edit($('#story_director_source_calendar'), 'theirs');
    edit($('#story_director_source_timeline'), 'mine');
    assert.deepEqual(last(changes).sourceOfTruth, { calendar: 'theirs', timeline: 'mine', npc: 'auto' });
    assert.equal(last(changes).depth, 1, 'the rest is carried along');
    assert.deepEqual(settings, before, 'input untouched');

    // A stored choice is shown; an unknown one reads as Automatic.
    const stored = setup({ settings: { ...structuredClone(SETTINGS), sourceOfTruth: { npc: 'theirs', calendar: 'bogus' } } });
    assert.equal(stored.$('#story_director_source_npc').value, 'theirs');
    assert.equal(stored.$('#story_director_source_calendar').value, 'auto');
    assert.equal(stored.$('#story_director_source_timeline').value, 'auto');
});

test('setOthers names the other story extensions without redrawing the panel', () => {
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const panel = renderSettings(container, { settings: SETTINGS, others: ['NPC State Delta'], onChange() {} });
    const note = container.querySelector('.story-director-suite-note');
    assert.match(note.textContent, /^Also here: NPC State Delta\./);
    const npc = container.querySelector('#story_director_source_npc');
    panel.setOthers(['NPC State Delta', 'RPG Battle']);
    assert.equal(container.querySelector('#story_director_source_npc'), npc, 'same controls');
    assert.match(note.textContent, /^Also here: NPC State Delta, RPG Battle\./);
    panel.setOthers([]);
    assert.match(note.textContent, /every choice works like Automatic/);
    // A redraw keeps the latest names.
    panel.setOthers(['Story Block']);
    panel.update(SETTINGS);
    assert.match(container.querySelector('.story-director-suite-note').textContent, /Also here: Story Block/);
});

test('the mirror hint says what it is for, without claiming NPC State Delta reads it', () => {
    const { $ } = setup();
    const text = $('#story_director_mirror').closest('.story-suite-row').textContent;
    assert.match(text, /Off-Screen list/);
    assert.ok(!text.includes('NPC State Delta'));
});

test('setSource and setEnabled show a change made elsewhere, keep it for the next edit, and emit nothing', () => {
    const { $, panel, changes } = setup();
    const npc = $('#story_director_source_npc');
    panel.setSource('npc', 'theirs');
    panel.setEnabled(false);
    assert.equal($('#story_director_source_npc'), npc, 'same control, not redrawn');
    assert.equal(npc.value, 'theirs');
    assert.equal($('#story_director_enabled').checked, false);
    assert.equal(changes.length, 0, 'no onChange');

    // Unknown areas and choices are ignored.
    panel.setSource('stats', 'mine');
    panel.setSource('calendar', 'bogus');
    assert.equal($('#story_director_source_calendar').value, 'auto');

    // The next edit in the panel carries both, so it never writes the old values back.
    edit($('#story_director_depth'), '3');
    assert.deepEqual(last(changes).sourceOfTruth, { calendar: 'auto', timeline: 'auto', npc: 'theirs' });
    assert.equal(last(changes).enabled, false);
    assert.equal(last(changes).depth, 3);
});

test('Story Suite overlay: manage.setSource and setEnabled update the panel they were given', async () => {
    const { makeManage } = await import('../src/manage.js');
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    let saved = structuredClone(SETTINGS);
    const save = next => { saved = next; };
    const panel = renderSettings(container, { settings: saved, onChange: save });
    const manage = makeManage({ areas: ['calendar', 'timeline', 'npc'], read: () => saved, save, panel: () => panel });
    assert.equal(manage.setSource('calendar', 'theirs'), true);
    assert.equal(container.querySelector('#story_director_source_calendar').value, 'theirs');
    assert.equal(saved.sourceOfTruth.calendar, 'theirs');
    manage.setEnabled(false);
    assert.equal(container.querySelector('#story_director_enabled').checked, false);
    assert.equal(saved.enabled, false);
    assert.equal(manage.setSource('calendar', 'nope'), false);
    assert.equal(container.querySelector('#story_director_source_calendar').value, 'theirs');
    // And the panel's own switch is read back the same way.
    const enabled = container.querySelector('#story_director_enabled');
    enabled.checked = true;
    enabled.dispatch('change');
    assert.equal(manage.enabled(), true);
    assert.deepEqual(manage.sources(), { calendar: 'theirs', timeline: 'auto', npc: 'auto' });
});

test('"Manage all in Story Suite": on top, hidden until available, opens the overlay', () => {
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    let opened = 0;
    const panel = renderSettings(container, { settings: SETTINGS, onChange() {}, onOpenSuite: () => { opened += 1; } });
    const line = container.querySelector('.story-suite-manage');
    assert.ok(line, 'drawn');
    assert.ok(line.hasAttribute('data-story-suite-link'), 'marked for the overlay to hide');
    assert.equal(container.querySelector('[data-story-suite-link]'), line);
    assert.equal(container.querySelector('.inline-drawer-content').children[0], line, 'first in the panel');
    assert.ok(line.hasAttribute('hidden'), 'hidden by default (alone)');
    assert.match(line.textContent, /Manage all in Story Suite/);
    assert.ok(line.querySelector('button.menu_button > i.fa-solid.fa-layer-group'));

    panel.setSuiteLink(true);
    assert.ok(!line.hasAttribute('hidden'));
    line.querySelector('.story-director-open-suite').click();
    assert.equal(opened, 1);
    panel.update(SETTINGS);
    assert.equal(container.querySelector('.story-suite-manage'), line, 'a redraw keeps it');
    assert.ok(!line.hasAttribute('hidden'));
    panel.setSuiteLink(false);
    assert.ok(line.hasAttribute('hidden'));

    const shown = doc.createElement('div');
    doc.body.appendChild(shown);
    renderSettings(shown, { settings: SETTINGS, onChange() {}, suiteLink: true });
    assert.ok(!shown.querySelector('.story-suite-manage').hasAttribute('hidden'), 'shown from the start when available');
});
