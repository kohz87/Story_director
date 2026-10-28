// The calendar's months as text (Story Block's list text form): the schema field says `form: 'lines'`, so
// Story Block's settings show a textarea with one "Name: Days" a line; any number of months is typed there
// (a fantasy calendar of 13), the chat's calendar uses them, and a month of 0, negative or no days is
// refused with the line named, the months kept. An older Story Block ignores `form` and shows rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../../ui-fake-dom.js';
import { createHost } from '../../vendor/story-block/testkit/index.js';
import { renderSettingsHost } from '../../vendor/story-block/src/v2/host-ui.js';
import { createModule, MODULE_ID } from '../../../src/v2/module.js';
import { part as trackerPart } from '../../../src/v2/tracker/index.js';

const doc = installFakeDom();
const KEY = 'tracker.calendar.months';
const reply = (text, lines = []) => (lines.length ? `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);
const THIRTEEN = ['Frostmoon', 'Snowfall', 'Thaw', 'Seedtime', 'Rains', 'Bloom', 'Highsun', 'Harvest', 'Leaffall', 'Mists', 'Embers', 'Longnight', 'Day of Ash'];

test('the months field asks for the text form; the other calendar fields are as they were', () => {
    const fields = trackerPart.settings.schema.calendar.fields;
    assert.equal(fields.months.form, 'lines');
    assert.equal(fields.months.type, 'list');
    assert.equal(fields.week.type, 'text', 'weekdays stay one comma-separated text field');
});

test('Story Block\'s settings show the months one per line; 13 typed months are the chat\'s calendar; 0, negative or no days are refused', async () => {
    // Alone: no example fight runner, no other module (WAVE rule 11).
    // Queries read the settings through Story Block's live sdk; the testkit host stands in for it (as wiring.test.js).
    let host = null;
    const module = createModule({ host: { settings: id => host?.sdk.settings(id) ?? null, substitute: text => host?.sdk.substitute(text) } });
    host = await createHost({ modules: [module], settings: { modules: { [MODULE_ID]: { 'tracker.calendar.preset': 'custom' } } } });
    const root = doc.createElement('div');
    doc.body.appendChild(root);
    renderSettingsHost(root, { registry: host.registry, settings: host.settings, doc });
    const list = () => root.querySelector(`.story-suite-row[data-field="${KEY}"] .story-suite-list`);
    const area = () => list().querySelector('textarea');
    assert.equal(list().dataset.form, 'lines');
    assert.equal(area().value.split('\n').length, host.settings(MODULE_ID)[KEY].length, 'one line per stored month');
    area().value = THIRTEEN.map((name, at) => `${name}: ${at === 12 ? 1 : 28}`).join('\n');
    area().dispatch('change');
    const months = host.settings(MODULE_ID)[KEY];
    assert.equal(months.length, 13);
    assert.deepEqual(months.at(-1), { name: 'Day of Ash', days: 1 });
    // The chat's calendar is those 13 months: a date in the 13th reads back.
    await host.send('Morning.', reply('The last day of the year.', ['~ time Day of Ash 1, 9:00 am']));
    assert.match(host.sdk.query('director.time').text, /Day of Ash 1/);
    // Refused: the line named, the 13 months kept.
    for (const [text, why] of [['Frostmoon: 30\nThaw: 0', /Line 2 \("Thaw: 0"\): Days must be at least 1\./], ['Frostmoon: -2', /Line 1 .*at least 1/], ['Frostmoon: lots', /Line 1 .*not a whole number/], ['Frostmoon', /Line 1 .*needs Name: Days/]]) {
        area().value = text;
        area().dispatch('change');
        assert.match(list().querySelector('.story-suite-list-error').textContent, why, text);
        assert.equal(host.settings(MODULE_ID)[KEY].length, 13, text);
    }
    root.remove();
    host.close();
});
