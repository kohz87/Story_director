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
import { BACKLOG_BUDGET, DIGEST_TAIL_BUDGET } from '../../../src/v2/chronicle/digest.js';
import { part as checksPart } from '../../../src/v2/checks/index.js';
import { part as chroniclePart } from '../../../src/v2/chronicle/index.js';
import { part as keyPeoplePart } from '../../../src/v2/keypeople/index.js';
import { DEFAULT_TOKENS as KEY_PEOPLE_TOKENS } from '../../../src/v2/keypeople/domain.js';
import { STATIC_TEXT as KEY_PEOPLE_STATIC } from '../../../src/v2/keypeople/note.js';
import { ARC_TAIL_BUDGET } from '../../../src/v2/arc/domain.js';
import { TAIL_BUDGET as CAST_BUDGET } from '../../../src/v2/cast/settings.js';
import { PULSE_STATIC, STALE_REPLIES, pulseCommand, pulseHook } from '../../../src/v2/pulse/effects.js';
import { foesLeftover, foesSignature, leanFight, pulseResults } from '../../../src/v2/cast/entries.js';
import { slotValue } from '../../../src/v2/slot.js';
import { createHost } from '../../vendor/story-block/testkit/index.js';
import { fakeDelta } from '../keypeople/helpers.js';
import {
    OVERUSED, applyPerson, beforeGenerate as namesBefore, bareKey, capMinor, checkName, clampCount, initialNames, nameKey, parseBanned, parseProfile, pickSuggestions,
    part as namesPart, profileText, tail as namesTail, validateNames,
} from '../../../src/v2/names/index.js';

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
    const plain = id => id !== 'story-director.initiative' && id !== 'story-director.key-people' && id !== 'story-director.pulse';
    // The lean diet: the World paragraphs are taught only while the story keeps a world event or a faction (env.chronicle); the check rule is
    // the `? check` grammar line's, not a paragraph.
    // (The module reads that from the state itself, so a module that has seen none sends the paragraph-free static; the chronicle part's own
    // static, given the flag, is CHRONICLE_STATIC, in tests/v2/chronicle/context.test.js.)
    assert.equal(hostStatic(def, plain), STATIC_TEXT);
    assert.equal(chroniclePart.context.static({ chronicle: true }), CHRONICLE_STATIC);
    assert.equal(checksPart.context.static(), '');
    assert.equal(hostStatic(def, id => plain(id) && id !== 'story-director.threads'), staticText({ threads: false }));
    // Nobody pinned: the Key people paragraph is not taught (the prompt is what it was); with someone pinned it comes between them.
    assert.equal(hostStatic(def, () => true, {}), `${STATIC_TEXT}\n${def.context.parts.find(part => part.feature === 'story-director.initiative').static()}\n${PULSE_STATIC}`);
    assert.equal(keyPeoplePart.context.static({ keyPeople: true }), KEY_PEOPLE_STATIC);
    assert.equal(keyPeoplePart.context.static({ keyPeople: false }), '');
    assert.equal(def.context.budget, 500 + RECAP_BUDGET + ATLAS_BUDGET + TRIP_TAIL_BUDGET + CHRONICLE_BUDGET + DIGEST_TAIL_BUDGET + BACKLOG_BUDGET + KEY_PEOPLE_TOKENS + CAST_BUDGET + ARC_TAIL_BUDGET + checksPart.context.budget);
    assert.deepEqual(PARTS.map(([id]) => id), ['tracker', 'time', 'atlas', 'chronicle', 'world', 'keypeople', 'cast', 'names', 'pulse', 'arc', 'checks', 'ripples', 'screens']);
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
    assert.deepEqual(Object.keys(storyDirectorModule.widgets), ['story-director.map', 'story-director.people', 'story-director.journal-events', 'story-director.fold', 'story-director.key-people', 'story-director.arc', 'story-director.behind', 'story-director.plan', 'story-director.ripples', 'story-director.quests'], 'the atlas\'s Map, the World screen\'s people, journal events and key people, the arc panel, behind the scenes and the Quests cards');
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

// ---- the names part (src/v2/names/index.js) ----
const PACK_NAMES = { banned: ['Mordred'], river: { regions: ['River Confederacy'], given: ['Wenna', 'Joost', 'Maaike', 'Bregje', 'Temiwa', 'Hilde', 'Gerold', 'Sigrun'] } };

