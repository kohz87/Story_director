// Key people, item 4 (the screens): World → Now's "Key people · n of cap" section (rows: star, name, Away · back <date> or Here, what they are
// doing, the last step, Unpin; "+ Pin" with the people known to the story; the note with the token use), the per-reply status card's
// "<name> is back" / "no longer a key person" lines in its body and its closed summary, and the settings (the two numbers, with their
// words). On a real host for the data, and drawn by Story Block's template renderer.
import test from 'node:test';
import assert from 'node:assert/strict';

import { worldScreen } from '../../../src/v2/world/index.js';
import { STATUS_SUMMARY, statusCardScreen } from '../../../src/v2/screens/status-card.js';
import { KEY_PEOPLE_WIDGET, keyPeopleWidget } from '../../../src/v2/keypeople/widget.js';
import { conditionEvaluator } from '../../vendor/story-block/src/v2/view/bind.js';
import { compile, evaluate } from '../../vendor/story-block/src/v2/events/index.js';
import { compileTemplate, renderTemplate } from '../../vendor/story-block/src/v2/view/template/index.js';
import { installFakeDom } from '../../ui-fake-dom.js';
import { OPENING, keyHost, pin, said } from './helpers.js';

const squash = text => String(text ?? '').replace(/\s+/g, ' ').trim();

// ---- the data the section draws ----------------------------------------------------------------------------------------------

test('the view: a row for each pinned person (Away · back, Here, Not here), what they do, the last news; the Pin chooser lists who the story knows; the note counts tokens', async () => {
    const host = await keyHost({ delta: { Fenna: { role: 'ferrywoman' }, Brom: { role: 'smith', aliases: ['the smith'] } } });
    try {
        await host.send('Hello.', said('Dawn.', [...OPENING, '+ present Fenna', '+ present Kell', '+ hook Wolf Contract — wolves | giver: Odda | people: Hesk, Odda', '+ agenda Secret Plot — hidden | now: the docks | giver: Veil']));
        for (const name of ['Ren', 'Fenna']) await pin(host, name);
        await pin(host, 'Odda');
        await host.send('Go.', said('Ren leaves.', ['+ away Ren — scouting the north road | back: June 9, 1200', '! away Ren — reached Wolfmere Outpost']));
        const view = host.sdk.query('director.keyPeople.view');
        assert.equal(view.on, true);
        assert.deepEqual([view.cap, view.count, view.full, view.hasPeople, view.budget], [10, 3, false, true, 300]);
        assert.deepEqual(view.people.map(person => [person.name, person.status, person.here, person.away, person.doing, person.last]), [
            ['Ren', 'Away · back June 9', false, true, 'scouting the north road', 'Last news June 3: reached Wolfmere Outpost'],
            ['Fenna', 'Here', true, false, 'ferrywoman', ''],
            ['Odda', 'Not here', false, false, '', ''],
        ]);
        // The chooser: the people the scene lists, those the threads {{user}} knows of name (never the agenda's), those Delta tracks; not the pinned.
        assert.deepEqual(view.choices.map(choice => [choice.name, choice.source]), [['Kell', 'here'], ['Hesk', 'thread'], ['Brom', 'npc']]);
        assert.deepEqual(view.choices.find(choice => choice.name === 'Brom'), { name: 'Brom', aliases: ['the smith'], source: 'npc', nsd: true });
        assert.ok(!JSON.stringify(view).includes('Veil'), 'what is behind the scenes is never offered');
        assert.equal(view.tokens, Math.ceil(`[Key people] Away from the scene:\nRen: away, scouting the north road, back June 9; latest: reached Wolfmere Outpost.`.length / 4));
        assert.equal(view.note, `Key people who are away are told to the narrator each reply: about ${view.tokens} tokens now, of a 300-token budget. Pin someone with + Pin; their death, or archiving their dossier, unpins them.`);
        // Past the cap: full; fewer tokens than the line needs: told how many are left out.
        host.settings.set('story-director', 'keypeople.cap', 3);
        host.settings.set('story-director', 'keypeople.tokens', 8);
        const tight = host.sdk.query('director.keyPeople.view');
        assert.equal(tight.full, true);
        assert.equal(tight.tokens, 0);
        assert.equal(tight.countText, '3 of 3');
        assert.match(tight.note, /1 more is away than fit, so it is left out of a reply\./);
        // The limit lowered under the number pinned: said so, not "3 of 2"; one is a person.
        host.settings.set('story-director', 'keypeople.cap', 1);
        const low = host.sdk.query('director.keyPeople.view');
        assert.deepEqual([low.countText, low.limitText], ['3 pinned · limit 1', 'You can have 1 key person; unpin someone first.']);
        host.settings.set('story-director', 'keypeople.cap', 3);
        // Due back reads so, and is not "back <date>".
        host.settings.set('story-director', 'keypeople.tokens', 300);
        await host.send('Days.', said('Days pass.', ['! time +9d']));
        assert.equal(host.sdk.query('director.keyPeople.view').people[0].status, 'Away · due back');
    } finally {
        host.close();
    }
});

