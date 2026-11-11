// src/v2/module.js: how the parts are merged into module `story-director` (MODULES §A).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createModule, namespaced, partSettings, PARTS, storyDirectorModule } from '../../../src/v2/module.js';
import { STATIC_TEXT, staticText } from '../../../src/v2/tracker/note.js';
import { STATIC_TEXT as ATLAS_STATIC, TAIL_BUDGET as ATLAS_BUDGET, TRIP_TAIL_BUDGET } from '../../../src/v2/atlas/note.js';
import { RECAP_BUDGET } from '../../../src/v2/time/recap.js';
import { screens as SCREENS } from '../../../src/v2/screens/index.js';
import { mapScreen } from '../../../src/v2/atlas/screen.js';
import { chronicleScreen } from '../../../src/v2/chronicle/screen.js';
import { daysScreen, worldScreen } from '../../../src/v2/world/index.js';
import { STATIC_TEXT as CHRONICLE_STATIC, TAIL_BUDGET as CHRONICLE_BUDGET } from '../../../src/v2/chronicle/note.js';
import { DIGEST_TAIL_BUDGET } from '../../../src/v2/chronicle/digest.js';
import { part as checksPart } from '../../../src/v2/checks/index.js';
import { part as chroniclePart } from '../../../src/v2/chronicle/index.js';
import { part as keyPeoplePart } from '../../../src/v2/keypeople/index.js';
import { DEFAULT_TOKENS as KEY_PEOPLE_TOKENS } from '../../../src/v2/keypeople/domain.js';
import { STATIC_TEXT as KEY_PEOPLE_STATIC } from '../../../src/v2/keypeople/note.js';
import { ARC_TAIL_BUDGET } from '../../../src/v2/arc/domain.js';
import { TAIL_BUDGET as CAST_BUDGET } from '../../../src/v2/cast/settings.js';

// What the host builds from a module's context (Story Block's registry contextOf): its static, then each context part that is on, trimmed,
// the empty ones left out, one per line.
const hostStatic = (def, on = () => true, env = {}) => [def.context.static, ...def.context.parts.filter(part => !part.feature || on(part.feature)).map(part => part.static)]
    .filter(fn => typeof fn === 'function').map(fn => String(fn(env)).trim()).filter(Boolean).join('\n');

test('statics in part order, budgets summed, kinds dispatched to their part', () => {
    const def = storyDirectorModule;
    // The time, atlas and screens parts add nothing to the static part.
    assert.equal(ATLAS_STATIC, '');
    // The Pacing and the two World paragraphs are the world-building threads feature's: context parts, in the place they always had.
    // The Key people paragraph is that feature's: a context part too, between the World paragraphs and the checks line.
    const plain = id => id !== 'story-director.initiative' && id !== 'story-director.key-people';
    // The lean diet: the World paragraphs are taught only while the story keeps a world event or a faction (env.chronicle); the check rule is
    // the `? check` grammar line's, not a paragraph.
    // (The module reads that from the state itself, so a module that has seen none sends the paragraph-free static; the chronicle part's own
    // static, given the flag, is CHRONICLE_STATIC, in tests/v2/chronicle/context.test.js.)
    assert.equal(hostStatic(def, plain), STATIC_TEXT);
    assert.equal(chroniclePart.context.static({ chronicle: true }), CHRONICLE_STATIC);
    assert.equal(checksPart.context.static(), '');
    assert.equal(hostStatic(def, id => plain(id) && id !== 'story-director.threads'), staticText({ threads: false }));
    // Nobody pinned: the Key people paragraph is not taught (the prompt is what it was); with someone pinned it comes between them.
    assert.equal(hostStatic(def, () => true, {}), `${STATIC_TEXT}\n${def.context.parts.find(part => part.feature === 'story-director.initiative').static()}`);
    assert.equal(keyPeoplePart.context.static({ keyPeople: true }), KEY_PEOPLE_STATIC);
    assert.equal(keyPeoplePart.context.static({ keyPeople: false }), '');
    assert.equal(def.context.budget, 500 + RECAP_BUDGET + ATLAS_BUDGET + TRIP_TAIL_BUDGET + CHRONICLE_BUDGET + DIGEST_TAIL_BUDGET + KEY_PEOPLE_TOKENS + CAST_BUDGET + ARC_TAIL_BUDGET + checksPart.context.budget);
    assert.deepEqual(PARTS.map(([id]) => id), ['tracker', 'time', 'atlas', 'chronicle', 'world', 'keypeople', 'cast', 'arc', 'checks', 'ripples', 'screens']);
    assert.match(def.capture.kinds.hook.grammar, /a quest is a job/);
    assert.equal(def.capture.kinds.quest.grammar(), '', 'the quest rides on the hook line');
    assert.equal(def.capture.kinds.time.apply, undefined, 'the kinds table holds only grammar');
    let failed = null;
    const ctx = { fail: (code, message) => { failed = { code, message }; throw new Error(message); } };
    assert.throws(() => def.capture.apply(ctx, { kind: 'wound' }));
    assert.equal(failed.code, 'INVALID');
});