test('names core: banned, overused, taken, first-name and near collisions; titles do not make a new name', () => {
    assert.deepEqual(OVERUSED.slice(0, 4), ['Elara', 'Vane', 'Vance', 'Seraphina']);
    const known = [{ name: 'Sister Temiwa', by: 'used' }, 'Bregje', 'Corst'];
    assert.equal(checkName('Rik', { known }).ok, true);
    assert.deepEqual(checkName('Elara Brightwater').reasons.map(r => r.kind), ['overused']);
    assert.deepEqual(checkName('Mara', { banned: parseBanned('Mara\nKessa, Mara') }).reasons.map(r => r.kind), ['banned']);
    assert.deepEqual(checkName('Temiwa', { known }).reasons, [{ kind: 'taken', by: 'used' }]);
    assert.deepEqual(checkName('Bregje Dale', { known }).reasons.map(r => r.kind), ['first']);
    assert.deepEqual(checkName('Bregja', { known }).reasons.map(r => r.kind), ['near']);
    assert.equal(checkName('Bregje', { known, self: 'Bregje' }).ok, true);
    assert.equal(bareKey('Watch-Captain Roelof'), 'roelof');
    assert.deepEqual(parseBanned('a, b\nA\n'), ['a', 'b']);
    assert.deepEqual([clampCount(undefined), clampCount(99), clampCount(-2), clampCount(2.9)], [3, 8, 0, 2]);
});

test('names core: suggestions are deterministic, setting-fitting and unused; the profile line is capped; minor people are capped oldest first', () => {
    const args = { names: PACK_NAMES, region: 'River Confederacy: Bluewatch', used: ['Temiwa'], banned: ['Joost'], count: 3, seed: '12' };
    const picked = pickSuggestions(args);
    assert.equal(picked.length, 3);
    assert.deepEqual(pickSuggestions({ ...args, names: { ...PACK_NAMES, river: { ...PACK_NAMES.river, given: [...PACK_NAMES.river.given].reverse() } } }), picked, 'the pack order does not matter');
    assert.ok(!picked.includes('Temiwa') && !picked.includes('Joost'));
    assert.deepEqual(pickSuggestions({ ...args, region: 'Elsewhere' }), []);
    assert.deepEqual(pickSuggestions({ ...args, names: undefined }), []);
    assert.notDeepEqual(pickSuggestions({ ...args, seed: '13' }), picked);
    const read = parseProfile('look: a long scar over one eye and a limp | flaw: greedy | voice: low | temper: calm');
    assert.equal(read.ok, true);
    assert.ok(Array.from(profileText({ look: 'x'.repeat(99), flaw: 'y'.repeat(99), voice: 'z'.repeat(99), temper: 'w'.repeat(99) })).length <= 160);
    const people = Object.fromEntries(Array.from({ length: 82 }, (_, i) => [`p${String(i).padStart(2, '0')}`, { first: 100 - i }]));
    const capped = capMinor(people, 80);
    assert.equal(Object.keys(capped.people).length, 80);
    assert.deepEqual(capped.evicted, ['p81', 'p80']);
});

const namesView = (slice, { chat = 6, present = [], mes = '', log = null, settings = {}, on = true } = {}) => ({
    state: { domains: { names: slice, scene: { place: { region: 'River Confederacy: Bluewatch' } } } }, chat: { length: chat }, feature: () => on, settings: () => settings,
    story: { chat: () => log ?? [{ mes }] }, query: (name, args) => (name === 'packs.content' ? (args.kind === 'names' ? [{ names: PACK_NAMES }] : []) : name === 'scene.present' ? present : null),
});

