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
    assert.ok($('.inline-drawer-content'));
    const status = $('#story_director_status');
    assert.equal(status.textContent, 'Tracking 4 records.');
    assert.equal(container.querySelectorAll('#story_director_status').length, 1);
    const groups = container.querySelectorAll('.story-director-group-summary b').map(node => node.textContent);
    assert.deepEqual(groups, ['Tracking & note', 'Calendar', 'Map & travel', 'Arc planning', 'Capture', 'Existing chat & compatibility']);
});

test('a quick bar on top, folding groups below, only Tracking open at first', () => {
    const planned = [];
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    renderSettings(container, { settings: SETTINGS, version: 'v0.5.1', onPlanArc: () => planned.push(1), onChange() {} });
    assert.match(container.querySelector('.inline-drawer-header b').textContent, /Story Director v0\.5\.1/);
    const quickbar = container.querySelector('.story-director-quickbar');
    assert.ok(quickbar.querySelector('#story_director_enabled'), 'the switch is in the quick bar');
    quickbar.querySelector('.story-director-plan').click();
    assert.deepEqual(planned, [1]);
    assert.ok(quickbar.querySelector('.story-director-seed'));
    const open = container.querySelectorAll('.story-director-group').filter(node => node.hasAttribute('open')).map(node => node.getAttribute('data-group'));
    assert.deepEqual(open, ['tracking']);
    assert.ok(container.querySelector('.story-director-group[data-group="arc"] #story_director_arc_trigger'), 'arc controls live in their group');
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
    const row = $('#story_director_months').closest('.story-director-row');
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
        assert.ok(input.closest('.story-director-switch.checkbox_label'));
    }
    const mirror = $('#story_director_mirror');
    mirror.checked = false;
    mirror.dispatch('change');
    assert.equal(last(changes).mirrorOffscreen, false);
    mirror.checked = true;
    mirror.dispatch('change');
    assert.equal(last(changes).mirrorOffscreen, true);
    assert.equal(last(changes).enabled, true);
    assert.ok(mirror.closest('.story-director-row').textContent.includes('Mirror off-screen agendas'));
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
    const map = () => container.querySelector('.story-director-row.is-pack');
    assert.match(map().textContent, /Roads.*None/);
    assert.equal(container.querySelector('.story-director-pack-clear').disabled, true, 'nothing to clear');

    container.querySelector('.story-director-pack-paste').value = '{"places":{}}';
    container.querySelector('.story-director-pack-import').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(imported, ['{"places":{}}']);
    assert.match(map().textContent, /19 places · 23 routes/);
    assert.equal(container.querySelector('.story-director-pack-message').textContent, 'Imported.');

    container.querySelector('.story-director-pack-clear').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(cleared, 1);
    assert.match(map().textContent, /Roads.*None/);
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
    const guard = container.querySelector('.story-director-quickbar input#story_director_spoiler');
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
    assert.ok($('.story-director-group[data-group="pack"] #story_director_map_scale'), 'in Map & travel');

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