// ---- the section's widget -----------------------------------------------------------------------------------------------------

function drawWidget(value, command = null) {
    const doc = installFakeDom();
    doc.head = doc.createElement('head');
    const el = doc.createElement('div');
    doc.body.appendChild(el);
    const commands = [];
    const api = { command: async (type, payload) => { commands.push([type, payload]); return command ? command(type, payload) : { ok: true }; } };
    const handle = keyPeopleWidget.render(el, { value }, api);
    return { el, handle, commands, text: () => squash(el.textContent) };
}

const VIEW = {
    on: true, cap: 3, count: 2, countText: '2 of 3', limitText: 'You can have 3 key people; unpin someone first.', full: false, hasPeople: true,
    people: [
        { key: 'ren', name: 'Ren', here: false, away: true, due: false, status: 'Away · back June 9', doing: 'scouting the north road', last: 'Last news June 3: reached Wolfmere Outpost', back: 'June 9' },
        { key: 'fenna', name: 'Fenna', here: true, away: false, due: false, status: 'Here', doing: 'ferrywoman', last: '', back: '' },
    ],
    choices: [{ name: 'Kell', aliases: [], source: 'here', nsd: false }, { name: 'Brom', aliases: ['the smith'], source: 'npc', nsd: true }],
    tokens: 20, budget: 300, note: 'The note.',
};

test('the widget: a star, the name, the pill, what they do, the last news and Unpin for each; + Pin opens the chooser; the note under them', () => {
    const { el, text } = drawWidget(VIEW);
    const rows = el.querySelectorAll('.wv-key-row');
    assert.equal(rows.length, 2);
    const pieces = row => [...row.children].map(node => squash(node.textContent));
    assert.deepEqual(pieces(rows[0]), ['★', 'Ren Away · back June 9', 'Unpin', 'scouting the north road', 'Last news June 3: reached Wolfmere Outpost']);
    assert.deepEqual(pieces(rows[1]), ['★', 'Fenna Here', 'Unpin', 'ferrywoman']);
    assert.ok(rows[0].querySelector('.wv-key-pill').classList.contains('is-away'));
    assert.ok(rows[1].querySelector('.wv-key-pill').classList.contains('is-here'));
    assert.ok(text().endsWith('The note.'));
    assert.equal(el.querySelector('.wv-key-choose'), null, 'the chooser is closed');
    assert.ok(!el.querySelector('.wv-key-pin').disabled);
});

test('the widget: Unpin and a pick run the reader\'s commands; the chooser shows where each name comes from; a failure is said, not thrown', async () => {
    const out = drawWidget(VIEW, (type, payload) => (payload.name === 'Kell' ? { ok: false, message: 'You can have 3 key people; unpin someone first.' } : { ok: true }));
    out.el.querySelectorAll('.wv-key-unpin')[0].click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(out.commands, [['keypeople.unpin', { name: 'Ren' }]]);
    out.el.querySelector('.wv-key-pin').click();
    const picks = out.el.querySelectorAll('.wv-key-pick');
    assert.deepEqual(picks.map(node => squash(node.textContent)), ['Kell here now', 'Brom a dossier']);
    picks[1].click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(out.commands.at(-1), ['keypeople.pin', { name: 'Brom', aliases: ['the smith'], nsd: true }]);
    out.el.querySelector('.wv-key-pin').click();
    out.el.querySelectorAll('.wv-key-pick')[0].click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(out.commands.at(-1), ['keypeople.pin', { name: 'Kell' }]);
    assert.equal(squash(out.el.querySelector('[role="alert"]').textContent), 'You can have 3 key people; unpin someone first.');
});