test('names: the tail offers the setting count of unused names and tells a stored person back in the scene (profile, at most 4); off, nothing', () => {
    const slice = { people: { corst: { name: 'Corst', first: 3, profile: { look: 'scarred', flaw: 'greedy', voice: 'low', temper: 'calm' }, rev: 3 }, hald: { name: 'Hald', first: 4, profile: null, rev: 4 } }, seen: {}, taken: {} };
    const out = namesTail(namesView(slice, { present: ['Corst', 'Hald'], settings: { suggestions: 2 } }));
    assert.deepEqual(out.lines, []);
    assert.equal(out.optional[0], 'Corst: scarred; greedy; low; calm');
    assert.match(out.optional[1], /^Unused names \(pick one for any new person\): \w+, \w+$/);
    assert.equal(out.optional.length, 2, 'a person without a profile is not told');
    assert.equal(namesTail(namesView(slice, { mes: 'Corst spits.', settings: { suggestions: 0 } })).optional.join('|'), 'Corst: scarred; greedy; low; calm');
    assert.deepEqual(namesTail(namesView(slice, { on: false, present: ['Corst'] })), { lines: [], optional: [] });
    // The trigger is the narrator's last reply (not the reader's message after it), and a name is a whole word.
    const told = log => namesTail(namesView(slice, { log, settings: { suggestions: 0 } })).optional;
    assert.deepEqual(told([{ mes: 'Corst spits.', is_user: false }, { mes: 'I wait.', is_user: true }]), ['Corst: scarred; greedy; low; calm']);
    assert.deepEqual(told([{ mes: 'Quiet.', is_user: false }, { mes: 'Where is Corst?', is_user: true }]), []);
    const ket = { people: { ket: { name: 'Ket', first: 1, profile: { look: 'squat', flaw: '', voice: '', temper: '' }, rev: 1 } }, seen: {}, taken: {} };
    assert.deepEqual(namesTail(namesView(ket, { mes: 'A bucket and Ketil.', settings: { suggestions: 0 } })).optional, []);
    assert.deepEqual(namesTail(namesView(ket, { mes: 'Then Ket, grinning.', settings: { suggestions: 0 } })).optional, ['Ket: squat']);
});

test('names core: accents do not hide a banned or overused name; a known person declared again is not a collision and writes nothing; a near miss is a Problem without a cue', () => {
    assert.deepEqual(checkName('Élara').reasons.map(r => r.kind), ['overused']);
    assert.deepEqual(checkName('Maré', { banned: ['Mare'] }).reasons.map(r => r.kind), ['banned']);
    assert.equal(nameKey('Seraphína'), nameKey('Seraphina'));
    const ctx = slice => ({ rev: 7, draft: () => slice, settings: () => ({}), query: () => null, fail: (code, text) => ({ code, text }) });
    const line = (name, look) => ({ op: '+', name, text: `look: ${look}` });
    const slice = { people: { marrit: { name: 'Marrit', first: 2, profile: { look: 'tall', flaw: '', voice: '', temper: '' }, rev: 2 } }, seen: { bregje: { name: 'Bregje', rev: 3 } }, taken: {} };
    for (const name of ['Marrit', 'marrit', 'Bregje']) {
        const out = applyPerson(ctx(slice), line(name, 'one-eyed brute'));
        assert.equal(out.problem, undefined, `${name} is the same person`);
        assert.equal(out.data.known, true);
    }
    assert.deepEqual(slice.taken, {}, 'no rename cue');
    assert.equal(slice.people.marrit.profile.look, 'tall', 'the frozen profile stays');
    assert.equal(slice.people.bregje, undefined, 'a dossier person gets no profile from the line');
    assert.ok(slice.seen.bregje);
    const refused = applyPerson(ctx(slice), line('Elara', 'tall'));
    assert.ok(refused.problem && slice.taken.elara && slice.people.elara === undefined, 'a refused name keeps no profile');
    const near = applyPerson(ctx(slice), line('Bregja', 'thin'));
    assert.ok(near.problem && slice.taken.bregja === undefined && slice.people.bregja === undefined, 'a near miss is told to the reader only');
    const cue = namesBefore({ ...namesView({ people: {}, seen: {}, taken: { elara: { name: 'Elara', rev: 2, told: false } } }, { settings: { suggestions: 0 } }) }, {});
    assert.match(cue.lines[0].text, /by another, unused name/, 'suggestions 0 means no suggested name in the cue either');
});

test('names: a unique full, given, middle, surname, partial or titled name keeps the known person and their profile', () => {
    const slice = { people: { 'marrit anne voss': { name: 'Marrit Anne Voss', first: 2, profile: { look: 'tall', flaw: '', voice: '', temper: '' }, rev: 2 } }, seen: { 'captain joris brand': { name: 'Captain Joris Brand', rev: 3 } }, taken: {} };
    const before = structuredClone(slice);
    const ctx = { rev: 7, draft: () => slice, settings: () => ({}), query: () => null };
    for (const name of ['Marrit Anne Voss', 'Marrit', 'Anne', 'Voss', 'Marrit Voss', 'Anne Voss', 'Lady Marrit Voss', 'Joris Brand', 'Joris', 'Brand', 'Captain Brand']) {
        const result = applyPerson(ctx, { op: '+', name, text: 'look: different' });
        assert.equal(result.data.known, true, name);
        assert.equal(result.problem, undefined, name);
    }
    assert.deepEqual(slice, before, 'no duplicate profile, overwrite or rename cue');
    assert.equal(namesBefore(namesView(slice, { settings: { suggestions: 0 } }), {})?.lines, undefined);
});

