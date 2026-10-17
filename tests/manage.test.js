// Tests for src/manage.js, Story Director's side of Story Suite's overlay: the announcement
// (settings selector, enabled: false when switched off, withdrawn without Story Block), the
// api.manage handle (sources, setSource, enabled, setEnabled) and when the overlay can be opened.
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import { SOURCE_CHOICES, makeManage, sourceChoices, suiteAnnouncement, suiteOpener } from '../src/manage.js';
import { isSourceOfTruth, storySuite } from '../src/suite.js';

const AREAS = ['calendar', 'timeline', 'npc'];
const API = Object.freeze({ apiVersion: 1, manage: {} });

beforeEach(() => {
    delete globalThis.StorySuite;
});

const announcement = (settings, more = {}) => suiteAnnouncement({ id: 'story-director', name: 'Story Director', version: '0.8.1', areas: AREAS, settings, storyBlock: true, api: API, panel: '#story_director_settings', ...more });

test('sourceChoices: every area, unknown or missing choices read as auto', () => {
    assert.deepEqual(SOURCE_CHOICES, ['auto', 'mine', 'theirs']);
    assert.deepEqual(sourceChoices({ npc: 'theirs', calendar: 'bogus', other: 'mine' }, AREAS), { calendar: 'auto', timeline: 'auto', npc: 'theirs' });
    assert.deepEqual(sourceChoices(null, AREAS), { calendar: 'auto', timeline: 'auto', npc: 'auto' });
});

test('announcement while tracking: the areas less "the other one", with the panel selector and the api', () => {
    const { key, provider } = announcement({ enabled: true, sourceOfTruth: { calendar: 'auto', timeline: 'theirs', npc: 'mine' } });
    assert.equal(key, 'on:calendar,npc');
    assert.deepEqual(provider, { id: 'story-director', name: 'Story Director', version: '0.8.1', owns: ['calendar', 'npc'], enabled: true, settings: '#story_director_settings', api: API });
    assert.equal(announcement({}).key, 'on:calendar,timeline,npc', 'defaults: on, everything Automatic');
});

test('announcement switched off: enabled false, nothing offered, settings and api kept', () => {
    const { key, provider } = announcement({ enabled: false, sourceOfTruth: { calendar: 'mine' } });
    assert.equal(key, 'off');
    assert.equal(provider.enabled, false);
    assert.deepEqual(provider.owns, []);
    assert.equal(provider.settings, '#story_director_settings');
    assert.equal(provider.api, API);
});

test('announcement without Story Block: withdrawn, whatever the switch', () => {
    assert.deepEqual(announcement({ enabled: true }, { storyBlock: false }), { key: '', provider: null });
    assert.deepEqual(announcement({ enabled: false }, { storyBlock: false }), { key: '', provider: null });
});

test('a switched-off announcement owns nothing in the registry, but the overlay still sees it', () => {
    const suite = storySuite();
    suite.announce({ id: 'npc-state-delta', name: 'NPC State Delta', version: '1.0.0', owns: ['npc', 'calendar'] });
    suite.announce(announcement({ enabled: false }).provider);
    assert.equal(suite.owner('calendar'), 'npc-state-delta');
    assert.equal(suite.has('story-director'), false);
    assert.equal(suite.api('story-director'), null);
    assert.equal(isSourceOfTruth('npc-state-delta', 'calendar', 'auto'), true);
    const seen = suite.providers().find(provider => provider.id === 'story-director');
    assert.equal(seen.enabled, false);
    assert.equal(seen.settings, '#story_director_settings');
    assert.equal(seen.api, API, 'providers() keeps api.manage for the overlay');

    // Switched back on, it owns the calendar again.
    suite.announce(announcement({ enabled: true }).provider);
    assert.equal(suite.owner('calendar'), 'story-director');
});

function fakeHost(initial = {}) {
    let saved = { enabled: true, depth: 2, sourceOfTruth: { calendar: 'auto', timeline: 'auto', npc: 'auto' }, ...initial };
    const saves = [];
    const panelCalls = [];
    const panel = { setSource: (area, choice) => panelCalls.push(['source', area, choice]), setEnabled: on => panelCalls.push(['enabled', on]) };
    const manage = makeManage({
        areas: AREAS,
        read: () => saved,
        save: next => {
            saves.push(next);
            saved = next;
        },
        panel: () => panel,
    });
    return { manage, saves, panelCalls, saved: () => saved };
}

