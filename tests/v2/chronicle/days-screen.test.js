// Chronicle part: the Days screen, checked by Story Block's screen validator and drawn by its template
// renderer (vendored in tests/vendor/story-block) with the real condition language: newest day first,
// each folded to its line and opening to its facts; the search box keeps the days that hold what was
// typed; an older day shows its line only; with no day yet, one plain sentence.

import test from 'node:test';
import assert from 'node:assert/strict';

import { DAYS_ID, daysScreen } from '../../../src/v2/chronicle/days-screen.js';
import { DIGEST_FEATURE } from '../../../src/v2/chronicle/days.js';
import { part } from '../../../src/v2/chronicle/index.js';
import { validateScreen } from '../../vendor/story-block/src/v2/view/screens.js';
import { compileTemplate, renderTemplate } from '../../vendor/story-block/src/v2/view/template/index.js';
import { conditionEvaluator } from '../../vendor/story-block/src/v2/view/bind.js';
import { compile, evaluate } from '../../vendor/story-block/src/v2/events/index.js';
import { scopeCss } from '../../vendor/story-block/src/v2/view/css.js';
import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { fakeRpgBattle } from '../integration/helpers/fake-rpg.js';
import { installFakeDom } from '../../ui-fake-dom.js';

const squash = text => String(text ?? '').replace(/\s+/g, ' ').trim();
const reply = (text, lines = []) => (lines.length ? `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);

async function threeDays() {
    let host = null;
    const module = createModule({ host: { settings: id => host?.sdk.settings(id) ?? null, substitute: text => host?.sdk.substitute(text) } });
    host = await createHost({ modules: [fakeRpgBattle(), module], settings: { modules: { 'story-director': { 'chronicle.digestDays': 2 } } } });
    await host.send('Start.', reply('Harrow.', ['~ time June 3, 1200, 08:00 am', '~ place Harrow', '+ coin 40', '+ item Rope']));
    await host.send('Weir.', reply('The weir.', ['~ time June 4, 1200, 08:00 am', '~ place Old Weir', '+ world Red Plague — coughing in the docks']));
    await host.send('Fort.', reply('The fort.', ['~ time June 5, 1200, 08:00 am', '~ place Ridge Fort', '- coin 5']));
    await host.send('Rest.', reply('Rest.', ['~ time June 6, 1200, 08:00 am']));
    // June 5 is written before this reply.
    await host.send('On.', reply('On.'));
    const board = host.sdk.query('chronicle.dayBoard');
    host.close();
    return board;
}

function draw(board) {
    const doc = installFakeDom();
    doc.head = doc.createElement('head');
    const el = doc.createElement('div');
    el.setAttribute('data-ss-screen', DAYS_ID);
    doc.body.appendChild(el);
    const compiled = compileTemplate(daysScreen.template);
    const warnings = [...compiled.warnings];
    const draft = {};
    const scopeOf = () => ({ state: {}, q: { board }, draft, settings: {}, mount: 'tab', screenId: DAYS_ID, api: {} });
    const view = renderTemplate(el, compiled, scopeOf(), {
        evaluate: conditionEvaluator({ compile, evaluate }),
        widgets: {},
        onWarn: message => warnings.push(message),
    });
    return { el, view, warnings, find: text => { draft.find = text; view.update(scopeOf()); } };
}

test('the Days screen is a valid definition for the tab and the full screen, under the digest feature', () => {
    assert.ok(part.screens.includes(daysScreen));
    assert.equal(DAYS_ID, 'story-director/days');
    assert.equal(daysScreen.feature, DIGEST_FEATURE);
    assert.deepEqual([...daysScreen.mounts], ['tab', 'screen']);
    assert.deepEqual(validateScreen(daysScreen), []);
    for (const binding of Object.values(daysScreen.data)) assert.ok(Object.hasOwn(part.queries, binding.query));
    assert.deepEqual(scopeCss(daysScreen.css, DAYS_ID).warnings, []);
});

test('drawn: newest day first, each folded to its line; an older day keeps its line only; no warnings', async () => {
    const board = await threeDays();
    const { el, warnings } = draw(board);
    assert.deepEqual(warnings, []);
    const days = el.querySelectorAll('.dy-day');
    assert.deepEqual(days.map(node => node.querySelector('.dy-date').textContent), ['June 5, 1200', 'June 4, 1200', 'June 3, 1200']);
    assert.equal(squash(days[0].querySelector('.dy-line').textContent), 'June 5, 1200: to Ridge Fort; 5 gold out.');
    assert.equal(days[0].querySelector('details').hasAttribute('open'), false, 'folded');
    assert.match(squash(days[0].textContent), /Went to: Ridge Fort ?Money: 5 gold out/);
    assert.match(squash(days[1].textContent), /The wider world ?World: Red Plague is now ongoing — coughing in the docks/);
    // June 3 is past the two whole days: its line only.
    assert.equal(days[2].getAttribute('data-brief'), 'true');
    assert.match(squash(days[2].textContent), /June 3, 1200: to Harrow; 40 gold in\. Only this line is kept for an older day\./);
    assert.equal(days[2].querySelectorAll('.dy-facts li').length, 0);
});

test('the search box keeps the days that hold what was typed, any case; empty shows them all', async () => {
    const { el, find } = draw(await threeDays());
    const shown = () => el.querySelectorAll('.dy-day').map(node => node.querySelector('.dy-date').textContent);
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
    const { el, warnings } = draw({ days: [], hasDays: false, count: 0, today: '' });
    assert.deepEqual(warnings, []);
    assert.match(squash(el.textContent), /^No story day has ended yet\./);
    assert.equal(el.querySelectorAll('input').length, 0);
});
