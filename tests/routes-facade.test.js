// Tests for the src/routes.js facade: every name it exported before it was split into
// src/routes/ is still exported from the old path, and nothing else is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as routes from '../src/routes.js';

const BEFORE_SPLIT = [
    'ROUTE_CODES',
    'MODES',
    'MODERN_MODES',
    'MODERN_CODES',
    'MODERN_RULES',
    'DEFAULT_RULES',
    'loadWorldPack',
    'packSummary',
    'findPlace',
    'placesIn',
    'exitsFrom',
    'codeName',
    'paceFor',
    'boardDays',
    'legDays',
    'restDaysFor',
    'overnights',
    'shortestPath',
    'planRoute',
    'parseLeg',
    'validateLeg',
    'formatRoute',
    'formatLeg',
    'durationText',
];

test('routes.js still exports every name it exported before the split', () => {
    for (const name of BEFORE_SPLIT) assert.notEqual(routes[name], undefined, name);
});

test('routes.js exports no other names', () => {
    assert.deepEqual(Object.keys(routes).sort(), [...BEFORE_SPLIT].sort());
});