test('names: cast, dossier and pin aliases stay linked in recorded history, including a scene alias', () => {
    const slice = initialNames();
    const view = namesView(slice, { present: ['Red Fox'], settings: { suggestions: 0 } });
    view.state.domains.cast = { people: { 'pack:joris': { name: 'Captain Joris Brand', aliases: ['Red Fox', 'Joss the Swift'] } } };
    view.state.domains.keypeople = { pins: { mara: { name: 'Mara Kess', aliases: ['Swift Quill'] }, fox: { name: 'Red Fox', aliases: ['Watch Fox'] } }, gone: {} };
    view.query = (name, args) => name === 'scene.present' ? ['Red Fox'] : name === 'npc.known' ? ['Leonie West'] : name === 'npc.dossier' && args.name === 'Leonie West' ? { name: 'Leonie West', aliases: ['Mistress Willow'] } : name === 'npc.identity' ? { id: 'np_12345678' } : null;
    const step = namesBefore(view, {}).commands.find(command => command.type === 'names.seen');
    assert.equal(step.payload.identities.length, 4);
    const ctx = { cause: 'system', rev: 4, draft: () => slice, settings: () => ({}), query: () => null, fail: (code, text) => ({ code, text }) };
    assert.equal(namesPart.commands['names.seen'](ctx, step.payload).summary, 'Names noted.');
    assert.deepEqual(validateNames(slice), []);
    assert.equal(namesBefore(view, {}), undefined, 'unchanged aliases do not keep writing steps');
    const before = structuredClone(slice);
    for (const name of ['Joris', 'Captain Brand', 'Joss', 'Red Fox', 'Fox', 'Watch Fox', 'Leonie', 'West', 'Willow', 'Mara', 'Kess', 'Swift Quill']) {
        const result = applyPerson(ctx, { op: '+', name, text: 'look: invented' });
        assert.equal(result.data.known, true, name);
        assert.equal(result.problem, undefined, name);
    }
    assert.deepEqual(slice, before, 'known aliases do not invent profiles or cues');
    view.state.domains.cast.people['pack:joris'].aliases = ['The Red Captain'];
    const update = namesBefore(view, {}).commands.find(command => command.type === 'names.seen');
    namesPart.commands['names.seen']({ ...ctx, rev: 5 }, update.payload);
    assert.equal(applyPerson(ctx, { op: '+', name: 'Red Captain' }).data.known, true, 'a newly learned alias is recorded');
    assert.equal(applyPerson(ctx, { op: '+', name: 'Red Fox' }).data.known, true, 'an earlier alias remains linked');
    assert.equal(namesBefore(view, {}), undefined, 'a changed alias is recorded only once');
    assert.deepEqual(validateNames(slice), []);
});

test('names: ambiguous given names, surnames, aliases and identical full names remain collisions', () => {
    const slice = initialNames();
    const view = namesView(slice, { settings: { suggestions: 0 } });
    view.state.domains.cast = { people: {
        'p:a': { name: 'Joris Brand', aliases: ['Fox'] },
        'p:b': { name: 'Joris Voss', aliases: ['Fox'] },
        'p:c': { name: 'Mara Brand', aliases: [] },
        'p:d': { name: 'Riva North', aliases: ['Sparrow'] },
        'p:e': { name: 'Riva North', aliases: ['Wren'] },
    } };
    view.state.domains.keypeople = { pins: { fox: { name: 'Fox', aliases: ['Night Fox'] } }, gone: {} };
    const ctx = { cause: 'system', rev: 3, draft: () => slice, settings: () => ({}), query: () => null, fail: (code, text) => ({ code, text }) };
    namesPart.commands['names.seen'](ctx, namesBefore(view, {}).commands[0].payload);
    for (const name of ['Joris Brand', 'Joris Voss', 'Mara Brand', 'Sparrow', 'Wren']) {
        assert.equal(applyPerson(ctx, { op: '+', name }).data.known, true, `${name} identifies one person`);
    }
    for (const name of ['Joris', 'Brand', 'Fox', 'Riva North', 'Joris Dane', 'Elara']) {
        const result = applyPerson(ctx, { op: '+', name, text: 'look: invented' });
        assert.ok(result.problem, `${name} must be a collision`);
        assert.ok(slice.taken[nameKey(name)], `${name} gets a rename cue`);
        assert.equal(slice.people[nameKey(name)], undefined, `${name} gets no profile`);
    }
    const cues = namesBefore(view, {}).lines;
    assert.equal(cues.length, 6);
    assert.ok(cues.every(cue => cue.keep));
    assert.deepEqual(validateNames(slice), []);
});

