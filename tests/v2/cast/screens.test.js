// The cast on the reader's screens: the reply's card (paths crossed with the reason, the cast moved on, the pack updated) in its body and
// closed line; World -> Now's "Around here"; Settings -> Modules -> Story Director -> The cast. Drawn by Story Block's template renderer.
import test from 'node:test';
import assert from 'node:assert/strict';

import { worldScreen } from '../../../src/v2/world/index.js';
import { STATUS_SUMMARY, statusCardScreen } from '../../../src/v2/screens/status-card.js';
import { conditionEvaluator } from '../../vendor/story-block/src/v2/view/bind.js';
import { compile, evaluate } from '../../vendor/story-block/src/v2/events/index.js';
import { compileTemplate, renderTemplate } from '../../vendor/story-block/src/v2/view/template/index.js';
import { installFakeDom } from '../../ui-fake-dom.js';
import { OPENING, castHost, castSource, createFakeModel, entry, said, settle } from './helpers.js';

const squash = text => String(text ?? '').replace(/\s+/g, ' ').trim();

function draw(template, data, widgets = {}) {
    const doc = installFakeDom();
    doc.head = doc.createElement('head');
    const el = doc.createElement('div');
    doc.body.appendChild(el);
    const compiled = compileTemplate(template);
    const warnings = [...compiled.warnings];
    renderTemplate(el, compiled, data, { evaluate: conditionEvaluator({ compile, evaluate }), widgets, onWarn: message => warnings.push(message) });
    return { el, warnings };
}

// ---- the reply's card ---------------------------------------------------------------------------------------------------------------

const notes = {
    cn_00000001: { at: 4, kind: 'met', head: 'Paths crossed: Fenna', tag: 'Ersveil cast · first meeting', rest: 'Why: Fenna works the night ferry at Bluewatch docks, and you are there: your first time here while they are. No roll.', line: 'Paths crossed: Fenna', rev: 5 },
    cn_00000002: { at: 4, kind: 'moved', head: 'While time passed', tag: '3 days', rest: '9 cast members moved on off-screen (one short line each, only where something changed). You have not met them, so who and where stays hidden.', line: 'The cast moved on', rev: 5 },
    cn_00000003: { at: 2, kind: 'updated', head: 'Ersveil pack updated', tag: '1.1.0 → 1.2.0', rest: '2 new people now live in the world from today, hidden until you meet them.', line: 'Ersveil pack updated: 2 new people now live in the world', rev: 2 },
};
const cardState = domains => ({ v: 2, meta: { rev: 9, claims: {} }, domains: { director: { time: { minutes: 1 } }, scene: { place: { name: '' } }, ...domains } });
const cardData = (state, index) => ({ state, index, q: { status: { summary: '7:40 pm, Bluewatch docks' }, time: { text: 'June 3, 1200, 07:40 pm' } }, changes: [], settings: {}, mount: 'card', screenId: 'story-director/status-card', api: {} });

