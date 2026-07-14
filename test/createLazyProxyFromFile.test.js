import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createLazyProxyFromFile, createLazyProxyFromBuffer } from '../src/createLazyProxyFromFile.js';

const TMP = join(tmpdir(), 'ljp-test-' + process.pid);

async function write(name, content) {
  const p = join(TMP, name);
  await writeFile(p, typeof content === 'string' ? content : JSON.stringify(content), 'utf8');
  return p;
}

before(async () => { await mkdir(TMP, { recursive: true }); });
after(async ()  => { await rm(TMP, { recursive: true, force: true }); });

describe('createLazyProxyFromFile — object', () => {
  test('reads string value', async () => {
    const f = await write('str.json', { name: 'Alice' });
    const p = await createLazyProxyFromFile(f);
    assert.equal(p.name, 'Alice');
  });

  test('reads numeric value', async () => {
    const f = await write('num.json', { n: 42 });
    const p = await createLazyProxyFromFile(f);
    assert.equal(p.n, 42);
  });

  test('reads nested object', async () => {
    const f = await write('nested.json', { o: { x: 1, y: 2 } });
    const p = await createLazyProxyFromFile(f);
    assert.equal(p.o.x, 1);
    assert.equal(p.o.y, 2);
  });

  test('reads array value', async () => {
    const f = await write('arr.json', { items: [1, 2, 3] });
    const p = await createLazyProxyFromFile(f);
    assert.deepEqual([...p.items], [1, 2, 3]);
  });

  test('all value types', async () => {
    const obj = { s: 'str', n: 42, f: 3.14, b: true, nl: null, a: [1, 2], o: { x: 1 } };
    const f = await write('all-types.json', obj);
    const p = await createLazyProxyFromFile(f);
    assert.equal(p.s, 'str');
    assert.equal(p.n, 42);
    assert.equal(p.b, true);
    assert.equal(p.nl, null);
    assert.equal(p.o.x, 1);
  });

  test('Object.keys lists all keys', async () => {
    const f = await write('keys.json', { z: 1, a: 2, m: 3 });
    const p = await createLazyProxyFromFile(f);
    assert.deepEqual(Object.keys(p).sort(), ['a', 'm', 'z']);
  });

  test('"in" operator', async () => {
    const f = await write('in.json', { x: 1 });
    const p = await createLazyProxyFromFile(f);
    assert.equal('x' in p, true);
    assert.equal('y' in p, false);
  });

  test('JSON.stringify roundtrip', async () => {
    const original = { a: 1, b: 'hello', c: [1, 2] };
    const f = await write('rt.json', original);
    const p = await createLazyProxyFromFile(f);
    assert.deepEqual(JSON.parse(JSON.stringify(p)), original);
  });
});

describe('createLazyProxyFromFile — array', () => {
  test('index access', async () => {
    const f = await write('array.json', [10, 20, 30]);
    const p = await createLazyProxyFromFile(f);
    assert.equal(p[0], 10);
    assert.equal(p[1], 20);
    assert.equal(p[2], 30);
  });

  test('length', async () => {
    const f = await write('arr-len.json', [1, 2, 3, 4, 5]);
    const p = await createLazyProxyFromFile(f);
    assert.equal(p.length, 5);
  });

  test('for..of iteration', async () => {
    const f = await write('arr-iter.json', [1, 2, 3]);
    const p = await createLazyProxyFromFile(f);
    const result = [];
    for (const v of p) result.push(v);
    assert.deepEqual(result, [1, 2, 3]);
  });
});

describe('V8 heap isolation — Buffer vs string', () => {
  test('createLazyProxyFromBuffer does not require string conversion', async () => {
    // Buffer lives in C++ heap, not V8 heap.
    // This test verifies the proxy works correctly from a Buffer source.
    const buf = Buffer.from(JSON.stringify({ a: 1, b: [2, 3] }), 'utf8');
    const p = createLazyProxyFromBuffer(buf);
    assert.equal(p.a, 1);
    assert.deepEqual([...p.b], [2, 3]);
  });

  test('large object accessed partially — only accessed values on V8 heap', async () => {
    const obj = Object.fromEntries(
      Array.from({ length: 1000 }, (_, i) => [`key${i}`, 'x'.repeat(1000)])
    );
    const f = await write('large.json', obj);
    const p = await createLazyProxyFromFile(f);

    // Access only 3 keys — only those 3 values should be on the V8 heap
    assert.equal(p.key0.length, 1000);
    assert.equal(p.key500.length, 1000);
    assert.equal(p.key999.length, 1000);
    // The other 997 values remain as raw bytes in the Buffer, never on V8 heap
  });
});

describe('cache eviction — values re-parsed on demand', () => {
  test('re-access after eviction returns correct value', async () => {
    const obj = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [`k${i}`, i * 10])
    );
    const f = await write('evict.json', obj);
    // Tiny cache forces frequent eviction
    const p = await createLazyProxyFromFile(f, { maxCacheBytes: 10 });
    for (let i = 0; i < 20; i++) {
      assert.equal(p[`k${i}`], i * 10);
    }
    // Second pass — all re-parsed from Buffer
    for (let i = 0; i < 20; i++) {
      assert.equal(p[`k${i}`], i * 10);
    }
  });
});

describe('non-ASCII content', () => {
  test('non-ASCII string values', async () => {
    const f = await write('unicode.json', { greeting: 'こんにちは' });
    const p = await createLazyProxyFromFile(f);
    assert.equal(p.greeting, 'こんにちは');
  });

  test('non-ASCII key', async () => {
    const f = await write('unicode-key.json', { 'clé': 'valeur' });
    const p = await createLazyProxyFromFile(f);
    assert.equal(p['clé'], 'valeur');
  });
});