test('settings are namespaced per part; a group becomes dotted fields; parts read theirs back', () => {
    const { defaults, schema } = namespaced('tracker', {
        defaults: { calendar: { preset: 'gregorian', months: [{ name: 'A', days: 30 }], daysPerMonth: 30 }, dormantReplies: 15 },
        schema: {
            calendar: { type: 'group', label: 'Calendar', fields: { preset: { type: 'choice', label: 'Kind', choices: ['gregorian', 'custom'] } } },
            dormantReplies: { type: 'int', label: 'Quiet after replies', min: 1 },
        },
    });
    assert.deepEqual(defaults, {
        'tracker.calendar.preset': 'gregorian', 'tracker.calendar.months': [{ name: 'A', days: 30 }], 'tracker.calendar.daysPerMonth': 30, 'tracker.dormantReplies': 15,
    });
    assert.deepEqual(schema['tracker.calendar.preset'], { type: 'choice', label: 'Calendar: Kind', options: ['gregorian', 'custom'] });
    assert.deepEqual(schema['tracker.dormantReplies'], { type: 'int', label: 'Quiet after replies', min: 1 });
    assert.deepEqual(partSettings('tracker', { ...defaults, 'quests.other': 1 }), {
        calendar: { preset: 'gregorian', months: [{ name: 'A', days: 30 }], daysPerMonth: 30 }, dormantReplies: 15,
    });
});

test('a part\'s handler, tail and tab see their own settings; other modules\' settings pass through', () => {
    const seen = {};
    const part = id => ({
        commands: { [`${id}.go`]: ctx => { seen[id] = { own: ctx.settings(), other: ctx.settings('story-block') }; return {}; } },
        context: { tail: view => ({ lines: [`${id}:${view.settings().level}`], optional: [] }), budget: 10 },
        settings: { defaults: { level: id === 'a' ? 1 : 2 } },
        tabs: [{ id: `${id}-tab`, title: id, render: (el, view) => { el.text = String(view.settings().level); } }],
    });
    const def = createModule({ parts: [['a', part('a')], ['b', part('b')]] });
    const values = { ...def.settings.defaults, 'b.level': 5 };
    const ctx = { settings: id => (id === 'story-director' ? values : { currency: 'gold' }) };
    def.commands['a.go'](ctx, {});
    def.commands['b.go'](ctx, {});
    assert.deepEqual(seen, { a: { own: { level: 1 }, other: { currency: 'gold' } }, b: { own: { level: 5 }, other: { currency: 'gold' } } });
    const view = { state: {}, settings: id => (id === 'story-director' ? values : {}) };
    assert.deepEqual(def.context.tail(view), { lines: ['a:1', 'b:5'], optional: [] });
    assert.equal(def.context.budget, 20);
    const el = {};
    def.tabs[1].render(el, view, {});
    assert.equal(el.text, '5');
});

test('hooks of one name from several parts all run, in part order', async () => {
    const calls = [];
    const def = createModule({ parts: [
        ['a', { hooks: { beforeGenerate: () => { calls.push('a'); return ['one']; }, canGenerate: () => true } }],
        ['b', { hooks: { beforeGenerate: () => { calls.push('b'); return { lines: ['two'], commands: [{ type: 'x.y', payload: {} }] }; }, canGenerate: () => ({ ok: false, reason: 'not yet' }) } }],
    ] });
    assert.deepEqual(await def.hooks.beforeGenerate({ settings: () => ({}) }), { lines: ['one', 'two'], commands: [{ type: 'x.y', payload: {} }] });
    assert.deepEqual(calls, ['a', 'b']);
    assert.deepEqual(await def.hooks.canGenerate({}), { ok: false, reason: 'not yet' });
});

test('two parts claiming one name is refused', () => {
    const one = { commands: { 'quest.take': () => ({}) } };
    assert.throws(() => createModule({ parts: [['a', one], ['b', one]] }), /the command "quest.take" is in two parts \(a and b\)/);
    const kind = { kinds: { time: { grammar: 'x', apply: () => ({}) } } };
    assert.throws(() => createModule({ parts: [['a', kind], ['b', kind]] }), /change-line kind "time"/);
});

test('screens and widgets: every part\'s, in part order; one id in two parts is refused', () => {
    assert.deepEqual(storyDirectorModule.screens.map(screen => screen.id), [mapScreen, chronicleScreen, worldScreen, daysScreen, ...SCREENS].map(screen => screen.id));
    assert.deepEqual(storyDirectorModule.tabs, []);
    assert.deepEqual(Object.keys(storyDirectorModule.widgets), ['story-director.map', 'story-director.people', 'story-director.journal-events', 'story-director.key-people', 'story-director.arc', 'story-director.behind', 'story-director.ripples', 'story-director.quests'], 'the atlas\'s Map, the World screen\'s people, journal events and key people, the arc panel, behind the scenes and the Quests cards');
    const status = storyDirectorModule.screens.find(screen => screen.id === 'story-director/status-card');
    assert.equal(status.defaultOn, true, 'the status card is on under every reply by default (§F24)');
    const widget = { render: () => {} };
    const def = createModule({ parts: [['a', { screens: [{ id: 'm/a' }], widgets: { 'story-director.dial': widget } }], ['b', { screens: [{ id: 'm/b' }] }]] });
    assert.deepEqual(def.screens.map(screen => screen.id), ['m/a', 'm/b']);
    assert.deepEqual(def.widgets, { 'story-director.dial': widget });
    assert.throws(() => createModule({ parts: [['a', { screens: [{ id: 'm/a' }] }], ['b', { screens: [{ id: 'm/a' }] }]] }), /the screen "m\/a" is in two parts \(a and b\)/);
    assert.throws(() => createModule({ parts: [['a', { widgets: { 'story-director.dial': widget } }], ['b', { widgets: { 'story-director.dial': widget } }]] }), /the widget "story-director.dial" is in two parts/);
});