test('the status card: the cast lines for this reply lead its body and its closed line; another reply\'s are not shown; none, nothing; an older chat with no cast draws as it did', () => {
    const state = cardState({ cast: { people: {}, notes, day: null, meeting: null } });
    const { el, warnings } = draw(statusCardScreen.template, cardData(state, 4));
    assert.deepEqual(warnings, []);
    const cards = el.querySelectorAll('.sd-castnote');
    assert.deepEqual(cards.map(card => card.getAttribute('data-kind')), ['met', 'moved']);
    const parts = card => [...card.querySelector('.sd-castnote-head').children, card.querySelector('.sd-castnote-body > small')].map(node => squash(node.textContent));
    assert.deepEqual(parts(cards[0]), ['Paths crossed: Fenna', 'Ersveil cast · first meeting', 'Why: Fenna works the night ferry at Bluewatch docks, and you are there: your first time here while they are. No roll.']);
    assert.deepEqual(parts(cards[1]).slice(0, 2), ['While time passed', '3 days']);
    assert.match(parts(cards[1])[2], /^9 cast members moved on off-screen/);
    assert.equal(cards[0].querySelectorAll('i').length, 1, 'one icon each');
    assert.equal(squash(draw(STATUS_SUMMARY, cardData(state, 4)).el.textContent), 'Paths crossed: Fenna · The cast moved on · 7:40 pm, Bluewatch docks');
    assert.equal(squash(draw(STATUS_SUMMARY, cardData(state, 2)).el.textContent), 'Ersveil pack updated: 2 new people now live in the world · 7:40 pm, Bluewatch docks');
    // Another reply's card: no cast cards, the summary as it was.
    assert.equal(draw(statusCardScreen.template, cardData(state, 3)).el.querySelectorAll('.sd-castnote').length, 0);
    assert.equal(squash(draw(STATUS_SUMMARY, cardData(state, 3)).el.textContent), '7:40 pm, Bluewatch docks');
    const old = draw(statusCardScreen.template, cardData(cardState({}), 4));
    assert.deepEqual(old.warnings, []);
    assert.equal(old.el.querySelectorAll('.sd-castnote').length, 0);
    assert.equal(squash(draw(STATUS_SUMMARY, cardData(cardState({}), 4)).el.textContent), '7:40 pm, Bluewatch docks');
});

test('on the host: the note is for the reply they come in (its card, not the one before), whichever way that reply was written; the state agrees after a rebuild', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await castHost({ source: castSource([entry('brom', { start: { place: 'Harrow', goal: 'forge', routine: '' } })]) });
    try {
        await host.send('Hello.', said('Dawn.', OPENING));
        await host.send('Look.', said('Smoke.'));
        const replyIndex = host.ctx.chat.length - 1;
        const noteAt = () => Object.values(host.head().domains.cast.notes).map(note => note.at);
        assert.deepEqual(noteAt(), [replyIndex], 'under the reply they came in');
        // The step itself is stored on the reply before (the head when the hook ran): a card reads the note\'s `at`, not where it is stored.
        assert.ok((host.store.at(replyIndex - 2)?.ops ?? host.ctx.chat[replyIndex - 2].extra.storySuite.ops).some(op => String(op.path).startsWith('/domains/cast/notes/')));
        await host.swipe(said('Smoke, another way.'));
        assert.deepEqual(noteAt(), [replyIndex], 'a swipe of that reply: still under it');
        const live = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live);
    } finally {
        host.close();
    }
});

// ---- World -> Now -> Around here -------------------------------------------------------------------------------------------------------

const world = { today: '', here: { place: null, moved: false, weather: '', hasPeople: false, people: [], chatter: [], nsd: false }, clockSet: true, upcomingDays: 30, hasUpcoming: false, upcoming: [], news: [], hasNews: false, factions: [], hasFactions: false };
const drawWorld = cast => draw(worldScreen.template, { state: {}, q: { world, journal: { on: false, hasDays: false, days: [] }, threads: { on: true }, keys: null, cast }, draft: { view: 'now' }, settings: {}, mount: 'tab', screenId: 'story-director/world', api: {} });
const VIEW = { on: true, total: 14, met: 3, near: 2, hasNear: true, heading: 'Bluewatch docks · evening', place: 'Bluewatch docks', day: 'evening', dayText: '· evening', packLabel: 'Ersveil cast', hasMet: true, metList: [{ key: 'ersveil:fenna', name: 'Fenna', news: 'upriver at Ashford' }], note: 'Unmet cast stays hidden.' };