test('names on the host: partial and dossier alias declarations stay quiet through a swipe, deletion and rebuild', async () => {
    const delta = { 'Joris Brand': { aliases: ['Red Fox'] } };
    const host = await createHost({ modules: [fakeDelta(delta), createModule()], settings: { features: { 'story-director.names': true, 'story-director.pulse': false } } });
    try {
        await host.send('Hello.', '<Changes>\n+ person Marrit Anne Voss | look: tall\n</Changes>');
        await host.send('Again.', '<Changes>\n+ person Marrit | look: short\n+ person Brand | look: made up\n+ person Red Fox | look: made up\n</Changes>');
        const middle = host.ctx.chat.length - 1;
        const names = () => host.head().domains.names;
        assert.deepEqual(names().taken, {});
        assert.equal(names().people['marrit anne voss'].profile.look, 'tall');
        assert.deepEqual(Object.keys(names().people), ['marrit anne voss']);
        await host.swipe('<Changes>\n+ person Voss | look: short\n+ person Fox | look: made up\n</Changes>');
        assert.deepEqual(names().taken, {});
        delta['Joris Brand'].aliases = ['Grey Falcon'];
        await host.send('Then?', '<Changes>\n+ person Grey Falcon | look: made up\n</Changes>');
        assert.deepEqual(names().taken, {});
        delta['Joris Brand'].aliases = ['Red Fox'];
        assert.ok(!host.st.promptLog.some(entry => String(entry.value ?? '').includes('[Names] "Marrit"')));
        await host.st.deleteMessage(middle);
        await host.st.deleteMessage(middle - 1);
        assert.deepEqual(host.store.problems(), []);
        assert.ok(!Object.values(names().seen).some(entry => entry.aliases?.includes('Grey Falcon')), 'the deleted observation leaves no alias behind');
        const live = structuredClone(host.head());
        host.store.rebuild();
        assert.deepEqual(host.head(), live);
        assert.deepEqual(validateNames(names()), []);
    } finally {
        host.close();
    }
});

test('names on the host: a repeated or overused name is a Problem and a pinned cue on the next reply; a fresh name is stored with its profile; off, the prompt is as it was', async () => {
    const run = async features => {
        const host = await createHost({ modules: [createModule()], settings: { features: { 'story-director.pulse': false, ...features } } });
        return host;
    };
    const plain = await run({ 'story-director.names': false });
    const on = await run({ 'story-director.names': true });
    try {
        const open = '<Changes>\n~ time June 3, 1200, 08:00 am\n~ place Harrow | kind: settlement\n';
        await plain.send('Hello.', `${open}+ person Corst | look: scarred | flaw: greedy\n</Changes>`);
        await on.send('Hello.', `${open}+ person Corst | look: scarred | flaw: greedy | voice: low | temper: calm\n</Changes>`);
        assert.deepEqual(plain.head().domains.names, initialNames(), 'a chat without the feature stores nothing');
        assert.deepEqual(on.head().domains.names.people.corst.profile, { look: 'scarred', flaw: 'greedy', voice: 'low', temper: 'calm' });
        assert.deepEqual(validateNames(on.head().domains.names), []);
        await on.send('Next.', '<Changes>\n+ person Elara | look: tall\n+ person Corst | look: fat\n</Changes>');
        const names = on.head().domains.names;
        assert.deepEqual(Object.keys(names.taken), ['elara'], 'Corst declared again is the same person, not a collision');
        assert.equal(names.people.corst.profile.look, 'scarred', 'the first profile is frozen');
        assert.ok(on.sdk.receipts().some(entry => /not a fresh name/.test(entry.receipt?.summary ?? '')));
        await on.send('And?', 'Quiet.');
        const cues = on.st.promptLog.map(entry => String(entry.value ?? '')).filter(text => text.includes('[Names] "Elara"'));
        assert.ok(cues.length >= 1, 'the rename cue reaches the next reply');
        assert.ok(Object.values(on.head().domains.names.taken).every(entry => entry.told === true));
        const statics = host => host.st.promptLog.filter(entry => entry.key === 'story_suite_static' && entry.value).map(entry => entry.value);
        assert.ok(statics(on).at(-1).includes('+ person Name'));
        assert.ok(!statics(plain).at(-1).includes('+ person Name'));
        const before = structuredClone(on.head());
        on.store.rebuild();
        assert.deepEqual(on.head(), before, 'rebuild == live');
    } finally {
        plain.close();
        on.close();
    }
});

