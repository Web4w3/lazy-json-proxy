import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createLazyProxy } from '../src/createLazyProxy.js';

describe('object proxy — property access', () => {
  test('reads string value', () => {
    const p = createLazyProxy('{"name":"Alice"}');
    assert.equal(p.name, 'Alice');
  });

  test('reads integer', () => {
    const p = createLazyProxy('{"n":42}');
    assert.equal(p.n, 42);
  });

  test('reads float', () => {
    const p = createLazyProxy('{"f":-3.14}');
    assert.equal(p.f, -3.14);
  });

  test('reads true', () => assert.equal(createLazyProxy('{"b":true}').b, true));
  test('reads false', () => assert.equal(createLazyProxy('{"b":false}').b, false));
  test('reads null', () => assert.equal(createLazyProxy('{"v":null}').v, null));

  test('undefined for missing key', () => {
    assert.equal(createLazyProxy('{"a":1}').missing, undefined);
  });

  test('nested object', () => {
    const p = createLazyProxy('{"o":{"x":1,"y":2}}');
    assert.equal(p.o.x, 1);
    assert.equal(p.o.y, 2);
  });

  test('deeply nested access', () => {
    const p = createLazyProxy('{"a":{"b":{"c":{"d":42}}}}');
    assert.equal(p.a.b.c.d, 42);
  });
});

describe('array proxy — index access', () => {
  test('reads elements by index', () => {
    const p = createLazyProxy('[10,20,30]');
    assert.equal(p[0], 10);
    assert.equal(p[1], 20);
    assert.equal(p[2], 30);
  });

  test('length', () => {
    assert.equal(createLazyProxy('[1,2,3]').length, 3);
    assert.equal(createLazyProxy('[]').length, 0);
  });

  test('array of objects', () => {
    const p = createLazyProxy('[{"id":1},{"id":2}]');
    assert.equal(p[0].id, 1);
    assert.equal(p[1].id, 2);
  });

  test('undefined for out-of-bounds', () => {
    assert.equal(createLazyProxy('[1,2]')[99], undefined);
  });
});

describe('Object.keys / in / iteration', () => {
  test('Object.keys returns all keys', () => {
    const p = createLazyProxy('{"b":2,"a":1,"c":3}');
    assert.deepEqual(Object.keys(p).sort(), ['a', 'b', 'c']);
  });

  test('"in" operator', () => {
    const p = createLazyProxy('{"x":1}');
    assert.equal('x' in p, true);
    assert.equal('y' in p, false);
  });

  test('for..of array', () => {
    const p = createLazyProxy('[1,2,3]');
    const result = [];
    for (const v of p) result.push(v);
    assert.deepEqual(result, [1, 2, 3]);
  });
});

describe('JSON.stringify compatibility', () => {
  test('object roundtrip', () => {
    const original = { a: 1, b: 'two', c: true, d: null };
    const p = createLazyProxy(JSON.stringify(original));
    assert.deepEqual(JSON.parse(JSON.stringify(p)), original);
  });

  test('array roundtrip', () => {
    const original = [1, 'two', true, null, { x: 1 }];
    const p = createLazyProxy(JSON.stringify(original));
    assert.deepEqual(JSON.parse(JSON.stringify(p)), original);
  });

  test('nested objects roundtrip', () => {
    const original = { a: { b: { c: [1, 2, { d: 'deep' }] } } };
    const p = createLazyProxy(JSON.stringify(original));
    assert.deepEqual(JSON.parse(JSON.stringify(p)), original);
  });
});

describe('lazy parsing — no upfront parse cost', () => {
  test('accessing one key does not materialise others', () => {
    // Access only 'a', then verify 'b' is an invalid JSON value
    // If b were eagerly parsed, it would throw immediately.
    const json = '{"a":1,"b":THIS_IS_INVALID}';
    const p = createLazyProxy(json);
    // Reading 'a' should not throw even though 'b' is malformed
    assert.equal(p.a, 1);
    // Reading 'b' would throw (invalid JSON), but only when accessed
    assert.throws(() => { const _ = p.b; }, SyntaxError);
  });
});

describe('cache eviction', () => {
  test('value re-parsed after eviction', () => {
    // Force tight budget so first entry is evicted when second is added
    const p = createLazyProxy('{"a":"' + 'x'.repeat(100) + '","b":2}', { maxCacheBytes: 1 });
    // First access caches the value
    const a = p.a;
    // Second access may evict 'a' from cache, but re-access should still work
    const b = p.b;
    // Re-access 'a' — should re-parse from raw JSON
    assert.equal(p.a, a);
    assert.equal(p.b, b);
  });

  test('eviction does not corrupt values', () => {
    const obj = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [`k${i}`, i * 10])
    );
    const p = createLazyProxy(JSON.stringify(obj), { maxCacheBytes: 50 });
    // Access all keys — some will be evicted and re-parsed
    for (let i = 0; i < 20; i++) {
      assert.equal(p[`k${i}`], i * 10);
    }
  });
});

describe('edge cases', () => {
  test('empty object', () => {
    const p = createLazyProxy('{}');
    assert.deepEqual(Object.keys(p), []);
  });

  test('empty array', () => {
    const p = createLazyProxy('[]');
    assert.equal(p.length, 0);
  });

  test('string with braces inside', () => {
    const p = createLazyProxy('{"s":"not {a} bracket"}');
    assert.equal(p.s, 'not {a} bracket');
  });

  test('string value containing JSON-like text', () => {
    const p = createLazyProxy('{"raw":"{\\"key\\":1}"}');
    assert.equal(p.raw, '{"key":1}');
  });
});
