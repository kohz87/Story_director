// (0.9.39) One copy of the settings' defaults, for the runtime and the panel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../src/defaults.js';
import { PRESETS } from '../src/calendar.js';
import { DEFAULTS } from '../src/relevance.js';

test('the defaults the runtime and the settings panel share', () => {
    assert.ok(Object.isFrozen(DEFAULT_SETTINGS) && Object.isFrozen(DEFAULT_SETTINGS.arc) && Object.isFrozen(DEFAULT_SETTINGS.capture));
    assert.equal(DEFAULT_SETTINGS.depth, 0);
    assert.equal(DEFAULT_SETTINGS.calendar, PRESETS.gregorian);
    assert.equal(DEFAULT_SETTINGS.budgetTokens, DEFAULTS.budgetTokens);
    // The panel's copy had lost keepNote; it is one object now.
    assert.equal(DEFAULT_SETTINGS.arc.keepNote, false);
    assert.deepEqual(Object.keys(DEFAULT_SETTINGS).sort(), ['arc', 'budgetTokens', 'calendar', 'capture', 'depth', 'dormantDays', 'dormantReplies', 'dueSoonDays', 'enabled', 'giverPresent', 'map', 'mirrorOffscreen', 'sceneTag', 'sourceOfTruth', 'spoilerGuard']);
});