test('names: the step before a reply notes who else is in use (scene, cast, dossiers, key people) and marks a told cue once; a Continue tells it again without a step', () => {
    const view = namesView({ people: {}, seen: {}, taken: { elara: { name: 'Elara', rev: 2, told: false } } }, { present: ['Rika'] });
    view.state.domains.cast = { people: { 'p:a': { name: 'Brom', aliases: ['Old Brom'] } } };
    const out = namesBefore(view, {});
    assert.deepEqual(out.commands.map(c => c.type), ['names.seen', 'names.told']);
    assert.deepEqual(out.commands[0].payload.who, ['Rika']);
    assert.deepEqual(out.commands[0].payload.identities.map(person => person.name), ['Brom']);
    assert.match(out.lines[0].text, /^\[Names\] "Elara" is not a fresh name/);
    assert.equal(out.lines[0].keep, true);
    assert.equal(out.lines[0].text.includes('Brom'), false, 'nobody known is named in the cue');
    const again = namesBefore(view, { commit: false });
    assert.equal(again.commands, undefined);
    assert.equal(again.lines.length, 1);
    assert.equal(namesBefore(namesView(initialNames(), { on: false }), {}), undefined);
});

test('one tail build asks each query once for the same arguments, and the next build asks again', () => {
    let calls = 0;
    let answer = 'one';
    const part = {
        context: { tail: view => ({ lines: [view.query('x.ask', { a: 1 }), view.query('x.ask', { a: 1 }), view.query('x.ask', { a: 2 })], optional: [] }), budget: 10 },
    };
    const def = createModule({ parts: [['a', part]] });
    const view = { state: {}, settings: () => ({}), query: (name, args) => { if (name === 'x.ask') calls++; return `${answer}${args?.a}`; } };
    assert.deepEqual(def.context.tail(view).lines, ['one1', 'one1', 'one2']);
    assert.equal(calls, 2);
    answer = 'two';
    assert.deepEqual(def.context.tail(view).lines, ['two1', 'two1', 'two2']);
    // A query that throws is asked again, not remembered.
    let tries = 0;
    const throwing = { context: { tail: view => { const out = []; for (let i = 0; i < 2; i++) { try { out.push(view.query('x.bad', {})); } catch { out.push('threw'); } } return { lines: out, optional: [] }; }, budget: 10 } };
    const def2 = createModule({ parts: [['a', throwing]] });
    assert.deepEqual(def2.context.tail({ state: {}, settings: () => ({}), query: name => { if (name === 'x.bad') tries++; throw new Error('x'); } }).lines, ['threw', 'threw']);
    assert.equal(tries, 2);
});

// ---- the World pulse and a Foes slot nobody cleared (LIVERUN1 item 2) --------------------------------------------------------------

const foesState = (fields = { foe1: 'Ridge cutpurses', count1: 2, hurt1: 3 }) => ({ domains: { dataModules: {
    active: { f: { hash: 'h' } }, pins: { h: { definition: { role: 'foes' } } }, instances: { f: { chat: { fields } } },
} } });

// One pulse step on a fake ctx: the director slice is carried from step to step (what the store's draft does), the Foes block is `foes`.
function pulseStep(director, foes, payload) {
    const ctx = {
        cause: 'system', fail: (code, message) => { throw new Error(`${code}: ${message}`); }, draft: () => director, rng: () => 0.5, settings: {},
        read: name => (name === 'dataModules' ? foes.domains.dataModules : null), query: () => undefined, call() {},
    };
    pulseCommand(ctx, payload);
    return slotValue(director.pulse).results.at(-1);
}