test('World -> Now: "Around here" under Here: how many may cross your path here (only when some are), who you met and their news, "Met n of N" always; gone with no cast', () => {
    const { el, warnings } = drawWorld(VIEW);
    assert.deepEqual(warnings, []);
    const section = el.querySelector('.wv-around');
    assert.ok(section);
    assert.equal(squash(section.querySelector('h4').textContent), 'Around here Bluewatch docks · evening');
    const rows = root => root.querySelectorAll('.wv-row').map(row => [...row.children].map(node => squash(node.textContent)));
    assert.deepEqual(rows(section), [
        ['Cast whose paths may cross yours here', '2, not yet met'],
        ['Cast you have met', 'Fenna, last heard: upriver at Ashford'],
        ['Met from the Ersveil cast', '3 of 14'],
    ]);
    assert.equal(squash(section.querySelector('.wv-note').textContent), 'Unmet cast stays hidden.');
    assert.deepEqual(el.querySelectorAll('section').map(node => node.getAttribute('data-kind')).slice(0, 3), ['here', 'around', 'upcoming']);
    const far = drawWorld({ ...VIEW, near: 0, hasNear: false, hasMet: false, metList: [], met: 0, heading: '', place: '', day: '', dayText: '' });
    assert.deepEqual(rows(far.el.querySelector('.wv-around')), [['Met from the Ersveil cast', '0 of 14']]);
    assert.equal(squash(far.el.querySelector('.wv-around h4').textContent), 'Around here');
    const off = drawWorld(null);
    assert.equal(off.el.querySelector('.wv-around'), null);
    assert.deepEqual(off.warnings, []);
});

test('on the host: the screen\'s data is the view; unmet cast is counted, never named', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await castHost({
        source: castSource([entry('brom', { start: { place: 'Harrow', goal: 'forge', routine: '' } }), entry('fenna', { start: { place: 'Harrow', goal: 'f', routine: 'works the night ferry' } }), entry('sera', { start: { place: 'Gwenmar', goal: 's', routine: '' } })]),
        model: createFakeModel(['~ cast brom | Ashford | upriver for the guild']),
    });
    try {
        await host.send('Hello.', said('Dawn.', OPENING));
        await host.send('Look.', said('Smoke.'));
        await host.send('Sleep.', said('Morning.', ['~ time June 4, 1200, 08:00 am']));
        await settle();
        await host.send('Look.', said('Smoke.'));
        const view = host.sdk.query('director.cast.view');
        const drawn = drawWorld(view);
        assert.deepEqual(drawn.warnings, []);
        const text = squash(drawn.el.querySelector('.wv-around').textContent);
        assert.match(text, /Cast you have metBrom, last heard: upriver for the guild/);
        assert.match(text, /Met from the Ersveil cast1 of 3/);
        assert.doesNotMatch(text, /Fenna|Sera/);
    } finally {
        host.close();
    }
});

// ---- Settings ---------------------------------------------------------------------------------------------------------------------------

test('Settings -> Modules -> Story Director -> The cast: on/off, new faces at most, unmet can die, the planner connection; in a fold of their own, shown while the feature is on', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await castHost();
    try {
        const defs = host.registry.settingsDefs().find(def => def.moduleId === 'story-director');
        const field = key => defs.schema[`cast.${key}`];
        assert.deepEqual(['on', 'faces', 'unmetDie', 'profile'].map(key => [field(key).type, field(key).label, field(key).group, field(key).feature]), [
            ['bool', 'The pack\'s cast lives off-screen', 'The cast', 'story-director.cast'],
            ['choice', 'New faces at most', 'The cast', 'story-director.cast'],
            ['bool', 'Unmet cast can die off-screen', 'The cast', 'story-director.cast'],
            ['profile', 'Planner connection', 'The cast', 'story-director.cast'],
        ]);
        assert.equal(field('faces').form, 'segmented', 'compact pills (the host\'s segmented choice), as in the mockup');
        assert.deepEqual(field('faces').options, [{ value: 'day1', label: '1 a day' }, { value: 'day2', label: '2 a day' }, { value: 'week1', label: '1 a week' }]);
        assert.match(field('faces').help, /Never during a fight\.$/);
        assert.match(field('unmetDie').help, /^Off: before you meet them they can be hurt, lose things or move, but not die\./);
        assert.deepEqual([defs.defaults['cast.on'], defs.defaults['cast.faces'], defs.defaults['cast.unmetDie'], defs.defaults['cast.profile']], [true, 'day1', false, '']);
        const feature = host.sdk.features().find(item => item.id === 'story-director.cast');
        assert.deepEqual([feature.label, feature.on], ['The cast', true]);
    } finally {
        host.close();
    }
});
