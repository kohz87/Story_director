import test from 'node:test';
import assert from 'node:assert/strict';
import { randomId } from '../src/id.js';

test('native IDs remain unchanged; HTTP fallback uses random bytes and UUID version/variant', () => {
    assert.equal(randomId({ randomUUID: () => 'native-id' }), 'native-id');
    let calls = 0;
    const id = randomId({ getRandomValues(bytes) { calls++; return bytes.fill(255); } });
    assert.equal(calls, 1);
    assert.equal(id, 'ffffffff-ffff-4fff-bfff-ffffffffffff');
});

test('IDs remain available without Web Crypto and distinct across repeated allocations', () => {
    const ids = Array.from({ length: 1000 }, () => randomId(null));
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.every(id => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)));
});