test('pulse: a Foes slot read the same on STALE_REPLIES replies running is a leftover, not a fight: the pulse rolls again', () => {
    const director = { time: { minutes: 600 } };
    const foes = foesState();
    assert.equal(leanFight(foes), true);
    assert.equal(foesSignature(foes), '1:Ridge cutpurses:2:3');
    assert.equal(foesSignature({}), '');
    const kinds = [];
    for (let at = 2; at <= 10; at += 2) {
        director.time.minutes += 30;
        kinds.push(pulseStep(director, foes, { at, age: 1 }));
    }
    assert.deepEqual(kinds.slice(0, STALE_REPLIES).map(entry => entry.skipped), ['fight', 'fight'], 'while it is new, a fight');
    assert.ok(kinds.slice(STALE_REPLIES).every(entry => entry.skipped !== 'fight'), 'unchanged for two replies running: rolled again');
    assert.ok(kinds.every(entry => entry.foes === '1:Ridge cutpurses:2:3'), 'each roll records what the Foes read');
    // The slot moves (a hit lands): a fight again, for two replies.
    foes.domains.dataModules.instances.f.chat.fields.hurt1 = 2;
    director.time.minutes += 30;
    assert.equal(pulseStep(director, foes, { at: 12, age: 1 }).skipped, 'fight');
});

test('pulse: a step without the `age` flag (a reply written before the rule, re-read) keeps the old rule and records nothing new', () => {
    const director = { time: { minutes: 600 } };
    const foes = foesState();
    for (let at = 2; at <= 12; at += 2) {
        director.time.minutes += 30;
        const entry = pulseStep(director, foes, { at });
        assert.equal(entry.skipped, 'fight', `reply ${at}: still a fight, as it was`);
        assert.equal(entry.foes, undefined);
    }
});

test('pulse: the hook adds the flag to every new step', () => {
    const view = { state: { domains: { director: {} } }, chat: { length: 6 }, feature: () => true, settings: {} };
    assert.deepEqual(pulseHook(view, {}).commands[0].payload, { at: 6, age: 1, reach: 1 });
    assert.deepEqual(pulseHook(view, { type: 'swipe' }).commands[0].payload, { at: 5, age: 1, reach: 1 });
});

test('names is on by default like the pulse: a chat that never touched the switch teaches the person line and checks a new named person (LIVERUN1 item 11)', async () => {
    assert.equal(namesPart.features[0].default, true);
    const host = await createHost({ modules: [createModule()], settings: { features: { 'story-director.pulse': false } } });
    try {
        await host.send('Hello.', '<Changes>\n+ person Corst | look: scarred | flaw: greedy | voice: low | temper: calm\n</Changes>');
        await host.send('Next.', '<Changes>\n+ person Elara | look: tall\n</Changes>');
        const names = host.head().domains.names;
        assert.equal(names.people.corst.profile.look, 'scarred', 'a new named person is stored with the profile');
        assert.deepEqual(Object.keys(names.taken), ['elara'], 'an overused name is refused');
        assert.ok(host.st.promptLog.filter(entry => entry.key === 'story_suite_static' && entry.value).at(-1).value.includes('+ person Name'), 'the static prompt teaches the line');
    } finally {
        host.close();
    }
});

test('cast: a Foes slot the pulse recorded unchanged on the last two replies is a leftover for chance meetings too (one rule with the pulse)', () => {
    const foes = foesState();
    const sig = foesSignature(foes);
    const results = [{ at: 2, foes: sig }, { at: 4, foes: sig }, { at: 6, foes: sig }];
    assert.equal(foesLeftover(foes, results), true);
    assert.equal(foesLeftover(foes, [{ at: 2, foes: sig }, { at: 4, foes: '1:Ridge cutpurses:2:2' }]), false, 'a slot that moved is a fight');
    assert.equal(foesLeftover(foes, [{ at: 4, foes: sig }]), false, 'one reply is not enough');
    assert.equal(foesLeftover({}, results), false, 'no Foes slot: nothing is a leftover');
    const state = { domains: { director: { pulse: [{ results }] } } };
    assert.deepEqual(pulseResults(state, 6).map(entry => entry.at), [2, 4], 'the reply being written is not read');
    assert.deepEqual(pulseResults({}, 6), []);
});
