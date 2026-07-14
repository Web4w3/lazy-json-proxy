import fs from 'fs/promises';
import { JsonSpanner } from './JsonSpanner.js';
import { LruCache } from './LruCache.js';

const LAZY_PROXY = Symbol('LazyProxy');

/**
 * Create a lazy proxy backed by a file on disk.
 *
 * The file is read into a Node.js Buffer which lives in the C++ heap, NOT the
 * V8 heap. This means it does not count against --max-old-space-size. Only the
 * span index (key strings + byte positions) and the explicitly accessed parsed
 * values are ever allocated on the V8 heap.
 *
 * Property access is fully synchronous after the initial async load.
 *
 * @param {string} filePath
 * @param {object} [options]
 * @param {number} [options.maxCacheBytes=0] - parsed-value cache cap per proxy level (0 = unlimited)
 * @returns {Promise<Proxy>}
 */
export async function createLazyProxyFromFile(filePath, options = {}) {
  const { maxCacheBytes = 0 } = options;
  // readFile returns a Buffer allocated in C++ heap — does not count against V8 heap limit.
  const buf = await fs.readFile(filePath);
  return _makeBufferProxy(buf, 0, buf.length, new LruCache(maxCacheBytes));
}

/**
 * Synchronous variant for when you already have a Buffer in hand.
 * The buffer itself must already be allocated (e.g. from fs.readFileSync,
 * a SharedArrayBuffer view, or any other source).
 *
 * @param {Buffer} buf
 * @param {object} [options]
 * @returns {Proxy}
 */
export function createLazyProxyFromBuffer(buf, options = {}) {
  const { maxCacheBytes = 0 } = options;
  return _makeBufferProxy(buf, 0, buf.length, new LruCache(maxCacheBytes));
}

// ─── internal ────────────────────────────────────────────────────────────────

function _makeBufferProxy(buf, start, end, cache) {
  const slice = buf.slice(start, end); // O(1) view — no copy
  const { type, spans } = JsonSpanner.indexBuffer(slice);

  const target = type === 'array' ? [] : {};
  target[LAZY_PROXY] = true;
  target._buf    = slice;
  target._spans  = spans;
  target._cache  = cache;
  target._type   = type;

  return new Proxy(target, type === 'array' ? ARRAY_HANDLER : OBJECT_HANDLER);
}

function _resolve(target, prop) {
  const span = target._spans.get(prop);
  if (span === undefined) return undefined;

  const cached = target._cache.get(prop);
  if (cached !== undefined) return cached;

  const slice = target._buf.slice(span.start, span.end);
  const value = _deserialize(slice, target._cache);
  target._cache.set(prop, value, slice.length);
  return value;
}

function _deserialize(slice, cache) {
  const first = slice[0];
  if (first === 0x7B || first === 0x5B) { // '{' or '['
    // Nested proxy gets its own cache with the same max — avoids key collisions
    return _makeBufferProxy(slice, 0, slice.length, new LruCache(cache._max));
  }
  // Allocates only this value's string on the V8 heap, not the entire file
  return JSON.parse(slice.toString('utf8'));
}

function _materialize(target) {
  if (target._type === 'array') {
    const arr = [];
    for (let i = 0; i < target._spans.size; i++) arr.push(_maybeUnwrap(_resolve(target, i)));
    return arr;
  }
  const obj = {};
  for (const key of target._spans.keys()) obj[key] = _maybeUnwrap(_resolve(target, key));
  return obj;
}

function _maybeUnwrap(v) {
  if (v && typeof v === 'object' && v[LAZY_PROXY]) return _materialize(v);
  return v;
}

function* _objectIterator(target) {
  for (const key of target._spans.keys()) yield [key, _resolve(target, key)];
}

function* _arrayIterator(target) {
  for (let i = 0; i < target._spans.size; i++) yield _resolve(target, i);
}

// ─── Proxy handlers (mirror those in createLazyProxy.js) ─────────────────────

const OBJECT_HANDLER = {
  get(target, prop, receiver) {
    if (prop === LAZY_PROXY)      return true;
    if (prop === 'toJSON')        return () => _materialize(target);
    if (prop === Symbol.iterator) return _objectIterator.bind(null, target);
    if (typeof prop === 'symbol') return Reflect.get(target, prop, receiver);
    const sp = String(prop);
    if (sp in target && !(sp in Object.prototype)) return Reflect.get(target, prop, receiver);
    return _resolve(target, sp);
  },
  has(target, prop)  { return target._spans.has(String(prop)); },
  ownKeys(target)    { return [...target._spans.keys()]; },
  getOwnPropertyDescriptor(target, prop) {
    const sp = String(prop);
    if (target._spans.has(sp)) {
      return { configurable: true, enumerable: true, writable: false, value: _resolve(target, sp) };
    }
    return undefined;
  },
};

const ARRAY_HANDLER = {
  get(target, prop, receiver) {
    if (prop === LAZY_PROXY) return true;
    if (prop === 'toJSON')   return () => _materialize(target);
    if (prop === 'length')   return target._spans.size;
    if (prop === Symbol.iterator)  return _arrayIterator.bind(null, target);
    if (typeof prop === 'symbol')  return Reflect.get(target, prop, receiver);
    const idx = Number(prop);
    if (Number.isInteger(idx) && idx >= 0) return _resolve(target, idx);
    return Reflect.get(target, prop, receiver);
  },
  has(target, prop) {
    const idx = Number(prop);
    return Number.isInteger(idx) && target._spans.has(idx);
  },
  ownKeys(target) {
    return [...target._spans.keys()].map(String).concat(['length']);
  },
  getOwnPropertyDescriptor(target, prop) {
    if (prop === 'length') return { configurable: false, enumerable: false, writable: true, value: target._spans.size };
    const idx = Number(prop);
    if (Number.isInteger(idx) && idx >= 0 && target._spans.has(idx)) {
      return { configurable: true, enumerable: true, writable: false, value: _resolve(target, idx) };
    }
    return undefined;
  },
};