test('the widget: nobody pinned says so, a full list disables + Pin with the reason, no one to pin is said, and text is only ever text', () => {
    const empty = drawWidget({ ...VIEW, count: 0, hasPeople: false, people: [] });
    assert.match(empty.text(), /^No one is pinned yet\./);
    assert.equal(empty.el.querySelectorAll('.wv-key-row').length, 0);
    const full = drawWidget({ ...VIEW, full: true });
    assert.equal(full.el.querySelector('.wv-key-pin').disabled, true);
    assert.match(full.el.querySelector('.wv-key-pin').getAttribute('title'), /You can have 3 key people/);
    const none = drawWidget({ ...VIEW, choices: [] });
    none.el.querySelector('.wv-key-pin').click();
    assert.match(none.text(), /No one else is known to the story yet\./);
    const odd = drawWidget({ ...VIEW, people: [{ ...VIEW.people[0], name: '<img src=x onerror=alert(1)>', doing: '<b>bold</b>' }] });
    assert.equal(odd.el.querySelectorAll('img').length, 0);
    assert.equal(odd.el.querySelectorAll('b').length, 0);
    assert.match(odd.text(), /<img src=x onerror=alert\(1\)> .*<b>bold<\/b>/);
    // A widget given nothing draws the empty list; it never throws at the reader.
    assert.doesNotThrow(() => drawWidget(null));
    assert.deepEqual(keyPeopleWidget.validate({ value: 'x' }).length, 1);
    assert.deepEqual(keyPeopleWidget.validate({ value: VIEW }), []);
});

function drawWorld(q) {
    const doc = installFakeDom();
    doc.head = doc.createElement('head');
    const el = doc.createElement('div');
    doc.body.appendChild(el);
    const compiled = compileTemplate(worldScreen.template);
    const warnings = [...compiled.warnings];
    const world = { today: '', here: { place: null, moved: false, weather: '', hasPeople: false, people: [], chatter: [], nsd: false }, clockSet: true, upcomingDays: 30, hasUpcoming: false, upcoming: [], news: [], hasNews: false, factions: [], hasFactions: false };
    renderTemplate(el, compiled, { state: {}, q: { world, journal: { on: false, hasDays: false, days: [] }, threads: { on: true }, keys: q }, draft: { view: 'now' }, settings: {}, mount: 'tab', screenId: 'story-director/world', api: {} }, {
        evaluate: conditionEvaluator({ compile, evaluate }), widgets: { [KEY_PEOPLE_WIDGET]: keyPeopleWidget }, onWarn: message => warnings.push(message),
    });
    return { el, warnings };
}

test('World → Now: the Key people section, "n of cap", between Here and Upcoming; gone while the feature is off (no data)', () => {
    const { el, warnings } = drawWorld(VIEW);
    assert.deepEqual(warnings, []);
    const section = el.querySelector('.wv-key');
    assert.ok(section);
    assert.equal(squash(section.querySelector('h4').textContent), 'Key people 2 of 3');
    assert.equal(section.querySelectorAll('.wv-key-row').length, 2);
    const order = el.querySelectorAll('section').map(node => node.getAttribute('data-kind'));
    assert.deepEqual(order.slice(0, 3), ['here', 'key', 'upcoming']);
    const off = drawWorld(null);
    assert.equal(off.el.querySelector('.wv-key'), null);
    assert.deepEqual(off.warnings, []);
});

// ---- the status card ---------------------------------------------------------------------------------------------------------

const notes = {
    kn_00000001: { sid: 'sr_1', kind: 'back', name: 'Ren', head: 'Ren is back', rest: 'from scouting the north road (key person, away June 3 – June 9).', lead: true, rev: 5 },
    kn_00000002: { sid: 'sr_1', kind: 'gone', name: 'Mara', head: 'Mara is no longer a key person', rest: '(died, June 9).', lead: false, rev: 6 },
    kn_00000003: { sid: 'sr_0', kind: 'gone', name: 'Odda', head: 'Odda is no longer a key person', rest: '(unpinned).', lead: true, rev: 2 },
};

