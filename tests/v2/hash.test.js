// The contract's Hash (src/v2/hash.js): SHA-256 of normalized JSON, equal to the platform's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonicalJson, hashJson, sha256 } from '../../src/v2/hash.js';

test('sha256 is the platform\'s, for short, block-edge and multi-block text, with non-ASCII', () => {
    for (const text of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'é☃🙂'.repeat(40), 'x'.repeat(1000)]) assert.equal(sha256(text), createHash('sha256').update(text).digest('hex'));
});

test('the normalized JSON sorts keys, keeps array order and refuses what is not plain JSON', () => {
    assert.equal(canonicalJson({ b: 1, a: [3, { d: 1, c: 2 }] }), '{"a":[3,{"c":2,"d":1}],"b":1}');
    assert.equal(hashJson({ a: 1, b: 2 }), hashJson({ b: 2, a: 1 }));
    assert.notEqual(hashJson([1, 2]), hashJson([2, 1]));
    assert.throws(() => hashJson({ a: Infinity }));
    assert.throws(() => hashJson({ a: undefined }));
    assert.throws(() => hashJson(new Date()));
});