test('settings.reads hands a part another part\'s setting; the tracker\'s calendar as the chat uses it', () => {
    const seen = {};
    const def = createModule({ parts: [
        ['tracker', { settings: { defaults: { calendar: { preset: 'pack' }, level: 3 } } }],
        ['time', {
            settings: { defaults: { hours: 8 }, reads: { calendar: 'tracker.calendar', level: 'tracker.level' } },
            commands: { 'time.look': ctx => { seen.ctx = ctx.settings(); return {}; } },
            context: { tail: view => { seen.view = view.settings(); return { lines: [], optional: [] }; } },
        }],
    ] });
    const values = { ...def.settings.defaults };
    const pack = { pack: 'p', era: 'CY', months: [{ name: 'Goldwane', days: 30 }], start: null };
    const query = name => (name === 'packs.calendar' ? pack : null);
    def.commands['time.look']({ settings: () => values, query }, {});
    assert.equal(seen.ctx.hours, 8);
    assert.equal(seen.ctx.level, 3);
    assert.equal(seen.ctx.calendar.preset, 'custom');
    assert.deepEqual(seen.ctx.calendar.months, [{ name: 'Goldwane', days: 30 }]);
    assert.equal(seen.ctx.calendar.era, 'CY');
    // No pack: Gregorian. The reader's own calendar: theirs, whatever the pack says.
    def.context.tail({ state: {}, settings: () => values, query: () => null });
    assert.equal(seen.view.calendar.preset, 'gregorian');
    const own = { ...values, 'tracker.calendar': { preset: 'custom', months: [{ name: 'Haywane', days: 20 }] } };
    def.commands['time.look']({ settings: () => own, query }, {});
    assert.deepEqual(seen.ctx.calendar.months, [{ name: 'Haywane', days: 20 }]);
    // A key the part has itself is never overwritten.
    const shadow = createModule({ parts: [['tracker', { settings: { defaults: { level: 3 } } }], ['b', { settings: { defaults: { level: 1 }, reads: { level: 'tracker.level' } }, commands: { 'b.go': ctx => { seen.b = ctx.settings(); return {}; } } }]] });
    shadow.commands['b.go']({ settings: () => shadow.settings.defaults }, {});
    assert.equal(seen.b.level, 1);
});

test('queries get tools.settings (the part\'s own) and tools.substitute; trip queries get the reader\'s map', () => {
    const seen = {};
    const def = createModule({
        parts: [['atlas', {
            settings: { defaults: { map: { era: 'pre-modern' } } },
            queries: {
                'atlas.travel': (state, args, tools) => { seen.args = args; seen.settings = tools.settings(); return tools.substitute('{{user}} rides'); },
                'atlas.places': (state, args) => { seen.places = args; return []; },
            },
        }]],
        host: { settings: id => (id === 'story-director' ? { 'atlas.map.era': 'modern' } : null), substitute: text => text.replace('{{user}}', 'Astra') },
    });
    assert.equal(def.queries['atlas.travel']({}, { from: 'a', to: 'b' }, { query: () => null }), 'Astra rides');
    assert.deepEqual(seen.args, { from: 'a', to: 'b', map: { era: 'modern' } });
    assert.deepEqual(seen.settings, { map: { era: 'modern' } });
    // A map the caller gives wins; other queries' args are left as they are.
    def.queries['atlas.travel']({}, { map: { era: 'pre-modern' } }, {});
    assert.deepEqual(seen.args, { map: { era: 'pre-modern' } });
    def.queries['atlas.places']({}, undefined, {});
    assert.equal(seen.places, undefined);
    // The host's own tools win over the live sdk; without either, the defaults and the text as it is.
    def.queries['atlas.travel']({}, {}, { settings: () => ({ 'atlas.map.era': 'pre-modern' }), substitute: text => text.replace('{{user}}', 'Ren') });
    assert.deepEqual(seen.settings, { map: { era: 'pre-modern' } });
    const bare = createModule({ parts: def && [['atlas', { settings: { defaults: { map: { era: 'x' } } }, queries: { 'atlas.travel': (s, a, tools) => [tools.settings(), tools.substitute('{{user}}')] } }]], host: { settings: () => null, substitute: () => undefined } });
    assert.deepEqual(bare.queries['atlas.travel']({}, {}, {}), [{ map: { era: 'x' } }, '{{user}}']);
});
