// src/v2/module.js: how the parts are merged into module `story-director` (MODULES §A).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createModule, namespaced, partSettings, PARTS, storyDirectorModule } from '../../../src/v2/module.js';
import { STATIC_TEXT } from '../../../src/v2/tracker/note.js';
import { QUEST_STATIC } from '../../../src/v2/quests/index.js';

test('statics in part order, budgets summed, kinds dispatched to their part', () => {
    const def = storyDirectorModule;
    assert.equal(def.context.static(), `${STATIC_TEXT}\n${QUEST_STATIC}`);
    assert.equal(def.context.budget, 500 + 150);
    assert.deepEqual(PARTS.map(([id]) => id), ['tracker', 'quests']);
    assert.ok(def.capture.kinds.quest.grammar.startsWith('+ quest Name'));
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