test('manage.sources: a copy of the saved choices', () => {
    const { manage, saved } = fakeHost({ sourceOfTruth: { calendar: 'mine', npc: 'theirs' } });
    assert.deepEqual(manage.areas, AREAS);
    assert.ok(Object.isFrozen(manage) && Object.isFrozen(manage.areas));
    const sources = manage.sources();
    assert.deepEqual(sources, { calendar: 'mine', timeline: 'auto', npc: 'theirs' });
    sources.calendar = 'theirs';
    assert.equal(saved().sourceOfTruth.calendar, 'mine', 'changing the copy changes nothing');
});

test('manage.setSource: validated, saved with the rest, and shown in the panel', () => {
    const { manage, saves, panelCalls, saved } = fakeHost();
    assert.equal(manage.setSource('timeline', 'theirs'), true);
    assert.equal(saves.length, 1);
    assert.deepEqual(saved().sourceOfTruth, { calendar: 'auto', timeline: 'theirs', npc: 'auto' });
    assert.equal(saved().depth, 2, 'the rest is carried along');
    assert.deepEqual(panelCalls, [['source', 'timeline', 'theirs']]);
    assert.deepEqual(manage.sources(), { calendar: 'auto', timeline: 'theirs', npc: 'auto' });

    // An unknown area or choice changes nothing.
    assert.equal(manage.setSource('stats', 'mine'), false);
    assert.equal(manage.setSource('npc', 'nobody'), false);
    assert.equal(manage.setSource('npc'), false);
    assert.equal(saves.length, 1);
    assert.equal(panelCalls.length, 1);
});

test('manage.enabled / setEnabled: the tracking switch, saved and shown in the panel', () => {
    const { manage, saves, panelCalls, saved } = fakeHost();
    assert.equal(manage.enabled(), true);
    manage.setEnabled(false);
    assert.equal(saved().enabled, false);
    assert.equal(manage.enabled(), false);
    assert.equal(saved().depth, 2);
    manage.setEnabled(1);
    assert.equal(saved().enabled, true, 'coerced to a boolean');
    assert.equal(saves.length, 2);
    assert.deepEqual(panelCalls, [['enabled', false], ['enabled', true]]);
});

test('manage works without a panel (the drawer not drawn yet)', () => {
    let saved = { enabled: true };
    const manage = makeManage({ areas: AREAS, read: () => saved, save: next => { saved = next; } });
    assert.equal(manage.setSource('npc', 'mine'), true);
    manage.setEnabled(false);
    assert.deepEqual(saved, { enabled: false, sourceOfTruth: { calendar: 'auto', timeline: 'auto', npc: 'mine' } });
});

test('suiteOpener: only with two or more announced and Story Block sharing openSuite', () => {
    const suite = storySuite();
    const opened = [];
    const block = { id: 'story-block', name: 'Story Block', version: '0.8.0', owns: ['scene'] };
    assert.equal(suiteOpener(suite), null, 'nobody announced');

    suite.announce({ ...block, api: { openSuite(tab) { opened.push([this === undefined ? 'unbound' : 'bound', tab]); } } });
    assert.equal(suiteOpener(suite), null, 'Story Block alone');

    suite.announce(announcement({ enabled: false }).provider);
    const open = suiteOpener(suite);
    assert.equal(typeof open, 'function', 'two announced, one of them off');
    open('story-director');
    assert.deepEqual(opened, [['bound', 'story-director']]);

    suite.announce({ ...block, api: {} });
    assert.equal(suiteOpener(suite), null, 'an older Story Block without the overlay');
    suite.announce({ ...block, enabled: false, api: { openSuite() {} } });
    assert.equal(suiteOpener(suite), null, 'Story Block switched off shares nothing');
    assert.equal(suiteOpener(null), null);
    assert.equal(suiteOpener({ providers: () => { throw new Error('broken'); } }), null);
});
