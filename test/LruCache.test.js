import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { LruCache } from '../src/LruCache.js';

describe('basic operations', () => {
  test('set and get', () => {
    const c = new LruCache();
    c.set('a', 1, 10);
    assert.equal(c.get('a'), 1);
  });

  test('missing key returns undefined', () => {
    assert.equal(new LruCache().get('x'), undefined);
  });

  test('has', () => {
    const c = new LruCache();
    c.set('k', 'v', 5);
    assert.equal(c.has('k'), true);
    assert.equal(c.has('z'), false);
  });

  test('delete removes entry', () => {
    const c = new LruCache();
    c.set('k', 'v', 5);
    assert.equal(c.delete('k'), true);
    assert.equal(c.has('k'), false);
  });

  test('delete missing returns false', () => {
    assert.equal(new LruCache().delete('x'), false);
  });

  test('overwrite updates bytes', () => {
    const c = new LruCache();
    c.set('a', 1, 10);
    c.set('a', 2, 20);
    assert.equal(c.bytes, 20);
    assert.equal(c.get('a'), 2);
  });

  test('clear empties cache', () => {
    const c = new LruCache();
    c.set('a', 1, 5);
    c.set('b', 2, 5);
    c.clear();
    assert.equal(c.size, 0);
    assert.equal(c.bytes, 0);
  });
});

describe('LRU eviction', () => {
  test('evicts oldest entry when budget exceeded', () => {
    const c = new LruCache(20);
    c.set('a', 1, 10);
    c.set('b', 2, 10);
    c.set('c', 3, 10); // 'a' should be evicted
    assert.equal(c.has('a'), false);
    assert.equal(c.has('b'), true);
    assert.equal(c.has('c'), true);
  });

  test('get promotes to MRU', () => {
    const c = new LruCache(20);
    c.set('a', 1, 10);
    c.set('b', 2, 10);
    c.get('a'); // 'a' is now MRU, 'b' is LRU
    c.set('c', 3, 10); // 'b' should be evicted
    assert.equal(c.has('b'), false);
    assert.equal(c.has('a'), true);
    assert.equal(c.has('c'), true);
  });

  test('bytes never exceeds maxBytes', () => {
    const c = new LruCache(50);
    for (let i = 0; i < 100; i++) c.set(`k${i}`, i, 10);
    assert.ok(c.bytes <= 50);
  });

  test('unlimited cache (maxBytes=0) never evicts', () => {
    const c = new LruCache(0);
    for (let i = 0; i < 1000; i++) c.set(`k${i}`, i, 1000);
    assert.equal(c.size, 1000);
  });
});