function drawCard(template, state, changes, q = { status: { summary: '1:30 pm, Bluewatch Village' }, time: { text: 'June 9, 1200, 01:30 pm' } }) {
    const doc = installFakeDom();
    doc.head = doc.createElement('head');
    const el = doc.createElement('div');
    doc.body.appendChild(el);
    const compiled = compileTemplate(template);
    const warnings = [...compiled.warnings];
    renderTemplate(el, compiled, { state, q, changes, settings: {}, mount: 'card', screenId: 'story-director/status-card', api: {} }, { evaluate: conditionEvaluator({ compile, evaluate }), widgets: {}, onWarn: message => warnings.push(message) });
    return { el, warnings };
}

test('the status card: this reply\'s key person lines in its body and its closed summary; another reply\'s are not shown; none, nothing', () => {
    const doc = domains => ({ v: 2, meta: { rev: 9, claims: {} }, domains });
    const state = doc({ keypeople: { pins: {}, away: {}, gone: {}, notes }, director: { time: { minutes: 1 } }, scene: { place: { name: '' } } });
    const changes = ['/domains/keypeople/notes/kn_00000001', '/domains/keypeople/notes/kn_00000002'];
    const { el, warnings } = drawCard(statusCardScreen.template, state, changes);
    assert.deepEqual(warnings, []);
    const chips = el.querySelectorAll('.sd-keynote').map(chip => squash(chip.textContent));
    assert.deepEqual(chips, ['★ Ren is back from scouting the north road (key person, away June 3 – June 9).', '★ Mara is no longer a key person (died, June 9).']);
    assert.deepEqual(el.querySelectorAll('.sd-keynote').map(chip => chip.getAttribute('data-kind')), ['back', 'gone']);
    // The closed line: the changes lead, then the card's own summary.
    const line = drawCard(STATUS_SUMMARY, state, changes);
    assert.equal(squash(line.el.textContent), 'Ren is back · Mara is no longer a key person · 1:30 pm, Bluewatch Village');
    // No clock or place to add: no dangling separator, however many lines there are.
    const bare = { status: { summary: '' }, time: { text: '' } };
    assert.equal(squash(drawCard(STATUS_SUMMARY, state, changes, bare).el.textContent), 'Ren is back · Mara is no longer a key person');
    assert.equal(squash(drawCard(STATUS_SUMMARY, state, ['/domains/keypeople/notes/kn_00000001'], bare).el.textContent), 'Ren is back');
    // A reply that changed none of them: no lines, and the summary is as it was.
    const quiet = drawCard(statusCardScreen.template, state, ['/domains/director/time/minutes']);
    assert.equal(quiet.el.querySelectorAll('.sd-keynote').length, 0);
    assert.equal(squash(drawCard(STATUS_SUMMARY, state, []).el.textContent), '1:30 pm, Bluewatch Village');
    // A chat with no key people at all (an older one, or the feature never used) draws as it always did.
    const old = drawCard(statusCardScreen.template, doc({ director: { time: { minutes: 1 } }, scene: { place: { name: '' } } }), []);
    assert.deepEqual(old.warnings, []);
    assert.equal(old.el.querySelectorAll('.sd-keynote').length, 0);
    assert.equal(squash(drawCard(STATUS_SUMMARY, doc({ director: {} }), []).el.textContent), '1:30 pm, Bluewatch Village');
});

