// B-c1-3 (live beta cell 1, desk and phone): each day on the Days screen (now the World screen's Journal) read its date twice,
// "CY 611, Goldwane 12 CY 611, Goldwane 12: took on Granary Rats; …": the head shows `d.date` and then
// `d.line`, and the line (made for the [Yesterday] tail) starts with the same date.
// Drop into Story_director/tests/v2/break/. Run: node --test tests/v2/break/c1-days-date-twice.test.js
import test from 'node:test';
import assert from 'node:assert/strict';

import { WORLD_ID, worldScreen } from '../../../src/v2/world/index.js';
import { compileTemplate, renderTemplate } from '../../vendor/story-block/src/v2/view/template/index.js';
import { conditionEvaluator } from '../../vendor/story-block/src/v2/view/bind.js';
import { compile, evaluate } from '../../vendor/story-block/src/v2/events/index.js';
import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { fakeFightRunner } from '../integration/helpers/fake-fight-runner.js';
import { installFakeDom } from '../../ui-fake-dom.js';

const squash = text => String(text ?? '').replace(/\s+/g, ' ').trim();
const reply = (text, lines = []) => (lines.length ? `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);

test('a day in the Journal (the Days screen before) shows its date once in its folded head', async () => {
    let host = null;
    const module = createModule({ host: { settings: id => host?.sdk.settings(id) ?? null, substitute: text => host?.sdk.substitute(text) } });
    host = await createHost({ modules: [fakeFightRunner(), module] });
    await host.send('Start.', reply('Harrow.', ['~ time June 3, 1200, 08:00 am', '~ place Harrow', '+ coin 40']));
    await host.send('Weir.', reply('The weir.', ['~ time June 4, 1200, 08:00 am', '~ place Old Weir']));
    await host.send('On.', reply('On.'));
    const board = host.sdk.query('director.journal');
    host.close();
    assert.ok(board.days.length >= 1, 'a day was written');

    const doc = installFakeDom();
    doc.head = doc.createElement('head');
    const el = doc.createElement('div');
    el.setAttribute('data-ss-screen', WORLD_ID);
    doc.body.appendChild(el);
    const compiled = compileTemplate(worldScreen.template);
    renderTemplate(el, compiled, { state: {}, q: { world: null, journal: board }, draft: { view: 'journal' }, settings: {}, mount: 'tab', screenId: WORLD_ID, api: {} }, {
        evaluate: conditionEvaluator({ compile, evaluate }), widgets: {}, onWarn: () => {},
    });
    const head = squash(el.querySelectorAll('.wv-head').at(-1).textContent);
    const date = board.days.at(-1).date;
    const times = head.split(date).length - 1;
    assert.equal(times, 1, `the head reads "${head}"`);
});