test('the status card: a removal told after its step shows only while the taken-off record it is about is there', () => {
    const doc = gone => ({ v: 2, meta: { rev: 9, claims: {} }, domains: { keypeople: { pins: {}, away: {}, gone, notes: {
        kn_00000004: { sid: 'sr_2', kind: 'gone', name: 'Mara', head: 'Mara is no longer a key person', rest: '(archived in NPC State Delta).', lead: true, rev: 8, key: 'mara', goneRev: 7 },
    } }, director: { time: { minutes: 1 } }, scene: { place: { name: '' } } } });
    const changes = ['/domains/keypeople/notes/kn_00000004'];
    const bare = { status: { summary: '' }, time: { text: '' } };
    const shown = state => [drawCard(statusCardScreen.template, state, changes).el.querySelectorAll('.sd-keynote').length, squash(drawCard(STATUS_SUMMARY, state, changes).el.textContent), squash(drawCard(STATUS_SUMMARY, state, changes, bare).el.textContent)];
    // The record is there with the rev the line names: the line, in the body and on the closed line.
    const there = doc({ mara: { name: 'Mara', reason: 'archived', on: 1, rev: 7 } });
    assert.deepEqual(shown(there), [1, 'Mara is no longer a key person · 1:30 pm, Bluewatch Village', 'Mara is no longer a key person']);
    assert.deepEqual(drawCard(statusCardScreen.template, there, changes).warnings, []);
    // The reply that made the record was deleted (no record), or she was taken off again since (another rev): nothing.
    assert.deepEqual(shown(doc({})), [0, '1:30 pm, Bluewatch Village', '']);
    assert.deepEqual(shown(doc({ mara: { name: 'Mara', reason: 'died', on: 2, rev: 12 } })), [0, '1:30 pm, Bluewatch Village', '']);
    // Not changed on this reply: nothing, whatever the record says.
    assert.equal(drawCard(statusCardScreen.template, there, ['/domains/director/time/minutes']).el.querySelectorAll('.sd-keynote').length, 0);
});

test('on the host: the lines are on the reply that did it and only that one; a return and an unpin are told, and the state agrees after a rebuild', async () => {
    const host = await keyHost();
    try {
        await host.send('Hello.', said('Dawn.', OPENING));
        await pin(host, 'Ren');
        await host.send('Go.', said('Ren leaves.', ['+ away Ren — scouting | back: June 9, 1200']));
        const home = await host.send('Home.', said('Ren is back.', ['- away Ren']));
        void home;
        const state = host.head();
        const note = Object.entries(state.domains.keypeople.notes).at(-1);
        assert.equal(note[1].head, 'Ren is back');
        // The reply's own changes name the note, an earlier reply's do not.
        const index = host.ctx.chat.length - 1;
        const ops = host.store.at(index)?.ops ?? host.ctx.chat[index].extra.storySuite.ops;
        assert.ok(ops.some(op => String(op.path).startsWith(`/domains/keypeople/notes/${note[0]}`)));
        const earlier = host.ctx.chat[index - 2].extra.storySuite.ops;
        assert.ok(!earlier.some(op => String(op.path).startsWith(`/domains/keypeople/notes/${note[0]}`)));
        const live = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live);
    } finally {
        host.close();
    }
});

// ---- the settings --------------------------------------------------------------------------------------------------------------

test('Settings → Modules → Story Director → Key people: the two numbers with their words, in a section of their own, shown while the feature is on', async () => {
    const host = await keyHost();
    try {
        const defs = host.registry.settingsDefs().find(def => def.moduleId === 'story-director');
        const cap = defs.schema['keypeople.cap'];
        const tokens = defs.schema['keypeople.tokens'];
        assert.deepEqual([cap.type, cap.label, cap.min, cap.feature], ['int', 'How many key people', 0, 'story-director.key-people']);
        assert.deepEqual([cap.group, tokens.group], ['Key people', 'Key people'], 'a fold of their own (the host groups by the field\'s group)');
        assert.equal(cap.help, 'Pinned people whose off-screen story keeps going, in Lean too. Archiving a dossier or a death unpins them.');
        assert.deepEqual([tokens.type, tokens.label, tokens.min, tokens.max], ['int', 'Narrator budget for key people (tokens)', 0, undefined]);
        assert.equal(tokens.help, 'No upper limit. When those away need more, the ones returning soonest or whose story just moved are told first. Story Suite\'s overall budget (Settings → Tabs & Packs) still caps everything sent each reply.');
        assert.deepEqual([defs.defaults['keypeople.cap'], defs.defaults['keypeople.tokens']], [10, 300]);
        assert.equal(host.sdk.settings('story-director')['keypeople.cap'] ?? 10, 10);
    } finally {
        host.close();
    }
});

test('the World sheet keeps the Journal facts flush left (!important, as it was) and the key rows\' Unpin out of the row height', () => {
    assert.ok(worldScreen.css.includes('.wv-facts { list-style: none; padding-left: 0 !important; }'));
    assert.match(worldScreen.css, /\.wv-key-unpin \{ grid-column: 3; grid-row: 1 \/ span 3; align-self: start;/);
});
